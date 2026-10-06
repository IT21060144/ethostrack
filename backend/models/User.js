/**
 * User — Identity Zone Schema (Phase 2 & 3)
 * ---------------------------------------------------------------------------
 * Stores sensitive student authentication credentials securely isolated from
 * behavioral dataset records.
 *
 * PRIVACY SPECIFICATIONS
 * ----------------------
 * Adheres strictly to the structural boundaries of the conceptual framework.
 * This collection holds standard profile information (email, passwordHash).
 * It has NO direct relationship paths to StudySession or StudyGoal data indices.
 * The ONLY point where identity meets behavioral metrics is through the separate,
 * highly restricted PseudonymMap table.
 */
const mongoose = require('mongoose');

// Simple regex matching structural constraints for standard academic email patterns
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email address field requirement parameter is mandatory'],
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: (email) => EMAIL_REGEX.test(email),
        message: 'Please provide a structurally valid email string parameter',
      },
    },
    passwordHash: {
      type: String,
      required: [true, 'Adaptive salt password hash signature string is required'],
    },
    role: {
      type: String,
      enum: ['student'],
      default: 'student', // Enforces non-lecturer deployment restrictions by default
    },
  },
  { 
    timestamps: true // Captures createdAt and updatedAt system parameters safely
  }
);

// Strip out credentials automatically when casting mongoose objects to JSON arrays
userSchema.set('toJSON', {
  transform: (doc, ret) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);
