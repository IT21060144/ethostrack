/**
 * differentialPrivacy — Laplace mechanism for cohort statistics
 * ---------------------------------------------------------------------------
 * Proposal Section 11.3: "Aggregate statistics, such as mean weekly study time
 * of a cohort, are released with Laplace noise calibrated to the query's
 * sensitivity and a configurable privacy budget epsilon."
 *
 * THE IDEA IN ONE PARAGRAPH
 * -------------------------
 * A query's sensitivity is the most its answer can change when one student is
 * added to or removed from the data. Adding noise drawn from Laplace(0,
 * sensitivity / epsilon) makes the published answer almost equally likely
 * whether or not any one student took part, so the output reveals very little
 * about any individual. Smaller epsilon = more noise = stronger privacy.
 *
 * HOW THE BUDGET IS SPENT
 * -----------------------
 * cohortAggregates() answers four queries and splits epsilon equally between
 * them (sequential composition, so the total spent is exactly epsilon):
 *   1. number of students                 sensitivity 1
 *   2. sum of weekly study minutes        sensitivity = clip (one student's
 *                                         contribution is clipped to it)
 *   3. histogram of study days per week   sensitivity 1 (one bin per student)
 *   4. histogram of usual start time      sensitivity 1 (one bin per student)
 * The mean is derived from the noisy sum and the noisy count, which costs no
 * extra budget (post-processing). If the group has fewer than k students (or
 * the noisy count is below k) the whole release is suppressed, because
 * statistics about tiny groups are risky even with noise (proposal Section 21).
 */
const crypto = require('crypto');
const { toLocalParts } = require('../controllers/scoreController');

const PARTS_OF_DAY = Object.freeze([
  { key: 'night', from: 0, to: 6 },
  { key: 'morning', from: 6, to: 12 },
  { key: 'afternoon', from: 12, to: 18 },
  { key: 'evening', from: 18, to: 24 },
]);

// A cryptographically secure uniform number in the open interval (0, 1).
// Math.random() is predictable, which would let someone strip the noise.
function secureUniform() {
  const max = 2 ** 48;
  return crypto.randomInt(1, max) / max;
}

/** One draw from Laplace(0, scale) by inverting its cumulative distribution. */
function laplaceNoise(scale, rng = secureUniform) {
  if (!(scale >= 0)) throw new Error('scale must be zero or positive');
  const u = rng() - 0.5; // in (-0.5, 0.5)
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

function checkEpsilon(epsilon) {
  if (!Number.isFinite(epsilon) || epsilon <= 0) throw new Error('epsilon must be a positive number');
}

/** count + Laplace(1 / epsilon) */
function noisyCount(trueCount, epsilon, rng) {
  checkEpsilon(epsilon);
  return trueCount + laplaceNoise(1 / epsilon, rng);
}

/** sum of values clipped to [0, clip] + Laplace(clip / epsilon) */
function noisySum(values, clip, epsilon, rng) {
  checkEpsilon(epsilon);
  const total = values.reduce((acc, v) => acc + Math.min(clip, Math.max(0, v)), 0);
  return total + laplaceNoise(clip / epsilon, rng);
}

/**
 * Histogram where each student falls in exactly one bin. Adding or removing a
 * student changes one bin by 1, so every bin gets Laplace(1 / epsilon) noise
 * (parallel composition: the bins share the same epsilon).
 */
function noisyHistogram(binOfEachStudent, binKeys, epsilon, rng) {
  checkEpsilon(epsilon);
  const counts = Object.fromEntries(binKeys.map((k) => [k, 0]));
  for (const bin of binOfEachStudent) {
    if (bin in counts) counts[bin] += 1;
  }
  const noisy = {};
  for (const key of binKeys) {
    // Rounding and clamping at 0 are post-processing; they cost no privacy.
    noisy[key] = Math.max(0, Math.round(counts[key] + laplaceNoise(1 / epsilon, rng)));
  }
  return noisy;
}

function partOfDay(hour) {
  return (PARTS_OF_DAY.find((p) => hour >= p.from && hour < p.to) || PARTS_OF_DAY[0]).key;
}

/**
 * Per-student summaries over the window (true values, never released).
 * minMinutes is the same "a day counts" rule the score uses.
 */
function summariseStudents(sessions, { weeks, timeZone, minMinutes }) {
  const students = new Map();
  for (const s of sessions) {
    const { dateKey, hour } = toLocalParts(new Date(s.loginTime), timeZone);
    const st = students.get(s.pseudoId) || { minutes: 0, days: new Map(), parts: {} };
    const minutes = (s.activeSeconds || 0) / 60;
    st.minutes += minutes;
    st.days.set(dateKey, (st.days.get(dateKey) || 0) + minutes);
    const part = partOfDay(hour);
    st.parts[part] = (st.parts[part] || 0) + 1;
    students.set(s.pseudoId, st);
  }
  return [...students.values()].map((st) => {
    const studyDays = [...st.days.values()].filter((m) => m >= minMinutes).length;
    const usualPart = Object.entries(st.parts).sort((a, b) => b[1] - a[1])[0][0];
    return {
      weeklyMinutes: st.minutes / weeks,
      daysPerWeek: Math.min(7, Math.round(studyDays / weeks)),
      usualPart,
    };
  });
}

/**
 * cohortAggregates(sessions, options) -> differentially private statistics
 *   options.epsilon      total privacy budget (default 1)
 *   options.weeks        length of the window the sessions cover
 *   options.k            suppress the release if the noisy cohort is below k
 *   options.clipMinutes  per-student cap on weekly minutes (default 1200 = 20 h)
 *   options.minMinutes   minimum minutes for a day to count (default 30)
 *   options.timeZone     zone used for days and start times
 *   options.rng          uniform (0,1) source; tests pass a fixed one
 */
function cohortAggregates(sessions, {
  epsilon = 1,
  weeks = 4,
  k = 5,
  clipMinutes = 1200,
  minMinutes = 30,
  timeZone = 'UTC',
  rng = secureUniform,
} = {}) {
  checkEpsilon(epsilon);
  const perQuery = epsilon / 4;
  const students = summariseStudents(sessions, { weeks, timeZone, minMinutes });

  const privacy = {
    mechanism: 'Laplace',
    epsilon,
    epsilonPerQuery: perQuery,
    queries: 4,
    clipMinutesPerWeek: clipMinutes,
    k,
  };

  const count = noisyCount(students.length, perQuery, rng);
  // A group smaller than k is always withheld. Checking only the noisy count
  // would let a single student through about 1 time in 5 at epsilon 1, so
  // the true size is checked too (a fixed minimum group size, as used by
  // most statistics offices; it reveals only "fewer than k").
  if (students.length < k || count < k) {
    return { suppressed: true, reason: `Fewer than ${k} students in this group`, privacy };
  }

  const sum = noisySum(students.map((s) => s.weeklyMinutes), clipMinutes, perQuery, rng);
  const meanWeeklyMinutes = Math.min(clipMinutes, Math.max(0, sum / count));
  const days = noisyHistogram(students.map((s) => String(s.daysPerWeek)), ['0', '1', '2', '3', '4', '5', '6', '7'], perQuery, rng);
  const startTimes = noisyHistogram(students.map((s) => s.usualPart), PARTS_OF_DAY.map((p) => p.key), perQuery, rng);

  return {
    suppressed: false,
    students: Math.max(0, Math.round(count)),
    meanWeeklyStudyMinutes: Math.round(meanWeeklyMinutes),
    studyDaysPerWeek: days,
    usualStartTime: startTimes,
    privacy,
  };
}

/** The exact (non-private) answers, used only by the evaluation script. */
function trueAggregates(sessions, { weeks = 4, clipMinutes = 1200, minMinutes = 30, timeZone = 'UTC' } = {}) {
  const students = summariseStudents(sessions, { weeks, timeZone, minMinutes });
  const clipped = students.map((s) => Math.min(clipMinutes, Math.max(0, s.weeklyMinutes)));
  return {
    students: students.length,
    meanWeeklyStudyMinutes: students.length ? clipped.reduce((a, b) => a + b, 0) / students.length : 0,
  };
}

module.exports = {
  PARTS_OF_DAY,
  secureUniform,
  laplaceNoise,
  noisyCount,
  noisySum,
  noisyHistogram,
  partOfDay,
  cohortAggregates,
  trueAggregates,
};
