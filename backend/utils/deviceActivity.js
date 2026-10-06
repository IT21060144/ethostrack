/**
 * deviceActivity.js — "was the Mac used recently?" for the local server
 * ---------------------------------------------------------------------------
 * A browser tab only sees input while it is the tab in front. To keep
 * tracking while the student works in another tab or app, the server (which
 * runs on the student's own Mac) asks macOS how long ago the keyboard, mouse
 * or trackpad was last touched: HIDIdleTime from `ioreg -c IOHIDSystem`.
 *
 * PRIVACY
 * -------
 * HIDIdleTime is a single number of nanoseconds since the last input of any
 * kind. It holds no keys, no positions, no app or page names, and it is never
 * stored: GET /api/device/activity returns it, the tab turns it into the same
 * true/false "active" flag it already sends, and only that flag is saved.
 *
 * On anything other than macOS (or if ioreg fails) it reports
 * { available: false } and the tab falls back to its own input listeners.
 */
const { execFile } = require('child_process');

const CACHE_MS = 2000;
let cached = { at: 0, value: null };

function parseIdleSeconds(ioregOutput) {
  const match = /"HIDIdleTime"\s*=\s*(\d+)/.exec(ioregOutput || '');
  return match ? Math.floor(Number(match[1]) / 1e9) : null;
}

function readIdleSeconds() {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '4'], { timeout: 3000 }, (error, stdout) => {
      resolve(error ? null : parseIdleSeconds(stdout));
    });
  });
}

// GET /api/device/activity -> { available, idleSeconds }
async function getDeviceActivity(_req, res) {
  if (Date.now() - cached.at > CACHE_MS) {
    cached = { at: Date.now(), value: await readIdleSeconds() };
  }
  const idleSeconds = cached.value;
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ available: idleSeconds !== null, idleSeconds });
}

module.exports = { getDeviceActivity, parseIdleSeconds };
