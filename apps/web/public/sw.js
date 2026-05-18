/* eslint-disable */
// Driver app service worker (Session 3).
//
// Scope: only requests under /driver/* and outbound API calls to
// /driver-* / /job-* are intercepted. Operator pages are left alone.
//
// Behavior:
//   - Network-first for everything. We don't pre-cache HTML.
//   - On a mutating fetch (POST/PATCH/DELETE) that fails because the
//     network is unreachable, we surface a 503-style synthetic
//     response so the page-side queue catches the error. The service
//     worker itself does NOT replay — replay lives in the page so the
//     localStorage queue is the single source of truth.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only intercept same-origin requests we know about.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Cheap allow-list: pretend the SW isn't there for operator pages.
  const isDriverApp = url.pathname.startsWith('/driver') || url.pathname.startsWith('/driver-');
  const isApiCall =
    url.pathname.startsWith('/driver-') ||
    url.pathname.startsWith('/job-') ||
    url.pathname.startsWith('/api');
  if (!isDriverApp && !isApiCall) return;

  event.respondWith(
    fetch(req).catch(() => {
      if (req.method !== 'GET') {
        return new Response(
          JSON.stringify({ code: 'offline', message: 'Network unavailable; queued locally' }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Offline', { status: 503 });
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'driver-skip-waiting') self.skipWaiting();
});
