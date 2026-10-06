/**
 * authController — Account Manager & Privacy Map Engine (Phase 3)
 * ---------------------------------------------------------------------------
 * Handles user account registration and login validations while creating
 * isolated cryptographic identity boundaries.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const PseudonymMap = require('../models/PseudonymMap');
const StudyGoal = require('../models/StudyGoal');
const HttpError = require('../utils/HttpError');
const { lookupHashFor, newPseudoId } = require('../utils/pseudonym');
const { isValidTimeZone } = require('../utils/timeZone');

// Generates an authorization token string matching the Identity Zone secrets
const generateToken = (id) => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured. Check backend/.env.');
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '7d', // Session window expiration threshold limits
  });
};

/**
 * registerUser — Create Account & Mount Pseudonym Perimeter
 */
const registerUser = async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      throw new HttpError(400, 'Please provide all standard credential parameters');
    }
    if (password.length < 8) {
      throw new HttpError(400, 'Password must be at least 8 characters long');
    }

    // Enforce duplication safeguards
    const userExists = await User.findOne({ email });
    if (userExists) {
      throw new HttpError(409, 'An account utilizing that email parameter already exists');
    }

    // 1. Hash credentials before database commitment (Adaptive Salt)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 2. Commit account credentials to the Identity Zone
    const newUser = await User.create({
      email,
      passwordHash,
    });

    // 3. Generate a random pseudoId (not derived from the user id) and the
    //    keyed hash the server will later use to find it again.
    const pseudoId = newPseudoId();
    const lookupHash = lookupHashFor(newUser._id);

    try {
      // 4. Populate the Bridge collection: the only row that links both zones
      await PseudonymMap.create({ pseudoId, userId: newUser._id, lookupHash });

      // 5. Initialize a baseline goal record inside the Behavioral Zone,
      //    keyed only by pseudoId
      await StudyGoal.create({
        pseudoId,
        // The student's own device zone; Sri Lanka as the fallback
        timezone: isValidTimeZone(req.body?.timezone) ? req.body.timezone : 'Asia/Colombo',
      });
    } catch (bridgeError) {
      // Roll back so a half-created account cannot log in without a tracking profile
      await Promise.all([
        PseudonymMap.deleteOne({ userId: newUser._id }),
        StudyGoal.deleteOne({ pseudoId }),
        User.deleteOne({ _id: newUser._id }),
      ]);
      throw bridgeError;
    }

    // Return authorization parameters securely wrapped in standard JSON arrays
    return res.status(201).json({
      success: true,
      token: generateToken(newUser._id),
    });

  } catch (error) {
    return next(error);
  }
};

/**
 * ensureTrackingProfile — repairs the privacy bridge for an existing account.
 * Accounts created by an older build (or before PSEUDONYM_SECRET changed) can
 * be missing their PseudonymMap row, or carry a lookupHash made with another
 * key. Without this, they log in fine but every tracking call returns 404.
 */
const ensureTrackingProfile = async (userId) => {
  const lookupHash = lookupHashFor(userId);
  let mapping = await PseudonymMap.findOne({ userId });

  if (!mapping) {
    mapping = await PseudonymMap.create({ pseudoId: newPseudoId(), userId, lookupHash });
  } else if (mapping.lookupHash !== lookupHash) {
    mapping.lookupHash = lookupHash;
    await mapping.save();
  }

  await StudyGoal.updateOne(
    { pseudoId: mapping.pseudoId },
    { $setOnInsert: { pseudoId: mapping.pseudoId, timezone: 'Asia/Colombo' } },
    { upsert: true }
  );
};

/**
 * loginUser — Validate Credentials and Access Dashboards
 */
const loginUser = async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      throw new HttpError(400, 'Missing necessary account login configurations');
    }

    const user = await User.findOne({ email });
    if (!user) {
      throw new HttpError(401, 'Invalid authentication credential details provided');
    }

    // Verify adaptive salt string configurations matching local parameters
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      throw new HttpError(401, 'Invalid authentication credential details provided');
    }

    await ensureTrackingProfile(user._id);

    return res.status(200).json({
      success: true,
      token: generateToken(user._id),
    });

  } catch (error) {
    return next(error);
  }
};

/**
 * getSession — GET /api/auth/me
 * Lets the client check a stored token on page load. Returns only the email
 * (Identity Zone), never anything from the Behavioral Zone.
 */
const getSession = async (req, res, next) => {
  try {
    const user = await User.findById(req.user?.id).select('email').lean();
    if (!user) {
      throw new HttpError(401, 'Your session has ended. Please log in again.');
    }
    await ensureTrackingProfile(user._id);
    return res.status(200).json({ success: true, user: { email: user.email } });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  registerUser,
  loginUser,
  getSession,
};
