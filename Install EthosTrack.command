#!/bin/bash
# Double-click me to make EthosTrack start every time the Mac opens.
cd "$(dirname "$0")" || exit 1
bash mac/install.sh
echo
read -n 1 -s -r -p "Press any key to close this window."
