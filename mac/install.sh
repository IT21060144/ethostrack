#!/bin/bash
# =============================================================================
# EthosTrack — macOS installer: start EthosTrack whenever the Mac opens
# -----------------------------------------------------------------------------
# Run it by double-clicking "Install EthosTrack.command" in the project folder,
# or with:  npm run mac:install
#
# What it does
#   1. Checks Node.js and MongoDB (starts MongoDB as a Homebrew service when it
#      is installed that way, so the database also comes up at login).
#   2. Creates backend/.env with fresh random secrets if it does not exist.
#   3. Installs packages and builds the React app.
#   4. Copies the app to ~/Library/Application Support/EthosTrack. Background
#      programs may not read Desktop/Documents/Downloads on macOS, so the copy
#      is what runs, wherever this project folder lives.
#   5. Adds a LaunchAgent (a per-user login item). At every login it starts the
#      server on http://localhost:5001, which serves the app and opens it in
#      Firefox. When the lid is opened after sleep it opens the app again,
#      unless the tab is still open (backend/utils/autoOpen.js).
#
# Run it again after changing the code. Undo it with "Turn Off EthosTrack.command"
# (or npm run mac:uninstall). Study data stays in MongoDB either way.
# =============================================================================
set -euo pipefail

LABEL="com.ethostrack.app"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$HOME/Library/Application Support/EthosTrack"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_FILE="$HOME/Library/Logs/EthosTrack.log"
GUI_DOMAIN="gui/$(id -u)"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
ok() { printf '    \033[32m✓\033[0m %s\n' "$1"; }
note() { printf '    %s\n' "$1"; }
fail() {
  printf '\n\033[31m[!] %s\033[0m\n\n' "$1"
  exit 1
}

if [ "$(uname)" != "Darwin" ]; then
  fail "This installer is for macOS only."
fi

# Homebrew and nvm put node in places a fresh Terminal may not have on PATH.
# The first node that actually runs wins: a Homebrew node can be left broken
# by a Homebrew update (missing icu4c library) while another one works.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

# --- 1. Node.js -------------------------------------------------------------
step "Checking Node.js"
NODE_BIN=""
IFS=: read -r -a PATH_DIRS <<< "$PATH"
for dir in "${PATH_DIRS[@]}"; do
  if [ -x "$dir/node" ] && "$dir/node" -v >/dev/null 2>&1; then
    NODE_BIN="$dir/node"
    break
  fi
done
if [ -z "$NODE_BIN" ] && [ -x /opt/homebrew/bin/node ]; then
  fail "Node.js is installed but broken. In Terminal run: brew update && brew upgrade node   then run this again."
fi
[ -n "$NODE_BIN" ] || fail "Node.js was not found. Install it from https://nodejs.org (LTS), then run this again."
# Use the npm that sits next to this node.
export PATH="$(dirname "$NODE_BIN"):$PATH"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js 18 or newer is needed (found $("$NODE_BIN" -v))."
command -v npm >/dev/null 2>&1 || fail "npm was not found next to Node.js."
ok "Node.js $("$NODE_BIN" -v) at $NODE_BIN"

# --- 2. Settings (backend/.env) --------------------------------------------
step "Checking settings"
ENV_FILE="$PROJECT_DIR/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$PROJECT_DIR/backend/.env.example" "$ENV_FILE"
  ok "Created backend/.env"
fi
# Replace the example placeholders with long random secrets. Secrets that are
# already set are never changed: a new PSEUDONYM_SECRET would cut every
# student's link to their study data.
"$NODE_BIN" - "$ENV_FILE" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const file = process.argv[2];
let text = fs.readFileSync(file, 'utf8');
const placeholders = { JWT_SECRET: 'change-me', PSEUDONYM_SECRET: 'change-me-too' };
for (const [key, placeholder] of Object.entries(placeholders)) {
  const line = new RegExp(`^${key}=(.*)$`, 'm');
  const match = text.match(line);
  const value = match ? match[1].trim() : '';
  if (!value || value === placeholder) {
    const secret = crypto.randomBytes(48).toString('hex');
    text = match ? text.replace(line, `${key}=${secret}`) : `${text.trimEnd()}\n${key}=${secret}\n`;
    console.log(`    ✓ Generated ${key}`);
  }
}
fs.writeFileSync(file, text);
NODE
PORT="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "$ENV_FILE" | head -n 1)"
PORT="${PORT:-5001}"
MONGO_URI="$(sed -n 's/^MONGO_URI=//p' "$ENV_FILE" | head -n 1)"
ok "Settings ready (port $PORT)"

# --- 3. MongoDB -------------------------------------------------------------
step "Checking MongoDB"
mongo_up() { nc -z 127.0.0.1 27017 >/dev/null 2>&1; }
case "$MONGO_URI" in
  *127.0.0.1*|*localhost*)
    if mongo_up; then
      ok "MongoDB is running"
    else
      MONGO_FORMULA=""
      if command -v brew >/dev/null 2>&1; then
        MONGO_FORMULA="$(brew list --formula 2>/dev/null | grep -E '^mongodb-community(@[0-9.]+)?$' | head -n 1 || true)"
      fi
      if [ -n "$MONGO_FORMULA" ]; then
        brew services start "$MONGO_FORMULA" >/dev/null
        for _ in $(seq 1 20); do mongo_up && break; sleep 1; done
      fi
      if mongo_up; then
        ok "Started MongoDB ($MONGO_FORMULA). It will also start at every login."
      else
        note "MongoDB is not running yet. Start it the way you usually do;"
        note "EthosTrack keeps waiting and connects as soon as it is up."
      fi
    fi
    ;;
  *)
    ok "Using the database in backend/.env"
    ;;
esac

# --- 4. Packages and build --------------------------------------------------
step "Installing packages (the first time this can take a few minutes)"
npm install --prefix "$PROJECT_DIR/backend" --no-audit --no-fund --loglevel=error
npm install --prefix "$PROJECT_DIR/frontend" --no-audit --no-fund --loglevel=error
ok "Packages installed"

step "Building the app"
# No inline <script>: the server's Content Security Policy allows only its own files.
INLINE_RUNTIME_CHUNK=false GENERATE_SOURCEMAP=false npm run build --prefix "$PROJECT_DIR/frontend" --silent >/dev/null
ok "App built"

# --- 5. Copy to Application Support ----------------------------------------
step "Installing to ~/Library/Application Support/EthosTrack"
# Stop a running copy first so its files can be replaced.
launchctl bootout "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1 || true
mkdir -p "$DEST/frontend"
rsync -a --delete "$PROJECT_DIR/backend/" "$DEST/backend/"
rsync -a --delete "$PROJECT_DIR/frontend/build/" "$DEST/frontend/build/"
ok "Copied"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "Port $PORT is busy. Stop \"npm run dev\" (Ctrl+C in VS Code's terminal), then run this again."
fi

# --- 6. Login item ----------------------------------------------------------
step "Turning on auto-start"
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE_BIN")</string>
    <string>$(xml "$DEST/backend/server.js")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml "$DEST/backend")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ETHOSTRACK_AUTO_OPEN</key>
    <string>1</string>
    <key>PATH</key>
    <string>/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$(xml "$LOG_FILE")</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$LOG_FILE")</string>
</dict>
</plist>
PLIST
plutil -lint "$PLIST" >/dev/null || fail "The login item file is not valid: $PLIST"
launchctl bootstrap "$GUI_DOMAIN" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
ok "EthosTrack will now start every time you log in or open the lid"

# --- 7. Check it is running -------------------------------------------------
step "Starting EthosTrack"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    ok "Running at http://localhost:$PORT. It opens in your browser in a few seconds."
    printf '\n\033[1mAll done.\033[0m Sign in once. From then on EthosTrack opens and starts\n'
    printf 'tracking by itself whenever you open the laptop.\n'
    printf 'macOS may show "Background Items Added". That is this login item.\n\n'
    exit 0
  fi
  sleep 1
done
note "EthosTrack is installed but has not answered yet."
note "If MongoDB is not running, start it; EthosTrack connects by itself."
note "Details are in $LOG_FILE"
