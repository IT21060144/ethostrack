/**
 * Test database helper for the integration and simulation tests.
 *
 * Uses TEST_MONGO_URI when set, otherwise a local MongoDB at
 * mongodb://127.0.0.1:27017. Each test file gets its own database name, which
 * is dropped afterwards. MONGO_URI from backend/.env is never used, so the
 * tests cannot touch real or deployed data.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');

const BASE_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017';

async function connectTestDb() {
  const dbName = `ethostrack_test_${crypto.randomBytes(4).toString('hex')}`;
  try {
    await mongoose.connect(BASE_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  } catch (error) {
    throw new Error(
      `Integration tests need a MongoDB at ${BASE_URI} (set TEST_MONGO_URI to use another). ` +
        `Unit tests alone run with "npm run test:unit". Cause: ${error.message}`
    );
  }
  // Unique indexes (email, pseudoId, lookupHash) must exist before tests rely on them
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}

async function clearTestDb() {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
}

async function closeTestDb() {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}

module.exports = { connectTestDb, clearTestDb, closeTestDb };
