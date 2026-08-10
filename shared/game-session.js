// shared/game-session.js — guest vs signed-in session persistence helpers.
//
// Per LB Games rules:
//   - Guests store their active session in localStorage (survives browser restart).
//   - Signed-in users store active session in sessionStorage (they have server-side lobby).

export function sessionKey(slug) {
  return `${slug}_session`;
}

export function saveSession(slug, data, userId = null) {
  const key = sessionKey(slug);
  const raw = typeof data === 'string' ? data : JSON.stringify(data);
  try {
    if (userId) {
      sessionStorage.setItem(key, raw);
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, raw);
      sessionStorage.removeItem(key);
    }
  } catch {
    /* storage blocked */
  }
}

export function readSession(slug) {
  const key = sessionKey(slug);
  try {
    const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

export function clearSession(slug) {
  const key = sessionKey(slug);
  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
