/**
 * StudyGoal — Behavioral Zone
 * ---------------------------------------------------------------------------
 * Student-defined goals used by the Consistency Scoring Framework (proposal
 * Section 16). Like StudySession, this collection is keyed ONLY by pseudoId:
 * it never stores a userId, email or name, so a goal record on its own cannot
 * be tied back to a person. The only bridge to identity is PseudonymMap.
 *
 * Proposal field mapping:
 *   t -> targetDaysPerWeek   (target study days per week)
 *   p -> plannedMinutesPerDay (planned minutes per study day)
 *   m -> minMinutesPerDay    (minimum active minutes for a day to count)
 */
const mongoose = require('mongoose');

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const studyGoalSchema = new mongoose.Schema(
  {
    pseudoId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    targetDaysPerWeek: {
      type: Number,
      min: 1,
      max: 7,
      default: null,
    },
    plannedMinutesPerDay: {
      type: Number,
      min: 1,
      max: 24 * 60,
      default: null,
    },
    minMinutesPerDay: {
      type: Number,
      min: 1,
      max: 24 * 60,
      default: null,
    },
    // Rest or exam-leave days as local calendar dates ("YYYY-MM-DD"). They are
    // removed from the scoring window before any component is computed.
    restDays: {
      type: [String],
      default: [],
      validate: {
        validator: (days) => days.every((d) => DATE_KEY.test(d)),
        message: 'restDays must be YYYY-MM-DD strings',
      },
    },
    // IANA time zone used to bucket sessions into local days and to read the
    // first-login hour for Rhythm. Stored here (not on User) so scoring never
    // needs to touch the Identity Zone.
    timezone: {
      type: String,
      default: 'UTC',
      validate: {
        validator: (tz) => {
          try {
            new Intl.DateTimeFormat('en-US', { timeZone: tz });
            return true;
          } catch (err) {
            return false;
          }
        },
          message: 'timezone must be a valid IANA time zone',
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StudyGoal', studyGoalSchema);
