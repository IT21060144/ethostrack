/**
 * trackingRoutes — mounted at /api/tracking in server.js.
 * ---------------------------------------------------------------------------
 * Every route requires a valid token. The controller converts the account id
 * into a pseudoId before writing any Behavioral Zone data.
 */
const express = require('express');
const { protect } = require('../middleware/auth');
const { recordHeartbeat, endSession, getCurrentSession } = require('../controllers/trackingController');
const { getStudyLog, exportStudyLogCsv, updateDailyGoal } = require('../controllers/studyLogController');

const router = express.Router();

router.use(protect);

// POST /api/tracking/heartbeat  { isActiveSegment: boolean }
router.post('/heartbeat', recordHeartbeat);

// POST /api/tracking/end  -> closes the open session (pause, consent off, logout)
router.post('/end', endSession);

// GET /api/tracking/current -> live counters for the open session
router.get('/current', getCurrentSession);

// GET /api/tracking/log?days=30 -> one row per day (start, end, hours, sessions...)
router.get('/log', getStudyLog);

// GET /api/tracking/log.csv?days=30 -> same rows as a CSV download
router.get('/log.csv', exportStudyLogCsv);

// PUT /api/tracking/goal { goalHours } -> daily study goal
router.put('/goal', updateDailyGoal);

module.exports = router;
