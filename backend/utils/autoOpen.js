/**
 * autoOpen.js — opens EthosTrack in the browser when the Mac starts or wakes
 * ---------------------------------------------------------------------------
 * Only active when ETHOSTRACK_AUTO_OPEN=1, which the macOS installer sets in
 * the LaunchAgent (mac/install.sh). `npm run dev` never opens tabs.
 *
 * HOW "LAPTOP OPENED" IS DETECTED
 * -------------------------------
 * - Log in / restart: launchd starts this server at login, so startup itself
 *   is the signal.
 * - Lid opened (wake from sleep): while the Mac sleeps this process is frozen.
 *   A timer ticks every few seconds; when a tick arrives much later than
 *   expected, the clock jumped, which means the Mac just woke up.
 *
 * NO DUPLICATE TABS
 * -----------------
 * An open EthosTrack tab pings GET /api/presence (see frontend/src/index.js).
 * After start or wake we wait a little; if a tab has pinged since then it
 * resumed by itself and nothing is opened. Otherwise the browser is opened on
 * the app, where the saved login starts tracking with no clicks.
 *
 * PRIVACY
 * -------
 * The presence ping carries no data at all. Only its time is kept, in memory.
 */
const { execFile } = require('child_process');
const fs = require('fs');

const TICK_MS = 5000;
const WAKE_GAP_MS = 30000; // a tick this late means the Mac slept
const GRACE_MS = 15000; // time an existing tab gets to ping before we open one

let lastPresenceAt = 0;

// Express handler for GET /api/presence
function recordPresence(_req, res) {
  lastPresenceAt = Date.now();
  res.status(204).end();
}

// Opens the URL in Firefox when it is installed, otherwise in the default browser.
function openInBrowser(url) {
  const hasFirefox = fs.existsSync('/Applications/Firefox.app');
  const args = hasFirefox ? ['-a', 'Firefox', url] : [url];
  execFile('open', args, (error) => {
    if (error) console.error('[AutoOpen] Could not open the browser:', error.message);
  });
}

/**
 * Starts the start/wake watcher. Dependencies can be swapped in tests.
 * Returns a function that stops it.
 */
function startAutoOpen({
  url,
  open = openInBrowser,
  now = Date.now,
  setIntervalFn = setInterval,
  setTimeoutFn = setTimeout,
  clearIntervalFn = clearInterval,
} = {}) {
  const openUnlessTabResumed = (reason) => {
    const triggeredAt = now();
    setTimeoutFn(() => {
      if (lastPresenceAt >= triggeredAt) {
        console.log(`[AutoOpen] ${reason}: EthosTrack tab already open`);
        return;
      }
      console.log(`[AutoOpen] ${reason}: opening ${url}`);
      open(url);
    }, GRACE_MS);
  };

  openUnlessTabResumed('Started');

  let lastTick = now();
  const intervalId = setIntervalFn(() => {
    const current = now();
    if (current - lastTick > WAKE_GAP_MS) openUnlessTabResumed('Woke from sleep');
    lastTick = current;
  }, TICK_MS);

  return () => clearIntervalFn(intervalId);
}

module.exports = { startAutoOpen, recordPresence, openInBrowser, TICK_MS, WAKE_GAP_MS, GRACE_MS };
