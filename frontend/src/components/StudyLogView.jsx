/**
 * StudyLogView — Automatic Daily Study Log (Phase 4 UI Component)
 * ---------------------------------------------------------------------------
 * Shows what the heartbeat tracker recorded, one row per day, in the same
 * columns as the research dataset: start time, end time, hours spent,
 * sessions, breaks, goal and streak. Refreshes every 30 seconds so today's
 * row grows while the student studies, and can be downloaded as a CSV.
 *
 * The rows come from the Behavioral Zone only; the CSV holds no name, email
 * or student id.
 */
import React, { useCallback, useEffect, useState } from 'react';
import api, { deviceTimeZone, errorMessage } from '../api';
import { Icon } from './Icon';
import { formatHours } from './Charts';

const RANGES = [7, 30, 90];
const REFRESH_MS = 30000;

export const StudyLogView = () => {
  const [days, setDays] = useState(30);
  const [log, setLog] = useState(null);
  const [error, setError] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [goalMessage, setGoalMessage] = useState({ type: '', text: '' });
  const [downloading, setDownloading] = useState(false);

  const loadLog = useCallback(async () => {
    try {
      const { data } = await api.get('/tracking/log', { params: { days, tz: deviceTimeZone() } });
      setLog(data);
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Could not load your study log.'));
    }
  }, [days]);

  useEffect(() => {
    loadLog();
    const id = setInterval(loadLog, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadLog]);

  // Prefill the goal box once the current goal is known
  useEffect(() => {
    const current = log?.rows?.[0]?.goal_hours;
    if (current !== null && current !== undefined) {
      setGoalInput((prev) => (prev === '' ? String(current) : prev));
    }
  }, [log]);

  const saveGoal = async (e) => {
    e.preventDefault();
    setGoalMessage({ type: '', text: '' });
    try {
      const { data } = await api.put('/tracking/goal', { goalHours: Number(goalInput) });
      setGoalMessage({ type: 'good', text: `Saved. Daily goal is ${formatHours(data.goalHours)}.` });
      loadLog();
    } catch (err) {
      setGoalMessage({ type: 'warn', text: errorMessage(err, 'Could not save the goal.') });
    }
  };

  // The CSV needs the login token, so it is fetched here and saved as a file
  const downloadCsv = async () => {
    setDownloading(true);
    try {
      const { data } = await api.get('/tracking/log.csv', {
        params: { days, tz: deviceTimeZone() },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `my_study_log_${days}d.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('Could not download the CSV.');
    } finally {
      setDownloading(false);
    }
  };

  const rows = log?.rows || [];
  const today = rows[0];

  const tiles = [
    { icon: 'clock', tone: 'teal', label: 'Today', value: today ? formatHours(today.hours_spent) : '–' },
    { icon: 'play', tone: '', label: 'Started today', value: today?.login_time || '–' },
    {
      icon: 'pause',
      tone: 'amber',
      label: 'Ended today',
      value: today?.ongoing ? 'Studying now' : today?.logout_time || '–',
    },
    { icon: 'activity', tone: 'rose', label: `Total, last ${days} days`, value: log ? formatHours(log.totals.hours) : '–' },
  ];

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h1>Study log</h1>
          <p>
            Recorded automatically while you are logged in with this tab open{log ? `. Times in ${log.timeZone}` : ''}.
          </p>
        </div>
        <div className="page-actions">
          <div className="segmented" role="group" aria-label="Days shown">
            {RANGES.map((n) => (
              <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>
                {n} days
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-primary" onClick={downloadCsv} disabled={downloading}>
            <Icon name="download" size={16} />
            {downloading ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          <Icon name="alert" />
          {error}
        </div>
      )}

      {/* Today + totals */}
      <div className="grid grid-tiles" style={{ marginBottom: 16 }}>
        {tiles.map((t) => (
          <div key={t.label} className="card tile">
            <span className={`tile-icon ${t.tone}`}>
              <Icon name={t.icon} size={20} />
            </span>
            <div>
              <div className="tile-label">{t.label}</div>
              <div className="tile-value" style={{ fontSize: t.value === 'Studying now' ? 18 : undefined }}>
                {t.value}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <div className="card-title">Daily rows</div>
            <div className="card-sub">Newest first. The CSV uses the same columns as the research dataset.</div>
          </div>

          {/* Daily goal */}
          <form onSubmit={saveGoal} className="goal-form">
            <label htmlFor="goal-hours" style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="target" size={16} />
              Daily goal (hours)
            </label>
            <input
              id="goal-hours"
              className="input"
              type="number"
              min="0.25"
              max="24"
              step="0.25"
              required
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary">
              Save goal
            </button>
          </form>
        </div>

        {goalMessage.text && (
          <div className={`alert alert-${goalMessage.type}`} style={{ marginBottom: 16 }}>
            <Icon name={goalMessage.type === 'good' ? 'check' : 'alert'} />
            {goalMessage.text}
          </div>
        )}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th>Start</th>
                <th>End</th>
                <th>Hours</th>
                <th>Sessions</th>
                <th>Breaks</th>
                <th>Goal met</th>
                <th>Streak</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className={row.ongoing ? 'is-today' : ''}>
                  <td className="strong">{row.date}</td>
                  <td>{row.day_of_week}</td>
                  <td>{row.login_time || '–'}</td>
                  <td>
                    {row.ongoing ? (
                      <span className="pill pill-good">
                        <i className="dot dot-live" /> Studying now
                      </span>
                    ) : (
                      row.logout_time || '–'
                    )}
                  </td>
                  <td className="strong">{row.hours_spent ? row.hours_spent.toFixed(2) : '0'}</td>
                  <td>{row.num_sessions}</td>
                  <td>{row.break_count ? `${row.break_count} (${row.break_duration_minutes} min)` : '0'}</td>
                  <td>
                    {row.goal_met === null ? (
                      '–'
                    ) : row.goal_met ? (
                      <span className="pill pill-good">
                        <Icon name="check" size={12} strokeWidth={3} /> Yes
                      </span>
                    ) : (
                      <span className="pill pill-muted">No</span>
                    )}
                  </td>
                  <td>
                    {row.current_streak_days > 0 ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Icon name="flame" size={14} style={{ color: '#d97706' }} />
                        {row.current_streak_days}
                      </span>
                    ) : (
                      '0'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!log && !error && <p className="muted" style={{ padding: 20 }}>Loading your study log…</p>}
        </div>
      </div>
    </div>
  );
};
