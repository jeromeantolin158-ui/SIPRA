/* CHORDIFY service worker: keeps the app working with no internet.
   Online  -> always loads the newest files (and refreshes the saved copy).
   Offline -> loads the saved copy.
   Change VERSION if you add or rename files in FILES. */
const VERSION = "chordify-v1";
const FILES = [
  "./",
  "style.css",
  "app.js",
  "pptxgen.bundle.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "fonts/fraunces-latin-opsz-normal.woff2",
  "fonts/jetbrains-mono-latin-400-normal.woff2",
  "fonts/jetbrains-mono-latin-700-normal.woff2",
  "fonts/outfit-latin-400-normal.woff2",
  "fonts/outfit-latin-500-normal.woff2",
  "fonts/outfit-latin-600-normal.woff2"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === "navigate" ? caches.match("./") : Response.error()))
      )
  );
});
