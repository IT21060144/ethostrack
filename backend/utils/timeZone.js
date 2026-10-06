/**
 * timeZone — keeps the student's time zone in step with their own device
 * ---------------------------------------------------------------------------
 * Start and end times are shown in local time, so the server needs the
 * student's IANA time zone (for example "Asia/Colombo"). The browser reports
 * it with each heartbeat and Study Log request, and it is stored on StudyGoal
 * (Behavioral Zone, keyed by pseudoId) so scoring never reads the User record.
 */
const StudyGoal = require('../models/StudyGoal');

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (err) {
    return false;
  }
}

// Writes only when the zone actually changed (e.g. the student travelled).
async function syncTimeZone(pseudoId, tz) {
  if (!isValidTimeZone(tz)) return;
  await StudyGoal.updateOne({ pseudoId, timezone: { $ne: tz } }, { $set: { timezone: tz } });
}

module.exports = { isValidTimeZone, syncTimeZone };
