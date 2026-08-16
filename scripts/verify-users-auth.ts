// Verification harness for the user-directory read boundary.
//
// PROVES: `GET /api/users` with no query params — the whole-platform user
// directory — is never served to an anonymous caller. It used to return every
// row's username / display_name / avatar_url / net_total / streak to anyone
// who asked, which is a free scrape of the entire member list.
//
// It also pins down the two things the fix must NOT break:
//   - `GET /api/users?id=<self>`     still returns the caller's own full row
//   - `GET /api/users?id=<other>`    still returns the redacted public shape
//   - `GET /api/users?username=<u>`  still resolves a username to a public row
//
// WHAT IS REAL AND WHAT IS FAKED
//   Real: app/api/users/route.ts's GET handler, and all of lib/auth.ts —
//         including its three session-resolution paths (mobile bearer token,
//         x-stack-auth header, web cookie) and its fail-closed error handling.
//   Faked: the identity provider itself (`@/lib/stack` is redirected at
//         scripts/testing/stack-auth-stub.ts through a module resolve hook,
//         the same mechanism scripts/verify-groups-auth.ts and
//         scripts/test-auth-consolidation.ts use), plus `@/lib/db`, replaced
//         with an in-memory object by pre-populating `require.cache` at its
//         resolved path.
//
// So the authorization decision under test is executed for real; only the
// third-party IdP and the storage underneath it are stand-ins.
//
// No database, no network, no server. Run:
//   npx tsx scripts/verify-users-auth.ts        (or npm run verify:users-auth)

import { createRequire } from 'node:module';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const nodeRequire = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Stack Auth stub injection — must happen before anything imports lib/auth.
// ---------------------------------------------------------------------------

const STUB_PATH = path.resolve(REPO_ROOT, 'scripts/testing/stack-auth-stub.ts');
if (!existsSync(STUB_PATH)) {
  console.error(`FATAL: cannot find ${STUB_PATH}`);
  process.exit(1);
}
const STUB_URL = pathToFileURL(STUB_PATH).href;

const registerHooks = (nodeModule as any).registerHooks as
  | ((hooks: { resolve?: (...args: any[]) => any }) => void)
  | undefined;
if (typeof registerHooks !== 'function') {
  console.error(`FATAL: Node ${process.versions.node} has no module.registerHooks — this check needs Node 22.15+.`);
  process.exit(1);
}

registerHooks({
  resolve(specifier: string, context: unknown, nextResolve: any) {
    if (specifier === '@/lib/stack') {
      return { url: STUB_URL, format: 'module', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

/**
 * Pre-populate `require.cache` so a CJS `require('@/lib/db')` issued from
 * inside a route file resolves to `exportsObj` instead of compiling the real
 * module (which would reach for @vercel/postgres and a live database).
 */
function seedFakeModule(relPathNoExt: string, exportsObj: any): void {
  const abs = path.resolve(REPO_ROOT, relPathNoExt);
  for (const candidate of [abs, `${abs}.ts`, `${abs}.tsx`, `${abs}.js`]) {
    (nodeRequire.cache as any)[candidate] = { id: candidate, filename: candidate, loaded: true, exports: exportsObj };
  }
}

// ---------------------------------------------------------------------------
// In-memory stand-in for the `users` table lib/db.ts fronts
// ---------------------------------------------------------------------------

type FakeUser = {
  id: string;
  username: string;
  username_selected: boolean;
  net_total: number;
  total_bet: number;
  streak: number;
  email?: string;
  display_name?: string;
  avatar_url?: string;
  auth_methods?: Array<{ type: string; identifier: string }>;
  merged_into?: string | null;
  last_seen_at?: string;
};

class FakeDb {
  private _users = new Map<string, FakeUser>();
  /** Counts every read of the whole directory, so we can prove an anonymous
   *  request is rejected BEFORE the database is touched. */
  getAllCalls = 0;

  seedUser(u: FakeUser): void {
    this._users.set(u.id, { ...u });
  }

  users = {
    get: async (id: string): Promise<FakeUser | null> => {
      const u = this._users.get(id);
      return u ? { ...u } : null;
    },
    getByUsername: async (username: string): Promise<FakeUser | null> => {
      const u = Array.from(this._users.values()).find(x => x.username === username);
      return u ? { ...u } : null;
    },
    getAll: async (): Promise<FakeUser[]> => {
      this.getAllCalls++;
      return Array.from(this._users.values()).map(u => ({ ...u }));
    },
  };
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { NextRequest } = await import('next/server');

  const fakeDb = new FakeDb();

  const ALICE = 'stack-user-alice';
  const BOB = 'stack-user-bob';

  fakeDb.seedUser({
    id: ALICE,
    username: 'alice',
    username_selected: true,
    net_total: 420,
    total_bet: 1000,
    streak: 3,
    email: 'alice@example.com',
    display_name: 'Alice A.',
    avatar_url: 'https://example.com/alice.png',
    auth_methods: [{ type: 'email', identifier: 'alice@example.com' }],
    merged_into: null,
    last_seen_at: '2026-08-01T00:00:00.000Z',
  });
  fakeDb.seedUser({
    id: BOB,
    username: 'bob',
    username_selected: true,
    net_total: -75,
    total_bet: 300,
    streak: 0,
    email: 'bob@example.com',
    display_name: 'Bob B.',
    avatar_url: 'https://example.com/bob.png',
    auth_methods: [{ type: 'oauth', identifier: 'bob@example.com' }],
    merged_into: null,
    last_seen_at: '2026-08-02T00:00:00.000Z',
  });

  seedFakeModule('lib/db', { db: fakeDb });

  const usersRoute: any = await import('@/app/api/users/route');
  const stub: any = await import('@/lib/stack');

  function signInWeb(userId: string | null): void {
    stub.resetSessions();
    if (userId) {
      stub.signInWeb(stub.stackUser({ id: userId, primaryEmail: `${userId}@example.com`, primaryEmailVerified: true }));
    }
  }

  /** Mobile path: hand out a bearer token for this human. */
  function issueToken(token: string, userId: string): void {
    stub.issueAccessToken(token, stub.stackUser({ id: userId, primaryEmail: `${userId}@example.com`, primaryEmailVerified: true }));
  }

  async function callGET(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
    const req = new NextRequest(new Request(`http://localhost:3000${url}`, { method: 'GET', headers }));
    const res = await usersRoute.GET(req);
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  // -------------------------------------------------------------------------
  await step('GET /api/users (no params) — anonymous is rejected', async () => {
    signInWeb(null);
    const before = fakeDb.getAllCalls;

    const res = await callGET('/api/users');
    assert(res.status === 401, `anonymous GET /api/users → 401 (observed ${res.status})`);
    assert(
      res.body?.error === 'Authentication required',
      `401 body is {error:'Authentication required'} (observed ${JSON.stringify(res.body)})`
    );
    assert(!Array.isArray(res.body), 'anonymous GET /api/users returns no array');
    assert(
      fakeDb.getAllCalls === before,
      `auth is checked BEFORE db.users.getAll() (observed ${fakeDb.getAllCalls - before} call(s))`
    );

    const serialized = JSON.stringify(res.body);
    for (const leaked of ['alice', 'bob', 'Alice A.', 'Bob B.', 'avatar', '420', 'streak']) {
      assert(!serialized.includes(leaked), `anonymous 401 body contains no trace of "${leaked}"`);
    }
  });

  await step('GET /api/users (no params) — a forged x-stack-user-id header is inert', async () => {
    signInWeb(null);
    const res = await callGET('/api/users', { 'x-stack-user-id': ALICE });
    assert(res.status === 401, `x-stack-user-id: ${ALICE} on an anonymous request → 401 (observed ${res.status})`);
    assert(!Array.isArray(res.body), 'forged-header request gets no directory');
  });

  await step('GET /api/users (no params) — an expired/unknown bearer token is rejected', async () => {
    signInWeb(null);
    const res = await callGET('/api/users', { authorization: 'Bearer not-a-real-token' });
    assert(res.status === 401, `unknown bearer token → 401 (observed ${res.status})`);
    assert(!Array.isArray(res.body), 'unknown bearer token gets no directory');
  });

  await step('GET /api/users (no params) — a signed-in caller gets the redacted directory', async () => {
    signInWeb(BOB);
    const res = await callGET('/api/users');

    assert(res.status === 200, `signed-in GET /api/users → 200 (observed ${res.status})`);
    assert(Array.isArray(res.body) && res.body.length === 2, `directory lists both users (observed ${res.body?.length})`);

    const alice = (res.body as any[]).find(u => u.id === ALICE);
    assert(!!alice, 'the directory contains alice');
    assert(alice?.username === 'alice', 'directory rows carry username');
    assert(alice?.net_total === 420, 'directory rows carry net_total');
    assert(alice?.streak === 3, 'directory rows carry streak');

    // toPublicUser() still strips identity/contact fields even for a member.
    for (const secret of ['email', 'auth_methods', 'merged_into', 'last_seen_at']) {
      assert(
        (res.body as any[]).every(u => u[secret] === undefined),
        `directory rows never carry "${secret}" (redacted by toPublicUser)`
      );
    }
  });

  await step('GET /api/users (no params) — the mobile bearer-token path also works', async () => {
    stub.resetSessions();
    issueToken('mobile-token-bob', BOB);
    const res = await callGET('/api/users', { authorization: 'Bearer mobile-token-bob' });
    assert(res.status === 200, `bearer-token GET /api/users → 200 (observed ${res.status})`);
    assert(Array.isArray(res.body) && res.body.length === 2, `bearer-token caller gets the directory (observed ${res.body?.length})`);
  });

  // -------------------------------------------------------------------------
  // Regression guards: the fix must not disturb the two lookup branches.
  // -------------------------------------------------------------------------

  await step('GET /api/users?id=<self> — still returns the caller’s own full row', async () => {
    signInWeb(ALICE);
    const res = await callGET(`/api/users?id=${ALICE}`);

    assert(res.status === 200, `?id=<self> → 200 (observed ${res.status})`);
    assert(res.body?.id === ALICE, 'the row returned is the caller’s own');
    assert(res.body?.email === 'alice@example.com', 'a caller sees their OWN email');
    assert(Array.isArray(res.body?.auth_methods), 'a caller sees their OWN auth_methods');
    assert(res.body?.username_selected === true, 'username_selected survives (the sign-in flow reads it)');
  });

  await step('GET /api/users?id=<someone else> — still returns the redacted public shape', async () => {
    signInWeb(ALICE);
    const res = await callGET(`/api/users?id=${BOB}`);

    assert(res.status === 200, `?id=<other> → 200 (observed ${res.status})`);
    assert(res.body?.id === BOB, 'the row returned is the requested user');
    assert(res.body?.username === 'bob', 'the public shape carries username');
    assert(res.body?.email === undefined, 'the public shape strips email');
    assert(res.body?.auth_methods === undefined, 'the public shape strips auth_methods');
    assert(res.body?.last_seen_at === undefined, 'the public shape strips last_seen_at');
  });

  await step('GET /api/users?id=<missing> — still a 404', async () => {
    signInWeb(ALICE);
    const res = await callGET('/api/users?id=stack-user-nobody');
    assert(res.status === 404, `?id=<missing> → 404 (observed ${res.status})`);
  });

  await step('GET /api/users?username= — still resolves to the public shape', async () => {
    signInWeb(BOB);
    const found = await callGET('/api/users?username=alice');
    assert(found.status === 200, `?username=alice → 200 (observed ${found.status})`);
    assert(found.body?.id === ALICE, 'the username lookup resolves to the right row');
    assert(found.body?.email === undefined, 'the username lookup strips email');

    const missing = await callGET('/api/users?username=nobody');
    assert(missing.status === 404, `?username=<missing> → 404 (observed ${missing.status})`);
  });

  await step('Static assertions on the shipped source', async () => {
    const src = readFileSync(path.resolve(REPO_ROOT, 'app/api/users/route.ts'), 'utf8');

    function handlerBody(source: string, name: string): string {
      const start = source.indexOf(`export async function ${name}(`);
      if (start === -1) return '';
      const next = source.indexOf('\nexport ', start + 1);
      return next === -1 ? source.slice(start) : source.slice(start, next);
    }

    const get = handlerBody(src, 'GET');
    assert(get.length > 0, 'app/api/users/route.ts exports a GET handler');
    assert(
      /require(Auth|AuthUser)\(/.test(get) || /getAuthenticatedUserId\(/.test(get),
      'app/api/users/route.ts GET resolves the caller through lib/auth'
    );

    // The gate has to sit before the bulk read, not after it.
    const gateAt = get.search(/require(Auth|AuthUser)\(request\)/);
    const getAllAt = get.indexOf('db.users.getAll()');
    assert(getAllAt !== -1, 'GET still has the db.users.getAll() directory branch');
    assert(gateAt !== -1 && gateAt < getAllAt, 'the auth gate precedes db.users.getAll() in source order');

    assert(!src.includes('x-stack-user-id'), 'app/api/users/route.ts never reads the forgeable x-stack-user-id header');
    assert(
      !/searchParams\.get\(['"](userId|authUserId)['"]\)/.test(src),
      'app/api/users/route.ts does not take a caller identity from the query string'
    );
  });

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
