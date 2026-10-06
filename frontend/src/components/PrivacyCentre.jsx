/**
 * PrivacyCentre — Student Control Panel (Phase 4 UI Component)
 * ---------------------------------------------------------------------------
 * Provides an interactive interface that gives students complete control
 * over their data streams, fulfilling the legal and ethical goals of the project.
 *
 * PROPOSAL REQUIREMENTS SATISFIED
 * ------------------------------
 * 1. Transparency: shows how data is split across the Identity Zone,
 *    PseudonymMap and Behavioral Zone, and lets tracking be switched off.
 * 2. Pause Control: operates the active/paused states of the heartbeat hook.
 * 3. Right to Deletion: DELETE /api/me erases the account from every zone.
 */
import React, { useState } from 'react';
import api, { errorMessage } from '../api';
import { Icon } from './Icon';

const Toggle = ({ on, onClick }) => (
  <button type="button" role="switch" aria-checked={on} aria-label="Automatic study tracking" onClick={onClick} className="switch">
    <span />
  </button>
);

export const PrivacyCentre = ({ isTrackingEnabled, onConsentChange, togglePause, isPaused, onAccountDeleted }) => {
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Handle permanent data purging requested by the user
  const handlePermanentDeletion = async () => {
    setLoading(true);
    setStatusMessage('');

    try {
      await api.delete('/me');
      // Sign out at once so no heartbeat is sent for an account that no longer exists
      if (onAccountDeleted) onAccountDeleted();
      return;
    } catch (err) {
      setStatusMessage(errorMessage(err, 'Failed to process data deletion request securely.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container stack">
      <div className="page-head" style={{ marginBottom: 4 }}>
        <div>
          <h1>Privacy</h1>
          <p>You decide what is recorded. Nothing here is shared with teachers or other students.</p>
        </div>
      </div>

      {statusMessage && (
        <div className="alert alert-warn">
          <Icon name="alert" />
          {statusMessage}
        </div>
      )}

      {/* How the data is split */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">How your data is kept apart</div>
            <div className="card-sub">Who you are and what you do are stored in different places.</div>
          </div>
        </div>
        <div className="zones">
          <div className="zone identity">
            <h4>
              <Icon name="user" /> Identity Zone
            </h4>
            <ul>
              <li>Your email</li>
              <li>Your password, stored only as a hash</li>
            </ul>
          </div>
          <div className="zone-arrow">
            <Icon name="arrowRight" />
          </div>
          <div className="zone bridge">
            <h4>
              <Icon name="link" /> PseudonymMap
            </h4>
            <ul>
              <li>A random pseudonym</li>
              <li>A keyed hash only the server can make</li>
            </ul>
          </div>
          <div className="zone-arrow">
            <Icon name="arrowRight" />
          </div>
          <div className="zone behavior">
            <h4>
              <Icon name="database" /> Behavioral Zone
            </h4>
            <ul>
              <li>Study times, breaks and goals</li>
              <li>No name, email or account id</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Tracking controls */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Tracking</div>
            <div className="card-sub">Only "active or not" is saved. Keystrokes, websites and other apps are never logged.</div>
          </div>
        </div>

        <div className="setting">
          <div>
            <h3>Automatic study tracking</h3>
            <p>
              On by default. While you are logged in and using your laptop, your study start time, end time and hours are
              recorded, even when you are working in another tab or app. EthosTrack only checks whether the keyboard,
              mouse or trackpad was used, never what you typed or which app or page was open. Your choice is
              remembered in this browser.
            </p>
          </div>
          <Toggle on={isTrackingEnabled} onClick={() => onConsentChange(!isTrackingEnabled)} />
        </div>

        <div className="setting" style={{ opacity: isTrackingEnabled ? 1 : 0.5 }}>
          <div>
            <h3>Take a break</h3>
            <p>Pause tracking when you step away. Your current session closes right away.</p>
          </div>
          <button
            type="button"
            disabled={!isTrackingEnabled}
            onClick={togglePause}
            className={`btn ${isPaused ? 'btn-good' : 'btn-secondary'}`}
          >
            <Icon name={isPaused ? 'play' : 'pause'} size={16} />
            {isPaused ? 'Resume tracking' : 'Pause tracking'}
          </button>
        </div>
      </div>

      {/* Erasure */}
      <div className="card danger-zone">
        <div className="card-head" style={{ marginBottom: 8 }}>
          <div>
            <div className="card-title">Delete my account</div>
            <div className="card-sub">
              Permanently removes your account, your PseudonymMap link and every study record. <strong>This cannot be undone.</strong>
            </div>
          </div>
        </div>

        {!deleteConfirmation ? (
          <button type="button" className="btn btn-danger" onClick={() => setDeleteConfirmation(true)}>
            <Icon name="trash" size={16} />
            Delete all my data
          </button>
        ) : (
          <div className="confirm-box">
            <p>Are you sure? Your account and all your study history will be erased from the server now.</p>
            <div className="row" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-danger" disabled={loading} onClick={handlePermanentDeletion}>
                {loading ? 'Deleting…' : 'Yes, delete everything'}
              </button>
              <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => setDeleteConfirmation(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
