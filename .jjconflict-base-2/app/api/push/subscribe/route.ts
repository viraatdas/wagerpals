import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { endpoint, keys, token, userId } = body;

    // Support both web push and Expo push tokens
    if (token) {
      // Expo push token
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
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json(
        { error: 'Missing required subscription data' },
        { status: 400 }
      );
    }

    // Get user ID from cookie if available
    const cookieStore = await cookies();
    const cookieUserId = cookieStore.get('userId')?.value;

    // Store subscription in database
    const subscription = await db.pushSubscriptions.create({
      user_id: userId || cookieUserId,
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
  try {
    const body = await request.json();
    const { endpoint, token } = body;

    const endpointToDelete = token || endpoint;

    if (!endpointToDelete) {
      return NextResponse.json(
        { error: 'Missing endpoint or token' },
        { status: 400 }
      );
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

