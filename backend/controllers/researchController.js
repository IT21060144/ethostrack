/**
 * researchController — the researcher's only view of behavioural data
 * ---------------------------------------------------------------------------
 * Proposal Sections 12-13: "A dedicated privacy service sits between stored
 * data and every output" and "the researcher's only view of behavioural data
 * is anonymised aggregates." These endpoints are that view. They are read-only
 * (no data entry) and need an account with role 'researcher'.
 *
 *   GET /api/research/aggregates?weeks=4&epsilon=1
 *       Cohort statistics with Laplace noise (privacy/differentialPrivacy).
 *   GET /api/research/export?weeks=4&k=5          (JSON)
 *   GET /api/research/export.csv?weeks=4&k=5      (CSV download)
 *       Session rows generalised until every group has at least k students
 *       (privacy/kAnonymity). Groups that stay too small are suppressed.
 *
 * PRIVACY BOUNDARY
 * ----------------
 * Only StudySession is read, and only the fields the privacy service needs.
 * The User and PseudonymMap collections are never touched here, and no
 * pseudoId, exact time or idle time appears in any response.
 */
const StudySession = require('../models/StudySession');
const HttpError = require('../utils/HttpError');
const { anonymiseSessions } = require('../privacy/kAnonymity');
const { cohortAggregates } = require('../privacy/differentialPrivacy');
const { isValidTimeZone } = require('../utils/timeZone');

const DEFAULT_K = Number(process.env.PRIVACY_K) || 5;
const DEFAULT_EPSILON = Number(process.env.PRIVACY_EPSILON) || 1;
const DEFAULT_TIME_ZONE = isValidTimeZone(process.env.RESEARCH_TIME_ZONE) ? process.env.RESEARCH_TIME_ZONE : 'Asia/Colombo';
const MAX_WEEKS = 26;

const EXPORT_COLUMNS = ['period', 'start_slot', 'active_band', 'end_reason'];

function parseNumber(raw, { name, fallback, min, max, integer = false }) {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new HttpError(400, `${name} must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}`);
  }
  return value;
}

/** Closed sessions that started inside the last `weeks` weeks. */
async function loadWindow(weeks) {
  const since = new Date(Date.now() - weeks * 7 * 24 * 3600 * 1000);
  return StudySession.find({ loginTime: { $gte: since }, logoutTime: { $ne: null } })
    .select('pseudoId loginTime activeSeconds endReason -_id')
    .lean();
}

/** GET /api/research/aggregates */
async function getAggregates(req, res, next) {
  try {
    const weeks = parseNumber(req.query.weeks, { name: 'weeks', fallback: 4, min: 1, max: MAX_WEEKS, integer: true });
    const epsilon = parseNumber(req.query.epsilon, { name: 'epsilon', fallback: DEFAULT_EPSILON, min: 0.05, max: 10 });
    const sessions = await loadWindow(weeks);
    const aggregates = cohortAggregates(sessions, { epsilon, weeks, k: DEFAULT_K, timeZone: DEFAULT_TIME_ZONE });
    // Statistics change on every call (fresh noise), so they must not be cached.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, weeks, timeZone: DEFAULT_TIME_ZONE, aggregates });
  } catch (error) {
    return next(error);
  }
}

async function buildExport(req) {
  const weeks = parseNumber(req.query.weeks, { name: 'weeks', fallback: 4, min: 1, max: MAX_WEEKS, integer: true });
  const k = parseNumber(req.query.k, { name: 'k', fallback: DEFAULT_K, min: 2, max: 50, integer: true });
  const sessions = await loadWindow(weeks);
  return { weeks, ...anonymiseSessions(sessions, { k, timeZone: DEFAULT_TIME_ZONE }) };
}

/** GET /api/research/export */
async function getAnonymisedExport(req, res, next) {
  try {
    const { weeks, rows, report } = await buildExport(req);
    return res.status(200).json({ success: true, weeks, timeZone: DEFAULT_TIME_ZONE, report, rows });
  } catch (error) {
    return next(error);
  }
}

/** GET /api/research/export.csv */
async function getAnonymisedExportCsv(req, res, next) {
  try {
    const { rows, report } = await buildExport(req);
    const lines = [EXPORT_COLUMNS.join(',')];
    for (const row of rows) lines.push(EXPORT_COLUMNS.map((c) => row[c]).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ethostrack_anonymised_sessions.csv"');
    res.setHeader('X-EthosTrack-Achieved-K', String(report.achievedK ?? ''));
    return res.status(200).send(`${lines.join('\n')}\n`);
  } catch (error) {
    return next(error);
  }
}

module.exports = { getAggregates, getAnonymisedExport, getAnonymisedExportCsv, EXPORT_COLUMNS };
