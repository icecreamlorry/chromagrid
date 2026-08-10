// Shared dev tools & devlog unit tests. Run: node shared/test/devtools.test.mjs

import { record, getEntries, clearEntries } from '../devlog.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error('  ✗ ' + msg); } };

// Mock global localStorage for Node env
global.localStorage = (function() {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

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

console.log(`\nshared devtools: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
