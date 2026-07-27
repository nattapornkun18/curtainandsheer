/**
 * Curtain Defect — Google Sheets backend (Apps Script Web App)
 *
 * Bridges the static GitHub Pages HTML to the Google Sheet.
 *   GET  /exec           -> { records: [...] }   (all inspected rooms)
 *   POST /exec  {record}  -> upsert by Room No.   (overwrites cols A..S only)
 *
 * Repair columns (T=สถานะซ่อม, U=วันที่ซ่อมเสร็จ, V=ผู้ซ่อม) are NEVER touched
 * because we only ever write the first 19 columns.
 *
 * Setup: Extensions > Apps Script on the target Sheet, paste this, then
 * Deploy > New deployment > Web app > Execute as: Me, Access: Anyone.
 * Copy the /exec URL into index.html (const API).
 */

// If your data is not on the first tab, put the tab name here. "" = first sheet.
var SHEET_NAME = "";

// Check keys in the exact column order F..P (must match the HTML `KEYS`).
var KEYS = ["closeSheer","closeCurtain","openSheer","openCurtain",
  "switchSheer","switchCurtain","manualSheer","manualCurtain",
  "soundSheer","soundCurtain","smooth"];

var COLS = 19;          // A..S — the inspection block the app owns
var ROOM_COL = 3;       // C — Room No.

function sheet_() {
  var ss = SpreadsheetApp.getActive();
  return SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
}

function toRow_(d) {
  var c = d.checks || {};
  return [d.date, d.floor, d.room, d.type, d.brand]
    .concat(KEYS.map(function (k) { return c[k] || ""; }))
    .concat([d.result, d.note || "", d.by || ""]);
}

function fmtDate_(v) {
  // duck-type instead of `instanceof Date` — the latter is unreliable in Apps Script
  if (v && typeof v.getTime === "function") {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "dd/MM/yyyy");
  }
  return v == null ? "" : String(v);
}

function fromRow_(r) {
  var checks = {};
  KEYS.forEach(function (k, i) {
    var v = r[5 + i];
    if (v !== "" && v != null) checks[k] = String(v);
  });
  return {
    date: fmtDate_(r[0]), floor: Number(r[1]), room: Number(r[2]),
    type: r[3], brand: r[4], checks: checks,
    result: r[16], note: r[17], by: r[18]
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  var sh = sheet_();
  var last = sh.getLastRow();
  var records = [];
  if (last >= 1) {
    var values = sh.getRange(1, 1, last, COLS).getValues();
    for (var i = 0; i < values.length; i++) {
      var room = values[i][ROOM_COL - 1];
      if (room === "" || room == null || isNaN(Number(room))) continue; // skips header rows
      records.push(fromRow_(values[i]));
    }
  }
  return json_({ ok: true, records: records });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var d = JSON.parse(e.postData.contents);
    if (!d || d.room == null) return json_({ ok: false, error: "no room" });
    var sh = sheet_();
    var row = toRow_(d);

    var last = sh.getLastRow();
    var target = -1;
    if (last >= 1) {
      var colC = sh.getRange(1, ROOM_COL, last, 1).getValues();
      for (var i = 0; i < colC.length; i++) {
        if (String(colC[i][0]) === String(d.room)) { target = i + 1; break; }
      }
    }
    if (target > 0) {
      sh.getRange(target, 1, 1, COLS).setValues([row]); // overwrite A..S, leave T..V
    } else {
      sh.getRange(last + 1, 1, 1, COLS).setValues([row]);
    }
    return json_({ ok: true, room: d.room, updated: target > 0 });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
