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
// Withdrawals are disabled by default in production (see
// app/api/wallet/route.ts and .env.local.example) because no real payout
// mechanism exists yet. Force-enable here so Step 13 can still exercise the
// withdrawal path end-to-end; a later step flips this off and back on to
// prove the gate itself works.
process.env.WALLET_WITHDRAWALS_ENABLED = 'true';

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
import { resolve as resolvePath } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import * as nodeModule from 'module';

import { stackUser, signInWeb, signOutWeb, resetSessions } from './testing/stack-auth-stub';

// ---------------------------------------------------------------------------
// Stack Auth stub injection
// ---------------------------------------------------------------------------
// lib/auth.ts resolves the signed-in human by lazily `await import('@/lib/stack')`
// and calling stackServerApp.getUser(...). A previous node (n2, identity
// consolidation) deliberately made the `x-stack-user-id` request header
// inert — trusting a client-supplied header as identity was a
// forged-identity vulnerability (see scripts/check-identity.ts Asserts
// 4-6) — so this harness can no longer fake auth by setting that header.
//
// Instead, exactly like scripts/test-auth-consolidation.ts, redirect the
// '@/lib/stack' module specifier at scripts/testing/stack-auth-stub.ts via
// module.registerHooks, and drive real Stack Auth sessions through it
// (signInWeb/stackUser below). Only the third-party identity provider is
// faked; everything else — the route handlers, lib/auth's session
// resolution, lib/payments, and Postgres — is the real thing.
//
// This hook MUST be registered before any route module that (transitively)
// hits '@/lib/stack' is imported, so the route imports are dynamic
// `await import(...)` calls performed inside main(), after this runs.
// ---------------------------------------------------------------------------
const STUB_PATH = resolvePath(process.cwd(), 'scripts/testing/stack-auth-stub.ts');
if (!existsSync(STUB_PATH)) {
  console.error(`❌ Cannot find ${STUB_PATH}. Run this script from the repository root.`);
  process.exit(1);
}
const STUB_URL = pathToFileURL(STUB_PATH).href;

// module.registerHooks landed in Node 22.15 / 23.5; @types/node@20 predates it.
const registerHooks = (nodeModule as any).registerHooks as
  | ((hooks: { resolve?: (...args: any[]) => any }) => void)
  | undefined;
if (typeof registerHooks !== 'function') {
  console.error(`❌ Node ${process.versions.node} has no module.registerHooks — this script needs Node 22.15+.`);
  process.exit(1);
}

registerHooks({
  resolve(specifier: string, context: unknown, nextResolve: any) {
    if (specifier === '@/lib/stack') {
      // `format` is set explicitly so Node does not have to sniff the module
      // type of a .ts file it is about to hand to tsx.
      return { url: STUB_URL, format: 'module', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

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

// `init.userId` means "sign this human in for this call" — a real Stack Auth
// session via the stub, not a forged header. lib/auth.ts no longer reads
// x-stack-user-id at all (that header is dead: see scripts/check-identity.ts
// Asserts 4-6), so the request carries no auth header at all here; the
// session travels through the stub's same-origin "cookie" path instead,
// exactly like a real browser fetch. The signed-in id must match the id the
// setup step used when inserting the row directly into `users`.
function signInAs(userId: string): void {
  signInWeb(
    stackUser({
      id: userId,
      primaryEmail: `${userId}@verify-payments.test`,
      primaryEmailVerified: true,
      displayName: userId,
      hasPassword: true,
    })
  );
}

async function callRoute(
  handler: (req: NextRequest) => Promise<Response>,
  url: string,
  init?: { method?: string; body?: any; userId?: string; headers?: Record<string, string> }
): Promise<{ status: number; body: any }> {
  if (init?.userId) {
    signInAs(init.userId);
  } else {
    signOutWeb();
  }
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init?.headers || {}) };
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

async function callWebhook(
  handler: (req: NextRequest) => Promise<Response>,
  payload: string,
  signature: string
): Promise<{ status: number; body: any }> {
  const req = new NextRequest('http://localhost:3000/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
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

// ---------------------------------------------------------------------------
// DB read helpers used for assertions (never write-modify anything not ours)
// ---------------------------------------------------------------------------

async function walletBalance(userId: string): Promise<number> {
  const r = await sql`SELECT balance FROM wallets WHERE user_id = ${userId}`;
  return r.rows.length ? parseFloat(r.rows[0].balance) : 0;
}

// Scoped to usd — the only ledger any code path writes to anymore.
// Historical 'wp' rows exist from before the single-currency consolidation
// (see lib/payments.ts's header comment) but this suite never writes any
// new ones, so there is nothing left to scope a currency argument against.
async function ledgerSum(userId: string): Promise<number> {
  const currency = 'usd';
  // Every transaction type except 'deposit' and 'withdrawal' moves the
  // wallet balance synchronously and is inserted as 'completed' — so
  // summing 'completed' rows alone matches the balance for those. Deposits
  // are the mirror image: 'pending' deposits haven't credited the balance
  // yet (the Stripe webhook does that on completion), so excluding
  // 'pending' deposits from the sum is correct. Withdrawals (B2 fix) are
  // the one type that debits the balance immediately but is intentionally
  // inserted as 'pending' — no payout mechanism exists to ever flip it to
  // 'completed' — so pending withdrawals must be counted here too, or this
  // invariant would flag every real (gate-enabled) withdrawal as a $-amount
  // leak instead of recognizing it moved the money out.
  const r = await sql`
    SELECT COALESCE(SUM(amount), 0)::numeric AS total
    FROM transactions
    WHERE user_id = ${userId}
      AND currency = ${currency}
      AND (status = 'completed' OR (type = 'withdrawal' AND status = 'pending'))
  `;
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

  // Route modules are imported dynamically, now that the '@/lib/stack'
  // module-resolution hook above is registered — every authenticated call
  // below goes through a real Stack Auth session (via the stub) instead of
  // a forged header.
  const betsRoute = await import('../app/api/bets/route');
  const eventsRoute = await import('../app/api/events/route');
  const resolveRoute = await import('../app/api/events/resolve/route');
  const unresolveRoute = await import('../app/api/events/unresolve/route');
  const walletRoute = await import('../app/api/wallet/route');
  const webhookRoute = await import('../app/api/webhooks/stripe/route');
  resetSessions();

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
      // cash_enabled: false is deliberate — the gate that used to reject
      // payment_type: 'cash' event creation for a non-cash-enabled group is
      // gone (see app/api/events/route.ts). Step 3 below creates a 'cash'
      // event in THIS group and asserts it succeeds, proving the column no
      // longer enforces anything.
      await sql`
        INSERT INTO groups (id, name, created_by, resolver_user_id, is_public, cash_enabled)
        VALUES (${groupId}, ${`Verify Payments ${RUN}`}, ${aliceId}, ${aliceId}, false, false)
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

    // Pre-seed the $10 signup credit for all 4 users BEFORE Step 1's
    // deposits. Every wallet touch (GET/POST /api/wallet, or a bet
    // placement) lazily grants this seed exactly once
    // (lib/payments.ts's applyUsdSeedIfNeeded). If the FIRST touch for
    // these users happened inside Step 4's bet placement instead, each
    // user's balance there would include a surprise +$10 on top of
    // whatever Step 1 deposited, throwing off every hardcoded balance
    // figure Steps 4-11 assert. Seeding here — deliberately BEFORE Step 1
    // deposits $10 less than its headline total for each user — makes
    // seed + deposit land on the same even totals ($100/$100/$100/$20)
    // the rest of this script's arithmetic was written against.
    await step('Setup: pre-seed the $10 signup credit for all 4 users', async () => {
      for (const uid of testUserIds) {
        const res = await callRoute(walletRoute.GET, `/api/wallet?userId=${uid}`, { method: 'GET', userId: uid });
        assert(res.status === 200, `${labels[uid]}: pre-seed wallet read: 200 (got ${res.status})`);
        assertMoney(await walletBalance(uid), 10, `${labels[uid]}: seeded to $10 before any deposit`);
      }
      await checkInvariant4(testUserIds, 'after pre-seed');
    });

    console.log(
      '\n  NOTE: carol is funded to a $100 total (not the $50 mentioned in the task\'s Step 1 prose) so\n' +
        "  that the balance arithmetic explicitly spelled out in Steps 6/8 (\"carol 100 - 25 = 75\") is\n" +
        '  internally consistent with Step 10, where carol must still be able to place a $10 bet on ev3\n' +
        '  after losing stakes on ev1 and ev2. Funding carol to only $50 as literally written would leave\n' +
        '  her with just $5 by Step 10 (below the $10 stake), which contradicts the Step 6/8 numbers and\n' +
        '  would make the scenario internally inconsistent — see the final report for details.'
    );

    // -----------------------------------------------------------------
    // Step 1 — deposit through the real Stripe webhook. Each user deposits
    // $10 LESS than the headline total below — they were already seeded
    // $10 by the pre-seed step above, so seed + deposit sums to the
    // headline figure exactly.
    // -----------------------------------------------------------------
    let aliceDeposit!: DepositRecord;
    await step('Step 1: deposit through the real Stripe webhook (alice $100, bob $100, carol $100, dave $20 — including the $10 pre-seed)', async () => {
      const fundPlan: Array<[string, string, number]> = [
        [aliceId, 'alice', 90],
        [bobId, 'bob', 90],
        [carolId, 'carol', 90],
        [daveId, 'dave', 10],
      ];
      for (const [uid, label, amount] of fundPlan) {
        const dep = await performDeposit(uid, label, amount);
        if (uid === aliceId) aliceDeposit = dep;
        const { status, body } = await callWebhook(webhookRoute.POST, dep.payload, dep.signature);
        assert(status === 200, `${label}: webhook returns 200 (got ${status})`);
        assert(body?.credited === true && body?.duplicate === false, `${label}: webhook reports credited=true, duplicate=false`);
        const bal = await walletBalance(uid);
        // $10 already seeded above, so the post-deposit total is amount + 10.
        assertMoney(bal, amount + 10, `${label}: wallet balance equals deposited amount plus the $10 pre-seed`);
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
      const replay1 = await callWebhook(webhookRoute.POST, aliceDeposit.payload, aliceDeposit.signature);
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
      const replay2 = await callWebhook(webhookRoute.POST, payload2, sig2);
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
      const badSigRes = await callWebhook(webhookRoute.POST, payload3, corrupted);
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
      assert(
        r1.status === 200,
        `ev1 (payment_type: 'cash') create in a cash_enabled: false group: 200, not 403 — the gate is dead (got ${r1.status})`
      );
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
    // Step 12 — a payment_type: 'none' event (ev4) ALSO escrows real usd.
    // This is the core proof of the single-currency consolidation:
    // payment_type used to select a ledger (currencyForEvent: 'cash' -> usd,
    // 'none' -> the W's own wp_balance, fully isolated from usd). That
    // function is gone. Every event now stakes real usd through the exact
    // same escrow engine regardless of payment_type — so a 'none' event's
    // bets must debit `wallets.balance` (not some separate ledger), carry
    // escrow_holds.currency = 'usd', and settle with settlement.currency
    // === 'usd', exactly like a 'cash' event.
    // -----------------------------------------------------------------
    await step("Step 12: payment_type: 'none' events ALSO escrow real usd (payment_type no longer selects a ledger)", async () => {
      const preAlice = await walletBalance(aliceId);
      const preBob = await walletBalance(bobId);

      const rA = await callRoute(betsRoute.POST, '/api/bets', {
        method: 'POST',
        userId: aliceId,
        body: { event_id: ev4Id, user_id: aliceId, username: usernames[aliceId], side: 'side_a', amount: 5 },
      });
      assert(rA.status === 200, `alice bets $5 on ev4 (payment_type 'none'): 200 (got ${rA.status})`);
      assertMoney(await walletBalance(aliceId), preAlice - 5, 'alice: usd balance debited by exactly $5 on a payment_type=none event');
      const rB = await callRoute(betsRoute.POST, '/api/bets', {
        method: 'POST',
        userId: bobId,
        body: { event_id: ev4Id, user_id: bobId, username: usernames[bobId], side: 'side_b', amount: 5 },
      });
      assert(rB.status === 200, `bob bets $5 on ev4: 200 (got ${rB.status})`);
      assertMoney(await walletBalance(bobId), preBob - 5, 'bob: usd balance debited by exactly $5 on a payment_type=none event');

      const holdsAfterBets = await sql`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE currency = 'usd' AND status = 'held') AS usd_held FROM escrow_holds WHERE event_id = ${ev4Id}`;
      assert(holdsAfterBets.rows[0].n === 2, `ev4: 2 escrow_holds rows created (got ${holdsAfterBets.rows[0].n})`);
      assert(Number(holdsAfterBets.rows[0].usd_held) === 2, "ev4: both holds are currency='usd' and 'held' (not 'wp')");

      const res = await callRoute(resolveRoute.POST, '/api/events/resolve', {
        method: 'POST',
        userId: aliceId,
        body: { event_id: ev4Id, winning_side: 'side_a' },
      });
      assert(res.status === 200, `resolve ev4: 200 (got ${res.status})`);
      assert(res.body?.settlement?.currency === 'usd', `ev4 settlement.currency === 'usd' (got ${res.body?.settlement?.currency})`);
      assertMoney(res.body?.settlement?.pot, 10, 'ev4 settlement.pot === $10');

      assertMoney(await walletBalance(aliceId), preAlice + 5, 'alice (winner): -$5 stake + $10 (stake back + winnings) = net +$5');
      assertMoney(await walletBalance(bobId), preBob - 5, 'bob (loser): net -$5, unchanged since the bet');

      const holdsAfterResolve = await sql`SELECT COUNT(*)::int AS n FROM escrow_holds WHERE event_id = ${ev4Id} AND status = 'held'`;
      assert(holdsAfterResolve.rows[0].n === 0, 'ev4: no stranded held holds after resolve');

      await checkInvariant1(aliceId, 'alice');
      await checkInvariant1(bobId, 'bob');
      await checkInvariant2(ev4Id, 'ev4');
      await checkInvariant3(ev4Id, 'ev4');

      potByEvent[ev4Id] = 10;
      eventLabel[ev4Id] = "ev4 (payment_type: 'none', real usd)";
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
      const w1 = await sql`SELECT amount, status FROM transactions WHERE user_id = ${bobId} AND type = 'withdrawal' AND idempotency_key = ${`withdraw:${bobId}:wd1`}`;
      assert(w1.rows.length === 1 && parseFloat(w1.rows[0].amount) === -20, 'a withdrawal transaction of -$20 exists');
      // B2 fix: the row must be honest about the fact that no payout has
      // actually happened — there is no Stripe Connect transfer (or any
      // external call) anywhere in this codebase, so 'completed' would be a
      // lie. Money already left the wallet (asserted above); the ledger
      // status must reflect that it hasn't reached the user yet.
      assert(
        w1.rows.length === 1 && w1.rows[0].status === 'pending',
        `withdrawal transaction status is 'pending', not falsely 'completed' (got ${w1.rows[0]?.status})`
      );

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
    // Step 13b — withdrawals are disabled by default (B2 gate)
    // -----------------------------------------------------------------
    // withdrawFromWallet has no real payout mechanism behind it (no Stripe
    // Connect transfer, no external call of any kind), so the API must
    // refuse the withdraw action unless WALLET_WITHDRAWALS_ENABLED is the
    // exact string 'true'. Steps 1-13 ran with the flag force-enabled (see
    // the env preamble at the top of this file) so the withdrawal path
    // itself could be exercised; this step flips the flag off to prove the
    // gate fails closed, then restores it so nothing after this step is
    // affected.
    await step('Step 13b: withdrawals disabled by default (PAYOUTS_UNAVAILABLE gate)', async () => {
      const originalFlag = process.env.WALLET_WITHDRAWALS_ENABLED;
      try {
        for (const flagValue of [undefined, '', 'false', 'TRUE', '1']) {
          if (flagValue === undefined) {
            delete process.env.WALLET_WITHDRAWALS_ENABLED;
          } else {
            process.env.WALLET_WITHDRAWALS_ENABLED = flagValue;
          }

          const before = await snapshotUser(bobId);
          const gated = await callRoute(walletRoute.POST, '/api/wallet', {
            method: 'POST',
            userId: bobId,
            body: { user_id: bobId, action: 'withdraw', amount: 5, idempotency_key: `wd_gated_${flagValue ?? 'unset'}` },
          });
          const shown = flagValue === undefined ? 'unset' : JSON.stringify(flagValue);
          assert(gated.status === 503, `withdraw with flag ${shown}: 503 (got ${gated.status})`);
          assert(
            gated.body?.code === 'PAYOUTS_UNAVAILABLE',
            `withdraw with flag ${shown}: code PAYOUTS_UNAVAILABLE (got ${gated.body?.code})`
          );
          assert(
            typeof gated.body?.error === 'string' && gated.body.error.length > 0,
            `withdraw with flag ${shown}: response carries a human-readable error message`
          );
          const after = await snapshotUser(bobId);
          assertSnapshotUnchanged(before, after, `bob (withdraw attempt with flag ${shown})`);

          const gatedRow = await sql`
            SELECT COUNT(*)::int AS n FROM transactions
            WHERE user_id = ${bobId} AND type = 'withdrawal' AND idempotency_key = ${`withdraw:${bobId}:wd_gated_${flagValue ?? 'unset'}`}
          `;
          assert(gatedRow.rows[0].n === 0, `withdraw with flag ${shown}: no withdrawal transaction row was created`);
        }
      } finally {
        // Restore exactly what it was (the env preamble's 'true') so Step 14
        // and any future steps that might touch withdrawals aren't affected.
        if (originalFlag === undefined) {
          delete process.env.WALLET_WITHDRAWALS_ENABLED;
        } else {
          process.env.WALLET_WITHDRAWALS_ENABLED = originalFlag;
        }
      }
      assert(
        process.env.WALLET_WITHDRAWALS_ENABLED === 'true',
        'WALLET_WITHDRAWALS_ENABLED restored to true after the gate check'
      );
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

    // ===================================================================
    // The signup seed & no-faucet coverage. Same harness style (RUN prefix,
    // real routes, cleanup) as Steps 1-14, entirely separate test users so
    // the cash-flow invariants above are provably untouched by any of this.
    //
    // Rewritten from the old "the W" play-currency suite: WagerPals is
    // single-currency now (see lib/payments.ts) — there is no second ledger
    // left to cover. What replaced it is the $10 signup seed (lazy,
    // idempotent, granted exactly once per user) and the explicit absence
    // of the old daily faucet.
    // ===================================================================
    const erinId = `${RUN}_erin`;
    const frankId = `${RUN}_frank`;
    const graceId = `${RUN}_grace`;
    const ivyId = `${RUN}_ivy`;
    const jacksonId = `${RUN}_jackson`;
    const kellyId = `${RUN}_kelly`;
    const liamId = `${RUN}_liam`;
    const seedUserIds = [erinId, frankId, graceId, ivyId, jacksonId, kellyId, liamId];
    const seedLabels: Record<string, string> = {
      [erinId]: 'erin', [frankId]: 'frank', [graceId]: 'grace',
      [ivyId]: 'ivy', [jacksonId]: 'jackson', [kellyId]: 'kelly', [liamId]: 'liam',
    };
    const seedUsernames: Record<string, string> = Object.fromEntries(seedUserIds.map((id) => [id, id]));

    let ev6Id = ''; // seed-funded bet + resolve (sanity pass over the same settle path Steps 6-8 already prove exhaustively)
    let ev7Id = ''; // insufficient-funds probe ("$" message, not "W")
    let ev8Id = ''; // legacy hold-less bets (pure bookkeeping)
    let ev9Id = ''; // DELETE /api/bets immutability probe (escrowed seed-funded bet)

    await step('Step 15: signup-seed suite — fresh users, no wallet yet', async () => {
      for (const uid of seedUserIds) {
        await sql`INSERT INTO users (id, username, net_total, total_bet, streak) VALUES (${uid}, ${seedUsernames[uid]}, 0, 0, 0)`;
      }
      const u = await sql`SELECT COUNT(*)::int AS n FROM users WHERE id = ANY(${seedUserIds as any}::text[])`;
      assert(u.rows[0].n === seedUserIds.length, 'all signup-seed test users inserted');
      for (const uid of seedUserIds) {
        const noWallet = await sql`SELECT 1 FROM wallets WHERE user_id = ${uid}`;
        assert(noWallet.rows.length === 0, `${seedLabels[uid]}: no wallet row exists yet (nobody has touched their wallet)`);
      }
    });

    await step('Step 16: the $10 signup seed grants exactly once — under concurrent wallet reads, and lazily on first bet touch', async () => {
      // ---- concurrent GET /api/wallet reads: exactly one seed grant ----
      const getWallet = () => callRoute(walletRoute.GET, `/api/wallet?userId=${ivyId}`, { method: 'GET', userId: ivyId });
      const [r1, r2] = await Promise.all([getWallet(), getWallet()]);
      assert(r1.status === 200 && r2.status === 200, `both concurrent GET /api/wallet calls: 200 (got ${r1.status}, ${r2.status})`);
      assertMoney(await walletBalance(ivyId), 10, 'ivy: balance === $10 after two concurrent reads (not $20)');
      const grants = await sql`SELECT COUNT(*)::int AS n FROM transactions WHERE idempotency_key = ${`usd-seed:${ivyId}`}`;
      assert(grants.rows[0].n === 1, `ivy: exactly one usd-seed transaction exists (got ${grants.rows[0].n})`);
      const grantRow = await sql`SELECT type, amount, status, currency, description FROM transactions WHERE idempotency_key = ${`usd-seed:${ivyId}`}`;
      const g = grantRow.rows[0];
      assert(
        g?.type === 'deposit' && parseFloat(g?.amount) === 10 && g?.status === 'completed' &&
          g?.currency === 'usd' && g?.description === 'Signup credit',
        `ivy: seed transaction shape is deposit/$10/completed/usd/'Signup credit' (got ${JSON.stringify(g)})`
      );
      assert(
        r1.body?.wallet?.balance === 10 && r2.body?.wallet?.balance === 10,
        'ivy: both responses report balance === 10'
      );

      // ---- first touch via a bet (no prior GET /api/wallet) also lazily seeds ----
      const r6 = await callRoute(eventsRoute.POST, '/api/events', {
        method: 'POST',
        userId: aliceId,
        body: {
          title: `${RUN} ev6-seed-bet`,
          description: 'verify-payments seed test event',
          side_a: 'side_a',
          side_b: 'side_b',
          end_time: oneHourOut,
          group_id: groupId,
          creator_user_id: aliceId,
          creator_username: usernames[aliceId],
          payment_type: 'none',
        },
      });
      assert(r6.status === 200, `ev6 create: 200 (got ${r6.status})`);
      ev6Id = r6.body?.id;
      if (ev6Id) {
        createdEventIds.push(ev6Id);
        eventLabel[ev6Id] = 'ev6 (seed-funded bet)';
      }

      const noWalletYet = await sql`SELECT 1 FROM wallets WHERE user_id = ${erinId}`;
      assert(noWalletYet.rows.length === 0, 'erin: still no wallet row before her first bet');

      const rE = await callRoute(betsRoute.POST, '/api/bets', {
        method: 'POST',
        userId: erinId,
        body: { event_id: ev6Id, user_id: erinId, username: seedUsernames[erinId], side: 'side_a', amount: 4 },
      });
      assert(rE.status === 200, `erin's first-ever bet ($4, no prior wallet touch): 200 (got ${rE.status})`);
      assertMoney(await walletBalance(erinId), 6, 'erin: $10 signup seed (lazily granted on first bet touch) minus $4 stake = $6');
      const erinSeed = await sql`SELECT COUNT(*)::int AS n FROM transactions WHERE idempotency_key = ${`usd-seed:${erinId}`}`;
      assert(erinSeed.rows[0].n === 1, 'erin: exactly one usd-seed transaction from the lazy grant');
      const hold = await sql`SELECT status, currency FROM escrow_holds WHERE event_id = ${ev6Id} AND user_id = ${erinId} ORDER BY created_at DESC LIMIT 1`;
      assert(
        hold.rows.length === 1 && hold.rows[0].status === 'held' && hold.rows[0].currency === 'usd',
        "erin: escrow_holds row 'held', currency='usd'"
      );

      // Resolve cleanly so nothing is left held. Full settle/unresolve/
      // re-resolve idempotency is already exhaustively proven for usd by
      // Steps 6-8 above — this is the exact same code path (unconditionally
      // usd now, no currency branch left), so it is not re-proven here.
      const resolveRes = await callRoute(resolveRoute.POST, '/api/events/resolve', {
        method: 'POST',
        userId: aliceId,
        body: { event_id: ev6Id, winning_side: 'side_a' },
      });
      assert(resolveRes.status === 200, `resolve ev6: 200 (got ${resolveRes.status})`);
      assert(resolveRes.body?.settlement?.currency === 'usd', `ev6 settlement.currency === 'usd' (got ${resolveRes.body?.settlement?.currency})`);
      assertMoney(await walletBalance(erinId), 10, 'erin: sole bettor, stake released with no winnings = back to $10');
      await checkInvariant1(erinId, 'erin');
      await checkInvariant2(ev6Id, 'ev6');
      await checkInvariant3(ev6Id, 'ev6');
      await checkInvariant4(seedUserIds, 'after Step 16');
    });

    await step('Step 17: guarded debit rejects an over-stake bet — the "$" message, not "W"', async () => {
      const r7 = await callRoute(eventsRoute.POST, '/api/events', {
        method: 'POST',
        userId: aliceId,
        body: {
          title: `${RUN} ev7-insufficient`,
          side_a: 'side_a',
          side_b: 'side_b',
          end_time: oneHourOut,
          group_id: groupId,
          creator_user_id: aliceId,
          creator_username: usernames[aliceId],
          payment_type: 'cash',
        },
      });
      assert(r7.status === 200, `ev7 create: 200 (got ${r7.status})`);
      ev7Id = r7.body?.id;
      if (ev7Id) {
        createdEventIds.push(ev7Id);
        eventLabel[ev7Id] = 'ev7 (insufficient-funds probe)';
      }

      // Seed grace's wallet deliberately first: a rejected bet on a wallet
      // that has NEVER been touched would roll back the lazy seed grant
      // along with the bet itself (both happen inside the same
      // withTransaction in lib/payments.ts), so this probe establishes her
      // $10 balance first, then tests the guarded debit against it.
      const seedRead = await callRoute(walletRoute.GET, `/api/wallet?userId=${graceId}`, { method: 'GET', userId: graceId });
      assert(seedRead.status === 200, `grace: seed read: 200 (got ${seedRead.status})`);
      assertMoney(await walletBalance(graceId), 10, 'grace: seeded to $10');

      const before = await snapshotUser(graceId);
      const res = await callRoute(betsRoute.POST, '/api/bets', {
        method: 'POST',
        userId: graceId,
        body: { event_id: ev7Id, user_id: graceId, username: seedUsernames[graceId], side: 'side_a', amount: 15 },
      });
      assert(res.status === 400, `grace: $15 stake on a $10 balance rejected 400 (got ${res.status})`);
      assert(res.body?.code === 'INSUFFICIENT_FUNDS', `grace: rejected with code INSUFFICIENT_FUNDS (got ${res.body?.code})`);
      assert(
        typeof res.body?.error === 'string' && res.body.error.startsWith('Insufficient balance.'),
        `grace: product-voice message is the "$" version everywhere, not "Not enough W..." (got "${res.body?.error}")`
      );
      assertMoney(res.body?.shortfall, 5, `grace: shortfall === $5 (got ${res.body?.shortfall})`);
      const after = await snapshotUser(graceId);
      assert(
        before.bets === after.bets && before.holds === after.holds && before.txns === after.txns,
        'grace: no bet/hold/transaction row was left behind'
      );
      assertMoney(await walletBalance(graceId), 10, 'grace: balance unchanged at $10 after the rejected bet');
      await checkInvariant4(seedUserIds, 'after Step 17');
    });

    await step('Step 17b: DELETE /api/bets rejects an escrowed seed-funded bet', async () => {
      const r9 = await callRoute(eventsRoute.POST, '/api/events', {
        method: 'POST',
        userId: aliceId,
        body: {
          title: `${RUN} ev9-delete-immutable`,
          side_a: 'side_a',
          side_b: 'side_b',
          end_time: oneHourOut,
          group_id: groupId,
          creator_user_id: aliceId,
          creator_username: usernames[aliceId],
          payment_type: 'none',
        },
      });
      assert(r9.status === 200, `ev9 create: 200 (got ${r9.status})`);
      ev9Id = r9.body?.id;
      if (ev9Id) {
        createdEventIds.push(ev9Id);
        eventLabel[ev9Id] = 'ev9 (delete-immutability probe)';
      }

      const placed = await callRoute(betsRoute.POST, '/api/bets', {
        method: 'POST',
        userId: jacksonId,
        body: { event_id: ev9Id, user_id: jacksonId, username: seedUsernames[jacksonId], side: 'side_a', amount: 3 },
      });
      assert(placed.status === 200, `jackson stakes $3 on ev9 (first touch, lazily seeded): 200 (got ${placed.status})`);
      assertMoney(await walletBalance(jacksonId), 7, 'jackson: $10 seed minus $3 stake = $7');
      const betId = placed.body?.id;
      assert(!!placed.body?.hold_id, 'jackson: bet carries an escrow_hold_id (every bet is escrow-backed now, regardless of payment_type)');

      const beforeBal = await walletBalance(jacksonId);
      const before = await snapshotUser(jacksonId);
      const del = await callRoute(betsRoute.DELETE, `/api/bets?id=${betId}`, { method: 'DELETE', userId: jacksonId });
      assert(del.status === 400, `delete an escrowed bet: rejected 400 (got ${del.status})`);
      assert(del.body?.code === 'CASH_BET_IMMUTABLE', `delete an escrowed bet: code CASH_BET_IMMUTABLE (got ${del.body?.code})`);
      const after = await snapshotUser(jacksonId);
      assert(
        before.bets === after.bets && before.holds === after.holds && before.txns === after.txns,
        'delete an escrowed bet: no row was removed (bets/holds/transactions counts unchanged)'
      );
      assertMoney(await walletBalance(jacksonId), beforeBal, 'delete an escrowed bet: balance untouched');
    });

    await step('Step 18: NO faucet behavior remains — repeated zero-balance touches grant nothing further', async () => {
      const r10 = await callRoute(eventsRoute.POST, '/api/events', {
        method: 'POST',
        userId: aliceId,
        body: {
          title: `${RUN} ev-no-faucet`,
          side_a: 'side_a',
          side_b: 'side_b',
          end_time: oneHourOut,
          group_id: groupId,
          creator_user_id: aliceId,
          creator_username: usernames[aliceId],
          payment_type: 'none',
        },
      });
      assert(r10.status === 200, `no-faucet probe event create: 200 (got ${r10.status})`);
      const noFaucetEvId = r10.body?.id;
      if (noFaucetEvId) {
        createdEventIds.push(noFaucetEvId);
        eventLabel[noFaucetEvId] = 'ev-no-faucet';
      }

      // kelly's very first touch: stake her whole $10 signup seed down to
      // zero in one bet (the debit happens at bet placement, independent of
      // resolution).
      const rBurn = await callRoute(betsRoute.POST, '/api/bets', {
        method: 'POST',
        userId: kellyId,
        body: { event_id: noFaucetEvId, user_id: kellyId, username: seedUsernames[kellyId], side: 'side_a', amount: 10 },
      });
      assert(rBurn.status === 200, `kelly stakes her whole $10 seed: 200 (got ${rBurn.status})`);
      assertMoney(await walletBalance(kellyId), 0, 'kelly: balance === $0 after staking the whole seed');

      // Multiple reads at a zero balance. The old daily faucet used to grant
      // W10 the first time it saw a zero balance; no equivalent exists
      // anymore, so balance must stay exactly $0 across repeated reads.
      for (let i = 0; i < 3; i++) {
        const read = await callRoute(walletRoute.GET, `/api/wallet?userId=${kellyId}`, { method: 'GET', userId: kellyId });
        assert(read.status === 200, `kelly: wallet read #${i + 1} at $0: 200 (got ${read.status})`);
        assertMoney(await walletBalance(kellyId), 0, `kelly: balance still $0 after read #${i + 1} (no faucet grant)`);
      }

      const depositCount = await sql`
        SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = ${kellyId} AND type = 'deposit'
      `;
      assert(
        depositCount.rows[0].n === 1,
        `kelly: exactly one deposit transaction total — the original $10 seed, nothing else (got ${depositCount.rows[0].n})`
      );
      const faucetLike = await sql`
        SELECT COUNT(*)::int AS n FROM transactions
        WHERE user_id = ${kellyId} AND (idempotency_key LIKE ${'faucet:%'} OR description = 'Daily W faucet')
      `;
      assert(faucetLike.rows[0].n === 0, 'kelly: zero rows anywhere carry a faucet-shaped idempotency key or description');

      await checkInvariant1(kellyId, 'kelly');
      await checkInvariant4(seedUserIds, 'after Step 18');
    });

    await step('Step 19: legacy hold-less bets still settle as pure bookkeeping, never touching a wallet', async () => {
      const r11 = await callRoute(eventsRoute.POST, '/api/events', {
        method: 'POST',
        userId: aliceId,
        body: {
          title: `${RUN} ev8-legacy-holdless`,
          side_a: 'side_a',
          side_b: 'side_b',
          end_time: oneHourOut,
          group_id: groupId,
          creator_user_id: aliceId,
          creator_username: usernames[aliceId],
          payment_type: 'none',
        },
      });
      assert(r11.status === 200, `ev8 (legacy event) create: 200 (got ${r11.status})`);
      ev8Id = r11.body?.id;
      if (ev8Id) {
        createdEventIds.push(ev8Id);
        eventLabel[ev8Id] = 'ev8 (legacy hold-less)';
      }

      // Simulate a bet placed before escrow existed: inserted directly with
      // no escrow_hold_id — exactly the shape a pre-escrow row would have.
      await sql`
        INSERT INTO bets (id, event_id, user_id, username, side, amount, is_late, timestamp)
        VALUES (${`${RUN}_bet_frank`}, ${ev8Id}, ${frankId}, ${seedUsernames[frankId]}, 'side_a', 15, false, ${Date.now()})
      `;
      await sql`
        INSERT INTO bets (id, event_id, user_id, username, side, amount, is_late, timestamp)
        VALUES (${`${RUN}_bet_liam`}, ${ev8Id}, ${liamId}, ${seedUsernames[liamId]}, 'side_b', 15, false, ${Date.now()})
      `;

      const preFrankNet = parseFloat((await sql`SELECT net_total FROM users WHERE id = ${frankId}`).rows[0].net_total);
      const preLiamNet = parseFloat((await sql`SELECT net_total FROM users WHERE id = ${liamId}`).rows[0].net_total);

      const res = await callRoute(resolveRoute.POST, '/api/events/resolve', {
        method: 'POST',
        userId: aliceId,
        body: { event_id: ev8Id, winning_side: 'side_a' },
      });
      assert(res.status === 200, `resolve ev8 (legacy hold-less): 200 (got ${res.status})`);
      assert(
        res.body?.settlement?.mode === 'noop' && res.body?.settlement?.reason === 'no_holds',
        `ev8: settlement is a no_holds noop (got mode=${res.body?.settlement?.mode}, reason=${res.body?.settlement?.reason})`
      );

      // Bookkeeping (net_total/streak) still happens — independent of settlement.
      const postFrankNet = parseFloat((await sql`SELECT net_total FROM users WHERE id = ${frankId}`).rows[0].net_total);
      const postLiamNet = parseFloat((await sql`SELECT net_total FROM users WHERE id = ${liamId}`).rows[0].net_total);
      assert(postFrankNet !== preFrankNet, 'frank (winner): net_total changed by ordinary bookkeeping, independent of settlement');
      assert(postLiamNet !== preLiamNet, 'liam (loser): net_total changed by ordinary bookkeeping, independent of settlement');

      // But NO wallet/ledger activity: these bets never had an escrow hold,
      // so settleCashEvent structurally never touches a wallet for them.
      const frankWallet = await sql`SELECT 1 FROM wallets WHERE user_id = ${frankId}`;
      const liamWallet = await sql`SELECT 1 FROM wallets WHERE user_id = ${liamId}`;
      assert(frankWallet.rows.length === 0, 'frank: no wallet row was ever created (never touched)');
      assert(liamWallet.rows.length === 0, 'liam: no wallet row was ever created (never touched)');
      const frankTxns = await sql`SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = ${frankId}`;
      const liamTxns = await sql`SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = ${liamId}`;
      assert(frankTxns.rows[0].n === 0, 'frank: zero transactions');
      assert(liamTxns.rows[0].n === 0, 'liam: zero transactions');
    });

    await step('Step 20: signup-seed suite — global invariant sweep (and proof the main cash flows above are untouched)', async () => {
      for (const uid of [erinId, graceId, ivyId, jacksonId, kellyId]) await checkInvariant1(uid, seedLabels[uid]);
      // ev9 is deliberately excluded — Step 17b's whole point is that its
      // escrowed bet can NEVER be deleted or released, so its hold stays
      // 'held' forever by design (same reasoning the original script's
      // Step 21 sweep used to exclude the equivalent probe event).
      for (const evId of [ev6Id, ev7Id]) {
        if (!evId) continue;
        await checkInvariant2(evId, eventLabel[evId] || evId);
        await checkInvariant3(evId, eventLabel[evId] || evId);
      }
      await checkInvariant4(seedUserIds, 'signup-seed suite final sweep');

      // The main cash-flow users (alice/bob/carol/dave) remain completely
      // unaffected by anything in this suite.
      for (const uid of testUserIds) await checkInvariant1(uid, labels[uid]);
      await checkInvariant4(testUserIds, 'main cash flows unaffected by the signup-seed suite');

      console.log('\n  --- per-user signup-seed ledger ---');
      const rows: string[][] = [];
      for (const uid of [erinId, frankId, graceId, ivyId, jacksonId, kellyId, liamId]) {
        const bal = await walletBalance(uid);
        const sum = await ledgerSum(uid);
        rows.push([seedLabels[uid], money(bal), money(sum)]);
      }
      printTable(['user', 'balance', 'Σ transactions'], rows);
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
