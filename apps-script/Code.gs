/**
 * Curtain & Sheer — Google Sheet API
 * ตัวกลางระหว่างหน้า index.html (GitHub Pages) กับชีตฐานข้อมูล
 *
 * ติดตั้ง:  เปิดชีต → Extensions → Apps Script → วางไฟล์นี้ทับ Code.gs
 *          → Deploy → New deployment → Web app
 *            Execute as: Me     |     Who has access: Anyone
 *          → คัดลอก URL ที่ลงท้ายด้วย /exec ไปใส่ในแอป (ปุ่ม “เชื่อมชีต”)
 *
 * วิธีคุยกัน:
 *   GET  ?action=ping                 → เช็คว่าเชื่อมได้ไหม
 *   GET  ?action=list                 → คืนข้อมูลทุกห้องเป็น JSON
 *   POST {action:"upsert", records:[…]}  → เขียน/อัปเดตห้อง (คีย์ = วันที่ + เลขห้อง)
 *   POST {action:"delete", room:301}     → ลบห้องนั้น
 *   POST {action:"clear"}                → ล้างข้อมูลทั้งหมด (เหลือหัวตาราง)
 *   ทุก request ใส่ token ด้วยถ้าตั้ง TOKEN ไว้
 */

/** ว่างไว้ = ใช้ชีตที่สคริปต์ผูกอยู่ */
var SHEET_ID   = '1YG-HCGAEmsliXe0eReUI52Tdl1bDdPhBwex24DRptl0';
var SHEET_NAME = 'Curtain Check';

/** ตั้งเป็นข้อความลับสักชุด แล้วใส่ค่าเดียวกันในช่อง Token ของแอป
 *  ถ้าเว้นว่าง = ใครมี URL ก็เขียนได้ */
var TOKEN = '';

var KEYS = ['closeSheer','closeCurtain','openSheer','openCurtain','switchSheer','switchCurtain',
            'manualSheer','manualCurtain','soundSheer','soundCurtain','smooth'];

var HEAD = ['วันที่ตรวจ','ชั้น','Room No.','Room type','Brand',
            'close sheer','close curtain','open sheer','open curtain',
            'switch sheer','switch curtain','manual sheer','manual curtain',
            'sound sheer','sound curtain','smooth all',
            'ผลตรวจ','รายละเอียด defect / หมายเหตุ','ผู้ตรวจ','อัปเดตล่าสุด'];

var COL = {DATE:0, FLOOR:1, ROOM:2, TYPE:3, BRAND:4, CHECK0:5, RESULT:16, NOTE:17, BY:18, UPD:19};

/* ============================ entry points ============================ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    guard(p.token);
    switch (p.action || 'list') {
      case 'ping': return json({ok:true, sheet:sheet().getName(), count:Math.max(0, sheet().getLastRow()-1), ts:Date.now()});
      case 'list': return json({ok:true, records:readAll(), ts:Date.now()});
      default:     return json({ok:false, error:'unknown action: ' + p.action});
    }
  } catch (err) {
    return json({ok:false, error:String(err && err.message || err)});
  }
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json({ok:false, error:'bad JSON body'});
  }
  var lock = LockService.getScriptLock();
  try {
    guard(body.token);
    lock.waitLock(25000);
    switch (body.action) {
      case 'upsert': return json({ok:true, written:upsert(body.records || (body.record ? [body.record] : [])), ts:Date.now()});
      case 'delete': return json({ok:true, deleted:remove(body.room, body.date), ts:Date.now()});
      case 'clear':  return json({ok:true, cleared:clearAll(), ts:Date.now()});
      default:       return json({ok:false, error:'unknown action: ' + body.action});
    }
  } catch (err) {
    return json({ok:false, error:String(err && err.message || err)});
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/* ============================ core ============================ */

function guard(token) {
  if (TOKEN && String(token || '') !== TOKEN) throw new Error('unauthorized');
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}

function book() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive();
}

/** คืนชีตงาน สร้างใหม่พร้อมหัวตารางถ้ายังไม่มี */
function sheet() {
  var ss = book();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    // ถ้าชีตแรกยังว่างเปล่า ใช้ชีตนั้นเลยแทนการสร้างใหม่
    var first = ss.getSheets()[0];
    sh = (ss.getSheets().length === 1 && first.getLastRow() === 0) ? first.setName(SHEET_NAME)
                                                                  : ss.insertSheet(SHEET_NAME);
  }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD])
      .setFontWeight('bold').setBackground('#141C28').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.getRange(2, COL.DATE + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');   // วันที่เก็บเป็นข้อความ
    sh.setColumnWidth(COL.NOTE + 1, 260);
  }
  return sh;
}

/** วันที่อาจถูก Sheets แปลงเป็น Date เอง — ดึงกลับมาเป็น dd/MM/yyyy เสมอ */
function normDate(v) {
  if (v && typeof v.getTime === 'function') return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return String(v === null || v === undefined ? '' : v).trim();
}

function keyOf(date, room) { return normDate(date) + '|' + String(room).trim(); }

function rowToRecord(row) {
  var checks = {};
  KEYS.forEach(function (k, i) {
    var v = row[COL.CHECK0 + i];
    if (v !== '' && v !== null && v !== undefined) checks[k] = String(v);
  });
  var upd = row[COL.UPD];
  return {
    date:   normDate(row[COL.DATE]),
    floor:  Number(row[COL.FLOOR]) || Math.floor(Number(row[COL.ROOM]) / 100),
    room:   Number(row[COL.ROOM]),
    type:   String(row[COL.TYPE] || ''),
    brand:  String(row[COL.BRAND] || ''),
    checks: checks,
    result: String(row[COL.RESULT] || ''),
    note:   String(row[COL.NOTE] || ''),
    by:     String(row[COL.BY] || ''),
    updatedAt: upd instanceof Date ? upd.getTime() : (Number(upd) || 0)
  };
}

function recordToRow(r) {
  var row = new Array(HEAD.length).fill('');
  row[COL.DATE]  = String(r.date || '');
  row[COL.FLOOR] = r.floor || Math.floor(Number(r.room) / 100);
  row[COL.ROOM]  = Number(r.room);
  row[COL.TYPE]  = r.type || '';
  row[COL.BRAND] = r.brand || '';
  KEYS.forEach(function (k, i) { row[COL.CHECK0 + i] = (r.checks && r.checks[k]) || ''; });
  row[COL.RESULT] = r.result || '';
  row[COL.NOTE]   = r.note || '';
  row[COL.BY]     = r.by || '';
  row[COL.UPD]    = Number(r.updatedAt) || Date.now();
  return row;
}

/** อ่านทุกแถว แล้วเหลือห้องละรายการล่าสุด (แอปเก็บห้องละรายการ ชีตเก็บย้อนหลังได้) */
function readAll() {
  var sh = sheet();
  if (sh.getLastRow() < 2) return [];
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, HEAD.length).getValues();
  var latest = {};
  values.forEach(function (row) {
    if (!row[COL.ROOM]) return;
    var rec = rowToRecord(row);
    var cur = latest[rec.room];
    if (!cur || rec.updatedAt >= cur.updatedAt) latest[rec.room] = rec;
  });
  return Object.keys(latest).map(function (k) { return latest[k]; })
               .sort(function (a, b) { return a.room - b.room; });
}

/** เขียนทับแถวที่คีย์ตรงกัน ไม่ตรงก็ต่อท้าย */
function upsert(recs) {
  if (!recs || !recs.length) return 0;
  var sh = sheet();
  var last = sh.getLastRow();
  var index = {};
  if (last >= 2) {
    var keyCols = sh.getRange(2, 1, last - 1, COL.ROOM + 1).getValues();
    keyCols.forEach(function (row, i) { index[keyOf(row[COL.DATE], row[COL.ROOM])] = i + 2; });
  }
  // ยุบรายการซ้ำในชุดเดียวกัน เหลืออันที่ส่งมาทีหลังสุด
  var byKey = {}, order = [];
  recs.forEach(function (r) {
    if (!r || !r.room) return;
    var row = recordToRow(r);
    var k = keyOf(row[COL.DATE], row[COL.ROOM]);
    if (!byKey.hasOwnProperty(k)) order.push(k);
    byKey[k] = row;
  });
  var appends = [];
  order.forEach(function (k) {
    var at = index[k];
    if (at) sh.getRange(at, 1, 1, HEAD.length).setValues([byKey[k]]);
    else appends.push(byKey[k]);
  });
  if (appends.length) {
    sh.getRange(last + 1, 1, appends.length, HEAD.length).setValues(appends);
  }
  return order.length;
}

/** ลบห้อง — ระบุ date ด้วยเพื่อลบเฉพาะวันนั้น ไม่ระบุ = ลบทุกแถวของห้องนั้น */
function remove(roomNo, date) {
  var sh = sheet();
  if (sh.getLastRow() < 2) return 0;
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, COL.ROOM + 1).getValues();
  var kill = [];
  values.forEach(function (row, i) {
    if (Number(row[COL.ROOM]) !== Number(roomNo)) return;
    if (date && normDate(row[COL.DATE]) !== normDate(date)) return;
    kill.push(i + 2);
  });
  kill.reverse().forEach(function (r) { sh.deleteRow(r); });
  return kill.length;
}

function clearAll() {
  var sh = sheet();
  var n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 1, n, HEAD.length).clearContent();
  return Math.max(0, n);
}

/* ============================ เมนูช่วยงานในชีต ============================ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Curtain Check')
    .addItem('จัดหัวตาราง / สร้างชีตงาน', 'setup')
    .addItem('ลบข้อมูลทั้งหมด (เหลือหัวตาราง)', 'clearAll')
    .addToUi();
}

function setup() {
  var sh = sheet();
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD])
    .setFontWeight('bold').setBackground('#141C28').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.getRange(2, COL.DATE + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
  sh.setColumnWidth(COL.NOTE + 1, 260);
  SpreadsheetApp.getActive().toast('พร้อมใช้งานแล้ว: ' + sh.getName());
}
