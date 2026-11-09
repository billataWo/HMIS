/*
 * HMIS service worker: lets the offline workspace open with no network.
 *
 * - /_next/static/* (fingerprinted build files): served from the cache once seen, so the app's
 *   scripts, styles and fonts are available offline.
 * - Page loads: from the network; when the server can't be reached, the cached offline workspace
 *   (/offline, stored by the app while online) is shown instead of the browser's error page.
 * Nothing else is cached: patient data lives in IndexedDB, managed by the app itself. Data exports
 * (downloads) are not touched at all.
 */
const SHELL = "hmis-shell-v1";
const STATIC = "hmis-static-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, STATIC]);
      for (const name of await caches.keys()) if (name.startsWith("hmis-") && !keep.has(name)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

async function staticFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function offlineShell() {
  const shell = await caches.open(SHELL);
  return (await shell.match("/offline")) ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Downloads (data exports) go straight to the network: passed through here, a streamed file is
  // dropped by the browser, and an export needs the connection anyway.
  if (url.pathname.startsWith("/settings/data/download") || url.pathname.endsWith("/export")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          // A proxy in front of a stopped app answers 502/503/504: treat like no connection.
          if (res.status >= 502 && res.status <= 504) return offlineShell();
          return res;
        } catch {
          return offlineShell();
        }
      })(),
    );
  }
});
