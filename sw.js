const VERSION = 'v2.0.0';
const STATIC_CACHE = `rotaleitura-static-${VERSION}`;
const RUNTIME_CACHE = `rotaleitura-runtime-${VERSION}`;
const MAP_CACHE = `rotaleitura-map-${VERSION}`;
const SATELLITE_CACHE = `rotaleitura-satellite-${VERSION}`;

const MAP_CACHE_LIMIT = 500;
const SATELLITE_CACHE_LIMIT = 250;
let tileWrites = 0;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './assets/app.css',
  './src/app.js',
  './src/config.js',
  './src/data-repository.js',
  './src/map-controller.js',
  './src/offline-db.js',
  './src/utils.js',
  './launchericon-192x192.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const validCaches = new Set([
      STATIC_CACHE,
      RUNTIME_CACHE,
      MAP_CACHE,
      SATELLITE_CACHE
    ]);

    const keys = await caches.keys();
    await Promise.all(keys.map((key) => (
      validCaches.has(key) ? Promise.resolve() : caches.delete(key)
    )));

    await Promise.all([
      trimCache(MAP_CACHE, MAP_CACHE_LIMIT),
      trimCache(SATELLITE_CACHE, SATELLITE_CACHE_LIMIT)
    ]);

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;

  if (isFirebaseRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE, './index.html'));
    return;
  }

  // Os bancos grandes já ficam no IndexedDB. Não os duplica no Cache Storage.
  if (isAreaDataFile(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.pathname.endsWith('/indexes.json')) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  if (isOpenStreetMapTile(url)) {
    event.respondWith(cacheTile(request, MAP_CACHE, MAP_CACHE_LIMIT));
    return;
  }

  if (isSatelliteTile(url)) {
    event.respondWith(cacheTile(request, SATELLITE_CACHE, SATELLITE_CACHE_LIMIT));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

function isFirebaseRequest(url) {
  return url.hostname.includes('googleapis.com')
    || url.hostname.includes('gstatic.com')
    || url.hostname.includes('firebaseio.com');
}

function isAreaDataFile(url) {
  return /^\/?.*\/\d+_\d+\.json$/i.test(url.pathname);
}

function isOpenStreetMapTile(url) {
  return url.hostname.endsWith('tile.openstreetmap.org');
}

function isSatelliteTile(url) {
  return url.hostname === 'server.arcgisonline.com';
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName, fallbackPath = null) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    if (fallbackPath) {
      const fallback = await caches.match(fallbackPath);
      if (fallback) return fallback;
    }

    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (response.ok || response.type === 'opaque') {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    network.catch(() => null);
    return cached;
  }

  return await network ?? Response.error();
}

async function cacheTile(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    await cache.put(request, response.clone());
    tileWrites += 1;

    // Evita executar cache.keys() em cada tile, que também causaria lentidão.
    if (tileWrites % 25 === 0) {
      await trimCache(cacheName, limit);
    }
  }

  return response;
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;

  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((request) => cache.delete(request)));
}
