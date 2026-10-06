/**
 * AuthView — Landing and Sign-in Page (Phase 4 UI Component)
 * ---------------------------------------------------------------------------
 * Left: what EthosTrack is and why it is private by design.
 * Right: registration and login fields that talk to the Identity Zone routes
 * and cache the session token.
 *
 * Only the email and password go to /api/auth; study data is never part of
 * this page.
 */
import React, { useState } from 'react';
import api, { setToken, deviceTimeZone, errorMessage as apiErrorMessage } from '../api';
import { Brand, Icon } from './Icon';
import studyHero from '../assets/study-hero.webp';

const FEATURES = [
  {
    icon: 'clock',
    title: 'Tracks itself',
    text: 'Study time is recorded while you use your laptop, in any tab or app. No timers to start.',
  },
  {
    icon: 'trendingUp',
    title: 'One clear score',
    text: 'See how steady your routine is, not how you rank against others.',
  },
  {
    icon: 'eyeOff',
    title: 'Private by design',
    text: 'Your name and your study data are stored apart, joined only by a secret key.',
  },
];

export const AuthView = ({ onAuthSuccess, notice }) => {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleFormSubmission = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage('');

    const targetUrl = isLoginMode ? '/auth/login' : '/auth/register';

    try {
      const response = await api.post(targetUrl, { email, password, timezone: deviceTimeZone() });

      if (response.data.success && response.data.token) {
        // Cache the verified authorization token locally
        setToken(response.data.token);
        if (onAuthSuccess) onAuthSuccess();
      }
    } catch (err) {
      setErrorMessage(
        apiErrorMessage(err, 'Could not reach the server. Make sure the backend is running on port 5001.')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      {/* Landing side */}
      <section className="auth-hero">
        <Brand />

        <div>
          <h1>
            Build a steady study habit, <em>without being watched.</em>
          </h1>
          <p className="lead">
            EthosTrack measures how consistently you study and keeps who you are separate from what you do.
          </p>

          <div className="features">
            {FEATURES.map((f) => (
              <div className="feature" key={f.title}>
                <span className="tile-icon">
                  <Icon name={f.icon} size={20} />
                </span>
                <div>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
              </div>
            ))}
          </div>

          <figure className="hero-photo">
            <img src={studyHero} alt="A student planning a study session at a desk with a laptop and notebook" width="900" height="454" />
          </figure>
        </div>

        <p className="hero-foot">A research project on ethical, privacy-preserving study tracking.</p>
      </section>

      {/* Form side */}
      <section className="auth-panel">
        <div className="auth-card">
          <h2>{isLoginMode ? 'Welcome back' : 'Create your account'}</h2>
          <p className="sub">
            {isLoginMode ? 'Log in to see your study overview.' : 'It takes a few seconds. No name needed.'}
          </p>

          <div className="auth-form" style={{ gap: 0 }}>
            {notice && !errorMessage && (
              <div className="alert alert-info" style={{ marginTop: 20 }}>
                <Icon name="info" />
                {notice}
              </div>
            )}
            {errorMessage && (
              <div className="alert alert-warn" style={{ marginTop: 20 }}>
                <Icon name="alert" />
                {errorMessage}
              </div>
            )}
          </div>

          <form onSubmit={handleFormSubmission} className="auth-form">
            <div className="field">
              <label htmlFor="auth-email">University email</label>
              <div className="input-wrap">
                <Icon name="mail" />
                <input
                  id="auth-email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="student@sliit.lk"
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <div className="input-wrap">
                <Icon name="key" />
                <input
                  id="auth-password"
                  className="input"
                  type="password"
                  autoComplete={isLoginMode ? 'current-password' : 'new-password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isLoginMode ? '••••••••' : 'At least 8 characters'}
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={loading} style={{ marginTop: 8 }}>
              {loading ? 'Please wait…' : isLoginMode ? 'Log in' : 'Create account'}
              {!loading && <Icon name="arrowRight" size={16} />}
            </button>
          </form>

          <div className="auth-switch">
            {isLoginMode ? 'New to EthosTrack? ' : 'Already have an account? '}
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setIsLoginMode((prev) => !prev);
                setErrorMessage('');
              }}
            >
              {isLoginMode ? 'Create an account' : 'Log in'}
            </button>
          </div>

          <div className="auth-trust">
            <Icon name="shieldCheck" size={20} />
            Your email is kept in a separate store from your study data. You can erase everything at any time.
          </div>
        </div>
      </section>
    </div>
  );
};
