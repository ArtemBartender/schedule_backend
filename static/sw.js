const CACHE_NAME = 'grafik-smiian-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/static/manifest.json',
    '/static/icons/icon-192x192.png', // Убедись, что файлы есть
    '/static/icons/icon-512x512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .catch(error => {
                console.error('Cache install failed:', error);
                // Игнорируем ошибки, если иконки отсутствуют
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                // Кэшируем только GET-запросы к статическим файлам
                if (event.request.method === 'GET' && !event.request.url.includes('/api/')) {
                    return cachedResponse || fetch(event.request)
                        .then(response => {
                            return caches.open(CACHE_NAME)
                                .then(cache => {
                                    cache.put(event.request, response.clone());
                                    return response;
                                });
                        });
                }
                // Для API используем сеть с запасным кэшем
                return fetch(event.request)
                    .then(networkResponse => {
                        return caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, networkResponse.clone());
                                return networkResponse;
                            });
                    })
                    .catch(() => caches.match(event.request)); // Возвращаем кэш при ошибке сети
            })
    );
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (!cacheWhitelist.includes(cacheName)) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
