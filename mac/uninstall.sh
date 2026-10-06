#!/bin/bash
# =============================================================================
# EthosTrack — turn off auto-start on macOS
# -----------------------------------------------------------------------------
# Run it by double-clicking "Turn Off EthosTrack.command", or npm run mac:uninstall.
# Stops EthosTrack, removes the login item and the installed copy in
# ~/Library/Application Support/EthosTrack. The project folder, backend/.env
# and all study data in MongoDB are left exactly as they are, so running the
# installer again brings everything back.
# =============================================================================
set -uo pipefail

LABEL="com.ethostrack.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DEST="$HOME/Library/Application Support/EthosTrack"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload -w "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
rm -rf "$DEST"

printf '\n\033[32m✓\033[0m EthosTrack is stopped and will no longer start when the Mac opens.\n'
printf '  Your account and study data are kept. Run "Install EthosTrack" to turn it back on.\n\n'
