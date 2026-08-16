
'use client';
export const dynamic = 'force-dynamic';


import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ClearCachePage() {
  const [status, setStatus] = useState<string>('Clearing cache...');
  const router = useRouter();

  useEffect(() => {
    const clearCache = async () => {
      try {
        // Unregister all service workers
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            await registration.unregister();
          }
        }

        // Clear all caches
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(
            cacheNames.map((cacheName) => caches.delete(cacheName))
          );
        }

        // Clear local storage
        localStorage.clear();
        
        // Clear session storage
        sessionStorage.clear();

        setStatus('✅ Cache cleared successfully! Redirecting...');
        
        // Wait a bit then redirect to home
        setTimeout(() => {
          window.location.href = '/';
        }, 2000);
      } catch (error) {
        console.error('Error clearing cache:', error);
        setStatus('❌ Error clearing cache. Please try manually refreshing.');
      }
    };

    clearCache();
  }, [router]);

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 animate-rise">
      <div className="glass-strong rounded-3xl p-8 text-center">
        <h1 className="font-display text-3xl font-semibold text-foreground mb-4">
          Cache Management
        </h1>
        <p className="text-xl text-muted mb-8">{status}</p>

        <div className="text-sm text-muted-2 space-y-2 glass-subtle rounded-2xl p-5 text-left">
          <p className="text-muted">This page will:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Unregister service workers</li>
            <li>Clear browser caches</li>
            <li>Clear local storage</li>
            <li>Clear session storage</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

