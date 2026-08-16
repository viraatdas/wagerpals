'use client';

import { useEffect, useRef, useState } from 'react';
import { useUser } from '@stackframe/stack';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function postSubscription(subscription: PushSubscription): Promise<boolean> {
  try {
    const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return false;
    }

    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: {
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
        },
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('Error saving push subscription:', error);
    return false;
  }
}

/**
 * Requests notification permission (if needed), subscribes this device to
 * web push, and registers the subscription against the signed-in user.
 * Safe to call from anywhere (e.g. a "Enable on this device" button) -
 * never throws, resolves to whether the device ended up subscribed.
 */
export async function subscribeToWebPush(): Promise<boolean> {
  try {
    if (typeof window === 'undefined') return false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    if (typeof Notification === 'undefined') return false;

    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      return false;
    }

    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        console.error('VAPID public key not configured');
        return false;
      }
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    return await postSubscription(subscription);
  } catch (error) {
    console.error('Error subscribing to push notifications:', error);
    return false;
  }
}

export default function PushNotificationPrompt() {
  const user = useUser({ or: 'return-null' });
  const [showPrompt, setShowPrompt] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const resyncedRef = useRef(false);

  useEffect(() => {
    resyncedRef.current = false;
    if (!user) {
      setShowPrompt(false);
      setIsSubscribed(false);
      return;
    }
    checkSubscriptionStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const checkSubscriptionStatus = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      setShowPrompt(false);
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        setIsSubscribed(true);

        // Re-bind the existing subscription to the current user id, once
        // per mount, so notifications keep working after a sign-out/in on
        // a shared browser.
        if (!resyncedRef.current) {
          resyncedRef.current = true;
          postSubscription(subscription);
        }
      } else {
        // Check if user has already dismissed the prompt
        const dismissed = localStorage.getItem('pushNotificationPromptDismissed');
        if (!dismissed) {
          setShowPrompt(true);
        }
      }
    } catch (error) {
      console.error('Error checking subscription status:', error);
    }
  };

  const handleEnable = async () => {
    const success = await subscribeToWebPush();
    if (success) {
      setIsSubscribed(true);
      setShowPrompt(false);
    } else {
      setShowPrompt(false);
    }
  };

  const dismissPrompt = () => {
    setShowPrompt(false);
    localStorage.setItem('pushNotificationPromptDismissed', 'true');
  };

  if (!user || !showPrompt || isSubscribed) {
    return null;
  }

  return (
    <div className="fixed bottom-24 left-4 right-4 max-w-sm glass-strong rounded-3xl p-4 z-50 animate-slide-up sm:bottom-4 sm:left-auto">
      <div className="flex items-start">
        <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
          <span className="text-xl">🔔</span>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-lg font-display font-semibold text-foreground">
            Want notifications?
          </h3>
          <p className="mt-1 text-sm text-muted">
            Get push notifications for new bets!
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button
              onClick={handleEnable}
              className="btn-primary text-sm px-4 py-2"
            >
              Enable
            </button>
            <button
              onClick={dismissPrompt}
              className="btn-glass text-sm px-4 py-2"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
