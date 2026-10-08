/**
 * Simulation test (proposal Section 19, "Simulation: replay of synthetic event
 * streams with known true durations, including idle gaps and abnormal exits";
 * target: mean absolute duration error of 5% or less).
 *
 * Sessions made by synthetic-pipeline/generator.py (tests/fixtures) keep their
 * exact active/idle segments. Each one is replayed through the real heartbeat
 * API as a browser would send it: a beat every 30 seconds saying whether the
 * last interval was active. Instead of waiting 30 real seconds, the open
 * session's stored timestamps are moved 30 seconds into the past before each
 * beat, which is exactly what the server sees when 30 seconds pass, so a
 * 2-hour session replays in seconds. The stored activeSeconds is then
 * compared with the true value.
 *
 * Note: this checks the server's accounting of the signals it receives. How
 * quickly a real browser notices a break (5 minutes without input) is a
 * client-side setting and is not part of this test.
 */
const { connectTestDb, closeTestDb } = require('../helpers/db');
const { app, request, registerStudent, auth } = require('../helpers/api');
const StudySession = require('../../models/StudySession');
const fixture = require('../fixtures/synthetic_sessions.json');

const INTERVAL = 30;
const TIMEOUT = Number(process.env.SESSION_TIMEOUT_SECONDS);

let token;
const results = [];

beforeAll(async () => {
  await connectTestDb();
  ({ token } = await registerStudent());
});

afterAll(closeTestDb);

/** "Let `seconds` pass": moves every timestamp of the session into the past. */
async function advance(sessionId, seconds) {
  const s = await StudySession.findById(sessionId);
  for (const field of ['loginTime', 'lastHeartbeat', 'lastActiveAt']) {
    if (s[field]) s[field] = new Date(s[field].getTime() - seconds * 1000);
  }
  await s.save();
}

/** Is second `t` of the session inside an active segment? */
function activeAt(segments, t) {
  let edge = 0;
  for (let i = 0; i < segments.length; i += 1) {
    edge += segments[i];
    if (t < edge) return i % 2 === 0;
  }
  return segments.length % 2 === 1;
}

const beat = (isActiveSegment) =>
  request(app).post('/api/tracking/heartbeat').set(auth(token)).send({ isActiveSegment });

async function replay(session) {
  const total = session.segments.reduce((a, b) => a + b, 0);

  const opened = await beat(true); // first activity opens the session
  expect(opened.status).toBe(201);
  const { _id: id } = await StudySession.findOne({ logoutTime: null }).select('_id').lean();

  let t = INTERVAL;
  for (; t <= total; t += INTERVAL) {
    await advance(id, INTERVAL);
    // The beat reports the interval that just ended (its midpoint)
    await beat(activeAt(session.segments, t - INTERVAL / 2));
  }

  const rest = total - (t - INTERVAL);
  if (session.endReason === 'timeout') {
    // Lid closed: heartbeats just stop. The next beat after the timeout
    // closes the session where the last beat left off.
    await advance(id, rest + TIMEOUT + 60);
    await beat(true);
  } else {
    // Logout / pause / tab closed: one final call for the partial interval
    await advance(id, rest);
    await request(app).post('/api/tracking/end').set(auth(token)).send({ isActiveSegment: true });
  }

  const stored = await StudySession.findById(id).lean();
  // Remove everything, including the session the post-timeout beat opened
  await StudySession.deleteMany({});
  return stored;
}

describe('replay of synthetic sessions through the heartbeat API', () => {
  test.each(fixture.sessions.map((s, i) => [i, s.profile, s]))(
    'session %i (%s) is measured within 5%% of its true active time',
    async (_i, _profile, session) => {
      const stored = await replay(session);
      expect(stored).not.toBeNull();
      expect(stored.endReason).toBe(session.endReason);

      const error = Math.abs(stored.activeSeconds - session.activeSeconds) / session.activeSeconds;
      results.push({ error, idleError: Math.abs(stored.idleSeconds - session.idleSeconds) });
      expect(error).toBeLessThanOrEqual(0.05);
    },
    120000
  );

  test('mean absolute duration error across all sessions is 5% or less', () => {
    expect(results).toHaveLength(fixture.sessions.length);
    const mae = results.reduce((a, r) => a + r.error, 0) / results.length;
    // Printed so the number can be quoted in the test report
    process.stdout.write(`\n[replay] ${results.length} sessions, mean absolute active-time error ${(mae * 100).toFixed(2)}%\n`);
    expect(mae).toBeLessThanOrEqual(0.05);
  });
});
