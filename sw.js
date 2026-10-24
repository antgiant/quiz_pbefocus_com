// Service worker, generated into /sw.js by scripts/build-data.mjs (do not edit sw.js).
// The version and file list below are filled in at build time, so sw.js changes
// byte for byte whenever the app changes and browsers pick up the update.
//
//  - App files: precached as one versioned set and served cache-first, so a
//    returning visitor never waits on the network (or on GitHub Pages' 10-minute
//    cache) to start the app. A new version installs in the background and takes
//    over once every open tab is closed.
//  - Season packs and chapters carry their content hash in the URL, so they are
//    cached forever (old ones are pruned when the manifest changes).
//  - The manifest and other small data files are served from cache and
//    refreshed in the background, so new questions arrive on the next visit.

const VERSION = "04179e6ebe";
const SHELL = [
  "assets/apple-touch-icon.png",
  "assets/css/print.css",
  "assets/css/styles.css",
  "assets/hero-bible.webp",
  "assets/js/analysis-store.js",
  "assets/js/blank-engine.js",
  "assets/js/confetti.js",
  "assets/js/constants.js",
  "assets/js/data-service.js",
  "assets/js/exporters.js",
  "assets/js/import-study.js",
  "assets/js/lazy-vendor.js",
  "assets/js/main.js",
  "assets/js/pack-store.js",
  "assets/js/question-formatters.js",
  "assets/js/quiz-engine.js",
  "assets/js/renderers.js",
  "assets/js/storage.js",
  "assets/js/sw-register.js",
  "assets/js/utils.js",
  "assets/js/verse-store.js",
  "assets/pbefocus-logo-dark.webp",
  "assets/pbefocus-logo.webp",
  "assets/vendor/compromise.min.js",
  "assets/vendor/jszip.min.js",
  "favicon.ico",
  "index.html"
];
const SHELL_CACHE = `pbe-shell-${VERSION}`;
const DATA_CACHE = "pbe-data-v1";
const REFRESHED = [
  "questions/v1/manifest.json",
  "questions/v1/packs/index.json",
  "questions/v1/years.json",
  "questions/v1/practice-chapters-by-year.json",
  "questions/v1/practice-books.json",
];

const BASE = new URL("./", self.location).pathname;

function relativePath(url) {
  return url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : null;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL.map((path) => new Request(path, { cache: "reload" }))))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("pbe-shell-") && name !== SHELL_CACHE)
            .map((name) => caches.delete(name))
        )
      )
  );
});

async function cacheFirst(request, cacheName, { ignoreSearch = false, store = true } = {}) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch });
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (store && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

// Removes cached packs and chapters the freshly downloaded index/manifest no longer lists
async function prune(cache, rel, response) {
  try {
    const payload = await response.clone().json();
    const keep = new Set();
    let prefix;
    if (rel.endsWith("packs/index.json")) {
      prefix = "questions/v1/packs/";
      for (const entry of Object.values(payload.years || {})) keep.add(`questions/v1/${entry.path}`);
      keep.add(`${prefix}index.json`);
    } else if (rel.endsWith("manifest.json")) {
      prefix = "questions/v1/by-chapter/";
      for (const book of payload.books || []) {
        for (const chapter of book.chapters || []) {
          if (chapter.path && chapter.hash) keep.add(`questions/v1/${chapter.path}?v=${chapter.hash}`);
        }
      }
    } else {
      return;
    }
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      const key = relativePath(url);
      if (key && key.startsWith(prefix) && !keep.has(key + url.search)) {
        await cache.delete(request);
      }
    }
  } catch {
    // an unreadable response just skips pruning
  }
}

async function refreshed(event, request, rel) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  const update = fetch(new Request(request, { cache: "no-cache" }))
    .then(async (response) => {
      if (response.ok) {
        await cache.put(request, response.clone());
        await prune(cache, rel, response);
      }
      return response;
    })
    .catch(() => cached);
  event.waitUntil(update);
  return cached || update;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  const rel = relativePath(url);
  if (rel === null) {
    return;
  }

  if (request.mode === "navigate" && (rel === "" || rel === "index.html")) {
    event.respondWith(cacheFirst("index.html", SHELL_CACHE, { store: false }).catch(() => fetch(request)));
    return;
  }
  if (SHELL.includes(rel)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE, { ignoreSearch: true }));
    return;
  }
  // Libraries, images and audio that are not part of the precache load on first use
  if (rel.startsWith("assets/")) {
    event.respondWith(cacheFirst(request, SHELL_CACHE, { ignoreSearch: true }));
    return;
  }
  if (REFRESHED.includes(rel)) {
    event.respondWith(refreshed(event, request, rel));
    return;
  }
  // Content-addressed data: the hash is in the file name or the ?v= query
  if (/^questions\/v1\/packs\/.+\.[0-9a-f]{12}\.json$/.test(rel) || (rel.startsWith("questions/v1/by-chapter/") && url.searchParams.has("v"))) {
    event.respondWith(cacheFirst(request, DATA_CACHE));
  }
});
