/**
 * index.js — Frontend Application Bootstrap Root (Phase 4 UI)
 * ---------------------------------------------------------------------------
 * The primary initialization entry file that mounts the integrated React component tree
 * directly into the client-side browser DOM layer.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App';
import { API_BASE_URL, IS_LOCAL_SERVER } from './api';

// Tells the local server "an EthosTrack tab is open", so after the Mac wakes
// it does not open a second tab (backend/utils/autoOpen.js). Sends no data.
const pingPresence = () => {
  fetch(`${API_BASE_URL}/api/presence`, { cache: 'no-store' }).catch(() => {});
};
if (IS_LOCAL_SERVER) {
  pingPresence();
  setInterval(pingPresence, 5000);
  document.addEventListener('visibilitychange', pingPresence);
  window.addEventListener('focus', pingPresence);
}

// Anchor the application to the root div container inside public/index.html
const rootElement = document.getElementById('root');

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error("[Bootstrap Failure] Crucial anchor target container '<div id=\"root\"></div>' was not found in index.html.");
}
