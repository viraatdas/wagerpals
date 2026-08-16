import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';

export const dynamic = 'force-dynamic';

// Self-only push test: sends exactly one notification to the authenticated
// caller. Replaces the old unauthenticated broadcast tester - it must never
// send to anyone else and must never read a user id from the request body.
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  try {
    const result = await sendPushToUser(
      userId,
      {
        title: '🔔 WagerPals',
        body: 'Notifications are working.',
        url: '/',
        tag: 'push-test',
      },
      'group_activity'
    );
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('[Push] test send error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 200 }
    );
  }
}
