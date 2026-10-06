"""
generator.py - Synthetic study-session data pipeline (Phase 6)
---------------------------------------------------------------------------
Implements steps 1, 3 and 5 of the synthetic data pipeline in Section 11.4 of
the research proposal:

  1. Profile specification. Six behavioural profiles with explicit parameters
     (study days per week, session length, start time, idle behaviour,
     abnormal-exit probability) plus deadline and exam-period effects.
  3. Session simulation. A stochastic simulator samples login times, active
     segments, idle gaps (breaks) and logouts for every synthetic student over
     a semester. Each session keeps its segment list, so the exact active and
     idle seconds are known and can be replayed through the real heartbeat API.
  5. Fidelity and ground truth. Every student keeps a ground-truth profile
     label and an expected consistency rank, and the generated data are
     compared with the target parameters (see the "fidelity" block of the
     output).

Steps 2 (LLM personas) and 4 (CTGAN / SDV augmentation) are not implemented;
the profile parameters below were written and reviewed by hand instead.

No real data is read or produced: student ids and pseudoIds are random, and
no names, emails or other identity fields exist in the output.

Usage (standard library only):
    python3 generator.py                         # 10 students per profile, 12 weeks
    python3 generator.py --per-profile 50 --weeks 14 --seed 7 --out big.json
"""
import argparse
import json
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

# Sri Lanka has no daylight saving time, so a fixed offset is exact.
LOCAL_TZ_NAME = "Asia/Colombo"
LOCAL_OFFSET = timedelta(hours=5, minutes=30)

# Each break is shorter than the server's IDLE_END_SECONDS (10 minutes), so a
# break never ends a session on its own; a session ends by logout or timeout.
MIN_BREAK_SECONDS = 2 * 60
MAX_BREAK_SECONDS = 9 * 60

# ---------------------------------------------------------------------------
# Step 1: profile specification
# ---------------------------------------------------------------------------
# days_per_week       mean number of study days in a normal week
# target_minutes      mean length of one study session (minutes)
# minutes_sd          spread of session length (minutes)
# start_hour_mean/sd  first login hour (local time) and its spread (hours)
# idle_probability    chance that a session contains breaks
# abnormal_exit_prob  chance that a session ends by timeout (lid closed, lost network)
# trend               (start, end) multiplier on study probability and length
#                     across the semester; (1, 1) means no change
# deadline_boost      multiplier on study probability in deadline and exam weeks
# expected_rank       ground-truth consistency order, 1 = most consistent.
#                     Declining and recovering share a rank: over a whole
#                     semester they are equally (in)consistent, only mirrored.
PROFILES = {
    "consistent": {
        "days_per_week": 5.5,
        "target_minutes": 90,
        "minutes_sd": 12,
        "start_hour_mean": 9.0,
        "start_hour_sd": 0.6,
        "idle_probability": 0.10,
        "abnormal_exit_prob": 0.02,
        "trend": (1.0, 1.0),
        "deadline_boost": 1.0,
        "expected_rank": 1,
    },
    "moderately_consistent": {
        "days_per_week": 4.0,
        "target_minutes": 70,
        "minutes_sd": 20,
        "start_hour_mean": 17.0,
        "start_hour_sd": 1.2,
        "idle_probability": 0.20,
        "abnormal_exit_prob": 0.05,
        "trend": (1.0, 1.0),
        "deadline_boost": 1.15,
        "expected_rank": 2,
    },
    "declining": {
        "days_per_week": 5.0,
        "target_minutes": 80,
        "minutes_sd": 20,
        "start_hour_mean": 18.0,
        "start_hour_sd": 1.5,
        "idle_probability": 0.25,
        "abnormal_exit_prob": 0.08,
        "trend": (1.0, 0.25),
        "deadline_boost": 1.3,
        "expected_rank": 3,
    },
    "recovering": {
        "days_per_week": 5.0,
        "target_minutes": 80,
        "minutes_sd": 20,
        "start_hour_mean": 18.0,
        "start_hour_sd": 1.5,
        "idle_probability": 0.25,
        "abnormal_exit_prob": 0.08,
        "trend": (0.25, 1.0),
        "deadline_boost": 1.3,
        "expected_rank": 3,
    },
    "irregular": {
        "days_per_week": 2.5,
        "target_minutes": 50,
        "minutes_sd": 30,
        "start_hour_mean": 15.0,
        "start_hour_sd": 4.0,
        "idle_probability": 0.30,
        "abnormal_exit_prob": 0.12,
        "trend": (1.0, 1.0),
        "deadline_boost": 1.5,
        "expected_rank": 5,
    },
    "cramming": {
        "days_per_week": 0.6,
        "target_minutes": 240,
        "minutes_sd": 60,
        "start_hour_mean": 21.5,
        "start_hour_sd": 1.0,
        "idle_probability": 0.40,
        "abnormal_exit_prob": 0.15,
        "trend": (1.0, 1.0),
        "deadline_boost": 6.0,
        "expected_rank": 6,
    },
}


def deadline_weeks(total_weeks):
    """Mid-semester deadline and the final exam period (1-based week numbers)."""
    return {max(1, round(total_weeks / 2)), total_weeks}


def trend_factor(cfg, week_index, total_weeks):
    """Linear change from trend[0] in the first week to trend[1] in the last."""
    start, end = cfg["trend"]
    if total_weeks <= 1:
        return start
    return start + (end - start) * (week_index / (total_weeks - 1))


class StudyCohortSimulator:
    def __init__(self, seed=None, profiles=None):
        self.rng = random.Random(seed)
        self.profiles = profiles or PROFILES

    # -----------------------------------------------------------------------
    # Cohort: one row per synthetic student, labelled with its ground truth
    # -----------------------------------------------------------------------
    def generate_student_cohort(self, per_profile=10):
        students = []
        for profile_name, cfg in self.profiles.items():
            for _ in range(per_profile):
                students.append({
                    "student_id": str(uuid.UUID(int=self.rng.getrandbits(128), version=4)),
                    # Random, like utils/pseudonym.newPseudoId(); not derived from student_id
                    "pseudo_id": "%064x" % self.rng.getrandbits(256),
                    "profile": profile_name,
                    "expected_rank": cfg["expected_rank"],
                    "config": {k: v for k, v in cfg.items() if k != "expected_rank"},
                })
        self.rng.shuffle(students)
        return students

    # -----------------------------------------------------------------------
    # Step 3: session simulation
    # -----------------------------------------------------------------------
    def _segments(self, cfg, total_seconds):
        """Splits a session into alternating active/idle seconds.

        Returns a list [active, idle, active, idle, ..., active]. It always
        starts and ends with an active segment, because a session is opened by
        activity and the server closes it at the last activity.
        """
        if self.rng.random() >= cfg["idle_probability"] or total_seconds < 20 * 60:
            return [total_seconds]
        breaks = self.rng.randint(1, max(1, min(4, total_seconds // (30 * 60))))
        idle = [self.rng.randint(MIN_BREAK_SECONDS, MAX_BREAK_SECONDS) for _ in range(breaks)]
        active_total = total_seconds - sum(idle)
        if active_total < (breaks + 1) * 60:
            return [total_seconds]
        # Random cut points split the active time into breaks + 1 pieces
        cuts = sorted(self.rng.sample(range(60, active_total - 59), breaks))
        pieces = [b - a for a, b in zip([0] + cuts, cuts + [active_total])]
        segments = []
        for i, piece in enumerate(pieces):
            segments.append(piece)
            if i < breaks:
                segments.append(idle[i])
        return segments

    def simulate_semester_logs(self, students, total_weeks=12, end_date=None):
        """Samples sessions for each student; returns a list of session dicts."""
        # The semester ends yesterday (local time), so the dashboard has data.
        today_local = (end_date or (datetime.now(timezone.utc) + LOCAL_OFFSET).date())
        first_day = today_local - timedelta(days=total_weeks * 7)
        exam_weeks = deadline_weeks(total_weeks)
        sessions = []

        for student in students:
            cfg = student["config"]
            for day_offset in range(total_weeks * 7):
                week_index = day_offset // 7
                local_day = first_day + timedelta(days=day_offset)
                factor = trend_factor(cfg, week_index, total_weeks)

                probability = (cfg["days_per_week"] / 7.0) * factor
                if (week_index + 1) in exam_weeks:
                    probability *= cfg["deadline_boost"]
                if self.rng.random() >= min(0.98, probability):
                    continue  # no study on this day

                start_hour = self.rng.normalvariate(cfg["start_hour_mean"], cfg["start_hour_sd"])
                # Keep the session inside its local day (00:00 to 23:00)
                start_hour = min(23.0, max(0.0, start_hour))
                minutes = self.rng.normalvariate(cfg["target_minutes"] * max(0.4, factor), cfg["minutes_sd"])
                minutes = max(10, int(minutes))

                local_start = datetime(local_day.year, local_day.month, local_day.day) + timedelta(
                    hours=int(start_hour), minutes=int((start_hour % 1) * 60), seconds=self.rng.randint(0, 59)
                )
                segments = self._segments(cfg, minutes * 60)
                active = sum(segments[0::2])
                idle = sum(segments[1::2])
                login_utc = local_start - LOCAL_OFFSET
                logout_utc = login_utc + timedelta(seconds=active + idle)
                end_reason = "timeout" if self.rng.random() < cfg["abnormal_exit_prob"] else "explicit"

                sessions.append({
                    "pseudoId": student["pseudo_id"],
                    "loginTime": login_utc.isoformat() + "Z",
                    "logoutTime": logout_utc.isoformat() + "Z",
                    "activeSeconds": active,
                    "idleSeconds": idle,
                    "endReason": end_reason,
                    # Ground truth for replay tests: alternating active/idle seconds
                    "segments": segments,
                })

        sessions.sort(key=lambda s: s["loginTime"])
        return sessions


# ---------------------------------------------------------------------------
# Step 5: fidelity check against the target parameters
# ---------------------------------------------------------------------------
def _mean(values):
    return sum(values) / len(values) if values else 0.0


def fidelity_report(students, sessions, total_weeks):
    """Per-profile achieved values next to their targets.

    Days per week is compared with the target adjusted for the trend and the
    deadline weeks, so a correct simulator should land close to it.
    """
    by_student = {}
    for s in sessions:
        by_student.setdefault(s["pseudoId"], []).append(s)

    exam_weeks = deadline_weeks(total_weeks)
    report = {}
    for profile_name, cfg in PROFILES.items():
        members = [st for st in students if st["profile"] == profile_name]
        if not members:
            continue
        expected_days = 0.0
        for w in range(total_weeks):
            p = (cfg["days_per_week"] / 7.0) * trend_factor(cfg, w, total_weeks)
            if (w + 1) in exam_weeks:
                p *= cfg["deadline_boost"]
            expected_days += min(0.98, p) * 7
        expected_days /= total_weeks

        rows = [s for st in members for s in by_student.get(st["pseudo_id"], [])]
        achieved_days = len(rows) / (len(members) * total_weeks)
        hours = []
        for s in rows:
            t = datetime.fromisoformat(s["loginTime"].rstrip("Z")) + LOCAL_OFFSET
            hours.append(t.hour + t.minute / 60)
        report[profile_name] = {
            "students": len(members),
            "sessions": len(rows),
            "days_per_week": {"target": round(expected_days, 2), "achieved": round(achieved_days, 2)},
            "start_hour_mean": {"target": cfg["start_hour_mean"], "achieved": round(_mean(hours), 2)},
            "share_with_breaks": {
                "target_at_most": cfg["idle_probability"],
                "achieved": round(_mean([1.0 if s["idleSeconds"] > 0 else 0.0 for s in rows]), 3),
            },
            "share_timeout": {
                "target": cfg["abnormal_exit_prob"],
                "achieved": round(_mean([1.0 if s["endReason"] == "timeout" else 0.0 for s in rows]), 3),
            },
        }
    return report


def build_dataset(per_profile=10, total_weeks=12, seed=None, end_date=None):
    simulator = StudyCohortSimulator(seed=seed)
    cohort = simulator.generate_student_cohort(per_profile=per_profile)
    sessions = simulator.simulate_semester_logs(cohort, total_weeks=total_weeks, end_date=end_date)
    return {
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "seed": seed,
            "timezone": LOCAL_TZ_NAME,
            "weeks": total_weeks,
            "profiles": list(PROFILES.keys()),
            "total_students": len(cohort),
            "total_sessions": len(sessions),
            "contains_real_records": False,
        },
        "fidelity": fidelity_report(cohort, sessions, total_weeks),
        "cohort": cohort,
        "sessions": sessions,
    }


def main():
    parser = argparse.ArgumentParser(description="Generate a labelled synthetic study cohort.")
    parser.add_argument("--per-profile", type=int, default=10, help="students per profile (default 10)")
    parser.add_argument("--weeks", type=int, default=12, help="semester length in weeks (default 12)")
    parser.add_argument("--seed", type=int, default=42, help="random seed, for repeatable data (default 42)")
    parser.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "synthetic_dataset.json"))
    args = parser.parse_args()

    print("[Pipeline] Simulating %d students per profile over %d weeks (seed %s)..." % (args.per_profile, args.weeks, args.seed))
    data = build_dataset(per_profile=args.per_profile, total_weeks=args.weeks, seed=args.seed)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)

    meta = data["metadata"]
    print("[Pipeline] %d sessions for %d students saved to %s" % (meta["total_sessions"], meta["total_students"], args.out))
    print("[Pipeline] Fidelity (days per week, target vs achieved):")
    for name, row in data["fidelity"].items():
        d = row["days_per_week"]
        print("  %-22s %5.2f vs %5.2f" % (name, d["target"], d["achieved"]))


if __name__ == "__main__":
    main()
