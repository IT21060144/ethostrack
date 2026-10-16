/**
 * Integration tests: the researcher's anonymised views (/api/research).
 */
const { connectTestDb, clearTestDb, closeTestDb } = require('../helpers/db');
const { app, request, registerStudent, createResearcher, auth } = require('../helpers/api');
const StudySession = require('../../models/StudySession');

beforeAll(connectTestDb);
afterEach(clearTestDb);
afterAll(closeTestDb);

/** 12 pseudonymous students who each studied 10 mornings in the last 2 weeks. */
async function seedCohort() {
  const docs = [];
  for (let s = 0; s < 12; s += 1) {
    const pseudoId = `${String(s).padStart(2, '0')}${'ab'.repeat(31)}`;
    for (let d = 1; d <= 10; d += 1) {
      const login = new Date(Date.now() - d * 24 * 3600 * 1000);
      login.setUTCHours(3, (s * 5) % 60, 0, 0); // about 09:00 in Sri Lanka
      docs.push({
        pseudoId,
        loginTime: login,
        logoutTime: new Date(login.getTime() + 65 * 60 * 1000),
        lastHeartbeat: login,
        activeSeconds: (50 + s) * 60,
        idleSeconds: 5 * 60,
        endReason: d % 4 ? 'explicit' : 'timeout',
      });
    }
  }
  await StudySession.insertMany(docs);
  return docs;
}

test('students cannot use the research endpoints', async () => {
  const { token } = await registerStudent();
  for (const path of ['/api/research/aggregates', '/api/research/export', '/api/research/export.csv']) {
    const res = await request(app).get(path).set(auth(token));
    expect(res.status).toBe(403);
  }
  expect((await request(app).get('/api/research/aggregates')).status).toBe(401);
});

test('aggregates are noisy cohort statistics with no identifiers', async () => {
  const docs = await seedCohort();
  const { token } = await createResearcher();
  const res = await request(app).get('/api/research/aggregates?weeks=4&epsilon=1').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  const { aggregates } = res.body;
  expect(aggregates.privacy).toMatchObject({ mechanism: 'Laplace', epsilon: 1, k: 5 });
  if (!aggregates.suppressed) {
    expect(aggregates.students).toEqual(expect.any(Number));
    expect(aggregates.meanWeeklyStudyMinutes).toEqual(expect.any(Number));
  }
  const text = JSON.stringify(res.body);
  for (const id of new Set(docs.map((d) => d.pseudoId))) expect(text).not.toContain(id);
});

test('a tiny cohort is suppressed', async () => {
  const { token } = await createResearcher();
  await StudySession.create({
    pseudoId: 'f'.repeat(64),
    loginTime: new Date(Date.now() - 3600 * 1000),
    logoutTime: new Date(),
    activeSeconds: 3000,
    endReason: 'explicit',
  });
  const res = await request(app).get('/api/research/aggregates').set(auth(token));
  expect(res.body.aggregates.suppressed).toBe(true);
});

test('the export is k-anonymous and carries no identifiers or exact times', async () => {
  const docs = await seedCohort();
  const { token } = await createResearcher();
  const res = await request(app).get('/api/research/export?weeks=4&k=5').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body.report.k).toBe(5);
  expect(res.body.report.achievedK).toBeGreaterThanOrEqual(5);
  expect(res.body.report.records).toBe(docs.length);
  for (const row of res.body.rows) {
    expect(Object.keys(row).sort()).toEqual(['active_band', 'end_reason', 'period', 'start_slot']);
  }
  const text = JSON.stringify(res.body);
  expect(text).not.toMatch(/pseudoId|idleSeconds|T\d\d:\d\d:\d\d/);
});

test('the CSV export has a header and reports achieved k', async () => {
  await seedCohort();
  const { token } = await createResearcher();
  const res = await request(app).get('/api/research/export.csv?k=5').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.text.split('\n')[0]).toBe('period,start_slot,active_band,end_reason');
  expect(Number(res.headers['x-ethostrack-achieved-k'])).toBeGreaterThanOrEqual(5);
});

test('open sessions are not exported', async () => {
  const { token } = await createResearcher();
  await StudySession.create({ pseudoId: 'e'.repeat(64), loginTime: new Date(), activeSeconds: 60 });
  const res = await request(app).get('/api/research/export?k=2').set(auth(token));
  expect(res.body.report.records).toBe(0);
});

test('out-of-range settings are 400 errors', async () => {
  const { token } = await createResearcher();
  expect((await request(app).get('/api/research/aggregates?epsilon=0').set(auth(token))).status).toBe(400);
  expect((await request(app).get('/api/research/aggregates?weeks=99').set(auth(token))).status).toBe(400);
  expect((await request(app).get('/api/research/export?k=1').set(auth(token))).status).toBe(400);
  expect((await request(app).get('/api/research/export?k=abc').set(auth(token))).status).toBe(400);
});

test('a researcher login creates no pseudonym link', async () => {
  const PseudonymMap = require('../../models/PseudonymMap');
  const { user } = await createResearcher();
  const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'Password123!' });
  expect(res.status).toBe(200);
  expect(await PseudonymMap.countDocuments({ userId: user._id })).toBe(0);
});
