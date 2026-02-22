import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Enable React strict mode in development
const StrictModeWrapper = import.meta.env.DEV ? React.StrictMode : React.Fragment;

/**
 * Dev auth bypass: fetch a token from /auth/dev-login before mounting React.
 * This ensures the token is in localStorage before useAuth() runs anywhere.
 * Only active in Vite dev mode; the endpoint only exists when DEV_BYPASS_AUTH=true.
 */
async function devAutoLogin(): Promise<void> {
  if (!import.meta.env.DEV) return;
  const TOKEN_KEY = 'sai_dashboard_token';
  const baseUrl = import.meta.env.VITE_API_URL || '/api';

  // If we already have a token, verify it's still valid
  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      const res = await fetch(`${baseUrl}/auth/validate`, {
        headers: { Authorization: `Bearer ${parsed}` },
      });
      if (res.ok) return; // token is still good
    } catch { /* fall through to get a fresh one */ }
    localStorage.removeItem(TOKEN_KEY);
  }

  // Fetch a fresh dev token
  try {
    const res = await fetch(`${baseUrl}/auth/dev-login`);
    if (res.ok) {
      const { data } = await res.json();
      if (data?.token) {
        localStorage.setItem(TOKEN_KEY, JSON.stringify(data.token));
      }
    }
  } catch {
    // dev-login not available — fall through to normal login page
  }
}

devAutoLogin().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <StrictModeWrapper>
      <App />
    </StrictModeWrapper>
  );
});
