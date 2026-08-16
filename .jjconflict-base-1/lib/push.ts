import webpush from 'web-push';
import { db } from './db';

// VAPID keys should be set in environment variables
// Generate them with: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:admin@wagerpals.com').trim();

// Track if VAPID details have been set
let vapidDetailsSet = false;

// Set VAPID details only when needed (at runtime, not during build)
function ensureVapidDetails() {
  if (!vapidDetailsSet && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    try {
      webpush.setVapidDetails(
        VAPID_SUBJECT,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
      );
      vapidDetailsSet = true;
    } catch (error: any) {
      console.error('[VAPID] ❌ Failed to set VAPID details:', error.message);
      throw error;
    }
  }
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  eventId?: string;
  tag?: string;
}

export async function sendPushNotification(
  endpoint: string,
  p256dh: string,
  auth: string,
  payload: PushNotificationPayload
): Promise<boolean> {
  try {
    // Set VAPID details at runtime, not during build
    ensureVapidDetails();

    const subscription = {
      endpoint,
      keys: {
        p256dh,
        auth,
      },
    };

    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload)
    );

    return true;
  } catch (error: any) {
    console.error(`[Push] Error for ${endpoint.substring(0, 50)}:`, error.statusCode, error.message);
    
    // TEMPORARILY DISABLED - Don't auto-delete to see what's failing
    // if (error.statusCode === 410 || error.statusCode === 404) {
    //   console.log('[Push] Subscription no longer valid, removing from database');
    //   await db.pushSubscriptions.delete(endpoint);
    // }
    
    return false;
  }
}

export async function sendPushToAllSubscribers(
  payload: PushNotificationPayload
): Promise<{ success: number; failed: number }> {
  const subscriptions = await db.pushSubscriptions.getAll();

  if (subscriptions.length === 0) {
    return { success: 0, failed: 0 };
  }
  
  let success = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    subscriptions
      .filter((sub) => {
        // Include mobile subscriptions or web subscriptions with valid keys
        return (sub.platform === 'mobile' && sub.expo_token) || (sub.p256dh && sub.auth);
      })
      .map((sub) => {
        // Check if it's an Expo token
        if (sub.platform === 'mobile' && sub.expo_token) {
          return sendExpoNotification(sub.expo_token, payload);
        }
        // Otherwise, it's a web push subscription (we know p256dh and auth exist due to filter)
        return sendPushNotification(sub.endpoint, sub.p256dh!, sub.auth!, payload);
      })
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      success++;
    } else {
      failed++;
      if (result.status === 'rejected') {
        console.error(`[SendToAll] Subscription ${index} rejected:`, result.reason);
      }
    }
  });

  return { success, failed };
}

// Send push notification to a specific user
export async function sendPushToUser(
  userId: string,
  payload: PushNotificationPayload
): Promise<{ success: number; failed: number }> {
  const subscriptions = await db.pushSubscriptions.getByUserId(userId);

  if (subscriptions.length === 0) {
    return { success: 0, failed: 0 };
  }
  
  let success = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    subscriptions
      .filter((sub) => {
        // Include mobile subscriptions or web subscriptions with valid keys
        return (sub.platform === 'mobile' && sub.expo_token) || (sub.p256dh && sub.auth);
      })
      .map((sub) => {
        // Check if it's an Expo token
        if (sub.platform === 'mobile' && sub.expo_token) {
          return sendExpoNotification(sub.expo_token, payload);
        }
        // Otherwise, it's a web push subscription (we know p256dh and auth exist due to filter)
        return sendPushNotification(sub.endpoint, sub.p256dh!, sub.auth!, payload);
      })
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      success++;
    } else {
      failed++;
      if (result.status === 'rejected') {
        console.error(`[SendToUser] Subscription ${index} rejected:`, result.reason);
      }
    }
  });

  return { success, failed };
}

// Send notification via Expo Push Notification service
async function sendExpoNotification(
  expoToken: string,
  payload: PushNotificationPayload
): Promise<boolean> {
  try {
    const message = {
      to: expoToken,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: {
        url: payload.url,
        eventId: payload.eventId,
        tag: payload.tag,
      },
    };

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`Expo push failed: ${response.statusText}`);
    }

    await response.json();
    return true;
  } catch (error: any) {
    console.error(`[Expo] ❌ Error:`, error.message);
    return false;
  }
}

