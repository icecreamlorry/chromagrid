// Shared dev tools & devlog unit tests. Run: node shared/test/devtools.test.mjs

import { record, getEntries, clearEntries } from '../devlog.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

function makeStorage() {
  let store = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
}

// Mock global localStorage/sessionStorage for Node env
global.localStorage = makeStorage();
global.sessionStorage = makeStorage();

// Clear store before testing
clearEntries();
ok(getEntries().length === 0, 'devlog starts empty after clear');

// Test recording entries
record('info', 'System ready');
record('warn', 'Low memory warning');
record('error', 'Uncaught ReferenceError: foo is not defined');

const entries = getEntries();
ok(entries.length === 3, 'devlog recorded 3 entries');
ok(entries[0].level === 'info' && entries[0].msg === 'System ready', 'first entry matches');
ok(entries[1].level === 'warn' && entries[1].msg === 'Low memory warning', 'second entry matches');
ok(entries[2].level === 'error' && entries[2].msg.includes('ReferenceError'), 'third entry matches');

// Test single event copy format helper
function fmtSingleEvent(r) {
  const d = new Date(r.t);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  const timeStr = d.toTimeString().slice(0, 8);
  const levelStr = (r.level || 'info').toUpperCase();
  return `[${dateStr} ${timeStr}] [${levelStr}] ${r.msg}`;
}

const formatted = fmtSingleEvent(entries[2]);
ok(formatted.includes('[ERROR] Uncaught ReferenceError: foo is not defined'), 'single event copy format includes level and message');
ok(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/.test(formatted), 'single event copy format starts with ISO date & time bracket');

// Test Day key helper
function getDayKey(t) {
  const d = new Date(t);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const todayKey = getDayKey(Date.now());
ok(/^\d{4}-\d{2}-\d{2}$/.test(todayKey), 'getDayKey returns YYYY-MM-DD');

clearEntries();
ok(getEntries().length === 0, 'clearEntries resets the log');

// ---- Dev Tools "Test identity" override ------------------------------------
// The whole point is a per-TAB (sessionStorage) override that never touches
// the real per-device identity (localStorage) — verify both the isolation and
// that guest-id.js / guest-name.js actually honour it.
{
  const { getGuestId, getTestIdentity, setTestIdentity } = await import('../guest-id.js');
  const { getGuestName, setGuestName } = await import('../guest-name.js');

  ok(getTestIdentity() === '', 'test identity: off by default');

  const realId = getGuestId();
  ok(localStorage.getItem('lbgames.guestId') === realId, 'real guest id persists to localStorage as before');

  setTestIdentity('Dana Two');
  ok(getTestIdentity() === 'Dana Two', 'test identity: set and read back');
  ok(sessionStorage.getItem('lbgames.testIdentity') === 'Dana Two', 'test identity lives in sessionStorage, not localStorage');

  const testId = getGuestId();
  ok(testId !== realId, 'test identity: getGuestId returns something different while active');
  ok(testId.startsWith('test-'), 'test identity: the override id is clearly marked as a test id');
  ok(localStorage.getItem('lbgames.guestId') === realId, 'test identity: the REAL localStorage id is untouched');

  ok(getGuestName() === 'Dana Two', 'test identity: getGuestName returns it directly, not from storage');

  const realName = 'Alice';
  localStorage.setItem('lbgames.name', realName);
  const returned = setGuestName('Someone Else');
  ok(returned === 'Someone Else', 'test identity: setGuestName still returns the typed value for this tab');
  ok(localStorage.getItem('lbgames.name') === realName,
    'test identity: setGuestName does NOT overwrite the real shared name while a test identity is active');

  setTestIdentity('');
  ok(getTestIdentity() === '', 'test identity: clearing restores normal behaviour');
  ok(getGuestId() === realId, 'test identity: getGuestId reverts to the real id once cleared');
  ok(getGuestName() === realName, 'test identity: getGuestName reverts to the real stored name once cleared');

  setGuestName('Bob');
  ok(localStorage.getItem('lbgames.name') === 'Bob', 'setGuestName persists normally again once the override is off');
}

console.log(`\nshared devtools: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
