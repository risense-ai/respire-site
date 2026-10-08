import { useEffect, useState } from 'react';
import { Gate } from './Gate.jsx';
import { Shell } from './Shell.jsx';
import {
  ADMIN_KEY, USER_KEY, api, onUnauthorized, readToken, writeSecret, writeSuper, writeToken,
} from './api.js';
import { pathRestToHash } from './hashRoute.js';
import { consoleRoute } from './consoleRoute.js';
import { t } from './i18n.js';
import { readAccounts, saveAccount, removeAccount } from './accounts.js';
import { useI18n } from './ui.jsx';

function pagePath() {
  return window.location.pathname.replace(/\/+$/, '') || '/';
}

export default function App() {
  useI18n();
  const path = pagePath();
  const hostname = window.location.hostname;
  const target = hostname === new URL(import.meta.env.VITE_ADMIN_URL).hostname ? 'admin'
    : hostname === new URL(import.meta.env.VITE_DASHBOARD_URL).hostname ? 'dashboard'
    : path === '/admin' || path.startsWith('/admin/') ? 'admin'
    : path === '/dashboard' || path.startsWith('/dashboard/') ? 'dashboard' : null;
  if (target && consoleRoute(path, target, window.location.hash).supported) {
    return <Console admin={target === 'admin'} />;
  }
  return (
    <div className="gate-page" style={{ padding: 48 }}>
      <h1>respire</h1>
      <p>{t('fallbackHint')}</p>
    </div>
  );
}

function Console({ admin }) {
  useI18n();
  const key = admin ? ADMIN_KEY : USER_KEY;
  const [token, setTokenState] = useState(() => readToken(key));
  const [hint, setHint] = useState('');
  const [accounts, setAccounts] = useState(() => admin ? [] : readAccounts());
  const [adding, setAdding] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [checked, setChecked] = useState(!readToken(key));
  const setToken = (value, superPass, secretKey) => {
    if (!admin && !value) {
      setAccounts(removeAccount(readToken(key)));
      writeSuper('');
      writeSecret('');
    }
    writeToken(key, value);
    if (superPass) writeSuper(superPass);
    if (secretKey) writeSecret(secretKey);
    setTokenState(value);
  };
  async function enterAccount(value, superPass, secretKey) {
    const info = await api('/api/self', { token: value });
    if (!info.user) throw new Error('Account identity missing');
    setAccounts(saveAccount(info.user, value));
    writeSuper('');
    writeSecret('');
    setToken(value, superPass, secretKey);
    setAdding(false);
  }
  async function switchAccount(account) {
    if (switching || account.token === token) return;
    setSwitching(true);
    try {
      await enterAccount(account.token);
      location.hash = '/memories';
    } catch (error) {
      setHint(error.message);
      if (error.status === 401 || error.status === 403) setAccounts(removeAccount(account.token));
    } finally { setSwitching(false); }
  }
  function addAccount() {
    writeSuper('');
    writeSecret('');
    setAdding(true);
  }
  useEffect(() => {
    if (admin) return;
    const changed = (event) => {
      if (event.key === USER_KEY) {
        setChecked(false);
        setTokenState(readToken(USER_KEY));
        setAdding(false);
      }
      if (event.key === 'rsrs.dashboard.accounts') setAccounts(readAccounts());
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [admin]);
  useEffect(() => {
    const path = pagePath();
    if (admin && path.startsWith('/admin/')) {
      window.history.replaceState(null, '', `/admin${pathRestToHash(path.slice('/admin/'.length))}`);
    }
    if (!admin && path.startsWith('/dashboard/')) {
      window.history.replaceState(null, '', `/dashboard${pathRestToHash(path.slice('/dashboard/'.length))}`);
    }
  }, [admin]);
  useEffect(() => {
    onUnauthorized((apiPath, requestToken) => {
      if (requestToken !== readToken(key)) return;
      if (admin && apiPath.startsWith('/admin') && !apiPath.startsWith('/admin/login')) setToken('');
      if (!admin && (apiPath.startsWith('/api/self') || apiPath === '/count' || apiPath === '/pull' || apiPath === '/login')) setToken('');
    });
  }, [admin]);
  useEffect(() => {
    if (!token) {
      setChecked(true);
      return;
    }
    const probe = admin ? '/admin/me' : '/api/self';
    api(probe, { token })
      .then((info) => {
        if (readToken(key) !== token) return;
        if (!admin && info.user) setAccounts(saveAccount(info.user, token));
        setChecked(true);
      })
      .catch((err) => {
        if (readToken(key) !== token) return;
        if (err.status === 401 || err.status === 403) setToken('');
        setChecked(true);
      });
  }, [admin, token]);
  if (!checked) {
    return <div className="gate-page" style={{ padding: 48 }}><p>{t('checkingLogin')}</p></div>;
  }
  if (!token || adding) {
    return (
      <>
        <Gate
          admin={admin}
          notify={(t) => { setHint(t); window.setTimeout(() => setHint(''), 3500); }}
          onEnter={({ token: value, superPass, secretKey }) => admin ? setToken(value) : enterAccount(value, superPass, secretKey)}
        />
        {adding && <button type="button" className="gate-link" onClick={() => setAdding(false)}>{t('cancel')}</button>}
        <div className={`toast ${hint ? 'visible' : ''}`} role="status">{hint}</div>
      </>
    );
  }
  return (
    <Shell
      key={token}
      admin={admin}
      token={token}
      accounts={accounts}
      switching={switching}
      onSwitchAccount={switchAccount}
      onAddAccount={addAccount}
      onToken={(value) => {
        if (!admin) {
          const current = accounts.find(account => account.token === token);
          if (current) setAccounts(saveAccount(current.user, value));
        }
        setToken(value);
      }}
      onLogout={() => setToken('')}
    />
  );
}
