'use client';

import { useEffect, useState } from 'react';

export default function PushNotificationPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    checkSubscriptionStatus();
  }, []);

  const checkSubscriptionStatus = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        setIsSubscribed(true);
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

  const urlBase64ToUint8Array = (base64String: string) => {
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
  };

  const subscribeToPushNotifications = async () => {
    try {
      const permission = await Notification.requestPermission();
      
      if (permission !== 'granted') {
        setShowPrompt(false);
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        console.error('VAPID public key not configured');
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      // Send subscription to backend
      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (response.ok) {
        setIsSubscribed(true);
        setShowPrompt(false);
      } else {
        console.error('Failed to save subscription on server');
      }
    } catch (error) {
      console.error('Error subscribing to push notifications:', error);
    }
  };

  const dismissPrompt = () => {
    setShowPrompt(false);
    localStorage.setItem('pushNotificationPromptDismissed', 'true');
  };

  if (!showPrompt || isSubscribed) {
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
              onClick={subscribeToPushNotifications}
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
