/* Done Deal Trip Log - navigation (OpenStreetMap + Leaflet, Nominatim search, openrouteservice / OSRM routing). */
(function () {
  'use strict';
  var C = window.TripCore, A = window.TripApp, $ = function (id) { return document.getElementById(id); };
  var GAUTENG_VIEWBOX = '27.30,-25.40,29.00,-26.90'; /* lon/lat left,top,right,bottom */
  var map = null, routeLine = null, meMarker = null, destMarker = null, nav = null, lastSearch = 0, debounce = null, props = null, voices = null, routing = false;

  function settings() { return A.state.settings || {}; }

  /* ---------- Search (Nominatim, max 1 request/second, debounced) ---------- */
  $('btnNav').onclick = function () { $('navSearch').classList.remove('hidden'); $('navQuery').focus(); };
  $('btnCancelNav').onclick = function () { $('navSearch').classList.add('hidden'); $('navResults').innerHTML = ''; };
  $('navQuery').oninput = function () { clearTimeout(debounce); var q = this.value.trim(); if (q.length < 3) return; debounce = setTimeout(function () { search(q); }, 900); };
  function geocode(q) {
    var wait = C.waitMs(lastSearch, Date.now(), 1100);
    return new Promise(function (r) { setTimeout(r, wait); }).then(function () {
      lastSearch = Date.now();
      if (!navigator.onLine) throw new Error('Search needs signal. Try again when you are online.');
      var u = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=za&viewbox=' + GAUTENG_VIEWBOX +
        '&q=' + encodeURIComponent(q) + (settings().email ? '&email=' + encodeURIComponent(settings().email) : '');
      return fetch(u, { referrerPolicy: 'strict-origin-when-cross-origin', headers: { 'Accept-Language': 'en' } })
        .then(function (r) { if (!r.ok) throw new Error('Search failed (' + r.status + ')'); return r.json(); });
    });
  }
  function search(q) {
    geocode(q).then(function (res) {
      var ul = $('navResults'); ul.innerHTML = '';
      if (!res.length) { ul.innerHTML = '<li>No results. Try adding the suburb, e.g. "Wadeville".</li>'; return; }
      res.forEach(function (r) { addResult(r.display_name, { label: r.display_name.split(',').slice(0, 3).join(','), lat: +r.lat, lng: +r.lon }); });
    }).catch(function (e) { A.banner(e.message); });
  }
  function addResult(text, dest, needsGeocode) {
    var li = document.createElement('li'); li.textContent = text;
    li.onclick = function () {
      var go = function (d) { $('navSearch').classList.add('hidden'); $('navResults').innerHTML = ''; A.openDeclaration(d); };
      if (!needsGeocode) return go(dest);
      li.textContent = 'Finding location…';
      geocode(dest.address).then(function (res) {
        if (!res.length) { li.textContent = text + ' (address not found on map - type a nearby street instead)'; return; }
        dest.lat = +res[0].lat; dest.lng = +res[0].lon; go(dest);
      }).catch(function (e) { li.textContent = text; A.banner(e.message); });
    };
    $('navResults').appendChild(li);
  }
  /* Tracker properties come from the Apps Script (Properties tab); cached on the phone for offline picking. */
  $('btnLoadProps').onclick = function () {
    var show = function (list) { props = list; $('propFilter').classList.remove('hidden'); renderProps(''); };
    if (!settings().url) { A.banner('Set up the Google Sheet link in Settings first.'); return; }
    window.TripPost({ action: 'properties' }).then(function (j) { localStorage.setItem('props', JSON.stringify(j.properties)); show(j.properties); })
      .catch(function () { var c = localStorage.getItem('props'); if (c) { A.banner('Offline - showing saved list.'); show(JSON.parse(c)); } else A.banner('Could not load the tracker. Check signal and Settings.'); });
  };
  $('propFilter').oninput = function () { renderProps(this.value.toLowerCase()); };
  function renderProps(f) {
    $('navResults').innerHTML = '';
    (props || []).filter(function (p) { return !f || (p.id + ' ' + p.area + ' ' + p.address).toLowerCase().indexOf(f) >= 0; }).slice(0, 40).forEach(function (p) {
      addResult(p.id + ' \u2013 ' + p.address + ' (' + p.area + ', ' + p.status + ')', { label: p.id + ' ' + p.address, address: p.address + ', ' + String(p.area).replace(/\s*\(.*\)/, '') + ', Gauteng', propertyId: p.id }, true);
    });
  }

  /* ---------- Map ---------- */
  function ensureMap() {
    if (map) { setTimeout(function () { map.invalidateSize(); }, 50); return; }
    map = L.map('map', { zoomControl: true }).setView([-26.2, 28.2], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    L.Icon.Default.imagePath = 'vendor/leaflet/images/';
  }

  /* ---------- Routing ---------- */
  function getRoute(from, to) {
    if (!navigator.onLine) return Promise.reject(new Error('No signal - can\u2019t get a new route. Keep following the last route or the map.'));
    var key = settings().ors;
    var osrm = function () {
      return fetch('https://router.project-osrm.org/route/v1/driving/' + from.lng + ',' + from.lat + ';' + to.lng + ',' + to.lat + '?overview=full&geometries=geojson&steps=true')
        .then(function (r) { if (!r.ok) throw new Error('Route server busy (' + r.status + ')'); return r.json(); }).then(C.parseOsrm);
    };
    if (!key) return osrm();
    return fetch('https://api.openrouteservice.org/v2/directions/driving-car?api_key=' + encodeURIComponent(key) + '&start=' + from.lng + ',' + from.lat + '&end=' + to.lng + ',' + to.lat)
      .then(function (r) { if (!r.ok) throw new Error('ORS ' + r.status); return r.json(); }).then(C.parseOrs)
      .catch(function () { return osrm(); });
  }
  function showRoute(r) {
    if (routeLine) routeLine.remove();
    routeLine = L.polyline(r.coords, { color: '#1F4E79', weight: 6 }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });
    var ol = $('navSteps'); ol.innerHTML = '';
    r.steps.forEach(function (s, i) { var li = document.createElement('li'); li.id = 'step' + i;
      li.textContent = s.text + (s.dist ? ' (' + (s.dist >= 1000 ? (s.dist / 1000).toFixed(1) + ' km' : Math.round(s.dist) + ' m') + ')' : ''); ol.appendChild(li); });
    try { localStorage.setItem('lastRoute', JSON.stringify({ route: r, dest: nav.dest })); } catch (e) {}
  }
  function route(from, isReroute) {
    if (routing) return; routing = true;
    getRoute(from, nav.dest).then(function (r) {
      nav.route = r; nav.idx = 0; nav.warned = {}; showRoute(r);
      var msg = (isReroute ? 'New route. ' : '') + (r.steps[0] ? r.steps[0].text : 'Drive to destination');
      setBanner(msg + ' \u2013 ' + (r.distance / 1000).toFixed(1) + ' km, about ' + Math.round(r.duration / 60) + ' min'); say(msg); highlight(0);
    }).catch(function (e) { setBanner(e.message, true); }).then(function () { routing = false; });
  }
  function setBanner(t, bad) { $('navBanner').textContent = t; $('navBanner').classList.toggle('off', !!bad); }
  function highlight(i) { Array.prototype.forEach.call($('navSteps').children, function (li, j) { li.classList.toggle('cur', j === i + 1); }); }

  /* ---------- Speech ---------- */
  function say(t) {
    if (!t || !$('navVoice').checked || !window.speechSynthesis) return;
    voices = voices || speechSynthesis.getVoices();
    var u = new SpeechSynthesisUtterance(t), v = voices.filter(function (x) { return x.lang === 'en-ZA'; })[0] || voices.filter(function (x) { return /^en/.test(x.lang); })[0];
    if (v) u.voice = v; u.lang = v ? v.lang : 'en-ZA'; speechSynthesis.cancel(); speechSynthesis.speak(u);
  }
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = function () { voices = speechSynthesis.getVoices(); };

  /* ---------- Lifecycle (called by app.js) ---------- */
  function start(dest) {
    nav = { dest: { lat: dest.lat, lng: dest.lng }, label: dest.label, idx: 0, route: null };
    $('navView').classList.remove('hidden'); ensureMap();
    if (destMarker) destMarker.remove(); destMarker = L.marker([dest.lat, dest.lng]).addTo(map).bindPopup(dest.label);
    var f = A.state.lastFix;
    if (f) route(f); else setBanner('Waiting for GPS…');
    say('Starting navigation to ' + dest.label);
  }
  function stop() { nav = null; $('navView').classList.add('hidden'); if (window.speechSynthesis) speechSynthesis.cancel(); }
  function onFix(p) {
    if (!nav || !map) return;
    if (!meMarker) meMarker = L.circleMarker([p.lat, p.lng], { radius: 8, color: '#fff', fillColor: '#2979ff', fillOpacity: 1, weight: 3 }).addTo(map);
    else meMarker.setLatLng([p.lat, p.lng]);
    if (p.accuracy > 50) return;
    if (!nav.route) { route(p); return; }
    var u = C.navUpdate(nav, p, Date.now()); nav = u.nav;
    if (u.arrived) { say('You have arrived.'); setBanner('You have arrived. Park, then add arrival notes.'); nav = null; A.openArrival(); return; }
    if (u.speak) say(u.speak);
    highlight(nav.idx);
    var next = nav.route.steps[nav.idx + 1];
    if (u.offRoute) setBanner('Off route\u2026', true);
    else if (next) setBanner(next.text + (u.toNextM != null ? ' in ' + (u.toNextM >= 1000 ? (u.toNextM / 1000).toFixed(1) + ' km' : u.toNextM + ' m') : ''));
    if (u.reroute) { say('Rerouting'); route(p, true); }
  }
  $('btnArrived').onclick = function () { nav = null; A.openArrival(); };
  $('btnEndNav').onclick = stop;
  window.TripNav = { start: start, stop: stop, onFix: onFix };
})();
