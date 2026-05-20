// Bump CACHE on any release that changes the app shell — the activate
// handler deletes any cache whose name doesn't match the current one, so
// installed PWAs get the new HTML/CSS/JS on next launch instead of being
// stuck on whatever '/' was cache-first-served at first install.
const CACHE = 'enocean-v2';
const ASSETS = ['/'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Don't cache API calls
  if (e.request.url.includes('/api/')) return;

  // Network-first for navigation/HTML requests so the captain always gets
  // the latest app shell when online (cache-first here was pinning users
  // to stale index.html until they cleared site data). Fall back to cache
  // for offline use.
  const isNavigation =
    e.request.mode === 'navigate' ||
    (e.request.method === 'GET' &&
     (e.request.headers.get('accept') || '').includes('text/html'));

  if (isNavigation) {
    e.respondWith(
      fetch(e.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(e.request).then(c => c || caches.match('/')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      return cached || fetch(e.request).then(response => {
        // Cache successful GET requests
        if (e.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
