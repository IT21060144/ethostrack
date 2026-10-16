/**
 * server.js — EthosTrack API entry point
 * ---------------------------------------------------------------------------
 * Route map
 *   /api/auth       register + login (Identity Zone, public)
 *   /api/tracking   heartbeat session tracking (Behavioral Zone, by pseudoId)
 *   /api/dashboard  consistency score (Behavioral Zone, by pseudoId)
 *   /api/me         the student's own data rights (erase everything)
 *   /api/research   anonymised aggregates and k-anonymous export (researcher
 *                   role only; privacy/ is the only route to this data)
 *   /api/presence   "a tab is open" ping used by utils/autoOpen (no data)
 *   /api/device/activity  seconds since the Mac was last used (utils/deviceActivity)
 *   /               the built React app (frontend/build), when it exists, so
 *                   one process on port 5001 runs everything (macOS auto-start)
 *
 * Privacy note: only utils/pseudonym crosses from a user id to a pseudoId.
 * Error responses never echo database internals back to the browser.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const trackingRoutes = require('./routes/trackingRoutes');
const userRoutes = require('./routes/userRoutes');
const researchRoutes = require('./routes/researchRoutes');
const { startAutoOpen, recordPresence } = require('./utils/autoOpen');
const { getDeviceActivity } = require('./utils/deviceActivity');
const { protect } = require('./middleware/auth');

const app = express();
const PORT = Number(process.env.PORT) || 5001;

// CORS_ORIGIN may be a comma-separated list; defaults to the React dev server.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');
// Web hosts put a proxy (HTTPS) in front of Node; trust its one hop.
app.set('trust proxy', 1);
app.use(helmet());
// In development any origin is accepted, so the app also works when opened
// from the "On Your Network" address. Production uses CORS_ORIGIN only.
const isDevelopment = (process.env.NODE_ENV || 'development') === 'development';
app.use(cors({ origin: isDevelopment ? true : allowedOrigins }));
app.use(express.json({ limit: '10kb' }));

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/me', userRoutes);
app.use('/api/research', researchRoutes);
app.get('/api/presence', recordPresence);
app.get('/api/device/activity', protect, getDeviceActivity);

// The built React app (npm run build in frontend/). Any non-API path returns
// index.html so a browser refresh on any page still loads the app.
const FRONTEND_BUILD_DIR = process.env.FRONTEND_BUILD_DIR || path.join(__dirname, '..', 'frontend', 'build');
if (fs.existsSync(path.join(FRONTEND_BUILD_DIR, 'index.html'))) {
  app.use(express.static(FRONTEND_BUILD_DIR, { index: false }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_BUILD_DIR, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { message: `Route not found: ${req.method} ${req.originalUrl}` },
  });
});

// Translate known library errors into client errors instead of generic 500s.
function statusFor(error) {
  if (error.status) return Number(error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return 400;
  if (error.code === 11000) return 409;
  return 500;
}

function messageFor(error, status) {
  if (status >= 500) return 'An unexpected server error occurred.';
  if (error.name === 'ValidationError') {
    return Object.values(error.errors).map((e) => e.message).join(' ');
  }
  if (error.name === 'CastError') return 'Invalid request value.';
  if (error.code === 11000) return 'That record already exists.';
  if (error.type === 'entity.parse.failed') return 'Request body is not valid JSON.';
  return error.message;
}

// eslint-disable-next-line no-unused-vars
app.use((error, _req, res, _next) => {
  const status = statusFor(error);
  if (status >= 500) {
    console.error('[Server Error]', error);
  }
  res.status(status).json({
    success: false,
    error: { message: messageFor(error, status) },
  });
});

// Keeps trying until MongoDB is up. At login the database may start a few
// seconds after this server, so a first failure is not fatal.
async function connectWithRetry() {
  for (;;) {
    try {
      await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
      console.log('MongoDB connected');
      return;
    } catch (error) {
      console.error('[Database] Not reachable yet, retrying in 5 s:', error.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function startServer() {
  const missing = ['MONGO_URI', 'JWT_SECRET', 'PSEUDONYM_SECRET'].filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`${missing.join(', ')} not configured. Copy backend/.env.example to backend/.env, or on a web host add them as environment variables.`);
  }

  await connectWithRetry();

  const server = app.listen(PORT, () => {
    console.log(`EthosTrack API listening on port ${PORT}`);
    // Set by the macOS LaunchAgent only (mac/install.sh)
    if (process.env.ETHOSTRACK_AUTO_OPEN === '1') {
      startAutoOpen({ url: `http://localhost:${PORT}` });
    }
  });
  server.on('error', (error) => {
    console.error('[Startup Error]', error.code === 'EADDRINUSE' ? `Port ${PORT} is already in use.` : error.message);
    process.exit(1);
  });
}

function run() {
  startServer().catch((error) => {
    console.error('[Startup Error]', error.message);
    process.exit(1);
  });
}

if (require.main === module) {
  run();
}

module.exports = app;
// Used by the web bundle's app.js, for hosts that load a startup file.
module.exports.run = run;
