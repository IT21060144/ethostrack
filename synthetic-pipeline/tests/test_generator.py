"""Unit tests for the synthetic data pipeline (standard library only).

Run from the repo root:  python3 -m unittest discover -s synthetic-pipeline/tests
"""
import os
import sys
import unittest
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import generator  # noqa: E402

END = date(2026, 10, 1)


class GeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = generator.build_dataset(per_profile=20, total_weeks=12, seed=1, end_date=END)

    def test_six_profiles_with_equal_group_sizes(self):
        profiles = [s["profile"] for s in self.data["cohort"]]
        self.assertEqual(set(profiles), {
            "consistent", "moderately_consistent", "cramming",
            "irregular", "declining", "recovering",
        })
        for name in set(profiles):
            self.assertEqual(profiles.count(name), 20)

    def test_same_seed_gives_same_data(self):
        again = generator.build_dataset(per_profile=20, total_weeks=12, seed=1, end_date=END)
        self.assertEqual(again["sessions"], self.data["sessions"])
        self.assertEqual(again["cohort"], self.data["cohort"])

    def test_no_identity_fields(self):
        for student in self.data["cohort"]:
            self.assertEqual(set(student), {"student_id", "pseudo_id", "profile", "expected_rank", "config"})
        for session in self.data["sessions"]:
            self.assertNotIn("student_id", session)
            self.assertNotIn("email", session)

    def test_segments_add_up_and_breaks_stay_short(self):
        for s in self.data["sessions"]:
            seg = s["segments"]
            self.assertEqual(len(seg) % 2, 1, "segments start and end with activity")
            self.assertEqual(sum(seg[0::2]), s["activeSeconds"])
            self.assertEqual(sum(seg[1::2]), s["idleSeconds"])
            for active in seg[0::2] if len(seg) > 1 else []:
                self.assertGreaterEqual(active, generator.MIN_ACTIVE_SECONDS)
            for idle in seg[1::2]:
                self.assertGreaterEqual(idle, generator.MIN_BREAK_SECONDS)
                self.assertLessEqual(idle, generator.MAX_BREAK_SECONDS)
            self.assertIn(s["endReason"], ("explicit", "timeout"))

    def test_sessions_stay_inside_the_semester(self):
        first = self.data["sessions"][0]["loginTime"]
        last = self.data["sessions"][-1]["loginTime"]
        self.assertLess(first, last)
        self.assertLess(last, "2026-10-01T00:00:00Z")

    def test_fidelity_days_per_week_close_to_target(self):
        for name, row in self.data["fidelity"].items():
            target = row["days_per_week"]["target"]
            achieved = row["days_per_week"]["achieved"]
            self.assertAlmostEqual(achieved, target, delta=max(0.35, 0.15 * target), msg=name)

    def test_profiles_differ_in_the_expected_direction(self):
        f = self.data["fidelity"]
        days = {k: v["days_per_week"]["achieved"] for k, v in f.items()}
        self.assertGreater(days["consistent"], days["moderately_consistent"])
        self.assertGreater(days["moderately_consistent"], days["irregular"])
        self.assertGreater(days["irregular"], days["cramming"])

    def test_declining_and_recovering_trends(self):
        cohort = {s["pseudo_id"]: s["profile"] for s in self.data["cohort"]}
        def halves(profile):
            rows = [s for s in self.data["sessions"] if cohort[s["pseudoId"]] == profile]
            cut = date.fromordinal(END.toordinal() - 42).isoformat()  # middle of the 12 weeks
            early = sum(1 for r in rows if r["loginTime"] < cut)
            late = len(rows) - early
            return early, late
        early, late = halves("declining")
        self.assertGreater(early, late * 1.5)
        early, late = halves("recovering")
        self.assertGreater(late, early * 1.5)

    def test_cramming_peaks_in_deadline_weeks(self):
        cohort = {s["pseudo_id"]: s["profile"] for s in self.data["cohort"]}
        rows = [s for s in self.data["sessions"] if cohort[s["pseudoId"]] == "cramming"]
        # Deadline weeks are 6 and 12 of 12: days 35-41 and 77-83 of the semester
        start = date.fromordinal(END.toordinal() - 84)
        in_deadline = 0
        for r in rows:
            day = date.fromisoformat(r["loginTime"][:10]).toordinal() - start.toordinal()
            if 35 <= day <= 42 or day >= 77:
                in_deadline += 1
        self.assertGreater(in_deadline / len(rows), 0.5)


if __name__ == "__main__":
    unittest.main()
