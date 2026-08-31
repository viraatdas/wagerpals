// Verification harness for the activity-feed read boundary.
//
// PROVES: `GET /api/activity?userId=` is never served to an anonymous caller,
// and never returns anybody's feed but the caller's own.
//
// This was a live disclosure. The handler took `userId` straight off the query
// string with no auth of any kind, and `db.activities.getByUserGroups` returns
// every activity across every group that user belongs to — INCLUDING private
// ones — with the group name, the wager title and the comment body on each
// row. User ids are not secret: an anonymous `GET /api/users?username=<u>`
// hands one out. So the whole chain
//
//     /api/users?username=victim   ->  their user id
//     /api/activity?userId=<id>    ->  the private groups they are in,
//                                      the wagers inside them, and the
//                                      comment text on those wagers
//
// ran with no credentials at all. It was found by driving production with a
// real signed-in session (two throwaway mailboxes) and then re-issuing the
// same read with the Authorization header removed.
//
// CLAUDE.md §8 already names this exact class of bug, under "Group membership
// is the read boundary": *"Never re-add a code path where a query param names
// whose data to return — that's the same class of bug as the x-stack-user-id
// header."* This file is the regression test that keeps it from coming back.
//
// It also pins the response's cache header. The route used to answer
// `Cache-Control: public, s-maxage=10`, which invites a shared/CDN cache to
// hand one user's feed to the next caller. Per-caller data must be `private`.
//
// WHAT IS REAL AND WHAT IS FAKED
//   Real: app/api/activity/route.ts's GET handler and all of lib/auth.ts —
//         including its three session-resolution paths (mobile bearer token,
//         x-stack-auth header, web cookie) and its fail-closed error handling.
//   Faked: the identity provider itself (`@/lib/stack` redirected to
//         scripts/testing/stack-auth-stub.ts via a module resolve hook — the
//         same mechanism verify-users-auth.ts and verify-groups-auth.ts use),
//         plus `@/lib/db` and `@/lib/push`, replaced with in-memory objects by
//         pre-populating `require.cache`.
//
// No database, no network, no server. Run:
//   npx tsx scripts/verify-activity-auth.ts     (or npm run verify:activity-auth)

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

function seedFakeModule(relPathNoExt: string, exportsObj: any): void {
  const abs = path.resolve(REPO_ROOT, relPathNoExt);
  for (const candidate of [abs, `${abs}.ts`, `${abs}.tsx`, `${abs}.js`]) {
    (nodeRequire.cache as any)[candidate] = { id: candidate, filename: candidate, loaded: true, exports: exportsObj };
  }
}

// ---------------------------------------------------------------------------
// In-memory stand-in for the activities table
// ---------------------------------------------------------------------------

type FakeActivity = {
  type: string;
  event_id: string;
  event_title: string;
  group_id: string;
  group_name: string;
  user_id: string;
  username: string;
  note?: string | null;
};

class FakeDb {
  /** Every read of a feed, so we can prove auth runs BEFORE the database. */
  getByUserGroupsCalls = 0;
  lastRequestedUserId: string | null = null;

  private _feeds = new Map<string, FakeActivity[]>();

  seedFeed(userId: string, rows: FakeActivity[]): void {
    this._feeds.set(userId, rows);
  }

  activities = {
    getByUserGroups: async (userId: string, _limit: number, _offset: number): Promise<FakeActivity[]> => {
      this.getByUserGroupsCalls++;
      this.lastRequestedUserId = userId;
      return (this._feeds.get(userId) ?? []).map(r => ({ ...r }));
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

  // Alice's feed is the sensitive payload: a PRIVATE group's name, the wager
  // inside it, and the text of a comment on that wager.
  fakeDb.seedFeed(ALICE, [
    {
      type: 'comment',
      event_id: 'evt-1',
      event_title: 'Who pays for dinner Friday',
      group_id: '686668',
      group_name: 'Alice private group',
      user_id: ALICE,
      username: 'alice',
      note: 'a private comment nobody outside the group should read',
    },
    {
      type: 'event_created',
      event_id: 'evt-1',
      event_title: 'Who pays for dinner Friday',
      group_id: '686668',
      group_name: 'Alice private group',
      user_id: ALICE,
      username: 'alice',
      note: null,
    },
  ]);
  fakeDb.seedFeed(BOB, [
    {
      type: 'event_created',
      event_id: 'evt-2',
      event_title: "Bob's own wager",
      group_id: '999111',
      group_name: 'Bob private group',
      user_id: BOB,
      username: 'bob',
      note: null,
    },
  ]);

  seedFakeModule('lib/db', { db: fakeDb });
  // filterActivitiesForViewer is a notification-privacy filter, not an access
  // check — pass rows through so this file tests authorization only.
  seedFakeModule('lib/push', {
    filterActivitiesForViewer: async (_viewerId: string, rows: any[]) => rows,
  });

  const activityRoute: any = await import('@/app/api/activity/route');
  const stub: any = await import('@/lib/stack');

  function signInWeb(userId: string | null): void {
    stub.resetSessions();
    if (userId) {
      stub.signInWeb(stub.stackUser({ id: userId, primaryEmail: `${userId}@example.com`, primaryEmailVerified: true }));
    }
  }

  function issueToken(token: string, userId: string): void {
    stub.issueAccessToken(token, stub.stackUser({ id: userId, primaryEmail: `${userId}@example.com`, primaryEmailVerified: true }));
  }

  async function callGET(url: string, headers: Record<string, string> = {}) {
    const req = new NextRequest(new Request(`http://localhost:3000${url}`, { method: 'GET', headers }));
    const res = await activityRoute.GET(req);
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body, headers: res.headers };
  }

  /** Does this response body contain anything from Alice's private group? */
  function leaksAlice(body: any): boolean {
    const s = JSON.stringify(body ?? null);
    return s.includes('Alice private group')
      || s.includes('Who pays for dinner Friday')
      || s.includes('a private comment nobody outside the group should read');
  }

  // -------------------------------------------------------------------------
  await step('Anonymous callers get nothing — and never reach the database', async () => {
    signInWeb(null);
    const before = fakeDb.getByUserGroupsCalls;

    const res = await callGET(`/api/activity?userId=${ALICE}`);
    assert(res.status === 401, `anonymous ?userId= → 401 (observed ${res.status})`);
    assert(
      res.body?.error === 'Authentication required',
      `401 body is {error:'Authentication required'} (observed ${JSON.stringify(res.body)})`
    );
    assert(!Array.isArray(res.body), 'anonymous ?userId= returns no activity array');
    assert(!leaksAlice(res.body), 'anonymous ?userId= leaks no private group name, wager title or comment text');
    assert(
      fakeDb.getByUserGroupsCalls === before,
      `auth is checked BEFORE the feed is read (getByUserGroups calls unchanged at ${before})`
    );

    const bare = await callGET('/api/activity');
    assert(bare.status === 401, `anonymous with no params → 401, not 400 (observed ${bare.status})`);
  });

  await step('An authenticated caller cannot name someone else', async () => {
    signInWeb(BOB);
    const before = fakeDb.getByUserGroupsCalls;

    const res = await callGET(`/api/activity?userId=${ALICE}`);
    assert(res.status === 403, `bob asking for alice's feed → 403 (observed ${res.status})`);
    assert(!leaksAlice(res.body), "bob gets none of alice's private group data");
    assert(
      fakeDb.getByUserGroupsCalls === before,
      'a cross-user request never reads the feed at all'
    );
  });

  await step("A caller reading their own feed still works — by param and by session", async () => {
    signInWeb(ALICE);

    const explicit = await callGET(`/api/activity?userId=${ALICE}`);
    assert(explicit.status === 200, `alice ?userId=<self> → 200 (observed ${explicit.status})`);
    assert(Array.isArray(explicit.body) && explicit.body.length === 2,
      `alice sees her own 2 rows (observed ${Array.isArray(explicit.body) ? explicit.body.length : 'non-array'})`);

    // Omitting userId must derive it from the session, not 400 and not leak.
    const derived = await callGET('/api/activity');
    assert(derived.status === 200, `alice with no userId → 200, derived from session (observed ${derived.status})`);
    assert(Array.isArray(derived.body) && derived.body.length === 2,
      'the session-derived feed is the same feed');
    assert(fakeDb.lastRequestedUserId === ALICE,
      `the feed read was scoped to the caller (observed ${fakeDb.lastRequestedUserId})`);

    const bobRes = await callGET(`/api/activity?userId=${BOB}`, {});
    assert(bobRes.status === 403, `alice asking for bob's feed → 403 (observed ${bobRes.status})`);
  });

  await step('The mobile bearer-token path works the same way', async () => {
    signInWeb(null);
    issueToken('alice-token', ALICE);

    const ok = await callGET(`/api/activity?userId=${ALICE}`, { Authorization: 'Bearer alice-token' });
    assert(ok.status === 200, `bearer token, own feed → 200 (observed ${ok.status})`);
    assert(Array.isArray(ok.body) && ok.body.length === 2, 'bearer caller gets their own rows');

    const cross = await callGET(`/api/activity?userId=${BOB}`, { Authorization: 'Bearer alice-token' });
    assert(cross.status === 403, `bearer token, someone else's feed → 403 (observed ${cross.status})`);

    const bogus = await callGET(`/api/activity?userId=${ALICE}`, { Authorization: 'Bearer not-a-real-token' });
    assert(bogus.status === 401, `an unknown bearer token → 401 (observed ${bogus.status})`);
    assert(!leaksAlice(bogus.body), 'a bogus token leaks nothing');
  });

  await step('A forged x-stack-user-id header cannot name the victim', async () => {
    signInWeb(null);
    issueToken('bob-token', BOB);

    const forged = await callGET(`/api/activity?userId=${ALICE}`, {
      Authorization: 'Bearer bob-token',
      'x-stack-user-id': ALICE,
    });
    assert(forged.status === 403, `forged header + real bob session → 403 (observed ${forged.status})`);
    assert(!leaksAlice(forged.body), 'the forged header discloses nothing of alice');

    const anonForged = await callGET(`/api/activity?userId=${ALICE}`, { 'x-stack-user-id': ALICE });
    assert(anonForged.status === 401, `forged header with no session → 401 (observed ${anonForged.status})`);
  });

  await step('The response is not cacheable by a shared cache', async () => {
    signInWeb(ALICE);
    const res = await callGET(`/api/activity?userId=${ALICE}`);
    const cc = res.headers.get('cache-control') ?? '';
    assert(!/\bpublic\b/.test(cc), `Cache-Control is not "public" (observed "${cc}")`);
    assert(/\bprivate\b|\bno-store\b/.test(cc), `Cache-Control marks the response per-caller (observed "${cc}")`);
    assert(!/s-maxage/.test(cc), `no shared-cache lifetime is advertised (observed "${cc}")`);
  });

  await step('Static assertions on the shipped source', async () => {
    const src = readFileSync(path.resolve(REPO_ROOT, 'app/api/activity/route.ts'), 'utf8');
    assert(/export async function GET/.test(src), 'app/api/activity/route.ts exports a GET handler');
    assert(/requireAuth\s*\(/.test(src), 'the GET handler calls requireAuth()');
    assert(/verifyUserMatch\s*\(/.test(src), 'the GET handler calls verifyUserMatch()');
    // Match an actual read, not the prose above it — this file's own header
    // comment names the header it is defending against.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter(l => !/^\s*\/\//.test(l))
      .join('\n');
    assert(!/x-stack-user-id/i.test(codeOnly),
      'the route never reads the forgeable x-stack-user-id header (comments excluded)');

    const authIdx = src.indexOf('requireAuth');
    const dbIdx = src.indexOf('db.activities.getByUserGroups');
    assert(authIdx !== -1 && dbIdx !== -1 && authIdx < dbIdx,
      'the auth gate precedes the feed read in source order');

    assert(!/'public,\s*s-maxage/.test(src) && !/"public,\s*s-maxage/.test(src),
      'the shared-cache Cache-Control header is gone from the source');
  });

  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(70));
  console.log(`  ${total - failed}/${total} checks passed`);
  console.log('='.repeat(70));
  if (failed > 0) {
    console.log('\nFailures:');
    for (const line of failureLines) console.log(`  - ${line}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
