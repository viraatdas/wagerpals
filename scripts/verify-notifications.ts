// Proof-of-correctness for lib/push.ts, the single notification dispatcher.
//
// This is NOT an integration test against a real database or a real push
// service — there is no .env.local and no Postgres reachable in this
// checkout. Instead it drives the REAL lib/push.ts functions (notifyUsers,
// notifyEventAudience, sendPushToUser, applySubjectPrivacy,
// filterActivitiesForViewer) against:
//
//   1. An in-memory fake of lib/db's `db` object, built by requiring the
//      real lib/db module and overwriting its accessor methods at runtime
//      (the same "require, then mutate the shared module object" trick
//      scripts/verify-payments.ts uses to neutralize web-push — lib/push.ts
//      reads `db.x.y` off the imported object at call time, so mutating the
//      object those calls resolve against is enough).
//   2. A recording PushTransport installed via setPushTransport(), which
//      never opens a socket: it just records every sendWebPush/sendExpo
//      call and returns configurable canned results.
//
// This proves the filter pipeline (subject suppression, mutes, preferences,
// dedupe, actor exclusion, audience scoping, pruning, failure isolation,
// Expo batching) end to end without touching a database or the network.
//
// Run: npx tsx scripts/verify-notifications.ts

import * as fs from 'fs';
import * as path from 'path';

import type { PushTransport, NotifyResult, PushNotificationPayload } from '../lib/push';
import {
  Event,
  PushSubscription,
  GroupMember,
  NotificationPreferences,
  EventNotificationMute,
  NotificationCategory,
  DEFAULT_NOTIFICATION_CATEGORIES,
} from '../lib/types';

// ---------------------------------------------------------------------------
// In-memory fixture state
// ---------------------------------------------------------------------------

const GROUP = 'grp-1';
const ALICE = 'alice';
const BOB = 'bob';
const CAROL = 'carol';
const DAVE = 'dave';
const EVE = 'eve'; // NOT a group member — proves there is no platform-wide broadcast.

const E1 = 'e1'; // subject: carol, notify_subject: false
const E2 = 'e2'; // control: no subject

const ALICE_WEB = 'endpoint://alice-web';
const CAROL_WEB = 'endpoint://carol-web';
const CAROL_EXPO_ENDPOINT = 'endpoint://carol-expo';
const CAROL_EXPO_TOKEN = 'ExponentPushToken[carol]';
const BOB_WEB = 'endpoint://bob-web';
const DAVE_EXPO_ENDPOINT = 'endpoint://dave-expo';
const DAVE_EXPO_TOKEN = 'ExponentPushToken[dave]';
const EVE_WEB = 'endpoint://eve-web';

function baselinePushSubs(): PushSubscription[] {
  return [
    { id: 1, user_id: ALICE, endpoint: ALICE_WEB, p256dh: 'p', auth: 'a', platform: 'web' },
    { id: 2, user_id: CAROL, endpoint: CAROL_WEB, p256dh: 'p', auth: 'a', platform: 'web' },
    { id: 3, user_id: CAROL, endpoint: CAROL_EXPO_ENDPOINT, expo_token: CAROL_EXPO_TOKEN, platform: 'mobile' },
    { id: 4, user_id: BOB, endpoint: BOB_WEB, p256dh: 'p', auth: 'a', platform: 'web' },
    { id: 5, user_id: DAVE, endpoint: DAVE_EXPO_ENDPOINT, expo_token: DAVE_EXPO_TOKEN, platform: 'mobile' },
    { id: 6, user_id: EVE, endpoint: EVE_WEB, p256dh: 'p', auth: 'a', platform: 'web' },
  ];
}

interface FixtureState {
  groupMembers: GroupMember[];
  events: Map<string, Event>;
  pushSubs: PushSubscription[];
  prefs: Map<string, NotificationPreferences>;
  mutes: EventNotificationMute[];
  deletedEndpoints: string[];
}

const state: FixtureState = {
  groupMembers: [
    { id: 1, group_id: GROUP, user_id: ALICE, role: 'admin', status: 'active' },
    { id: 2, group_id: GROUP, user_id: BOB, role: 'member', status: 'active' },
    { id: 3, group_id: GROUP, user_id: CAROL, role: 'member', status: 'active' },
    { id: 4, group_id: GROUP, user_id: DAVE, role: 'member', status: 'active' },
  ],
  events: new Map<string, Event>([
    [
      E1,
      {
        id: E1,
        title: 'E1 (has a hidden subject)',
        side_a: 'a',
        side_b: 'b',
        end_time: Date.now() + 60 * 60 * 1000,
        status: 'active',
        group_id: GROUP,
        payment_type: 'cash',
        stake_amount: 10,
        subject_user_id: CAROL,
        notify_subject: false,
      },
    ],
    [
      E2,
      {
        id: E2,
        title: 'E2 (control, no subject)',
        side_a: 'a',
        side_b: 'b',
        end_time: Date.now() + 60 * 60 * 1000,
        status: 'active',
        group_id: GROUP,
        payment_type: 'cash',
        stake_amount: 10,
        subject_user_id: null,
        notify_subject: true,
      },
    ],
  ]),
  pushSubs: baselinePushSubs(),
  prefs: new Map<string, NotificationPreferences>(),
  mutes: [{ event_id: E1, user_id: CAROL, reason: 'subject_hidden' }],
  deletedEndpoints: [],
};

// ---------------------------------------------------------------------------
// Step 1: require lib/db and overwrite its accessor methods BEFORE lib/push
// is required, so every db.x.y() call lib/push.ts makes at call time
// resolves against these in-memory implementations. No Postgres connection
// is ever attempted.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dbModule = require('../lib/db') as typeof import('../lib/db');

dbModule.db.events.get = async (id: string) => state.events.get(id) ?? null;

dbModule.db.groupMembers.getByGroup = async (groupId: string) =>
  state.groupMembers.filter((m) => m.group_id === groupId);

dbModule.db.pushSubscriptions.getByUserId = async (userId: string) =>
  state.pushSubs.filter((s) => s.user_id === userId);

dbModule.db.pushSubscriptions.delete = async (endpoint: string) => {
  state.deletedEndpoints.push(endpoint);
  state.pushSubs = state.pushSubs.filter((s) => s.endpoint !== endpoint);
};

dbModule.db.notificationPreferences.getForUsers = async (userIds: string[]) => {
  const out: Record<string, NotificationPreferences> = {};
  for (const id of userIds) {
    const p = state.prefs.get(id);
    if (p) out[id] = p;
  }
  return out;
};

dbModule.db.eventNotificationMutes.getMutedUserIds = async (eventId: string) =>
  state.mutes.filter((m) => m.event_id === eventId).map((m) => m.user_id);

dbModule.db.eventNotificationMutes.create = async (mute: EventNotificationMute) => {
  const existing = state.mutes.find((m) => m.event_id === mute.event_id && m.user_id === mute.user_id);
  if (existing) {
    existing.reason = mute.reason;
    return existing;
  }
  const row: EventNotificationMute = { ...mute, id: state.mutes.length + 1 };
  state.mutes.push(row);
  return row;
};

// Only now is it safe to load lib/push — every db call it makes will hit
// the fakes installed above, never a real connection.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pushModule = require('../lib/push') as typeof import('../lib/push');

// ---------------------------------------------------------------------------
// Step 2: a recording PushTransport. No network call is ever made — results
// are canned per-scenario via `recorder.webResponder` / `recorder.expoResponder`.
// ---------------------------------------------------------------------------

interface RecordedWebCall {
  endpoint: string;
  payload: PushNotificationPayload;
}
interface RecordedExpoCall {
  tokens: string[];
  payload: PushNotificationPayload;
}

const recorder = {
  webCalls: [] as RecordedWebCall[],
  expoCalls: [] as RecordedExpoCall[],
  webResponder: (_endpoint: string): { ok: boolean; statusCode?: number } => ({ ok: true }),
  expoResponder: (_token: string): { ok: boolean; error?: string } => ({ ok: true }),
  throwWeb: false,
  throwExpo: false,
};

function resetRecorder(): void {
  recorder.webCalls = [];
  recorder.expoCalls = [];
  recorder.webResponder = () => ({ ok: true });
  recorder.expoResponder = () => ({ ok: true });
  recorder.throwWeb = false;
  recorder.throwExpo = false;
}

const transport: PushTransport = {
  async sendWebPush(sub, payload) {
    recorder.webCalls.push({ endpoint: sub.endpoint, payload });
    if (recorder.throwWeb) throw new Error('simulated web push transport failure');
    return recorder.webResponder(sub.endpoint);
  },
  async sendExpo(tokens, payload) {
    recorder.expoCalls.push({ tokens: [...tokens], payload });
    if (recorder.throwExpo) throw new Error('simulated expo transport failure');
    return tokens.map((token) => ({ token, ...recorder.expoResponder(token) }));
  },
};

pushModule.setPushTransport(transport);

function countWeb(endpoint: string): number {
  return recorder.webCalls.filter((c) => c.endpoint === endpoint).length;
}
function countExpo(token: string): number {
  return recorder.expoCalls.reduce((n, c) => n + c.tokens.filter((t) => t === token).length, 0);
}

function payload(title: string): PushNotificationPayload {
  return { title, body: `body for ${title}`, url: '/x' };
}

// ---------------------------------------------------------------------------
// Assertion / check harness (mirrors scripts/verify-payments.ts house style)
// ---------------------------------------------------------------------------

let checksTotal = 0;
let checksFailed = 0;
const failureSummaries: string[] = [];

async function runCheck(
  n: number,
  title: string,
  fn: (assert: (cond: boolean, msg: string) => void) => Promise<void> | void
): Promise<void> {
  checksTotal++;
  const failures: string[] = [];
  const assertFn = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };
  try {
    await fn(assertFn);
  } catch (err: any) {
    failures.push(`threw unexpectedly: ${err?.message || err}`);
    if (err?.stack) failures.push(String(err.stack).split('\n').slice(1, 4).join(' | '));
  }
  if (failures.length === 0) {
    console.log(`✅ Check ${n}: ${title}`);
  } else {
    checksFailed++;
    console.log(`❌ Check ${n}: ${title}`);
    for (const f of failures) console.log(`     - ${f}`);
    failureSummaries.push(`Check ${n} (${title}): ${failures.join('; ')}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('='.repeat(78));
  console.log('  verify-notifications — fully in-memory: touches neither the database nor the network');
  console.log('='.repeat(78));

  // -------------------------------------------------------------------
  // Check 1 — subject suppression at all four notification moments
  // -------------------------------------------------------------------
  await runCheck(1, 'subject suppression holds at all four notification moments (E1, mute row present)', async (assert) => {
    const moments: NotificationCategory[] = ['bets', 'bets', 'comments', 'resolutions'];
    for (const category of moments) {
      resetRecorder();
      const result = await pushModule.notifyEventAudience({ eventId: E1, category, payload: payload(category) });
      assert(countWeb(CAROL_WEB) === 0, `${category}: carol's web endpoint received 0 sends (got ${countWeb(CAROL_WEB)})`);
      assert(countExpo(CAROL_EXPO_TOKEN) === 0, `${category}: carol's Expo token received 0 sends (got ${countExpo(CAROL_EXPO_TOKEN)})`);
      assert(result.suppressed.muted.includes(CAROL), `${category}: carol appears in result.suppressed.muted`);
    }
  });

  // -------------------------------------------------------------------
  // Check 2 — suppression survives a missing mute row (non-bypassable)
  // -------------------------------------------------------------------
  await runCheck(2, 'subject suppression survives a missing event_notification_mutes row', async (assert) => {
    const savedMutes = state.mutes;
    state.mutes = []; // simulate the insert having been skipped / row deleted
    try {
      const moments: NotificationCategory[] = ['bets', 'bets', 'comments', 'resolutions'];
      for (const category of moments) {
        resetRecorder();
        const result = await pushModule.notifyEventAudience({ eventId: E1, category, payload: payload(category) });
        assert(countWeb(CAROL_WEB) === 0, `${category}: carol's web endpoint still received 0 sends with no mute row (got ${countWeb(CAROL_WEB)})`);
        assert(countExpo(CAROL_EXPO_TOKEN) === 0, `${category}: carol's Expo token still received 0 sends with no mute row (got ${countExpo(CAROL_EXPO_TOKEN)})`);
        assert(result.suppressed.muted.includes(CAROL), `${category}: carol still appears in result.suppressed.muted via the event-row check`);
      }
    } finally {
      state.mutes = savedMutes;
    }
  });

  // -------------------------------------------------------------------
  // Check 3 — control: E2 has no subject, carol receives exactly one send
  // -------------------------------------------------------------------
  await runCheck(3, 'control: on E2 (no subject) carol receives exactly one notification', async (assert) => {
    resetRecorder();
    await pushModule.notifyEventAudience({ eventId: E2, category: 'bets', payload: payload('bets') });
    assert(countExpo(CAROL_EXPO_TOKEN) === 1, `carol's Expo token received exactly 1 send (got ${countExpo(CAROL_EXPO_TOKEN)})`);
    assert(countWeb(CAROL_WEB) === 0, `carol's web endpoint received 0 sends (mobile wins) (got ${countWeb(CAROL_WEB)})`);
  });

  // -------------------------------------------------------------------
  // Check 4 — dedupe: one user, two subscriptions, exactly one delivery
  // -------------------------------------------------------------------
  await runCheck(4, 'dedupe: carol (web + mobile) gets exactly one delivery, not two', async (assert) => {
    resetRecorder();
    const result = await pushModule.notifyEventAudience({ eventId: E2, category: 'bets', payload: payload('bets') });
    assert(countWeb(CAROL_WEB) === 0, `carol's web endpoint appears 0 times (got ${countWeb(CAROL_WEB)})`);
    assert(countExpo(CAROL_EXPO_TOKEN) === 1, `carol's Expo token appears exactly once (got ${countExpo(CAROL_EXPO_TOKEN)})`);
    assert(result.recipients === 4, `all 4 active members are recipients (got ${result.recipients})`);
    assert(result.delivered === 4, `delivered === recipients — one delivery per recipient, no double-send (got ${result.delivered})`);
  });

  // -------------------------------------------------------------------
  // Check 5 — actor exclusion
  // -------------------------------------------------------------------
  await runCheck(5, 'excludeUserIds excludes the actor (alice) from delivery', async (assert) => {
    resetRecorder();
    const result = await pushModule.notifyEventAudience({
      eventId: E2,
      category: 'bets',
      payload: payload('bets'),
      excludeUserIds: [ALICE],
    });
    assert(countWeb(ALICE_WEB) === 0, `alice's web endpoint received 0 sends (got ${countWeb(ALICE_WEB)})`);
    assert(result.suppressed.excluded.includes(ALICE), 'alice appears in result.suppressed.excluded');
  });

  // -------------------------------------------------------------------
  // Check 6 — no platform-wide broadcast
  // -------------------------------------------------------------------
  await runCheck(6, 'eve (active subscription, NOT a group member) receives nothing; sendPushToAllSubscribers is gone', async (assert) => {
    resetRecorder();
    await pushModule.notifyEventAudience({ eventId: E1, category: 'bets', payload: payload('bets') });
    await pushModule.notifyEventAudience({ eventId: E2, category: 'bets', payload: payload('bets') });
    assert(countWeb(EVE_WEB) === 0, `eve's web endpoint received 0 sends across E1+E2 (got ${countWeb(EVE_WEB)})`);

    const repoRoot = path.join(__dirname, '..');
    const pushSrc = fs.readFileSync(path.join(repoRoot, 'lib', 'push.ts'), 'utf8');
    assert(!pushSrc.includes('sendPushToAllSubscribers'), 'lib/push.ts no longer defines/references sendPushToAllSubscribers');

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf8');
          if (content.includes('sendPushToAllSubscribers')) offenders.push(full);
        }
      }
    };
    const appDir = path.join(repoRoot, 'app');
    if (fs.existsSync(appDir)) walk(appDir);
    assert(offenders.length === 0, `no file under app/ imports sendPushToAllSubscribers (found: ${offenders.join(', ') || 'none'})`);
  });

  // -------------------------------------------------------------------
  // Check 7 — preferences: master push_enabled switch
  // -------------------------------------------------------------------
  await runCheck(7, 'notification_preferences.push_enabled=false suppresses every category (bob)', async (assert) => {
    state.prefs.set(BOB, {
      user_id: BOB,
      push_enabled: false,
      email_enabled: false,
      categories: { ...DEFAULT_NOTIFICATION_CATEGORIES },
    });
    try {
      resetRecorder();
      const result = await pushModule.notifyEventAudience({ eventId: E2, category: 'bets', payload: payload('bets') });
      assert(countWeb(BOB_WEB) === 0, `bob's web endpoint received 0 sends (got ${countWeb(BOB_WEB)})`);
      assert(result.suppressed.prefs.includes(BOB), 'bob appears in result.suppressed.prefs');
    } finally {
      state.prefs.delete(BOB);
    }
  });

  // -------------------------------------------------------------------
  // Check 8 — preferences: per-category switch
  // -------------------------------------------------------------------
  await runCheck(8, 'per-category preference blocks comments but allows bets (dave)', async (assert) => {
    state.prefs.set(DAVE, {
      user_id: DAVE,
      push_enabled: true,
      email_enabled: false,
      categories: { ...DEFAULT_NOTIFICATION_CATEGORIES, comments: false, bets: true },
    });
    try {
      resetRecorder();
      const commentsResult = await pushModule.notifyEventAudience({ eventId: E2, category: 'comments', payload: payload('comments') });
      assert(countExpo(DAVE_EXPO_TOKEN) === 0, `comments send: dave's Expo token received 0 sends (got ${countExpo(DAVE_EXPO_TOKEN)})`);
      assert(commentsResult.suppressed.prefs.includes(DAVE), 'comments send: dave appears in result.suppressed.prefs');

      resetRecorder();
      const betsResult = await pushModule.notifyEventAudience({ eventId: E2, category: 'bets', payload: payload('bets') });
      assert(countExpo(DAVE_EXPO_TOKEN) === 1, `bets send: dave's Expo token received exactly 1 send (got ${countExpo(DAVE_EXPO_TOKEN)})`);
      assert(!betsResult.suppressed.prefs.includes(DAVE), 'bets send: dave is NOT in result.suppressed.prefs');
    } finally {
      state.prefs.delete(DAVE);
    }
  });

  // -------------------------------------------------------------------
  // Check 9 — preferences default: no row means fully enabled, no row created
  // -------------------------------------------------------------------
  await runCheck(9, 'a user with no notification_preferences row is treated as fully enabled, and no row gets created', async (assert) => {
    assert(!state.prefs.has(CAROL), 'precondition: carol has no preferences row');
    const sizeBefore = state.prefs.size;
    resetRecorder();
    const result = await pushModule.notifyEventAudience({ eventId: E2, category: 'bets', payload: payload('bets') });
    assert(countExpo(CAROL_EXPO_TOKEN) === 1, `carol (no prefs row) still received exactly 1 send (got ${countExpo(CAROL_EXPO_TOKEN)})`);
    assert(!result.suppressed.prefs.includes(CAROL), 'carol is not suppressed by prefs');
    assert(state.prefs.size === sizeBefore, `fixture preferences store is unchanged after the send (size ${sizeBefore} -> ${state.prefs.size})`);
    assert(!state.prefs.has(CAROL), 'still no preferences row was created for carol');
  });

  // -------------------------------------------------------------------
  // Check 10 — pruning of dead subscriptions
  // -------------------------------------------------------------------
  await runCheck(10, 'dead subscriptions (410/404 web, DeviceNotRegistered Expo) are pruned; plain failures are not', async (assert) => {
    const WEB_410 = 'user-web-410';
    const WEB_404 = 'user-web-404';
    const WEB_500 = 'user-web-500';
    const EXPO_DNR = 'user-expo-dnr';
    const EXPO_RATE = 'user-expo-rate';

    const EP_410 = 'endpoint://prune-410';
    const EP_404 = 'endpoint://prune-404';
    const EP_500 = 'endpoint://prune-500';
    const EP_DNR = 'endpoint://prune-dnr';
    const TOKEN_DNR = 'ExponentPushToken[dnr]';
    const EP_RATE = 'endpoint://prune-rate';
    const TOKEN_RATE = 'ExponentPushToken[rate]';

    const pruneSubs: PushSubscription[] = [
      { id: 101, user_id: WEB_410, endpoint: EP_410, p256dh: 'p', auth: 'a', platform: 'web' },
      { id: 102, user_id: WEB_404, endpoint: EP_404, p256dh: 'p', auth: 'a', platform: 'web' },
      { id: 103, user_id: WEB_500, endpoint: EP_500, p256dh: 'p', auth: 'a', platform: 'web' },
      { id: 104, user_id: EXPO_DNR, endpoint: EP_DNR, expo_token: TOKEN_DNR, platform: 'mobile' },
      { id: 105, user_id: EXPO_RATE, endpoint: EP_RATE, expo_token: TOKEN_RATE, platform: 'mobile' },
    ];
    state.pushSubs.push(...pruneSubs);

    resetRecorder();
    recorder.webResponder = (endpoint) => {
      if (endpoint === EP_410) return { ok: false, statusCode: 410 };
      if (endpoint === EP_404) return { ok: false, statusCode: 404 };
      if (endpoint === EP_500) return { ok: false, statusCode: 500 };
      return { ok: true };
    };
    recorder.expoResponder = (token) => {
      if (token === TOKEN_DNR) return { ok: false, error: 'DeviceNotRegistered' };
      if (token === TOKEN_RATE) return { ok: false, error: 'MessageRateExceeded' };
      return { ok: true };
    };

    const deletedBefore = state.deletedEndpoints.length;
    const result = await pushModule.notifyUsers({
      userIds: [WEB_410, WEB_404, WEB_500, EXPO_DNR, EXPO_RATE],
      category: 'bets',
      payload: payload('prune'),
    });
    const newlyDeleted = state.deletedEndpoints.slice(deletedBefore).sort();
    const expectedDeleted = [EP_410, EP_404, EP_DNR].sort();

    assert(
      JSON.stringify(newlyDeleted) === JSON.stringify(expectedDeleted),
      `db.pushSubscriptions.delete was called with exactly {410, 404, DeviceNotRegistered} endpoints (got ${JSON.stringify(newlyDeleted)}, expected ${JSON.stringify(expectedDeleted)})`
    );
    assert(result.pruned === 3, `result.pruned === 3 (got ${result.pruned})`);
    assert(
      !state.deletedEndpoints.slice(deletedBefore).includes(EP_500),
      'a plain 500 failure did not delete the subscription'
    );
    assert(
      !state.deletedEndpoints.slice(deletedBefore).includes(EP_RATE),
      'an Expo MessageRateExceeded failure did not delete the subscription'
    );
    assert(
      state.pushSubs.some((s) => s.endpoint === EP_500),
      'the 500 subscription row still exists in the fixture'
    );
    assert(
      state.pushSubs.some((s) => s.endpoint === EP_RATE),
      'the MessageRateExceeded subscription row still exists in the fixture'
    );

    // Clean up any surviving synthetic rows so later checks see a clean set.
    state.pushSubs = state.pushSubs.filter((s) => !pruneSubs.some((p) => p.endpoint === s.endpoint));
  });

  // -------------------------------------------------------------------
  // Check 11 — a throwing transport must not make notifyUsers reject
  // -------------------------------------------------------------------
  await runCheck(11, 'push transport throwing never propagates — notifyUsers resolves with a result', async (assert) => {
    resetRecorder();
    recorder.throwWeb = true;
    recorder.throwExpo = true;

    let threw = false;
    let result: NotifyResult | undefined;
    try {
      result = await pushModule.notifyEventAudience({ eventId: E2, category: 'bets', payload: payload('bets') });
    } catch {
      threw = true;
    }
    assert(!threw, 'notifyEventAudience did not reject even though every transport call throws');
    assert(!!result, 'a NotifyResult object was returned');
    assert(result?.delivered === 0, `delivered === 0 when transport always throws (got ${result?.delivered})`);
    assert((result?.failed ?? 0) > 0, `failed > 0 when transport always throws (got ${result?.failed})`);
  });

  // -------------------------------------------------------------------
  // Check 12 — Expo batching in chunks of (at most) 100
  // -------------------------------------------------------------------
  await runCheck(12, 'Expo sends are chunked into batches of at most 100 tokens (250 recipients -> 100/100/50)', async (assert) => {
    const batchUserIds: string[] = [];
    const batchTokens: string[] = [];
    const batchSubs: PushSubscription[] = [];
    for (let i = 0; i < 250; i++) {
      const userId = `batch-user-${i}`;
      const token = `ExponentPushToken[batch-${i}]`;
      batchUserIds.push(userId);
      batchTokens.push(token);
      batchSubs.push({ id: 1000 + i, user_id: userId, endpoint: `endpoint://batch-${i}`, expo_token: token, platform: 'mobile' });
    }
    state.pushSubs.push(...batchSubs);

    try {
      resetRecorder();
      await pushModule.notifyUsers({ userIds: batchUserIds, category: 'bets', payload: payload('batch') });

      assert(recorder.expoCalls.length === 3, `sendExpo was called 3 times (got ${recorder.expoCalls.length})`);
      const sizes = recorder.expoCalls.map((c) => c.tokens.length);
      assert(JSON.stringify(sizes) === JSON.stringify([100, 100, 50]), `chunk sizes were 100/100/50 (got ${JSON.stringify(sizes)})`);

      const allSent = recorder.expoCalls.flatMap((c) => c.tokens);
      const uniqueSent = new Set(allSent);
      assert(allSent.length === 250, `250 total token sends recorded (got ${allSent.length})`);
      assert(uniqueSent.size === 250, `every token appears exactly once across the calls (got ${uniqueSent.size} unique of ${allSent.length})`);
      assert(batchTokens.every((t) => uniqueSent.has(t)), 'every fixture token was included in some chunk');
    } finally {
      state.pushSubs = state.pushSubs.filter((s) => !batchSubs.some((b) => b.endpoint === s.endpoint));
    }
  });

  // -------------------------------------------------------------------
  // Check 13 — activity feed suppression for the hidden subject
  // -------------------------------------------------------------------
  await runCheck(13, 'filterActivitiesForViewer hides E1 activities from carol while active, reveals them once resolved', async (assert) => {
    const activities = [
      { event_id: E1, type: 'bet' as const },
      { event_id: E1, type: 'comment' as const },
      { event_id: E2, type: 'bet' as const },
      { event_id: null as any, type: 'comment' as const },
    ];

    const e1 = state.events.get(E1)!;
    const originalStatus = e1.status;
    try {
      e1.status = 'active';

      const forCarolActive = await pushModule.filterActivitiesForViewer(CAROL, activities);
      assert(
        forCarolActive.every((a) => a.event_id !== E1),
        `carol (subject, active event): all E1 activities dropped (got ${forCarolActive.filter((a) => a.event_id === E1).length} remaining)`
      );
      assert(
        forCarolActive.some((a) => a.event_id === E2) && forCarolActive.some((a) => a.event_id === null),
        'carol: E2 and event-less activities are kept'
      );
      assert(forCarolActive.length === 2, `carol: exactly 2 activities remain (got ${forCarolActive.length})`);

      const forBobActive = await pushModule.filterActivitiesForViewer(BOB, activities);
      assert(
        forBobActive.length === activities.length,
        `bob (non-subject viewer): sees all ${activities.length} activities while E1 is active (got ${forBobActive.length})`
      );

      e1.status = 'resolved';
      const forCarolResolved = await pushModule.filterActivitiesForViewer(CAROL, activities);
      assert(
        forCarolResolved.length === activities.length,
        `carol: once E1 is resolved, all ${activities.length} activities are visible again (got ${forCarolResolved.length})`
      );
    } finally {
      e1.status = originalStatus;
    }
  });

  // -------------------------------------------------------------------
  // Check 14 — applySubjectPrivacy writes exactly one mute row, only when warranted
  // -------------------------------------------------------------------
  await runCheck(14, 'applySubjectPrivacy writes a subject_hidden mute row iff notifySubject is false and a subject exists', async (assert) => {
    const before = state.mutes.length;
    await pushModule.applySubjectPrivacy('e14a', CAROL, false);
    assert(state.mutes.length === before + 1, `notifySubject=false + subject: exactly one mute row added (before=${before}, after=${state.mutes.length})`);
    const row = state.mutes.find((m) => m.event_id === 'e14a');
    assert(!!row && row.user_id === CAROL && row.reason === 'subject_hidden', 'the row has user_id=carol and reason=subject_hidden');

    const afterFirst = state.mutes.length;
    await pushModule.applySubjectPrivacy('e14b', CAROL, true);
    assert(state.mutes.length === afterFirst, `notifySubject=true: no mute row added (before=${afterFirst}, after=${state.mutes.length})`);

    await pushModule.applySubjectPrivacy('e14c', null, false);
    assert(state.mutes.length === afterFirst, `subject=null: no mute row added (before=${afterFirst}, after=${state.mutes.length})`);

    // Clean up so this check's rows don't affect anything after it (nothing does, but stay tidy).
    state.mutes = state.mutes.filter((m) => m.event_id !== 'e14a');
  });

  // -------------------------------------------------------------------
  console.log('\n' + '='.repeat(78));
  const passed = checksTotal - checksFailed;
  console.log(`  ${passed}/${checksTotal} checks passed`);
  if (checksFailed > 0) {
    console.log('\n  Failures:');
    for (const f of failureSummaries) console.log(`    - ${f}`);
  }
  console.log('='.repeat(78));

  process.exit(checksFailed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
