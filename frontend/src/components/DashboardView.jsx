/**
 * DashboardView — Stress-Free Analytics Component (Phase 4 UI)
 * ---------------------------------------------------------------------------
 * Renders the student's personal study consistency metrics safely:
 * - score ring and band for the chosen window (this week or 4-week rolling)
 * - quick tiles: today, streak, active time, study days
 * - study hours per day for the last 14 days, against the daily goal
 * - the weekly consistency score for the last 6 weeks
 * - the four parts of the score (R, A, S, H)
 *
 * Every number here comes from the Behavioral Zone through the student's own
 * login token; no name, email or pseudoId is ever sent to the browser.
 */
import React, { useCallback, useEffect, useState } from 'react';
import api, { deviceTimeZone, errorMessage } from '../api';
import { Icon } from './Icon';
import { HoursBarChart, ScoreRing, ScoreTrendChart, formatHours } from './Charts';

const TREND_WEEKS = 6;
const HOURS_DAYS = 14;
const REFRESH_MS = 60000;

const BAND_STYLE = {
  consistent: { color: 'var(--good)', icon: 'check', pill: 'pill-good' },
  developing: { color: 'var(--brand-600)', icon: 'trendingUp', pill: 'pill-brand' },
  building: { color: '#d97706', icon: 'sparkles', pill: 'pill-muted' },
};

const COMPONENTS = [
  { key: 'R', name: 'Regularity', text: 'How many days you met your minimum study time.' },
  { key: 'A', name: 'Adherence', text: 'How much of your planned study time you completed.' },
  { key: 'S', name: 'Stability', text: 'How even your study time is from day to day.' },
  { key: 'H', name: 'Rhythm', text: 'How steady your usual start time is.' },
];

// YYYY-MM-DD for a date in this device's time zone
const localDateKey = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: deviceTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const shortDate = (dateKey) =>
  new Date(`${dateKey}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

const Tile = ({ icon, tone, label, value, unit }) => (
  <div className="card tile">
    <span className={`tile-icon ${tone || ''}`}>
      <Icon name={icon} size={20} />
    </span>
    <div>
      <div className="tile-label">{label}</div>
      <div className="tile-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
    </div>
  </div>
);

export const DashboardView = () => {
  const [metricsData, setMetricsData] = useState(null);
  const [windowType, setWindowType] = useState('week'); // 'week' or 'rolling'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [log, setLog] = useState(null);
  const [trend, setTrend] = useState(null);

  // 1. Score for the chosen window
  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await api.get('/dashboard', { params: { window: windowType } });
        if (response.data.success && response.data.metrics) {
          setMetricsData(response.data.metrics);
        } else {
          setMetricsData(null);
        }
      } catch (err) {
        setError(errorMessage(err, 'Failed to sync consistency scores.'));
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [windowType]);

  // 2. Daily hours for the bar chart, refreshed while the page is open
  const loadLog = useCallback(async () => {
    try {
      const { data } = await api.get('/tracking/log', { params: { days: HOURS_DAYS, tz: deviceTimeZone() } });
      setLog(data);
    } catch (err) {
      // The score card already shows connection errors
    }
  }, []);

  useEffect(() => {
    loadLog();
    const id = setInterval(loadLog, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadLog]);

  // 3. One weekly score per week for the trend line
  useEffect(() => {
    let cancelled = false;
    const loadTrend = async () => {
      const anchors = Array.from({ length: TREND_WEEKS }, (_, i) =>
        localDateKey(new Date(Date.now() - (TREND_WEEKS - 1 - i) * 7 * 86400000))
      );
      const results = await Promise.all(
        anchors.map((date) =>
          api
            .get('/dashboard', { params: { window: 'week', date } })
            .then((res) => res.data.metrics)
            .catch(() => null)
        )
      );
      if (cancelled) return;
      setTrend(
        results.map((m, i) => ({
          key: anchors[i],
          label: i === TREND_WEEKS - 1 ? 'This week' : m ? shortDate(m.start) : '',
          score: m ? m.score : null,
          tooltip: m ? `Week of ${shortDate(m.start)} · ${m.band}` : 'Could not load',
        }))
      );
    };
    loadTrend();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = log?.rows || [];
  const today = rows[0];
  const goalHours = today?.goal_hours || 0;
  const chartDays = [...rows].reverse().map((r, i, all) => ({
    key: r.date,
    label: r.day_of_week.slice(0, 3),
    sublabel: String(Number(r.date.slice(8))),
    hours: r.hours_spent,
    isToday: i === all.length - 1,
    tooltip: `${r.day_of_week}, ${shortDate(r.date)}${r.ongoing ? ' · studying now' : ''}`,
  }));
  const chartTotal = rows.reduce((acc, r) => acc + r.hours_spent, 0);

  const header = (
    <div className="page-head">
      <div>
        <h1>Your study overview</h1>
        <p>A calm look at how steady your study routine is.</p>
      </div>
      <div className="segmented" role="group" aria-label="Score window">
        <button type="button" aria-pressed={windowType === 'week'} onClick={() => setWindowType('week')}>
          This week
        </button>
        <button type="button" aria-pressed={windowType === 'rolling'} onClick={() => setWindowType('rolling')}>
          Last 4 weeks
        </button>
      </div>
    </div>
  );

  if (error) {
    return (
      <div className="container">
        {header}
        <div className="alert alert-warn">
          <Icon name="alert" />
          {error}
        </div>
      </div>
    );
  }

  if (loading && !metricsData) {
    return (
      <div className="container">
        {header}
        <div className="grid grid-tiles" style={{ marginBottom: 16 }}>
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="skeleton" style={{ height: 82 }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 300 }} />
      </div>
    );
  }

  // Safety check to handle empty history bounds gracefully
  if (!metricsData) {
    return (
      <div className="container">
        {header}
        <div className="card empty">
          <span className="tile-icon">
            <Icon name="activity" size={24} />
          </span>
          <h3>No study time yet</h3>
          <p>Tracking starts by itself while you are logged in and using your laptop. Your score appears once study time is recorded.</p>
        </div>
      </div>
    );
  }

  const { score, band, message, components, summary } = metricsData;
  const bandStyle = BAND_STYLE[band?.toLowerCase()] || BAND_STYLE.building;
  const windowLabel = windowType === 'week' ? 'this week' : 'last 4 weeks';

  return (
    <div className="container" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
      {header}

      {/* Quick numbers */}
      <div className="grid grid-tiles" style={{ marginBottom: 16 }}>
        <Tile icon="clock" tone="teal" label="Today" value={today ? formatHours(today.hours_spent) : '–'} />
        <Tile icon="flame" tone="amber" label="Current streak" value={today ? today.current_streak_days : '–'} unit={today?.current_streak_days === 1 ? 'day' : 'days'} />
        <Tile icon="activity" label={`Active time, ${windowLabel}`} value={formatHours(summary.totalActiveMinutes / 60)} />
        <Tile icon="calendar" tone="rose" label={`Study days, ${windowLabel}`} value={summary.studyDaysCount} unit={summary.studyDaysCount === 1 ? 'day' : 'days'} />
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        {/* Hours chart */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Study hours</div>
              <div className="card-sub">Last {HOURS_DAYS} days · {formatHours(chartTotal)} in total</div>
            </div>
          </div>
          {log ? (
            <>
              <HoursBarChart days={chartDays} goalHours={goalHours} />
              <div className="chart-legend">
                <span>
                  <i className="swatch" style={{ background: 'var(--brand-600)' }} /> Active study time
                </span>
                <span>
                  <i className="swatch" style={{ background: '#22b3a5' }} /> Today
                </span>
                {goalHours > 0 && (
                  <span>
                    <i className="swatch-line" /> Daily goal
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="skeleton" style={{ height: 230 }} />
          )}
        </div>

        {/* Score */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Consistency score</div>
              <div className="card-sub">{windowType === 'week' ? 'This week, Monday to Sunday' : 'Last 4 weeks'}</div>
            </div>
            <span className={`pill ${bandStyle.pill}`}>
              <Icon name={bandStyle.icon} size={13} />
              {band}
            </span>
          </div>
          <div className="score-card">
            <ScoreRing score={score} color={bandStyle.color} />
            <div className="score-text">
              <div className="band" style={{ color: bandStyle.color }}>
                {band}
              </div>
              <h2>{message}</h2>
              <p>The score adds up the four parts below. There is no ranking and nobody else sees it.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        {/* Trend chart */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Score by week</div>
              <div className="card-sub">Your weekly consistency score for the last {TREND_WEEKS} weeks</div>
            </div>
          </div>
          {trend ? <ScoreTrendChart points={trend} height={300} /> : <div className="skeleton" style={{ height: 300 }} />}
        </div>

        {/* R A S H */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">What makes your score</div>
              <div className="card-sub">Each part from 0 to 100%</div>
            </div>
          </div>
          {COMPONENTS.map(({ key, name, text }) => {
            const value = components?.[key];
            const known = value !== undefined && value !== null;
            const pct = known ? Math.round(value * 100) : 0;
            return (
              <div className="meter" key={key}>
                <div className="meter-head">
                  <span className="name">
                    <span className="letter">{key}</span>
                    {name}
                  </span>
                  <span>{known ? `${pct}%` : 'Not used'}</span>
                </div>
                <p>{text}</p>
                <div className="meter-track">
                  <div className="meter-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
