/* Offline app shell + capped OpenStreetMap tile cache. */
var CACHE = 'triplog-v3', TILES = 'osm-tiles-v1', MAX_TILES = 2500; /* ~2,500 tiles x ~20 KB = ~50 MB */
var FILES = ['./', 'index.html', 'app.js', 'core.js', 'nav.js', 'styles.css', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png', 'vendor/leaflet/images/layers.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); })); self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) {
  return Promise.all(ks.filter(function (k) { return k !== CACHE && k !== TILES; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
var trimming = false;
function trimTiles() { if (trimming) return; trimming = true;
  caches.open(TILES).then(function (c) { return c.keys().then(function (ks) {
    var extra = ks.length - MAX_TILES; return Promise.all(ks.slice(0, Math.max(0, extra)).map(function (k) { return c.delete(k); })); }); })
  .then(function () { trimming = false; }, function () { trimming = false; }); }
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.hostname === 'tile.openstreetmap.org') { /* cache only tiles the user actually viewed - no bulk prefetching (OSM policy) */
    e.respondWith(caches.open(TILES).then(function (c) { return c.match(e.request).then(function (hit) {
      if (hit) return hit;
      return fetch(e.request).then(function (r) { if (r.ok || r.type === 'opaque') { c.put(e.request, r.clone()); trimTiles(); } return r; });
    }); }));
    return;
  }
  if (url.origin !== location.origin) return; /* search/routing/Apps Script go straight to network */
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
    var net = fetch(e.request).then(function (r) { var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, cp); }); return r; });
    return hit || net; }).catch(function () { return caches.match('index.html'); }));
});
self.addEventListener('notificationclick', function (e) { e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(function (cs) { return cs.length ? cs[0].focus() : self.clients.openWindow('./'); })); });
