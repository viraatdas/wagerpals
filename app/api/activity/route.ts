import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { filterActivitiesForViewer } from '@/lib/push';
import { requireAuth, verifyUserMatch } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    // This feed is `db.activities.getByUserGroups` — every activity across
    // every group the named user belongs to, INCLUDING private ones. Each row
    // carries the group name, the wager title and the comment body, so an
    // ungated `?userId=` here disclosed the contents of private groups to
    // anyone who could name a member. User ids are not secret (an anonymous
    // `GET /api/users?username=` hands one out), so the query param alone was
    // never an access check.
    //
    // CLAUDE.md §8: a query param must never name whose data to return —
    // that is the same class of bug as trusting `x-stack-user-id`. Auth is
    // resolved BEFORE the database is touched, so an anonymous caller cannot
    // learn whether a user id exists or infer anything from timing.
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;

    const { searchParams } = new URL(request.url);
    const userIdParam = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // `userId` is optional and redundant — it must be the caller's own id, so
    // when it is omitted we derive it from the session instead (same shape as
    // `GET /api/groups`).
    const userId = userIdParam ?? authResult.userId;
    const mismatch = verifyUserMatch(authResult.userId, userId);
    if (mismatch) return mismatch;

    const activities = await db.activities.getByUserGroups(userId, limit, offset);

    // An event whose subject asked not to be notified must not surface in
    // that subject's own feed until it resolves.
    const visible = await filterActivitiesForViewer(userId, activities);

    return NextResponse.json(visible, {
      headers: {
        // Per-caller data: never store it in a shared/CDN cache. This used to
        // be `public, s-maxage=10`, which would let one user's feed be served
        // to another from the edge.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error: any) {
    console.error('[Activity API] Error fetching activities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch activities' },
      { status: 500 }
    );
  }
}
