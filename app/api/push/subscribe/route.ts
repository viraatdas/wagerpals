import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Expo push tokens look like `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]` or
// the newer `ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]` form.
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[.+\]$/;

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  try {
    const body = await request.json();
    const { endpoint, keys, token } = body;

    // Support both web push and Expo push tokens. Never trust a `userId`
    // sent in the body (the mobile client still sends one) - the caller's
    // authenticated id is the only source of truth.
    if (token) {
      if (typeof token !== 'string' || !EXPO_TOKEN_RE.test(token)) {
        return NextResponse.json(
          { error: 'Invalid Expo push token' },
          { status: 400 }
        );
      }

      const subscription = await db.pushSubscriptions.create({
        user_id: userId,
        endpoint: token,
        expo_token: token,
        platform: 'mobile',
        p256dh: undefined,
        auth: undefined,
      });
      return NextResponse.json({ success: true, subscription });
    }

    // Web push subscription
    if (
      typeof endpoint !== 'string' ||
      !endpoint ||
      typeof keys?.p256dh !== 'string' ||
      !keys?.p256dh ||
      typeof keys?.auth !== 'string' ||
      !keys?.auth
    ) {
      return NextResponse.json(
        { error: 'Missing required subscription data' },
        { status: 400 }
      );
    }

    // Store subscription in database
    const subscription = await db.pushSubscriptions.create({
      user_id: userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      platform: 'web',
    });

    return NextResponse.json({ success: true, subscription });
  } catch (error) {
    console.error('Error subscribing to push notifications:', error);
    return NextResponse.json(
      { error: 'Failed to subscribe to push notifications' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  try {
    const body = await request.json();
    const { endpoint, token } = body;

    const endpointToDelete = token || endpoint;

    if (!endpointToDelete || typeof endpointToDelete !== 'string') {
      return NextResponse.json(
        { error: 'Missing endpoint or token' },
        { status: 400 }
      );
    }

    // Scope the delete to the caller's own subscriptions - knowing an
    // endpoint must not be enough to silence someone else's device.
    const ownSubscriptions = await db.pushSubscriptions.getByUserId(userId);
    const owned = ownSubscriptions.some((sub) => sub.endpoint === endpointToDelete);
    if (!owned) {
      // Don't reveal whether the row exists for someone else.
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await db.pushSubscriptions.delete(endpointToDelete);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error unsubscribing from push notifications:', error);
    return NextResponse.json(
      { error: 'Failed to unsubscribe from push notifications' },
      { status: 500 }
    );
  }
}
