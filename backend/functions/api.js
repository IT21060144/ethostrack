/**
 * functions/api.js — the whole Express API as one Netlify Function
 * ---------------------------------------------------------------------------
 * On Netlify the React build is served as static files and every /api/*
 * request is rewritten (netlify.toml) to this function, which hands it to the
 * same Express app server.js uses on the Mac. Routes, auth and the
 * PseudonymMap privacy boundary are therefore identical in both places.
 *
 * A function instance is reused between requests while it stays warm, so the
 * MongoDB connection is opened once and kept, not opened per request.
 * Nothing runs between requests: open sessions are closed lazily on the next
 * heartbeat (SESSION_TIMEOUT_SECONDS), which works the same without timers.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const serverless = require('serverless-http');
const mongoose = require('mongoose');
const app = require('../server');

const REQUIRED_SETTINGS = ['MONGO_URI', 'JWT_SECRET', 'PSEUDONYM_SECRET'];
const FUNCTION_PREFIX = '/.netlify/functions/api';

let connecting = null;

function connectOnce() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (!connecting) {
    connecting = mongoose
      .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 })
      .catch((error) => {
        connecting = null; // Let the next request try again
        throw error;
      });
  }
  return connecting;
}

const handleWithExpress = serverless(app, {
  // A request may arrive as /api/... (rewrite) or /.netlify/functions/api/...
  // (called directly); Express routes are mounted under /api either way.
  request(req) {
    if (req.url.startsWith(FUNCTION_PREFIX)) {
      req.url = `/api${req.url.slice(FUNCTION_PREFIX.length)}`;
    }
  },
});

function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ success: false, error: { message } }),
  };
}

exports.handler = async (event, context) => {
  // Return as soon as the response is ready, even with the database
  // connection still open for the next request.
  context.callbackWaitsForEmptyEventLoop = false;

  const missing = REQUIRED_SETTINGS.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error('[Startup Error]', `${missing.join(', ')} not set in Netlify environment variables.`);
    return errorResponse(500, 'The server is not configured yet.');
  }

  try {
    await connectOnce();
  } catch (error) {
    console.error('[Database] Not reachable:', error.message);
    return errorResponse(503, 'The database is not reachable right now. Please try again shortly.');
  }

  return handleWithExpress(event, context);
};
