/*
 * Service worker for Logins: installable, and opens without a network.
 *
 * It never touches Supabase or any other origin, and never a non-GET
 * request: card data and session tokens are not kept as copies here. (The
 * app's own opt-in copy for reading offline is in IndexedDB, not this cache.)
 *
 *   navigations         network first, falling back to the last good shell
 *   hashed build files  cache first; their names change every build
 *   icons, manifest     cache first, refreshed in the background
 *
 * Raise VERSION when the icons change, so installed copies replace them.
 */

const VERSION = 'v2';
const PREFIX = 'logins-';
const SHELL = `${PREFIX}shell-${VERSION}`;
const ASSETS = `${PREFIX}assets-${VERSION}`;
const MINE = new Set([SHELL, ASSETS]);

const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/assets/logo/favicon.svg',
  '/assets/logo/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // One bad URL should not fail the whole install.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n.startsWith(PREFIX) && !MINE.has(n)).map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }

  if (isHashed(url.pathname)) {
    event.respondWith(cacheFirst(request, false));
  } else if (isStatic(url.pathname)) {
    event.respondWith(cacheFirst(request, true));
  }
});

async function navigate(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL);
      cache.put('/', response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.match(request)) || (await caches.match('/'));
    if (cached) return cached;
    throw new Error('offline and nothing cached');
  }
}

async function cacheFirst(request, refresh) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached && !refresh) return cached;

  const update = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  const fresh = await update;
  if (fresh) return fresh;
  throw new Error(`offline and not cached: ${request.url}`);
}

function isHashed(pathname) {
  return /^\/(?:(?:main|chunk|polyfills|styles)-[^/]+\.(?:js|css)|media\/.+)$/.test(pathname);
}

function isStatic(pathname) {
  return /\.(?:woff2?|png|svg|ico|webmanifest)$/i.test(pathname);
}
