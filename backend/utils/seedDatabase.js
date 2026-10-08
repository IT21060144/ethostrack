/**
 * seedDatabase — local demo data
 * ---------------------------------------------------------------------------
 * 1. Creates (or refreshes) one demo student you can log in as, wired through
 *    PseudonymMap exactly like a real registration, with 8 days of sessions.
 * 2. Creates a researcher account, which can read only the anonymised
 *    aggregates and k-anonymous export under /api/research.
 * 3. If synthetic-pipeline/synthetic_dataset.json exists, loads its sessions
 *    into the Behavioral Zone. Those cohorts have pseudoIds but no User or
 *    PseudonymMap rows, which is exactly what an anonymised research dataset
 *    should look like: behavior with no path back to a person.
 *
 * Run from the repo root with `npm run seed`.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const fs = require('fs');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('../models/User');
const StudyGoal = require('../models/StudyGoal');
const StudySession = require('../models/StudySession');
const PseudonymMap = require('../models/PseudonymMap');
const { lookupHashFor, newPseudoId } = require('./pseudonym');

const SYNTHETIC_DATASET = path.resolve(__dirname, '../../synthetic-pipeline/synthetic_dataset.json');

async function ensureDemoStudent() {
  const email = (process.env.SEED_EMAIL || 'student@example.com').toLowerCase();
  const password = process.env.SEED_PASSWORD || 'Password123!';

  const user = await User.findOneAndUpdate(
    { email },
    { email, passwordHash: await bcrypt.hash(password, 10), role: 'student' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Reuse the existing pseudonym if this demo user was seeded before.
  const existing = await PseudonymMap.findOne({ userId: user._id }).lean();
  const pseudoId = existing ? existing.pseudoId : newPseudoId();

  await PseudonymMap.findOneAndUpdate(
    { userId: user._id },
    { userId: user._id, pseudoId, lookupHash: lookupHashFor(user._id) },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await StudyGoal.findOneAndUpdate(
    { pseudoId },
    {
      pseudoId,
      targetDaysPerWeek: 5,
      plannedMinutesPerDay: 60,
      minMinutesPerDay: 30,
      restDays: [],
      timezone: 'UTC',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );

  const sessions = [];
  const now = new Date();
  for (let i = 0; i < 8; i += 1) {
    const sessionStart = new Date(now);
    sessionStart.setUTCDate(now.getUTCDate() - i);
    sessionStart.setUTCHours(9 + (i % 3), 15, 0, 0);
    if (sessionStart > now) sessionStart.setUTCDate(sessionStart.getUTCDate() - 1);

    const sessionEnd = new Date(sessionStart);
    sessionEnd.setUTCMinutes(sessionEnd.getUTCMinutes() + 60);

    sessions.push({
      pseudoId,
      loginTime: sessionStart,
      logoutTime: sessionEnd,
      activeSeconds: 50 * 60,
      idleSeconds: 10 * 60,
      lastHeartbeat: sessionEnd,
      endReason: 'explicit',
    });
  }

  await StudySession.deleteMany({ pseudoId });
  await StudySession.insertMany(sessions);

  console.log(`Demo student ready: ${email} / ${password} (${sessions.length} sessions)`);
}

// A researcher has no PseudonymMap row and no study data: they only ever see
// the anonymised outputs of the privacy service.
async function ensureResearcher() {
  const email = (process.env.SEED_RESEARCHER_EMAIL || 'researcher@example.com').toLowerCase();
  const password = process.env.SEED_RESEARCHER_PASSWORD || process.env.SEED_PASSWORD || 'Password123!';
  await User.findOneAndUpdate(
    { email },
    { email, passwordHash: await bcrypt.hash(password, 10), role: 'researcher' },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );
  console.log(`Researcher ready: ${email} / ${password} (anonymised views only)`);
}

async function loadSyntheticDataset() {
  if (!fs.existsSync(SYNTHETIC_DATASET)) {
    console.log('No synthetic dataset found; run `npm run simulate` to create one.');
    return;
  }

  const data = JSON.parse(fs.readFileSync(SYNTHETIC_DATASET, 'utf8'));
  const sessions = (data.sessions || []).map((s) => ({
    pseudoId: s.pseudoId,
    loginTime: new Date(s.loginTime),
    logoutTime: s.logoutTime ? new Date(s.logoutTime) : null,
    activeSeconds: s.activeSeconds,
    idleSeconds: s.idleSeconds,
    lastHeartbeat: s.logoutTime ? new Date(s.logoutTime) : new Date(s.loginTime),
    endReason: s.endReason,
  }));
  const pseudoIds = [...new Set(sessions.map((s) => s.pseudoId))];

  await StudySession.deleteMany({ pseudoId: { $in: pseudoIds } });
  if (sessions.length) await StudySession.insertMany(sessions);

  console.log(`Synthetic dataset loaded: ${sessions.length} sessions for ${pseudoIds.length} pseudonymous students`);
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('Seed skipped: MONGO_URI is not configured in backend/.env.');
    process.exitCode = 1;
    return;
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('Connected to MongoDB for seed');
    await ensureDemoStudent();
    await ensureResearcher();
    await loadSyntheticDataset();
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
