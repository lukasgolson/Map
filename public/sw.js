const CACHE_NAME = 'dino-map-cache-v25';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/map-utils.js',
  '/audio.js',
  '/weather.js',
  '/algo-chip.umd.js',
  '/worklets/square-processor.js',
  '/worklets/triangle-processor.js',
  '/worklets/noise-processor.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/route.geojson',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

// Install Event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[Service Worker] Pre-caching static assets');
      return cache.addAll(ASSETS).catch(err => {
        console.warn('Failed to pre-cache some assets during install:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event
self.addEventListener('fetch', event => {
  // Only handle HTTP/HTTPS requests (ignores chrome-extension schemes)
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // Let the browser handle API data calls dynamically (network-only or network-first)
  if (event.request.url.includes('/api/v1/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: "offline" }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Cache-first strategy for static assets
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then(networkResponse => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });
        
        return networkResponse;
      }).catch(() => {
        // Fallback if network fails and not cached
        return null;
      });
    })
  );
});
