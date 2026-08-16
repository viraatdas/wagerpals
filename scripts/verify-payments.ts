// End-to-end proof-of-correctness for the real-money betting payment engine.
//
// Drives the REAL Next.js route handlers (app/api/bets, app/api/events/*,
// app/api/wallet, app/api/webhooks/stripe) directly as functions — no HTTP
// server, no mocks. Every dollar that moves, moves through lib/payments.ts
// exactly the way it would in production.
//
// SAFETY: this runs against the shared Neon dev database, which has real
// user data. Every row this script creates is tagged with a unique run
// prefix (`RUN`), and cleanup deletes ONLY rows carrying that prefix (or,
// for event ids the API generates itself, rows whose id this script itself
// captured from a create response). Nothing pre-existing is ever touched.
// Outbound push is also stubbed before any route module is imported (see
// below) so this script never fires real HTTPS push attempts at the real
// device endpoints sitting in this database's push_subscriptions table.
//
// Run: npx tsx scripts/verify-payments.ts
// Debug (skip cleanup): npx tsx scripts/verify-payments.ts --keep

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_verify_payments_local';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_verify_payments_local';

// Neutralize outbound push before any route handler runs.
//
// This database holds real push subscriptions on real devices. Every route
// this script exercises notifies the event's group, which means live HTTPS
// requests to real browser endpoints and to Expo — a real side effect on real
// users' devices. A verification script must not do that. The routes wrap
// push in their own try/catch and treat failure as non-fatal, so stubbing it
// changes nothing about the money paths under test.
//
// lib/push.ts routes every send through a swappable transport, so replacing
// it here covers BOTH web push and Expo (mutating web-push alone would leave
// the Expo fetch live).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pushModule = require('../lib/push');
pushModule.setPushTransport({
  sendWebPush: async () => ({ ok: true }),
  sendExpo: async (tokens: string[]) => tokens.map((token) => ({ token, ok: true })),
});

import { NextRequest } from 'next/server';
import { sql } from '@vercel/postgres';
import Stripe from 'stripe';

import * as betsRoute from '../app/api/bets/route';
import * as eventsRoute from '../app/api/events/route';
import * as resolveRoute from '../app/api/events/resolve/route';
import * as unresolveRoute from '../app/api/events/unresolve/route';
import * as walletRoute from '../app/api/wallet/route';
import * as webhookRoute from '../app/api/webhooks/stripe/route';

const KEEP = process.argv.includes('--keep');
const RUN = `vp_${Date.now().toString(36)}`;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let totalChecks = 0;
let failedChecks = 0;
const failureMessages: string[] = [];

function assert(condition: boolean, message: string): void {
  totalChecks++;
  if (condition) {
    console.log(`    ✅ ${message}`);
  } else {
    failedChecks++;
    console.log(`    ❌ ${message}`);
    failureMessages.push(message);
  }
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function assertMoney(actual: number, expected: number, message: string): void {
  const a = Math.round((actual + Number.EPSILON) * 100);
  const e = Math.round((expected + Number.EPSILON) * 100);
  assert(a === e, `${message} (actual=${money(a / 100)}, expected=${money(e / 100)})`);
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n▶ ${name}`);
  const before = failedChecks;
  try {
    await fn();
  } catch (err: any) {
    failedChecks++;
    totalChecks++;
    const msg = `${name} — unexpected exception: ${err?.message || err}`;
    console.log(`    ❌ ${msg}`);
    if (err?.stack) console.log(String(err.stack).split('\n').slice(0, 5).join('\n'));
    failureMessages.push(msg);
  }
  console.log(failedChecks === before ? `  ✅ ${name}` : `  ❌ ${name}`);
}

// ---------------------------------------------------------------------------
// Route-calling helper (per team guidance: call handlers as plain functions)
// ---------------------------------------------------------------------------

async function callRoute(
  handler: (req: NextRequest) => Promise<Response>,
  url: string,
  init?: { method?: string; body?: any; userId?: string; headers?: Record<string, string> }
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init?.headers || {}) };
  if (init?.userId) headers['x-stack-user-id'] = init.userId;
  const req = new NextRequest(`http://localhost:3000${url}`, {
    method: init?.method || 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const res = await handler(req);
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function callWebhook(payload: string, signature: string): Promise<{ status: number; body: any }> {
  const req = new NextRequest('http://localhost:3000/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
  const res = await webhookRoute.POST(req);
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// DB read helpers used for assertions (never write-modify anything not ours)
// ---------------------------------------------------------------------------

async function walletBalance(userId: string): Promise<number> {
  const r = await sql`SELECT balance FROM wallets WHERE user_id = ${userId}`;
  return r.rows.length ? parseFloat(r.rows[0].balance) : 0;
}

async function ledgerSum(userId: string): Promise<number> {
  const r = await sql`SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM transactions WHERE user_id = ${userId} AND status = 'completed'`;
  return parseFloat(r.rows[0].total);
}

async function eventLedgerSum(eventId: string): Promise<number> {
  const r = await sql`SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM transactions WHERE event_id = ${eventId} AND status = 'completed'`;
  return parseFloat(r.rows[0].total);
}

async function heldHoldsCount(eventId: string): Promise<number> {
  const r = await sql`SELECT COUNT(*)::int AS n FROM escrow_holds WHERE event_id = ${eventId} AND status = 'held'`;
  return r.rows[0].n as number;
}

async function eventHeldTotal(eventId: string): Promise<number> {
  const r = await sql`SELECT COALESCE(SUM(amount), 0)::numeric AS total FROM escrow_holds WHERE event_id = ${eventId} AND status = 'held'`;
  return parseFloat(r.rows[0].total);
}

interface UserSnapshot {
  bets: number;
  holds: number;
  txns: number;
  balance: number;
}

async function snapshotUser(userId: string): Promise<UserSnapshot> {
  const [b, e, t] = await Promise.all([
    sql`SELECT COUNT(*)::int AS n FROM bets WHERE user_id = ${userId}`,
    sql`SELECT COUNT(*)::int AS n FROM escrow_holds WHERE user_id = ${userId}`,
    sql`SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = ${userId}`,
  ]);
  return {
    bets: b.rows[0].n as number,
    holds: e.rows[0].n as number,
    txns: t.rows[0].n as number,
    balance: await walletBalance(userId),
  };
}

function assertSnapshotUnchanged(before: UserSnapshot, after: UserSnapshot, label: string): void {
  assert(before.bets === after.bets, `${label}: bets count unchanged (${before.bets} -> ${after.bets})`);
  assert(before.holds === after.holds, `${label}: escrow_holds count unchanged (${before.holds} -> ${after.holds})`);
  assert(before.txns === after.txns, `${label}: transactions count unchanged (${before.txns} -> ${after.txns})`);
  assertMoney(after.balance, before.balance, `${label}: wallet balance unchanged`);
}

async function checkInvariant1(userId: string, label: string): Promise<void> {
  const sum = await ledgerSum(userId);
  const bal = await walletBalance(userId);
  assertMoney(bal, sum, `invariant1: ${label} wallet balance === Σtransactions`);
}

async function checkInvariant2(eventId: string, label: string): Promise<void> {
  const sum = await eventLedgerSum(eventId);
  assertMoney(sum, 0, `invariant2: ${label} event ledger sums to 0`);
}

async function checkInvariant3(eventId: string, label: string): Promise<void> {
  const n = await heldHoldsCount(eventId);
  assert(n === 0, `invariant3: ${label} has no stranded 'held' escrow (found ${n})`);
}

async function checkInvariant4(userIds: string[], label: string): Promise<void> {
  const r = await sql`SELECT MIN(balance)::numeric AS min_balance FROM wallets WHERE user_id = ANY(${userIds as any}::text[])`;
  const min = r.rows[0].min_balance === null ? 0 : parseFloat(r.rows[0].min_balance);
  assert(min >= 0, `invariant4: ${label} no negative balance across test users (min=${money(min)})`);
}

// ---------------------------------------------------------------------------
// Stripe webhook helpers
// ---------------------------------------------------------------------------

function buildDepositEvent(stripeEventId: string, paymentIntentId: string, amountDollars: number, userId: string) {
  return {
    id: stripeEventId,
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: paymentIntentId,
        object: 'payment_intent',
        amount: Math.round(amountDollars * 100),
        currency: 'usd',
        status: 'succeeded',
        metadata: { user_id: userId, type: 'deposit' },
      },
    },
  };
}

function sign(payload: string): string {
  // The `stripe` package's TS types mark timestamp/scheme/signature/cryptoProvider
  // as required on WebhookTestHeaderOptions, but the runtime (Webhooks.js
  // prepareOptions) fills sensible defaults for all of them — only payload+secret
  // are actually needed. Cast to satisfy the (overly strict) type.
  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  } as any);
}

interface DepositRecord {
  paymentIntentId: string;
  payload: string;
  signature: string;
  stripeEventId: string;
}

// Inserts the pending deposit transaction exactly the way app/api/wallet/route.ts
// does (non-null idempotency_key of the form deposit:<user>:<key>), then fires the
// signed webhook that credits it. This is our own setup row (RUN-prefixed id),
// never anything pre-existing.
async function performDeposit(userId: string, label: string, amountDollars: number): Promise<DepositRecord> {
  const paymentIntentId = `pi_${RUN}_${label}`;
  const pendingTxnId = `${RUN}_txn_pending_${label}`;
  const idemKey = `deposit:${userId}:${RUN}_${label}_dep1`;
  await sql`
    INSERT INTO transactions (id, user_id, type, amount, status, stripe_payment_intent_id, description, idempotency_key)
    VALUES (${pendingTxnId}, ${userId}, 'deposit', ${amountDollars}, 'pending', ${paymentIntentId}, ${`Deposit $${amountDollars.toFixed(2)}`}, ${idemKey})
  `;
  const stripeEventId = `evt_${RUN}_${label}_1`;
  const payload = JSON.stringify(buildDepositEvent(stripeEventId, paymentIntentId, amountDollars, userId));
  const signature = sign(payload);
  return { paymentIntentId, payload, signature, stripeEventId };
}

// ---------------------------------------------------------------------------
// Table printing (step 14)
// ---------------------------------------------------------------------------

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? '').length)));
  const fmt = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(fmt(headers));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  rows.forEach(r => console.log(fmt(r)));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('='.repeat(78));
  console.log(`  verify-payments — run tag: ${RUN}`);
  console.log('='.repeat(78));

  // Identities
  const aliceId = `${RUN}_alice`;
  const bobId = `${RUN}_bob`;
  const carolId = `${RUN}_carol`;
  const daveId = `${RUN}_dave`;
  const testUserIds = [aliceId, bobId, carolId, daveId];
  const usernames: Record<string, string> = {
    [aliceId]: `${RUN}_alice`,
    [bobId]: `${RUN}_bob`,
    [carolId]: `${RUN}_carol`,
    [daveId]: `${RUN}_dave`,
  };
  const labels: Record<string, string> = { [aliceId]: 'alice', [bobId]: 'bob', [carolId]: 'carol', [daveId]: 'dave' };

  const groupId = `${RUN}_grp`;
  const oneHourOut = Date.now() + 60 * 60 * 1000;

  const createdEventIds: string[] = []; // captured from live API responses; used for exact-id cleanup
  let ev1Id = '';
  let ev2Id = '';
  let ev3Id = '';
  let ev4Id = '';
  let ev5Id = '';
  const potByEvent: Record<string, number> = {};
  const eventLabel: Record<string, string> = {};

  try {
    // -----------------------------------------------------------------
    // Setup
    // -----------------------------------------------------------------
    await step('Setup: users, group, membership', async () => {
      for (const uid of testUserIds) {
        await sql`
          INSERT INTO users (id, username, net_total, total_bet, streak)
          VALUES (${uid}, ${usernames[uid]}, 0, 0, 0)
        `;
      }
      await sql`
        INSERT INTO groups (id, name, created_by, resolver_user_id, is_public)
        VALUES (${groupId}, ${`Verify Payments ${RUN}`}, ${aliceId}, ${aliceId}, false)
      `;
      const roles: Array<[string, 'admin' | 'member']> = [
        [aliceId, 'admin'],
        [bobId, 'member'],
        [carolId, 'member'],
        [daveId, 'member'],
      ];
      for (const [uid, role] of roles) {
        await sql`INSERT INTO group_members (group_id, user_id, role, status) VALUES (${groupId}, ${uid}, ${role}, 'active')`;
      }
      const u = await sql`SELECT COUNT(*)::int AS n FROM users WHERE id = ANY(${testUserIds as any}::text[])`;
      assert(u.rows[0].n === 4, 'all 4 test users inserted');
      const g = await sql`SELECT 1 FROM groups WHERE id = ${groupId}`;
      assert(g.rows.length === 1, 'test group inserted');
      const gm = await sql`SELECT COUNT(*)::int AS n FROM group_members WHERE group_id = ${groupId}`;
      assert(gm.rows[0].n === 4, 'all 4 group_members inserted');
    });

    console.log(
      '\n  NOTE: carol is funded $100 (not the $50 mentioned in the task\'s Step 1 prose) so that the\n' +
        "  balance arithmetic explicitly spelled out in Steps 6/8 (\"carol 100 - 25 = 75\") is internally\n" +
        '  consistent with Step 10, where carol must still be able to place a $10 bet on ev3 after\n' +
        '  losing stakes on ev1 and ev2. Funding carol $50 as literally written would leave her with\n' +
        '  only $5 by Step 10 (below the $10 stake), which contradicts the Step 6/8 numbers and would\n' +
        '  make the scenario internally inconsistent — see the final report for details.'
    );

    // -----------------------------------------------------------------
    // Step 1 — deposit through the real Stripe webhook
    // -----------------------------------------------------------------
    let aliceDeposit!: DepositRecord;
    await step('Step 1: deposit through the real Stripe webhook (alice $100, bob $100, carol $100, dave $20)', async () => {
      const fundPlan: Array<[string, string, number]> = [
        [aliceId, 'alice', 100],
        [bobId, 'bob', 100],
        [carolId, 'carol', 100],
        [daveId, 'dave', 20],
      ];
      for (const [uid, label, amount] of fundPlan) {
        const dep = await performDeposit(uid, label, amount);
        if (uid === aliceId) aliceDeposit = dep;
        const { status, body } = await callWebhook(dep.payload, dep.signature);
        assert(status === 200, `${label}: webhook returns 200 (got ${status})`);
        assert(body?.credited === true && body?.duplicate === false, `${label}: webhook reports credited=true, duplicate=false`);
        const bal = await walletBalance(uid);
        assertMoney(bal, amount, `${label}: wallet balance equals deposited amount`);
        const txn = await sql`SELECT status FROM transactions WHERE stripe_payment_intent_id = ${dep.paymentIntentId}`;
        assert(txn.rows.length === 1 && txn.rows[0].status === 'completed', `${label}: pending deposit transaction is now completed`);
        await checkInvariant1(uid, label);
      }
      await checkInvariant4(testUserIds, 'after Step 1 deposits');
    });

    // -----------------------------------------------------------------
    // Step 2 — webhook replay guard
    // -----------------------------------------------------------------
    await step('Step 2: webhook replay guard (idempotency)', async () => {
      // Same event id replayed verbatim.
      const replay1 = await callWebhook(aliceDeposit.payload, aliceDeposit.signature);
      assert(replay1.status === 200, `replay (same event id): returns 200 (got ${replay1.status})`);
      assert(
        replay1.body?.duplicate === true || replay1.body?.credited === false,
        'replay (same event id): reports duplicate=true / credited=false'
      );
      let bal = await walletBalance(aliceId);
      assertMoney(bal, 100, 'replay (same event id): alice balance unchanged at $100');
      let count = await sql`SELECT COUNT(*)::int AS n FROM transactions WHERE stripe_payment_intent_id = ${aliceDeposit.paymentIntentId} AND status = 'completed'`;
      assert(count.rows[0].n === 1, 'replay (same event id): exactly one completed deposit transaction for this payment intent');

      // Different event id, same payment intent (redelivery-under-new-id case).
      const evt2Id = `evt_${RUN}_alice_2`;
      const payload2 = JSON.stringify(buildDepositEvent(evt2Id, aliceDeposit.paymentIntentId, 100, aliceId));
      const sig2 = sign(payload2);
      const replay2 = await callWebhook(payload2, sig2);
      assert(replay2.status === 200, `redelivery (new event id, same intent): returns 200 (got ${replay2.status})`);
      bal = await walletBalance(aliceId);
      assertMoney(bal, 100, 'redelivery (new event id, same intent): alice balance still $100');
      count = await sql`SELECT COUNT(*)::int AS n FROM transactions WHERE stripe_payment_intent_id = ${aliceDeposit.paymentIntentId} AND status = 'completed'`;
      assert(count.rows[0].n === 1, 'redelivery (new event id, same intent): still exactly one completed deposit');

      // Corrupted signature.
      const evt3Id = `evt_${RUN}_alice_3`;
      const payload3 = JSON.stringify(buildDepositEvent(evt3Id, aliceDeposit.paymentIntentId, 100, aliceId));
      const sig3 = sign(payload3);
      const corrupted = sig3.slice(0, -4) + 'dead';
      const badSigRes = await callWebhook(payload3, corrupted);
      assert(badSigRes.status === 400, `corrupted signature: rejected with 400 (got ${badSigRes.status})`);
      bal = await walletBalance(aliceId);
      assertMoney(bal, 100, 'corrupted signature: alice balance unchanged at $100');
      count = await sql`SELECT COUNT(*)::int AS n FROM transactions WHERE stripe_payment_intent_id = ${aliceDeposit.paymentIntentId} AND status = 'completed'`;
      assert(count.rows[0].n === 1, 'corrupted signature: still exactly one completed deposit');

      await checkInvariant1(aliceId, 'alice after Step 2');
      await checkInvariant4(testUserIds, 'after Step 2');
    });

    // -----------------------------------------------------------------
    // Step 3 — create events through the real route
    // -----------------------------------------------------------------
    await step('Step 3: create events through POST /api/events', async () => {
      const makeEvent = async (overrides: Record<string, any>) =>
        callRoute(eventsRoute.POST, '/api/events', {
          method: 'POST',
          userId: aliceId,
          body: {
            title: `${RUN} ${overrides.title}`,
            description: 'verify-payments test event',
            side_a: 'side_a',
            side_b: 'side_b',
            end_time: oneHourOut,
            group_id: groupId,
            creator_user_id: aliceId,
            creator_username: usernames[aliceId],
            ...overrides,
          },
        });

      const r1 = await makeEvent({ title: 'ev1-fixed25', payment_type: 'cash', stake_amount: 25 });
      assert(r1.status === 200, `ev1 create: 200 (got ${r1.status})`);
      ev1Id = r1.body?.id;
      if (ev1Id) {
        createdEventIds.push(ev1Id);
        eventLabel[ev1Id] = 'ev1 (fixed $25)';
      }

      const r2 = await makeEvent({ title: 'ev2-open', payment_type: 'cash', stake_amount: null });
      assert(r2.status === 200, `ev2 create: 200 (got ${r2.status})`);
      ev2Id = r2.body?.id;
      if (ev2Id) {
        createdEventIds.push(ev2Id);
        eventLabel[ev2Id] = 'ev2 (open stakes)';
      }

      const r3 = await makeEvent({ title: 'ev3-fixed10', payment_type: 'cash', stake_amount: 10 });
      assert(r3.status === 200, `ev3 create: 200 (got ${r3.status})`);
      ev3Id = r3.body?.id;
      if (ev3Id) {
        createdEventIds.push(ev3Id);
        eventLabel[ev3Id] = 'ev3 (fixed $10, no winners)';
      }

      const r4 = await makeEvent({ title: 'ev4-free', payment_type: 'none' });
      assert(r4.status === 200, `ev4 create: 200 (got ${r4.status})`);
      ev4Id = r4.body?.id;
      if (ev4Id) {
        createdEventIds.push(ev4Id);
        eventLabel[ev4Id] = 'ev4 (free control)';
      }

      for (const [id, expectedType, expectedStake] of [
        [ev1Id, 'cash', 25],
        [ev2Id, 'cash', null],
        [ev3Id, 'cash', 10],
        [ev4Id, 'none', null],
      ] as Array<[string, string, number | null]>) {
        if (!id) {
          assert(false, `event row exists to check (id was empty)`);
          continue;
        }
        const row = await sql`SELECT payment_type, stake_amount FROM events WHERE id = ${id}`;
        assert(row.rows.length === 1, `${eventLabel[id]}: row exists in DB`);
        assert(row.rows[0]?.payment_type === expectedType, `${eventLabel[id]}: payment_type === '${expectedType}'`);
        const actualStake = row.rows[0]?.stake_amount === null ? null : parseFloat(row.rows[0].stake_amount);
        assert(actualStake === expectedStake, `${eventLabel[id]}: stake_amount === ${expectedStake === null ? 'null' : expectedStake}`);
      }

      const bad1 = await makeEvent({ title: 'ev-bad-stake-0', payment_type: 'cash', stake_amount: 0 });
      assert(bad1.status === 400, `stake_amount: 0 rejected with 400 (got ${bad1.status})`);
      assert(!bad1.body?.id, 'stake_amount: 0 — no event id returned (nothing created)');

      const bad2 = await makeEvent({ title: 'ev-bad-stake-600', payment_type: 'cash', stake_amount: 600 });
      assert(bad2.status === 400, `stake_amount: 600 rejected with 400 (got ${bad2.status})`);
      assert(!bad2.body?.id, 'stake_amount: 600 — no event id returned (nothing created)');
    });

    // -----------------------------------------------------------------
    // Step 4 — place cash bets (fixed stake) on ev1
    // -----------------------------------------------------------------
    await step('Step 4: place fixed-stake cash bets on ev1', async () => {
      const placeBet = (userId: string, side: string, amount: number) =>
        callRoute(betsRoute.POST, '/api/bets', {
          method: 'POST',
          userId,
          body: { event_id: ev1Id, user_id: userId, username: usernames[userId], side, amount },
        });

      const bettors: Array<[string, string, number]> = [
        [aliceId, 'side_a', 25],
        [bobId, 'side_a', 25],
        [carolId, 'side_b', 25],
      ];
      for (const [uid, side, amount] of bettors) {
        const label = labels[uid];
        const before = await walletBalance(uid);
        const res = await placeBet(uid, side, amount);
        assert(res.status === 200, `${label} bets $${amount} on ${side}: 200 (got ${res.status})`);
        const after = await walletBalance(uid);
        assertMoney(after, before - amount, `${label}: wallet debited by exactly $${amount}`);
        const hold = await sql`SELECT status FROM escrow_holds WHERE event_id = ${ev1Id} AND user_id = ${uid} ORDER BY created_at DESC LIMIT 1`;
        assert(hold.rows.length === 1 && hold.rows[0].status === 'held', `${label}: escrow_holds row in 'held' status`);
        const txn = await sql`SELECT amount FROM transactions WHERE event_id = ${ev1Id} AND user_id = ${uid} AND type = 'escrow_hold' ORDER BY created_at DESC LIMIT 1`;
        assert(txn.rows.length === 1 && parseFloat(txn.rows[0].amount) === -amount, `${label}: escrow_hold transaction of -$${amount}`);
        assert(!!res.body?.escrow_hold_id, `${label}: bet row carries escrow_hold_id`);
        await checkInvariant1(uid, label);
      }

      const pot = await eventHeldTotal(ev1Id);
      assertMoney(pot, 75, 'ev1 held total (pot) is $75');

      // Wrong amount on a fixed-stake event: must be rejected and write nothing.
      const before = await snapshotUser(daveId);
      const wrong = await placeBet(daveId, 'side_a', 10);
      assert(wrong.status === 400, `dave: wrong-amount bet ($10 on a $25-fixed event) rejected 400 (got ${wrong.status})`);
      assert(wrong.body?.code === 'INVALID_STAKE', `dave: wrong-amount bet rejected with code INVALID_STAKE (got ${wrong.body?.code})`);
      const after = await snapshotUser(daveId);
      assertSnapshotUnchanged(before, after, 'dave (wrong-amount bet)');

      await checkInvariant4(testUserIds, 'after Step 4');
    });

    // -----------------------------------------------------------------
    // Step 5 — insufficient funds writes nothing
    // -----------------------------------------------------------------
    await step('Step 5: insufficient funds writes nothing (dave, $20 balance, $25 bet)', async () => {
      const before = await snapshotUser(daveId);
      const res = await callRoute(betsRoute.POST, '/api/bets', {
        method: 'POST',
        userId: daveId,
        body: { event_id: ev1Id, user_id: daveId, username: usernames[daveId], side: 'side_a', amount: 25 },
      });
      assert(res.status === 400, `dave: insufficient-funds bet rejected 400 (got ${res.status})`);
      assert(res.body?.code === 'INSUFFICIENT_FUNDS', `dave: rejected with code INSUFFICIENT_FUNDS (got ${res.body?.code})`);
      assert(res.body?.shortfall === 5, `dave: shortfall === 5 (got ${res.body?.shortfall})`);
      const after = await snapshotUser(daveId);
      assertSnapshotUnchanged(before, after, 'dave (insufficient funds)');
      await checkInvariant4(testUserIds, 'after Step 5');
    });

    // -----------------------------------------------------------------
    // Step 6 — resolve ev1 and check the arithmetic
    // -----------------------------------------------------------------
    await step('Step 6: resolve ev1 (side_a wins)', async () => {
      const res = await callRoute(resolveRoute.POST, '/api/events/resolve', {
        method: 'POST',
        userId: aliceId,
        body: { event_id: ev1Id, winning_side: 'side_a' },
      });
      assert(res.status === 200, `resolve ev1: 200 (got ${res.status})`);
      const settlement = res.body?.settlement;
      potByEvent[ev1Id] = settlement?.pot;
      assertMoney(settlement?.pot, 75, 'settlement.pot === $75');
      const alicePayout = settlement?.payouts?.find((p: any) => p.user_id === aliceId);
      const bobPayout = settlement?.payouts?.find((p: any) => p.user_id === bobId);
      assertMoney(alicePayout?.gross, 37.5, 'alice gross === $37.50');
      assertMoney(bobPayout?.gross, 37.5, 'bob gross === $37.50');

      assertMoney(await walletBalance(aliceId), 112.5, 'alice balance === $112.50');
      assertMoney(await walletBalance(bobId), 112.5, 'bob balance === $112.50');
      assertMoney(await walletBalance(carolId), 75, 'carol balance unchanged (she lost) === $75');

      for (const uid of [aliceId, bobId]) {
        const release = await sql`SELECT amount FROM transactions WHERE event_id = ${ev1Id} AND user_id = ${uid} AND type = 'escrow_release' ORDER BY created_at DESC LIMIT 1`;
        assert(release.rows.length === 1 && parseFloat(release.rows[0].amount) === 25, `${labels[uid]}: escrow_release of +$25`);
        const payout = await sql`SELECT amount FROM transactions WHERE event_id = ${ev1Id} AND user_id = ${uid} AND type = 'payout' ORDER BY created_at DESC LIMIT 1`;
        assert(payout.rows.length === 1 && parseFloat(payout.rows[0].amount) === 12.5, `${labels[uid]}: payout of +$12.50`);
      }

      for (const uid of [aliceId, bobId, carolId]) await checkInvariant1(uid, labels[uid]);
      await checkInvariant2(ev1Id, 'ev1');
      await checkInvariant3(ev1Id, 'ev1');
      await checkInvariant4(testUserIds, 'after Step 6');
    });

    // -----------------------------------------------------------------
    // Step 7 — unresolve refunds exactly once
    // -----------------------------------------------------------------
    await step('Step 7: unresolve ev1 refunds exactly once', async () => {
      const res = await callRoute(unresolveRoute.POST, '/api/events/unresolve', {
        method: 'POST',
        userId: aliceId,
        body: { event_id: ev1Id },
      });
      assert(res.status === 200, `unresolve ev1: 200 (got ${res.status})`);
      assertMoney(await walletBalance(aliceId), 75, 'alice back to $75');
      assertMoney(await walletBalance(bobId), 75, 'bob back to $75');
      assertMoney(await walletBalance(carolId), 75, 'carol unchanged at $75');
      const holds = await sql`SELECT status FROM escrow_holds WHERE event_id = ${ev1Id}`;
      assert(holds.rows.every((r: any) => r.status === 'held'), "all ev1 holds are back to 'held'");
      for (const uid of [aliceId, bobId, carolId]) await checkInvariant1(uid, labels[uid]);

      // Second unresolve: safe no-op.
      const before = { alice: await walletBalance(aliceId), bob: await walletBalance(bobId), carol: await walletBalance(carolId) };
      const res2 = await callRoute(unresolveRoute.POST, '/api/events/unresolve', {
        method: 'POST',
        userId: aliceId,
        body: { event_id: ev1Id },
      });
      assert(
        res2.status === 400 || (res2.status === 200 && res2.body?.reversal?.already_reversed === true),
        `second unresolve: safe no-op — 400 or 200-with-already_reversed (got ${res2.status}, already_reversed=${res2.body?.reversal?.already_reversed})`
      );
      assertMoney(await walletBalance(aliceId), before.alice, 'second unresolve: alice balance did not move');
      assertMoney(await walletBalance(bobId), before.bob, 'second unresolve: bob balance did not move');
      assertMoney(await walletBalance(carolId), before.carol, 'second unresolve: carol balance did not move');
      await checkInvariant4(testUserIds, 'after Step 7');
    });

    // -----------------------------------------------------------------
    // Step 8 — re-resolve after unresolve (settlement-idempotency-key check)
    // -----------------------------------------------------------------
    await step('Step 8: re-resolve ev1 after unresolve', async () => {
      const preAlice = await walletBalance(aliceId);
      const preBob = await walletBalance(bobId);

      const res = await callRoute(resolveRoute.POST, '/api/events/resolve', {
        method: 'POST',
        userId: aliceId,
        body: { event_id: ev1Id, winning_side: 'side_a' },
      });
      assert(res.status === 200, `re-resolve ev1: 200 (got ${res.status})`);

      const postAlice = await walletBalance(aliceId);
      const postBob = await walletBalance(bobId);

      if (postAlice === preAlice && postBob === preBob) {
        console.log(
          '    ❌ CRITICAL: re-resolve did not move any money at all — this is exactly the ' +
            'settlement-idempotency-key collision bug (a second settlement generation reusing the ' +
            'first generation\'s idempotency keys, hitting ON CONFLICT DO NOTHING, crediting nobody, ' +
            'but still marking holds released). Money is now stranded.'
        );
      }
      assert(postAlice !== preAlice || postBob !== preBob, 'Step 8 settlement actually moved money (not a silent no-op)');

      assertMoney(postAlice, 112.5, 'alice balance === $112.50 again');
      assertMoney(postBob, 112.5, 'bob balance === $112.50 again');
      assertMoney(await walletBalance(carolId), 75, 'carol balance unchanged === $75');

      for (const uid of [aliceId, bobId, carolId]) await checkInvariant1(uid, labels[uid]);
      await checkInvariant2(ev1Id, 'ev1');
      await checkInvariant3(ev1Id, 'ev1');
      await checkInvariant4(testUserIds, 'after Step 8');
    });

    // -----------------------------------------------------------------
    // Step 9 — open stakes, pro-rata split, ev2
    // -----------------------------------------------------------------
    await step('Step 9: open-stakes pro-rata split on ev2', async () => {
      const placeBet = (userId: string, side: string, amount: number) =>
        callRoute(betsRoute.POST, '/api/bets', {
          method: 'POST',
          userId,
          body: { event_id: ev2Id, user_id: userId, username: usernames[userId], side, amount },
        });

      const preAlice = await walletBalance(aliceId);
      const preBob = await walletBalance(bobId);
      const preCarol = await walletBalance(carolId);

      const rA = await placeBet(aliceId, 'side_a', 30);
      assert(rA.status === 200, `alice stakes $30 on side_a: 200 (got ${rA.status})`);
      const rB = await placeBet(bobId, 'side_a', 10);
      assert(rB.status === 200, `bob stakes $10 on side_a: 200 (got ${rB.status})`);
      const rC = await placeBet(carolId, 'side_b', 20);
      assert(rC.status === 200, `carol stakes $20 on side_b: 200 (got ${rC.status})`);

      assertMoney(await walletBalance(aliceId), preAlice - 30, 'alice debited $30');
      assertMoney(await walletBalance(bobId), preBob - 10, 'bob debited $10');
      assertMoney(await walletBalance(carolId), preCarol - 20, 'carol debited $20');

      const pot = await eventHeldTotal(ev2Id);
      assertMoney(pot, 60, 'ev2 pot === $60');

      const res = await callRoute(resolveRoute.POST, '/api/events/resolve', {
        method: 'POST',
        userId: aliceId,
        body: { event_id: ev2Id, winning_side: 'side_a' },
      });
      assert(res.status === 200, `resolve ev2: 200 (got ${res.status})`);
      const settlement = res.body?.settlement;
      potByEvent[ev2Id] = settlement?.pot;
      const aliceP = settlement?.payouts?.find((p: any) => p.user_id === aliceId);
      const bobP = settlement?.payouts?.find((p: any) => p.user_id === bobId);
      assertMoney(aliceP?.gross, 45, 'alice gross === $45.00 (60 * 30/40)');
      assertMoney(bobP?.gross, 15, 'bob gross === $15.00 (60 * 10/40)');
      const grossSum = (settlement?.payouts || []).reduce((s: number, p: any) => s + p.gross, 0);
      assertMoney(grossSum, 60, 'payouts (gross) sum to exactly the pot');

      assertMoney(await walletBalance(aliceId), preAlice - 30 + 45, 'alice final balance correct');
      assertMoney(await walletBalance(bobId), preBob - 10 + 15, 'bob final balance correct');
      assertMoney(await walletBalance(carolId), preCarol - 20, 'carol final balance unchanged (she lost)');

      for (const uid of [aliceId, bobId, carolId]) await checkInvariant1(uid, labels[uid]);
      await checkInvariant2(ev2Id, 'ev2');
      await checkInvariant3(ev2Id, 'ev2');
      await checkInvariant4(testUserIds, 'after Step 9');
    });

    // -----------------------------------------------------------------
    // Step 10 — nobody on the winning side (degenerate refund), ev3
    // -----------------------------------------------------------------
    await step('Step 10: nobody on the winning side — degenerate refund on ev3', async () => {
      const placeBet = (userId: string, side: string, amount: number) =>
        callRoute(betsRoute.POST, '/api/bets', {
          method: 'POST',
          userId,
          body: { event_id: ev3Id, user_id: userId, username: usernames[userId], side, amount },
        });

      const preCarol = await walletBalance(carolId);
      const preDave = await walletBalance(daveId);

      const rC = await placeBet(carolId, 'side_a', 10);
      assert(rC.status === 200, `carol bets $10 on side_a: 200 (got ${rC.status})`);
      const rD = await placeBet(daveId, 'side_a', 10);
      assert(rD.status === 200, `dave bets $10 on side_a: 200 (got ${rD.status})`);

      const res = await callRoute(resolveRoute.POST, '/api/events/resolve', {
        method: 'POST',
        userId: aliceId,
        body: { event_id: ev3Id, winning_side: 'side_b' },
      });
      assert(res.status === 200, `resolve ev3 (side_b, no bets there): 200 (got ${res.status})`);
      potByEvent[ev3Id] = res.body?.settlement?.pot;
      assert(res.body?.settlement?.mode === 'refund', `ev3 settlement mode === 'refund' (got ${res.body?.settlement?.mode})`);

      assertMoney(await walletBalance(carolId), preCarol, 'carol refunded $10 back to original balance');
      assertMoney(await walletBalance(daveId), preDave, 'dave refunded $10 back to original balance');

      const carolRefund = await sql`SELECT amount FROM transactions WHERE event_id = ${ev3Id} AND user_id = ${carolId} AND type = 'refund'`;
      assert(carolRefund.rows.length === 1 && parseFloat(carolRefund.rows[0].amount) === 10, 'carol has a refund transaction of +$10');
      const daveRefund = await sql`SELECT amount FROM transactions WHERE event_id = ${ev3Id} AND user_id = ${daveId} AND type = 'refund'`;
      assert(daveRefund.rows.length === 1 && parseFloat(daveRefund.rows[0].amount) === 10, 'dave has a refund transaction of +$10');

      const holds = await sql`SELECT status FROM escrow_holds WHERE event_id = ${ev3Id}`;
      assert(holds.rows.every((r: any) => r.status === 'refunded'), "ev3 holds are all 'refunded'");

      await checkInvariant2(ev3Id, 'ev3');
      await checkInvariant3(ev3Id, 'ev3');
      for (const uid of [carolId, daveId]) await checkInvariant1(uid, labels[uid]);
      await checkInvariant4(testUserIds, 'after Step 10');
    });

    // -----------------------------------------------------------------
    // Step 11 — resolver cancels (degenerate refund), ev5
    // -----------------------------------------------------------------
    await step('Step 11: resolver cancels ev5 — degenerate refund', async () => {
      const r5 = await callRoute(eventsRoute.POST, '/api/events', {
        method: 'POST',
        userId: aliceId,
        body: {
          title: `${RUN} ev5-cancel`,
          side_a: 'side_a',
          side_b: 'side_b',
          end_time: oneHourOut,
          group_id: groupId,
          creator_user_id: aliceId,
          creator_username: usernames[aliceId],
          payment_type: 'cash',
          stake_amount: 10,
        },
      });
      assert(r5.status === 200, `ev5 create: 200 (got ${r5.status})`);
      ev5Id = r5.body?.id;
      if (ev5Id) {
        createdEventIds.push(ev5Id);
        eventLabel[ev5Id] = 'ev5 (cancelled)';
      }

      const placeBet = (userId: string, side: string, amount: number) =>
        callRoute(betsRoute.POST, '/api/bets', {
          method: 'POST',
          userId,
          body: { event_id: ev5Id, user_id: userId, username: usernames[userId], side, amount },
        });

      const preBob = await walletBalance(bobId);
      const preCarol = await walletBalance(carolId);
      const preBobNet = (await sql`SELECT net_total FROM users WHERE id = ${bobId}`).rows[0].net_total;
      const preCarolNet = (await sql`SELECT net_total FROM users WHERE id = ${carolId}`).rows[0].net_total;

      const rB = await placeBet(bobId, 'side_a', 10);
      assert(rB.status === 200, `bob bets $10 on ev5: 200 (got ${rB.status})`);
      const rC = await placeBet(carolId, 'side_b', 10);
      assert(rC.status === 200, `carol bets $10 on ev5: 200 (got ${rC.status})`);

      const res = await callRoute(resolveRoute.POST, '/api/events/resolve', {
        method: 'POST',
        userId: aliceId,
        body: { event_id: ev5Id, action: 'cancel' },
      });
      assert(res.status === 200, `cancel ev5: 200 (got ${res.status})`);
      potByEvent[ev5Id] = res.body?.settlement?.pot;
      assert(res.body?.status === 'resolved', "ev5 status === 'resolved'");
      assert(res.body?.winning_side === null || res.body?.winning_side === undefined, 'ev5 winning_side IS NULL');

      assertMoney(await walletBalance(bobId), preBob, 'bob refunded back to pre-bet balance');
      assertMoney(await walletBalance(carolId), preCarol, 'carol refunded back to pre-bet balance');

      const postBobNet = (await sql`SELECT net_total FROM users WHERE id = ${bobId}`).rows[0].net_total;
      const postCarolNet = (await sql`SELECT net_total FROM users WHERE id = ${carolId}`).rows[0].net_total;
      assertMoney(parseFloat(postBobNet), parseFloat(preBobNet), "bob's net_total unchanged by the cancel");
      assertMoney(parseFloat(postCarolNet), parseFloat(preCarolNet), "carol's net_total unchanged by the cancel");

      await checkInvariant2(ev5Id, 'ev5');
      await checkInvariant3(ev5Id, 'ev5');
      await checkInvariant4(testUserIds, 'after Step 11');
    });

    // -----------------------------------------------------------------
    // Step 12 — free events never touch a wallet, ev4
    // -----------------------------------------------------------------
    await step('Step 12: free events (ev4) never touch a wallet', async () => {
      const before: Record<string, number> = {};
      for (const uid of testUserIds) before[uid] = await walletBalance(uid);

      const rA = await callRoute(betsRoute.POST, '/api/bets', {
        method: 'POST',
        userId: aliceId,
        body: { event_id: ev4Id, user_id: aliceId, username: usernames[aliceId], side: 'side_a', amount: 5 },
      });
      assert(rA.status === 200, `alice free bet on ev4: 200 (got ${rA.status})`);
      const rB = await callRoute(betsRoute.POST, '/api/bets', {
        method: 'POST',
        userId: bobId,
        body: { event_id: ev4Id, user_id: bobId, username: usernames[bobId], side: 'side_b', amount: 5 },
      });
      assert(rB.status === 200, `bob free bet on ev4: 200 (got ${rB.status})`);

      for (const uid of testUserIds) {
        assertMoney(await walletBalance(uid), before[uid], `${labels[uid]}: balance untouched by free bets`);
      }
      const holdsAfterBets = await sql`SELECT COUNT(*)::int AS n FROM escrow_holds WHERE event_id = ${ev4Id}`;
      assert(holdsAfterBets.rows[0].n === 0, 'no escrow_holds row created for the free event');

      const res = await callRoute(resolveRoute.POST, '/api/events/resolve', {
        method: 'POST',
        userId: aliceId,
        body: { event_id: ev4Id, winning_side: 'side_a' },
      });
      assert(res.status === 200, `resolve ev4: 200 (got ${res.status})`);
      for (const uid of testUserIds) {
        assertMoney(await walletBalance(uid), before[uid], `${labels[uid]}: balance untouched by resolving the free event`);
      }
      const holdsAfterResolve = await sql`SELECT COUNT(*)::int AS n FROM escrow_holds WHERE event_id = ${ev4Id}`;
      assert(holdsAfterResolve.rows[0].n === 0, 'still no escrow_holds row for the free event after resolve');

      potByEvent[ev4Id] = 0;
      await checkInvariant4(testUserIds, 'after Step 12');
    });

    // -----------------------------------------------------------------
    // Step 13 — withdrawal path
    // -----------------------------------------------------------------
    await step('Step 13: withdrawal path', async () => {
      const preBob = await walletBalance(bobId);

      const res = await callRoute(walletRoute.POST, '/api/wallet', {
        method: 'POST',
        userId: bobId,
        body: { user_id: bobId, action: 'withdraw', amount: 20, idempotency_key: 'wd1' },
      });
      assert(res.status === 200, `bob withdraws $20: 200 (got ${res.status})`);
      assertMoney(await walletBalance(bobId), preBob - 20, 'bob balance drops by exactly $20');
      const w1 = await sql`SELECT amount FROM transactions WHERE user_id = ${bobId} AND type = 'withdrawal' AND idempotency_key = ${`withdraw:${bobId}:wd1`}`;
      assert(w1.rows.length === 1 && parseFloat(w1.rows[0].amount) === -20, 'a withdrawal transaction of -$20 exists');

      const replay = await callRoute(walletRoute.POST, '/api/wallet', {
        method: 'POST',
        userId: bobId,
        body: { user_id: bobId, action: 'withdraw', amount: 20, idempotency_key: 'wd1' },
      });
      assert(replay.status === 200, `replay withdraw: 200 (got ${replay.status})`);
      assert(replay.body?.duplicate === true, 'replay withdraw: duplicate === true');
      assertMoney(await walletBalance(bobId), preBob - 20, 'replay withdraw: balance unchanged');
      const w2 = await sql`SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = ${bobId} AND type = 'withdrawal' AND idempotency_key = ${`withdraw:${bobId}:wd1`}`;
      assert(w2.rows[0].n === 1, 'replay withdraw: still exactly one withdrawal transaction with that key');

      const balAfterFirst = await walletBalance(bobId);
      const before1 = await snapshotUser(bobId);
      const tooLarge = await callRoute(walletRoute.POST, '/api/wallet', {
        method: 'POST',
        userId: bobId,
        body: { user_id: bobId, action: 'withdraw', amount: 600, idempotency_key: 'wd_toolarge' },
      });
      assert(tooLarge.status === 400, `withdraw $600: rejected 400 (got ${tooLarge.status})`);
      assert(tooLarge.body?.code === 'AMOUNT_TOO_LARGE', `withdraw $600: code AMOUNT_TOO_LARGE (got ${tooLarge.body?.code})`);
      const after1 = await snapshotUser(bobId);
      assertSnapshotUnchanged(before1, after1, 'bob ($600 withdrawal attempt)');

      const before2 = await snapshotUser(bobId);
      const excessive = await callRoute(walletRoute.POST, '/api/wallet', {
        method: 'POST',
        userId: bobId,
        body: { user_id: bobId, action: 'withdraw', amount: balAfterFirst + 50, idempotency_key: 'wd_insufficient' },
      });
      assert(excessive.status === 400, `withdraw exceeding balance: rejected 400 (got ${excessive.status})`);
      assert(
        excessive.body?.code === 'INSUFFICIENT_FUNDS',
        `withdraw exceeding balance: code INSUFFICIENT_FUNDS (got ${excessive.body?.code})`
      );
      const after2 = await snapshotUser(bobId);
      assertSnapshotUnchanged(before2, after2, 'bob (excessive withdrawal attempt)');

      await checkInvariant1(bobId, 'bob after Step 13');
      await checkInvariant4(testUserIds, 'after Step 13');
    });

    // -----------------------------------------------------------------
    // Step 14 — global invariant sweep
    // -----------------------------------------------------------------
    await step('Step 14: global invariant sweep', async () => {
      for (const uid of testUserIds) await checkInvariant1(uid, labels[uid]);
      for (const evId of createdEventIds) {
        await checkInvariant2(evId, eventLabel[evId] || evId);
        await checkInvariant3(evId, eventLabel[evId] || evId);
      }
      await checkInvariant4(testUserIds, 'final sweep');

      console.log('\n  --- per-user ledger ---');
      const userRows: string[][] = [];
      for (const uid of testUserIds) {
        const bal = await walletBalance(uid);
        const sum = await ledgerSum(uid);
        const held = (await sql`SELECT COALESCE(SUM(amount),0)::numeric AS t FROM escrow_holds WHERE user_id = ${uid} AND status = 'held'`).rows[0].t;
        userRows.push([labels[uid], money(bal), money(sum), money(parseFloat(held))]);
      }
      printTable(['user', 'balance', 'Σtransactions', 'escrow held'], userRows);

      console.log('\n  --- per-event ledger ---');
      const eventRows: string[][] = [];
      for (const evId of createdEventIds) {
        const sum = await eventLedgerSum(evId);
        eventRows.push([eventLabel[evId] || evId, money(potByEvent[evId] ?? 0), money(sum)]);
      }
      printTable(['event', 'pot', 'Σledger'], eventRows);
    });
  } finally {
    // -----------------------------------------------------------------
    // Cleanup — strictly scoped to rows this run created.
    //
    // users/groups/group_members/wallets/notification_preferences/
    // push_subscriptions/transactions/escrow_holds/bets are all scoped by
    // OUR RUN-prefixed user/group ids (every row we create in these tables
    // carries a user_id or group_id that starts with RUN).
    //
    // events/activities/comments/event_notification_mutes are keyed off
    // event ids — but the real POST /api/events route generates its own
    // (non-prefixed) event id server-side, so a LIKE-prefix filter cannot
    // reach them. Instead we delete by the EXACT event ids this script
    // itself captured from the create responses (createdEventIds), which is
    // at least as safe as a prefix match: every id in that list is one this
    // script created and observed directly.
    // -----------------------------------------------------------------
    console.log('\n' + '='.repeat(78));
    if (KEEP) {
      console.log(
        `  --keep passed: skipping cleanup.\n` +
          `  All rows from this run use prefix '${RUN}' on user_id/group_id/event_id fields,\n` +
          `  and event ids are exactly: ${createdEventIds.join(', ') || '(none created)'}\n` +
          `  Clean up manually when done debugging.`
      );
    } else {
      console.log('  Cleanup (run prefix: ' + RUN + ')');
      const pattern = `${RUN}%`;
      const evIds = createdEventIds.length > 0 ? createdEventIds : ['__none__'];

      const deletions: Array<{ label: string; fn: () => Promise<any> }> = [
        { label: 'transactions', fn: () => sql`DELETE FROM transactions WHERE user_id LIKE ${pattern} OR event_id = ANY(${evIds as any}::text[])` },
        { label: 'escrow_holds', fn: () => sql`DELETE FROM escrow_holds WHERE user_id LIKE ${pattern} OR event_id = ANY(${evIds as any}::text[])` },
        { label: 'bets', fn: () => sql`DELETE FROM bets WHERE user_id LIKE ${pattern} OR event_id = ANY(${evIds as any}::text[])` },
        { label: 'activities', fn: () => sql`DELETE FROM activities WHERE event_id = ANY(${evIds as any}::text[])` },
        { label: 'comments', fn: () => sql`DELETE FROM comments WHERE event_id = ANY(${evIds as any}::text[])` },
        { label: 'event_notification_mutes', fn: () => sql`DELETE FROM event_notification_mutes WHERE event_id = ANY(${evIds as any}::text[])` },
        { label: 'events', fn: () => sql`DELETE FROM events WHERE id = ANY(${evIds as any}::text[])` },
        { label: 'group_members', fn: () => sql`DELETE FROM group_members WHERE group_id LIKE ${pattern} OR user_id LIKE ${pattern}` },
        { label: 'groups', fn: () => sql`DELETE FROM groups WHERE id LIKE ${pattern}` },
        { label: 'notification_preferences', fn: () => sql`DELETE FROM notification_preferences WHERE user_id LIKE ${pattern}` },
        { label: 'wallets', fn: () => sql`DELETE FROM wallets WHERE user_id LIKE ${pattern}` },
        { label: 'push_subscriptions', fn: () => sql`DELETE FROM push_subscriptions WHERE user_id LIKE ${pattern}` },
        { label: 'users', fn: () => sql`DELETE FROM users WHERE id LIKE ${pattern}` },
      ];

      for (const d of deletions) {
        try {
          const res: any = await d.fn();
          const n = typeof res?.rowCount === 'number' ? res.rowCount : res?.rows?.length ?? 0;
          console.log(`    🧹 ${d.label}: deleted ${n}`);
        } catch (err: any) {
          if (/relation .* does not exist/i.test(err?.message || '')) {
            console.log(`    ⏭  ${d.label}: table does not exist, skipped`);
          } else {
            console.log(`    ⚠️  ${d.label}: cleanup error — ${err?.message || err}`);
          }
        }
      }
    }
  }

  console.log('\n' + '='.repeat(78));
  if (failedChecks === 0) {
    console.log(`  PASSED ${totalChecks}/${totalChecks} checks`);
  } else {
    console.log(`  FAILED: ${failedChecks} check(s) out of ${totalChecks}`);
    console.log('\n  Failures:');
    for (const m of failureMessages) console.log(`    - ${m}`);
  }
  console.log('='.repeat(78));

  process.exit(failedChecks === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
