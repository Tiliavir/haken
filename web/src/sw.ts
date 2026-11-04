/// <reference lib="webworker" />
/**
 * Service worker: caches the app shell for offline start. It imports
 * nothing and fetches only same-origin app-shell files. `/dav` and `/api`
 * are never cached and never touched.
 */
declare const self: ServiceWorkerGlobalScope;

const VERSION = "__HAKEN_BUILD__";
const CACHE = `haken-shell-${VERSION}`;
const MANIFEST = "shell-manifest.json";

function report(message: string): void {
  void self.clients.matchAll({ type: "window" }).then((clients) => {
    for (const c of clients) c.postMessage({ type: "sw-error", message });
  });
}

async function precache(): Promise<void> {
  const response = await fetch(MANIFEST, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`shell manifest ${response.status}`);
  const files: unknown = await response.json();
  if (
    !Array.isArray(files) ||
    files.some((f) => typeof f !== "string" || f.startsWith("/") || f.includes(".."))
  ) {
    throw new Error("shell manifest has an unexpected shape");
  }
  const cache = await caches.open(CACHE);
  await cache.addAll(["./", ...(files as string[])]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("haken-shell-") && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope).pathname;
  const rel = url.pathname.slice(scope.length);
  if (!url.pathname.startsWith(scope) || rel.startsWith("dav/") || rel.startsWith("api/")) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const key = event.request.mode === "navigate" ? "./" : event.request;
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit !== undefined) return hit;
      try {
        return await fetch(event.request);
      } catch (error) {
        report(
          `fetch failed for ${rel}: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    })(),
  );
});
