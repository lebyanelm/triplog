/* Trip Logger core logic (pure functions, no DOM). Works in browser and Node. */
(function (root) {
  'use strict';
  var MAX_ACCURACY_M = 50, MIN_MOVE_M = 25, MAX_SPEED_KMH = 150;

  function haversineM(a, b) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* track = {last:{lat,lng,t}|null, meters:number}. point = {lat,lng,accuracy,t(ms)}.
     Returns {track, accepted, reason}. Never mutates input. */
  function addPoint(track, p) {
    track = track || { last: null, meters: 0 };
    if (p.accuracy == null || p.accuracy > MAX_ACCURACY_M) return { track: track, accepted: false, reason: 'inaccurate' };
    if (!track.last) return { track: { last: pick(p), meters: track.meters }, accepted: true, reason: 'first' };
    var d = haversineM(track.last, p);
    if (d < MIN_MOVE_M) return { track: track, accepted: false, reason: 'jitter' };
    var hrs = (p.t - track.last.t) / 3600000;
    if (hrs <= 0 || (d / 1000) / hrs > MAX_SPEED_KMH) return { track: track, accepted: false, reason: 'jump' };
    return { track: { last: pick(p), meters: track.meters + d }, accepted: true, reason: 'moved' };
  }
  function pick(p) { return { lat: p.lat, lng: p.lng, t: p.t }; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* Local (phone) date/time helpers; phone is expected to be on SAST. */
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function round1(x) { return Math.round(x * 10) / 10; }

  /* Official km: odometer if both readings valid, else GPS. */
  function officialKm(day) {
    var gps = round1((day.meters || 0) / 1000), odo = null;
    if (isFinite(day.odoStart) && isFinite(day.odoEnd) && day.odoStart !== null && day.odoEnd !== null && day.odoEnd >= day.odoStart)
      odo = round1(day.odoEnd - day.odoStart);
    return { gps: gps, odo: odo, official: odo !== null ? odo : gps, diff: odo !== null ? round1(odo - gps) : null };
  }

  /* Legs: each stop is a leg declared when leaving. km for leg = km at next leg start (or day total) - km at this leg start. */
  function legKms(day) {
    var stops = day.stops || [], total = round1((day.meters || 0) / 1000);
    return stops.map(function (s, i) { var end = i + 1 < stops.length ? stops[i + 1].km : total; return round1(Math.max(0, end - (s.km || 0))); });
  }
  function toPayload(day) {
    var k = officialKm(day), stops = day.stops || [], lk = legKms(day);
    var purposes = stops.map(function (s) { return s.destination + ': ' + s.purpose + (s.note ? ' (' + s.note + ')' : ''); });
    var decl = stops.map(function (s, i) { return 'Leg ' + (i + 1) + ': ' + (s.activity || s.purpose) + (s.doneSoFar ? ' | done so far: ' + s.doneSoFar : '') + (s.notes ? ' | ' + s.notes : '') + (s.hasAudio ? ' [voice memo]' : ''); });
    return {
      date: day.date, startTime: day.startTime || '', endTime: day.endTime || '',
      startLocation: day.startLocation || '',
      destinations: stops.map(function (s) { return s.destination; }).join(' \u2192 '),
      gpsKm: k.gps, odometerKm: k.odo === null ? '' : k.odo,
      purposeNotes: purposes.join('; '), declarations: decl.join('\n'),
      stops: stops.map(function (s, i) { return { leg: i + 1, time: s.time, from: s.from || (i ? stops[i - 1].destination : day.startLocation || ''),
        destination: s.destination, activity: s.activity || '', doneSoFar: s.doneSoFar || '', notes: s.notes || '',
        purpose: s.purpose + (s.note ? ' - ' + s.note : ''), lat: s.lat, lng: s.lng, kmSinceStart: s.km, legKm: lk[i], hasAudio: !!s.hasAudio,
        arrivedTime: s.arrivedTime || '', arrivalNotes: s.arrivalNotes || '', propType: s.propType || '', leaseSale: s.leaseSale || '', size: s.size || '', brokerBoard: s.brokerBoard || '', photos: s.photos == null ? '' : s.photos, propertyId: s.propertyId || '', markVisited: !!s.markVisited, hasArrAudio: !!s.hasArrAudio }; })
    };
  }

  /* Audio limits: Apps Script POST bodies are large-ish but base64 adds 33%; reject over 5 MB raw. */
  var MAX_AUDIO_BYTES = 5 * 1024 * 1024;
  function audioCheck(bytes) { return bytes > MAX_AUDIO_BYTES ? { ok: false, error: 'Voice memo is ' + (bytes / 1048576).toFixed(1) + ' MB - too big to upload (limit 5 MB). Please record a shorter memo.' } : { ok: true }; }
  function pickMime(isSupported) {
    var c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < c.length; i++) if (isSupported(c[i])) return c[i];
    return '';
  }

  /* Queue: one entry per date (latest wins) => idempotent with server upsert. */
  function enqueue(queue, payload) {
    var q = (queue || []).filter(function (e) { return e.date !== payload.date; });
    q.push({ date: payload.date, payload: payload, attempts: 0, nextTry: 0 });
    return q;
  }
  function markResult(queue, date, ok, now) {
    return queue.reduce(function (acc, e) {
      if (e.date !== date) { acc.push(e); return acc; }
      if (ok) return acc;
      var a = e.attempts + 1;
      acc.push({ date: e.date, payload: e.payload, attempts: a, nextTry: now + backoffMs(a) });
      return acc;
    }, []);
  }
  function backoffMs(attempts) { return Math.min(30 * 60000, 15000 * Math.pow(2, attempts - 1)); }
  function due(queue, now) { return (queue || []).filter(function (e) { return e.nextTry <= now; }); }

  /* Which reminder is due at this local time? Returns id or null. sent = {id:true}. */
  function reminderDue(now, day, sent) {
    var wd = now.getDay(); if (wd === 0 || wd === 6) return null;
    var mins = now.getHours() * 60 + now.getMinutes(), id;
    if (mins >= 510 && mins < 570 && !(day && day.startTime)) { id = 'start'; }
    else if (mins >= 1020 && mins < 1080 && day && day.startTime) { id = 'end'; }
    else if (mins >= 570 && mins < 1020 && now.getMinutes() >= 30 && day && day.startTime && !day.endTime) { id = 'h' + now.getHours(); }
    else return null;
    return sent && sent[id] ? null : id;
  }

  function csvCell(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCsv(days) {
    var rows = [['Date', 'Start time', 'End time', 'Start location', 'Destinations', 'Total km (GPS)', 'Odometer km', 'Official km', 'Purpose notes']];
    days.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (d) {
      var p = toPayload(d), k = officialKm(d);
      rows.push([p.date, p.startTime, p.endTime, p.startLocation, p.destinations, p.gpsKm, p.odometerKm, k.official, p.purposeNotes]);
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }


  /* ---------- Navigation helpers (pure) ---------- */
  function distToSegM(p, a, b) {
    var k = Math.cos(p.lat * Math.PI / 180) * 111320, m = 110540;
    var ax = (a.lng - p.lng) * k, ay = (a.lat - p.lat) * m, bx = (b.lng - p.lng) * k, by = (b.lat - p.lat) * m;
    var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    var x = ax + t * dx, y = ay + t * dy; return Math.sqrt(x * x + y * y);
  }
  function distToRouteM(p, coords) {
    var best = Infinity;
    for (var i = 1; i < coords.length; i++) best = Math.min(best, distToSegM(p, { lat: coords[i - 1][0], lng: coords[i - 1][1] }, { lat: coords[i][0], lng: coords[i][1] }));
    if (coords.length === 1) best = haversineM(p, { lat: coords[0][0], lng: coords[0][1] });
    return best;
  }
  function osrmText(st) {
    var m = st.maneuver || {}, road = st.name ? ' onto ' + st.name : '', mod = m.modifier ? m.modifier.replace('slight ', 'slightly ') : '';
    switch (m.type) {
      case 'depart': return 'Head off' + (st.name ? ' on ' + st.name : '');
      case 'arrive': return 'You have arrived at your destination';
      case 'roundabout': case 'rotary': return 'At the roundabout, take exit ' + (m.exit || '') + road;
      case 'merge': return 'Merge' + (mod ? ' ' + mod : '') + road;
      case 'on ramp': return 'Take the ramp' + road; case 'off ramp': return 'Take the exit' + road;
      case 'fork': return 'Keep ' + (mod || 'ahead') + ' at the fork' + road;
      case 'end of road': return 'At the end of the road, turn ' + (mod || '') + road;
      case 'continue': case 'new name': return 'Continue' + (mod && mod !== 'straight' ? ' ' + mod : '') + road;
      default: return mod === 'straight' ? 'Go straight' + road : mod === 'uturn' ? 'Make a U-turn' + road : 'Turn ' + (mod || '') + road;
    }
  }
  function parseOsrm(j) {
    var r = j.routes && j.routes[0]; if (!r) throw new Error('No route found');
    var steps = []; r.legs.forEach(function (l) { l.steps.forEach(function (st) {
      steps.push({ text: osrmText(st), lat: st.maneuver.location[1], lng: st.maneuver.location[0], dist: st.distance }); }); });
    return { coords: r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }), steps: steps, distance: r.distance, duration: r.duration, source: 'OSRM' };
  }
  function parseOrs(j) {
    var f = j.features && j.features[0]; if (!f) throw new Error('No route found');
    var coords = f.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }), steps = [];
    f.properties.segments.forEach(function (sg) { sg.steps.forEach(function (st) {
      var c = coords[st.way_points[0]]; steps.push({ text: st.instruction, lat: c[0], lng: c[1], dist: st.distance }); }); });
    var sm = f.properties.summary || {};
    return { coords: coords, steps: steps, distance: sm.distance, duration: sm.duration, source: 'openrouteservice' };
  }
  /* nav = {route, dest:{lat,lng}, idx, warned:{}, offSince, lastReroute}. Returns {nav, speak, reroute, arrived, offRoute, toNextM}. */
  function navUpdate(nav, p, now) {
    var n = Object.assign({}, nav), out = { nav: n, speak: null, reroute: false, arrived: false, offRoute: false, toNextM: null };
    if (haversineM(p, n.dest) <= 50) { out.arrived = true; return out; }
    var steps = n.route.steps, idx = n.idx || 0;
    while (idx + 1 < steps.length && haversineM(p, steps[idx + 1]) < 30) { idx++; out.speak = steps[idx].text; }
    n.idx = idx;
    if (idx + 1 < steps.length) {
      var d = haversineM(p, steps[idx + 1]); out.toNextM = Math.round(d);
      n.warned = Object.assign({}, n.warned || {});
      if (d < 200 && d > 60 && !n.warned[idx + 1]) { n.warned[idx + 1] = true; out.speak = out.speak || ('In ' + (Math.round(d / 10) * 10) + ' metres, ' + steps[idx + 1].text.charAt(0).toLowerCase() + steps[idx + 1].text.slice(1)); }
    }
    var off = distToRouteM(p, n.route.coords) > 60;
    out.offRoute = off;
    if (!off) n.offSince = null; else if (n.offSince == null) n.offSince = now;
    if (off && now - n.offSince > 10000 && (n.lastReroute == null || now - n.lastReroute >= 30000)) { out.reroute = true; n.lastReroute = now; n.offSince = null; }
    return out;
  }
  /* Simple rate limiter: returns ms to wait before the next call is allowed. */
  function waitMs(lastCall, now, minGap) { return Math.max(0, (lastCall || 0) + minGap - now); }

  var api = { haversineM: haversineM, addPoint: addPoint, dateKey: dateKey, hhmm: hhmm, officialKm: officialKm,
    toPayload: toPayload, enqueue: enqueue, markResult: markResult, backoffMs: backoffMs, due: due,
    reminderDue: reminderDue, distToRouteM: distToRouteM, osrmText: osrmText, parseOsrm: parseOsrm, parseOrs: parseOrs, navUpdate: navUpdate, waitMs: waitMs, legKms: legKms, audioCheck: audioCheck, pickMime: pickMime, MAX_AUDIO_BYTES: MAX_AUDIO_BYTES, toCsv: toCsv, round1: round1 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TripCore = api;
})(this);
