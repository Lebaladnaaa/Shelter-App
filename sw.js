/* Shelter Surveys – keeps the app available without internet.
 * Change VERSION whenever you upload new app files, so phones fetch the update.
 */
const VERSION = 'shelter-v1.5.0';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './config.js',
  './manifest.webmanifest',
  './shelter-logo.png',
  './lebaladna-logo.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './barlow-condensed-600.woff2',
  './barlow-condensed-700.woff2',
  './jspdf.umd.min.js',
  './pptxgen.bundle.js',
  './qrcode.js'
];

// Save each file on its own: one missing file must not stop the rest from working offline.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(SHELL.map((f) => c.add(new Request(f, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the Google Sheet connection always goes to the network

  // Pages and config: try the network first (gets updates), fall back to the saved copy offline.
  if (req.mode === 'navigate' || url.pathname.endsWith('/config.js')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req.mode === 'navigate' ? './index.html' : req, copy)); }
          return res;
        })
        .catch(() => caches.match(req.mode === 'navigate' ? './index.html' : req, { ignoreSearch: true }))
    );
    return;
  }

  // Everything else: saved copy first, refresh it in the background.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
