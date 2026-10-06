/**
 * App.js — Core Frontend Application Root (Phase 4 UI Integration)
 * ---------------------------------------------------------------------------
 * Coordinates layout structure, manages data consent parameters, and executes
 * the background visibility heartbeat tracking thread continuously.
 *
 * Tracking starts automatically once the student is logged in. The choice to
 * switch it off (Privacy Centre) is remembered in this browser.
 */
import React, { useState, useEffect } from 'react';
import { DashboardView } from './components/DashboardView';
import { PrivacyCentre } from './components/PrivacyCentre';
import { AuthView } from './components/AuthView';
import { StudyLogView } from './components/StudyLogView';
import { useTrackingHeartbeat } from './hooks/useTrackingHeartbeat';
import { Brand, BrandMark, Icon } from './components/Icon';
import api, { getToken, clearToken, SESSION_EXPIRED_EVENT } from './api';

const CONSENT_KEY = 'trackingConsent';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Overview', icon: 'dashboard' },
  { id: 'log', label: 'Study log', icon: 'calendar' },
  { id: 'privacy', label: 'Privacy', icon: 'lock' },
];

// Automatic tracking is on unless the student switched it off in this browser
function readTrackingConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY) !== 'off';
  } catch (err) {
    return true;
  }
}

function App() {
  // 1. Establish state hooks for authentication checking
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [trackingConsent, setTrackingConsent] = useState(readTrackingConsent);
  const isTrackingEnabled = isAuthenticated && trackingConsent;
  const [activeTab, setActiveTab] = useState('dashboard');
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [notice, setNotice] = useState('');

  // On load, ask the server whether the stored token is still valid instead of
  // trusting localStorage. A token from an older run is dropped here.
  useEffect(() => {
    let cancelled = false;
    const verifyStoredToken = async () => {
      if (!getToken()) {
        setCheckingAuth(false);
        return;
      }
      try {
        await api.get('/auth/me');
        if (!cancelled) setIsAuthenticated(true);
      } catch (err) {
        if (err?.response?.status === 401) clearToken();
        if (!cancelled && !err?.response) {
          setNotice('Cannot reach the server on port 5001. Is the api running?');
        }
      } finally {
        if (!cancelled) setCheckingAuth(false);
      }
    };
    verifyStoredToken();
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 later on (see api.js) brings the student back to the login screen
  useEffect(() => {
    const handleExpired = () => {
      setIsAuthenticated(false);
      setActiveTab('dashboard');
      setNotice('Your session has ended. Please log in again.');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired);
  }, []);

  // 2. Invoke the background visibility heartbeat loop tracking process thread
  const { isPaused, isIdle, sessionActive, session, lastError, togglePause, endSession } =
    useTrackingHeartbeat(isTrackingEnabled);

  const handleConsentChange = (enabled) => {
    setTrackingConsent(enabled);
    try {
      localStorage.setItem(CONSENT_KEY, enabled ? 'on' : 'off');
    } catch (err) {
      // Storage blocked: the choice still applies until the page reloads
    }
  };

  // Close any open study session while the token is still valid, then clear it
  const handleLogout = async () => {
    if (isTrackingEnabled) {
      await endSession();
    }
    clearToken();
    setIsAuthenticated(false); // Tracking stops with the login
    setActiveTab('dashboard');
  };

  // After a permanent erasure the token points at nothing, so drop it
  const handleAccountDeleted = () => {
    clearToken();
    setIsAuthenticated(false);
    setActiveTab('dashboard');
    setNotice('Your account and all of its study data were permanently erased.');
  };

  // Prevent flash screens while the stored token is being checked
  if (checkingAuth) {
    return (
      <div className="splash">
        <div className="inner">
          <BrandMark size={44} />
          <div className="spinner" />
          <span>Loading EthosTrack…</span>
        </div>
      </div>
    );
  }

  // 3. Force security authentication gateway view check before loading widgets
  if (!isAuthenticated) {
    return (
      <AuthView
        notice={notice}
        onAuthSuccess={() => {
          setNotice('');
          setIsAuthenticated(true);
        }}
      />
    );
  }

  const navButtons = NAV_ITEMS.map((item) => (
    <button
      key={item.id}
      type="button"
      className="nav-item"
      aria-current={activeTab === item.id ? 'page' : undefined}
      onClick={() => setActiveTab(item.id)}
    >
      <Icon name={item.icon} />
      {item.label}
    </button>
  ));

  // Live tracking status shown above every page
  let trackerState = 'is-off';
  let trackerIcon = 'pause';
  let trackerText = 'Tracking is off. Nothing is being recorded.';
  if (isTrackingEnabled && isPaused) {
    trackerState = 'is-idle';
    trackerText = 'Tracking paused. Nothing is being recorded.';
  } else if (isTrackingEnabled && isIdle) {
    trackerState = 'is-idle';
    trackerIcon = 'coffee';
    trackerText = 'No activity detected. This time counts as a break.';
  } else if (isTrackingEnabled) {
    trackerState = 'is-active';
    trackerIcon = null;
    trackerText = 'Tracking your study time automatically.';
  }

  return (
    <div className="shell">
      {/* Sidebar (wide screens) */}
      <aside className="sidebar">
        <Brand />
        <nav className="nav" aria-label="Main">
          {navButtons}
        </nav>
        <div className="sidebar-foot">
          <div className="privacy-note">
            <strong>
              <Icon name="shieldCheck" size={16} /> Private by design
            </strong>
            Your name and your study data are stored apart.
          </div>
          <button type="button" className="nav-item" onClick={handleLogout}>
            <Icon name="logout" />
            Log out
          </button>
        </div>
      </aside>

      {/* Top bar and tabs (phones) */}
      <header className="topbar">
        <div className="topbar-row">
          <Brand />
          <button type="button" className="btn btn-ghost" onClick={handleLogout} aria-label="Log out">
            <Icon name="logout" />
          </button>
        </div>
        <nav className="tabs" aria-label="Main">
          {navButtons}
        </nav>
      </header>

      <main className="main">
        <div className="container">
          <div className={`tracker-bar ${trackerState}`} role="status">
            <span className="left">
              {trackerIcon ? <Icon name={trackerIcon} /> : <i className="dot dot-live" />}
              {trackerText}
            </span>
            {isTrackingEnabled && sessionActive && session && (
              <span className="live">Live · {Math.floor(session.activeSeconds / 60)} min active</span>
            )}
            {!isTrackingEnabled && (
              <button type="button" className="btn-link" onClick={() => setActiveTab('privacy')}>
                Turn on
              </button>
            )}
          </div>

          {isTrackingEnabled && lastError && (
            <div className="alert alert-warn" style={{ marginBottom: 20 }}>
              <Icon name="alert" />
              {lastError}
            </div>
          )}
        </div>

        {activeTab === 'dashboard' && <DashboardView />}
        {activeTab === 'log' && <StudyLogView />}
        {activeTab === 'privacy' && (
          <PrivacyCentre
            isTrackingEnabled={isTrackingEnabled}
            onConsentChange={handleConsentChange}
            togglePause={togglePause}
            isPaused={isPaused}
            onAccountDeleted={handleAccountDeleted}
          />
        )}
      </main>
    </div>
  );
}

export default App;
