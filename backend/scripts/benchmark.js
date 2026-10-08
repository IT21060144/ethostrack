/**
 * benchmark.js — EthosTrack against the methods other systems use
 * ---------------------------------------------------------------------------
 * Runs on the same synthetic cohort as evaluate.js and needs no database.
 *
 *   node backend/scripts/benchmark.js [--data file.json] [--out folder]
 *        [--seed 1] [--bootstrap 1000]
 *
 * Every method below is computed from the SAME sessions, so the only thing
 * that differs between rows is how each system turns study activity into a
 * number. Where a method copies a named app, the comment says what was copied
 * and where it comes from; where the data cannot support the app's exact
 * method, the comment says what was approximated.
 *
 * 1. Consistency measurement: which number best recovers the true consistency
 *    order of the six profiles? Reported as Spearman rho with a bootstrap CI,
 *    the paired bootstrap CI of (rho of EthosTrack minus rho of the method),
 *    the share of profile pairs put in the right order, and the AUC for
 *    picking out at-risk students (irregular and cramming profiles).
 * 2. Tracking accuracy: how far the recorded study time is from the true
 *    active time when a system has no idle detection or no heartbeat timeout.
 * 3. Privacy: a simulated database leak against three storage designs, and a
 *    linkage attack against a research export with and without k-anonymity.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  GOALS, mean, summary, quantile, spearman, seededRandom, spearmanWithCi,
  weeksOf, meanWeeklyScore, baselines, TRACKING_ABLATIONS,
} = require('./evaluate');
const { toLocalParts, addDays } = require('../controllers/scoreController');
const { anonymiseSessions, reidentificationRisk, LEVELS } = require('../privacy/kAnonymity');

function parseArgs(argv) {
  const args = {
    data: path.resolve(__dirname, '../../synthetic-pipeline/synthetic_dataset.json'),
    out: null,
    seed: 1,
    bootstrap: 1000,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in args)) throw new Error(`Unknown option --${key}`);
    args[key] = ['seed', 'bootstrap'].includes(key) ? Number(argv[i + 1]) : path.resolve(argv[i + 1]);
  }
  return args;
}

// Same day rule as EthosTrack, so no method is penalised for a different
// threshold: a day "counts" with at least 30 active minutes.
const MIN_MINUTES = GOALS.minMinutesPerDay;
// Forest's default focus timer is 25 minutes (Pomodoro length).
const FOCUS_BLOCK_MINUTES = 25;
// The replay test (backend/tests/simulation/replay.test.js) drives the real
// tracking controller with these sessions; its measured error is quoted, not
// recomputed here, because it needs a database.
const REPLAY_TEST = { sessions: 12, meanAbsError: 0.0025, source: 'thesis/results/backend-test-report.txt' };

// ---------------------------------------------------------------------------
// Per-student measures used by other systems (higher = more consistent)
// ---------------------------------------------------------------------------
function minutesByDay(sessions, timeZone) {
  const m = new Map();
  for (const s of sessions) {
    const { dateKey } = toLocalParts(new Date(s.loginTime), timeZone);
    m.set(dateKey, (m.get(dateKey) || 0) + s.activeSeconds / 60);
  }
  return m;
}

/** Streak still running on the last day of data (what streak apps show on screen). */
function currentStreak(byDay, allDays, lastDay) {
  const days = allDays.filter((d) => d <= lastDay);
  let run = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if ((byDay.get(days[i]) || 0) >= MIN_MINUTES) run += 1;
    else if (i === days.length - 1) continue; // today not done yet keeps the streak
    else break;
  }
  return run;
}

/**
 * Loop Habit Tracker habit strength, ported from its open-source code
 * (github.com/iSoron/uhabits, uhabits-core .../models/Score.kt and
 * ScoreList.kt, commit 7e993e1):
 *   multiplier = 0.5 ^ (sqrt(frequency) / 13)
 *   score = previous * multiplier + percentageCompleted * (1 - multiplier)
 * For a boolean habit with frequency below once a day, Loop doubles the
 * numerator and denominator (4 per 7 days becomes 8 per 14) and uses
 * percentageCompleted = min(1, done in the last 14 days / 8).
 * The habit here is "study 30+ minutes", 4 times a week, like the EthosTrack goal.
 */
function loopHabitStrength(byDay, allDays, timesPerWeek = GOALS.targetDaysPerWeek) {
  const frequency = timesPerWeek / 7;
  const numerator = timesPerWeek * 2;
  const denominator = 14;
  const multiplier = 0.5 ** (Math.sqrt(frequency) / 13);
  const done = allDays.map((d) => ((byDay.get(d) || 0) >= MIN_MINUTES ? 1 : 0));
  let score = 0;
  let rolling = 0;
  for (let i = 0; i < done.length; i += 1) {
    rolling += done[i];
    if (i - denominator >= 0) rolling -= done[i - denominator];
    score = score * multiplier + Math.min(1, rolling / numerator) * (1 - multiplier);
  }
  return score * 100;
}

/** Forest-style: completed uninterrupted focus blocks per week ("trees"). */
function focusBlocksPerWeek(sessions, weeks) {
  let blocks = 0;
  for (const s of sessions) {
    const active = (s.segments || [s.activeSeconds]).filter((_, i) => i % 2 === 0);
    for (const seconds of active) blocks += Math.floor(seconds / 60 / FOCUS_BLOCK_MINUTES);
  }
  return blocks / weeks;
}

function measuresFor(student, ctx) {
  const { weeks, allDays, timeZone, lastDay } = ctx;
  const byDay = minutesByDay(student.sessions, timeZone);
  const b = baselines(student.sessions, allDays, timeZone, MIN_MINUTES);
  const active = student.sessions.reduce((a, s) => a + s.activeSeconds, 0);
  const idle = student.sessions.reduce((a, s) => a + s.idleSeconds, 0);
  return {
    ethostrack: meanWeeklyScore(student.sessions, weeks, timeZone),
    totalHours: b.weeklyHours,
    currentStreak: currentStreak(byDay, allDays, lastDay),
    longestStreak: b.longestStreak,
    loop: loopHabitStrength(byDay, allDays),
    studyDays: allDays.filter((d) => (byDay.get(d) || 0) >= MIN_MINUTES).length / weeks.length,
    loginDays: allDays.filter((d) => byDay.has(d)).length / weeks.length,
    focusBlocks: focusBlocksPerWeek(student.sessions, weeks.length),
    focusRatio: active + idle ? (100 * active) / (active + idle) : 0,
  };
}

const METHODS = [
  { key: 'ethostrack', name: 'EthosTrack Consistency Score', system: 'EthosTrack (this project)', how: 'Regularity, adherence, stability and rhythm, scored weekly' },
  { key: 'totalHours', name: 'Total study hours per week', system: 'Time trackers (Toggl Track, Clockify, RescueTime time reports)', how: 'Sum of recorded time' },
  { key: 'currentStreak', name: 'Current streak (days)', system: 'Streak apps (Duolingo-style streak, Habitica, Streaks)', how: 'Consecutive 30-minute days up to the last day' },
  { key: 'longestStreak', name: 'Longest streak (days)', system: 'Streak apps ("best streak")', how: 'Longest run of consecutive 30-minute days' },
  { key: 'loop', name: 'Habit strength (Loop formula)', system: 'Loop Habit Tracker (open source, formula ported exactly)', how: 'Exponential moving score of a 4-times-a-week habit' },
  { key: 'studyDays', name: 'Study days per week', system: 'Habit check-in apps (a tick for each day the habit was done)', how: 'Days per week with 30+ minutes' },
  { key: 'loginDays', name: 'Active days (any login)', system: 'LMS analytics (Moodle/Canvas-style login counts)', how: 'Days per week with any session' },
  { key: 'focusBlocks', name: 'Focus sessions completed', system: 'Forest / Pomodoro apps (trees grown)', how: 'Uninterrupted 25-minute blocks per week' },
  { key: 'focusRatio', name: 'Focus ratio', system: 'RescueTime Productivity Pulse (approximation)', how: 'Active share of logged time, 0-100' },
];

// ---------------------------------------------------------------------------
// Comparison statistics
// ---------------------------------------------------------------------------
/** AUC for "lower value = at risk" (Mann-Whitney, ties count half). */
function atRiskAuc(values, atRisk) {
  const risky = values.filter((_, i) => atRisk[i]);
  const safe = values.filter((_, i) => !atRisk[i]);
  let wins = 0;
  for (const r of risky) for (const s of safe) wins += r < s ? 1 : r === s ? 0.5 : 0;
  return wins / (risky.length * safe.length);
}

/** Share of profile pairs (with different true ranks) ordered correctly by their means. */
function pairwiseOrder(values, students, profiles) {
  const means = profiles.map((p) => ({
    rank: students.find((s) => s.profile === p).expected_rank,
    m: mean(values.filter((_, i) => students[i].profile === p)),
  }));
  let pairs = 0;
  let right = 0;
  const wrong = [];
  for (let a = 0; a < means.length; a += 1) {
    for (let b = a + 1; b < means.length; b += 1) {
      if (means[a].rank === means[b].rank) continue;
      pairs += 1;
      const [better, worse] = means[a].rank < means[b].rank ? [a, b] : [b, a];
      if (means[better].m > means[worse].m) right += 1;
      else wrong.push(`${profiles[worse]} >= ${profiles[better]}`);
    }
  }
  return { pairs, right, share: right / pairs, wrong };
}

/** Paired bootstrap: rho(EthosTrack) - rho(method) on the same resampled students. */
function pairedDifference(valuesA, valuesB, truth, resamples, rng) {
  const diffs = [];
  for (let b = 0; b < resamples; b += 1) {
    const idx = Array.from({ length: truth.length }, () => Math.floor(rng() * truth.length));
    const t = idx.map((i) => truth[i]);
    diffs.push(spearman(idx.map((i) => valuesA[i]), t) - spearman(idx.map((i) => valuesB[i]), t));
  }
  diffs.sort((a, b) => a - b);
  return {
    diff: spearman(valuesA, truth) - spearman(valuesB, truth),
    ci95: [quantile(diffs, 0.025), quantile(diffs, 0.975)],
    shareEthosTrackBetter: diffs.filter((d) => d > 0).length / diffs.length,
  };
}

// ---------------------------------------------------------------------------
// Privacy: simulated leak against three storage designs
// ---------------------------------------------------------------------------
const sha256 = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');

function leakBenchmark(students, sessions) {
  // Synthetic identities for the synthetic students (never real people).
  const users = students.map((st, i) => ({
    _id: crypto.randomBytes(12).toString('hex'),
    email: `student${String(i + 1).padStart(3, '0')}@uni.example`,
    name: `Student ${i + 1}`,
    pseudoIdInData: st.pseudo_id,
  }));

  // What the attacker tries against a leaked behaviour table: the obvious
  // ways to turn a known user into the stored key.
  const guessesFor = (u) => [u._id, u.email, sha256(u._id), sha256(u.email),
    crypto.createHmac('sha256', '').update(u._id).digest('hex')];

  const share = (linked) => linked / users.length;
  const sessionsOf = new Map();
  for (const s of sessions) sessionsOf.set(s.pseudoId, (sessionsOf.get(s.pseudoId) || 0) + 1);
  const sessionShare = (linkedUsers) =>
    linkedUsers.reduce((a, u) => a + (sessionsOf.get(u.pseudoIdInData) || 0), 0) / sessions.length;

  // A: one database, every session row carries the user id (typical app).
  const aKeys = new Set(users.map((u) => u._id));
  const aLinked = users.filter((u) => guessesFor(u).some((g) => aKeys.has(g)));

  // B: "anonymised" with an unkeyed hash of the email, a common shortcut.
  const bKeys = new Set(users.map((u) => sha256(u.email)));
  const bLinked = users.filter((u) => guessesFor(u).some((g) => bKeys.has(g)));

  // C: EthosTrack. Behaviour rows carry a random pseudoId; the bridge row is
  // keyed by HMAC(PSEUDONYM_SECRET, userId) using the real utils/pseudonym.js.
  // The attacker holds Users, PseudonymMap and StudySessions, but not the
  // server secret (it lives in the environment, not the database).
  process.env.PSEUDONYM_SECRET = crypto.randomBytes(32).toString('hex');
  const { lookupHashFor, newPseudoId } = require('../utils/pseudonym');
  const mapRows = new Map(users.map((u) => [lookupHashFor(u._id), newPseudoId()]));
  const cLinked = users.filter((u) => guessesFor(u).some((g) => mapRows.has(g)));
  // Same design if the server secret leaks as well: the HMAC can be recomputed.
  const cWithSecret = users.filter((u) => mapRows.has(lookupHashFor(u._id)));

  return [
    { design: 'Single database, sessions stored with the user id (typical app)', studentsLinked: share(aLinked.length), sessionsLinked: sessionShare(aLinked) },
    { design: 'Sessions stored under SHA-256(email), no secret key', studentsLinked: share(bLinked.length), sessionsLinked: sessionShare(bLinked) },
    { design: 'EthosTrack: random pseudoId + HMAC bridge, secret not leaked', studentsLinked: share(cLinked.length), sessionsLinked: sessionShare(cLinked) },
    { design: 'EthosTrack, if the server secret also leaks', studentsLinked: share(cWithSecret.length), sessionsLinked: sessionShare(cWithSecret) },
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function run(args) {
  const data = JSON.parse(fs.readFileSync(args.data, 'utf8'));
  const timeZone = data.metadata.timezone || 'Asia/Colombo';
  const rng = seededRandom(args.seed);

  const byStudent = new Map(data.cohort.map((st) => [st.pseudo_id, []]));
  for (const s of data.sessions) byStudent.get(s.pseudoId).push(s);
  const lastDay = toLocalParts(new Date(data.sessions[data.sessions.length - 1].loginTime), timeZone).dateKey;
  const lastMonday = addDays(lastDay, -((new Date(`${lastDay}T00:00:00Z`).getUTCDay() + 6) % 7));
  const weeks = weeksOf(addDays(lastMonday, -7 * (data.metadata.weeks - 1)), data.metadata.weeks);
  const ctx = { weeks, allDays: weeks.flat(), timeZone, lastDay };

  const students = data.cohort.map((st) => ({ ...st, sessions: byStudent.get(st.pseudo_id) }));
  const truth = students.map((st) => -st.expected_rank);
  const atRisk = students.map((st) => ['irregular', 'cramming'].includes(st.profile));
  const measures = students.map((st) => measuresFor(st, ctx));

  // 1. Consistency measurement
  const valuesOf = (key) => measures.map((m) => m[key]);
  const cs = valuesOf('ethostrack');
  const consistency = METHODS.map((method) => {
    const values = valuesOf(method.key);
    const profiles = {};
    for (const p of data.metadata.profiles) profiles[p] = summary(values.filter((_, i) => students[i].profile === p));
    return {
      ...method,
      ...spearmanWithCi(values, truth, args.bootstrap, rng),
      vsEthosTrack: method.key === 'ethostrack' ? null : pairedDifference(cs, values, truth, args.bootstrap, rng),
      pairwise: pairwiseOrder(values, students, data.metadata.profiles),
      atRiskAuc: atRiskAuc(values, atRisk),
      profiles,
    };
  });

  // 2. Tracking accuracy on every session
  const tracking = ['idle', 'timeout'].map((key) => {
    const errors = [];
    let trueSeconds = 0;
    let recordedSeconds = 0;
    for (const s of data.sessions) {
      const t = TRACKING_ABLATIONS[key].transform(s, timeZone);
      errors.push(Math.abs(t.activeSeconds - s.activeSeconds) / Math.max(1, s.activeSeconds));
      trueSeconds += s.activeSeconds;
      recordedSeconds += t.activeSeconds;
    }
    return { key, error: summary(errors), overcount: recordedSeconds / trueSeconds - 1 };
  });

  // 3. Privacy
  const leak = leakBenchmark(students, data.sessions);
  const windowStart = `${addDays(lastDay, -27)}T00:00:00Z`;
  const recent = data.sessions.filter((s) => s.loginTime >= windowStart);
  const rawRisk = reidentificationRisk(recent, { timeZone });
  const { report } = anonymiseSessions(recent, { k: 5, timeZone });
  const k5Risk = reidentificationRisk(recent, { levelSpec: LEVELS[report.level], k: 5, timeZone });

  return {
    generatedAt: new Date().toISOString(),
    settings: {
      dataset: path.basename(args.data),
      datasetSeed: data.metadata.seed,
      students: students.length,
      sessions: data.sessions.length,
      weeks: data.metadata.weeks,
      timeZone,
      evaluationSeed: args.seed,
      bootstrapResamples: args.bootstrap,
      atRiskProfiles: ['irregular', 'cramming'],
    },
    consistency,
    tracking: { replayTest: REPLAY_TEST, alternatives: tracking },
    privacy: {
      leak,
      export: { window: { from: windowStart.slice(0, 10), to: lastDay, sessions: recent.length }, raw: rawRisk, k5: { ...k5Risk, suppressed: report.suppressed, suppressionRate: report.suppressionRate } },
    },
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const f2 = (x) => Number(x).toFixed(2);
const f3 = (x) => Number(x).toFixed(3);
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const signed = (x) => (x >= 0 ? '+' : '') + f3(x);

function toMarkdown(r) {
  const s = r.settings;
  const L = [];
  L.push('# EthosTrack benchmark against other systems', '');
  L.push(`Generated ${r.generatedAt} by \`node backend/scripts/benchmark.js\` from \`${s.dataset}\` (generator seed ${s.datasetSeed}).`);
  L.push(`${s.students} synthetic students in 6 profiles, ${s.sessions} sessions over ${s.weeks} weeks. Every method below is computed from the same sessions, so only the method differs. Bootstrap: ${s.bootstrapResamples} resamples of students, evaluation seed ${s.evaluationSeed}. Synthetic data only; no real students.`, '');

  L.push('## 1. Which number best measures study consistency?', '');
  L.push('Ground truth: the designed consistency order of the profiles (consistent > moderately consistent > declining = recovering > irregular > cramming).');
  L.push('rho: Spearman rank correlation with that order (1 = perfect). Difference: rho of EthosTrack minus rho of the method, with a paired bootstrap 95% CI; a CI above 0 means EthosTrack is better on this data. Profile pairs: how many of the 14 profile pairs the method puts in the right order. At-risk AUC: chance that a randomly chosen irregular or cramming student scores lower than a randomly chosen other student (0.5 = guessing, 1 = perfect).', '');
  L.push('| Method | Used by | rho [95% CI] | EthosTrack better by [95% CI] | Profile pairs right | At-risk AUC |', '| --- | --- | --- | --- | --- | --- |');
  const sorted = [...r.consistency].sort((a, b) => b.rho - a.rho);
  for (const m of sorted) {
    const d = m.vsEthosTrack ? `${signed(m.vsEthosTrack.diff)} [${signed(m.vsEthosTrack.ci95[0])}, ${signed(m.vsEthosTrack.ci95[1])}]` : '-';
    const name = m.key === 'ethostrack' ? `**${m.name}**` : m.name;
    L.push(`| ${name} | ${m.system} | ${f3(m.rho)} [${f3(m.ci95[0])}, ${f3(m.ci95[1])}] | ${d} | ${m.pairwise.right} of ${m.pairwise.pairs} | ${f3(m.atRiskAuc)} |`);
  }
  L.push('', 'Mistakes each method makes (profile pairs in the wrong order, "A >= B" means the less consistent profile A scored at least as high as B):', '');
  for (const m of sorted) {
    L.push(`- ${m.name}: ${m.pairwise.wrong.length ? m.pairwise.wrong.join('; ') : 'none'}`);
  }
  L.push('', 'Mean value per profile:', '');
  const profs = Object.keys(r.consistency[0].profiles);
  L.push(`| Method | ${profs.join(' | ')} |`, `| --- | ${profs.map(() => '---').join(' | ')} |`);
  for (const m of r.consistency) L.push(`| ${m.name} | ${profs.map((p) => f2(m.profiles[p].mean)).join(' | ')} |`);

  L.push('', 'How each method was built: totals, streaks, completion rate and login days use the same 30-minute day rule as EthosTrack. Loop Habit Tracker: its open-source scoring formula ported line for line (github.com/iSoron/uhabits, Score.kt and ScoreList.kt, commit 7e993e1), habit "study 30+ minutes, 4 times a week". Forest: one tree per uninterrupted 25-minute block of active study. RescueTime: its Productivity Pulse weights time by app category, which this data does not have, so active time stands in for productive time and idle time for distracting time; treat that row as an approximation.', '');

  const t = r.tracking;
  L.push('## 2. How accurately is study time recorded?', '');
  L.push('| Design | Used by | Mean error per session | Total study time over-counted | Measured on |', '| --- | --- | --- | --- | --- |');
  L.push(`| **EthosTrack: heartbeat, idle exclusion, 5-minute timeout** | EthosTrack | ${pct(t.replayTest.meanAbsError, 2)} | - | ${t.replayTest.sessions} sessions replayed through the real server code (${t.replayTest.source}) |`);
  const label = {
    idle: ['Timer with no idle detection (breaks count as study)', 'Stopwatch timers (Forest stopwatch, a running Toggl/Clockify timer)'],
    timeout: ['Login/logout session with no heartbeat (lost sessions run to midnight)', 'LMS session logs, timers left running'],
  };
  for (const a of t.alternatives) {
    L.push(`| ${label[a.key][0]} | ${label[a.key][1]} | ${pct(a.error.mean)} | ${pct(a.overcount)} | all ${s.sessions} sessions (simulated) |`);
  }
  L.push('', 'The two alternatives are simulated from the true session data: idle time is added back, or a session that ended abnormally (lid closed, lost network) is kept open until local midnight.', '');

  const p = r.privacy;
  L.push('## 3. Privacy', '');
  L.push(`Simulated database leak: the attacker gets every table (users with names and emails, plus the study sessions) and tries to link sessions to named students using the user id, the email, and SHA-256 or empty-key HMAC of each. ${s.students} synthetic students.`, '');
  L.push('| Storage design | Students re-identified | Sessions linked to a name |', '| --- | --- | --- |');
  for (const l of p.leak) L.push(`| ${l.design} | ${pct(l.studentsLinked)} | ${pct(l.sessionsLinked)} |`);
  const e = p.export;
  L.push('', `Research export (${e.window.from} to ${e.window.to}, ${e.window.sessions} sessions). The attacker knows when one target session started and how long it lasted, and looks for it in the released file.`, '');
  L.push('| Export | Avg. chance of naming the right student | Sessions matched to exactly one student | Rows removed |', '| --- | --- | --- | --- |');
  L.push(`| Raw export, pseudonymous but exact times (typical CSV export) | ${f3(e.raw.averageRisk)} | ${pct(e.raw.uniqueShare)} | 0 |`);
  L.push(`| **EthosTrack k-anonymous export, k = 5** | ${f3(e.k5.averageRisk)} | ${pct(e.k5.uniqueShare)} | ${e.k5.suppressed} (${pct(e.k5.suppressionRate)}) |`);
  L.push('', 'Differential privacy accuracy for cohort averages is in results.md, section 4.', '');

  L.push('## Limitations', '');
  L.push('- The data is synthetic and its ground-truth order was designed by this project, so section 1 shows that EthosTrack measures consistency as the proposal defines it better than the alternatives do; it does not show what real students do.');
  L.push('- The synthetic profiles differ mainly in how many days a week they study, so a plain count of study days ranks them almost perfectly. On this data it edges the Consistency Score on rank correlation, and the two are level on profile pairs. The score adds time-of-day rhythm, stability and goal adherence, which this ground truth barely rewards; whether those add value needs real student data.');
  L.push('- The other systems are represented by the measure they show users, rebuilt on the same data. They were not run themselves, and their products may do more than the one number shown.');
  L.push('- The EthosTrack tracking error comes from 12 replayed sessions, the alternatives from simulation; both are compared against the same true active time.');
  L.push('');
  return L.join('\n');
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const result = run(args);
  const md = toMarkdown(result);
  if (args.out) {
    fs.mkdirSync(args.out, { recursive: true });
    fs.writeFileSync(path.join(args.out, 'benchmark.json'), `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(path.join(args.out, 'benchmark.md'), md);
    console.log(`Saved benchmark.json and benchmark.md to ${args.out}`);
  }
  console.log(md);
}

module.exports = { run, toMarkdown, loopHabitStrength, currentStreak, focusBlocksPerWeek, atRiskAuc, pairwiseOrder };
