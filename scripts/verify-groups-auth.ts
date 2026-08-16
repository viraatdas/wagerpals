// Verification harness for group-membership disclosure.
//
// PROVES: a group's roster, its pending-join queue and who runs it are only
// ever handed to an authenticated, ACTIVE member of that group. The two
// endpoints that can disclose them are driven as real route handlers:
//   - app/api/groups/route.ts          GET (?id=, ?userId=, ?public=true)
//   - app/api/groups/members/route.ts  GET (?groupId=)
//
// WHAT IS REAL AND WHAT IS FAKED
//   Real: both route handlers, and all of lib/auth.ts — including its three
//         session-resolution paths (mobile bearer token, x-stack-auth header,
//         web cookie) and its fail-closed error handling.
//   Faked: the identity provider itself (`@/lib/stack` is redirected at
//         scripts/testing/stack-auth-stub.ts through a module resolve hook,
//         the same mechanism scripts/test-auth-consolidation.ts uses), plus
//         `@/lib/db` and `@/lib/push`, which are replaced with in-memory
//         objects by pre-populating `require.cache` at their resolved paths
//         — the mechanism documented at length in scripts/verify-imessage.ts,
//         which is what actually matches how tsx loads these files here.
//
// So the authorization decision under test is executed for real; only the
// third-party IdP and the storage underneath it are stand-ins.
//
// No database, no network, no server. Run:
//   npx tsx scripts/verify-groups-auth.ts        (or npm run verify:groups-auth)

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
// In-memory stand-in for the group/member tables lib/db.ts fronts
// ---------------------------------------------------------------------------

type FakeGroup = {
  id: string;
  name: string;
  created_by: string;
  resolver_user_id?: string;
  is_public: boolean;
  created_at?: string;
};

type FakeMember = {
  id: number;
  group_id: string;
  user_id: string;
  username: string;
  role: 'admin' | 'member';
  status: 'pending' | 'active';
  joined_at: string;
};

class FakeDb {
  private _groups = new Map<string, FakeGroup>();
  private _members: FakeMember[] = [];
  private _memberSeq = 0;

  seedGroup(g: FakeGroup): void {
    this._groups.set(g.id, { ...g });
  }

  seedMember(m: Omit<FakeMember, 'id' | 'joined_at'> & { joined_at?: string }): void {
    this._members.push({
      id: ++this._memberSeq,
      joined_at: m.joined_at ?? `2026-01-0${Math.min(9, this._memberSeq)}T00:00:00.000Z`,
      ...m,
    });
  }

  groups = {
    get: async (id: string): Promise<FakeGroup | null> => {
      const g = this._groups.get(id);
      return g ? { ...g } : null;
    },
    getPublic: async (): Promise<FakeGroup[]> =>
      Array.from(this._groups.values()).filter(g => g.is_public).map(g => ({ ...g })),
    getByUser: async (userId: string): Promise<FakeGroup[]> => {
      const ids = this._members
        .filter(m => m.user_id === userId && m.status === 'active')
        .map(m => m.group_id);
      return Array.from(this._groups.values())
        .filter(g => ids.indexOf(g.id) !== -1)
        .map(g => ({ ...g }));
    },
  };

  groupMembers = {
    // Mirrors lib/db.ts: INNER JOIN users, admins first.
    getByGroup: async (groupId: string): Promise<FakeMember[]> =>
      this._members
        .filter(m => m.group_id === groupId)
        .sort((a, b) => (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1))
        .map(m => ({ ...m })),
    getPendingByGroup: async (groupId: string): Promise<FakeMember[]> =>
      this._members.filter(m => m.group_id === groupId && m.status === 'pending').map(m => ({ ...m })),
    get: async (groupId: string, userId: string): Promise<FakeMember | null> => {
      const m = this._members.find(x => x.group_id === groupId && x.user_id === userId);
      return m ? { ...m } : null;
    },
    isAdmin: async (groupId: string, userId: string): Promise<boolean> =>
      this._members.some(m => m.group_id === groupId && m.user_id === userId && m.status === 'active' && m.role === 'admin'),
    isMember: async (groupId: string, userId: string): Promise<boolean> =>
      this._members.some(m => m.group_id === groupId && m.user_id === userId && m.status === 'active'),
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

  // Fixture: one private group. ADMIN and MEMBER are active, PENDING has an
  // unapproved join request, OUTSIDER has no row at all.
  const GROUP_ID = '123456';
  const OTHER_GROUP_ID = '654321';
  const PUBLIC_GROUP_ID = '999999';
  const ADMIN = 'stack-user-admin';
  const MEMBER = 'stack-user-member';
  const PENDING = 'stack-user-pending';
  const OUTSIDER = 'stack-user-outsider';

  fakeDb.seedGroup({
    id: GROUP_ID,
    name: 'Poker Night',
    created_by: ADMIN,
    resolver_user_id: ADMIN,
    is_public: false,
    created_at: '2026-01-01T00:00:00.000Z',
  });
  fakeDb.seedMember({ group_id: GROUP_ID, user_id: ADMIN, username: 'ada', role: 'admin', status: 'active' });
  fakeDb.seedMember({ group_id: GROUP_ID, user_id: MEMBER, username: 'grace', role: 'member', status: 'active' });
  fakeDb.seedMember({ group_id: GROUP_ID, user_id: PENDING, username: 'mallory', role: 'member', status: 'pending' });

  // A second private group the OUTSIDER is in, so ?userId= has something to
  // return for them and the mismatch check is not trivially empty.
  fakeDb.seedGroup({ id: OTHER_GROUP_ID, name: 'Fantasy League', created_by: OUTSIDER, is_public: false });
  fakeDb.seedMember({ group_id: OTHER_GROUP_ID, user_id: OUTSIDER, username: 'eve', role: 'admin', status: 'active' });

  fakeDb.seedGroup({ id: PUBLIC_GROUP_ID, name: 'Open Table', created_by: ADMIN, is_public: true });
  fakeDb.seedMember({ group_id: PUBLIC_GROUP_ID, user_id: ADMIN, username: 'ada', role: 'admin', status: 'active' });

  seedFakeModule('lib/db', { db: fakeDb });
  seedFakeModule('lib/push', {
    sendPushToUser: async () => ({ sent: 0, failed: 0, skipped: 0 }),
    notifyUsers: async () => ({ sent: 0, failed: 0, skipped: 0 }),
    notifyEventAudience: async () => ({ sent: 0, failed: 0, skipped: 0 }),
  });

  const groupsRoute: any = await import('@/app/api/groups/route');
  const membersRoute: any = await import('@/app/api/groups/members/route');
  const stub: any = await import('@/lib/stack');

  function signIn(userId: string | null): void {
    stub.resetSessions();
    if (userId) {
      stub.signInWeb(stub.stackUser({ id: userId, primaryEmail: `${userId}@example.com`, primaryEmailVerified: true }));
    }
  }

  async function callGET(
    handler: (req: any) => Promise<Response>,
    url: string,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; body: any }> {
    const req = new NextRequest(new Request(`http://localhost:3000${url}`, { method: 'GET', headers }));
    const res = await handler(req);
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  // -------------------------------------------------------------------------
  await step('GET /api/groups?id= — unauthenticated is rejected', async () => {
    signIn(null);

    const res = await callGET(groupsRoute.GET, `/api/groups?id=${GROUP_ID}`);
    assert(res.status === 401, `anonymous ?id=${GROUP_ID} → 401 (observed ${res.status})`);
    assert(res.body?.error === 'Authentication required', `401 body is {error:'Authentication required'} (observed ${JSON.stringify(res.body)})`);
    assert(res.body?.members === undefined, 'anonymous ?id= response carries no members array');
    assert(res.body?.pending_requests === undefined, 'anonymous ?id= response carries no pending_requests array');
    assert(res.body?.name === undefined, 'anonymous ?id= response does not even leak the group name');

    // Auth is checked before the group is looked up, so an anonymous caller
    // cannot use the 404-vs-200 difference to enumerate valid group ids.
    const missing = await callGET(groupsRoute.GET, '/api/groups?id=000000');
    assert(missing.status === 401, `anonymous ?id= for a NON-EXISTENT group → 401, not 404 (observed ${missing.status})`);
  });

  await step('GET /api/groups?id= — a forged x-stack-user-id header is inert', async () => {
    signIn(null);
    const res = await callGET(groupsRoute.GET, `/api/groups?id=${GROUP_ID}`, {
      'x-stack-user-id': ADMIN,
    });
    assert(res.status === 401, `x-stack-user-id: ${ADMIN} on an anonymous request → 401 (observed ${res.status})`);
    assert(res.body?.members === undefined, 'forged-header request gets no roster');
  });

  await step('GET /api/groups?id= — an authenticated NON-member gets an invite preview only', async () => {
    signIn(OUTSIDER);
    const res = await callGET(groupsRoute.GET, `/api/groups?id=${GROUP_ID}`);

    assert(res.status === 200, `non-member ?id= → 200 invite preview (observed ${res.status})`);
    assert(res.body?.name === 'Poker Night', 'preview carries the group name (the invite has to be recognisable)');
    assert(res.body?.member_count === 2, `preview carries member_count only (observed ${res.body?.member_count})`);
    assert(Array.isArray(res.body?.members) && res.body.members.length === 0, 'preview members[] is EMPTY — no roster');
    assert(
      Array.isArray(res.body?.pending_requests) && res.body.pending_requests.length === 0,
      'preview pending_requests[] is EMPTY — no join queue'
    );
    assert(res.body?.resolver === null, 'preview does not name the resolver');
    assert(res.body?.created_by === undefined, 'preview does not name the group creator');
    assert(res.body?.resolver_user_id === undefined, 'preview does not carry resolver_user_id');
    assert(res.body?.is_member === false, 'preview reports is_member: false');
    assert(res.body?.is_admin === false, 'preview reports is_admin: false');
    assert(res.body?.viewer_status === null, 'preview reports viewer_status: null for someone with no membership row');

    const serialized = JSON.stringify(res.body);
    for (const leaked of [ADMIN, MEMBER, PENDING, 'ada', 'grace', 'mallory']) {
      assert(!serialized.includes(leaked), `preview payload contains no trace of "${leaked}"`);
    }
  });

  await step('GET /api/groups?id= — a PENDING applicant is still a non-member', async () => {
    signIn(PENDING);
    const res = await callGET(groupsRoute.GET, `/api/groups?id=${GROUP_ID}`);

    assert(res.status === 200, `pending applicant ?id= → 200 preview (observed ${res.status})`);
    assert(res.body?.viewer_status === 'pending', `pending applicant sees their own status (observed ${JSON.stringify(res.body?.viewer_status)})`);
    assert(res.body?.is_member === false, 'pending applicant is not reported as a member');
    assert(res.body?.members?.length === 0, 'pending applicant gets no roster');
    assert(res.body?.pending_requests?.length === 0, 'pending applicant cannot see who else applied');
    assert(!JSON.stringify(res.body).includes(MEMBER), 'pending applicant payload leaks no other member id');
  });

  await step('GET /api/groups?id= — an ACTIVE member gets the full group', async () => {
    signIn(MEMBER);
    const res = await callGET(groupsRoute.GET, `/api/groups?id=${GROUP_ID}`);

    assert(res.status === 200, `active member ?id= → 200 (observed ${res.status})`);
    assert(res.body?.members?.length === 2, `active member sees the 2-person roster (observed ${res.body?.members?.length})`);
    assert(
      res.body?.pending_requests?.length === 1 && res.body.pending_requests[0].user_id === PENDING,
      'active member sees the pending join request'
    );
    assert(res.body?.resolver?.user_id === ADMIN, 'active member sees who resolves the group');
    assert(res.body?.is_member === true, 'active member is reported as a member');
    assert(res.body?.is_admin === false, 'a non-admin active member is not reported as an admin');
    assert(res.body?.user_role === 'member', `user_role is 'member' (observed ${res.body?.user_role})`);
    assert(res.body?.viewer_status === 'active', 'viewer_status is active');
  });

  await step('GET /api/groups?id= — an ACTIVE ADMIN is flagged as one', async () => {
    signIn(ADMIN);
    const res = await callGET(groupsRoute.GET, `/api/groups?id=${GROUP_ID}`);
    assert(res.status === 200, `admin ?id= → 200 (observed ${res.status})`);
    assert(res.body?.is_admin === true, 'admin is reported as an admin');
    assert(res.body?.user_role === 'admin', `user_role is 'admin' (observed ${res.body?.user_role})`);
    assert(res.body?.admin_count === 1, `admin_count is 1 (observed ${res.body?.admin_count})`);
  });

  await step('GET /api/groups?id= — membership in ANOTHER group buys nothing', async () => {
    // OUTSIDER is an active admin of OTHER_GROUP_ID. That must not unlock
    // GROUP_ID: the membership check has to be scoped to the group asked for.
    signIn(OUTSIDER);
    const own = await callGET(groupsRoute.GET, `/api/groups?id=${OTHER_GROUP_ID}`);
    assert(own.status === 200 && own.body?.is_admin === true, 'outsider is an admin of their OWN group (fixture sanity check)');

    const other = await callGET(groupsRoute.GET, `/api/groups?id=${GROUP_ID}`);
    assert(other.body?.members?.length === 0, "being an admin elsewhere does not disclose another group's roster");
  });

  await step("GET /api/groups?id= — a group that doesn't exist is a 404 for a signed-in caller", async () => {
    signIn(MEMBER);
    const res = await callGET(groupsRoute.GET, '/api/groups?id=000000');
    assert(res.status === 404, `signed-in ?id=000000 → 404 (observed ${res.status})`);
  });

  await step('GET /api/groups?userId= — the caller can only ask about themselves', async () => {
    signIn(null);
    const anon = await callGET(groupsRoute.GET, `/api/groups?userId=${MEMBER}`);
    assert(anon.status === 401, `anonymous ?userId= → 401 (observed ${anon.status})`);
    assert(!Array.isArray(anon.body), 'anonymous ?userId= returns no group array');

    signIn(OUTSIDER);
    const impersonation = await callGET(groupsRoute.GET, `/api/groups?userId=${MEMBER}`);
    assert(impersonation.status === 403, `?userId=<someone else> → 403 (observed ${impersonation.status})`);
    assert(!Array.isArray(impersonation.body), "another user's group list is not returned");

    const own = await callGET(groupsRoute.GET, `/api/groups?userId=${OUTSIDER}`);
    assert(own.status === 200 && Array.isArray(own.body), `?userId=<self> → 200 array (observed ${own.status})`);
    assert(own.body.length === 1 && own.body[0].id === OTHER_GROUP_ID, 'own group list contains exactly the caller’s group');
  });

  await step('GET /api/groups (no params) — derives the caller from the session', async () => {
    signIn(null);
    const anon = await callGET(groupsRoute.GET, '/api/groups');
    assert(anon.status === 401, `anonymous no-param GET → 401 (observed ${anon.status})`);

    signIn(MEMBER);
    const res = await callGET(groupsRoute.GET, '/api/groups');
    assert(res.status === 200 && Array.isArray(res.body), `signed-in no-param GET → 200 array (observed ${res.status})`);
    assert(res.body.length === 1 && res.body[0].id === GROUP_ID, 'no-param GET returns the session user’s own groups');
  });

  await step('GET /api/groups?public=true — the public directory stays open', async () => {
    signIn(null);
    const res = await callGET(groupsRoute.GET, '/api/groups?public=true');
    assert(res.status === 200, `anonymous ?public=true → 200 (observed ${res.status})`);
    assert(Array.isArray(res.body) && res.body.length === 1, `one public group listed (observed ${res.body?.length})`);
    assert(res.body[0].id === PUBLIC_GROUP_ID, 'the public group is the one listed');
    assert(res.body[0].members === undefined, 'the public directory carries counts, not rosters');
    assert(
      !res.body.some((g: any) => g.id === GROUP_ID || g.id === OTHER_GROUP_ID),
      'no private group appears in the public directory'
    );
  });

  await step('GET /api/groups/members?groupId= — the same gate, on the same data', async () => {
    signIn(null);
    const anon = await callGET(membersRoute.GET, `/api/groups/members?groupId=${GROUP_ID}`);
    assert(anon.status === 401, `anonymous ?groupId= → 401 (observed ${anon.status})`);
    assert(!Array.isArray(anon.body), 'anonymous ?groupId= returns no member array');

    signIn(OUTSIDER);
    const outsider = await callGET(membersRoute.GET, `/api/groups/members?groupId=${GROUP_ID}`);
    assert(outsider.status === 403, `non-member ?groupId= → 403 (observed ${outsider.status})`);
    assert(!Array.isArray(outsider.body), 'non-member gets no member array');
    assert(!JSON.stringify(outsider.body).includes('grace'), 'non-member 403 body leaks no username');

    signIn(PENDING);
    const pending = await callGET(membersRoute.GET, `/api/groups/members?groupId=${GROUP_ID}`);
    assert(pending.status === 403, `pending applicant ?groupId= → 403 (observed ${pending.status})`);

    signIn(MEMBER);
    const member = await callGET(membersRoute.GET, `/api/groups/members?groupId=${GROUP_ID}`);
    assert(member.status === 200 && Array.isArray(member.body), `active member ?groupId= → 200 array (observed ${member.status})`);
    assert(member.body.length === 3, `active member sees all 3 rows incl. pending (observed ${member.body?.length})`);

    signIn(MEMBER);
    const missingParam = await callGET(membersRoute.GET, '/api/groups/members');
    assert(missingParam.status === 400, `signed-in call with no groupId → 400 (observed ${missingParam.status})`);
  });

  await step('Static assertions on the shipped source', async () => {
    const groupsSrc = readFileSync(path.resolve(REPO_ROOT, 'app/api/groups/route.ts'), 'utf8');
    const membersSrc = readFileSync(path.resolve(REPO_ROOT, 'app/api/groups/members/route.ts'), 'utf8');

    function handlerBody(src: string, name: string): string {
      const start = src.indexOf(`export async function ${name}(`);
      if (start === -1) return '';
      const next = src.indexOf('\nexport ', start + 1);
      return next === -1 ? src.slice(start) : src.slice(start, next);
    }

    const groupsGet = handlerBody(groupsSrc, 'GET');
    assert(groupsGet.length > 0, 'app/api/groups/route.ts exports a GET handler');
    assert(groupsGet.includes('requireAuth('), 'app/api/groups/route.ts GET calls requireAuth()');
    assert(groupsGet.includes('verifyUserMatch('), 'app/api/groups/route.ts GET calls verifyUserMatch()');

    const membersGet = handlerBody(membersSrc, 'GET');
    assert(membersGet.includes('requireAuth('), 'app/api/groups/members/route.ts GET calls requireAuth()');

    for (const [label, src] of [
      ['app/api/groups/route.ts', groupsSrc],
      ['app/api/groups/members/route.ts', membersSrc],
    ] as const) {
      assert(!src.includes('x-stack-user-id'), `${label} never reads the forgeable x-stack-user-id header`);
      assert(
        !/searchParams\.get\(['"]adminUserId['"]\)/.test(src),
        `${label} does not take a caller identity from the query string`
      );
    }
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
