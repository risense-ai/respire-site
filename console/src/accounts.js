import { USER_KEY, readToken } from './api.js';

const KEY = 'rsrs.dashboard.accounts';

// Keep sign-in sessions, never passwords or memory decryption keys.
export function readAccounts() {
  const rows = JSON.parse(localStorage.getItem(KEY) || '[]');
  if (!Array.isArray(rows)) throw new Error('Invalid saved accounts');
  return rows.filter(row => typeof row.user === 'string' && typeof row.token === 'string' && row.token);
}

export function saveAccount(user, token) {
  const rows = readAccounts().filter(row => row.user !== user && row.token !== token);
  rows.push({ user, token });
  localStorage.setItem(KEY, JSON.stringify(rows));
  return rows;
}

export function removeAccount(token) {
  const rows = readAccounts().filter(row => row.token !== token);
  localStorage.setItem(KEY, JSON.stringify(rows));
  return rows;
}

export function currentAccount() {
  return readAccounts().find(row => row.token === readToken(USER_KEY));
}
