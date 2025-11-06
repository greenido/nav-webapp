// TrailTrack Service Worker for Offline Support

const CACHE_NAME = 'trailtrack-v1';
const TILE_CACHE_NAME = 'trailtrack-tiles-v1';

// Assets to cache on install
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/manifest.json',
    'https://cdn.tailwindcss.com',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/@mapbox/togeojson@0.16.0/togeojson.js',
    'https://unpkg.com/togpx@0.5.0/togpx.js',
    'https://unpkg.com/idb@7/build/umd.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS.filter(url => !url.startsWith('http')));
        })
    );
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME && name !== TILE_CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Handle map tiles
    if (url.pathname.match(/\/\d+\/\d+\/\d+\.png$/)) {
        event.respondWith(
            caches.open(TILE_CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((response) => {
                    if (response) {
                        return response;
                    }
                    return fetch(event.request).then((response) => {
                        if (response.ok) {
                            cache.put(event.request, response.clone());
                        }
                        return response;
                    }).catch(() => {
                        // Return a placeholder tile if offline and not cached
                        return new Response('', { status: 404 });
                    });
                });
            })
        );
        return;
    }

    // Handle other requests
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request).catch(() => {
                // Return offline fallback for navigation requests
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html') || caches.match('/index.html');
                }
            });
        })
    );
});

// Message handler for cache management
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CACHE_TILES') {
        const tiles = event.data.tiles;
        event.waitUntil(
            caches.open(TILE_CACHE_NAME).then((cache) => {
                return Promise.all(
                    tiles.map((tileUrl) => {
                        return fetch(tileUrl)
                            .then((response) => {
                                if (response.ok) {
                                    return cache.put(tileUrl, response);
                                }
                            })
                            .catch(() => {
                                // Ignore failed tile fetches
                            });
                    })
                );
            })
        );
    }
});

