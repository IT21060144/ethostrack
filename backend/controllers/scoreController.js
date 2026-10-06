/**
 * scoreController — Consistency Scoring Framework (Phase 5)
 * ---------------------------------------------------------------------------
 * Computes the 0-100 Study Consistency Score (CS) described in Section 16 of
 * the proposal, for a weekly window or a rolling four-week window.
 *
 * PRIVACY BOUNDARY
 * ----------------
 * 1. The authenticated request carries only the account id (req.user.id),
 *    which belongs to the Identity Zone.
 * 2. We turn that id into a keyed hash (HMAC-SHA256 with PSEUDONYM_SECRET) and
 *    look the hash up in PseudonymMap. That is the ONLY place identity and
 *    behavior meet, and only the server holds the key, so a leaked
 *    StudySession or StudyGoal collection cannot be re-linked to accounts.
 * 3. Every query after that uses pseudoId alone. This controller never reads
 *    the User collection, and the response contains no identifiers at all
 *    (not even the pseudoId), only the student's own metrics.
 */
const StudySession = require('../models/StudySession');
const StudyGoal = require('../models/StudyGoal');
const HttpError = require('../utils/HttpError');
const { resolvePseudoId } = require('../utils/pseudonym');

// ---------------------------------------------------------------------------
// Configuration (proposal Section 16.3 starting values)
// ---------------------------------------------------------------------------
const WEIGHTS = Object.freeze({ R: 0.35, A: 0.3, S: 0.2, H: 0.15 });
const RHYTHM_TOLERANCE_HOURS = 4; // tau
const ROLLING_WEEKS = 4;
const DAYS_PER_WEEK = 7;

const DEFAULT_TARGET_DAYS = Number(process.env.DEFAULT_TARGET_DAYS) || 4;
const DEFAULT_MIN_MINUTES = Number(process.env.DEFAULT_MIN_MINUTES) || 30;

const BANDS = Object.freeze([
  { min: 70, key: 'consistent', label: 'Consistent', message: 'Your routine is steady' },
  { min: 40, key: 'developing', label: 'Developing', message: 'Your routine is taking shape' },
  { min: 0, key: 'building', label: 'Building', message: 'Your study pattern is still forming' },
]);

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Statistics helpers (plain JavaScript Math)
// ---------------------------------------------------------------------------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sum = (xs) => xs.reduce((acc, x) => acc + x, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : 0);

function stdDev(xs) {
  if (xs.length === 0) return 0;
  const mu = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)));
}

const round = (x, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

// ---------------------------------------------------------------------------
// Calendar helpers.
// ---------------------------------------------------------------------------
const formatterCache = new Map();
function localFormatter(timeZone) {
  if (!formatterCache.has(timeZone)) {
    formatterCache.set(
      timeZone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      })
    );
  }
  return formatterCache.get(timeZone);
}

function toLocalParts(date, timeZone) {
  const parts = {};
  for (const { type, value } of localFormatter(timeZone).formatToParts(date)) {
    parts[type] = value;
  }
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) + Number(parts.minute) / 60 + Number(parts.second) / 3600,
  };
}

function addDays(dateKey, n) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mondayOf(dateKey) {
  const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return addDays(dateKey, -((dow + 6) % 7));
}

function buildWindow({ window = 'week', date, timeZone, now = new Date() }) {
  const anchor = date || toLocalParts(now, timeZone).dateKey;
  if (!DATE_KEY.test(anchor) || Number.isNaN(Date.parse(`${anchor}T00:00:00Z`))) {
    throw new HttpError(400, 'date must be a valid YYYY-MM-DD value');
  }

  let start;
  let weeks;
  if (window === 'week') {
    start = mondayOf(anchor);
    weeks = 1;
  } else if (window === 'rolling') {
    start = addDays(anchor, -(ROLLING_WEEKS * DAYS_PER_WEEK - 1));
    weeks = ROLLING_WEEKS;
  } else {
    throw new HttpError(400, "window must be 'week' or 'rolling'");
  }

  const days = Array.from({ length: weeks * DAYS_PER_WEEK }, (_, i) => addDays(start, i));
  return { type: window, start, end: days[days.length - 1], days, weeks };
}

// ---------------------------------------------------------------------------
// Data access (Behavioral Zone only)
// ---------------------------------------------------------------------------
async function fetchSessions(pseudoId, windowInfo) {
  const from = new Date(`${addDays(windowInfo.start, -1)}T00:00:00Z`);
  const to = new Date(`${addDays(windowInfo.end, 2)}T00:00:00Z`);
  return StudySession.find({ pseudoId, loginTime: { $gte: from, $lt: to } })
    .select('loginTime activeSeconds -_id')
    .sort({ loginTime: 1 })
    .lean();
}

// ---------------------------------------------------------------------------
// Pure scoring logic
// ---------------------------------------------------------------------------
function aggregateDays(sessions, windowDays, timeZone) {
  const inWindow = new Set(windowDays);
  const days = new Map();
  for (const s of sessions) {
    const { dateKey, hour } = toLocalParts(new Date(s.loginTime), timeZone);
    if (!inWindow.has(dateKey)) continue;
    const day = days.get(dateKey) || { activeMinutes: 0, firstLoginHour: hour };
    day.activeMinutes += (s.activeSeconds || 0) / 60;
    day.firstLoginHour = Math.min(day.firstLoginHour, hour);
    days.set(dateKey, day);
  }
  return days;
}

function regularity(studyDayCount, targetDays) {
  return targetDays > 0 ? clamp01(studyDayCount / targetDays) : 0;
}

function adherence(totalActiveMinutes, targetDays, plannedMinutes) {
  const planned = targetDays * plannedMinutes;
  return planned > 0 ? clamp01(totalActiveMinutes / planned) : 0;
}

function stability(studyDayMinutes) {
  if (studyDayMinutes.length < 2) return 0;
  const mu = mean(studyDayMinutes);
  if (mu === 0) return 0;
  const cv = stdDev(studyDayMinutes) / mu;
  return clamp01(1 - cv);
}

function rhythm(firstLoginHours) {
  if (firstLoginHours.length < 2) return 0;
  const deviation = stdDev(firstLoginHours);
  return clamp01(1 - (deviation / RHYTHM_TOLERANCE_HOURS));
}

// weights defaults to the proposal's values; the evaluation script passes
// others to test each component's contribution (ablation).
function calculateMetrics({ dailySummary, goals, weeks, windowDays, weights = WEIGHTS }) {
  // t is a per-week goal, so scale it to the window (1 week or 4 weeks)
  const t = (goals?.targetDaysPerWeek ?? DEFAULT_TARGET_DAYS) * weeks;
  const p = goals?.plannedMinutesPerDay ?? 0;
  const m = goals?.minMinutesPerDay ?? DEFAULT_MIN_MINUTES;
  const restDaysSet = new Set(goals?.restDays || []);

  const activeDays = [];
  for (const dayKey of windowDays) {
    if (restDaysSet.has(dayKey)) continue; 
    const dayData = dailySummary.get(dayKey) || { activeMinutes: 0, firstLoginHour: null };
    activeDays.push(dayData);
  }

  const studyDays = activeDays.filter(d => d.activeMinutes >= m);
  const studyDayMinutes = studyDays.map(d => d.activeMinutes);
  const firstLoginHours = studyDays.filter(d => d.firstLoginHour !== null).map(d => d.firstLoginHour);
  const totalActiveMinutes = sum(activeDays.map(d => d.activeMinutes));

  const R = regularity(studyDays.length, t);
  const S = stability(studyDayMinutes);
  const H = rhythm(firstLoginHours);

  let A = 0;
  let finalScore = 0;
  const components = { R: round(R), S: round(S), H: round(H) };

  if (p > 0) {
    A = adherence(totalActiveMinutes, t, p);
    components.A = round(A);
    finalScore = 100 * (weights.R * R + weights.A * A + weights.S * S + weights.H * H);
  } else {
    const scale = 1 / (weights.R + weights.S + weights.H);
    finalScore = 100 * scale * (weights.R * R + weights.S * S + weights.H * H);
  }

  const numericScore = Math.min(100, Math.max(0, Math.round(finalScore)));
  const matchedBand = BANDS.find(b => numericScore >= b.min) || BANDS[BANDS.length - 1];

  return {
    score: numericScore,
    band: matchedBand.label,
    message: matchedBand.message,
    components,
    summary: {
      totalActiveMinutes: round(totalActiveMinutes),
      studyDaysCount: studyDays.length,
      trackedDaysCount: activeDays.length
    }
  };
}

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------
async function getDashboardMetrics(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) throw new HttpError(401, 'Unauthorized request: Token missing');

    const pseudoId = await resolvePseudoId(userId);
    const goals = await StudyGoal.findOne({ pseudoId }).lean();
    const studentTimeZone = goals?.timezone || req.query.timeZone || 'UTC';

    const windowInfo = buildWindow({ 
      window: req.query.window || 'week', 
      date: req.query.date, 
      timeZone: studentTimeZone 
    });

    const sessions = await fetchSessions(pseudoId, windowInfo);
    const dailySummary = aggregateDays(sessions, windowInfo.days, studentTimeZone);

    const metrics = calculateMetrics({
      dailySummary,
      goals,
      weeks: windowInfo.weeks,
      windowDays: windowInfo.days
    });

    // Shape expected by the React DashboardView: { success, metrics }.
    // No identifier (not even the pseudoId) is included in the response.
    return res.status(200).json({
      success: true,
      metrics: {
        window: windowInfo.type,
        start: windowInfo.start,
        end: windowInfo.end,
        timezone: studentTimeZone,
        ...metrics,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  WEIGHTS,
  getDashboardMetrics,
  calculateMetrics,
  buildWindow,
  aggregateDays,
  resolvePseudoId,
  fetchSessions,
  toLocalParts,
  addDays
};

