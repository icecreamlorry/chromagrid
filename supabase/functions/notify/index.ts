// Supabase Edge Function: send a "your turn" Web Push.
//
// The player who just moved calls this with the seat to notify; we look up
// that seat's push subscriptions and deliver the message, pruning any that
// the push service reports as gone. Reads use the service role, so RLS does
// not need to expose subscriptions to clients.
//
// Required secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@x.com)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
//
// Reading push_subscriptions bypasses RLS and so needs a service credential.
// Projects on the legacy JWT keys get SUPABASE_SERVICE_ROLE_KEY auto-injected;
// projects on the new API-key system (sb_publishable_/sb_secret_) have that
// blank, so set your own secret key and we prefer it:
//   supabase secrets set EDGE_SERVICE_KEY=sb_secret_xxx

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:wurdz@example.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const SERVICE_KEY =
  Deno.env.get('EDGE_SERVICE_KEY') ||
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  '';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  SERVICE_KEY,
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SERVICE_KEY) {
    return json({ error: 'No service credential — set EDGE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) secret' }, 500);
  }

  try {
    const { room_code, player, user_id, title, body } = await req.json();

    // The endpoint is callable by anyone holding the (public) anon key, so it
    // must be safe even when abused: we IGNORE any client-supplied URL (the
    // service worker opens the app's own origin), cap the text, and only push
    // to a target that actually exists. That removes the phishing/open-relay
    // teeth — the worst an abuser can do is a capped "your turn"-style nudge
    // to a real participant, with no attacker-controlled link.

    // Two targeting modes:
    //   • user_id given (e.g. a friend invite) → notify that account directly.
    //   • room_code + player → notify whoever holds that seat. Signed-in
    //     players are reached by user_id (every device they registered, across
    //     all their games); anonymous players by (room_code, player).
    let recipientUserId: string | null = user_id ?? null;
    let anonSeatExists = false;
    if (!recipientUserId) {
      if (!room_code || (player !== 0 && player !== 1)) {
        return json({ error: 'either user_id, or room_code and player (0|1), are required' }, 400);
      }
      const { data: room } = await supabase
        .from('rooms')
        .select('host_user_id, guest_user_id, host_name, guest_name')
        .eq('code', room_code)
        .maybeSingle();
      if (!room) return json({ error: 'no such room' }, 404);
      recipientUserId = player === 0 ? room.host_user_id : room.guest_user_id;
      // Anonymous seat is "real" only once that seat is actually occupied.
      anonSeatExists = (player === 0 ? room.host_name : room.guest_name) != null;
    } else {
      // Direct user target must be a real account (profiles aren't
      // enumerable by clients, so this also bounds blind spraying).
      const { data: prof } = await supabase
        .from('profiles').select('id').eq('id', recipientUserId).maybeSingle();
      if (!prof) return json({ error: 'no such user' }, 404);
    }

    if (!recipientUserId && !anonSeatExists) return json({ sent: 0 });

    // A signed-in user has one push_subscriptions row PER GAME they've opened
    // notifications in (each game's service worker is its own subscription
    // scope, even on the same browser) — querying by user_id alone would fan
    // one event out into one OS notification per game ever opened. Collapse
    // back down to one per real device: group by device_id (the shared
    // per-browser id every subscribe call stamps, see push-device-id.js) and
    // keep only the freshest row in each group. Rows predating that id
    // (device_id is null) each count as their own device — best effort until
    // their owner reopens a game and the row picks up a device_id.
    let subs: { endpoint: string; subscription: unknown }[] = [];
    let staleEndpoints: string[] = [];
    if (recipientUserId) {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('endpoint, subscription, device_id, created_at')
        .eq('user_id', recipientUserId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const seenDevices = new Set<string>();
      for (const row of data ?? []) {
        const key = row.device_id || `endpoint:${row.endpoint}`;
        if (seenDevices.has(key)) {
          if (row.device_id) staleEndpoints.push(row.endpoint);
          continue;
        }
        seenDevices.add(key);
        subs.push({ endpoint: row.endpoint, subscription: row.subscription });
      }
    } else {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('endpoint, subscription')
        .eq('room_code', room_code)
        .eq('player', player);
      if (error) throw error;
      subs = data ?? [];
    }
    // Best-effort cleanup of rows we know are superseded duplicates on the
    // same device (an old game's subscription since a fresher one exists) —
    // mirrors the 404/410 pruning below, just for a different kind of "gone".
    if (staleEndpoints.length) {
      await supabase.from('push_subscriptions').delete().in('endpoint', staleEndpoints);
    }

    const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : '');
    const payload = JSON.stringify({
      title: clip(title, 80) || "Wurdz — it's your turn",
      body: clip(body, 140) || 'Your move!',
      url: './',          // always the app's own origin; never client-supplied
      room_code,          // lets the service worker suppress only if THIS game is open
    });

    let sent = 0;
    await Promise.all((subs ?? []).map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription, payload);
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        // 404/410 mean the subscription is dead — clean it up.
        if (status === 404 || status === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', row.endpoint);
        }
      }
    }));

    return json({ sent });
  } catch (err) {
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
