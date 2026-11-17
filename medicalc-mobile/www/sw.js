/* MediCalc Pro service worker: offline app shell for the PWA build.
   Not registered inside the native Android app (assets are already local there).
   Bump CACHE whenever any file in the list below changes. */
const CACHE = 'medicalc-v1.0.0';
const FILES = [
    './', './index.html', './manifest.webmanifest',
    './css/app.css', './js/calc.js', './js/registry.js', './js/app.js',
    './assets/icons/mark.svg', './assets/icons/icon-192.png', './assets/icons/icon-512.png',
    './assets/icons/maskable-512.png', './assets/icons/favicon-32.png', './assets/icons/apple-touch-icon.png',
    './assets/fonts/MCSans-400.woff', './assets/fonts/MCSans-600.woff', './assets/fonts/MCSans-700.woff',
    './assets/fonts/MCDisplay-600.woff', './assets/fonts/MCDisplay-700.woff', './assets/fonts/MCDisplay-800.woff'
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Cache-first for the app shell; fall back to the network for anything else.
self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    e.respondWith(
        caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
    );
});
