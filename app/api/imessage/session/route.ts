import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuthUser } from '@/lib/auth';
import { syncUser } from '@/lib/sync-user';

export const dynamic = 'force-dynamic';

/**
 * Bootstrap call for the native iMessage extension: resolves (and, if
 * needed, creates) the caller's `users` row via the one canonical sync path,
 * then returns the minimal identity + group list the compose UI needs to
 * let someone pick which group to wager in. Auth is required — there is no
 * anonymous view of this endpoint.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;

  const syncResult = await syncUser(authResult.user);
  if (!syncResult.ok) {
    return NextResponse.json({ error: syncResult.error }, { status: syncResult.status });
  }
  const user = syncResult.user;

  // db.groups.getByUser only returns groups where the caller's own membership
  // is 'active', so the caller is authorised to see the roster of every group
  // returned below — the same disclosure app/api/groups/members already makes
  // to members. Only ACTIVE members are listed: a pending join request is not
  // yet a member and must not be taggable as a bet's subject.
  const groups = await db.groups.getByUser(user.id);
  const rosters = await Promise.all(groups.map(g => db.groupMembers.getByGroup(g.id)));

  return NextResponse.json(
    {
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name ?? null,
      },
      groups: groups.map((g, i) => ({
        id: g.id,
        name: g.name,
        is_public: g.is_public,
        // Powers the extension's "This bet is about…" subject picker. Kept to
        // id + username only: the extension needs a name to show and an id to
        // send, and nothing else about these people is its business.
        members: rosters[i]
          .filter(m => m.status === 'active')
          .map(m => ({ id: m.user_id, username: m.username ?? m.user_id })),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
