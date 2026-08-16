import webpush from 'web-push';
import { db } from './db';
import {
  NotificationCategory,
  DEFAULT_NOTIFICATION_CATEGORIES,
  PushSubscription,
} from './types';

// VAPID keys should be set in environment variables
// Generate them with: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:admin@wagerpals.com').trim();

let vapidDetailsSet = false;
let vapidMissingWarned = false;

// Set VAPID details only when needed (at runtime, not during build)
function ensureVapidDetails() {
  if (!vapidDetailsSet && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    try {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      vapidDetailsSet = true;
    } catch (error: any) {
      console.error('[Push] Failed to set VAPID details:', error?.message);
    }
  }
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  eventId?: string;
  tag?: string;
}

export interface NotifyResult {
  candidates: number; // distinct users considered
  recipients: number; // users that survived every filter
  delivered: number; // successful deliveries; always <= recipients
  failed: number;
  pruned: number; // dead subscription rows deleted
  suppressed: { excluded: string[]; muted: string[]; prefs: string[]; noSubscription: string[] };
}

function emptyResult(): NotifyResult {
  return {
    candidates: 0,
    recipients: 0,
    delivered: 0,
    failed: 0,
    pruned: 0,
    suppressed: { excluded: [], muted: [], prefs: [], noSubscription: [] },
  };
}

// Partitions `ids` into [kept, dropped], pushing dropped ids into `bucket` so
// callers can build up the NotifyResult.suppressed breakdown as they go.
function partition(ids: string[], drop: (id: string) => boolean, bucket: string[]): string[] {
  const kept: string[] = [];
  for (const id of ids) {
    if (drop(id)) bucket.push(id);
    else kept.push(id);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Transport: everything that actually talks to web-push / Expo lives behind
// this interface so scripts/verify-notifications.ts can swap in a fake with
// setPushTransport() and assert on the filter pipeline without real sends.
// ---------------------------------------------------------------------------

export interface PushTransport {
  sendWebPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: PushNotificationPayload):
    Promise<{ ok: boolean; statusCode?: number }>;
  sendExpo(tokens: string[], payload: PushNotificationPayload):
    Promise<Array<{ token: string; ok: boolean; error?: string }>>;
}

async function sendWebPushReal(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: PushNotificationPayload
): Promise<{ ok: boolean; statusCode?: number }> {
  ensureVapidDetails();
  if (!vapidDetailsSet) {
    if (!vapidMissingWarned) {
      console.error('[Push] VAPID keys not configured; skipping web push sends');
      vapidMissingWarned = true;
    }
    return { ok: false };
  }
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return { ok: true };
  } catch (error: any) {
    console.error(`[Push] Web push error for ${sub.endpoint.substring(0, 50)}:`, error?.statusCode, error?.message);
    return { ok: false, statusCode: error?.statusCode };
  }
}

async function sendExpoReal(
  tokens: string[],
  payload: PushNotificationPayload
): Promise<Array<{ token: string; ok: boolean; error?: string }>> {
  if (tokens.length === 0) return [];
  const fail = () => tokens.map((token) => ({ token, ok: false }));
  const messages = tokens.map((to) => ({
    to,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: { url: payload.url, eventId: payload.eventId, tag: payload.tag },
  }));

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      console.error('[Push] Expo push HTTP error:', response.status, response.statusText);
      return fail();
    }

    let json: any;
    try {
      json = await response.json();
    } catch {
      console.error('[Push] Expo push: could not parse response body');
      return fail();
    }

    // Expo returns { data: [ticket, ...] } in the SAME ORDER as the messages
    // we sent, so we map tickets back to tokens by index.
    const tickets = Array.isArray(json?.data) ? json.data : null;
    if (!tickets) {
      console.error('[Push] Expo push: malformed response body (missing data array)');
      return fail();
    }
    return tokens.map((token, i) => {
      const ticket = tickets[i];
      if (ticket && ticket.status === 'ok') return { token, ok: true };
      return { token, ok: false, error: ticket?.details?.error };
    });
  } catch (error: any) {
    console.error('[Push] Expo push fetch error:', error?.message);
    return fail();
  }
}

const defaultTransport: PushTransport = {
  sendWebPush: sendWebPushReal,
  sendExpo: sendExpoReal,
};

let transportOverride: PushTransport | null = null;

// Read at call time (not cached at module load) so tests can call
// setPushTransport() after the module has already been imported.
function getTransport(): PushTransport {
  return transportOverride || defaultTransport;
}

export function setPushTransport(transport: PushTransport | null): void {
  transportOverride = transport;
}

// ---------------------------------------------------------------------------
// The single dispatch function. Nothing else in the codebase may send a push.
// ---------------------------------------------------------------------------

export async function notifyUsers(options: {
  userIds: string[];
  category: NotificationCategory;
  payload: PushNotificationPayload;
  eventId?: string;
  excludeUserIds?: string[];
}): Promise<NotifyResult> {
  try {
    const { category, payload, eventId } = options;

    // 1. Dedupe + drop falsy/empty ids.
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const id of options.userIds || []) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      deduped.push(id);
    }
    const candidates = deduped.length;
    const suppressed = { excluded: [] as string[], muted: [] as string[], prefs: [] as string[], noSubscription: [] as string[] };

    // 2. Explicit excludes (e.g. don't notify the actor who caused the event).
    const excludeSet = new Set(options.excludeUserIds || []);
    let remaining = partition(deduped, (id) => excludeSet.has(id), suppressed.excluded);

    // 3. Event-scoped mutes.
    if (eventId && remaining.length > 0) {
      const event = await db.events.get(eventId);
      // Defence in depth: derive the subject-hidden rule from the event row
      // itself, not only from event_notification_mutes — applySubjectPrivacy
      // writes that mute row on creation, but if the insert was ever skipped
      // or the event edited afterward, the event row is still the source of
      // truth and must independently block the subject.
      if (event && event.notify_subject === false && event.subject_user_id) {
        const subjectId = event.subject_user_id;
        remaining = partition(remaining, (id) => id === subjectId, suppressed.muted);
      }

      const mutedSet = new Set(await db.eventNotificationMutes.getMutedUserIds(eventId));
      remaining = partition(remaining, (id) => mutedSet.has(id), suppressed.muted);
    }

    // 4. Notification preferences (one batched lookup). No row = fully enabled.
    if (remaining.length > 0) {
      const prefsById = await db.notificationPreferences.getForUsers(remaining);
      remaining = partition(
        remaining,
        (id) => {
          const prefs = prefsById[id];
          const pushEnabled = prefs ? prefs.push_enabled : true;
          const categories = prefs ? prefs.categories : DEFAULT_NOTIFICATION_CATEGORIES;
          return !pushEnabled || categories[category] === false;
        },
        suppressed.prefs
      );
    }

    const recipients = remaining.length;

    // 5. Load subscriptions for the survivors.
    const subsByUser = await Promise.all(remaining.map((id) => db.pushSubscriptions.getByUserId(id)));

    // 6. Exactly one delivery per recipient user: prefer their newest mobile
    // (Expo) registration, falling back to their newest web subscription.
    // Multiple devices/tabs per user would otherwise double- or triple-send
    // the same notification, which is the duplication bug this rewrite
    // exists to fix.
    const expoTargets: Array<{ userId: string; token: string; endpoint: string }> = [];
    const webTargets: Array<{ userId: string; sub: PushSubscription }> = [];
    remaining.forEach((userId, idx) => {
      const subs = subsByUser[idx] || [];
      let bestExpo: PushSubscription | undefined;
      let bestWeb: PushSubscription | undefined;
      for (const sub of subs) {
        if (sub.platform === 'mobile' && sub.expo_token) {
          if (!bestExpo || (sub.id ?? 0) > (bestExpo.id ?? 0)) bestExpo = sub;
        } else if (sub.p256dh && sub.auth) {
          if (!bestWeb || (sub.id ?? 0) > (bestWeb.id ?? 0)) bestWeb = sub;
        }
      }

      if (bestExpo) {
        expoTargets.push({ userId, token: bestExpo.expo_token!, endpoint: bestExpo.endpoint });
      } else if (bestWeb) {
        webTargets.push({ userId, sub: bestWeb });
      } else {
        suppressed.noSubscription.push(userId);
      }
    });

    const transport = getTransport();
    let delivered = 0;
    let failed = 0;
    let pruned = 0;

    // 7a. Expo: one HTTP call per chunk of at most 100 tokens.
    const tokenToEndpoint = new Map<string, string>();
    for (const t of expoTargets) tokenToEndpoint.set(t.token, t.endpoint);
    const expoTokens = expoTargets.map((t) => t.token);
    for (let i = 0; i < expoTokens.length; i += 100) {
      const chunk = expoTokens.slice(i, i + 100);
      let results: Array<{ token: string; ok: boolean; error?: string }>;
      try {
        results = await transport.sendExpo(chunk, payload);
      } catch (error) {
        console.error('[Push] sendExpo chunk threw:', error);
        results = chunk.map((token) => ({ token, ok: false }));
      }
      for (const r of results) {
        if (r.ok) {
          delivered++;
          continue;
        }
        failed++;
        if (r.error === 'DeviceNotRegistered') {
          // For mobile rows push_subscriptions.endpoint is set to the same
          // value as the Expo token (see app/api/push/subscribe/route.ts),
          // but delete by the row's own endpoint rather than assuming that
          // invariant holds forever.
          const endpointToDelete = tokenToEndpoint.get(r.token) || r.token;
          try {
            await db.pushSubscriptions.delete(endpointToDelete);
            pruned++;
          } catch (error) {
            console.error('[Push] Failed to prune expo subscription:', error);
          }
        }
      }
    }

    // 7b. Web push: all in parallel.
    const webResults = await Promise.allSettled(
      webTargets.map((t) =>
        transport.sendWebPush({ endpoint: t.sub.endpoint, p256dh: t.sub.p256dh!, auth: t.sub.auth! }, payload)
      )
    );
    for (let i = 0; i < webResults.length; i++) {
      const result = webResults[i];
      const target = webTargets[i];
      const ok = result.status === 'fulfilled' && result.value.ok;
      if (ok) {
        delivered++;
        continue;
      }
      failed++;
      const statusCode = result.status === 'fulfilled' ? result.value.statusCode : undefined;
      if (result.status === 'rejected') {
        console.error('[Push] sendWebPush rejected:', result.reason);
      }
      if (statusCode === 404 || statusCode === 410) {
        try {
          await db.pushSubscriptions.delete(target.sub.endpoint);
          pruned++;
        } catch (error) {
          console.error('[Push] Failed to prune web subscription:', error);
        }
      }
    }

    return { candidates, recipients, delivered, failed, pruned, suppressed };
  } catch (error) {
    console.error('[Push] notifyUsers failed unexpectedly:', error);
    return emptyResult();
  }
}

// Resolves the audience = ACTIVE members of the event's group, then
// delegates to notifyUsers with eventId set (so subject/mute filtering runs).
export async function notifyEventAudience(options: {
  eventId: string;
  category: NotificationCategory;
  payload: PushNotificationPayload;
  excludeUserIds?: string[];
}): Promise<NotifyResult> {
  try {
    const event = await db.events.get(options.eventId);
    if (!event) return emptyResult();
    const members = await db.groupMembers.getByGroup(event.group_id);
    const activeUserIds = members.filter((m) => m.status === 'active').map((m) => m.user_id);
    return await notifyUsers({
      userIds: activeUserIds,
      category: options.category,
      payload: options.payload,
      eventId: options.eventId,
      excludeUserIds: options.excludeUserIds,
    });
  } catch (error) {
    console.error('[Push] notifyEventAudience failed unexpectedly:', error);
    return emptyResult();
  }
}

// Kept for app/api/groups/members/route.ts, which calls
// sendPushToUser(userId, payload) and ignores the result.
export async function sendPushToUser(
  userId: string,
  payload: PushNotificationPayload,
  category: NotificationCategory = 'group_activity'
): Promise<NotifyResult> {
  return notifyUsers({ userIds: [userId], category, payload });
}

// Called right after an event is created. If the creator chose to hide the
// event from its subject, record that as a mute row up front so it shows up
// consistently everywhere mutes are inspected (e.g. an "unmute" UI) — the
// notify_subject/subject_user_id check inside notifyUsers is a second,
// independent guard, not a replacement for this row.
export async function applySubjectPrivacy(
  eventId: string,
  subjectUserId: string | null | undefined,
  notifySubject: boolean
): Promise<void> {
  try {
    if (notifySubject === false && subjectUserId) {
      await db.eventNotificationMutes.create({
        event_id: eventId,
        user_id: subjectUserId,
        reason: 'subject_hidden',
      });
    }
  } catch (error) {
    console.error('[Push] applySubjectPrivacy failed:', error);
  }
}

// Activity-feed suppression: drops activities belonging to events where the
// viewer is a hidden subject and the event hasn't resolved yet (once
// resolved there's nothing left to hide — the outcome is public).
export async function filterActivitiesForViewer<T extends { event_id?: string | null }>(
  viewerId: string,
  activities: T[]
): Promise<T[]> {
  try {
    const eventIds = Array.from(new Set(activities.map((a) => a.event_id).filter((id): id is string => !!id)));
    if (eventIds.length === 0) return activities;
    const events = await Promise.all(eventIds.map((id) => db.events.get(id)));
    const hiddenEventIds = new Set<string>();
    for (const event of events) {
      if (event && event.status !== 'resolved' && event.notify_subject === false && event.subject_user_id === viewerId) {
        hiddenEventIds.add(event.id);
      }
    }
    if (hiddenEventIds.size === 0) return activities;
    return activities.filter((a) => !a.event_id || !hiddenEventIds.has(a.event_id));
  } catch (error) {
    console.error('[Push] filterActivitiesForViewer failed:', error);
    return activities;
  }
}
