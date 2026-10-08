import { t } from './i18n.js';
import { apiUrl } from './config.js';

export const USER_KEY = 'rsrs.userToken';
export const ADMIN_KEY = 'rsrs.adminToken';
export const SUPER_KEY = 'rsrs.superPass';
export const SECRET_KEY = 'rsrs.secretKey';
export const SUPER_AT_KEY = 'rsrs.superPassAt';

// Read old browser credentials without copying or deleting them. An explicit
// empty current value prevents logout from reviving a legacy credential.
function stored(key) {
  return localStorage.getItem(key) ?? localStorage.getItem(key.replace(/^rsrs\./, 'onememory.')) ?? '';
}

// Locally saved recovery codes expire after three days; do not auto-unlock or prefill expired codes.
// Require manual entry after expiration and renew the timestamp on successful unlock.
export const SUPER_TTL_MS = 3 * 24 * 3600 * 1000;

let unauthorized = null;
export function onUnauthorized(handler) {
  unauthorized = handler;
}

export async function api(path, { method = 'GET', body, token, signal } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(apiUrl(path, import.meta.env?.VITE_API_BASE_URL), { method, headers, body: payload, cache: 'no-store', credentials: 'omit', signal });
  const text = await response.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text };
  }
  if (response.status === 401 && unauthorized) unauthorized(path, token);
  if (
    response.status === 403
    && unauthorized
    && String(json.error || '').includes('admin token required')
  ) {
    unauthorized(path, token);
  }
  if (!response.ok) {
    const err = new Error(json.error || response.statusText || 'request failed');
    err.status = response.status;
    err.body = json;
    throw err;
  }
  return json;
}

export function readToken(key) {
  try {
    return stored(key);
  } catch {
    return '';
  }
}

export function writeToken(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.setItem(key, '');
    return true;
  } catch {
    return false;
  }
}

export function readSuper() {
  try {
    return stored(SUPER_KEY);
  } catch {
    return '';
  }
}

export function writeSuper(value) {
  try {
    if (value) {
      localStorage.setItem(SUPER_KEY, value);
      localStorage.setItem(SUPER_AT_KEY, String(Date.now()));
    } else {
      localStorage.setItem(SUPER_KEY, '');
      localStorage.setItem(SUPER_AT_KEY, '');
    }
  } catch {
    /* ignore quota */
  }
}

export function readSecret() {
  try {
    return stored(SECRET_KEY);
  } catch {
    return '';
  }
}

export function writeSecret(value) {
  try {
    if (value) localStorage.setItem(SECRET_KEY, value);
    else localStorage.setItem(SECRET_KEY, '');
  } catch {
    /* ignore quota */
  }
}

// Check whether a locally stored recovery code is present and unexpired.
export function superFresh() {
  const saved = readSuper();
  if (!saved) return false;
  const at = Number(stored(SUPER_AT_KEY) || 0);
  if (!at) return false; // Treat older records without a timestamp as expired.
  return Date.now() - at < SUPER_TTL_MS;
}

// Expiration status text shared by the keys and locked pages.
export function superFreshText() {
  const saved = readSuper();
  if (!saved) return t('superNotSaved');
  const at = Number(stored(SUPER_AT_KEY) || 0);
  if (!at) return t('superExpiredNoTs');
  const remain = SUPER_TTL_MS - (Date.now() - at);
  if (remain <= 0) return t('superExpiredShort');
  const days = Math.floor(remain / (24 * 3600 * 1000));
  const hours = Math.floor((remain % (24 * 3600 * 1000)) / (3600 * 1000));
  return days > 0 ? t('superRemainDays', { days, hours }) : t('superRemainHours', { hours });
}
