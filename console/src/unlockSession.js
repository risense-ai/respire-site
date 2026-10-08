// Derived keys stay in this page's memory only, scoped to the authenticated token.
// Account switching drops plaintext views; logout and explicit lock drop keys.
const sessions = new Map();
export const readUnlockSession = token => sessions.get(token);
export const saveUnlockSession = (token, vault, dataKey) => sessions.set(token, { vault: JSON.stringify(vault), dataKey });
export const dropUnlockSession = token => sessions.delete(token);
export const clearUnlockSessions = () => sessions.clear();
