import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const subscriptions = await db.pushSubscriptions.getAll();
    
    return NextResponse.json({
      subscriptionCount: subscriptions.length,
      vapidPublicKeySet: !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      vapidPrivateKeySet: !!process.env.VAPID_PRIVATE_KEY,
      vapidSubjectSet: !!process.env.VAPID_SUBJECT,
      vapidPublicKeyLength: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.length || 0,
      subscriptions: subscriptions.map(s => ({
        id: s.id,
        user_id: s.user_id,
        endpoint: s.endpoint.substring(0, 50) + '...',
      })),
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
    }, { status: 500 });
  }
}

