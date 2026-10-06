/**
 * api.js — the one HTTP client every component uses
 * ---------------------------------------------------------------------------
 * Points at the Express API (REACT_APP_API_URL, default port 5001 on this host)
 * and attaches the login token to every request, so components never build
 * URLs or auth headers by hand.
 */
import axios from 'axios';

// The built app is always served by the Express server itself (on the Mac at
// port 5001, or on a web host at its own address), so it calls its own
// origin. The dev server (npm run dev, port 3000) calls port 5001 on the same
// host, so opening it from the "On Your Network" address still works.
export const API_BASE_URL =
  process.env.REACT_APP_API_URL ||
  (process.env.NODE_ENV === 'production'
    ? window.location.origin
    : `${window.location.protocol}//${window.location.hostname || 'localhost'}:5001`);

// True when the server runs on this computer (the Mac install or npm run dev).
// Only then do the Mac-only extras make sense: "was the Mac used recently?"
// and the open-tab ping for auto-open. On a website (e.g. Netlify) every call
// is a paid function run and the server cannot see the student's computer.
export const IS_LOCAL_SERVER = ['localhost', '127.0.0.1', '[::1]', ''].includes(window.location.hostname);

// Fired when the server rejects the stored token (expired, or signed with an
// old JWT_SECRET). App listens for it and returns to the login screen.
export const SESSION_EXPIRED_EVENT = 'ethostrack:session-expired';

// The student's own IANA time zone (e.g. "Asia/Colombo"), so start and end
// times are shown in local time rather than the server's UTC.
export const deviceTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch (err) {
    return 'UTC';
  }
};

const TOKEN_KEY = 'token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const api = axios.create({ baseURL: `${API_BASE_URL}/api` });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error?.config?.url || '';
    const isCredentialCheck = url.startsWith('/auth/login') || url.startsWith('/auth/register');
    if (error?.response?.status === 401 && !isCredentialCheck && getToken()) {
      clearToken();
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    return Promise.reject(error);
  }
);

// Pulls the server's { error: { message } } text out of an axios error.
export const errorMessage = (err, fallback) =>
  err?.response?.data?.error?.message || fallback;

export default api;
