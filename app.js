/* Done Deal Trip Log - UI, GPS, legs + declarations + voice memos, storage, sync, reminders. */
(function () {
  'use strict';
  var C = window.TripCore, $ = function (id) { return document.getElementById(id); };
  var state = { day: null, queue: [], aqueue: [], settings: { url: '', token: '' }, sent: {}, watchId: null, wakeLock: null, syncing: false, memo: null };

  /* ---------- IndexedDB key/value ---------- */
  var dbP = new Promise(function (res, rej) {
    var r = indexedDB.open('triplog', 1);
    r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
    r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
  });
  function tx(mode, fn) { return dbP.then(function (db) { return new Promise(function (res, rej) {
    var t = db.transaction('kv', mode), s = t.objectStore('kv'), out = fn(s);
    t.oncomplete = function () { res(out && out.result); }; t.onerror = function () { rej(t.error); }; }); }); }
  function get(k) { return tx('readonly', function (s) { return s.get(k); }); }
  function put(k, v) { return tx('readwrite', function (s) { s.put(v, k); }); }
  function del(k) { return tx('readwrite', function (s) { s.delete(k); }); }
  function allDays() { return dbP.then(function (db) { return new Promise(function (res) {
    var out = [], c = db.transaction('kv').objectStore('kv').openCursor();
    c.onsuccess = function () { var cur = c.result; if (!cur) return res(out);
      if (String(cur.key).indexOf('day:') === 0) out.push(cur.value); cur.continue(); }; }); }); }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  function today() { return C.dateKey(new Date()); }
  function saveDay() { return put('day:' + state.day.date, state.day); }

  /* ---------- UI ---------- */
  function banner(msg) { var b = $('banner'); b.textContent = msg; b.classList.remove('hidden');
    clearTimeout(banner.t); banner.t = setTimeout(function () { b.classList.add('hidden'); }, 15000); }

  function render() {
    var d = state.day, started = d && d.startTime, ended = d && d.endTime;
    $('todayDate').textContent = new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' });
    $('kmNow').textContent = d ? C.round1((d.meters || 0) / 1000).toFixed(1) : '0.0';
    $('dayStatus').textContent = !started ? 'Day not started' : ended ? 'Day ended at ' + d.endTime : 'Started ' + d.startTime + ' from ' + d.startLocation;
    $('startForm').classList.toggle('hidden', !!started);
    $('dayActions').classList.toggle('hidden', !started || !!ended);
    $('stopList').innerHTML = '';
    var lk = d ? C.legKms(d) : [];
    ((d && d.stops) || []).forEach(function (s, i) { var li = document.createElement('li');
      li.textContent = 'Leg ' + (i + 1) + ', ' + s.time + ': ' + s.from + ' \u2192 ' + s.destination + ' (' + s.purpose + (s.note ? ': ' + s.note : '') + ') \u2013 ' + lk[i] + ' km' + (s.hasAudio ? ' \ud83c\udfa4' : '') + (s.arrivedTime ? ' \u2713 arrived ' + s.arrivedTime : '');
      $('stopList').appendChild(li); });
    var cl = d && d.stops && d.stops[d.stops.length - 1];
    $('btnArrive').classList.toggle('hidden', !cl || !!cl.arrivedTime);
    if (ended) showSummary(); else $('summary').classList.add('hidden');
    var n = state.queue.length, a = state.aqueue.length, p = $('sync');
    p.textContent = !state.settings.url ? 'Sheet not set up' : (n + a) ? (n + a) + ' waiting' + (a ? ' (' + a + ' memo)' : '') + (navigator.onLine ? '' : ', offline') : 'Synced';
    p.className = 'pill ' + ((n + a) || !state.settings.url ? 'wait' : 'ok');
    $('btnNotif').classList.toggle('hidden', !('Notification' in window) || Notification.permission !== 'default');
  }
  function summaryText(d) {
    var k = C.officialKm(d), dests = (d.stops || []).map(function (s) { return s.destination + ' (' + s.purpose + ')'; });
    var t = 'Total: ' + k.official + ' km' + (k.odo !== null ? ' (odometer; GPS ' + k.gps + ' km, difference ' + k.diff + ' km)' : ' (GPS)');
    return t + '\nStops: ' + (dests.length ? dests.join(' \u2192 ') : 'none');
  }
  function showSummary() { var s = $('summary'); s.classList.remove('hidden'); s.innerText = 'Day summary\n' + summaryText(state.day); }

  /* ---------- GPS ---------- */
  function startGps() {
    if (!('geolocation' in navigator)) { $('gpsStatus').textContent = 'GPS not available on this device'; return; }
    if (state.watchId !== null) return;
    state.watchId = navigator.geolocation.watchPosition(function (pos) {
      var p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, t: pos.timestamp || Date.now() };
      state.lastFix = p;
      if (window.TripNav) window.TripNav.onFix(p);
      if (!state.day || !state.day.startTime || state.day.endTime) return;
      var r = C.addPoint({ last: state.day.last, meters: state.day.meters }, p);
      $('gpsStatus').textContent = 'GPS \u00b1' + Math.round(p.accuracy) + ' m' + (r.accepted ? '' : ' (' + r.reason + ', ignored)');
      if (r.accepted) { state.day.last = r.track.last; state.day.meters = r.track.meters; saveDay(); render(); }
    }, function (err) { $('gpsStatus').textContent = 'GPS problem: ' + err.message + '. Check location permission.'; },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    keepAwake();
  }
  function stopGps() { if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId); state.watchId = null;
    if (state.wakeLock) { state.wakeLock.release().catch(function () {}); state.wakeLock = null; } }
  function keepAwake() {
    if (!('wakeLock' in navigator)) { if (!keepAwake.warned) $('keepOpen').textContent += ' (This phone cannot keep the screen on automatically, so set a longer screen timeout while driving.)'; keepAwake.warned = true; return; }
    navigator.wakeLock.request('screen').then(function (l) { state.wakeLock = l; l.addEventListener('release', function () { state.wakeLock = null; }); }).catch(function () {});
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.watchId !== null && !state.wakeLock) keepAwake();
    if (document.visibilityState === 'visible') { tick(); syncNow(); }
  });

  /* ---------- Voice memo (reusable recorder for departure + arrival) ---------- */
  function makeRecorder(btnId, timerId, playId) {
    var r = { memo: null, rec: null, timer: null, start: 0 };
    r.reset = function () { r.memo = null; $(playId).classList.add('hidden'); $(playId).removeAttribute('src');
      $(timerId).textContent = ''; $(btnId).textContent = '\ud83c\udfa4 Tap to record'; $(btnId).classList.remove('rec'); };
    r.busy = function () { return r.rec && r.rec.state === 'recording'; };
    r.stop = function () { if (r.busy()) r.rec.stop(); };
    $(btnId).onclick = function () {
      if (r.busy()) { r.rec.stop(); return; }
      if (!window.MediaRecorder || !navigator.mediaDevices) { banner('Voice memos are not supported on this phone. Please type instead.'); return; }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        var mime = C.pickMime(function (m) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); }), chunks = [];
        try { r.rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 }); } catch (e) { r.rec = new MediaRecorder(stream); }
        r.rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        r.rec.onstop = function () {
          clearInterval(r.timer); stream.getTracks().forEach(function (t) { t.stop(); });
          var type = r.rec.mimeType || mime || 'audio/webm', blob = new Blob(chunks, { type: type }), chk = C.audioCheck(blob.size);
          if (!chk.ok) { banner(chk.error); r.reset(); return; }
          r.memo = { blob: blob, mime: type, secs: Math.round((Date.now() - r.start) / 1000) };
          $(playId).src = URL.createObjectURL(blob); $(playId).classList.remove('hidden');
          $(timerId).textContent = 'Recorded ' + r.memo.secs + ' s (' + Math.round(blob.size / 1024) + ' KB)';
          $(btnId).textContent = '\ud83c\udfa4 Re-record'; $(btnId).classList.remove('rec');
        };
        r.rec.start(1000); r.start = Date.now();
        $(btnId).textContent = '\u23f9 Stop recording'; $(btnId).classList.add('rec'); $(playId).classList.add('hidden');
        r.timer = setInterval(function () { var s = Math.round((Date.now() - r.start) / 1000);
          $(timerId).textContent = 'Recording\u2026 ' + s + ' / 60 s'; if (s >= 60 && r.busy()) r.rec.stop(); }, 250);
      }).catch(function () { banner('Microphone permission was refused. You can still type your answers.'); });
    };
    return r;
  }
  var depRec = makeRecorder('btnRec', 'recTimer', 'memoPlay'), arrRec = makeRecorder('btnRec2', 'recTimer2', 'memoPlay2');
  function resetMemo() { depRec.reset(); }
  function storeMemo(memo, date, leg, kind) {
    var id = 'audio:' + date + ':' + leg + ':' + kind;
    return put(id, { blob: memo.blob, mime: memo.mime, date: date, leg: leg, kind: kind })
      .then(function () { state.aqueue = C.enqueue(state.aqueue, { date: id, audioKey: id }); return put('aqueue', state.aqueue); })
      .catch(function () { banner('Could not save the voice memo - phone storage may be full.'); });
  }

  /* ---------- Actions ---------- */
  function num(v) { return v === '' || v == null ? null : Number(v); }
  $('startPlace').onchange = function () { $('startOther').classList.toggle('hidden', this.value !== 'Other'); };
  $('btnStart').onclick = function () {
    var place = $('startPlace').value === 'Other' ? ($('startOther').value.trim() || 'Other') : $('startPlace').value;
    var now = new Date();
    state.day = { date: C.dateKey(now), startTime: C.hhmm(now), endTime: '', startLocation: place, odoStart: num($('odoStart').value), odoEnd: null,
      meters: 0, last: null, stops: [] };
    if (state.lastFix && state.lastFix.accuracy <= 50) state.day.last = { lat: state.lastFix.lat, lng: state.lastFix.lng, t: Date.now() };
    saveDay().then(function () { queueDay(); render(); }); startGps(); askNotif();
  };
  $('btnStop').onclick = function () {
    var f = state.lastFix;
    if (f && state.lastSpeedCheck && C.haversineM(state.lastSpeedCheck, f) > 50 && (f.t - state.lastSpeedCheck.t) < 20000)
      banner('Looks like you are moving. Please park before filling in the declaration.');
    state.pendingNav = null; resetMemo(); $('stopForm').classList.remove('hidden'); $('stopDest').focus();
  };
  $('btnCancelStop').onclick = function () { depRec.stop(); resetMemo(); state.pendingNav = null; $('stopForm').classList.add('hidden'); };
  $('btnSaveStop').onclick = function () {
    var dest = $('stopDest').value.trim(); if (!dest) { $('stopDest').focus(); banner('Please say where you are going.'); return; }
    if (depRec.busy()) { banner('Stop the recording first.'); return; }
    var f = state.lastFix, now = new Date(), stops = state.day.stops, n = stops.length + 1;
    var leg = { leg: n, time: C.hhmm(now), from: n > 1 ? stops[n - 2].destination : state.day.startLocation, destination: dest,
      purpose: $('stopPurpose').value, note: $('stopNote').value.trim(), activity: $('decActivity').value.trim(),
      doneSoFar: $('decDone').value.trim(), notes: $('decNotes').value.trim(), hasAudio: !!depRec.memo, propertyId: state.pendingNav ? state.pendingNav.propertyId || '' : '', destLat: state.pendingNav ? state.pendingNav.lat : '', destLng: state.pendingNav ? state.pendingNav.lng : '',
      lat: f ? +f.lat.toFixed(6) : '', lng: f ? +f.lng.toFixed(6) : '', km: C.round1(state.day.meters / 1000) };
    stops.push(leg);
    var memo = depRec.memo, p = saveDay(), nav = state.pendingNav; state.pendingNav = null;
    if (memo) p = p.then(function () { return storeMemo(memo, state.day.date, n, 'dep'); });
    ['stopDest', 'stopNote', 'decActivity', 'decNotes'].forEach(function (i) { $(i).value = ''; });
    resetMemo(); $('stopForm').classList.add('hidden');
    p.then(function () { queueDay(); render(); if (nav && window.TripNav) window.TripNav.start(nav); });
  };

  /* ---------- Arrival notes ---------- */
  function currentLeg() { var s = state.day && state.day.stops; return s && s.length ? s[s.length - 1] : null; }
  function openArrival() {
    var l = currentLeg(); if (!l) { banner('Start a leg first.'); return; }
    arrRec.reset(); $('arrPurpose').value = l.purpose; $('arrPropId').value = l.propertyId || '';
    $('arriveForm').classList.remove('hidden'); $('arriveForm').scrollIntoView({ behavior: 'smooth' });
  }
  $('btnArrive').onclick = openArrival;
  $('btnCancelArrive').onclick = function () { arrRec.stop(); $('arriveForm').classList.add('hidden'); };
  $('btnSaveArrive').onclick = function () {
    if (arrRec.busy()) { banner('Stop the recording first.'); return; }
    var l = currentLeg(); if (!l) return;
    var who = $('arrBoardWho').value.trim();
    l.arrivedTime = C.hhmm(new Date()); l.purpose = $('arrPurpose').value; l.arrivalNotes = $('arrNotes').value.trim();
    l.propType = $('arrType').value; l.leaseSale = $('arrLease').value; l.size = $('arrSize').value.trim();
    l.brokerBoard = $('arrBoard').value + (who ? ' - ' + who : ''); l.photos = $('arrPhotos').value === '' ? '' : Number($('arrPhotos').value);
    l.propertyId = $('arrPropId').value.trim().toUpperCase(); l.markVisited = !!(l.propertyId && $('arrMarkVisited').checked);
    l.hasArrAudio = l.hasArrAudio || !!arrRec.memo;
    if (state.lastFix) { l.arrLat = +state.lastFix.lat.toFixed(6); l.arrLng = +state.lastFix.lng.toFixed(6); }
    var memo = arrRec.memo, p = saveDay();
    if (memo) p = p.then(function () { return storeMemo(memo, state.day.date, l.leg, 'arr'); });
    ['arrNotes', 'arrSize', 'arrBoardWho', 'arrPhotos'].forEach(function (i) { $(i).value = ''; });
    arrRec.reset(); $('arriveForm').classList.add('hidden');
    if (window.TripNav) window.TripNav.stop();
    p.then(function () { queueDay(); render(); banner('Arrival saved.'); });
  };
  function openDeclaration(nav) {
    state.pendingNav = nav || null; resetMemo();
    $('stopDest').value = nav ? nav.label : '';
    $('stopForm').classList.remove('hidden'); $('stopForm').scrollIntoView({ behavior: 'smooth' });
  }
  window.TripApp = { state: state, banner: banner, openDeclaration: openDeclaration, openArrival: openArrival, render: function () { render(); } };

  $('btnEnd').onclick = function () {
    if (!confirm('End the day now?')) return;
    state.day.endTime = C.hhmm(new Date()); state.day.odoEnd = num($('odoEnd').value);
    var k = C.officialKm(state.day);
    if (k.odo !== null && Math.abs(k.diff) > Math.max(2, k.odo * 0.15)) banner('Odometer and GPS differ by ' + k.diff + ' km. Odometer is used as the official total.');
    stopGps(); saveDay().then(function () { queueDay(); render(); });
  };
  setInterval(function () { if (state.lastFix) state.lastSpeedCheck = state.lastFix; }, 15000);

  /* ---------- Sync queue (day rows first, then voice memos) ---------- */
  function queueDay() { state.queue = C.enqueue(state.queue, C.toPayload(state.day)); return put('queue', state.queue).then(function () { render(); syncNow(); }); }
  function post(body) {
    return fetch(state.settings.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) throw new Error(j.error || 'failed'); return j; });
  }
  function b64(blob) { return new Promise(function (res, rej) { var fr = new FileReader();
    fr.onload = function () { res(String(fr.result).split(',')[1]); }; fr.onerror = rej; fr.readAsDataURL(blob); }); }
  window.TripPost = function (body) { return post(Object.assign({ token: state.settings.token }, body)); };
  function syncNow() {
    if (state.syncing || !state.settings.url || !navigator.onLine) { render(); return; }
    var now = Date.now(), days = C.due(state.queue, now), memos = state.queue.length ? [] : C.due(state.aqueue, now);
    if (!days.length && !memos.length) return;
    state.syncing = true; state.lastErr = '';
    var chain = days.reduce(function (p, e) { return p.then(function () {
      return post({ token: state.settings.token, day: e.payload }).then(function () { return true; })
        .catch(function (err) { state.lastErr = err.message; return false; })
        .then(function (ok) { state.queue = C.markResult(state.queue, e.date, ok, Date.now()); });
    }); }, Promise.resolve());
    chain = memos.reduce(function (p, e) { return p.then(function () {
      return get(e.date).then(function (a) {
        if (!a) return true; /* already gone */
        var chk = C.audioCheck(a.blob.size); if (!chk.ok) { banner(chk.error); return true; }
        return b64(a.blob).then(function (data) {
          return post({ token: state.settings.token, audio: { date: a.date, leg: a.leg, kind: a.kind || 'dep', mime: a.mime, data: data } });
        }).then(function () { return del(e.date).then(function () { return true; }); });
      }).catch(function (err) { state.lastErr = err.message; return false; })
        .then(function (ok) { state.aqueue = C.markResult(state.aqueue, e.date, ok, Date.now()); });
    }); }, chain);
    chain.then(function () {
      state.syncing = false; put('queue', state.queue); put('aqueue', state.aqueue); render();
      $('sync').title = state.lastErr ? 'Last error: ' + state.lastErr : '';
    });
  }
  window.addEventListener('online', syncNow);
  window.addEventListener('offline', render);
  setInterval(syncNow, 15000);

  /* ---------- Reminders ---------- */
  function askNotif() { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(render); }
  $('btnNotif').onclick = askNotif;
  function notify(title, body) {
    banner(title + ' \u2013 ' + body);
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (navigator.serviceWorker && navigator.serviceWorker.controller)
      navigator.serviceWorker.ready.then(function (r) { r.showNotification(title, { body: body, icon: 'icons/icon-192.png', tag: title }); });
    else try { new Notification(title, { body: body }); } catch (e) {}
  }
  function tick() {
    var now = new Date(), d = state.day && state.day.date === today() ? state.day : null;
    if (state.sentDate !== today()) { state.sent = {}; state.sentDate = today(); }
    var id = C.reminderDue(now, d, state.sent); if (!id) return;
    state.sent[id] = true; put('sent', { date: state.sentDate, sent: state.sent });
    if (id === 'start') notify('Time to start your day', 'Open Trip Log and tap Start day.');
    else if (id === 'end') notify('End of day summary', summaryText(d) + (d.endTime ? '' : '\nRemember to tap End day.'));
    else notify('Km check', C.round1(d.meters / 1000) + ' km so far today, ' + d.stops.length + ' leg(s).');
  }
  setInterval(tick, 30000);

  /* ---------- History / CSV ---------- */
  function renderHistory() {
    var m = $('month').value; allDays().then(function (days) {
      var list = days.filter(function (d) { return d.date.indexOf(m) === 0; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      var tot = 0; $('historyList').innerHTML = '';
      list.forEach(function (d) { var k = C.officialKm(d); tot += k.official; var li = document.createElement('li');
        li.innerText = d.date + '  ' + d.startTime + '\u2013' + (d.endTime || '?') + '  ' + k.official + ' km\n' + (d.stops || []).map(function (s) { return s.destination; }).join(' \u2192 ');
        $('historyList').appendChild(li); });
      $('monthTotal').textContent = list.length + ' day(s), ' + C.round1(tot) + ' km this month';
      state.monthDays = list;
    });
  }
  $('month').onchange = renderHistory;
  $('btnCsv').onclick = function () {
    var blob = new Blob([C.toCsv(state.monthDays || [])], { type: 'text/csv' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'trip-log-' + $('month').value + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  };

  /* ---------- Settings / tabs ---------- */
  $('btnSaveSettings').onclick = function () {
    state.settings = { url: $('setUrl').value.trim(), token: $('setToken').value.trim(), ors: $('setOrs').value.trim(), email: $('setEmail').value.trim() };
    put('settings', state.settings).then(function () { banner('Saved.'); syncNow(); render(); });
  };
  $('btnSyncNow').onclick = function () {
    state.aqueue = state.aqueue.map(function (e) { e.nextTry = 0; return e; });
    allDays().then(function (days) { days.forEach(function (d) { state.queue = C.enqueue(state.queue, C.toPayload(d)); }); put('queue', state.queue); syncNow(); }); };
  Array.prototype.forEach.call(document.querySelectorAll('nav button'), function (b) {
    b.onclick = function () { Array.prototype.forEach.call(document.querySelectorAll('nav button'), function (x) { x.classList.toggle('active', x === b); });
      ['today', 'history', 'settings'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab); });
      if (b.dataset.tab === 'history') renderHistory(); };
  });

  /* ---------- Boot ---------- */
  Promise.all([get('day:' + today()), get('queue'), get('settings'), get('sent'), get('aqueue')]).then(function (r) {
    state.day = r[0] || null; state.queue = r[1] || []; state.settings = r[2] || state.settings; state.aqueue = r[4] || [];
    if (r[3] && r[3].date === today()) { state.sent = r[3].sent; state.sentDate = r[3].date; }
    $('setUrl').value = state.settings.url || ''; $('setToken').value = state.settings.token || ''; $('setOrs').value = state.settings.ors || ''; $('setEmail').value = state.settings.email || '';
    $('month').value = today().slice(0, 7);
    if (state.day && state.day.startTime && !state.day.endTime) startGps();
    else if ('geolocation' in navigator) navigator.geolocation.getCurrentPosition(function (p) {
      state.lastFix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, t: Date.now() }; }, function () {}, { enableHighAccuracy: true });
    render(); tick(); syncNow();
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('service-worker.js');
})();
