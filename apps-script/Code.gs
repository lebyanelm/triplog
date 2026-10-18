/**
 * Done Deal Trip Log - Google Apps Script web app.
 * Paste into: the "Done Deal - East Rand Industrial Pipeline" sheet > Extensions > Apps Script.
 * Set TOKEN below to your own secret (same as in the app's Settings). Deploy > New deployment > Web app,
 * Execute as: Me, Who has access: Anyone. Copy the /exec URL into the app.
 */
var TOKEN = 'CHANGE-ME-to-a-long-secret';
var SPREADSHEET_ID = '1XTgy5A1lEJaH7To7glaD0ahxLKt7kggPpV8174ChC54';
var LOG_TAB = 'Trip Log', LEGS_TAB = 'Trip Legs', MEMO_ROOT = 'Done Deal Trip Memos';
var MAX_AUDIO_BYTES = 5 * 1024 * 1024;
var LOG_HEADERS = ['Date', 'Start time', 'End time', 'Start location', 'Destinations', 'Total km (GPS)', 'Odometer km', 'Purpose notes', 'Synced at', 'Declarations'];
var LEG_HEADERS = ['Date', 'Leg #', 'Start time', 'From', 'Going to', 'Planned activity', 'Done so far', 'Other notes', 'Voice memo link', 'Purpose', 'km for leg', 'Lat/Lng',
  'Arrived time', 'Arrival notes', 'Property type', 'Lease/Sale', 'Size', 'Broker board', 'Photos #', 'Property ID', 'Arrival memo link'];
var NCOL = LEG_HEADERS.length; /* 21 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = JSON.parse(e.postData.contents);
    if (!TOKEN || body.token !== TOKEN) return out({ ok: false, error: 'Wrong token - check Settings in the app.' });
    if (body.day) { saveDay(body.day); return out({ ok: true, date: body.day.date }); }
    if (body.audio) return out(saveAudio(body.audio));
    if (body.action === 'properties') return out({ ok: true, properties: listProperties() });
    return out({ ok: false, error: 'Nothing to save' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally { try { lock.releaseLock(); } catch (x) {} }
}
function doGet() { return out({ ok: true, msg: 'Trip Log endpoint is running.' }); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function sheet(name, headers) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
/* Find row (1-based) where col A == date (and col B == leg if given). 0 if none. */
function findRow(sh, date, leg) {
  var n = sh.getLastRow(); if (n < 2) return 0;
  var vals = sh.getRange(2, 1, n - 1, 2).getDisplayValues();
  for (var i = 0; i < vals.length; i++) if (vals[i][0] === date && (leg == null || String(vals[i][1]) === String(leg))) return i + 2;
  return 0;
}
function firstEmptyRow(sh) { var n = sh.getLastRow(); if (n < 2) return 2;
  var a = sh.getRange(2, 1, n - 1, 1).getDisplayValues(); for (var i = a.length - 1; i >= 0; i--) if (a[i][0] !== '') return i + 3; return 2; }

function saveDay(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) throw new Error('Bad date');
  var sh = sheet(LOG_TAB, LOG_HEADERS);
  var row = [d.date, d.startTime, d.endTime, d.startLocation, d.destinations, d.gpsKm, d.odometerKm, d.purposeNotes,
    Utilities.formatDate(new Date(), 'Africa/Johannesburg', 'yyyy-MM-dd HH:mm'), d.declarations || ''];
  var r = findRow(sh, d.date) || firstEmptyRow(sh); /* idempotent by date; summary in K:L is untouched */
  sh.getRange(r, 1).setNumberFormat('@');
  sh.getRange(r, 1, 1, row.length).setValues([row]);

  var legs = sheet(LEGS_TAB, LEG_HEADERS);
  (d.stops || []).forEach(function (s) {
    var lr = findRow(legs, d.date, s.leg), link = '', alink = '';
    if (lr) { var ex = legs.getRange(lr, 1, 1, NCOL).getValues()[0]; link = ex[8]; alink = ex[20]; } else lr = firstEmptyRow(legs);
    if (link === 'uploading…' && !s.hasAudio) link = '';
    legs.getRange(lr, 1).setNumberFormat('@');
    legs.getRange(lr, 1, 1, NCOL).setValues([[d.date, s.leg, s.time, s.from, s.destination, s.activity, s.doneSoFar, s.notes,
      link || (s.hasAudio ? 'uploading…' : ''), s.purpose, s.legKm, (s.lat !== '' && s.lat != null) ? s.lat + ', ' + s.lng : '',
      s.arrivedTime || '', s.arrivalNotes || '', s.propType || '', s.leaseSale || '', s.size || '', s.brokerBoard || '', s.photos === '' ? '' : s.photos,
      s.propertyId || '', alink || (s.hasArrAudio ? 'uploading…' : '')]]);
    if (s.propertyId && s.markVisited && s.arrivedTime) markVisited(s.propertyId, d.date);
  });
}

/* Properties tab: A=ID, B=Status, E=Area / Node, F=Address / Park, G=Property Type, N=Date Visited. */
function propsSheet() { return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Properties'); }
function listProperties() {
  var sh = propsSheet(), n = sh.getLastRow(); if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 7).getDisplayValues().filter(function (r) { return r[0]; })
    .map(function (r) { return { id: r[0], status: r[1], area: r[4], address: r[5], type: r[6] }; });
}
function markVisited(id, date) {
  var sh = propsSheet(), n = sh.getLastRow(); if (n < 2) return;
  var ids = sh.getRange(2, 1, n - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]).toUpperCase() === String(id).toUpperCase()) {
    var row = i + 2, st = sh.getRange(row, 2).getValue();
    if (st === 'To Visit' || st === '' || st === 'Visited') { sh.getRange(row, 2).setValue('Visited'); } /* never downgrade e.g. 'Submitted' */
    if (!sh.getRange(row, 14).getValue()) sh.getRange(row, 14).setNumberFormat('@').setValue(date);
    return;
  }
}

function saveAudio(a) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) return { ok: false, error: 'Bad date' };
  var bytes = Utilities.base64Decode(a.data);
  if (bytes.length > MAX_AUDIO_BYTES) return { ok: false, error: 'Voice memo too big (over 5 MB).' };
  var ext = /mp4|aac/.test(a.mime) ? 'm4a' : /ogg/.test(a.mime) ? 'ogg' : 'webm';
  var folder = subFolder(subFolder(DriveApp.getRootFolder(), MEMO_ROOT), a.date.slice(0, 7));
  var kind = a.kind === 'arr' ? 'arr' : 'dep';
  var name = a.date + '_leg' + a.leg + '_' + (kind === 'arr' ? 'arrival' : 'departure') + '.' + ext;
  var old = folder.getFilesByName(name); while (old.hasNext()) old.next().setTrashed(true); /* re-upload replaces */
  var file = folder.createFile(Utilities.newBlob(bytes, String(a.mime).split(';')[0], name));
  var legs = sheet(LEGS_TAB, LEG_HEADERS), r = findRow(legs, a.date, a.leg);
  if (!r) { r = firstEmptyRow(legs); legs.getRange(r, 1).setNumberFormat('@'); legs.getRange(r, 1, 1, 2).setValues([[a.date, a.leg]]); }
  legs.getRange(r, kind === 'arr' ? 21 : 9).setValue(file.getUrl());
  return { ok: true, url: file.getUrl() };
}
function subFolder(parent, name) { var it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }

/* Run once from the editor to check the setup (creates nothing if tabs exist). */
function testSetup() { sheet(LOG_TAB, LOG_HEADERS); sheet(LEGS_TAB, LEG_HEADERS); Logger.log('OK'); }
