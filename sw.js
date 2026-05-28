const CACHE_NAME = 'rotaleitura-v1';

const urlsToCache = [
  '/RotaLeitura/',
  '/RotaLeitura/index.html',
  '/RotaLeitura/manifest.json',
  '/RotaLeitura/launchericon-192x192.png',
  '/RotaLeitura/launchericon-512x512.png'
];

self.addEventListener('install', event => {

  event.waitUntil(

    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))

  );

  self.skipWaiting();

});

self.addEventListener('activate', event => {

  event.waitUntil(

    caches.keys().then(keys => {

      return Promise.all(

        keys.map(key => {

          if(key !== CACHE_NAME){

            return caches.delete(key);

          }

        })

      );

    })

  );

  self.clients.claim();

});

self.addEventListener('fetch', event => {

  event.respondWith(

    caches.match(event.request)
      .then(response => {

        return response || fetch(event.request);

      })

  );

});
