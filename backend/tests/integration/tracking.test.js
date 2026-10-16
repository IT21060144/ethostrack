/**
 * Integration tests: heartbeat session lifecycle (proposal Section 19,
 * "Integration: consent enforcement, session lifecycle").
 *
 * Time is moved by editing the stored timestamps, the same thing that
 * happens when a laptop sleeps or a tab is closed between heartbeats.
 */
const { connectTestDb, clearTestDb, closeTestDb } = require('../helpers/db');
const { app, request, registerStudent, auth } = require('../helpers/api');
const StudySession = require('../../models/StudySession');

beforeAll(connectTestDb);
afterEach(clearTestDb);
afterAll(closeTestDb);

const beat = (token, isActiveSegment) =>
  request(app).post('/api/tracking/heartbeat').set(auth(token)).send({ isActiveSegment, timezone: 'Asia/Colombo' });

/** Moves the open session back in time by `seconds`. */
async function rewind(seconds, fields = ['loginTime', 'lastHeartbeat', 'lastActiveAt']) {
  const session = await StudySession.findOne({ logoutTime: null });
  for (const f of fields) session[f] = new Date(session[f].getTime() - seconds * 1000);
  await session.save();
  return session;
}

describe('consent enforcement', () => {
  test('nothing is stored without a valid login', async () => {
    const res = await request(app).post('/api/tracking/heartbeat').send({ isActiveSegment: true });
    expect(res.status).toBe(401);
    expect(await StudySession.countDocuments()).toBe(0);
  });

  test('an idle beat (hidden tab, no input) never opens a session', async () => {
    const { token } = await registerStudent();
    const res = await beat(token, false);
    expect(res.status).toBe(200);
    expect(res.body.tracking).toBe(false);
    expect(await StudySession.countDocuments()).toBe(0);
  });

  test('stopping heartbeats (tracking switched off) stores nothing more', async () => {
    const { token } = await registerStudent();
    await beat(token, true);
    await request(app).post('/api/tracking/end').set(auth(token)).send({});
    const before = await StudySession.findOne().lean();
    const current = await request(app).get('/api/tracking/current').set(auth(token));
    expect(current.body.session).toBeNull();
    const after = await StudySession.findOne().lean();
    expect(after.activeSeconds).toBe(before.activeSeconds);
  });
});

describe('session lifecycle', () => {
  test('the first active beat opens a session keyed only by pseudoId', async () => {
    const { token, user } = await registerStudent();
    const res = await beat(token, true);
    expect(res.status).toBe(201);
    expect(res.body.session.open).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/pseudoId/);

    const stored = await StudySession.findOne().lean();
    expect(stored.pseudoId).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(String(user._id));
  });

  test('active and idle beats credit the time since the last beat', async () => {
    const { token } = await registerStudent();
    await beat(token, true);
    await rewind(30);
    await beat(token, true);
    await rewind(30);
    await beat(token, false);
    const s = await StudySession.findOne().lean();
    expect(s.activeSeconds).toBeGreaterThanOrEqual(30);
    expect(s.activeSeconds).toBeLessThanOrEqual(31);
    expect(s.idleSeconds).toBeGreaterThanOrEqual(30);
    expect(s.idleSeconds).toBeLessThanOrEqual(31);
  });

  test('credit per beat is capped, so a sleeping laptop does not count as study', async () => {
    const { token } = await registerStudent();
    await beat(token, true);
    await rewind(200); // less than the 300 s timeout
    await beat(token, true);
    const s = await StudySession.findOne().lean();
    expect(s.activeSeconds).toBeLessThanOrEqual(65);
  });

  test('POST /end closes the session with endReason explicit', async () => {
    const { token } = await registerStudent();
    await beat(token, true);
    await rewind(20);
    const res = await request(app).post('/api/tracking/end').set(auth(token)).send({ isActiveSegment: true });
    expect(res.status).toBe(200);
    expect(res.body.session.open).toBe(false);
    const s = await StudySession.findOne().lean();
    expect(s.endReason).toBe('explicit');
    expect(s.logoutTime).not.toBeNull();
    expect(s.activeSeconds).toBeGreaterThanOrEqual(20);

    // Calling it again is harmless
    const again = await request(app).post('/api/tracking/end').set(auth(token)).send({});
    expect(again.body.session).toBeNull();
  });

  test('no heartbeat for longer than the timeout closes the session as timeout', async () => {
    const { token } = await registerStudent();
    await beat(token, true);
    const old = await rewind(400);
    const res = await beat(token, true);
    expect(res.status).toBe(201); // a new session opened

    const closed = await StudySession.findById(old._id).lean();
    expect(closed.endReason).toBe('timeout');
    expect(closed.logoutTime.getTime()).toBe(old.lastHeartbeat.getTime());
    expect(await StudySession.countDocuments({ logoutTime: null })).toBe(1);
  });

  test('ten minutes of only idle beats closes the session at the last activity', async () => {
    const { token } = await registerStudent();
    await beat(token, true);
    // Active until 11 minutes ago, then only idle beats (one 1 minute ago)
    const session = await StudySession.findOne({ logoutTime: null });
    const lastActive = new Date(Date.now() - 11 * 60 * 1000);
    session.loginTime = new Date(lastActive.getTime() - 30 * 60 * 1000);
    session.lastActiveAt = lastActive;
    session.lastHeartbeat = new Date(Date.now() - 60 * 1000);
    session.activeSeconds = 1800;
    session.idleSeconds = 600;
    await session.save();

    const res = await beat(token, false);
    expect(res.body.tracking).toBe(false);
    const s = await StudySession.findById(session._id).lean();
    expect(s.endReason).toBe('idle');
    expect(s.logoutTime.getTime()).toBe(lastActive.getTime());
    // The trailing idle time after the last activity is taken back off
    expect(s.idleSeconds).toBe(0);
    expect(s.activeSeconds).toBe(1800);
  });

  test('GET /current shows live counters for the open session', async () => {
    const { token } = await registerStudent();
    expect((await request(app).get('/api/tracking/current').set(auth(token))).body.session).toBeNull();
    await beat(token, true);
    const res = await request(app).get('/api/tracking/current').set(auth(token));
    expect(res.body.session).toMatchObject({ open: true, activeSeconds: 0, idleSeconds: 0 });
  });

  test('students only ever see their own session', async () => {
    const a = await registerStudent();
    const b = await registerStudent();
    await beat(a.token, true);
    const res = await request(app).get('/api/tracking/current').set(auth(b.token));
    expect(res.body.session).toBeNull();
  });
});
