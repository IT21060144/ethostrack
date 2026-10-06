/**
 * Dashboard routes — mounted at /api/dashboard in server.js.
 * ---------------------------------------------------------------------------
 * Every route requires authentication. The controllers resolve the account
 * id to a pseudoId and work only with Behavioral Zone data from there on.
 */
const express = require('express');
const { protect } = require('../middleware/auth');
const { getDashboardMetrics } = require('../controllers/scoreController');

const router = express.Router();

// Protects all routes declared below this line with our JWT validation shield
router.use(protect);

/**
 * @route   GET /api/dashboard?window=week|rolling&date=YYYY-MM-DD
 * @desc    Fetch a student's calculated consistency metrics
 * @access  Private
 */
router.get('/', getDashboardMetrics);

module.exports = router;
