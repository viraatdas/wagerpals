const CACHE_NAME = 'wagerpals-v3';
const STATIC_CACHE = [
  '/manifest.json',
  '/icons/icon-192x192.svg',
  '/icons/icon-512x512.svg'
];

// Install event - cache only static resources (not pages)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(STATIC_CACHE);
      })
      .catch(() => {
        // Cache install error
      })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - Network first for pages, cache first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip external requests (don't intercept cross-origin requests)
  if (!url.origin.includes('wagerpals.io')) {
    return;
  }
  
  // Skip caching for API routes and auth routes
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    return;
  }
  
  // Cache-first for static assets (icons, manifest)
  if (STATIC_CACHE.some(path => url.pathname === path)) {
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          return response || fetch(event.request);
        })
    );
    return;
  }
  
  // Network-first for everything else (pages, dynamic content)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone the response before caching
        const responseToCache = response.clone();
        
        // Only cache successful responses
        if (response.status === 200) {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        
        return response;
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request);
      })
  );
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event) => {
  let notificationData = {
    title: 'WagerPals',
    body: 'New notification',
    icon: '/icons/icon-192x192.svg',
    badge: '/icons/icon-192x192.svg',
    data: {
      url: '/'
    }
  };

  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = {
        title: data.title || 'WagerPals',
        body: data.body || data.message || 'New notification',
        icon: '/icons/icon-192x192.svg',
        badge: '/icons/icon-192x192.svg',
        data: {
          url: data.url || '/',
          eventId: data.eventId
        },
        tag: data.tag || 'wagerpals-notification',
        requireInteraction: false,
      };
    } catch (error) {
      console.error('Error parsing push data:', error);
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      data: notificationData.data,
      tag: notificationData.tag,
      requireInteraction: notificationData.requireInteraction,
    })
  );
});

// Notification click event - navigate to the event
self.addEventListener('notificationclick', (event) => {
  try {
    event.notification.close();

    // Resolve the target path from the payload. Prefer an explicit url,
    // fall back to /events/<eventId>, else the home page.
    const data = (event.notification && event.notification.data) || {};
    let targetPath = '/';
    if (data.url) {
      targetPath = data.url;
    } else if (data.eventId) {
      targetPath = `/events/${data.eventId}`;
    }

    // Security: never let a push payload send the user to another origin.
    // Resolve against our own origin and reject anything that doesn't
    // stay on it (falls back to '/').
    let targetUrl;
    try {
      const resolved = new URL(targetPath, self.location.origin);
      targetUrl = resolved.origin === self.location.origin
        ? resolved.href
        : self.location.origin + '/';
    } catch (e) {
      targetUrl = self.location.origin + '/';
    }

    event.waitUntil(
      (async () => {
        try {
          const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });

          // Reuse an existing same-origin window/tab if we have one, and
          // navigate it to the target path (not just focus it in place).
          for (let i = 0; i < clientList.length; i++) {
            const client = clientList[i];
            try {
              if (new URL(client.url).origin === self.location.origin) {
                if ('focus' in client) {
                  await client.focus();
                }
                if ('navigate' in client) {
                  return client.navigate(targetUrl);
                }
                return client;
              }
            } catch (e) {
              // Ignore malformed client URLs and keep looking.
            }
          }

          // No reusable client - open a new window.
          if (clients.openWindow) {
            return clients.openWindow(targetUrl);
          }
        } catch (e) {
          // Never let a bad payload/environment break the click handler.
        }
      })()
    );
  } catch (e) {
    // Swallow any synchronous errors so a malformed notification can't
    // throw inside the event listener.
  }
});

