/**
 * Integration tests: registration, login and the PseudonymMap bridge.
 * Needs MongoDB (see tests/helpers/db.js).
 */
const crypto = require('crypto');
const { connectTestDb, clearTestDb, closeTestDb } = require('../helpers/db');
const { app, request, registerStudent, auth } = require('../helpers/api');
const User = require('../../models/User');
const PseudonymMap = require('../../models/PseudonymMap');
const StudyGoal = require('../../models/StudyGoal');

beforeAll(connectTestDb);
afterEach(clearTestDb);
afterAll(closeTestDb);

describe('POST /api/auth/register', () => {
  test('creates the account, its pseudonym link and a goal record', async () => {
    const { token, user } = await registerStudent();
    expect(token).toEqual(expect.any(String));
    expect(user.passwordHash).not.toBe('Password123!');
    expect(user.role).toBe('student');

    const mapping = await PseudonymMap.findOne({ userId: user._id }).lean();
    const expectedHash = crypto.createHmac('sha256', process.env.PSEUDONYM_SECRET).update(String(user._id)).digest('hex');
    expect(mapping.lookupHash).toBe(expectedHash);
    expect(mapping.pseudoId).toMatch(/^[0-9a-f]{64}$/);

    const goal = await StudyGoal.findOne({ pseudoId: mapping.pseudoId }).lean();
    expect(goal.timezone).toBe('Asia/Colombo');
  });

  test('the pseudoId is random, not derived from the account id', async () => {
    const { user } = await registerStudent();
    const { pseudoId } = await PseudonymMap.findOne({ userId: user._id }).lean();
    expect(pseudoId).not.toContain(String(user._id));
    const hash = crypto.createHash('sha256').update(String(user._id)).digest('hex');
    expect(pseudoId).not.toBe(hash);
  });

  test('behavioral records hold no identity fields', async () => {
    const { user } = await registerStudent();
    const { pseudoId } = await PseudonymMap.findOne({ userId: user._id }).lean();
    const goal = await StudyGoal.findOne({ pseudoId }).lean();
    const text = JSON.stringify(goal);
    expect(text).not.toContain(String(user._id));
    expect(text).not.toContain(user.email);
  });

  test('rejects a duplicate email with 409', async () => {
    await registerStudent({ email: 'same@example.com' });
    const res = await request(app).post('/api/auth/register').send({ email: 'same@example.com', password: 'Password123!' });
    expect(res.status).toBe(409);
    expect(await User.countDocuments()).toBe(1);
  });

  test('rejects a short password and a missing email with 400', async () => {
    const short = await request(app).post('/api/auth/register').send({ email: 'a@example.com', password: 'short' });
    expect(short.status).toBe(400);
    const missing = await request(app).post('/api/auth/register').send({ password: 'Password123!' });
    expect(missing.status).toBe(400);
    expect(await User.countDocuments()).toBe(0);
  });

  test('a registered account cannot become a researcher through the request body', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'sneaky@example.com', password: 'Password123!', role: 'researcher' });
    expect(res.status).toBe(201);
    const user = await User.findOne({ email: 'sneaky@example.com' }).lean();
    expect(user.role).toBe('student');
  });
});

describe('POST /api/auth/login and GET /api/auth/me', () => {
  test('logs in with the right password only', async () => {
    const { email, password } = await registerStudent();
    const ok = await request(app).post('/api/auth/login').send({ email, password });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toEqual(expect.any(String));

    const wrong = await request(app).post('/api/auth/login').send({ email, password: 'not-the-password' });
    expect(wrong.status).toBe(401);
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password });
    expect(unknown.status).toBe(401);
  });

  test('login repairs a missing pseudonym link', async () => {
    const { email, password, user } = await registerStudent();
    await PseudonymMap.deleteOne({ userId: user._id });
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    expect(await PseudonymMap.countDocuments({ userId: user._id })).toBe(1);
  });

  test('/me returns only the email', async () => {
    const { token, email } = await registerStudent();
    const res = await request(app).get('/api/auth/me').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ email });
  });

  test('a missing or forged token is refused', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const forged = await request(app).get('/api/auth/me').set(auth('not.a.token'));
    expect(forged.status).toBe(401);
  });
});
