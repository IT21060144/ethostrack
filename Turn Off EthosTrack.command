#!/bin/bash
# Double-click me to stop EthosTrack starting when the Mac opens.
cd "$(dirname "$0")" || exit 1
bash mac/uninstall.sh
read -n 1 -s -r -p "Press any key to close this window."
