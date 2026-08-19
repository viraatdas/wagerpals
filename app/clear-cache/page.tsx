
'use client';
export const dynamic = 'force-dynamic';


import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ClearCachePage() {
  const [status, setStatus] = useState<string>('Clearing cache…');
  const [failed, setFailed] = useState(false);
  const router = useRouter();

  const clearCache = async () => {
    setFailed(false);
    setStatus('Clearing cache…');
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

      setStatus('Cache cleared — redirecting…');

      // Wait a bit then redirect to home
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } catch (error) {
      console.error('Error clearing cache:', error);
      setStatus("Couldn't clear the cache — refresh the page manually.");
      setFailed(true);
    }
  };

  useEffect(() => {
    clearCache();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  return (
    <div className="page-shell-narrow animate-rise">
      <div className="card p-6 sm:p-8 text-center">
        <h1 className="display-2 mb-3">Clear cache</h1>
        <p
          className={`lede mx-auto mb-6 ${failed ? 'tone-no tone-text' : 'text-muted'}`}
        >
          {status}
        </p>

        <div className="panel p-5 text-left mb-6">
          <p className="field-label mb-2">This clears, on load:</p>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted">
            <li>Unregister service workers</li>
            <li>Clear browser caches</li>
            <li>Clear local storage</li>
            <li>Clear session storage</li>
          </ul>
        </div>

        {failed && (
          <button onClick={clearCache} className="btn-danger px-5 py-2.5">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

