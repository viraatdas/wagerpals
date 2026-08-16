import { NextRequest, NextResponse } from 'next/server';
import { sendPushToAllSubscribers, PushNotificationPayload } from '@/lib/push';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, body: message, url, eventId, tag } = body;

    if (!title || !message) {
      return NextResponse.json(
        { error: 'Missing title or message' },
        { status: 400 }
      );
    }

    const payload: PushNotificationPayload = {
      title,
      body: message,
      url,
      eventId,
      tag,
    };

    const result = await sendPushToAllSubscribers(payload);

    return NextResponse.json({
      sent: true,
      ...result,
    });
  } catch (error) {
    console.error('Error sending push notifications:', error);
    return NextResponse.json(
      { error: 'Failed to send push notifications' },
      { status: 500 }
    );
  }
}

