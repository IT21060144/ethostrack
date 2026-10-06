/**
 * studyLogController — Daily Study Log & CSV Export (Phase 4/5)
 * ---------------------------------------------------------------------------
 * Turns the automatically recorded heartbeat sessions into one row per day,
 * using the same columns as the research dataset (study_session_data.csv):
 *   date, day_of_week, login_time, logout_time, hours_spent, num_sessions,
 *   break_count, break_duration_minutes, goal_hours, goal_met,
 *   current_streak_days
 *
 * PRIVACY BOUNDARY
 * ----------------
 * The log is built from Behavioral Zone data only (StudySession + StudyGoal by
 * pseudoId). Identity columns from the research CSV (student_id,
 * student_name) are deliberately absent: the export a student downloads holds
 * their own behavior and nothing that names them. Self-reported columns
 * (subject, mood, productivity) cannot be measured by a browser, so they are
 * not invented here.
 */
const StudySession = require('../models/StudySession');
const StudyGoal = require('../models/StudyGoal');
const HttpError = require('../utils/HttpError');
const { resolvePseudoId } = require('../utils/pseudonym');
const { toLocalParts, addDays } = require('./scoreController');
const { SESSION_TIMEOUT_SECONDS } = require('./trackingController');
const { isValidTimeZone, syncTimeZone } = require('../utils/timeZone');

const MAX_DAYS = 365;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const CSV_COLUMNS = [
  'date',
  'day_of_week',
  'login_time',
  'logout_time',
  'hours_spent',
  'num_sessions',
  'break_count',
  'break_duration_minutes',
  'goal_hours',
  'goal_met',
  'current_streak_days',
];

const pad = (n) => String(n).padStart(2, '0');

function localClock(date, timeZone) {
  const { hour } = toLocalParts(date, timeZone);
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60 + 1e-6);
  return `${pad(h)}:${pad(m)}`;
}

function parseDays(raw) {
  if (raw === undefined) return 30;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new HttpError(400, `days must be a whole number from 1 to ${MAX_DAYS}`);
  }
  return days;
}

/**
 * Builds the daily rows, newest first. A session belongs to the local day it
 * started on. While a session is still open its logout_time is the latest
 * heartbeat, so the row grows live as the student studies.
 */
async function buildStudyLog(pseudoId, days, deviceTimeZone) {
  // The browser's own zone wins, so times match the student's clock
  if (isValidTimeZone(deviceTimeZone)) await syncTimeZone(pseudoId, deviceTimeZone);
  const goals = await StudyGoal.findOne({ pseudoId }).lean();
  const timeZone = isValidTimeZone(deviceTimeZone) ? deviceTimeZone : goals?.timezone || 'UTC';
  const now = Date.now();
  const today = toLocalParts(new Date(), timeZone).dateKey;
  const firstDay = addDays(today, -(days - 1));

  // Pad the UTC range by a day either side so every time zone is covered.
  const sessions = await StudySession.find({
    pseudoId,
    loginTime: { $gte: new Date(`${addDays(firstDay, -1)}T00:00:00Z`) },
  })
    .select('loginTime logoutTime lastHeartbeat activeSeconds idleSeconds -_id')
    .sort({ loginTime: 1 })
    .lean();

  const byDay = new Map();
  for (const s of sessions) {
    const start = new Date(s.loginTime);
    const end = new Date(s.logoutTime || s.lastHeartbeat || s.loginTime);
    // Still open and heard from recently = studying right now. An open session
    // that went quiet (tab closed, laptop asleep) is shown as ended at its
    // last heartbeat, which is where the server will close it.
    const ongoing = !s.logoutTime && (now - end.getTime()) / 1000 <= SESSION_TIMEOUT_SECONDS;
    const { dateKey } = toLocalParts(start, timeZone);
    if (dateKey < firstDay || dateKey > today) continue;

    const day = byDay.get(dateKey) || {
      first: start,
      last: end,
      activeSeconds: 0,
      idleSeconds: 0,
      sessions: 0,
      breaks: 0,
      ongoing: false,
    };
    if (start < day.first) day.first = start;
    if (end > day.last) day.last = end;
    day.activeSeconds += s.activeSeconds || 0;
    day.idleSeconds += s.idleSeconds || 0;
    day.sessions += 1;
    if ((s.idleSeconds || 0) > 0) day.breaks += 1;
    if (ongoing) day.ongoing = true;
    byDay.set(dateKey, day);
  }

  const goalHours = goals?.plannedMinutesPerDay ? Math.round((goals.plannedMinutesPerDay / 60) * 100) / 100 : null;

  // Walk forward through every day so the streak can be counted, then reverse.
  const rows = [];
  let streak = 0;
  for (let i = 0; i < days; i += 1) {
    const dateKey = addDays(firstDay, i);
    const day = byDay.get(dateKey);
    const hours = day ? Math.round((day.activeSeconds / 3600) * 100) / 100 : 0;
    streak = hours > 0 ? streak + 1 : 0;

    rows.push({
      date: dateKey,
      day_of_week: DAY_NAMES[new Date(`${dateKey}T00:00:00Z`).getUTCDay()],
      login_time: day ? localClock(day.first, timeZone) : '',
      // While a session is in progress there is no end time yet
      logout_time: day && !day.ongoing ? localClock(day.last, timeZone) : '',
      last_activity_time: day ? localClock(day.last, timeZone) : '',
      hours_spent: hours,
      num_sessions: day ? day.sessions : 0,
      break_count: day ? day.breaks : 0,
      break_duration_minutes: day ? Math.round(day.idleSeconds / 60) : 0,
      goal_hours: goalHours,
      goal_met: goalHours === null ? null : hours >= goalHours,
      current_streak_days: streak,
      ongoing: day ? day.ongoing : false,
    });
  }

  rows.reverse();

  const totals = {
    hours: Math.round(rows.reduce((acc, r) => acc + r.hours_spent, 0) * 100) / 100,
    studyDays: rows.filter((r) => r.hours_spent > 0).length,
    sessions: rows.reduce((acc, r) => acc + r.num_sessions, 0),
  };
  return { timeZone, rows, totals };
}

/** GET /api/tracking/log?days=30&tz=Asia/Colombo */
async function getStudyLog(req, res, next) {
  try {
    const days = parseDays(req.query.days);
    const pseudoId = await resolvePseudoId(req.user?.id);
    const log = await buildStudyLog(pseudoId, days, req.query.tz);
    return res.status(200).json({ success: true, days, ...log });
  } catch (error) {
    return next(error);
  }
}

const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'boolean' ? (value ? 'True' : 'False') : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * GET /api/tracking/log.csv?days=30&tz=Asia/Colombo — same rows as a CSV.
 * Times are local to tz; a session still in progress has an empty logout_time.
 */
async function exportStudyLogCsv(req, res, next) {
  try {
    const days = parseDays(req.query.days);
    const pseudoId = await resolvePseudoId(req.user?.id);
    const { rows } = await buildStudyLog(pseudoId, days, req.query.tz);
    const lines = [CSV_COLUMNS.join(',')];
    for (const row of rows) {
      lines.push(CSV_COLUMNS.map((col) => csvCell(row[col])).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="my_study_log.csv"');
    return res.status(200).send(`${lines.join('\n')}\n`);
  } catch (error) {
    return next(error);
  }
}

/**
 * PUT /api/tracking/goal  { goalHours }
 * Sets the student's daily study goal (stored as plannedMinutesPerDay on
 * StudyGoal, Behavioral Zone). Used for goal_hours / goal_met and for the
 * Adherence part of the consistency score.
 */
async function updateDailyGoal(req, res, next) {
  try {
    const goalHours = Number(req.body?.goalHours);
    if (!Number.isFinite(goalHours) || goalHours <= 0 || goalHours > 24) {
      throw new HttpError(400, 'goalHours must be a number between 0 and 24');
    }
    const pseudoId = await resolvePseudoId(req.user?.id);
    const goal = await StudyGoal.findOneAndUpdate(
      { pseudoId },
      { $set: { plannedMinutesPerDay: Math.round(goalHours * 60) } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    return res.status(200).json({ success: true, goalHours: goal.plannedMinutesPerDay / 60 });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getStudyLog, exportStudyLogCsv, updateDailyGoal, buildStudyLog, CSV_COLUMNS };
