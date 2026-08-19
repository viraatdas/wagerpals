// Verification harness for the iMessage compose/take-a-side endpoints.
//
// Drives the REAL Next.js route handlers directly as functions — no HTTP
// server, no database, no network:
//   - app/api/imessage/session/route.ts
//   - app/api/imessage/bets/route.ts
//   - app/api/imessage/bets/side/route.ts
//   - app/api/events/preview/route.ts
//   - lib/imessage-share.ts (pure helpers, imported for real — not faked)
//
// MECHANISM: these route files import '@/lib/db', '@/lib/auth',
// '@/lib/sync-user', '@/lib/push' and '@/lib/payments'. There is no live
// database or network reachable from this worktree, so those five modules
// are replaced wholesale with in-memory fakes by PRE-POPULATING
// `require.cache` at the modules' resolved absolute paths — investigated and
// confirmed empirically before writing this harness, in preference to a
// Node module-customization-hook (`module.register`) approach:
//
//   This project has no `"type": "module"` in package.json. Even though this
//   script and the route files use `import`/`export` syntax, and even though
//   route files are pulled in here via a dynamic `import()`, tsx compiles
//   `.ts` files with no package-level ESM marker down to CommonJS and loads
//   them through Node's CJS `require()` machinery — so their *internal*
//   `import { db } from '@/lib/db'` statements become `require('@/lib/db')`
//   calls resolved via `Module._resolveFilename`/`Module._cache`, not via
//   the ESM `resolve`/`load` hook chain. This was verified directly: a
//   `module.register()`-based resolve hook registered here never observed a
//   single resolve() call for '@/lib/db' / '@/lib/auth' / '@/lib/sync-user'
//   (only for genuinely dynamic `import()` expressions, like this script's
//   own top-level imports and `lib/auth.ts`'s lazy `import('@/lib/stack')`),
//   while pre-populating `require.cache[<absolute path>]` with a fake
//   `{ exports }` object was picked up immediately. So: `require.cache`
//   pre-population is not a fallback here, it's the mechanism that actually
//   matches how these specific files get loaded in this project.
//
// Because this is a synchronous, same-realm technique (no separate loader
// thread, no module-source-as-text indirection), the fakes are just plain
// TypeScript objects/closures — no string-templated module source needed.
// Only the `db` export needs a `Proxy` indirection: it's captured as a
// plain object reference the first time '@/lib/db' is required (module
// caching means that only happens once for the whole process), so swapping
// which FakeDb instance backs it between test scenarios needs a level of
// indirection that re-reads `globalThis.__wp_fakes__.db` on every property
// access; every other fake is a function whose body re-reads the global at
// call time, so no such trick is needed there.
//
// No DB, no network, no --apply-style side effects. Everything lives and
// dies with this process.
//
// Run: npx tsx scripts/verify-imessage.ts   (or npm run verify:imessage)

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const nodeRequire = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Pre-populate `require.cache` so that any CJS `require('@/lib/db')` (etc.)
 * issued from inside the route files we import below resolves to `exportsObj`
 * instead of compiling the real file. Seeds a few plausible resolved
 * extensions defensively; the exact one tsx's resolver lands on
 * (`lib/db.ts`) was confirmed empirically.
 */
function seedFakeModule(relPathNoExt: string, exportsObj: any): void {
  const abs = path.resolve(REPO_ROOT, relPathNoExt);
  for (const candidate of [abs, `${abs}.ts`, `${abs}.tsx`, `${abs}.js`]) {
    (nodeRequire.cache as any)[candidate] = { id: candidate, filename: candidate, loaded: true, exports: exportsObj };
  }
}

// ---------------------------------------------------------------------------
// PaymentError — a local re-implementation matching lib/payments.ts's shape
// (name/code/status/details, `isPaymentError` duck-typing) exactly, so a
// route's `isPaymentError(err)` check (imported from our fake '@/lib/payments')
// recognizes errors our fake `placeCashBet` throws.
// ---------------------------------------------------------------------------

class PaymentError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;
  constructor(code: string, message: string, status = 400, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, PaymentError.prototype);
  }
}
function isPaymentError(e: unknown): e is PaymentError {
  return (
    e instanceof PaymentError ||
    (typeof e === 'object' && e !== null && (e as any).name === 'PaymentError' && typeof (e as any).code === 'string')
  );
}

// ---------------------------------------------------------------------------
// In-memory fake `db`, mirroring the real accessor shapes/constraints this
// harness's route calls actually exercise.
// ---------------------------------------------------------------------------

type AnyRec = Record<string, any>;

class FakeDb {
  private _users = new Map<string, AnyRec>();
  private _events = new Map<string, AnyRec>();
  private _bets = new Map<string, AnyRec>();
  private _groups = new Map<string, AnyRec>();
  private _groupMembers = new Map<string, AnyRec>();
  private _activities: AnyRec[] = [];
  private _escrowHolds = new Map<string, AnyRec>();

  wallets = new Map<string, number>(); // usd balance
  private _wpWallets = new Map<string, number>(); // wp (the W) balance
  private _wpGranted = new Set<string>(); // mirrors lib/payments.ts's lazy signup-grant-on-touch
  pushCalls: AnyRec[] = [];
  subjectPrivacyCalls: AnyRec[] = [];
  mutationCount = 0;

  // Mirrors lib/payments.ts's lockOrCreateWallet's wp branch: the FIRST time
  // a user's wp balance is touched (by a bet, not a wallet read — this fake
  // has no GET /api/wallet route to drive), they get the same lazy W100
  // signup grant real users get. Real bets can't tell the difference: the
  // real engine grants inside the same transaction the bet is placed in.
  ensureWpBalance(userId: string): number {
    if (!this._wpGranted.has(userId)) {
      this._wpGranted.add(userId);
      this._wpWallets.set(userId, (this._wpWallets.get(userId) ?? 0) + 100);
    }
    return this._wpWallets.get(userId) ?? 0;
  }
  setWpBalance(userId: string, amount: number): void {
    this._wpGranted.add(userId); // an explicit fixture balance suppresses the auto-grant
    this._wpWallets.set(userId, amount);
  }
  debitWp(userId: string, amount: number): void {
    this._wpWallets.set(userId, round((this._wpWallets.get(userId) ?? 0) - amount));
  }

  private key(groupId: string, userId: string): string {
    return `${groupId}::${userId}`;
  }

  users = {
    get: async (id: string) => this._users.get(id) ?? null,
    create: async (u: AnyRec) => {
      this.mutationCount++;
      this._users.set(u.id, u);
      return u;
    },
    update: async (id: string, patch: AnyRec) => {
      this.mutationCount++;
      const cur = this._users.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...patch };
      this._users.set(id, updated);
      return updated;
    },
  };

  events = {
    get: async (id: string) => this._events.get(id) ?? null,
    create: async (e: AnyRec) => {
      this.mutationCount++;
      this._events.set(e.id, e);
      return e;
    },
    delete: async (id: string) => {
      this.mutationCount++;
      this._events.delete(id);
    },
    size: () => this._events.size,
  };

  groups = {
    get: async (id: string) => this._groups.get(id) ?? null,
    getByUser: async (userId: string) =>
      Array.from(this._groups.values()).filter(g => {
        const m = this._groupMembers.get(this.key(g.id, userId));
        return !!m && m.status === 'active';
      }),
  };

  groupMembers = {
    get: async (groupId: string, userId: string) => this._groupMembers.get(this.key(groupId, userId)) ?? null,
    isMember: async (groupId: string, userId: string) => {
      const m = this._groupMembers.get(this.key(groupId, userId));
      return !!m && m.status === 'active';
    },
    // Mirrors the real accessor: joined against users for `username`.
    getByGroup: async (groupId: string) =>
      Array.from(this._groupMembers.values())
        .filter(m => m.group_id === groupId)
        .map(m => ({ ...m, username: this._users.get(m.user_id)?.username ?? m.username })),
    create: async (member: AnyRec) => {
      this.mutationCount++;
      const row = { id: this.key(member.group_id, member.user_id), joined_at: new Date().toISOString(), ...member };
      this._groupMembers.set(this.key(member.group_id, member.user_id), row);
      return row;
    },
    update: async (groupId: string, userId: string, data: AnyRec) => {
      this.mutationCount++;
      const k = this.key(groupId, userId);
      const cur = this._groupMembers.get(k);
      if (!cur) return null;
      const updated = { ...cur, ...data };
      this._groupMembers.set(k, updated);
      return updated;
    },
    size: () => this._groupMembers.size,
  };

  bets = {
    getByEvent: async (eventId: string) =>
      Array.from(this._bets.values())
        .filter(b => b.event_id === eventId)
        .sort((a, b) => a.timestamp - b.timestamp),
    create: async (bet: AnyRec) => {
      this.mutationCount++;
      this._bets.set(bet.id, bet);
      return bet;
    },
    size: () => this._bets.size,
  };

  activities = {
    add: async (activity: AnyRec) => {
      this.mutationCount++;
      this._activities.push(activity);
      return activity;
    },
    all: () => this._activities,
  };

  escrowHolds = {
    create: async (hold: AnyRec) => {
      this.mutationCount++;
      this._escrowHolds.set(hold.id, hold);
      return hold;
    },
    size: () => this._escrowHolds.size,
  };

  // Direct seeding helpers for test fixtures (bypass mutationCount — this is
  // fixture setup, not something under test).
  seedUser(u: AnyRec) {
    this._users.set(u.id, u);
  }
  seedGroup(g: AnyRec) {
    this._groups.set(g.id, g);
  }
  seedGroupMember(m: AnyRec) {
    this._groupMembers.set(this.key(m.group_id, m.user_id), { id: this.key(m.group_id, m.user_id), joined_at: new Date().toISOString(), ...m });
  }
  seedEvent(e: AnyRec) {
    this._events.set(e.id, e);
  }
  seedBet(b: AnyRec) {
    this._bets.set(b.id, b);
  }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let total = 0;
let failed = 0;
const failureLines: string[] = [];

function assert(condition: boolean, description: string): void {
  total++;
  if (condition) {
    console.log(`PASS - ${description}`);
  } else {
    failed++;
    console.log(`FAIL - ${description}`);
    failureLines.push(description);
  }
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n=== ${name} ===`);
  try {
    await fn();
  } catch (err: any) {
    total++;
    failed++;
    const msg = `${name} — unexpected exception: ${err?.message || err}`;
    console.log(`FAIL - ${msg}`);
    failureLines.push(msg);
    if (err?.stack) console.log(String(err.stack).split('\n').slice(0, 6).join('\n'));
  }
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

let idCounter = 0;
function nid(prefix: string): string {
  return `${prefix}_${++idCounter}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.env.IMESSAGE_SHARE_SECRET = 'verify-imessage-test-secret-do-not-use-in-prod';

  const { NextRequest, NextResponse } = await import('next/server');

  // ---- Fake `placeCashBet`, enforcing the same rules read directly out of
  // lib/payments.ts's placeCashBet: currency is derived from
  // event.payment_type ('cash' -> usd, 'none' -> wp — the W), active only
  // (no more end_time gate — R1, events are live until resolved), a
  // non-null stake_amount is a FIXED stake the amount must equal, balance
  // must cover it. For the wp currency this also mirrors
  // lockOrCreateWallet's lazy signup-grant-on-touch (db.ensureWpBalance),
  // so a fixture user with no wallet set up still has their W100 to stake —
  // exactly like the real engine. ------------------------------------------------------
  function fakePlaceCashBet(input: { eventId: string; userId: string; username: string; side: string; amount: number }) {
    return (async () => {
      const db: FakeDb = (globalThis as any).__wp_fakes__.db;
      const event = await db.events.get(input.eventId);
      if (!event) throw new PaymentError('EVENT_NOT_FOUND', 'Event not found.', 404);
      const currency: 'usd' | 'wp' = event.payment_type === 'cash' ? 'usd' : 'wp';
      if (event.status !== 'active') throw new PaymentError('EVENT_RESOLVED', 'This event has already been resolved.', 400);

      const fixedStake = event.stake_amount !== null && event.stake_amount !== undefined ? event.stake_amount : null;
      const fmt = (n: number) => (currency === 'usd' ? `$${n.toFixed(2)}` : `W${Number.isInteger(round(n)) ? round(n) : round(n).toFixed(2)}`);
      let stake: number;
      if (fixedStake !== null && fixedStake > 0) {
        if (round(input.amount) !== round(fixedStake)) {
          throw new PaymentError('INVALID_STAKE', `This event has a fixed stake of ${fmt(fixedStake)}.`, 400, {
            required_stake: fixedStake,
          });
        }
        stake = round(fixedStake);
      } else {
        stake = round(input.amount);
        if (!(stake > 0)) throw new PaymentError('INVALID_STAKE', `Stake must be greater than ${fmt(0)}.`, 400);
        if (stake > 500) throw new PaymentError('AMOUNT_TOO_LARGE', `Maximum transaction amount is ${fmt(500)}`, 400);
      }

      const balance = currency === 'usd' ? (db.wallets.get(input.userId) ?? 0) : db.ensureWpBalance(input.userId);
      if (balance < stake) {
        const message = currency === 'wp'
          ? `Not enough W — you have ${fmt(balance)}.`
          : `Insufficient balance. You have ${fmt(balance)} but this bet needs ${fmt(stake)}.`;
        throw new PaymentError('INSUFFICIENT_FUNDS', message, 400, { balance, required: stake, shortfall: round(stake - balance), currency });
      }
      if (currency === 'usd') {
        db.wallets.set(input.userId, round(balance - stake));
      } else {
        db.debitWp(input.userId, stake);
      }

      const holdId = nid('hold');
      const hold = { id: holdId, event_id: input.eventId, bet_id: null as string | null, user_id: input.userId, amount: stake, status: 'held', currency };
      await db.escrowHolds.create(hold);

      const betId = nid('bet');
      const bet = {
        id: betId,
        event_id: input.eventId,
        user_id: input.userId,
        username: input.username,
        side: input.side,
        amount: stake,
        is_late: false,
        timestamp: Date.now(),
        escrow_hold_id: holdId,
      };
      await db.bets.create(bet);
      hold.bet_id = betId;

      const walletAfter = currency === 'usd'
        ? { user_id: input.userId, balance: db.wallets.get(input.userId)! }
        : { user_id: input.userId, wp_balance: db.ensureWpBalance(input.userId) };
      return { bet, hold, transaction: { id: nid('txn') }, wallet: walletAfter };
    })();
  }

  (globalThis as any).__wp_fakes__ = {
    db: null,
    auth: { mode: 'unauthorized', user: null },
    syncUser: async () => ({ ok: false, status: 500, error: 'syncUser not configured for this test' }),
    push: {
      notifyEventAudience: async (_options: any) => ({ sent: 0, failed: 0, skipped: 0 }),
      applySubjectPrivacy: async (_eventId: any, _subjectUserId: any, _notifySubject: any) => {},
    },
    payments: { placeCashBet: fakePlaceCashBet },
  };

  // `db` is a plain object binding captured once at first `require('@/lib/db')`
  // — proxy it so swapping globalThis.__wp_fakes__.db between scenarios is
  // visible to code that already holds the (proxy) reference.
  const dbProxy = new Proxy(
    {},
    {
      get(_target, prop) {
        const current = (globalThis as any).__wp_fakes__.db;
        return current ? current[prop] : undefined;
      },
    }
  );

  seedFakeModule('lib/db', { db: dbProxy });
  seedFakeModule('lib/auth', {
    requireAuthUser: async (_request: any) => {
      const cfg = (globalThis as any).__wp_fakes__.auth;
      if (!cfg || cfg.mode !== 'authorized') {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }
      return { user: cfg.user };
    },
  });
  seedFakeModule('lib/sync-user', {
    syncUser: async (stackUser: any, opts: any) => (globalThis as any).__wp_fakes__.syncUser(stackUser, opts),
  });
  seedFakeModule('lib/push', {
    notifyEventAudience: async (options: any) => (globalThis as any).__wp_fakes__.push.notifyEventAudience(options),
    applySubjectPrivacy: async (eventId: any, subjectUserId: any, notifySubject: any) =>
      (globalThis as any).__wp_fakes__.push.applySubjectPrivacy(eventId, subjectUserId, notifySubject),
  });
  seedFakeModule('lib/payments', {
    MAX_TRANSACTION_AMOUNT: 500,
    PaymentError,
    isPaymentError,
    placeCashBet: async (input: any) => (globalThis as any).__wp_fakes__.payments.placeCashBet(input),
  });

  const shareLib = await import('@/lib/imessage-share');

  const sessionRoute: any = await import('@/app/api/imessage/session/route');
  const betsRoute: any = await import('@/app/api/imessage/bets/route');
  const sideRoute: any = await import('@/app/api/imessage/bets/side/route');
  const previewRoute: any = await import('@/app/api/events/preview/route');

  // ---- Per-scenario helpers -------------------------------------------------

  function useWorld(db: FakeDb): FakeDb {
    (globalThis as any).__wp_fakes__.db = db;
    (globalThis as any).__wp_fakes__.push = {
      notifyEventAudience: async (options: any) => {
        db.pushCalls.push(options);
        return { sent: 0, failed: 0, skipped: 0 };
      },
      applySubjectPrivacy: async (eventId: any, subjectUserId: any, notifySubject: any) => {
        db.subjectPrivacyCalls.push({ eventId, subjectUserId, notifySubject });
      },
    };
    return db;
  }

  function toStackUser(user: AnyRec) {
    return {
      id: user.id,
      primaryEmail: null,
      primaryEmailVerified: false,
      displayName: null,
      profileImageUrl: null,
      hasPassword: false,
      otpAuthEnabled: false,
      passkeyAuthEnabled: false,
      oauthProviderIds: [],
    };
  }

  function loginAs(user: AnyRec): void {
    const fakes = (globalThis as any).__wp_fakes__;
    fakes.auth = { mode: 'authorized', user: toStackUser(user) };
    fakes.syncUser = async () => ({ ok: true, user });
  }

  function logout(): void {
    (globalThis as any).__wp_fakes__.auth = { mode: 'unauthorized', user: null };
  }

  function seedBasicWorld(): { db: FakeDb; creator: AnyRec; group: AnyRec } {
    const db = useWorld(new FakeDb());
    const creator = { id: nid('user'), username: `creator_${idCounter}`, total_bet: 0, net_total: 0, streak: 0 };
    db.seedUser(creator);
    const group = { id: nid('group'), name: 'Verify iMessage Group', created_by: creator.id, is_public: false, created_at: new Date().toISOString() };
    db.seedGroup(group);
    db.seedGroupMember({ group_id: group.id, user_id: creator.id, role: 'admin', status: 'active' });
    return { db, creator, group };
  }

  async function callJSON(
    handler: (req: any) => Promise<Response>,
    url: string,
    opts: { method?: string; body?: any } = {}
  ): Promise<{ status: number; body: any; headers: Headers }> {
    const req = new NextRequest(
      new Request(`http://localhost${url}`, {
        method: opts.method || 'GET',
        headers: { 'content-type': 'application/json' },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      })
    );
    const res = await handler(req);
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body, headers: res.headers };
  }

  const ONE_HOUR = 60 * 60 * 1000;

  // ===========================================================================
  // Group 1 — Auth: each iMessage handler returns 401 unauthenticated, no writes
  // ===========================================================================
  await step('Auth: 401 + zero mutations when unauthenticated', async () => {
    {
      const db = seedBasicWorld().db;
      logout();
      const before = db.mutationCount;
      const res = await callJSON(sessionRoute.GET, '/api/imessage/session', { method: 'GET' });
      assert(res.status === 401, 'GET /api/imessage/session: 401 when unauthenticated');
      assert(db.mutationCount === before, 'GET /api/imessage/session: no db mutation on 401');
    }
    {
      const db = seedBasicWorld().db;
      logout();
      const before = db.mutationCount;
      const res = await callJSON(betsRoute.POST, '/api/imessage/bets', { method: 'POST', body: {} });
      assert(res.status === 401, 'POST /api/imessage/bets: 401 when unauthenticated');
      assert(db.mutationCount === before, 'POST /api/imessage/bets: no db mutation on 401');
    }
    {
      const db = seedBasicWorld().db;
      logout();
      const before = db.mutationCount;
      const res = await callJSON(sideRoute.POST, '/api/imessage/bets/side', { method: 'POST', body: {} });
      assert(res.status === 401, 'POST /api/imessage/bets/side: 401 when unauthenticated');
      assert(db.mutationCount === before, 'POST /api/imessage/bets/side: no db mutation on 401');
    }
  });

  await step('Auth: session route happy path (sanity)', async () => {
    const { db, creator, group } = seedBasicWorld();
    const other = { id: nid('user'), username: 'roster_member', total_bet: 0, net_total: 0, streak: 0 };
    db.seedUser(other);
    db.seedGroupMember({ group_id: group.id, user_id: other.id, role: 'member', status: 'active' });
    const pending = { id: nid('user'), username: 'roster_pending', total_bet: 0, net_total: 0, streak: 0 };
    db.seedUser(pending);
    db.seedGroupMember({ group_id: group.id, user_id: pending.id, role: 'member', status: 'pending' });

    loginAs(creator);
    const res = await callJSON(sessionRoute.GET, '/api/imessage/session', { method: 'GET' });
    assert(res.status === 200, 'GET /api/imessage/session: 200 when authenticated');
    assert(res.body?.user?.id === creator.id, 'session: returns the authenticated user id');
    const respGroup = res.body?.groups?.find((g: any) => g.id === group.id);
    assert(!!respGroup, "session: lists the caller's active group");
    assert(
      Array.isArray(respGroup?.members) && respGroup.members.some((m: any) => m.id === other.id),
      'session: group roster includes an active member'
    );
    assert(
      !respGroup?.members?.some((m: any) => m.id === pending.id),
      'session: group roster excludes a pending member'
    );
  });

  // ===========================================================================
  // Group 2 — Creator identity comes from the session, never the body
  // ===========================================================================
  await step('Create: creator identity is always the session user, never the body', async () => {
    const { db, creator, group } = seedBasicWorld();
    loginAs(creator);
    const res = await callJSON(betsRoute.POST, '/api/imessage/bets', {
      method: 'POST',
      body: {
        group_id: group.id,
        title: 'Body spoof test',
        side_a: 'A',
        side_b: 'B',
        end_time: Date.now() + ONE_HOUR,
        payment_type: 'none',
        side: 'A',
        amount: 5,
        creator_user_id: 'attacker_id',
        user_id: 'attacker_id',
      },
    });
    assert(res.status === 201, 'create-with-side: 201');
    const eventId = res.body?.event_id;
    const bets = await db.bets.getByEvent(eventId);
    assert(bets.length === 1 && bets[0].user_id === creator.id, 'placed bet carries the SESSION user id, not the body id');
    assert(bets[0].username === creator.username, 'placed bet carries the SESSION username');
    const activities = db.activities.all().filter(a => a.event_id === eventId);
    assert(activities.every(a => a.user_id === creator.id), 'all activity rows for this event carry the SESSION user id');
  });

  // ===========================================================================
  // Group 3 — 403 when caller is not an ACTIVE member of group_id
  // ===========================================================================
  await step('Create: 403 when caller is not an active member (no row / pending row)', async () => {
    const validBody = (groupId: string) => ({
      group_id: groupId,
      title: 'Membership test',
      side_a: 'A',
      side_b: 'B',
      end_time: Date.now() + ONE_HOUR,
    });

    {
      const db = useWorld(new FakeDb());
      const caller = { id: nid('user'), username: 'no_row_user', total_bet: 0, net_total: 0, streak: 0 };
      const group = { id: nid('group'), name: 'G', created_by: 'someone_else', is_public: false, created_at: new Date().toISOString() };
      db.seedUser(caller);
      db.seedGroup(group);
      loginAs(caller);
      const before = db.events.size();
      const res = await callJSON(betsRoute.POST, '/api/imessage/bets', { method: 'POST', body: validBody(group.id) });
      assert(res.status === 403, 'no membership row at all: 403');
      assert(db.events.size() === before, 'no membership row: no event created');
    }
    {
      const db = useWorld(new FakeDb());
      const caller = { id: nid('user'), username: 'pending_user', total_bet: 0, net_total: 0, streak: 0 };
      const group = { id: nid('group'), name: 'G', created_by: 'someone_else', is_public: false, created_at: new Date().toISOString() };
      db.seedUser(caller);
      db.seedGroup(group);
      db.seedGroupMember({ group_id: group.id, user_id: caller.id, role: 'member', status: 'pending' });
      loginAs(caller);
      const before = db.events.size();
      const res = await callJSON(betsRoute.POST, '/api/imessage/bets', { method: 'POST', body: validBody(group.id) });
      assert(res.status === 403, "membership row with status 'pending': 403");
      assert(db.events.size() === before, "membership row 'pending': no event created");
    }
  });

  // ===========================================================================
  // Group 4 — bets/side: 403 for non-member with no token / invalid token
  // ===========================================================================
  await step('Take-a-side: 403 for non-member with no token or an invalid token', async () => {
    const db = useWorld(new FakeDb());
    const group = { id: nid('group'), name: 'G', created_by: 'x', is_public: false, created_at: new Date().toISOString() };
    db.seedGroup(group);
    const event = {
      id: nid('event'),
      title: 'No token test',
      side_a: 'A',
      side_b: 'B',
      end_time: Date.now() + ONE_HOUR,
      group_id: group.id,
      status: 'active',
      payment_type: 'none',
      stake_amount: null,
    };
    db.seedEvent(event);
    const nonMember = { id: nid('user'), username: 'outsider', total_bet: 0, net_total: 0, streak: 0 };
    db.seedUser(nonMember);
    loginAs(nonMember);

    const beforeMembers = db.groupMembers.size();
    const r1 = await callJSON(sideRoute.POST, '/api/imessage/bets/side', {
      method: 'POST',
      body: { event_id: event.id, side: 'A', amount: 5 },
    });
    assert(r1.status === 403, 'non-member, no share_token: 403');
    assert(db.groupMembers.size() === beforeMembers, 'non-member, no share_token: no group_members row created');

    const r2 = await callJSON(sideRoute.POST, '/api/imessage/bets/side', {
      method: 'POST',
      body: { event_id: event.id, side: 'A', amount: 5, share_token: 'this-is-not-a-real-token' },
    });
    assert(r2.status === 403, 'non-member, invalid/tampered share_token: 403');
    assert(db.groupMembers.size() === beforeMembers, 'non-member, invalid share_token: no group_members row created');
  });

  // ===========================================================================
  // Group 5 — bets/side: valid token succeeds for a non-member, upserts active
  // membership (create path, and pending -> active upgrade path)
  // ===========================================================================
  await step('Take-a-side: valid share token succeeds and upserts active membership', async () => {
    // (a) no prior membership row at all.
    {
      const db = useWorld(new FakeDb());
      const group = { id: nid('group'), name: 'G', created_by: 'x', is_public: false, created_at: new Date().toISOString() };
      db.seedGroup(group);
      const event = {
        id: nid('event'),
        title: 'Token success — new row',
        side_a: 'A',
        side_b: 'B',
        end_time: Date.now() + ONE_HOUR,
        group_id: group.id,
        status: 'active',
        payment_type: 'none',
        stake_amount: null,
      };
      db.seedEvent(event);
      const bearer = { id: nid('user'), username: 'bearer1', total_bet: 0, net_total: 0, streak: 0 };
      db.seedUser(bearer);
      loginAs(bearer);
      const token = shareLib.createShareToken(event.id);
      assert(typeof token === 'string' && token.length > 0, 'fixture: createShareToken produced a token (secret is set)');

      const res = await callJSON(sideRoute.POST, '/api/imessage/bets/side', {
        method: 'POST',
        body: { event_id: event.id, side: 'A', amount: 5, share_token: token },
      });
      assert(res.status === 200, 'valid token, no prior row: 200');
      const member = await db.groupMembers.get(group.id, bearer.id);
      assert(!!member && member.status === 'active', 'valid token, no prior row: a new ACTIVE group_members row was upserted');

      // Same n4 contract as the create route: event-scoped audience, actor excluded.
      const notified = db.pushCalls.find((c) => c.eventId === event.id);
      assert(!!notified, 'take side: notified via notifyEventAudience (scoped to the event), not a platform-wide broadcast');
      assert(notified?.category === 'bets', "take side: notification category is 'bets'");
      assert(
        Array.isArray(notified?.excludeUserIds) && notified.excludeUserIds.includes(bearer.id),
        'take side: the bettor is excluded from their own notification'
      );
    }

    // (b) prior 'pending' row upgrades to 'active' (same row, not a duplicate).
    {
      const db = useWorld(new FakeDb());
      const group = { id: nid('group'), name: 'G', created_by: 'x', is_public: false, created_at: new Date().toISOString() };
      db.seedGroup(group);
      const event = {
        id: nid('event'),
        title: 'Token success — pending upgrade',
        side_a: 'A',
        side_b: 'B',
        end_time: Date.now() + ONE_HOUR,
        group_id: group.id,
        status: 'active',
        payment_type: 'none',
        stake_amount: null,
      };
      db.seedEvent(event);
      const bearer = { id: nid('user'), username: 'bearer2', total_bet: 0, net_total: 0, streak: 0 };
      db.seedUser(bearer);
      db.seedGroupMember({ group_id: group.id, user_id: bearer.id, role: 'member', status: 'pending' });
      loginAs(bearer);
      const token = shareLib.createShareToken(event.id);

      const beforeCount = db.groupMembers.size();
      const res = await callJSON(sideRoute.POST, '/api/imessage/bets/side', {
        method: 'POST',
        body: { event_id: event.id, side: 'B', amount: 5, share_token: token },
      });
      assert(res.status === 200, "valid token, prior 'pending' row: 200");
      assert(db.groupMembers.size() === beforeCount, "valid token, prior 'pending' row: no duplicate row created");
      const member = await db.groupMembers.get(group.id, bearer.id);
      assert(!!member && member.status === 'active', "valid token, prior 'pending' row: upgraded to ACTIVE");
    }
  });

  // ===========================================================================
  // Group 6 — Create-time field validation
  // ===========================================================================
  await step('Create: field validation', async () => {
    const db = useWorld(new FakeDb());
    const groupId = 'irrelevant-group-not-yet-queried';
    const base = () => ({
      group_id: groupId,
      title: 'Valid title',
      side_a: 'A',
      side_b: 'B',
      end_time: Date.now() + ONE_HOUR,
    });
    const before = db.mutationCount;

    const cases: Array<[string, AnyRec, number]> = [
      ['missing title', { ...base(), title: undefined }, 400],
      ['blank title', { ...base(), title: '   ' }, 400],
      ['blank side_a', { ...base(), side_a: '  ' }, 400],
      ['blank side_b', { ...base(), side_b: '' }, 400],
      ['side_a === side_b', { ...base(), side_a: 'Same', side_b: 'Same' }, 400],
      ['non-numeric end_time', { ...base(), end_time: 'tomorrow' }, 400],
      ['past end_time', { ...base(), end_time: Date.now() - 10_000 }, 400],
      ['payment_type other than none/cash', { ...base(), payment_type: 'crypto' }, 400],
      ['cash stake <= 0 (zero)', { ...base(), payment_type: 'cash', stake_amount: 0 }, 400],
      ['cash stake <= 0 (negative)', { ...base(), payment_type: 'cash', stake_amount: -5 }, 400],
      ['cash stake > 500', { ...base(), payment_type: 'cash', stake_amount: 501 }, 400],
    ];

    for (const [label, body, expectedStatus] of cases) {
      const res = await callJSON(betsRoute.POST, '/api/imessage/bets', { method: 'POST', body });
      assert(res.status === expectedStatus, `validation — ${label}: ${expectedStatus}`);
    }
    assert(db.mutationCount === before, 'validation cases: none of them wrote to the db');
  });

  // ===========================================================================
  // Group 7 — notify_subject default/false, subject_user_id checks
  // ===========================================================================
  await step('Create: notify_subject defaulting and subject_user_id validation', async () => {
    const { db, creator, group } = seedBasicWorld();
    loginAs(creator);
    const baseBody = (overrides: AnyRec) => ({
      group_id: group.id,
      title: 'Subject test',
      side_a: 'A',
      side_b: 'B',
      end_time: Date.now() + ONE_HOUR,
      ...overrides,
    });

    const r1 = await callJSON(betsRoute.POST, '/api/imessage/bets', { method: 'POST', body: baseBody({}) });
    assert(r1.status === 201, 'notify_subject omitted: 201');
    assert((await db.events.get(r1.body.event_id))?.notify_subject === true, 'notify_subject omitted: defaults to TRUE');

    const r2 = await callJSON(betsRoute.POST, '/api/imessage/bets', { method: 'POST', body: baseBody({ notify_subject: null }) });
    assert(r2.status === 201, 'notify_subject: null: 201');
    assert((await db.events.get(r2.body.event_id))?.notify_subject === true, 'notify_subject: null defaults to TRUE');

    const r3 = await callJSON(betsRoute.POST, '/api/imessage/bets', { method: 'POST', body: baseBody({ notify_subject: false }) });
    assert(r3.status === 201, 'notify_subject: false: 201');
    assert((await db.events.get(r3.body.event_id))?.notify_subject === false, 'notify_subject: false is respected (only explicit false suppresses)');

    const r4 = await callJSON(betsRoute.POST, '/api/imessage/bets', { method: 'POST', body: baseBody({ notify_subject: true }) });
    assert(r4.status === 201, 'notify_subject: true (explicit): 201');
    assert((await db.events.get(r4.body.event_id))?.notify_subject === true, 'notify_subject: explicit true is respected');

    const r5 = await callJSON(betsRoute.POST, '/api/imessage/bets', {
      method: 'POST',
      body: baseBody({ subject_user_id: 'no-such-user' }),
    });
    assert(r5.status === 400, 'subject_user_id: nonexistent user: 400');

    const nonMemberSubject = { id: nid('user'), username: 'not_a_member', total_bet: 0, net_total: 0, streak: 0 };
    db.seedUser(nonMemberSubject);
    const r6 = await callJSON(betsRoute.POST, '/api/imessage/bets', {
      method: 'POST',
      body: baseBody({ subject_user_id: nonMemberSubject.id }),
    });
    assert(r6.status === 400, 'subject_user_id: exists but not an active group member: 400');

    const memberSubject = { id: nid('user'), username: 'is_a_member', total_bet: 0, net_total: 0, streak: 0 };
    db.seedUser(memberSubject);
    db.seedGroupMember({ group_id: group.id, user_id: memberSubject.id, role: 'member', status: 'active' });
    const r7 = await callJSON(betsRoute.POST, '/api/imessage/bets', {
      method: 'POST',
      body: baseBody({ subject_user_id: memberSubject.id }),
    });
    assert(r7.status === 201, 'subject_user_id: valid active member: 201');
    assert((await db.events.get(r7.body.event_id))?.subject_user_id === memberSubject.id, 'subject_user_id is stored on the event');
  });

  // ===========================================================================
  // Group 8 — failed opening bet rolls back the just-created event
  // ===========================================================================
  await step('Create: a failed opening bet deletes the just-created event (no orphan)', async () => {
    const { db, creator, group } = seedBasicWorld();
    db.wallets.set(creator.id, 10); // not enough for a $25 stake
    loginAs(creator);
    const eventsBefore = db.events.size();
    const betsBefore = db.bets.size();
    const holdsBefore = db.escrowHolds.size();

    const res = await callJSON(betsRoute.POST, '/api/imessage/bets', {
      method: 'POST',
      body: {
        group_id: group.id,
        title: 'Insufficient funds rollback test',
        side_a: 'A',
        side_b: 'B',
        end_time: Date.now() + ONE_HOUR,
        payment_type: 'cash',
        stake_amount: 25,
        side: 'A',
        amount: 25,
      },
    });

    assert(res.status === 400, 'failed opening bet: PaymentError status propagated (400)');
    assert(res.body?.code === 'INSUFFICIENT_FUNDS', 'failed opening bet: PaymentError code propagated (INSUFFICIENT_FUNDS)');
    assert(db.events.size() === eventsBefore, 'failed opening bet: no orphan event remains (net event count unchanged)');
    assert(db.bets.size() === betsBefore, 'failed opening bet: no bet row was left behind');
    assert(db.escrowHolds.size() === holdsBefore, 'failed opening bet: no escrow hold was left behind');
  });

  // ===========================================================================
  // Group 8b — same rollback proof, but for the W (play event, currency='wp')
  // ===========================================================================
  await step('Create: insufficient W on a play event also rolls back (currency-aware engine)', async () => {
    const { db, creator, group } = seedBasicWorld();
    // Deliberately >100 so it exceeds the lazy signup grant (W100) every
    // fresh wp touch gets — proves the wp path is guarded exactly like usd.
    loginAs(creator);
    const eventsBefore = db.events.size();
    const betsBefore = db.bets.size();
    const holdsBefore = db.escrowHolds.size();

    const res = await callJSON(betsRoute.POST, '/api/imessage/bets', {
      method: 'POST',
      body: {
        group_id: group.id,
        title: 'Insufficient W rollback test',
        side_a: 'A',
        side_b: 'B',
        end_time: Date.now() + ONE_HOUR,
        payment_type: 'none',
        side: 'A',
        amount: 150,
      },
    });

    assert(res.status === 400, 'failed W opening bet: PaymentError status propagated (400)');
    assert(res.body?.code === 'INSUFFICIENT_FUNDS', 'failed W opening bet: PaymentError code propagated (INSUFFICIENT_FUNDS)');
    assert(typeof res.body?.error === 'string' && res.body.error.includes('W'), 'failed W opening bet: message is product-voice ("Not enough W...")');
    assert(db.events.size() === eventsBefore, 'failed W opening bet: no orphan event remains (net event count unchanged)');
    assert(db.bets.size() === betsBefore, 'failed W opening bet: no bet row was left behind');
    assert(db.escrowHolds.size() === holdsBefore, 'failed W opening bet: no escrow hold was left behind');
  });

  // ===========================================================================
  // Group 9 — happy-path 201 shape + preview reflects the opening bet
  // ===========================================================================
  await step("Create: 201 shape and preview reflects the creator's opening bet", async () => {
    const { db, creator, group } = seedBasicWorld();
    db.wallets.set(creator.id, 100);
    loginAs(creator);

    const res = await callJSON(betsRoute.POST, '/api/imessage/bets', {
      method: 'POST',
      body: {
        group_id: group.id,
        title: 'Happy path',
        side_a: 'A',
        side_b: 'B',
        end_time: Date.now() + ONE_HOUR,
        payment_type: 'cash',
        stake_amount: 20,
        side: 'A',
        amount: 20,
      },
    });

    assert(res.status === 201, 'happy path: 201');
    assert(typeof res.body?.event_id === 'string' && res.body.event_id.length > 0, 'response has event_id');
    assert(typeof res.body?.share_token === 'string' && res.body.share_token.length > 0, 'response has a non-null share_token (secret is configured)');
    assert(typeof res.body?.share_url === 'string' && res.body.share_url.includes('t='), 'response has a share_url carrying the token');
    assert(!!res.body?.preview, 'response has a preview object');
    assert(res.body.preview.total_bets === 1, "preview.total_bets === 1 (creator's opening bet)");
    assert(res.body.preview.total_participants === 1, 'preview.total_participants === 1');
    assert(res.body.preview.side_a_count === 1 && res.body.preview.side_b_count === 0, "preview side counts reflect the opening bet's side");
    assert(res.body.preview.side_a_total === 20 && res.body.preview.side_b_total === 0, "preview side totals reflect the opening bet's amount");

    // n4's contract: notifications are addressed to the EVENT's audience (the
    // group's active members), never broadcast to every subscriber, and the
    // actor never notifies themselves. Regression gate for the migration off
    // the removed sendPushToAllSubscribers.
    const created = db.pushCalls.find((c) => c.eventId === res.body.event_id);
    assert(!!created, 'create: notified via notifyEventAudience (scoped to the event), not a platform-wide broadcast');
    assert(created?.category === 'bets', "create: notification category is 'bets'");
    assert(created?.payload?.eventId === res.body.event_id, 'create: notification payload carries the event id');
    assert(
      Array.isArray(created?.excludeUserIds) && created.excludeUserIds.includes(creator.id),
      'create: the creator is excluded from their own notification'
    );

    // Bonus: `amount` omitted on a fixed-stake event defaults to the stake.
    const res2 = await callJSON(betsRoute.POST, '/api/imessage/bets', {
      method: 'POST',
      body: {
        group_id: group.id,
        title: 'Default-amount path',
        side_a: 'A',
        side_b: 'B',
        end_time: Date.now() + ONE_HOUR,
        payment_type: 'cash',
        stake_amount: 15,
        side: 'A',
      },
    });
    assert(res2.status === 201, 'fixed stake, amount omitted: 201 (defaults amount to the stake)');
    assert(res2.body.preview.side_a_total === 15, 'fixed stake, amount omitted: opening bet used the fixed stake amount');
  });

  // ===========================================================================
  // Group 10 — bets/side: invalid side -> 400
  // ===========================================================================
  await step('Take-a-side: invalid side -> 400', async () => {
    const db = useWorld(new FakeDb());
    const event = {
      id: nid('event'),
      title: 'Invalid side test',
      side_a: 'A',
      side_b: 'B',
      end_time: Date.now() + ONE_HOUR,
      group_id: nid('group'),
      status: 'active',
      payment_type: 'none',
      stake_amount: null,
    };
    db.seedEvent(event);
    const caller = { id: nid('user'), username: 'sider', total_bet: 0, net_total: 0, streak: 0 };
    db.seedUser(caller);
    loginAs(caller);
    const res = await callJSON(sideRoute.POST, '/api/imessage/bets/side', {
      method: 'POST',
      body: { event_id: event.id, side: 'C', amount: 5 },
    });
    assert(res.status === 400, 'side matching neither side_a nor side_b: 400');
  });

  // ===========================================================================
  // Group 11 — fixed-stake mismatch on bets/side
  // ===========================================================================
  await step('Take-a-side: fixed-stake cash event rejects a mismatched amount', async () => {
    const { db, creator, group } = seedBasicWorld();
    db.wallets.set(creator.id, 100);
    const event = {
      id: nid('event'),
      title: 'Fixed stake mismatch',
      side_a: 'A',
      side_b: 'B',
      end_time: Date.now() + ONE_HOUR,
      group_id: group.id,
      status: 'active',
      payment_type: 'cash',
      stake_amount: 10,
    };
    db.seedEvent(event);
    loginAs(creator);
    const res = await callJSON(sideRoute.POST, '/api/imessage/bets/side', {
      method: 'POST',
      body: { event_id: event.id, side: 'A', amount: 7 },
    });
    assert(res.status === 400, 'mismatched amount on a $10-fixed-stake event: 400');
    assert(res.body?.code === 'INVALID_STAKE', 'mismatched amount: PaymentError code INVALID_STAKE');
  });

  // ===========================================================================
  // Group 12/13 — duplicate-bet guard (cash vs free) + recomputed preview
  // ===========================================================================
  await step('Take-a-side: duplicate-bet guard (cash: any 2nd bet; free: only same side)', async () => {
    // Cash: ANY second bet from the same user is rejected, regardless of side.
    {
      const { db, creator, group } = seedBasicWorld();
      db.wallets.set(creator.id, 1000);
      const event = {
        id: nid('event'),
        title: 'Cash duplicate guard',
        side_a: 'A',
        side_b: 'B',
        end_time: Date.now() + ONE_HOUR,
        group_id: group.id,
        status: 'active',
        payment_type: 'cash',
        stake_amount: null,
      };
      db.seedEvent(event);
      loginAs(creator);
      const r1 = await callJSON(sideRoute.POST, '/api/imessage/bets/side', { method: 'POST', body: { event_id: event.id, side: 'A', amount: 10 } });
      assert(r1.status === 200, 'cash: first bet succeeds');
      const r2 = await callJSON(sideRoute.POST, '/api/imessage/bets/side', { method: 'POST', body: { event_id: event.id, side: 'B', amount: 5 } });
      assert(r2.status === 400, 'cash: second bet (even on the OTHER side) is rejected');
    }

    // Free: only a second bet on the SAME side is rejected; the other side is allowed.
    {
      const { db, creator, group } = seedBasicWorld();
      const event = {
        id: nid('event'),
        title: 'Free duplicate guard',
        side_a: 'A',
        side_b: 'B',
        end_time: Date.now() + ONE_HOUR,
        group_id: group.id,
        status: 'active',
        payment_type: 'none',
        stake_amount: null,
      };
      db.seedEvent(event);
      loginAs(creator);
      const r1 = await callJSON(sideRoute.POST, '/api/imessage/bets/side', { method: 'POST', body: { event_id: event.id, side: 'A', amount: 5 } });
      assert(r1.status === 200, 'free: first bet on side A succeeds');
      const r2 = await callJSON(sideRoute.POST, '/api/imessage/bets/side', { method: 'POST', body: { event_id: event.id, side: 'A', amount: 5 } });
      assert(r2.status === 400, 'free: second bet on the SAME side (A) is rejected');
      const r3 = await callJSON(sideRoute.POST, '/api/imessage/bets/side', { method: 'POST', body: { event_id: event.id, side: 'B', amount: 5 } });
      assert(r3.status === 200, 'free: a bet on the OTHER side (B) is allowed');
      assert(r3.body?.preview?.total_bets === 2, 'take-a-side: returned preview is recomputed to include the just-placed bet (total_bets)');
      assert(r3.body?.preview?.side_b_count === 1 && r3.body?.preview?.side_b_total === 5, "take-a-side: returned preview reflects the just-placed bet's side/amount");
    }
  });

  // ===========================================================================
  // Group 14 — public preview: missing/unknown id
  // ===========================================================================
  await step('Public preview: missing id -> 400, unknown id -> 404', async () => {
    useWorld(new FakeDb());
    const r1 = await callJSON(previewRoute.GET, '/api/events/preview', { method: 'GET' });
    assert(r1.status === 400, 'no id query param: 400');
    const r2 = await callJSON(previewRoute.GET, '/api/events/preview?id=does-not-exist', { method: 'GET' });
    assert(r2.status === 404, 'unknown id: 404');
  });

  // ===========================================================================
  // Group 15/16/17/18 — public preview: totals gating, privacy, cache headers
  // ===========================================================================
  await step('Public preview: totals gating, privacy leak sweep, and cache headers', async () => {
    const db = useWorld(new FakeDb());
    const SENTINEL_USER_A = 'SENTINEL_USERNAME_ALPHA_9f3e';
    const SENTINEL_USER_B = 'SENTINEL_USERNAME_BRAVO_2c7d';
    const SENTINEL_NOTE_A = 'SENTINEL_NOTE_ALPHA_do-not-leak';
    const SENTINEL_NOTE_B = 'SENTINEL_NOTE_BRAVO_do-not-leak';
    const SENTINEL_DESC = 'SENTINEL_DESCRIPTION_do-not-leak-1234';
    const SENTINEL_GROUP_ID = 'SENTINEL_GROUP_ID_do-not-leak';
    const subjectUserId = 'SENTINEL_SUBJECT_USER_ID_do-not-leak';

    const event = {
      id: nid('event'),
      title: 'Privacy sweep event',
      description: SENTINEL_DESC,
      side_a: 'A',
      side_b: 'B',
      end_time: Date.now() + ONE_HOUR,
      group_id: SENTINEL_GROUP_ID,
      status: 'active',
      payment_type: 'cash',
      stake_amount: null,
      subject_user_id: subjectUserId,
      notify_subject: false,
    };
    db.seedEvent(event);
    db.seedBet({
      id: nid('bet'),
      event_id: event.id,
      user_id: 'u_a',
      username: SENTINEL_USER_A,
      side: 'A',
      amount: 30,
      note: SENTINEL_NOTE_A,
      is_late: false,
      timestamp: Date.now(),
    });
    db.seedBet({
      id: nid('bet'),
      event_id: event.id,
      user_id: 'u_b',
      username: SENTINEL_USER_B,
      side: 'B',
      amount: 10,
      note: SENTINEL_NOTE_B,
      is_late: false,
      timestamp: Date.now(),
    });

    const forbiddenKeys = ['subject_user_id', 'notify_subject', 'description', 'group_id', 'username', 'bets', 'user_id', 'note'];
    const sentinelSubstrings = [SENTINEL_USER_A, SENTINEL_USER_B, SENTINEL_NOTE_A, SENTINEL_NOTE_B, SENTINEL_DESC, SENTINEL_GROUP_ID, subjectUserId];

    function assertNoLeak(body: any, label: string) {
      const json = JSON.stringify(body);
      for (const s of sentinelSubstrings) {
        assert(!json.includes(s), `${label}: serialized response does not contain sentinel "${s}"`);
      }
      for (const k of forbiddenKeys) {
        assert(!(k in body), `${label}: top-level response object does not have forbidden key "${k}"`);
      }
    }

    // Without a token.
    const rNoToken = await callJSON(previewRoute.GET, `/api/events/preview?id=${event.id}`, { method: 'GET' });
    assert(rNoToken.status === 200, 'no token: 200');
    assert(rNoToken.body.side_a_total === null && rNoToken.body.side_b_total === null, 'no token: totals are null');
    assert(rNoToken.body.side_a_count === 1 && rNoToken.body.side_b_count === 1, 'no token: counts ARE present');
    assert(rNoToken.body.total_bets === 2 && rNoToken.body.total_participants === 2, 'no token: aggregate counts are present');
    assert(
      rNoToken.headers.get('cache-control') === 'public, s-maxage=5, stale-while-revalidate=30',
      'no token: Cache-Control is the public/cacheable variant'
    );
    assertNoLeak(rNoToken.body, 'no token');

    // With a valid token.
    const token = shareLib.createShareToken(event.id);
    const rWithToken = await callJSON(previewRoute.GET, `/api/events/preview?id=${event.id}&t=${encodeURIComponent(token as string)}`, { method: 'GET' });
    assert(rWithToken.status === 200, 'valid token: 200');
    assert(typeof rWithToken.body.side_a_total === 'number' && typeof rWithToken.body.side_b_total === 'number', 'valid token: totals are numbers');
    assert(rWithToken.body.side_a_total === 30 && rWithToken.body.side_b_total === 10, 'valid token: totals are correct');
    assert(rWithToken.headers.get('cache-control') === 'no-store', 'valid token: Cache-Control is no-store');
    assertNoLeak(rWithToken.body, 'valid token');
  });

  // ===========================================================================
  // Group 19 — share token unit tests (lib/imessage-share.ts, real functions)
  // ===========================================================================
  await step('Share tokens: round-trip, cross-event, tamper, unset-secret, shareUrlFor', async () => {
    const tokenA = shareLib.createShareToken('event-A');
    assert(typeof tokenA === 'string' && !!tokenA, 'createShareToken returns a token when the secret is configured');
    assert(shareLib.verifyShareToken('event-A', tokenA) === true, 'token verifies for the event it was minted for');
    assert(shareLib.verifyShareToken('event-B', tokenA) === false, 'a token minted for event A fails verification for event B');

    const tampered = tokenA ? tokenA.slice(0, -1) + (tokenA.slice(-1) === 'a' ? 'b' : 'a') : 'x';
    assert(shareLib.verifyShareToken('event-A', tampered) === false, 'a tampered token fails verification');
    assert(shareLib.verifyShareToken('event-A', null) === false, 'a null token fails verification');
    assert(shareLib.verifyShareToken('event-A', undefined) === false, 'an undefined token fails verification');

    const savedSecret = process.env.IMESSAGE_SHARE_SECRET;
    try {
      delete process.env.IMESSAGE_SHARE_SECRET;
      assert(shareLib.createShareToken('event-A') === null, 'createShareToken returns null when the secret is unset');
      assert(shareLib.verifyShareToken('event-A', tokenA) === false, 'verifyShareToken returns false when the secret is unset');
      assert(shareLib.isShareTokenConfigured() === false, 'isShareTokenConfigured() is false when the secret is unset');
    } finally {
      process.env.IMESSAGE_SHARE_SECRET = savedSecret;
    }
    assert(shareLib.isShareTokenConfigured() === true, 'isShareTokenConfigured() is true again after restoring the secret');

    const urlWithToken = shareLib.shareUrlFor('event-A', tokenA);
    assert(urlWithToken.includes(`t=${encodeURIComponent(tokenA as string)}`), 'shareUrlFor includes the t= param when a token is given');
    const urlNoToken = shareLib.shareUrlFor('event-A', null);
    assert(!urlNoToken.includes('t='), 'shareUrlFor omits the t= param entirely when the token is null');
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${total - failed}/${total} checks passed`);
  if (failed > 0) {
    console.log(`\n  ${failed} FAILURE(S):`);
    for (const f of failureLines) console.log(`    - ${f}`);
  }
  console.log('='.repeat(70));

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
