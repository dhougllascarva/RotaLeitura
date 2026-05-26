const CACHE_NAME = 'rotaleitura-v13000';

const urlsToCache = [

  './',
  './index.html',
  './manifest.json',
  './indexes.json',

  './171_1.json',
  './171_2.json',

  './172.json',

  './173_1.json',
  './173_2.json',

  './174.json',
  './175.json',
  './176.json',

  './launchericon-192x192.png',
  './launchericon-512x512.png'

];


// ======================================
// INSTALL
// ======================================

self.addEventListener('install', event => {

  self.skipWaiting();

  event.waitUntil(

    caches.open(CACHE_NAME)
      .then(cache => {

        return cache.addAll(urlsToCache);

      })

  );

});


// ======================================
// ACTIVATE
// ======================================

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


// ======================================
// FETCH
// ======================================

self.addEventListener('fetch', event => {

  const url = event.request.url;

  if(

    url.includes('firebase') ||
    url.includes('googleapis')

  ){

    event.respondWith(fetch(event.request));
    return;

  }

  if(
    url.includes('tile.openstreetmap.org')
  ){

    event.respondWith(

      caches.match(event.request)
        .then(response => {

          return response || fetch(event.request)
            .then(networkResponse => {

              caches.open(CACHE_NAME)
                .then(cache => {

                  cache.put(
                    event.request,
                    networkResponse.clone()
                  );

                });

              return networkResponse;

            });

        })

    );

    return;

  }

  event.respondWith(

    caches.match(event.request)
      .then(response => {

        return response || fetch(event.request);

      })

  );

});
