// Kill-switch service worker. The old LOL2D PWA precached the whole game and
// served it offline-first, so returning players would never see the redirect
// page at all — their old worker answers every navigation from cache. This
// worker replaces it on the browser's next update check: it takes over
// immediately, deletes every cache, unregisters itself, and reloads open
// tabs so they land on the network copy of index.html, which forwards to
// https://moba2d.pages.dev/.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const client of windows) client.navigate(client.url);
    })()
  );
});
