# Changelog

This file records what changed in EthosTrack, day by day, until the final presentation.

## 2026-10-08
- Merged the privacy and testing update (pull request #1): k-anonymity and differential privacy for research exports, 96 automated tests, and a six-profile synthetic data generator.
- Added this changelog so every change to the project is easy to follow.

## 2026-10-06
- First version on GitHub: React frontend, Express and MongoDB backend, automatic study tracking (active vs idle time), consistency score dashboard, and the Privacy Centre.
- Identity data (User) is kept apart from study data (StudySession). They are linked only through PseudonymMap, using a keyed hash that only the server can compute.
- Live app published at https://ethostrack-inoka.netlify.app
