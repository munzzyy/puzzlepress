/*
  Puzzle Press service worker. Cache-first for precached assets, network
  falling back to cache for everything else. Bump CACHE_VERSION whenever
  PRECACHE changes so old caches get cleared on activate.
*/

const CACHE_VERSION = 4;
const CACHE_NAME = `puzzlepress-v${CACHE_VERSION}`;

const GAMES = ["wordrow", "clusters", "heptagram", "minigrid", "wordweave", "edgeways", "sudoku"];

const PRECACHE = [
  "./",
  "./index.html",
  "./404.html",
  "./robots.txt",
  "./manifest.webmanifest",
  "./assets/site.css",
  "./assets/shared.js",
  "./assets/icons/favicon.png",
  "./assets/icons/icon-16.png",
  "./assets/icons/icon-32.png",
  "./assets/icons/icon-180.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-192-maskable.png",
  "./assets/icons/icon-512-maskable.png",
  "./assets/icons/wordrow.svg",
  "./assets/icons/clusters.svg",
  "./assets/icons/heptagram.svg",
  "./assets/icons/minigrid.svg",
  "./assets/icons/wordweave.svg",
  "./assets/icons/edgeways.svg",
  "./assets/icons/sudoku.svg",
  "./games/edgeways/words.json",
];

for (const id of GAMES) {
  PRECACHE.push(
    `./games/${id}/index.html`,
    `./games/${id}/game.js`,
    `./games/${id}/core.js`,
    `./games/${id}/style.css`,
    `./data/${id}.json`
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(
          () =>
            new Response("Offline and not cached yet.", {
              status: 503,
              headers: { "Content-Type": "text/plain" },
            })
        );
    })
  );
});
