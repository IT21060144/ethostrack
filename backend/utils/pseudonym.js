/**
 * pseudonym — the single crossing point between the two privacy zones
 * ---------------------------------------------------------------------------
 * Every controller that needs behavioral data goes through this module, so the
 * rule "identity becomes a pseudoId exactly once, here" is enforced in one place.
 *
 * HOW THE BRIDGE WORKS
 * --------------------
 * 1. The JWT carries only the account id (Identity Zone).
 * 2. lookupHashFor() turns that id into HMAC-SHA256(PSEUDONYM_SECRET, userId).
 *    Only the server holds PSEUDONYM_SECRET, so nobody holding a database dump
 *    can recompute the hash and walk from a User to their behavior.
 * 3. resolvePseudoId() finds the PseudonymMap row by that hash and returns the
 *    random pseudoId. From then on callers query StudySession and StudyGoal by
 *    pseudoId alone and never touch the User collection.
 *
 * Keep PSEUDONYM_SECRET stable: rotating it orphans every existing mapping.
 */
const crypto = require('crypto');
const PseudonymMap = require('../models/PseudonymMap');
const HttpError = require('./HttpError');

function lookupHashFor(userId) {
  const secret = process.env.PSEUDONYM_SECRET;
  if (!secret) throw new Error('PSEUDONYM_SECRET is not configured. Check backend/.env.');
  return crypto.createHmac('sha256', secret).update(String(userId)).digest('hex');
}

// Fresh random pseudonym for a new account. It is not derived from the user id,
// so the pseudoId alone reveals nothing about who it belongs to.
function newPseudoId() {
  return crypto.randomBytes(32).toString('hex');
}

async function resolvePseudoId(userId) {
  if (!userId) throw new HttpError(401, 'Authentication required');
  const mapping = await PseudonymMap.findOne({ lookupHash: lookupHashFor(userId) })
    .select('pseudoId -_id')
    .lean();
  if (!mapping) throw new HttpError(404, 'No tracking profile found for this account');
  return mapping.pseudoId;
}

module.exports = { lookupHashFor, newPseudoId, resolvePseudoId };
