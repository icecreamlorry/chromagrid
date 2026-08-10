// Shared game session tests. Run: node shared/test/game-session.test.mjs

import { saveSession, readSession, clearSession, sessionKey } from '../game-session.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

// Mock global localStorage and sessionStorage for Node env
global.localStorage = (function() {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

global.sessionStorage = (function() {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

// Key helper test
ok(sessionKey('testgame') === 'testgame_session', 'sessionKey returns slug_session');

// Guest save & read (stored in localStorage)
{
  localStorage.clear();
  sessionStorage.clear();
  const data = { code: 'ABC123', name: 'GuestUser' };
  saveSession('testgame', data, null);
  ok(localStorage.getItem('testgame_session') !== null, 'guest session stored in localStorage');
  ok(sessionStorage.getItem('testgame_session') === null, 'guest session not in sessionStorage');
  const read = readSession('testgame');
  ok(read && read.code === 'ABC123' && read.name === 'GuestUser', 'guest session read accurately');
}

// User save & read (stored in sessionStorage)
{
  localStorage.clear();
  sessionStorage.clear();
  const data = { code: 'XYZ789', name: 'SignedInUser' };
  saveSession('testgame', data, 'user-123');
  ok(sessionStorage.getItem('testgame_session') !== null, 'user session stored in sessionStorage');
  ok(localStorage.getItem('testgame_session') === null, 'user session cleared from localStorage');
  const read = readSession('testgame');
  ok(read && read.code === 'XYZ789' && read.name === 'SignedInUser', 'user session read accurately');
}

// Clear session clears both
{
  localStorage.setItem('testgame_session', 'foo');
  sessionStorage.setItem('testgame_session', 'bar');
  clearSession('testgame');
  ok(localStorage.getItem('testgame_session') === null, 'clearSession removes from localStorage');
  ok(sessionStorage.getItem('testgame_session') === null, 'clearSession removes from sessionStorage');
  ok(readSession('testgame') === null, 'readSession returns null after clear');
}

console.log(`\nshared game-session: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
