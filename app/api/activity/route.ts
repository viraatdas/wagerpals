import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { filterActivitiesForViewer } from '@/lib/push';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const activities = await db.activities.getByUserGroups(userId, limit, offset);

    // An event whose subject asked not to be notified must not surface in
    // that subject's own feed until it resolves.
    const visible = await filterActivitiesForViewer(userId, activities);

    return NextResponse.json(visible, {
      headers: {
        'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30',
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
