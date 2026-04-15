const CACHE_NAME = 'yebrams-v1';
const STATIC_ASSETS = ['/', '/index.html'];

// ── Install: pre-cache shell ───────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: cache-first assets, network-first API ───────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Network-first for API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => res)
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for everything else (assets, pages)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return res;
      });
    })
  );
});

// ── Push: show notification ────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title ?? "Yebram's";
  const options = {
    body: data.body ?? '',
    icon: 'https://cdn.jsdelivr.net/gh/luisgdr55/agente-restaurante@master/public/menu-images/heropwa.png',
    badge: 'https://cdn.jsdelivr.net/gh/luisgdr55/agente-restaurante@master/public/menu-images/heropwa.png',
    data: { url: data.url ?? '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open url ───────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
