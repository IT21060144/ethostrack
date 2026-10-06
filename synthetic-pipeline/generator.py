"""
generator.py — AI-Generated Synthetic Data Pipeline (Phase 6)
---------------------------------------------------------------------------
Generates relational student cohorts and samples realistic study streams 
embedded with ground-truth consistency profiles (Consistent, Cramming, Irregular) 
as described in Section 11.4 of the research proposal.
"""
import os
import uuid
import random
import json
from datetime import datetime, timedelta

class StudyCohortSimulator:
    def __init__(self, time_zone="Asia/Colombo"):
        self.time_zone = time_zone
        # Define behavioral profile parameter bounds mapping to proposal thresholds
        self.profiles = {
            "consistent": {
                "days_per_week": 5,
                "target_minutes": 90,
                "idle_probability": 0.05,
                "abnormal_exit_prob": 0.02,
                "start_hour_mean": 9.0  # Steady morning routine
            },
            "cramming": {
                "days_per_week": 1,
                "target_minutes": 360, # Long duration mass block
                "idle_probability": 0.20,
                "abnormal_exit_prob": 0.15,
                "start_hour_mean": 22.0 # Late night deadline pressure
            },
            "irregular": {
                "days_per_week": 3,
                "target_minutes": 45,
                "idle_probability": 0.15,
                "abnormal_exit_prob": 0.10,
                "start_hour_mean": 15.0 # Unstable afternoon blocks
            }
        }

    def generate_student_cohort(self, num_students=10):
        students = []
        for _ in range(num_students):
            profile_name = random.choice(list(self.profiles.keys()))
            student_id = str(uuid.uuid4())
            pseudo_id = str(uuid.uuid4().hex) # Emulate secure Keyed HMAC result string
            
            students.append({
                "student_id": student_id,
                "pseudo_id": pseudo_id,
                "profile": profile_name,
                "config": self.profiles[profile_name]
            })
        return students

    def simulate_semester_logs(self, students, total_weeks=12):
        start_date = datetime.now() - timedelta(weeks=total_weeks)
        session_logs = []

        for student in students:
            cfg = student["config"]
            pseudo_id = student["pseudo_id"]

            for day_offset in range(total_weeks * 7):
                current_day = start_date + timedelta(days=day_offset)
                
                # Check if student studies on this specific day based on profile odds
                weekly_odds = cfg["days_per_week"] / 7.0
                if random.random() > weekly_odds:
                    continue # Rest day simulation occurrence

                # Sample randomized localized start times
                hour = int(random.normalvariate(cfg["start_hour_mean"], 1.5))
                hour = max(0, min(23, hour)) # Hard calendar bounding limits
                minute = random.randint(0, 59)
                
                login_time = current_day.replace(hour=hour, minute=minute, second=0)
                
                # Compute duration lengths with variation variance bounds
                duration_minutes = max(10, int(random.normalvariate(cfg["target_minutes"], 15)))
                total_seconds = duration_minutes * 60

                # Inject privacy performance metrics flags (Idle handling simulation logic)
                if random.random() < cfg["idle_probability"]:
                    idle_seconds = int(total_seconds * random.uniform(0.1, 0.3))
                    active_seconds = total_seconds - idle_seconds
                else:
                    idle_seconds = 0
                    active_seconds = total_seconds

                # Evaluate execution termination conditions
                if random.random() < cfg["abnormal_exit_prob"]:
                    end_reason = "timeout"
                else:
                    end_reason = "explicit"

                logout_time = login_time + timedelta(seconds=total_seconds)

                session_logs.append({
                    "pseudoId": pseudo_id,
                    "loginTime": login_time.isoformat() + "Z",
                    "logoutTime": logout_time.isoformat() + "Z",
                    "activeSeconds": int(active_seconds),
                    "idleSeconds": int(idle_seconds),
                    "endReason": end_reason
                })

        return session_logs

# Local execution validation entry script structure block
if __name__ == "__main__":
    print("[Pipeline Engine] Starting offline synthetic dataset cohort simulation...")
    simulator = StudyCohortSimulator()
    
    # Sample a baseline evaluation database profile pool tracking 5 student paths
    cohort = simulator.generate_student_cohort(num_students=5)
    logs = simulator.simulate_semester_logs(cohort, total_weeks=4)
    
    output_data = {
        "metadata": {
            "generated_at": datetime.now().isoformat(),
            "total_students": len(cohort),
            "total_sessions": len(logs)
        },
        "cohort": cohort,
        "sessions": logs
    }
    
    # Save parameters out as clean test database JSON arrays
    output_path = os.path.join(os.path.dirname(__file__), "synthetic_dataset.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2)
        
    print(f"[Pipeline Engine Success] Generated {len(logs)} study records across {len(cohort)} profiles.")
    print(f"[Pipeline Engine Success] Data saved securely to: {output_path}")
