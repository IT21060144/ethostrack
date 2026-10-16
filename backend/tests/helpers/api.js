/** Small helpers shared by the API tests. */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = require('../../server');
const User = require('../../models/User');

let counter = 0;

/** Registers a fresh student through the real API and returns its token. */
async function registerStudent(overrides = {}) {
  counter += 1;
  const body = { email: `student${counter}@example.com`, password: 'Password123!', timezone: 'Asia/Colombo', ...overrides };
  const res = await request(app).post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const user = await User.findOne({ email: body.email.toLowerCase() }).lean();
  return { token: res.body.token, user, email: body.email, password: body.password };
}

/** Researchers are created directly (registration only makes students). */
async function createResearcher() {
  counter += 1;
  const user = await User.create({
    email: `researcher${counter}@example.com`,
    passwordHash: await bcrypt.hash('Password123!', 4),
    role: 'researcher',
  });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return { token, user };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = { app, request, registerStudent, createResearcher, auth };
