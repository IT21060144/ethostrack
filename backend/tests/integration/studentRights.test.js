/**
 * Integration tests: the student's own log, export, dashboard and erasure.
 */
const { connectTestDb, clearTestDb, closeTestDb } = require('../helpers/db');
const { app, request, registerStudent, auth } = require('../helpers/api');
const User = require('../../models/User');
const PseudonymMap = require('../../models/PseudonymMap');
const StudySession = require('../../models/StudySession');
const StudyGoal = require('../../models/StudyGoal');

beforeAll(connectTestDb);
afterEach(clearTestDb);
afterAll(closeTestDb);

async function addSessions(user, count) {
  const { pseudoId } = await PseudonymMap.findOne({ userId: user._id }).lean();
  const docs = [];
  for (let i = 1; i <= count; i += 1) {
    const login = new Date(Date.now() - i * 24 * 3600 * 1000);
    docs.push({
      pseudoId,
      loginTime: login,
      logoutTime: new Date(login.getTime() + 70 * 60 * 1000),
      lastHeartbeat: new Date(login.getTime() + 70 * 60 * 1000),
      activeSeconds: 60 * 60,
      idleSeconds: 10 * 60,
      endReason: 'explicit',
    });
  }
  await StudySession.insertMany(docs);
  return pseudoId;
}

test('the study log has one row per day and totals', async () => {
  const { token, user } = await registerStudent();
  await addSessions(user, 3);
  const res = await request(app).get('/api/tracking/log?days=7&tz=Asia/Colombo').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body.rows).toHaveLength(7);
  expect(res.body.totals.sessions).toBe(3);
  expect(res.body.totals.hours).toBe(3);
});

test('the CSV export has the research column names and no identity columns', async () => {
  const { token, user } = await registerStudent();
  await addSessions(user, 2);
  const res = await request(app).get('/api/tracking/log.csv?days=7').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/text\/csv/);
  const header = res.text.split('\n')[0];
  expect(header).toBe('date,day_of_week,login_time,logout_time,hours_spent,num_sessions,break_count,break_duration_minutes,goal_hours,goal_met,current_streak_days');
  expect(res.text).not.toMatch(/student_id|student_name|email|pseudo/i);
  expect(res.text).not.toContain(user.email);
});

test('invalid days is a 400 error', async () => {
  const { token } = await registerStudent();
  expect((await request(app).get('/api/tracking/log?days=0').set(auth(token))).status).toBe(400);
  expect((await request(app).get('/api/tracking/log?days=abc').set(auth(token))).status).toBe(400);
});

test('the daily goal can be set and is validated', async () => {
  const { token } = await registerStudent();
  const ok = await request(app).put('/api/tracking/goal').set(auth(token)).send({ goalHours: 2 });
  expect(ok.status).toBe(200);
  expect(ok.body.goalHours).toBe(2);
  expect((await request(app).put('/api/tracking/goal').set(auth(token)).send({ goalHours: 30 })).status).toBe(400);
});

test('the dashboard returns a score with no identifiers', async () => {
  const { token, user } = await registerStudent();
  const pseudoId = await addSessions(user, 5);
  const res = await request(app).get('/api/dashboard?window=rolling').set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body.metrics.score).toBeGreaterThan(0);
  expect(JSON.stringify(res.body)).not.toContain(pseudoId);
  expect(JSON.stringify(res.body)).not.toContain(String(user._id));
});

test('DELETE /api/me erases the student from every zone', async () => {
  const { token, user } = await registerStudent();
  const other = await registerStudent();
  const pseudoId = await addSessions(user, 4);
  await addSessions(other.user, 2);

  const res = await request(app).delete('/api/me').set(auth(token));
  expect(res.status).toBe(200);

  expect(await User.countDocuments({ _id: user._id })).toBe(0);
  expect(await PseudonymMap.countDocuments({ userId: user._id })).toBe(0);
  expect(await StudySession.countDocuments({ pseudoId })).toBe(0);
  expect(await StudyGoal.countDocuments({ pseudoId })).toBe(0);
  // Another student's data is untouched
  expect(await StudySession.countDocuments()).toBe(2);

  // The old token no longer works for tracking
  const after = await request(app).post('/api/tracking/heartbeat').set(auth(token)).send({ isActiveSegment: true });
  expect(after.status).toBe(404);
  expect(await StudySession.countDocuments()).toBe(2);
});
