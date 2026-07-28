// shared/deep-link.js — open a specific room or the daily straight from a URL.
//
// The home page links to `<game>/?room=CODE` (a your-turn / invite card) or
// `<game>/?daily` (a daily-challenge card). Games read these on boot:
//   • takeRoomParam() → the room code to resume (and strips it from the URL so a
//     refresh or rematch doesn't keep forcing the same room), or null.
//   • hasDailyParam() → true if the daily challenge should auto-open.

export function takeRoomParam() {
  try {
    const url = new URL(location.href);
    const code = url.searchParams.get('room');
    if (!code) return null;
    url.searchParams.delete('room');
    const qs = url.searchParams.toString();
    history.replaceState(null, '', url.pathname + (qs ? `?${qs}` : '') + url.hash);
    return code.trim().toUpperCase();
  } catch { return null; }
}

export function hasDailyParam() {
  try { return new URL(location.href).searchParams.has('daily'); } catch { return false; }
}
