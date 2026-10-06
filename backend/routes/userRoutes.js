/**
 * userRoutes — mounted at /api/me in server.js.
 * ---------------------------------------------------------------------------
 * The student's own data rights. DELETE erases the account from every zone.
 */
const express = require('express');
const { protect } = require('../middleware/auth');
const { purgeEntireStudentProfile } = require('../controllers/userController');

const router = express.Router();

router.use(protect);

// DELETE /api/me -> permanent, system-wide profile erasure
router.delete('/', purgeEntireStudentProfile);

module.exports = router;
