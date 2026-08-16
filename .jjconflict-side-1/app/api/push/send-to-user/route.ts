import { NextRequest, NextResponse } from 'next/server';
import { sendPushToUser } from '@/lib/push';

export async function POST(request: NextRequest) {
  try {
    const { userId, title, body, url, eventId, tag } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const payload = {
      title: title || 'WagerPals',
      body: body || 'Test notification',
      url,
      eventId,
      tag,
    };

    const result = await sendPushToUser(userId, payload);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('[Push] send-to-user error:', error);
    return NextResponse.json({ error: 'Failed to send push to user' }, { status: 500 });
  }
}

