import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { User } from '@/lib/types';
import { getAuthenticatedUserId, requireAuthUser, verifyUserMatch } from '@/lib/auth';
import { syncUser } from '@/lib/sync-user';

export const dynamic = 'force-dynamic';

// Public shape of a user: strips email, auth_methods, merged_into and
// last_seen_at so identity/contact details aren't leaked to arbitrary
// unauthenticated callers.
function toPublicUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    username_selected: u.username_selected,
    net_total: u.net_total,
    total_bet: u.total_bet,
    streak: u.streak,
    display_name: u.display_name,
    avatar_url: u.avatar_url,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const username = searchParams.get('username');
  const id = searchParams.get('id');

  if (username) {
    const user = await db.users.getByUsername(username);
    if (user) {
      return NextResponse.json(toPublicUser(user));
    }
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (id) {
    const user = await db.users.get(id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const authUserId = await getAuthenticatedUserId(request);
    if (authUserId && authUserId === id) {
      return NextResponse.json(user);
    }
    return NextResponse.json(toPublicUser(user));
  }

  const users = await db.users.getAll();
  return NextResponse.json(users.map(toPublicUser));
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuthUser(request);
  if (authResult instanceof NextResponse) return authResult;
  const stackUser = authResult.user;

  const body = await request.json().catch(() => ({} as any));
  const { username, username_selected, id } = body ?? {};

  // The caller-supplied `id`, if present, is only ever used for this
  // cross-user check — the row id itself always comes from the session.
  if (id && typeof id === 'string' && id !== stackUser.id) {
    const mismatch = verifyUserMatch(stackUser.id, id);
    if (mismatch) return mismatch;
  }

  try {
    const result = await syncUser(stackUser, {
      username: typeof username === 'string' ? username : undefined,
      usernameSelected: username_selected === true,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.user);
  } catch (error: any) {
    console.error('[Users API] Failed to sync user:', error);
    return NextResponse.json({ error: 'Failed to sync user' }, { status: 500 });
  }
}
