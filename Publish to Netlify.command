#!/bin/bash
# Double-click me to put EthosTrack on Netlify (a new site of its own).
cd "$(dirname "$0")" || exit 1
bash deploy/publish-netlify.sh
echo
read -n 1 -s -r -p "Press any key to close this window."
