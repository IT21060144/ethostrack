/**
 * evaluate.js — evaluation on a synthetic cohort (proposal Sections 16.5, 19)
 * ---------------------------------------------------------------------------
 * Reads a dataset made by synthetic-pipeline/generator.py and runs the real
 * scoring and privacy code on it. Needs no database. Prints a report and, with
 * --out, writes results.json and results.md to that folder.
 *
 *   node backend/scripts/evaluate.js [--data file.json] [--out folder]
 *        [--seed 1] [--bootstrap 1000] [--trials 1000]
 *
 * What it measures
 * 1. Scoring validity: Spearman rank correlation between each student's mean
 *    weekly Consistency Score and the ground-truth consistency rank of their
 *    profile, with a 95% bootstrap confidence interval (students resampled).
 *    Per-profile score: mean, SD and 95% CI (mean +/- 1.96 SD / sqrt(n)).
 * 2. Baselines: the same correlation for total weekly hours and for streak
 *    length (mean and longest).
 * 3. Ablations: each score component removed in turn (remaining weights
 *    rescaled to sum to 1), and each tracking rule switched off in turn:
 *      idle exclusion off   idle (break) time is counted as study time
 *      timeout off          an abnormally ended session runs on until the
 *                           end of its local day (no heartbeat to stop it;
 *                           assumption stated in the report)
 *      minimum-minutes off  any session, however short, makes a study day
 *    For the tracking rules the mean absolute error of measured active time
 *    (against the generator's ground truth) is also reported.
 * 4. Privacy: the k-anonymous export (last 4 weeks) for several k, with the
 *    simulated linkage attack, and the utility loss of the differentially
 *    private mean weekly study time across epsilon values.
 *
 * All randomness here (bootstrap, Laplace draws) uses a seeded generator so
 * the numbers can be reproduced; the live API uses crypto randomness instead.
 */
const fs = require('fs');
const path = require('path');

const { calculateMetrics, aggregateDays, toLocalParts, addDays, WEIGHTS } = require('../controllers/scoreController');
const { anonymiseSessions, reidentificationRisk, LEVELS } = require('../privacy/kAnonymity');
const { cohortAggregates, trueAggregates } = require('../privacy/differentialPrivacy');

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {
    data: path.resolve(__dirname, '../../synthetic-pipeline/synthetic_dataset.json'),
    out: null,
    seed: 1,
    bootstrap: 1000,
    trials: 1000,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in args)) throw new Error(`Unknown option --${key}`);
    args[key] = ['seed', 'bootstrap', 'trials'].includes(key) ? Number(argv[i + 1]) : path.resolve(argv[i + 1]);
  }
  return args;
}

// The goal every synthetic student is scored against (they set no goals):
// 4 study days a week (DEFAULT_TARGET_DAYS), 60 planned minutes per study
// day, and 30 active minutes for a day to count (DEFAULT_MIN_MINUTES).
const GOALS = Object.freeze({ targetDaysPerWeek: 4, plannedMinutesPerDay: 60, minMinutesPerDay: 30, restDays: [] });
const K_VALUES = [2, 3, 5, 10];
const EPSILONS = [0.1, 0.25, 0.5, 1, 2, 5];
const PRIVACY_WEEKS = 4;

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------
/** Small seeded PRNG (mulberry32) returning numbers in (0, 1). */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const x = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return x === 0 ? 1 / 4294967296 : x;
  };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
function summary(xs) {
  const m = mean(xs);
  const s = sd(xs);
  const half = (1.96 * s) / Math.sqrt(xs.length);
  return { n: xs.length, mean: m, sd: s, ci95: [m - half, m + half] };
}
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Average ranks (ties share the mean rank). */
function ranks(xs) {
  const order = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    for (let k = i; k <= j; k += 1) r[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
function pearson(x, y) {
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < x.length; i += 1) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}
const spearman = (x, y) => pearson(ranks(x), ranks(y));

/** Spearman rho with a percentile bootstrap 95% CI over students. */
function spearmanWithCi(values, truth, resamples, rng) {
  const rho = spearman(values, truth);
  const boots = [];
  for (let b = 0; b < resamples; b += 1) {
    const xs = [];
    const ys = [];
    for (let i = 0; i < values.length; i += 1) {
      const j = Math.floor(rng() * values.length);
      xs.push(values[j]);
      ys.push(truth[j]);
    }
    boots.push(spearman(xs, ys));
  }
  boots.sort((a, b) => a - b);
  return { rho, ci95: [quantile(boots, 0.025), quantile(boots, 0.975)], bootstrapSd: sd(boots) };
}

// ---------------------------------------------------------------------------
// Per-student measures
// ---------------------------------------------------------------------------
function weeksOf(firstDay, totalWeeks) {
  return Array.from({ length: totalWeeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(firstDay, w * 7 + d)));
}

/** Mean weekly score over the semester for one student's sessions. */
function meanWeeklyScore(sessions, weeks, timeZone, { weights = WEIGHTS, goals = GOALS } = {}) {
  const scores = weeks.map((days) => {
    const daily = aggregateDays(sessions, days, timeZone);
    return calculateMetrics({ dailySummary: daily, goals, weeks: 1, windowDays: days, weights }).score;
  });
  return mean(scores);
}

/** Total hours per week and streaks of consecutive study days (>= m minutes). */
function baselines(sessions, allDays, timeZone, minMinutes) {
  const minutesByDay = new Map();
  for (const s of sessions) {
    const { dateKey } = toLocalParts(new Date(s.loginTime), timeZone);
    minutesByDay.set(dateKey, (minutesByDay.get(dateKey) || 0) + s.activeSeconds / 60);
  }
  const totalMinutes = [...minutesByDay.values()].reduce((a, b) => a + b, 0);
  const streaks = [];
  let run = 0;
  for (const day of allDays) {
    if ((minutesByDay.get(day) || 0) >= minMinutes) run += 1;
    else {
      if (run) streaks.push(run);
      run = 0;
    }
  }
  if (run) streaks.push(run);
  return {
    weeklyHours: totalMinutes / 60 / (allDays.length / 7),
    longestStreak: streaks.length ? Math.max(...streaks) : 0,
    meanStreak: streaks.length ? mean(streaks) : 0,
  };
}

// ---------------------------------------------------------------------------
// Tracking-rule ablations: what the stored sessions would have looked like
// ---------------------------------------------------------------------------
const TRACKING_ABLATIONS = {
  none: { label: 'All rules on (as built)', transform: (s) => s },
  idle: {
    label: 'Idle exclusion off (breaks counted as study)',
    transform: (s) => ({ ...s, activeSeconds: s.activeSeconds + s.idleSeconds }),
  },
  timeout: {
    label: 'Timeout off (lost sessions run to the end of the day)',
    transform: (s, timeZone) => {
      if (s.endReason !== 'timeout') return s;
      const { hour } = toLocalParts(new Date(s.logoutTime), timeZone);
      const toMidnight = Math.max(0, (24 - hour) * 3600);
      return { ...s, activeSeconds: s.activeSeconds + Math.round(toMidnight) };
    },
  },
  minMinutes: { label: 'Minimum-minutes rule off (any session is a study day)', transform: (s) => s, goals: { ...GOALS, minMinutesPerDay: 1 } },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function run(args) {
  const data = JSON.parse(fs.readFileSync(args.data, 'utf8'));
  const timeZone = data.metadata.timezone || 'Asia/Colombo';
  const totalWeeks = data.metadata.weeks;
  const rng = seededRandom(args.seed);

  const sessionsByStudent = new Map(data.cohort.map((st) => [st.pseudo_id, []]));
  for (const s of data.sessions) sessionsByStudent.get(s.pseudoId).push(s);

  // The semester's local days, Monday-aligned weeks ending at the last session
  const lastDay = toLocalParts(new Date(data.sessions[data.sessions.length - 1].loginTime), timeZone).dateKey;
  const lastMonday = addDays(lastDay, -((new Date(`${lastDay}T00:00:00Z`).getUTCDay() + 6) % 7));
  const firstDay = addDays(lastMonday, -7 * (totalWeeks - 1));
  const weeks = weeksOf(firstDay, totalWeeks);
  const allDays = weeks.flat();

  const students = data.cohort.map((st) => ({ ...st, sessions: sessionsByStudent.get(st.pseudo_id) }));
  // Higher = more consistent, so a positive correlation is good
  const truth = students.map((st) => -st.expected_rank);

  // 1-2. Scores and baselines
  const scores = students.map((st) => meanWeeklyScore(st.sessions, weeks, timeZone));
  const base = students.map((st) => baselines(st.sessions, allDays, timeZone, GOALS.minMinutesPerDay));

  const validity = {
    consistencyScore: spearmanWithCi(scores, truth, args.bootstrap, rng),
    baselines: {
      weeklyHours: spearmanWithCi(base.map((b) => b.weeklyHours), truth, args.bootstrap, rng),
      longestStreak: spearmanWithCi(base.map((b) => b.longestStreak), truth, args.bootstrap, rng),
      meanStreak: spearmanWithCi(base.map((b) => b.meanStreak), truth, args.bootstrap, rng),
    },
  };

  const profiles = {};
  for (const name of data.metadata.profiles) {
    const idx = students.map((st, i) => (st.profile === name ? i : -1)).filter((i) => i >= 0);
    profiles[name] = {
      expectedRank: students[idx[0]].expected_rank,
      score: summary(idx.map((i) => scores[i])),
      weeklyHours: summary(idx.map((i) => base[i].weeklyHours)),
      longestStreak: summary(idx.map((i) => base[i].longestStreak)),
    };
  }

  // 3a. Component ablations
  const componentAblations = {};
  for (const drop of ['R', 'A', 'S', 'H']) {
    const kept = Object.fromEntries(Object.entries(WEIGHTS).map(([k, w]) => [k, k === drop ? 0 : w]));
    const total = Object.values(kept).reduce((a, b) => a + b, 0);
    const weights = Object.fromEntries(Object.entries(kept).map(([k, w]) => [k, w / total]));
    const ablated = students.map((st) => meanWeeklyScore(st.sessions, weeks, timeZone, { weights }));
    componentAblations[drop] = { weights, ...spearmanWithCi(ablated, truth, args.bootstrap, rng) };
  }

  // 3b. Tracking-rule ablations
  const trackingAblations = {};
  for (const [key, ab] of Object.entries(TRACKING_ABLATIONS)) {
    const errors = [];
    const ablated = students.map((st) => {
      const changed = st.sessions.map((s) => {
        const t = ab.transform(s, timeZone);
        errors.push(Math.abs(t.activeSeconds - s.activeSeconds) / Math.max(1, s.activeSeconds));
        return t;
      });
      return meanWeeklyScore(changed, weeks, timeZone, { goals: ab.goals || GOALS });
    });
    trackingAblations[key] = {
      label: ab.label,
      ...spearmanWithCi(ablated, truth, args.bootstrap, rng),
      // The minimum-minutes rule decides which days count, not how long a
      // session was, so it has no active-time error to report.
      activeTimeError: key === 'minMinutes' ? null : summary(errors),
    };
  }

  // 4a. k-anonymity on the last PRIVACY_WEEKS weeks
  const windowStart = `${addDays(lastDay, -7 * PRIVACY_WEEKS + 1)}T00:00:00Z`;
  const recent = data.sessions.filter((s) => s.loginTime >= windowStart);
  const rawRisk = reidentificationRisk(recent, { timeZone });
  const kAnonymity = K_VALUES.map((k) => {
    const { report } = anonymiseSessions(recent, { k, timeZone });
    const risk = reidentificationRisk(recent, { levelSpec: LEVELS[report.level], k, timeZone });
    return { ...report, risk };
  });

  // 4b. Differential privacy utility across epsilon
  const truthAgg = trueAggregates(recent, { weeks: PRIVACY_WEEKS, timeZone });
  const dp = EPSILONS.map((epsilon) => {
    const absErr = [];
    const relErr = [];
    const countErr = [];
    let suppressed = 0;
    for (let t = 0; t < args.trials; t += 1) {
      const r = cohortAggregates(recent, { epsilon, weeks: PRIVACY_WEEKS, timeZone, rng });
      if (r.suppressed) {
        suppressed += 1;
        continue;
      }
      absErr.push(Math.abs(r.meanWeeklyStudyMinutes - truthAgg.meanWeeklyStudyMinutes));
      relErr.push(Math.abs(r.meanWeeklyStudyMinutes - truthAgg.meanWeeklyStudyMinutes) / truthAgg.meanWeeklyStudyMinutes);
      countErr.push(Math.abs(r.students - truthAgg.students));
    }
    return {
      epsilon,
      trials: args.trials,
      suppressed,
      meanWeeklyMinutesAbsError: summary(absErr),
      meanWeeklyMinutesRelError: summary(relErr),
      studentCountAbsError: summary(countErr),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    settings: {
      dataset: path.basename(args.data),
      datasetSeed: data.metadata.seed,
      students: students.length,
      sessions: data.sessions.length,
      weeks: totalWeeks,
      timeZone,
      goals: GOALS,
      weights: WEIGHTS,
      evaluationSeed: args.seed,
      bootstrapResamples: args.bootstrap,
      dpTrials: args.trials,
      privacyWindowWeeks: PRIVACY_WEEKS,
    },
    validity,
    profiles,
    componentAblations,
    trackingAblations,
    privacy: {
      window: { from: windowStart.slice(0, 10), to: lastDay, sessions: recent.length },
      rawReleaseRisk: rawRisk,
      kAnonymity,
      differentialPrivacy: { trueMeanWeeklyMinutes: truthAgg.meanWeeklyStudyMinutes, trueStudents: truthAgg.students, byEpsilon: dp },
    },
  };
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------
const f2 = (x) => (x === null || x === undefined ? '-' : Number(x).toFixed(2));
const f3 = (x) => Number(x).toFixed(3);
const ci = (c, f = f3) => `[${f(c[0])}, ${f(c[1])}]`;
const pct = (x) => `${(x * 100).toFixed(1)}%`;

function toMarkdown(r) {
  const s = r.settings;
  const L = [];
  L.push('# EthosTrack evaluation on synthetic data', '');
  L.push(`Generated ${r.generatedAt} by \`node backend/scripts/evaluate.js\` from \`${s.dataset}\` (generator seed ${s.datasetSeed}).`);
  L.push(`${s.students} synthetic students, ${s.sessions} sessions, ${s.weeks} weeks, time zone ${s.timeZone}. Every student is scored weekly against the same goal (${s.goals.targetDaysPerWeek} days a week, ${s.goals.plannedMinutesPerDay} planned minutes, ${s.goals.minMinutesPerDay} minutes for a day to count) and the weekly scores are averaged. Weights R ${s.weights.R}, A ${s.weights.A}, S ${s.weights.S}, H ${s.weights.H}.`);
  L.push(`Confidence intervals: Spearman rho uses a percentile bootstrap over students (${s.bootstrapResamples} resamples); means use mean +/- 1.96 SD / sqrt(n). Evaluation seed ${s.evaluationSeed}. These are results on synthetic data only.`, '');

  L.push('## 1. Scoring validity and baselines', '');
  L.push('Spearman rank correlation with the ground-truth consistency order of the profiles (1 = perfect agreement).', '');
  L.push('| Measure | rho | 95% CI |', '| --- | --- | --- |');
  const v = r.validity;
  L.push(`| Consistency Score (CS) | ${f3(v.consistencyScore.rho)} | ${ci(v.consistencyScore.ci95)} |`);
  L.push(`| Baseline: total weekly hours | ${f3(v.baselines.weeklyHours.rho)} | ${ci(v.baselines.weeklyHours.ci95)} |`);
  L.push(`| Baseline: longest streak | ${f3(v.baselines.longestStreak.rho)} | ${ci(v.baselines.longestStreak.ci95)} |`);
  L.push(`| Baseline: mean streak | ${f3(v.baselines.meanStreak.rho)} | ${ci(v.baselines.meanStreak.ci95)} |`, '');

  L.push('## 2. Scores by profile', '');
  L.push('| Profile | Expected rank | n | CS mean +/- SD | CS 95% CI | Weekly hours mean +/- SD | Longest streak mean +/- SD |', '| --- | --- | --- | --- | --- | --- | --- |');
  const byRank = Object.entries(r.profiles).sort((a, b) => a[1].expectedRank - b[1].expectedRank);
  for (const [name, p] of byRank) {
    L.push(`| ${name} | ${p.expectedRank} | ${p.score.n} | ${f2(p.score.mean)} +/- ${f2(p.score.sd)} | ${ci(p.score.ci95, f2)} | ${f2(p.weeklyHours.mean)} +/- ${f2(p.weeklyHours.sd)} | ${f2(p.longestStreak.mean)} +/- ${f2(p.longestStreak.sd)} |`);
  }
  L.push('');

  L.push('## 3. Ablations', '');
  L.push('Score components removed one at a time (remaining weights rescaled to sum to 1):', '');
  L.push('| Removed | rho | 95% CI | Change vs full CS |', '| --- | --- | --- | --- |');
  const names = { R: 'Regularity (R)', A: 'Adherence (A)', S: 'Stability (S)', H: 'Rhythm (H)' };
  for (const [k, a] of Object.entries(r.componentAblations)) {
    L.push(`| ${names[k]} | ${f3(a.rho)} | ${ci(a.ci95)} | ${(a.rho - v.consistencyScore.rho >= 0 ? '+' : '') + f3(a.rho - v.consistencyScore.rho)} |`);
  }
  L.push('', 'Tracking rules switched off one at a time. "Active-time error" is the mean relative difference between the measured and the true active time per session.', '');
  L.push('| Rule set | rho | 95% CI | Active-time error mean +/- SD | 95% CI |', '| --- | --- | --- | --- | --- |');
  for (const a of Object.values(r.trackingAblations)) {
    const e = a.activeTimeError;
    const err = e ? `${pct(e.mean)} +/- ${pct(e.sd)} | [${pct(e.ci95[0])}, ${pct(e.ci95[1])}]` : 'not applicable (changes which days count, not durations) | -';
    L.push(`| ${a.label} | ${f3(a.rho)} | ${ci(a.ci95)} | ${err} |`);
  }
  L.push('', 'Assumption for "timeout off": with no heartbeat timeout, a session that ended abnormally (lid closed, lost network) is taken to stay open until local midnight, as in a login/logout tracker with no activity check.', '');

  const pr = r.privacy;
  L.push('## 4. Privacy', '');
  L.push(`Window: ${pr.window.from} to ${pr.window.to}, ${pr.window.sessions} sessions.`, '');
  L.push(`Simulated linkage attack on a raw release (exact minute and duration, no generalisation): average re-identification probability ${f3(pr.rawReleaseRisk.averageRisk)}, sessions matched to exactly one student ${pct(pr.rawReleaseRisk.uniqueShare)}.`, '');
  L.push('| k | Level | Period / slot / band | Released | Suppressed | Achieved k | l (end reason) | Avg. re-id probability | Unique matches |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const kr of pr.kAnonymity) {
    const g = kr.generalisation;
    L.push(`| ${kr.k} | ${kr.level} | ${g.period} / ${g.startSlotHours} h / ${g.activeBandMinutes} min | ${kr.released} | ${kr.suppressed} (${pct(kr.suppressionRate)}) | ${kr.achievedK ?? '-'} | ${kr.lDiversity ?? '-'} | ${f3(kr.risk.averageRisk)} | ${pct(kr.risk.uniqueShare)} |`);
  }
  const dp = pr.differentialPrivacy;
  L.push('', `Differential privacy: true mean weekly study time ${f2(dp.trueMeanWeeklyMinutes)} minutes over ${dp.trueStudents} students; ${s.dpTrials} noisy releases per epsilon.`, '');
  L.push('| epsilon | Abs. error (min) mean +/- SD | 95% CI | Relative error | Student-count error mean +/- SD | Suppressed |', '| --- | --- | --- | --- | --- | --- |');
  for (const d of dp.byEpsilon) {
    const a = d.meanWeeklyMinutesAbsError;
    L.push(`| ${d.epsilon} | ${f2(a.mean)} +/- ${f2(a.sd)} | ${ci(a.ci95, f2)} | ${pct(d.meanWeeklyMinutesRelError.mean)} | ${f2(d.studentCountAbsError.mean)} +/- ${f2(d.studentCountAbsError.sd)} | ${d.suppressed} |`);
  }
  L.push('');
  return L.join('\n');
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const result = run(args);
  const md = toMarkdown(result);
  if (args.out) {
    fs.mkdirSync(args.out, { recursive: true });
    fs.writeFileSync(path.join(args.out, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(path.join(args.out, 'results.md'), md);
    console.log(`Saved results.json and results.md to ${args.out}`);
  }
  console.log(md);
}

module.exports = {
  run, toMarkdown, spearman, ranks, seededRandom,
  // Shared with benchmark.js
  GOALS, mean, sd, summary, quantile, spearmanWithCi, weeksOf, meanWeeklyScore, baselines, TRACKING_ABLATIONS,
};
