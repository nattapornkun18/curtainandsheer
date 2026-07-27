/**
 * Curtain & Sheer — Google Sheet API
 * ตัวกลางระหว่างหน้า index.html (GitHub Pages) กับชีตฐานข้อมูลเดิม
 *
 * เขียนลง "แท็บเดิม" ที่มีข้อมูลอยู่แล้วเท่านั้น — ไม่สร้างแท็บใหม่
 * หนึ่งห้อง = หนึ่งแถว | ตรวจซ้ำ = ทับแถวเดิมของห้องนั้น (รวมวันที่ตรวจ)
 * ห้องที่ยังไม่มีในตารางเท่านั้นถึงจะต่อท้ายเป็นแถวใหม่
 *
 * ติดตั้ง:  เปิดชีต → Extensions → Apps Script → วางไฟล์นี้ทับ Code.gs
 *          → Deploy → New deployment → Web app
 *            Execute as: Me     |     Who has access: Anyone
 *          → คัดลอก URL ที่ลงท้ายด้วย /exec ไปใส่ในแอป (ปุ่ม “เชื่อมชีต”)
 *
 * วิธีคุยกัน:
 *   GET  ?action=ping                    → เช็คว่าเชื่อมได้ไหม + บอกว่าเจอแท็บไหน
 *   GET  ?action=list                    → คืนข้อมูลทุกห้องเป็น JSON (ห้องละรายการล่าสุด)
 *   POST {action:"upsert", records:[…]}  → เขียน/อัปเดตห้อง
 *   POST {action:"delete", room:301}     → ลบแถวของห้องนั้น (แอปไม่เรียกเอง ต้องยิงเอง)
 *   ทุก request ใส่ token ด้วยถ้าตั้ง TOKEN ไว้
 */

/** ว่างไว้ = ใช้ชีตที่สคริปต์ผูกอยู่ */
var SHEET_ID = '1YG-HCGAEmsliXe0eReUI52Tdl1bDdPhBwex24DRptl0';

/** ★ ชื่อแท็บที่มีข้อมูลจริง — ต้องตรงกับชื่อแท็บล่างสุดของชีต */
var SHEET_NAME = 'Check ม่าน';

/** ★ รหัสผ่าน (PIN) ที่ต้องกรอกก่อนเข้าใช้แอป — ตั้งเป็นตัวเลขกี่หลักก็ได้ เช่น '742'
 *  ใส่ค่านี้แล้ว ใครไม่มีรหัสจะอ่านหรือเขียนข้อมูลไม่ได้เลย
 *  ถ้าเว้นว่าง = ไม่ล็อก ใครมี URL ก็เข้าได้ */
var TOKEN = '';

var KEYS = ['closeSheer','closeCurtain','openSheer','openCurtain','switchSheer','switchCurtain',
            'manualSheer','manualCurtain','soundSheer','soundCurtain','smooth'];

/** คอลัมน์ A–S ตามตารางเดิม — คอลัมน์ถัดจากนี้ (เช่น “สถานะ”) แอปไม่แตะ */
var WIDTH = 19;
var COL = {DATE:0, FLOOR:1, ROOM:2, TYPE:3, BRAND:4, CHECK0:5, RESULT:16, NOTE:17, BY:18};

/** ใช้เฉพาะตอนเจอชีตเปล่าสนิทเท่านั้น (ปกติไม่ถูกใช้) */
var HEAD = ['วันที่ตรวจ','ชั้น','Room No.','Room type','Brand',
            'close sheer','close curtain','open sheer','open curtain',
            'switch sheer','switch curtain','manual sheer','manual curtain',
            'sound sheer','sound curtain','smooth all',
            'ผลตรวจ','รายละเอียด defect / หมายเหตุ','ผู้ตรวจ'];

/* ============================ entry points ============================ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    // ping ไม่ต้องใช้รหัส — แอปใช้ถามว่า "ต้องใส่รหัสไหม" ก่อนขึ้นหน้าล็อก
    if ((p.action || '') === 'ping') {
      var locked = !!TOKEN, info = {ok:true, locked:locked, ts:Date.now()};
      if (!locked || String(p.token || '') === TOKEN) {
        var sh = sheet(), lay = layout(sh);
        info.sheet = sh.getName();
        info.count = Math.max(0, sh.getLastRow() - lay.start + 1);
      }
      return json(info);
    }
    guard(p.token);
    switch (p.action || 'list') {
      case 'verify': return json({ok:true, ts:Date.now()});   // รหัสถูก
      case 'list':   return json({ok:true, records:readAll(), ts:Date.now()});
      default:       return json({ok:false, error:'unknown action: ' + p.action});
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

/** หาแท็บเดิมให้เจอ — ไม่เจอก็ฟ้อง ไม่สร้างใหม่เด็ดขาด */
function sheet() {
  var all = book().getSheets();
  var squash = function (s) { return String(s).replace(/\s+/g, '').toLowerCase(); };
  var i;
  for (i = 0; i < all.length; i++) if (all[i].getName().trim() === SHEET_NAME.trim()) return all[i];
  for (i = 0; i < all.length; i++) if (squash(all[i].getName()) === squash(SHEET_NAME)) return all[i];
  throw new Error('ไม่พบแท็บชื่อ "' + SHEET_NAME + '" — แท็บที่มีอยู่: ' +
                  all.map(function (s) { return s.getName(); }).join(' / '));
}

/**
 * หาว่าหัวตารางกินกี่แถว และข้อมูลเริ่มแถวไหน
 * รองรับทั้งหัวแถวเดียว และหัวสองแถว (แถวบน = กลุ่ม CLOSE/OPEN/…, แถวล่าง = sheer/curtain)
 */
function layout(sh) {
  var last = sh.getLastRow();
  if (last === 0) {                                     // ชีตเปล่าสนิท — วางหัวตารางให้ครั้งเดียว
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return {header:1, start:2};
  }
  var probe = sh.getRange(1, 1, Math.min(12, last), WIDTH).getValues();
  var hdr = 0, i;
  for (i = 0; i < probe.length; i++) {
    var joined = probe[i].join('|');
    if (joined.indexOf('Room') >= 0 && joined.indexOf('Brand') >= 0) { hdr = i + 1; break; }
  }
  if (!hdr) {                                           // ไม่เจอหัวตาราง เดาจากแถวแรกที่มีเลขห้อง
    for (i = 0; i < probe.length; i++) if (Number(probe[i][COL.ROOM])) return {header:i, start:i + 1};
    return {header:1, start:2};
  }
  var start = hdr + 1;
  var next = probe[hdr] || [];                          // แถวถัดจากหัวตาราง
  var nextTxt = next.join('|').toLowerCase();
  var isSub = !Number(next[COL.ROOM]) &&
              (nextTxt.indexOf('sheer') >= 0 || nextTxt.indexOf('curtain') >= 0);
  if (isSub) start = hdr + 2;                           // หัวสองแถว
  return {header:hdr, start:start};
}

/** วันที่อาจถูก Sheets แปลงเป็น Date เอง — ดึงกลับมาเป็น dd/MM/yyyy เสมอ */
function normDate(v) {
  if (v && typeof v.getTime === 'function') return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return String(v === null || v === undefined ? '' : v).trim();
}

/** คีย์คือ “เลขห้อง” อย่างเดียว — ตรวจซ้ำจึงทับแถวเดิมเสมอ */
function keyOf(room) { return String(Number(room) || '').trim(); }

/** dd/MM/yyyy → 20260723 ไว้เทียบว่าแถวไหนใหม่กว่า */
function dateRank(v) {
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(normDate(v));
  return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0;
}

function rowToRecord(row) {
  var checks = {};
  KEYS.forEach(function (k, i) {
    var v = row[COL.CHECK0 + i];
    if (v !== '' && v !== null && v !== undefined) checks[k] = String(v).trim();
  });
  return {
    date:   normDate(row[COL.DATE]),
    floor:  Number(row[COL.FLOOR]) || Math.floor(Number(row[COL.ROOM]) / 100),
    room:   Number(row[COL.ROOM]),
    type:   String(row[COL.TYPE] || ''),
    brand:  String(row[COL.BRAND] || ''),
    checks: checks,
    result: String(row[COL.RESULT] || ''),
    note:   String(row[COL.NOTE] || ''),
    by:     String(row[COL.BY] || '')
  };
}

function recordToRow(r) {
  var row = [];
  for (var i = 0; i < WIDTH; i++) row.push('');
  row[COL.DATE]  = String(r.date || '');
  row[COL.FLOOR] = r.floor || Math.floor(Number(r.room) / 100);
  row[COL.ROOM]  = Number(r.room);
  row[COL.TYPE]  = r.type || '';
  row[COL.BRAND] = r.brand || '';
  KEYS.forEach(function (k, i) { row[COL.CHECK0 + i] = (r.checks && r.checks[k]) || ''; });
  row[COL.RESULT] = r.result || '';
  row[COL.NOTE]   = r.note || '';
  row[COL.BY]     = r.by || '';
  return row;
}

/** อ่านทุกแถว เหลือห้องละรายการเดียว (ปกติมีแถวเดียวอยู่แล้ว
 *  ถ้าเผลอมีซ้ำ เอาแถวที่วันที่ใหม่กว่า วันเท่ากันเอาแถวบนสุด) */
function readAll() {
  var sh = sheet(), lay = layout(sh), last = sh.getLastRow();
  if (last < lay.start) return [];
  var values = sh.getRange(lay.start, 1, last - lay.start + 1, WIDTH).getValues();
  var latest = {}, rank = {};
  values.forEach(function (row, i) {
    if (!Number(row[COL.ROOM])) return;
    var rec = rowToRecord(row);
    var d = dateRank(row[COL.DATE]);
    if (!(rec.room in latest) || d > rank[rec.room]) { latest[rec.room] = rec; rank[rec.room] = d; }
  });
  return Object.keys(latest).map(function (k) { return latest[k]; })
               .sort(function (a, b) { return a.room - b.room; });
}

/** คอลัมน์ไหนเป็นสูตร (ดูจากแถวข้อมูลล่าสุด) — จะได้ไม่เขียนทับสูตรของเจ้าของชีต */
function formulaCols(sh, templateRow) {
  var flags = [];
  for (var i = 0; i < WIDTH; i++) flags.push(false);
  if (!templateRow) return flags;
  var f = sh.getRange(templateRow, 1, 1, WIDTH).getFormulas()[0];
  for (var j = 0; j < WIDTH; j++) flags[j] = !!f[j];
  return flags;
}

/** ช่วงคอลัมน์ที่เขียนค่าได้ (ข้ามช่องที่เป็นสูตร) */
function writableSegments(flags) {
  var segs = [], s = -1, i;
  for (i = 0; i < WIDTH; i++) {
    if (!flags[i]) { if (s < 0) s = i; }
    else if (s >= 0) { segs.push([s, i - s]); s = -1; }
  }
  if (s >= 0) segs.push([s, WIDTH - s]);
  return segs;
}

function writeRow(sh, at, row, segs) {
  segs.forEach(function (seg) {
    sh.getRange(at, seg[0] + 1, 1, seg[1]).setValues([row.slice(seg[0], seg[0] + seg[1])]);
  });
}

/** แถวใหม่ให้หน้าตาเหมือนแถวเดิม: สี, dropdown, และสูตรที่มีอยู่ */
function stampTemplate(sh, from, to) {
  var width = Math.max(WIDTH, sh.getLastColumn());
  var src = sh.getRange(from, 1, 1, width), dst = sh.getRange(to, 1, 1, width);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  var f = src.getFormulasR1C1()[0];
  f.forEach(function (x, i) { if (x) dst.offset(0, i, 1, 1).setFormulaR1C1(x); });
}

/** เขียนทับแถวของห้องนั้น (แถวบนสุดที่เจอ) ห้องที่ยังไม่มีค่อยต่อท้ายเป็นแถวใหม่ */
function upsert(recs) {
  if (!recs || !recs.length) return 0;
  var sh = sheet(), lay = layout(sh), last = sh.getLastRow();

  var index = {}, lastData = 0;
  if (last >= lay.start) {
    var keys = sh.getRange(lay.start, 1, last - lay.start + 1, COL.ROOM + 1).getValues();
    keys.forEach(function (row, i) {
      if (!Number(row[COL.ROOM])) return;
      var k = keyOf(row[COL.ROOM]);
      if (!index.hasOwnProperty(k)) index[k] = lay.start + i;   // เจอซ้ำ ยึดแถวบนสุด
      lastData = lay.start + i;
    });
  }

  // ยุบรายการซ้ำในชุดเดียวกัน เหลืออันที่ส่งมาทีหลังสุด
  var byKey = {}, order = [];
  recs.forEach(function (r) {
    if (!r || !Number(r.room)) return;
    var row = recordToRow(r);
    var k = keyOf(row[COL.ROOM]);
    if (!byKey.hasOwnProperty(k)) order.push(k);
    byKey[k] = row;
  });

  var segs = writableSegments(formulaCols(sh, lastData));
  var cursor = lastData || (lay.start - 1);
  order.forEach(function (k) {
    var at = index[k];
    if (!at) {
      at = ++cursor;
      if (lastData) stampTemplate(sh, lastData, at);
    }
    writeRow(sh, at, byKey[k], segs);
    index[k] = at;
  });
  return order.length;
}

/** ลบห้อง — ระบุ date ด้วยเพื่อลบเฉพาะวันนั้น ไม่ระบุ = ลบทุกแถวของห้องนั้น */
function remove(roomNo, date) {
  var sh = sheet(), lay = layout(sh), last = sh.getLastRow();
  if (last < lay.start) return 0;
  var values = sh.getRange(lay.start, 1, last - lay.start + 1, COL.ROOM + 1).getValues();
  var kill = [];
  values.forEach(function (row, i) {
    if (Number(row[COL.ROOM]) !== Number(roomNo)) return;
    if (date && normDate(row[COL.DATE]) !== normDate(date)) return;
    kill.push(lay.start + i);
  });
  kill.reverse().forEach(function (r) { sh.deleteRow(r); });
  return kill.length;
}

/* ============================ เมนูช่วยเช็คในชีต ============================ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Curtain Check')
    .addItem('เช็คว่าสคริปต์อ่านแท็บไหน', 'whereAmI')
    .addItem('รวมแถวซ้ำ ให้เหลือห้องละแถว', 'dedupeRooms')
    .addToUi();
}

/**
 * ใช้ครั้งเดียวตอนมีแถวซ้ำค้างอยู่ (เช่นแถวที่ถูกต่อท้ายไปก่อนหน้านี้)
 * ยกข้อมูลของแถวที่วันที่ใหม่สุดขึ้นไปไว้ที่แถวบนสุดของห้องนั้น แล้วลบแถวที่เหลือ
 * — ลำดับแถวเดิมในตารางไม่เปลี่ยน และคอลัมน์หลัง S ของแถวบนสุดไม่ถูกแตะ
 */
function dedupeRooms() {
  var sh = sheet(), lay = layout(sh), last = sh.getLastRow();
  if (last < lay.start) return 0;
  var values = sh.getRange(lay.start, 1, last - lay.start + 1, WIDTH).getValues();

  var first = {}, best = {}, bestRank = {}, hasDupe = {}, dupes = [];
  values.forEach(function (row, i) {
    var room = Number(row[COL.ROOM]);
    if (!room) return;
    var at = lay.start + i, d = dateRank(row[COL.DATE]);
    if (!(room in first)) { first[room] = at; best[room] = row; bestRank[room] = d; return; }
    dupes.push(at); hasDupe[room] = true;
    if (d > bestRank[room]) { best[room] = row; bestRank[room] = d; }
  });

  if (!dupes.length) {
    SpreadsheetApp.getActive().toast('ไม่มีแถวซ้ำ — ห้องละแถวอยู่แล้ว', 'Curtain Check', 6);
    return 0;
  }
  var segs = writableSegments(formulaCols(sh, first[Object.keys(hasDupe)[0]]));
  Object.keys(hasDupe).forEach(function (room) {          // แตะเฉพาะห้องที่ซ้ำจริง
    writeRow(sh, first[room], best[room], segs);
  });
  dupes.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  SpreadsheetApp.getActive().toast('รวมแล้ว ลบแถวซ้ำไป ' + dupes.length + ' แถว', 'Curtain Check', 8);
  return dupes.length;
}

function whereAmI() {
  var sh = sheet(), lay = layout(sh);
  SpreadsheetApp.getActive().toast(
    'แท็บ: ' + sh.getName() + ' · ข้อมูลเริ่มแถว ' + lay.start +
    ' · มี ' + Math.max(0, sh.getLastRow() - lay.start + 1) + ' แถว', 'Curtain Check', 8);
}
