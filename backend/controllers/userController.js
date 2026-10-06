/**
 * userController — Student Rights & Data Purging System (Phase 5)
 * ---------------------------------------------------------------------------
 * Implements the absolute data erasure rights required by data protection 
 * guidelines (GDPR & Sri Lanka Data Protection Act) .
 *
 * PRIVACY SPECIFICATIONS
 * ----------------------
 * When a student requests account deletion, this service completely breaks
 * the privacy bridge. It deletes records across both structural zones:
 * 1. Purges the User credentials from the Identity Zone.
 * 2. Purges the bridging keys from the PseudonymMap collection.
 * 3. Wipes out all logs and goals from the Behavioral Zone .
 */
const User = require('../models/User');
const PseudonymMap = require('../models/PseudonymMap');
const StudySession = require('../models/StudySession');
const StudyGoal = require('../models/StudyGoal');
const HttpError = require('../utils/HttpError');

/**
 * purgeEntireStudentProfile — Irreversible System-Wide Erasure
 */
const purgeEntireStudentProfile = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      throw new HttpError(401, 'Unauthorized database request: Token mismatch');
    }

    // 1. Locate the secure bridge mapping document inside the perimeter
    const mapping = await PseudonymMap.findOne({ userId });
    if (!mapping) {
      throw new HttpError(404, 'No track records found for this user account context');
    }

    const pseudoId = mapping.pseudoId;

    // 2. Parallel Processing execution block: Erase every behavioral record completely
    // Identifiers are deliberately kept out of the logs: a log line pairing a
    // userId with a pseudoId would be a second, unprotected bridge.
    await Promise.all([
      StudySession.deleteMany({ pseudoId }), // Purges visibility heartbeats
      StudyGoal.deleteMany({ pseudoId }),    // Purges personal calendar profiles
      PseudonymMap.deleteOne({ userId }),    // Destroys the one-way matching link
      User.deleteOne({ _id: userId })        // Purges raw credentials from Identity Zone
    ]);

    console.log('[Privacy Service] An account was erased from all zones.');

    // Return confirmation status wrapper response
    return res.status(200).json({
      success: true,
      message: 'Your profile records and tracking metrics have been permanently and cleanly destroyed.'
    });

  } catch (error) {
    return next(error);
  }
};

module.exports = {
  purgeEntireStudentProfile
};
