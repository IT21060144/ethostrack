/**
 * PseudonymMap — The Privacy Bridge Schema (Phase 2 & 3)
 * ---------------------------------------------------------------------------
 * Connects authenticated student user accounts to their behavioral tracking 
 * logs using an isolated, one-way cryptographic lookup hash.
 *
 * PRIVACY SPECIFICATIONS
 * ----------------------
 * This table forms the absolute operational boundary of our Privacy-by-Design 
 * architecture. It maps a userId (Identity Zone) to a pseudoId (Behavioral Zone).
 * Access to this collection must be restricted strictly to the authentication 
 * module. Withholding access to this table makes behavioral tracking logs completely 
 * unlinkable to any real student profile.
 */
const mongoose = require('mongoose');

const pseudonymMapSchema = new mongoose.Schema(
  {
    pseudoId: {
      type: String,
      required: true,
      unique: true,
      index: true, // Optimized for fast lookups during heartbeat updates
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // The HMAC result hash used by the server to safely query profile mappings
    lookupHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    }
  },
  { 
    timestamps: true 
  }
);

module.exports = mongoose.model('PseudonymMap', pseudonymMapSchema);
