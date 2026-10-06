/**
 * authRoutes — Authentication API Routing (Phase 3 Core)
 * ---------------------------------------------------------------------------
 * Maps external registration and logging entry requests directly to our 
 * internal Identity Zone encryption controller modules.
 *
 * SECURITY BOUNDARY
 * -----------------
 * These routes are explicitly public to enable profile registration and access 
 * token returns. Downstream routes automatically intercept these tokens to calculate 
 * privacy-isolated consistency scoring parameters.
 */
const express = require('express');
const router = express.Router();
const { registerUser, loginUser, getSession } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

/**
 * @route   POST /api/auth/register
 * @desc    Register a new student account and initialize a corresponding pseudonym track
 * @access  Public
 */
router.post('/register', registerUser);

/**
 * @route   POST /api/auth/login
 * @desc    Validate credentials and generate a JSON Web Token string
 * @access  Public
 */
router.post('/login', loginUser);

/**
 * @route   GET /api/auth/me
 * @desc    Confirm a stored token is still valid (used on page load)
 * @access  Private
 */
router.get('/me', protect, getSession);

module.exports = router;
