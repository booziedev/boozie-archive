/**
 * Service worker for the installed (iOS home screen / desktop PWA) experience.
 *
 * Strategy:
 *  - navigations      -> network first, fall back to the cached app shell so the
 *                        app still opens when the Pi or the tunnel is down;
 *  - hashed assets    -> cache first (their URL changes on every deploy);
 *  - cover art        -> cache first with a bounded cache;
 *  - audio + API JSON -> never cached. Range requests must reach the network or
 *                        seeking breaks in Safari, and stale metadata is worse
 *                        than a spinner.
 */
const VERSION = 'v1';
const SHELL_CACHE = `archive-shell-${VERSION}`;
const ASSET_CACHE = `archive-assets-${VERSION}`;
const COVER_CACHE = `archive-covers-${VERSION}`;
const COVER_LIMIT = 400;

const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/** Keeps the cover cache from growing without bound on long sessions. */
async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Audio must stream straight from the network: partial responses cannot be
  // cached safely and iOS relies on 206 replies for seeking.
  if (
    request.headers.has('range') ||
    url.pathname.includes('/api/stream/') ||
    url.pathname.includes('/api/download/')
  ) {
    return;
  }

  if (url.pathname.includes('/api/cover/')) {
    event.respondWith(
      caches.open(COVER_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        try {
          const response = await fetch(request);
          if (response.ok) {
            await cache.put(request, response.clone());
            void trimCache(COVER_CACHE, COVER_LIMIT);
          }
          return response;
        } catch (error) {
          return hit ?? Response.error();
        }
      }),
    );
    return;
  }

  // Metadata is always fetched live; react-query handles its own caching.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('/index.html')) ?? (await cache.match('/')) ?? Response.error();
      }),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) {
          await cache.put(request, response.clone());
        }
        return response;
      }),
    );
  }
});
