"""
make_replay_fixture.py - picks the sessions replayed by the backend's
simulation test (backend/tests/simulation/replay.test.js).

Up to 2 sessions per profile, under 2.5 hours each (5 hours for cramming,
whose sessions are long by design), abnormal exits (timeout)
and sessions with breaks first, from a small seeded cohort. Run it again
after changing generator.py:

    python3 synthetic-pipeline/make_replay_fixture.py
"""
import json
import os
from datetime import date

import generator

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", "tests", "fixtures", "synthetic_sessions.json")


def main():
    data = generator.build_dataset(per_profile=2, total_weeks=4, seed=2026, end_date=date(2026, 9, 1))
    profile_of = {s["pseudo_id"]: s["profile"] for s in data["cohort"]}
    ordered = sorted(data["sessions"], key=lambda s: (s["endReason"] != "timeout", -len(s["segments"]), s["loginTime"]))

    picked, per_profile = [], {}
    for s in ordered:
        profile = profile_of[s["pseudoId"]]
        limit = 300 * 60 if profile == "cramming" else 150 * 60
        if per_profile.get(profile, 0) >= 2 or s["activeSeconds"] + s["idleSeconds"] > limit:
            continue
        per_profile[profile] = per_profile.get(profile, 0) + 1
        picked.append({"profile": profile, **{k: s[k] for k in ("activeSeconds", "idleSeconds", "endReason", "segments")}})

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({
            "note": "Made by synthetic-pipeline/make_replay_fixture.py (seed 2026). "
                    "segments alternate active/idle seconds; they are the ground truth for the replay test.",
            "sessions": picked,
        }, f, indent=1)
    timeouts = sum(1 for p in picked if p["endReason"] == "timeout")
    print("%d sessions (%d abnormal exits) written to %s" % (len(picked), timeouts, os.path.normpath(OUT)))


if __name__ == "__main__":
    main()
