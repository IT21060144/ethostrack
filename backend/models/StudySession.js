/**
 * StudySession — Behavioral Zone Schema (Phase 2 & 3)
 * ---------------------------------------------------------------------------
 * Records background heartbeat logs autonomously, keeping track of active 
 * study durations versus idle thresholds.
 *
 * PRIVACY SPECIFICATIONS
 * ----------------------
 * Adheres strictly to the structural boundaries of the conceptual framework.
 * This collection is keyed ONLY by the anonymous `pseudoId` string key.
 * It contains zero fields linking to usernames, emails, or real account IDs.
 * This keeps all active study logs completely anonymous if anyone inspects the database.
 */
const mongoose = require('mongoose');

const studySessionSchema = new mongoose.Schema(
  {
    pseudoId: {
      type: String,
      required: true,
      index: true,
    },
    loginTime: {
      type: Date,
      required: true,
    },
    logoutTime: {
      type: Date,
      default: null,
    },
    activeSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    idleSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    // The server heartbeat ping tracking timestamp updates
    lastHeartbeat: {
      type: Date,
      default: Date.now,
    },
    // Time of the last heartbeat that reported real activity (keyboard, mouse,
    // visible tab). Used to end a session cleanly when the student walks away.
    lastActiveAt: {
      type: Date,
      default: null,
    },
    endReason: {
      type: String,
      // explicit: pause, consent off, logout or tab closed
      // timeout:  heartbeats stopped (laptop asleep or lid closed, network lost)
      // idle:     no keyboard or mouse activity for IDLE_END_SECONDS
      enum: ['explicit', 'timeout', 'idle'],
      default: 'explicit',
    },
  },
  { 
    timestamps: true 
  }
);

// Optimize queries for the scoring engine to calculate weeks or 4-week windows quickly
studySessionSchema.index({ pseudoId: 1, loginTime: -1 });

module.exports = mongoose.model('StudySession', studySessionSchema);
