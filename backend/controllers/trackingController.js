/**
 * trackingController — Browser Heartbeat Session Engine (Phase 3)
 * ---------------------------------------------------------------------------
 * The React client sends a heartbeat every HEARTBEAT_INTERVAL seconds while the
 * student has tracking consent switched on. Each beat says whether the last
 * interval was active (tab visible, not paused) or idle (tab hidden).
 *
 * SESSION RULES
 * -------------
 * - The first active beat with no open session opens one (loginTime = now).
 *   Idle beats never open a session, so a hidden tab cannot start tracking.
 * - Each later beat credits the time since lastHeartbeat to activeSeconds or
 *   idleSeconds. The credit is capped at MAX_CREDIT_SECONDS so a laptop that
 *   slept for an hour is not counted as an hour of study.
 * - If no beat arrives for SESSION_TIMEOUT_SECONDS the session is considered
 *   abandoned (closed tab, lost network). The next beat closes it with
 *   endReason 'timeout' at its last heartbeat and opens a new one.
 * - Idle beats (tab hidden, or no keyboard/mouse for a few minutes) count as
 *   breaks. After IDLE_END_SECONDS of nothing but idle beats the session is
 *   closed with endReason 'idle' at the last active moment.
 * - POST /end closes the open session with endReason 'explicit' (pause,
 *   consent withdrawn, logout).
 *
 * PRIVACY BOUNDARY
 * ----------------
 * The account id from the token is converted to a pseudoId once, through
 * utils/pseudonym. StudySession rows only ever hold that pseudoId, and the
 * responses below carry no identifier at all, only the student's own counters.
 */
const StudySession = require('../models/StudySession');
const { resolvePseudoId } = require('../utils/pseudonym');
const { syncTimeZone } = require('../utils/timeZone');

const HEARTBEAT_INTERVAL_SECONDS = Number(process.env.HEARTBEAT_INTERVAL_SECONDS) || 30;
// Browsers throttle timers in background tabs to about once a minute, so allow
// a little more than two intervals of credit per beat.
const MAX_CREDIT_SECONDS = Math.max(HEARTBEAT_INTERVAL_SECONDS * 2, 65);
const SESSION_TIMEOUT_SECONDS = Number(process.env.SESSION_TIMEOUT_SECONDS) || 5 * 60;
// A session whose heartbeats have reported only idle time for this long is
// closed at the moment activity stopped; the next active beat starts a new one.
const IDLE_END_SECONDS = Number(process.env.IDLE_END_SECONDS) || 10 * 60;

function publicView(session) {
  if (!session) return null;
  return {
    open: !session.logoutTime,
    loginTime: session.loginTime,
    lastHeartbeat: session.lastHeartbeat,
    activeSeconds: session.activeSeconds,
    idleSeconds: session.idleSeconds,
    endReason: session.logoutTime ? session.endReason : null,
  };
}

async function findOpenSession(pseudoId) {
  return StudySession.findOne({ pseudoId, logoutTime: null }).sort({ loginTime: -1 });
}

async function closeSession(session, endTime, reason) {
  session.logoutTime = endTime;
  session.endReason = reason;
  await session.save();
  return session;
}

/**
 * POST /api/tracking/heartbeat
 * Body: { isActiveSegment: boolean, timezone?: IANA zone from the browser }
 */
async function recordHeartbeat(req, res, next) {
  try {
    const pseudoId = await resolvePseudoId(req.user?.id);
    const isActive = req.body?.isActiveSegment === true;
    const now = new Date();
    await syncTimeZone(pseudoId, req.body?.timezone);

    let session = await findOpenSession(pseudoId);

    // Abandoned session: close it where the last beat left off.
    if (session && (now - session.lastHeartbeat) / 1000 > SESSION_TIMEOUT_SECONDS) {
      await closeSession(session, session.lastHeartbeat, 'timeout');
      session = null;
    }

    // Walked away: only idle beats since lastActiveAt. End the session when the
    // activity stopped and take the trailing idle time back off the break total.
    if (session && !isActive) {
      const lastActive = session.lastActiveAt || session.loginTime;
      if ((now - lastActive) / 1000 > IDLE_END_SECONDS) {
        const trailingIdle = Math.max(0, Math.round((session.lastHeartbeat - lastActive) / 1000));
        session.idleSeconds = Math.max(0, session.idleSeconds - trailingIdle);
        session.lastHeartbeat = lastActive;
        await closeSession(session, lastActive, 'idle');
        session = null;
      }
    }

    if (!session) {
      if (!isActive) {
        return res.status(200).json({ success: true, tracking: false, session: null });
      }
      session = await StudySession.create({
        pseudoId,
        loginTime: now,
        lastHeartbeat: now,
        lastActiveAt: now,
        activeSeconds: 0,
        idleSeconds: 0,
        endReason: 'explicit',
      });
      return res.status(201).json({ success: true, tracking: true, session: publicView(session) });
    }

    const elapsed = Math.max(0, Math.min((now - session.lastHeartbeat) / 1000, MAX_CREDIT_SECONDS));
    const credit = Math.round(elapsed);
    const update = {
      $set: isActive ? { lastHeartbeat: now, lastActiveAt: now } : { lastHeartbeat: now },
      $inc: isActive ? { activeSeconds: credit } : { idleSeconds: credit },
    };
    const updated = await StudySession.findOneAndUpdate(
      { _id: session._id, logoutTime: null },
      update,
      { new: true }
    );

    return res.status(200).json({ success: true, tracking: true, session: publicView(updated) });
  } catch (error) {
    return next(error);
  }
}

/**
 * POST /api/tracking/end
 * Body (optional): { isActiveSegment: boolean } for the time since the last beat.
 * Closes the open session, if any. Safe to call repeatedly.
 */
async function endSession(req, res, next) {
  try {
    const pseudoId = await resolvePseudoId(req.user?.id);
    const session = await findOpenSession(pseudoId);
    if (!session) {
      return res.status(200).json({ success: true, session: null });
    }

    const now = new Date();
    const sinceLastBeat = (now - session.lastHeartbeat) / 1000;
    const timedOut = sinceLastBeat > SESSION_TIMEOUT_SECONDS;
    if (!timedOut) {
      // Credit the partial interval since the last beat, like a final heartbeat
      const credit = Math.round(Math.max(0, Math.min(sinceLastBeat, MAX_CREDIT_SECONDS)));
      if (req.body?.isActiveSegment === true) session.activeSeconds += credit;
      else session.idleSeconds += credit;
      session.lastHeartbeat = now;
    }
    await closeSession(session, timedOut ? session.lastHeartbeat : now, timedOut ? 'timeout' : 'explicit');
    return res.status(200).json({ success: true, session: publicView(session) });
  } catch (error) {
    return next(error);
  }
}

/**
 * GET /api/tracking/current
 * Returns the open session's counters so the UI can show live progress.
 */
async function getCurrentSession(req, res, next) {
  try {
    const pseudoId = await resolvePseudoId(req.user?.id);
    const session = await findOpenSession(pseudoId);
    return res.status(200).json({ success: true, session: publicView(session) });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  recordHeartbeat,
  endSession,
  getCurrentSession,
  HEARTBEAT_INTERVAL_SECONDS,
  SESSION_TIMEOUT_SECONDS,
};
