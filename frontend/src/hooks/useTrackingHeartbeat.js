/**
 * useTrackingHeartbeat — Automatic Study Tracking Hook (Phase 4)
 * ---------------------------------------------------------------------------
 * While the student is logged in and tracking is on (the default; it can be
 * switched off in the Privacy Centre), sends a heartbeat to the API every
 * 30 seconds, and straight away when the tab is shown or hidden.
 *
 * WHAT COUNTS AS STUDY
 * --------------------
 * - active: the keyboard, mouse or trackpad was used in the last
 *   IDLE_AFTER_MS, in any tab or app. On a Mac the local server reports how
 *   long ago the computer was last touched (GET /api/device/activity), so
 *   working in another tab or app still counts. Elsewhere only input inside
 *   this tab, while it is visible, counts.
 * - idle:   no input for IDLE_AFTER_MS. Counted as a break.
 * - closed lid / sleep: heartbeats stop, and the server ends the session at
 *   the last heartbeat once SESSION_TIMEOUT_SECONDS passes.
 * - tab closed: a final "end" request is sent as the page unloads.
 *
 * PRIVACY
 * -------
 * Only a true/false activity flag is stored. Keystrokes, mouse positions,
 * URLs, app names and window titles are never read or sent; the input
 * listeners below only note *that* input happened, and the Mac reports only
 * the number of seconds since the last input.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import api, { API_BASE_URL, IS_LOCAL_SERVER, getToken, deviceTimeZone } from '../api';

const HEARTBEAT_INTERVAL_MS = 30000;
const IDLE_AFTER_MS = 5 * 60 * 1000;
const INPUT_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];

export const useTrackingHeartbeat = (isTrackingEnabled) => {
  const [isPaused, setIsPaused] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [session, setSession] = useState(null);
  const [isIdle, setIsIdle] = useState(false);
  const [lastError, setLastError] = useState('');
  const runningRef = useRef(false);
  const lastInputRef = useRef(Date.now());

  const endSession = useCallback(async () => {
    if (!getToken()) {
      setSessionActive(false);
      setSession(null);
      return;
    }
    try {
      await api.post('/tracking/end', {
        isActiveSegment: document.visibilityState === 'visible',
      });
    } catch (err) {
      // A failed close is not fatal: the server times the session out.
      console.warn('[Tracker] Could not close session:', err.message);
    }
    setSessionActive(false);
    setSession(null);
  }, []);

  useEffect(() => {
    const shouldRun = isTrackingEnabled && !isPaused;

    if (!shouldRun) {
      if (runningRef.current) {
        runningRef.current = false;
        endSession();
      }
      return undefined;
    }

    runningRef.current = true;
    lastInputRef.current = Date.now();

    // Last answer from the Mac: seconds since any input, or null when unknown
    let deviceIdleSeconds = null;

    const isActiveNow = () => {
      if (deviceIdleSeconds !== null && deviceIdleSeconds * 1000 < IDLE_AFTER_MS) return true;
      return document.visibilityState === 'visible' && Date.now() - lastInputRef.current < IDLE_AFTER_MS;
    };

    const refreshDeviceActivity = async () => {
      if (!IS_LOCAL_SERVER) return; // A web host cannot see this computer
      try {
        const { data } = await api.get('/device/activity');
        deviceIdleSeconds = data.available ? data.idleSeconds : null;
      } catch (err) {
        deviceIdleSeconds = null; // Older server or not a Mac: use this tab's input only
      }
    };

    const sendHeartbeat = async () => {
      await refreshDeviceActivity();
      const isActiveSegment = isActiveNow();
      setIsIdle(!isActiveSegment);
      try {
        const { data } = await api.post('/tracking/heartbeat', {
          isActiveSegment,
          timezone: deviceTimeZone(),
        });
        setSessionActive(Boolean(data.tracking));
        setSession(data.session);
        setLastError('');
      } catch (err) {
        if (err?.response?.status === 401) return; // App signs the user out
        setLastError(err?.response?.data?.error?.message || 'Tracking could not reach the server.');
      }
    };

    // Coming back after being idle sends a beat at once so a new session
    // starts without waiting for the next 30-second tick.
    const handleInput = () => {
      const wasIdle = Date.now() - lastInputRef.current >= IDLE_AFTER_MS;
      lastInputRef.current = Date.now();
      if (wasIdle) sendHeartbeat();
    };

    // Closing the tab or window: fetch with keepalive survives the unload and,
    // unlike sendBeacon, can carry the Authorization header.
    const handlePageHide = () => {
      const token = getToken();
      if (!token) return;
      fetch(`${API_BASE_URL}/api/tracking/end`, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isActiveSegment: isActiveNow() }),
      }).catch(() => {});
    };

    INPUT_EVENTS.forEach((evt) => window.addEventListener(evt, handleInput, { passive: true }));
    document.addEventListener('visibilitychange', sendHeartbeat);
    window.addEventListener('pagehide', handlePageHide);
    sendHeartbeat();
    const intervalId = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      INPUT_EVENTS.forEach((evt) => window.removeEventListener(evt, handleInput));
      document.removeEventListener('visibilitychange', sendHeartbeat);
      window.removeEventListener('pagehide', handlePageHide);
      clearInterval(intervalId);
    };
  }, [isTrackingEnabled, isPaused, endSession]);

  const togglePause = useCallback(() => setIsPaused((prev) => !prev), []);

  return { isPaused, isIdle, sessionActive, session, lastError, togglePause, endSession };
};
