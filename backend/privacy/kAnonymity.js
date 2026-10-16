/**
 * kAnonymity — generalisation and k-anonymity for released study records
 * ---------------------------------------------------------------------------
 * Proposal Section 11.3: "For any exported dataset or aggregate view,
 * quasi-identifiers (time of day, subject, duration) are generalised so that
 * every group contains at least k students. Where sensitive attributes are
 * present, l-diversity is checked."
 *
 * WHAT A RELEASED ROW LOOKS LIKE
 * ------------------------------
 * One row per study session, with no pseudoId, no exact time and no idle time:
 *   period        the day, week or month the session started in
 *   start_slot    a block of hours ("08:00-11:59") instead of the login time
 *   active_band   a band of minutes ("60-119") instead of the exact duration
 *   end_reason    sensitive attribute (explicit / timeout / idle)
 * period, start_slot and active_band are the quasi-identifiers: values an
 * outsider could know about someone ("I saw her studying on Monday morning
 * for about an hour"). Rows sharing all three form an equivalence class.
 *
 * HOW k IS GUARANTEED
 * -------------------
 * 1. Generalise every row to level 0 (finest) of the hierarchy below.
 * 2. Count DISTINCT students in each class (k counts people, not sessions, so
 *    one heavy studier cannot fill a class alone).
 * 3. Classes with fewer than k students are suppressed (removed).
 * 4. If that removes more than maxSuppression of the rows, move one level up
 *    (coarser) and try again. The first level within the limit is released;
 *    if none is, the coarsest level is released with its suppression.
 * Every released class therefore holds at least k different students.
 *
 * Rows are not linked to each other (no pseudoId), so a reader cannot follow
 * one student across rows. That is a deliberate choice: k-anonymity on single
 * rows does not protect a linked trajectory.
 */
const { toLocalParts, addDays } = require('../controllers/scoreController');

// Generalisation hierarchy, finest first. Each step widens at least one
// quasi-identifier; the last steps fold days into weeks and weeks into months.
const LEVELS = Object.freeze([
  { level: 0, period: 'day', slotHours: 1, bandMinutes: 15 },
  { level: 1, period: 'day', slotHours: 2, bandMinutes: 30 },
  { level: 2, period: 'week', slotHours: 4, bandMinutes: 60 },
  { level: 3, period: 'week', slotHours: 6, bandMinutes: 120 },
  { level: 4, period: 'month', slotHours: 6, bandMinutes: 120 },
  { level: 5, period: 'month', slotHours: 12, bandMinutes: 240 },
]);

// Durations above this are one open-ended band, so a rare 7-hour session is
// not a unique value on its own.
const TOP_BAND_MINUTES = 240;

const pad = (n) => String(n).padStart(2, '0');

function mondayOf(dateKey) {
  const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return addDays(dateKey, -((dow + 6) % 7));
}

function generalisePeriod(dateKey, period) {
  if (period === 'day') return dateKey;
  if (period === 'week') return `week of ${mondayOf(dateKey)}`;
  return dateKey.slice(0, 7); // month
}

function generaliseSlot(hour, slotHours) {
  const from = Math.floor(Math.floor(hour) / slotHours) * slotHours;
  return `${pad(from)}:00-${pad(from + slotHours - 1)}:59`;
}

function generaliseBand(activeMinutes, bandMinutes) {
  if (activeMinutes >= TOP_BAND_MINUTES) return `${TOP_BAND_MINUTES}+`;
  const from = Math.floor(activeMinutes / bandMinutes) * bandMinutes;
  const to = Math.min(from + bandMinutes, TOP_BAND_MINUTES);
  return `${from}-${to - 1}`;
}

/**
 * Turns one stored session into its generalised quasi-identifiers at a level.
 * The pseudoId is kept on the internal record only to count students; it is
 * never copied into a released row.
 */
function generaliseRecord(session, levelSpec, timeZone) {
  const { dateKey, hour } = toLocalParts(new Date(session.loginTime), timeZone);
  const activeMinutes = (session.activeSeconds || 0) / 60;
  return {
    period: generalisePeriod(dateKey, levelSpec.period),
    start_slot: generaliseSlot(hour, levelSpec.slotHours),
    active_band: generaliseBand(activeMinutes, levelSpec.bandMinutes),
    end_reason: session.endReason || 'explicit',
  };
}

const classKey = (row) => `${row.period}|${row.start_slot}|${row.active_band}`;

/** Groups generalised rows into equivalence classes with their students. */
function buildClasses(sessions, levelSpec, timeZone) {
  const classes = new Map();
  for (const session of sessions) {
    const row = generaliseRecord(session, levelSpec, timeZone);
    const key = classKey(row);
    const group = classes.get(key) || { rows: [], students: new Set(), reasons: new Set() };
    group.rows.push(row);
    group.students.add(session.pseudoId);
    group.reasons.add(row.end_reason);
    classes.set(key, group);
  }
  return classes;
}

function evaluateLevel(sessions, levelSpec, k, timeZone) {
  const classes = buildClasses(sessions, levelSpec, timeZone);
  const kept = [...classes.values()].filter((g) => g.students.size >= k);
  const releasedRows = kept.reduce((n, g) => n + g.rows.length, 0);
  return {
    levelSpec,
    kept,
    totalClasses: classes.size,
    released: releasedRows,
    suppressed: sessions.length - releasedRows,
  };
}

/**
 * anonymiseSessions(sessions, options) -> { rows, report }
 *   sessions: [{ pseudoId, loginTime, activeSeconds, endReason }]
 *   options.k               minimum distinct students per class (default 5)
 *   options.maxSuppression  share of rows that may be suppressed (default 0.05)
 *   options.timeZone        IANA zone used to read local day and hour
 */
function anonymiseSessions(sessions, { k = 5, maxSuppression = 0.05, timeZone = 'UTC' } = {}) {
  if (!Number.isInteger(k) || k < 1) throw new Error('k must be a positive whole number');

  let chosen = null;
  for (const levelSpec of LEVELS) {
    const result = evaluateLevel(sessions, levelSpec, k, timeZone);
    if (!chosen || result.suppressed < chosen.suppressed) chosen = result;
    if (sessions.length === 0 || result.suppressed / sessions.length <= maxSuppression) {
      chosen = result;
      break;
    }
  }

  const rows = chosen.kept
    .flatMap((g) => g.rows)
    .sort((a, b) => classKey(a).localeCompare(classKey(b)) || a.end_reason.localeCompare(b.end_reason));

  const studentCounts = chosen.kept.map((g) => g.students.size);
  const report = {
    k,
    level: chosen.levelSpec.level,
    generalisation: {
      period: chosen.levelSpec.period,
      startSlotHours: chosen.levelSpec.slotHours,
      activeBandMinutes: chosen.levelSpec.bandMinutes,
    },
    records: sessions.length,
    released: chosen.released,
    suppressed: chosen.suppressed,
    suppressionRate: sessions.length ? round(chosen.suppressed / sessions.length, 4) : 0,
    classes: chosen.kept.length,
    // Smallest number of distinct students in any released class (>= k)
    achievedK: studentCounts.length ? Math.min(...studentCounts) : null,
    averageClassSize: chosen.kept.length ? round(chosen.released / chosen.kept.length, 2) : null,
    // l-diversity check on end_reason: fewest distinct values in any class
    lDiversity: chosen.kept.length ? Math.min(...chosen.kept.map((g) => g.reasons.size)) : null,
  };
  return { rows, report };
}

function round(x, digits) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/**
 * reidentificationRisk — simulated linkage attack (proposal Section 19).
 *
 * The attacker knows, for one session of a target, its start time and active
 * minutes (e.g. they watched the student study), and looks for matching rows
 * in a release. For each target session the chance of naming the right student
 * is 1 / (number of distinct students who match). The function returns the
 * average over all sessions, and the share that matched exactly one student.
 *
 *   levelSpec = null   raw release: exact minute and exact duration, the
 *                      baseline with no generalisation and no suppression
 *   levelSpec = LEVELS[i] with k: the k-anonymous release at that level
 */
function reidentificationRisk(sessions, { levelSpec = null, k = 1, timeZone = 'UTC' } = {}) {
  if (sessions.length === 0) return { averageRisk: 0, uniqueShare: 0 };

  const keyOf = (s) => {
    if (!levelSpec) {
      const { dateKey, hour } = toLocalParts(new Date(s.loginTime), timeZone);
      return `${dateKey}|${Math.floor(hour * 60)}|${Math.round((s.activeSeconds || 0) / 60)}`;
    }
    return classKey(generaliseRecord(s, levelSpec, timeZone));
  };

  const studentsByKey = new Map();
  for (const s of sessions) {
    const key = keyOf(s);
    if (!studentsByKey.has(key)) studentsByKey.set(key, new Set());
    studentsByKey.get(key).add(s.pseudoId);
  }

  let riskSum = 0;
  let unique = 0;
  for (const s of sessions) {
    const matches = studentsByKey.get(keyOf(s)).size;
    if (matches < k) continue; // suppressed: nothing to link to
    riskSum += 1 / matches;
    if (matches === 1) unique += 1;
  }
  return {
    averageRisk: round(riskSum / sessions.length, 4),
    uniqueShare: round(unique / sessions.length, 4),
  };
}

module.exports = {
  LEVELS,
  TOP_BAND_MINUTES,
  anonymiseSessions,
  generaliseRecord,
  generaliseSlot,
  generaliseBand,
  generalisePeriod,
  reidentificationRisk,
};
