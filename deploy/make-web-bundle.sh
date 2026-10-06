#!/usr/bin/env bash
# make-web-bundle.sh — builds EthosTrack-web.zip, one folder a web host can run
# ---------------------------------------------------------------------------
# The zip holds backend/ (no .env, no node_modules) and the built React app
# in frontend/build/, plus a package.json whose "npm start" runs the server.
# One Node process then serves both the website and the API from one address.
# Secrets and the database address are NOT in the zip: the host supplies
# them as environment variables (see deploy/DEPLOY.md).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:-$PROJECT_DIR/deploy}"
WORK="$(mktemp -d)"
BUNDLE="$WORK/EthosTrack-web"
trap 'rm -rf "$WORK"' EXIT

echo "Building the React app..."
npm install --prefix "$PROJECT_DIR/frontend" --silent
npm run build --prefix "$PROJECT_DIR/frontend" --silent

echo "Assembling the bundle..."
mkdir -p "$BUNDLE/backend" "$BUNDLE/frontend"
tar -C "$PROJECT_DIR/backend" --exclude node_modules --exclude .env -cf - . | tar -C "$BUNDLE/backend" -xf -
cp -R "$PROJECT_DIR/frontend/build" "$BUNDLE/frontend/build"
cp "$PROJECT_DIR/deploy/DEPLOY.md" "$BUNDLE/DEPLOY.md"

# package.json at the top of the bundle: the backend's dependencies, and a
# start command, so "npm install" then "npm start" is all a host needs.
node -e '
const backend = require(process.argv[1]);
const pkg = {
  name: "ethostrack-web",
  version: backend.version,
  private: true,
  description: "EthosTrack: website and API in one Node server",
  main: "backend/server.js",
  scripts: { start: "node backend/server.js" },
  engines: { node: ">=18" },
  dependencies: backend.dependencies,
};
require("fs").writeFileSync(process.argv[2], JSON.stringify(pkg, null, 2) + "\n");
' "$PROJECT_DIR/backend/package.json" "$BUNDLE/package.json"

# cPanel "Setup Node.js App" asks for a startup file at the top level.
cat > "$BUNDLE/app.js" <<'JS'
// Startup file for hosts that ask for one (e.g. cPanel "Setup Node.js App").
require('./backend/server.js').run();
JS

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/EthosTrack-web.zip"
(cd "$WORK" && zip -qr "$OUT_DIR/EthosTrack-web.zip" EthosTrack-web)
echo "Done: $OUT_DIR/EthosTrack-web.zip"
