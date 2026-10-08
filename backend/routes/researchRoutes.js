/**
 * researchRoutes — mounted at /api/research in server.js.
 * ---------------------------------------------------------------------------
 * Read-only, anonymised views for an account with role 'researcher'.
 * Students get 403 here: nobody sees another student's records.
 */
const express = require('express');
const { protect, requireRole } = require('../middleware/auth');
const { getAggregates, getAnonymisedExport, getAnonymisedExportCsv } = require('../controllers/researchController');

const router = express.Router();

router.use(protect, requireRole('researcher'));

// GET /api/research/aggregates?weeks=4&epsilon=1 -> noisy cohort statistics
router.get('/aggregates', getAggregates);

// GET /api/research/export?weeks=4&k=5 -> k-anonymous session rows (JSON)
router.get('/export', getAnonymisedExport);

// GET /api/research/export.csv?weeks=4&k=5 -> same rows as a CSV download
router.get('/export.csv', getAnonymisedExportCsv);

module.exports = router;
