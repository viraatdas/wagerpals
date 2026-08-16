// Integration test for multi-auth consolidation — "one human, one account".
//
// WHAT IT COVERS
//   The whole identity path, end to end: an HTTP request hits the real
//   app/api/users route handlers, lib/auth resolves the session through all
//   three of its paths (web cookie, mobile `Authorization: Bearer`,
//   x-stack-auth header), lib/sync-user decides what the row should look
//   like, lib/db writes it, and a real Postgres enforces the unique indexes
//   (idx_users_email_lower in particular). The legacy dedupe tool
//   (scripts/merge-duplicate-users.ts) is then run as a subprocess against
//   the same database.
//
//   The ONLY faked component is Stack Auth itself — the third-party identity
//   provider — which is replaced by scripts/testing/stack-auth-stub.ts via a
//   module-resolution hook. Everything below the IdP is the real code.
//
// SAFETY
//   The test NEVER touches your application database. It CREATEs a throwaway
//   database (wagerpals_authtest_*) on the same server, points POSTGRES_URL
//   at it, applies lib/schema.sql, refuses to run a single statement unless
//   `SELECT current_database()` confirms it is on the throwaway, and DROPs it
//   again at the end (even when tests fail).
//
// USAGE
//   npm run test:auth                 # create temp db, run, drop temp db
//   npm run test:auth -- --keep-db    # leave the temp db behind for debugging
//
//   Requires POSTGRES_URL in .env.local. Set TEST_ADMIN_POSTGRES_URL to run
//   the whole thing against a different (e.g. local) Postgres server.
import { config as loadEnv } from 'dotenv';
import { resolve as resolvePath } from 'path';
import { existsSync, readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import * as nodeModule from 'module';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { createPool } from '@vercel/postgres';
import type { NextRequest } from 'next/server';

type Pool = ReturnType<typeof createPool>;

import {
  stackUser,
  signInWeb,
  signOutWeb,
  issueAccessToken,
  resetSessions,
  type StubStackUser,
} from './testing/stack-auth-stub';

loadEnv({ path: resolvePath(process.cwd(), '.env.local') });

const KEEP_DB = process.argv.includes('--keep-db');

// ---------------------------------------------------------------------------
// Stack Auth stub injection
// ---------------------------------------------------------------------------
// lib/auth.ts reaches the identity provider through a single lazy
// `await import('@/lib/stack')`. Redirect that one specifier at the stub
// before anything imports lib/auth, and the rest of the stack stays real.

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
  console.error(`❌ Node ${process.versions.node} has no module.registerHooks — this test needs Node 22.15+.`);
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

// ---------------------------------------------------------------------------
// Throwaway database
// ---------------------------------------------------------------------------

const TEMP_DB_PREFIX = 'wagerpals_authtest_';
const TEMP_DB_NAME = `${TEMP_DB_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function databaseUrl(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function section(title: string): void {
  console.log(`\n${title}`);
  console.log('─'.repeat(title.length));
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failures.push(name);
    console.log(`  ❌ ${name}`);
    console.log(`       ${err?.message ?? err}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const adminUrl = process.env.TEST_ADMIN_POSTGRES_URL || process.env.POSTGRES_URL;
  if (!adminUrl) {
    console.error('❌ No database configured: set POSTGRES_URL in .env.local (or TEST_ADMIN_POSTGRES_URL).');
    process.exit(1);
  }

  console.log('🔐 Multi-auth consolidation integration test');
  console.log(`   throwaway database: ${TEMP_DB_NAME}`);

  const adminPool = createPool({ connectionString: adminUrl });
  let testPool: Pool | null = null;
  let created = false;

  try {
    await adminPool.query(`CREATE DATABASE ${TEMP_DB_NAME}`);
    created = true;
    console.log('   created ✓');

    const testUrl = databaseUrl(adminUrl, TEMP_DB_NAME);
    // Everything the app reads for its connection now points at the throwaway
    // database — including the subprocess we spawn for the merge tool.
    process.env.POSTGRES_URL = testUrl;
    process.env.POSTGRES_URL_NON_POOLING = testUrl;
    process.env.POSTGRES_PRISMA_URL = testUrl;

    testPool = createPool({ connectionString: testUrl });
    await applySchema(testPool);

    await runSuite(testUrl);
  } finally {
    if (testPool) await testPool.end().catch(() => undefined);
    // lib/db shares @vercel/postgres' default pool; close it or the DROP
    // below sees an open connection.
    const { db: defaultPool } = await import('@vercel/postgres');
    await defaultPool.end().catch(() => undefined);

    if (created && !KEEP_DB) {
      assert(TEMP_DB_NAME.startsWith(TEMP_DB_PREFIX), 'refusing to drop a database that is not ours');
      try {
        await adminPool.query(`DROP DATABASE ${TEMP_DB_NAME} WITH (FORCE)`);
        console.log(`\n🧹 dropped throwaway database ${TEMP_DB_NAME}`);
      } catch (err: any) {
        console.error(`\n⚠️  Could not drop ${TEMP_DB_NAME}: ${err?.message ?? err}`);
        console.error('   Drop it by hand once no connections remain.');
      }
    } else if (created) {
      console.log(`\n📌 --keep-db: throwaway database ${TEMP_DB_NAME} left in place`);
    }
    await adminPool.end().catch(() => undefined);
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`❌ ${failures.length} failing / ${passed + failures.length} total`);
    for (const name of failures) console.error(`   • ${name}`);
    console.error('\n(The first failure is usually the root cause — later journeys build on earlier state.)');
    process.exit(1);
  }
  console.log(`🎉 All ${passed} checks passed.`);
  process.exit(0);
}

async function applySchema(pool: Pool): Promise<void> {
  const schema = readFileSync(resolvePath(process.cwd(), 'lib/schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query(schema);
  } finally {
    client.release();
  }
  console.log('   schema applied ✓');
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

async function runSuite(testUrl: string): Promise<void> {
  // Imported only now, so they bind to the throwaway database.
  const { sql } = await import('@vercel/postgres');
  const { db } = await import('@/lib/db');
  const usersRoute = await import('@/app/api/users/route');
  const { derivePlaceholderUsername } = await import('@/lib/sync-user');
  const { NextRequest: NextRequestCtor } = await import('next/server');

  // Hard stop: never run the suite against anything but the throwaway.
  const where = await sql`SELECT current_database() AS db`;
  const connectedTo = where.rows[0]?.db;
  if (connectedTo !== TEMP_DB_NAME) {
    throw new Error(`Refusing to run: lib/db is connected to "${connectedTo}", not the throwaway "${TEMP_DB_NAME}"`);
  }
  const preexisting = await sql`SELECT COUNT(*)::int AS c FROM users`;
  if (preexisting.rows[0].c !== 0) {
    throw new Error(`Refusing to run: "${connectedTo}" already has ${preexisting.rows[0].c} user row(s)`);
  }

  // ---- request helpers ----------------------------------------------------

  const URL_BASE = 'http://localhost:3000/api/users';

  /** A same-origin browser fetch: the Stack Auth session cookie is implicit. */
  function webRequest(body?: unknown, path = ''): NextRequest {
    return new NextRequestCtor(`${URL_BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** The mobile app: bearer access token, exactly as mobile/src/services/api.ts sends it. */
  function mobileRequest(token: string, body?: unknown, path = ''): NextRequest {
    return new NextRequestCtor(`${URL_BASE}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-stack-refresh-token': `refresh-${token}`,
      },
    });
  }

  async function post(request: NextRequest): Promise<{ status: number; body: any }> {
    const response = await usersRoute.POST(request);
    return { status: response.status, body: await response.json() };
  }

  async function get(request: NextRequest): Promise<{ status: number; body: any }> {
    const response = await usersRoute.GET(request);
    return { status: response.status, body: await response.json() };
  }

  async function liveUserCount(): Promise<number> {
    const res = await sql`SELECT COUNT(*)::int AS c FROM users WHERE merged_into IS NULL`;
    return res.rows[0].c;
  }

  async function rowsWithEmail(email: string): Promise<number> {
    const res = await sql`SELECT COUNT(*)::int AS c FROM users WHERE LOWER(email) = LOWER(${email})`;
    return res.rows[0].c;
  }

  function methodFor(user: any, provider: string): any | undefined {
    return (user.auth_methods ?? []).find((m: any) => m.provider === provider);
  }

  // ---- fixtures -----------------------------------------------------------

  const tag = Math.random().toString(36).slice(2, 8);
  const adaEmail = `ada.${tag}@example.test`;
  const adaStackId = randomUUID();
  const adaMobileToken = `access-ada-${tag}`;

  let adaPasswordLinkedAt = '';

  // =========================================================================
  section('1. Email + password sign-up (web)');
  // =========================================================================

  const adaPasswordOnly: StubStackUser = stackUser({
    id: adaStackId,
    primaryEmail: adaEmail,
    primaryEmailVerified: true,
    displayName: 'Ada Lovelace',
    hasPassword: true,
  });

  await test('POST /api/users creates exactly one row for a new human', async () => {
    signInWeb(adaPasswordOnly);
    // The web app's first-load sync (app/page.tsx) posts id + a suggested
    // username but deliberately omits username_selected.
    const res = await post(webRequest({ id: adaStackId, username: 'Ada Lovelace' }));
    assertEqual(res.status, 200, 'sync should succeed');
    assertEqual(res.body.id, adaStackId, 'row id comes from the session');
    assertEqual(await liveUserCount(), 1, 'exactly one user row');
  });

  await test('the row is seeded from the verified Stack Auth profile', async () => {
    const user = await db.users.get(adaStackId);
    assert(user, 'user row should exist');
    assertEqual(user!.username, 'adalovelace', 'username derived from the display name');
    assertEqual(user!.email, adaEmail, 'verified email is stored');
    assertEqual(user!.display_name, 'Ada Lovelace', 'display name is stored');
    assert(user!.last_seen_at, 'last_seen_at is stamped');
  });

  await test('a username the human never chose is NOT marked as selected', async () => {
    // Regression guard: db.users.create coerces username_selected to true, so
    // syncUser has to correct it — otherwise the username modal never shows.
    const user = await db.users.get(adaStackId);
    assertEqual(user!.username_selected, false, 'username_selected must stay false');
  });

  await test('auth_methods records the password login against the verified email', async () => {
    const user = await db.users.get(adaStackId);
    assertEqual((user!.auth_methods ?? []).length, 1, 'one auth method so far');
    const password = methodFor(user, 'password');
    assert(password, 'password method recorded');
    assertEqual(password.identifier, adaEmail, 'identified by the verified email');
    assert(password.linked_at, 'linked_at is stamped');
    adaPasswordLinkedAt = password.linked_at;
  });

  // =========================================================================
  section('2. Same human signs in with Google (linked Stack account)');
  // =========================================================================

  const adaWithGoogle: StubStackUser = stackUser({
    ...adaPasswordOnly,
    oauthProviders: [{ id: 'google' }],
    profileImageUrl: 'https://example.test/ada.png',
  });

  await test('Google sign-in from the mobile app reuses the same row', async () => {
    resetSessions();
    issueAccessToken(adaMobileToken, adaWithGoogle);
    const res = await post(mobileRequest(adaMobileToken, {}));
    assertEqual(res.status, 200, 'mobile sync should succeed');
    assertEqual(res.body.id, adaStackId, 'same account, not a second one');
    assertEqual(await liveUserCount(), 1, 'still exactly one user row');
  });

  await test('both providers are now linked to the one account', async () => {
    const user = await db.users.get(adaStackId);
    assertEqual((user!.auth_methods ?? []).length, 2, 'password + google');
    assertEqual(methodFor(user, 'google')?.identifier, adaEmail, 'google identified by the same email');
    assertEqual(methodFor(user, 'password')?.identifier, adaEmail, 'password method survives');
  });

  await test('re-linking does not restamp an existing method', async () => {
    const user = await db.users.get(adaStackId);
    assertEqual(methodFor(user, 'password')?.linked_at, adaPasswordLinkedAt, 'original linked_at preserved');
  });

  await test('signing in a second way never renames the account', async () => {
    const user = await db.users.get(adaStackId);
    assertEqual(user!.username, 'adalovelace', 'username untouched by a sync');
    assertEqual(user!.email, adaEmail, 'email untouched by a sync');
    assertEqual(user!.avatar_url, 'https://example.test/ada.png', 'new profile fields are picked up');
  });

  // =========================================================================
  section('3. Choosing a username');
  // =========================================================================

  await test('the username modal claims a username and marks it chosen', async () => {
    signInWeb(adaWithGoogle);
    const res = await post(webRequest({ id: adaStackId, username: 'Ada_L', username_selected: true }));
    assertEqual(res.status, 200, 'should succeed');
    assertEqual(res.body.username, 'ada_l', 'username is normalized to lower case');
    assertEqual(res.body.username_selected, true, 'marked as chosen');
  });

  await test('re-submitting your own username is not a conflict', async () => {
    const res = await post(webRequest({ id: adaStackId, username: 'ada_l', username_selected: true }));
    assertEqual(res.status, 200, 'a human may re-confirm their own username');
  });

  await test('an invalid username is rejected with 400', async () => {
    const res = await post(webRequest({ id: adaStackId, username: 'not a username!', username_selected: true }));
    assertEqual(res.status, 400, 'validation failure');
    assert(String(res.body.error).length > 0, 'an error message is returned');
    const user = await db.users.get(adaStackId);
    assertEqual(user!.username, 'ada_l', 'the stored username is unchanged');
  });

  // =========================================================================
  section('4. Same email, a Stack account that was never linked');
  // =========================================================================

  const dupStackId = randomUUID();
  const dupGoogleOnly: StubStackUser = stackUser({
    id: dupStackId,
    primaryEmail: adaEmail,
    primaryEmailVerified: true,
    displayName: 'Ada L',
    oauthProviders: [{ id: 'google' }],
  });

  await test('a second Stack account on the same email does not steal it', async () => {
    resetSessions();
    signInWeb(dupGoogleOnly);
    const res = await post(webRequest({ id: dupStackId }));
    assertEqual(res.status, 200, 'sign-in still works');
    assertEqual(res.body.id, dupStackId, 'a row exists for the new Stack account');

    const dup = await db.users.get(dupStackId);
    assertEqual(dup!.email, undefined, 'the email is NOT written onto the second row');
    const ada = await db.users.get(adaStackId);
    assertEqual(ada!.email, adaEmail, 'the original row keeps the email');
    assertEqual(await rowsWithEmail(adaEmail), 1, 'exactly one row owns the email');
  });

  await test('the email still resolves to the original human', async () => {
    const owner = await db.users.getByEmail(adaEmail);
    assertEqual(owner?.id, adaStackId, 'getByEmail returns the original account');
  });

  await test('Postgres itself refuses a duplicate email (idx_users_email_lower)', async () => {
    let rejected = false;
    try {
      await sql`UPDATE users SET email = ${adaEmail.toUpperCase()} WHERE id = ${dupStackId}`;
    } catch (err: any) {
      rejected = /unique|duplicate key/i.test(String(err?.message));
    }
    assert(rejected, 'the unique index on LOWER(email) must reject the write');
    assertEqual(await rowsWithEmail(adaEmail), 1, 'still exactly one owner');
  });

  await test('the duplicate keeps the email in auth_methods so it can be merged later', async () => {
    const dup = await db.users.get(dupStackId);
    assertEqual(methodFor(dup, 'google')?.identifier, adaEmail, 'google method carries the email');
  });

  // =========================================================================
  section('5. Authentication guards');
  // =========================================================================

  await test('an unauthenticated POST is rejected with 401', async () => {
    resetSessions();
    const before = await liveUserCount();
    const res = await post(webRequest({ id: randomUUID(), username: 'sneaky', username_selected: true }));
    assertEqual(res.status, 401, 'no session, no account');
    assertEqual(await liveUserCount(), before, 'no row was created');
  });

  await test('an unknown bearer token is rejected with 401', async () => {
    const res = await post(mobileRequest('not-a-real-token', {}));
    assertEqual(res.status, 401, 'expired/unknown tokens must not authenticate');
  });

  await test('posting someone else’s id is rejected with 403', async () => {
    signInWeb(adaWithGoogle);
    const res = await post(webRequest({ id: dupStackId, username: 'takeover', username_selected: true }));
    assertEqual(res.status, 403, 'impersonation is blocked');
    const dup = await db.users.get(dupStackId);
    assert(dup!.username !== 'takeover', 'the other account is untouched');
  });

  await test('the row always comes from the session, never from the body', async () => {
    // No `id` in the body at all: the session still decides which row is written.
    resetSessions();
    issueAccessToken(adaMobileToken, adaWithGoogle);
    const res = await post(mobileRequest(adaMobileToken, {}));
    assertEqual(res.body.id, adaStackId, 'session identity wins');
  });

  // =========================================================================
  section('6. Identity fields are not leaked to other callers');
  // =========================================================================

  await test('a human reading their own row sees email and auth_methods', async () => {
    resetSessions();
    issueAccessToken(adaMobileToken, adaWithGoogle);
    const res = await get(mobileRequest(adaMobileToken, undefined, `?id=${adaStackId}`));
    assertEqual(res.status, 200, 'should succeed');
    assertEqual(res.body.email, adaEmail, 'own email is visible');
    assert(Array.isArray(res.body.auth_methods), 'own auth methods are visible');
  });

  await test('another signed-in human sees only the public shape', async () => {
    resetSessions();
    signInWeb(dupGoogleOnly);
    const res = await get(webRequest(undefined, `?id=${adaStackId}`));
    assertEqual(res.status, 200, 'should succeed');
    assertEqual(res.body.email, undefined, 'email is stripped');
    assertEqual(res.body.auth_methods, undefined, 'auth methods are stripped');
    assertEqual(res.body.last_seen_at, undefined, 'last_seen_at is stripped');
    assertEqual(res.body.username, 'ada_l', 'public fields still come through');
  });

  await test('an anonymous caller sees only the public shape', async () => {
    resetSessions();
    const byId = await get(webRequest(undefined, `?id=${adaStackId}`));
    assertEqual(byId.body.email, undefined, 'email is stripped for ?id=');
    const byUsername = await get(webRequest(undefined, '?username=ada_l'));
    assertEqual(byUsername.body.email, undefined, 'email is stripped for ?username=');
    const list = await get(webRequest(undefined, ''));
    assert(Array.isArray(list.body), 'the list endpoint returns an array');
    assert(
      list.body.every((u: any) => u.email === undefined && u.auth_methods === undefined),
      'no row in the list leaks identity fields'
    );
  });

  // =========================================================================
  section('7. Unverified email never claims an identity');
  // =========================================================================

  const carolStackId = randomUUID();
  const carolEmail = `carol.${tag}@example.test`;

  await test('an unverified email is not written to the row', async () => {
    resetSessions();
    signInWeb(
      stackUser({
        id: carolStackId,
        primaryEmail: carolEmail,
        primaryEmailVerified: false,
        displayName: 'Carol Unverified',
        hasPassword: true,
      })
    );
    const res = await post(webRequest({ id: carolStackId }));
    assertEqual(res.status, 200, 'sign-up still works');
    const user = await db.users.get(carolStackId);
    assertEqual(user!.email, undefined, 'no email until it is verified');
    assertEqual(methodFor(user, 'password')?.identifier, null, 'auth method has no email either');
  });

  await test('verifying the email later fills it in', async () => {
    resetSessions();
    signInWeb(
      stackUser({
        id: carolStackId,
        primaryEmail: carolEmail,
        primaryEmailVerified: true,
        displayName: 'Carol Unverified',
        hasPassword: true,
      })
    );
    const res = await post(webRequest({ id: carolStackId }));
    assertEqual(res.status, 200, 'sync should succeed');
    const user = await db.users.get(carolStackId);
    assertEqual(user!.email, carolEmail, 'the verified email is now stored');
    assert(
      (user!.auth_methods ?? []).some((m) => m.provider === 'password' && m.identifier === carolEmail),
      'the password method is now tied to the verified email'
    );
  });

  // =========================================================================
  section('8. Username fallbacks');
  // =========================================================================

  await test('a colliding derived username falls back to a placeholder', async () => {
    const twinId = randomUUID();
    resetSessions();
    signInWeb(
      stackUser({
        id: twinId,
        primaryEmail: `twin.${tag}@example.test`,
        primaryEmailVerified: true,
        displayName: 'Carol Unverified', // derives to a username Carol already holds
        oauthProviders: [{ id: 'apple' }],
      })
    );
    const res = await post(webRequest({ id: twinId }));
    assertEqual(res.status, 200, 'sign-up should not fail on a username collision');
    assertEqual(res.body.username, derivePlaceholderUsername(twinId), 'deterministic placeholder username');
    assert(res.body.username.length <= 20, 'placeholder fits the username rules');
    assertEqual(methodFor(res.body, 'apple')?.identifier, `twin.${tag}@example.test`, 'apple login recorded');
  });

  await test('two devices syncing at once still create only one account', async () => {
    const raceId = randomUUID();
    const raceToken = `access-race-${tag}`;
    const racer = stackUser({
      id: raceId,
      primaryEmail: `race.${tag}@example.test`,
      primaryEmailVerified: true,
      displayName: 'Race Condition',
      hasPassword: true,
      oauthProviders: [{ id: 'google' }],
    });
    resetSessions();
    signInWeb(racer);
    issueAccessToken(raceToken, racer);

    const [web, mobile] = await Promise.all([
      post(webRequest({ id: raceId })),
      post(mobileRequest(raceToken, {})),
    ]);
    assertEqual(web.status, 200, 'web sync survives the race');
    assertEqual(mobile.status, 200, 'mobile sync survives the race');

    const rows = await sql`SELECT COUNT(*)::int AS c FROM users WHERE id = ${raceId}`;
    assertEqual(rows.rows[0].c, 1, 'exactly one row for the racing human');
  });

  // =========================================================================
  section('9. Merging accounts that were already duplicated');
  // =========================================================================

  await test('legacy cross-references are seeded onto both rows', async () => {
    await seedDuplicateActivity(sql, adaStackId, dupStackId);
    const bets = await sql`SELECT COUNT(*)::int AS c FROM bets WHERE user_id = ${dupStackId}`;
    assertEqual(bets.rows[0].c, 1, 'the duplicate has a bet to move');
  });

  await test('a dry run reports the duplicate group and writes nothing', async () => {
    const before = await liveUserCount();
    const run = runMergeTool([], testUrl);
    assertEqual(run.status, 0, `dry run should exit 0:\n${run.output}`);
    assert(run.output.includes('DRY RUN'), 'dry run announces itself');
    assert(run.output.includes(dupStackId), 'the duplicate row is listed');
    assert(run.output.includes(adaEmail), 'the shared email identifies the group');
    assertEqual(await liveUserCount(), before, 'no rows were merged');
    assert(await db.users.get(dupStackId), 'the duplicate row still exists');
  });

  await test('--apply consolidates the duplicate onto the canonical row', async () => {
    const before = await liveUserCount();
    const run = runMergeTool(['--apply'], testUrl);
    assertEqual(run.status, 0, `apply should exit 0:\n${run.output}`);
    assertEqual(await liveUserCount(), before - 1, 'one row fewer');
    assertEqual(await db.users.get(dupStackId), null, 'the duplicate row is gone');
    const ada = await db.users.get(adaStackId);
    assert(ada, 'the canonical row survives');
    assertEqual(ada!.username, 'ada_l', 'the chosen username wins');
    assertEqual(ada!.email, adaEmail, 'the canonical row keeps the email');
  });

  await test('everything the duplicate owned now belongs to the canonical row', async () => {
    const bets = await sql`SELECT user_id, username FROM bets ORDER BY id`;
    assert(
      bets.rows.every((r) => r.user_id === adaStackId && r.username === 'ada_l'),
      'bets are re-pointed and re-labelled'
    );
    const orphaned = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM comments WHERE user_id = ${dupStackId}) AS comments,
        (SELECT COUNT(*)::int FROM activities WHERE user_id = ${dupStackId}) AS activities,
        (SELECT COUNT(*)::int FROM group_members WHERE user_id = ${dupStackId}) AS memberships,
        (SELECT COUNT(*)::int FROM wallets WHERE user_id = ${dupStackId}) AS wallets,
        (SELECT COUNT(*)::int FROM notification_preferences WHERE user_id = ${dupStackId}) AS prefs,
        (SELECT COUNT(*)::int FROM push_subscriptions WHERE user_id = ${dupStackId}) AS push
    `;
    const counts = orphaned.rows[0];
    for (const [table, count] of Object.entries(counts)) {
      assertEqual(count, 0, `no ${table} left pointing at the duplicate`);
    }
    const membership = await sql`SELECT role, status FROM group_members WHERE user_id = ${adaStackId}`;
    assertEqual(membership.rows.length, 1, 'the two memberships collapsed into one');
    assertEqual(membership.rows[0].role, 'admin', 'the stronger role is kept');
  });

  await test('balances and stats are summed, not lost', async () => {
    const wallet = await sql`SELECT balance FROM wallets WHERE user_id = ${adaStackId}`;
    assertEqual(parseFloat(wallet.rows[0].balance), 15, 'wallet balances are added up');
    const ada = await db.users.get(adaStackId);
    assertEqual(ada!.net_total, 7, 'net_total is summed');
    assertEqual(ada!.total_bet, 30, 'total_bet is summed');
    assertEqual(ada!.streak, 4, 'the better streak is kept');
  });

  await test('the merged account carries every auth method', async () => {
    const ada = await db.users.get(adaStackId);
    const providers = (ada!.auth_methods ?? []).map((m) => m.provider).sort();
    assert(providers.includes('password'), 'password login survives the merge');
    assert(providers.includes('google'), 'google login survives the merge');
    assertEqual(await rowsWithEmail(adaEmail), 1, 'still exactly one row owns the email');
  });

  await test('re-running the merge is a no-op', async () => {
    const run = runMergeTool(['--apply'], testUrl);
    assertEqual(run.status, 0, `second apply should exit 0:\n${run.output}`);
    assert(run.output.includes('No duplicate identity groups found'), 'nothing left to merge');
  });

  // =========================================================================
  section('10. Tombstoned accounts');
  // =========================================================================

  await test('a tombstone is hidden from listings but still resolvable by id', async () => {
    const tombstoneId = randomUUID();
    await sql`
      INSERT INTO users (id, username, username_selected, net_total, total_bet, streak, auth_methods, merged_into)
      VALUES (${tombstoneId}, ${'ghost_' + tag}, FALSE, 0, 0, 0, '[]'::jsonb, ${adaStackId})
    `;

    const all = await db.users.getAll();
    assert(!all.some((u) => u.id === tombstoneId), 'getAll skips tombstones');
    assert(all.some((u) => u.id === adaStackId), 'live rows are still listed');

    const direct = await db.users.get(tombstoneId);
    assertEqual(direct?.merged_into, adaStackId, 'the tombstone points at the surviving account');

    resetSessions();
    const listed = await get(webRequest(undefined, ''));
    assert(!listed.body.some((u: any) => u.id === tombstoneId), 'the API list skips tombstones too');
  });
}

// ---------------------------------------------------------------------------
// Fixtures + subprocess helpers
// ---------------------------------------------------------------------------

/**
 * Give both halves of the duplicated identity the kind of history a real
 * account accumulates, so the merge has something to move: a shared group
 * (both members, the duplicate is the admin), an event, a bet each, wallets,
 * a comment, an activity row, notification preferences and a push token.
 */
async function seedDuplicateActivity(sql: any, canonicalId: string, duplicateId: string): Promise<void> {
  const groupId = `grp_${randomUUID().slice(0, 8)}`;
  const eventId = `evt_${randomUUID().slice(0, 8)}`;

  await sql`UPDATE users SET net_total = 3, total_bet = 10, streak = 4 WHERE id = ${canonicalId}`;
  await sql`UPDATE users SET net_total = 4, total_bet = 20, streak = 2 WHERE id = ${duplicateId}`;

  await sql`INSERT INTO groups (id, name, created_by) VALUES (${groupId}, 'Legacy Group', ${canonicalId})`;
  await sql`INSERT INTO group_members (group_id, user_id, role, status) VALUES (${groupId}, ${canonicalId}, 'member', 'active')`;
  await sql`INSERT INTO group_members (group_id, user_id, role, status) VALUES (${groupId}, ${duplicateId}, 'admin', 'active')`;

  await sql`
    INSERT INTO events (id, title, side_a, side_b, end_time, group_id)
    VALUES (${eventId}, 'Who pays for dinner?', 'Ada', 'Not Ada', ${Date.now() + 86_400_000}, ${groupId})
  `;
  await sql`
    INSERT INTO bets (id, event_id, user_id, username, side, amount, timestamp)
    VALUES (${`bet_${randomUUID().slice(0, 8)}`}, ${eventId}, ${duplicateId}, 'ada l', 'Ada', 20, ${Date.now()})
  `;
  await sql`
    INSERT INTO comments (id, event_id, user_id, username, content, timestamp)
    VALUES (${`cmt_${randomUUID().slice(0, 8)}`}, ${eventId}, ${duplicateId}, 'ada l', 'easy money', ${Date.now()})
  `;
  await sql`
    INSERT INTO activities (type, event_id, event_title, user_id, username, timestamp)
    VALUES ('bet', ${eventId}, 'Who pays for dinner?', ${duplicateId}, 'ada l', ${Date.now()})
  `;
  await sql`INSERT INTO wallets (user_id, balance, currency) VALUES (${canonicalId}, 10, 'usd')`;
  await sql`INSERT INTO wallets (user_id, balance, currency) VALUES (${duplicateId}, 5, 'usd')`;
  await sql`INSERT INTO notification_preferences (user_id, push_enabled) VALUES (${duplicateId}, TRUE)`;
  await sql`
    INSERT INTO push_subscriptions (user_id, endpoint, expo_token, platform)
    VALUES (${duplicateId}, ${`https://push.example.test/${randomUUID()}`}, 'ExponentPushToken[legacy]', 'ios')
  `;
  await sql`INSERT INTO event_notification_mutes (event_id, user_id) VALUES (${eventId}, ${duplicateId})`;
}

/** Run scripts/merge-duplicate-users.ts against the throwaway database. */
function runMergeTool(args: string[], testUrl: string): { status: number; output: string } {
  const result = spawnSync('npx', ['tsx', 'scripts/merge-duplicate-users.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 180_000,
    env: {
      ...process.env,
      // dotenv does not override existing variables, so .env.local cannot
      // point the subprocess back at the real database.
      POSTGRES_URL: testUrl,
      POSTGRES_URL_NON_POOLING: testUrl,
    },
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

main().catch((err) => {
  console.error('\n❌ Integration test crashed:', err?.stack ?? err?.message ?? err);
  process.exit(1);
});
