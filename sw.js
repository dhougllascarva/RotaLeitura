const CACHE_NAME = 'rotaleitura-v15000';

const urlsToCache = [

  '/RotaLeiturav2/',
  '/RotaLeiturav2/index.html',
  '/RotaLeiturav2/manifest.json',

  '/RotaLeiturav2/launchericon-192x192.png',
  '/RotaLeiturav2/launchericon-512x512.png'

];

self.addEventListener('install', event => {

  self.skipWaiting();

  event.waitUntil(

    caches.open(CACHE_NAME)
      .then(cache => {

        return cache.addAll(urlsToCache);

      })

  );

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
