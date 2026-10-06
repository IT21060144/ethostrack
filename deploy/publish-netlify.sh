#!/usr/bin/env bash
# publish-netlify.sh — puts EthosTrack on Netlify from this Mac
# ---------------------------------------------------------------------------
# Run by double-clicking "Publish to Netlify.command" (or npm run netlify).
#   1. Signs in to Netlify (a browser window opens the first time).
#   2. The first time only: creates a new Netlify project for this folder.
#      It never touches any other Netlify site you already have.
#   3. Settings: asks once for the MongoDB Atlas address and makes the two
#      secret keys itself. A key that already exists is never replaced:
#      changing PSEUDONYM_SECRET would cut every student off from their data.
#   4. Builds the app and publishes it (netlify.toml has the details), then
#      opens the new website.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

if ! command -v npx >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org (LTS), then try again."
  exit 1
fi

NETLIFY=(npx --yes netlify-cli@27)

echo
echo "== Step 1 of 4: Signing in to Netlify =="
echo "If a browser window opens, log in and click Authorize, then come back here."
"${NETLIFY[@]}" login

echo
echo "== Step 2 of 4: Connecting this folder to a Netlify project =="
if [ -f .netlify/state.json ] && grep -q '"siteId"' .netlify/state.json; then
  echo "Already connected."
else
  echo "Creating a NEW Netlify project for EthosTrack (your other sites are not changed)."
  echo "Pick your team with the arrow keys and Enter, then type a name such as ethostrack-inoka."
  "${NETLIFY[@]}" sites:create
fi

echo
echo "== Step 3 of 4: Settings =="
EXISTING="$("${NETLIFY[@]}" env:list --context production --json 2>/dev/null || true)"
has_setting() {
  node -e '
    const text = process.argv[1] || "";
    const start = text.indexOf("{");
    let vars = {};
    try { vars = JSON.parse(start >= 0 ? text.slice(start) : "{}"); } catch (e) {}
    process.exit(Object.prototype.hasOwnProperty.call(vars, process.argv[2]) ? 0 : 1);
  ' "$EXISTING" "$1"
}
new_secret() {
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
}

if has_setting MONGO_URI; then
  echo "Database address: already set."
else
  echo "Paste your MongoDB Atlas address (it starts with mongodb+srv://) and press Enter:"
  read -r MONGO_URI_VALUE
  case "$MONGO_URI_VALUE" in
    mongodb+srv://*|mongodb://*) ;;
    *) echo "That does not look like a MongoDB address. Nothing was changed; please run this again."; exit 1 ;;
  esac
  # Atlas copies the address with a <db_password> placeholder; fill it in
  # here (URL-encoded) so nobody has to edit the address by hand.
  if [[ "$MONGO_URI_VALUE" == *"<db_password>"* || "$MONGO_URI_VALUE" == *"<password>"* ]]; then
    echo "Type your database password and press Enter (it stays hidden while you type):"
    read -r -s DB_PASSWORD
    echo
    MONGO_URI_VALUE="$(node -e '
      const [uri, pw] = process.argv.slice(1);
      const enc = encodeURIComponent(pw);
      process.stdout.write(uri.replace("<db_password>", enc).replace("<password>", enc));
    ' "$MONGO_URI_VALUE" "$DB_PASSWORD")"
  fi
  # Atlas addresses name no database ("...mongodb.net/?..."); use "ethostrack"
  # rather than MongoDB's default "test".
  MONGO_URI_VALUE="$(node -e '
    process.stdout.write(process.argv[1].replace(/(\.mongodb\.net)\/?(\?|$)/, "$1/ethostrack$2"));
  ' "$MONGO_URI_VALUE")"
  "${NETLIFY[@]}" env:set MONGO_URI "$MONGO_URI_VALUE" >/dev/null
  echo "Database address: saved."
fi

for KEY in JWT_SECRET PSEUDONYM_SECRET; do
  if has_setting "$KEY"; then
    echo "$KEY: already set (kept as is)."
  else
    "${NETLIFY[@]}" env:set "$KEY" "$(new_secret)" >/dev/null
    echo "$KEY: created."
  fi
done

echo
echo "== Step 4 of 4: Building and publishing (this takes a minute or two) =="
"${NETLIFY[@]}" deploy --build --prod

echo
echo "Done. Opening your EthosTrack website..."
"${NETLIFY[@]}" open:site || true
