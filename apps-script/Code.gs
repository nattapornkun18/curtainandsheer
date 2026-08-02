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

/* ===================== แจ้งเตือนเข้า LINE =====================
   ตั้งค่าครั้งเดียว (วิธีทำอยู่ใน SETUP.md หัวข้อ “แจ้งเตือนเข้า LINE”)
   เว้น LINE_TOKEN ว่างไว้ = ไม่ส่งแจ้งเตือน ระบบอื่นทำงานปกติทุกอย่าง */

/** Channel access token (long-lived) จาก LINE Developers */
var LINE_TOKEN = '';

/** เว้นว่าง = ส่งหาทุกคนที่เป็นเพื่อนกับ LINE OA นี้ (broadcast)
 *  ใส่ userId / groupId ถ้าอยากส่งเจาะจงคนเดียวหรือกลุ่มเดียว */
var LINE_TO = '';

/** จะแจ้งตอนไหน
 *  'all'    = ทุกครั้งที่กดบันทึก — ตรวจครั้งแรกก็แจ้ง แก้ไขก็แจ้งพร้อมบอกจุดที่เปลี่ยน ← ค่าเริ่มต้น
 *  'update' = เฉพาะตอนแก้ไขห้องที่เคยบันทึกไว้แล้ว และมีอะไรเปลี่ยนจริง
 *  'defect' = เฉพาะห้องที่ผลออกมามีปัญหา
 *  'off'    = ไม่แจ้งเลย
 *  ทุกโหมด: บันทึกทับด้วยค่าเดิมเป๊ะ ๆ จะไม่ส่ง กันข้อความกวน */
var NOTIFY_WHEN = 'all';

var KEYS = ['closeSheer','closeCurtain','openSheer','openCurtain','switchSheer','switchCurtain',
            'manualSheer','manualCurtain','soundSheer','soundCurtain','smooth'];

/** ค่าที่ถือว่า “ปกติ” ของแต่ละหัวข้อ — ไม่ตรงกับนี้คือมีปัญหา */
var GOOD = {closeSheer:'ปิดสุด', closeCurtain:'ปิดสุด', openSheer:'เปิดสุด', openCurtain:'เปิดสุด',
            switchSheer:'good', switchCurtain:'good', manualSheer:'good', manualCurtain:'good',
            soundSheer:'good', soundCurtain:'good', smooth:'good'};

var LABEL = {closeSheer:'ปิด ม่านโปร่ง', closeCurtain:'ปิด ม่านทึบ',
             openSheer:'เปิด ม่านโปร่ง', openCurtain:'เปิด ม่านทึบ',
             switchSheer:'สวิตช์ ม่านโปร่ง', switchCurtain:'สวิตช์ ม่านทึบ',
             manualSheer:'มือดึง ม่านโปร่ง', manualCurtain:'มือดึง ม่านทึบ',
             soundSheer:'เสียง ม่านโปร่ง', soundCurtain:'เสียง ม่านทึบ',
             smooth:'เดินลื่นทั้งระบบ'};

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
  var result, saved = null;
  try {
    guard(body.token);
    lock.waitLock(25000);
    switch (body.action) {
      case 'upsert': {
        var res = upsert(body.records || (body.record ? [body.record] : []));
        result = json({ok:true, written:res.written, updated:res.updates.length, ts:Date.now()});
        saved = res;                                   // ค่อยแจ้งเตือนหลังปล่อยล็อก
        break;
      }
      case 'delete': result = json({ok:true, deleted:remove(body.room, body.date), ts:Date.now()}); break;
      default:       result = json({ok:false, error:'unknown action: ' + body.action});
    }
  } catch (err) {
    result = json({ok:false, error:String(err && err.message || err)});
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
  if (saved) notify(saved);
  return result;
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
  // บังคับช่องวันที่เป็น "ข้อความ" ก่อนเขียน ไม่งั้นชีตที่ตั้งภาษาอังกฤษ (US)
  // จะอ่าน 02/08/2026 เป็น 8 ก.พ. แล้ววันที่เพี้ยนสลับวัน-เดือน
  sh.getRange(at, COL.DATE + 1).setNumberFormat('@');
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

/** แถวนี้เคยถูกตรวจแล้วหรือยัง (แถว “รอตรวจ” ที่ยังไม่มีวันที่/ผลตรวจ = ยัง) */
function hasInspection(row) {
  if (normDate(row[COL.DATE])) return true;
  for (var i = 0; i < KEYS.length; i++) {
    if (String(row[COL.CHECK0 + i] === undefined ? '' : row[COL.CHECK0 + i]).trim()) return true;
  }
  return false;
}

/**
 * เขียนทับแถวของห้องนั้น (แถวบนสุดที่เจอ) ห้องที่ยังไม่มีค่อยต่อท้ายเป็นแถวใหม่
 * คืน {written, updates} — updates คือเฉพาะห้องที่ “เคยบันทึกไว้แล้ว” และถูกเขียนทับ
 * แต่ละตัวมี {before, after} ไว้เทียบว่าอะไรเปลี่ยนไปบ้าง
 */
function upsert(recs) {
  if (!recs || !recs.length) return {written:0, updates:[]};
  var sh = sheet(), lay = layout(sh), last = sh.getLastRow();

  var index = {}, snapshot = {}, lastData = 0;
  if (last >= lay.start) {
    var rows = sh.getRange(lay.start, 1, last - lay.start + 1, WIDTH).getValues();
    rows.forEach(function (row, i) {
      if (!Number(row[COL.ROOM])) return;
      var k = keyOf(row[COL.ROOM]);
      if (!index.hasOwnProperty(k)) {                            // เจอซ้ำ ยึดแถวบนสุด
        index[k] = lay.start + i;
        snapshot[k] = hasInspection(row) ? rowToRecord(row) : null;
      }
      lastData = lay.start + i;
    });
  }

  // ยุบรายการซ้ำในชุดเดียวกัน เหลืออันที่ส่งมาทีหลังสุด
  var byRow = {}, byRec = {}, order = [];
  recs.forEach(function (r) {
    if (!r || !Number(r.room)) return;
    var row = recordToRow(r);
    var k = keyOf(row[COL.ROOM]);
    if (!byRow.hasOwnProperty(k)) order.push(k);
    byRow[k] = row; byRec[k] = r;
  });

  var segs = writableSegments(formulaCols(sh, lastData));
  var cursor = lastData || (lay.start - 1);
  var updates = [];
  order.forEach(function (k) {
    var at = index[k];
    if (!at) {
      at = ++cursor;
      if (lastData) stampTemplate(sh, lastData, at);
    } else if (snapshot[k]) {
      updates.push({before: snapshot[k], after: byRec[k]});       // ห้องนี้เคยบันทึกไว้แล้ว
    }
    writeRow(sh, at, byRow[k], segs);
    index[k] = at;
  });
  return {
    written: order.length,
    all: order.map(function (k) { return byRec[k]; }),   // ทุกห้องที่เขียนลงไป
    updates: updates                                     // เฉพาะห้องที่เคยบันทึกไว้แล้ว
  };
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

/* ============================ แจ้งเตือน LINE ============================ */

/** จุดที่ไม่ปกติของห้องนั้น เช่น ["สวิตช์ ม่านทึบ: bad", "ปิด ม่านโปร่ง: ปิดไม่ได้ เหลือครึ่งทาง"] */
function badPoints(r) {
  var out = [];
  KEYS.forEach(function (k) {
    var v = r.checks && r.checks[k];
    if (v && String(v).trim() !== GOOD[k]) out.push(LABEL[k] + ': ' + v);
  });
  return out;
}

function roomMessage(r) {
  var bad = badPoints(r);
  var lines = [(bad.length ? '🔴 ' : '🟢 ') + r.room + (r.type ? ' · ' + r.type : '')];
  lines.push(bad.length ? 'พบปัญหา ' + bad.length + ' จุด' : 'ปกติทุกหัวข้อ');
  bad.forEach(function (b) { lines.push('• ' + b); });
  if (r.note) lines.push('📝 ' + r.note);
  lines.push('— ' + (r.by || 'ไม่ระบุผู้ตรวจ') + (r.date ? ' · ' + r.date : ''));
  return lines.join('\n');
}

/** ส่งทีเดียวหลายห้อง (เช่นกดปุ่ม “ส่งขึ้นชีตทั้งหมด”) ยุบเป็นข้อความเดียว
 *  items = [{type:'update', u:{before,after}} | {type:'new', r:record}] */
function batchMessage(items) {
  var lines = ['📋 อัปเดต ' + items.length + ' ห้อง', ''];
  items.forEach(function (it) {
    if (it.type === 'update') {
      var rb = resultOf(it.u.before), ra = resultOf(it.u.after);
      var d = diffLines(it.u.before, it.u.after).length;
      lines.push((ra === 'PASS' ? '🟢 ' : '🔴 ') + it.u.after.room + ' ✏️ ' +
                 (rb === ra ? ra : rb + ' → ' + ra) + (d ? ' · ' + d + ' จุดเปลี่ยน' : ''));
    } else {
      var bad = badPoints(it.r).length;
      lines.push((bad ? '🔴 ' : '🟢 ') + it.r.room + ' ' + resultOf(it.r) +
                 (bad ? ' · ' + bad + ' จุด' : ''));
    }
  });
  var first = items[0].type === 'update' ? items[0].u.after : items[0].r;
  lines.push('', '— ' + (first.by || 'ไม่ระบุผู้ตรวจ') + (first.date ? ' · ' + first.date : ''));
  return lines.join('\n');
}

/** userId/groupId ของ LINE ขึ้นต้นด้วย U (คน) C (กลุ่ม) R (ห้องแชท) ตามด้วยรหัส 32 ตัว
 *  เอาไว้กันสับสนกับ channel access token ซึ่งยาวกว่ามากและมี + / = ปนอยู่ */
function looksLikeLineId(v) {
  return /^[UCR][0-9a-f]{32}$/i.test(String(v || '').trim());
}

/** ส่งข้อความเข้า LINE — ไม่มี token ก็เงียบไป ไม่ทำให้การบันทึกพัง */
function lineSend(text) {
  if (!LINE_TOKEN) return false;
  if (LINE_TO && !looksLikeLineId(LINE_TO)) {
    throw new Error('LINE_TO ไม่ใช่ userId — ต้องขึ้นต้นด้วย U ตามด้วยรหัส 32 ตัว ' +
                    '(ถ้าเผลอวาง channel access token ลงไป ให้เว้นว่างหรือเอา Your user ID ' +
                    'จากแท็บ Basic settings มาใส่แทน)');
  }
  var url = LINE_TO ? 'https://api.line.me/v2/bot/message/push'
                    : 'https://api.line.me/v2/bot/message/broadcast';
  var payload = {messages:[{type:'text', text:String(text).slice(0, 4900)}]};
  if (LINE_TO) payload.to = LINE_TO;
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + LINE_TOKEN},
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('LINE ' + code + ': ' + res.getContentText());
  return true;
}

function resultOf(r) {
  return r.result || (badPoints(r).length ? 'DEFECT' : 'PASS');
}

/** หัวข้อที่ค่าเปลี่ยนไปจากครั้งก่อน */
function diffLines(before, after) {
  var out = [];
  KEYS.forEach(function (k) {
    var a = String((before.checks && before.checks[k]) || '').trim();
    var b = String((after.checks && after.checks[k]) || '').trim();
    if (a !== b) out.push('• ' + LABEL[k] + ': ' + (a || '—') + ' → ' + (b || '—'));
  });
  return out;
}

function changed(u) {
  return diffLines(u.before, u.after).length > 0 ||
         String(u.before.note || '') !== String(u.after.note || '') ||
         resultOf(u.before) !== resultOf(u.after);
}

/** ข้อความตอนแก้ไขห้องที่เคยบันทึกแล้ว — บอกว่าเปลี่ยนจากอะไรเป็นอะไร */
function updateMessage(u) {
  var b = u.before, a = u.after;
  var rb = resultOf(b), ra = resultOf(a);
  var lines = ['✏️ แก้ไข ' + a.room + (a.type ? ' · ' + a.type : '')];
  lines.push(rb === ra ? 'ผลตรวจ: ' + ra
                       : (ra === 'PASS' ? '🟢 ' : '🔴 ') + 'ผลตรวจ: ' + rb + ' → ' + ra);
  diffLines(b, a).forEach(function (d) { lines.push(d); });
  if (String(b.note || '') !== String(a.note || '')) {
    lines.push('📝 ' + (b.note || '(ว่าง)') + ' → ' + (a.note || '(ว่าง)'));
  }
  lines.push('— ' + (a.by || 'ไม่ระบุผู้ตรวจ') + (a.date ? ' · ' + a.date : '') +
             (b.date && b.date !== a.date ? ' (ตรวจครั้งก่อน ' + b.date + ')' : ''));
  return lines.join('\n');
}

/** res = ผลจาก upsert() : {written, updates:[{before, after}]}
 *  เหตุผลที่ไม่ส่งจะถูก log ไว้ ดูได้ที่ Apps Script → Executions */
function notify(res) {
  if (!LINE_TOKEN) { console.log('ไม่ส่ง LINE: ยังไม่ได้ใส่ LINE_TOKEN'); return; }
  if (NOTIFY_WHEN === 'off') { console.log('ไม่ส่ง LINE: NOTIFY_WHEN = off'); return; }
  if (!res) return;
  try {
    var updates = res.updates || [];
    var byRoom = {};
    updates.forEach(function (u) { byRoom[u.after.room] = u; });

    // แยกว่าห้องไหนเป็นการแก้ไข ห้องไหนเป็นการตรวจครั้งแรก
    var items = [];
    (res.all || []).forEach(function (r) {
      if (!r || !Number(r.room)) return;
      var u = byRoom[r.room];
      if (u) { if (changed(u)) items.push({type:'update', u:u}); }   // ทับค่าเดิม = ไม่กวน
      else items.push({type:'new', r:r});
    });

    if (NOTIFY_WHEN === 'update') {
      items = items.filter(function (it) { return it.type === 'update'; });
    } else if (NOTIFY_WHEN === 'defect') {
      items = items.filter(function (it) {
        return badPoints(it.type === 'update' ? it.u.after : it.r).length;
      });
    }

    if (!items.length) {
      console.log('ไม่ส่ง LINE: ไม่มีห้องที่เข้าเงื่อนไขของโหมด ' + NOTIFY_WHEN +
                  ' (บันทึกทับด้วยค่าเดิม หรือเป็นการตรวจครั้งแรกในโหมด update)');
      return;
    }
    var text = items.length > 1 ? batchMessage(items)
             : items[0].type === 'update' ? updateMessage(items[0].u)
             : roomMessage(items[0].r);
    lineSend(text);
    console.log('ส่ง LINE แล้ว');
  } catch (err) {
    console.log('แจ้งเตือน LINE ไม่สำเร็จ: ' + err);   // ข้อมูลลงชีตแล้ว ไม่ต้องล้มทั้ง request
  }
}

/* ============================ เมนูช่วยเช็คในชีต ============================ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Curtain Check')
    .addItem('เช็คว่าสคริปต์อ่านแท็บไหน', 'whereAmI')
    .addItem('รวมแถวซ้ำ ให้เหลือห้องละแถว', 'dedupeRooms')
    .addItem('ทดสอบส่งแจ้งเตือน LINE', 'testLine')
    .addItem('ตรวจสภาพการแจ้งเตือน LINE', 'lineDiag')
    .addToUi();
}

function lineGet(path) {
  var res = UrlFetchApp.fetch('https://api.line.me' + path, {
    method: 'get',
    headers: {Authorization: 'Bearer ' + LINE_TOKEN},
    muteHttpExceptions: true
  });
  return {code: res.getResponseCode(), body: res.getContentText()};
}

/** ไล่เช็คทีละชั้นว่าติดตรงไหน — token, โควตา, คนรับ, และโหมดแจ้งเตือน */
function lineDiag() {
  var ui = SpreadsheetApp.getUi(), out = [];
  if (!LINE_TOKEN) {
    ui.alert('ตรวจสภาพ LINE', 'ยังไม่ได้ใส่ LINE_TOKEN ใน Code.gs', ui.ButtonSet.OK);
    return;
  }

  var info = lineGet('/v2/bot/info');
  if (info.code !== 200) {
    out.push('❌ token ใช้ไม่ได้ (HTTP ' + info.code + ')');
    out.push(info.body);
    out.push('');
    out.push('401 = token ผิด/คัดลอกไม่ครบ · 403 = ยังไม่ได้เปิด Messaging API');
    ui.alert('ตรวจสภาพ LINE', out.join('\n'), ui.ButtonSet.OK);
    return;
  }
  var b = JSON.parse(info.body);
  out.push('✅ token ใช้ได้');
  out.push('บัญชี: ' + (b.displayName || '-') + '  ' + (b.basicId || ''));

  var q = lineGet('/v2/bot/message/quota');
  var c = lineGet('/v2/bot/message/quota/consumption');
  if (q.code === 200 && c.code === 200) {
    var qj = JSON.parse(q.body), cj = JSON.parse(c.body);
    var limit = (qj.type === 'limited' && qj.value) ? qj.value : 'ไม่จำกัด';
    out.push('โควตาเดือนนี้: ใช้ไป ' + cj.totalUsage + ' / ' + limit);
    if (qj.type === 'limited' && qj.value && cj.totalUsage >= qj.value) {
      out.push('⚠️ โควตาหมดแล้ว — ส่งไม่ออกจนกว่าจะขึ้นเดือนใหม่');
    }
  }

  var f = lineGet('/v2/bot/followers/ids?limit=100');
  if (f.code === 200) {
    var ids = (JSON.parse(f.body).userIds || []).length;
    out.push(ids ? '✅ มีคนเพิ่มเพื่อนแล้ว ' + ids + ' คน'
                 : '❌ ยังไม่มีใครเพิ่ม OA เป็นเพื่อน — ส่งไปก็ไม่มีคนรับ');
  } else {
    out.push('เช็คจำนวนเพื่อนไม่ได้ (HTTP ' + f.code + ' — บัญชีที่ยังไม่รับรองจะเช็คไม่ได้)');
    out.push('ให้เช็คเองว่าสแกน QR เพิ่ม OA เป็นเพื่อนแล้วหรือยัง');
  }

  out.push('');
  out.push('โหมดแจ้งเตือน: ' + NOTIFY_WHEN +
           (NOTIFY_WHEN === 'update' ? '  (แจ้งเฉพาะตอนแก้ห้องที่เคยบันทึกแล้ว และค่าต้องเปลี่ยนจริง)' : ''));
  if (!LINE_TO) {
    out.push('ปลายทาง: ทุกคนที่เป็นเพื่อนกับ OA (broadcast)');
  } else if (looksLikeLineId(LINE_TO)) {
    out.push('ปลายทาง: ' + LINE_TO.slice(0, 8) + '…  (ส่งเจาะจง)');
  } else {
    out.push('❌ LINE_TO ผิดรูปแบบ — ส่งไม่ออกแน่นอน');
    out.push('   ต้องเป็น userId ขึ้นต้นด้วย U ตามด้วยรหัส 32 ตัว');
    out.push('   เอามาจาก LINE Developers → แท็บ Basic settings → ล่างสุด "Your user ID"');
    out.push('   หรือเว้นว่างไว้ถ้าอยากส่งหาทุกคนที่เพิ่มเพื่อน');
  }
  out.push('');
  out.push('ถ้าทุกอย่างข้างบนเขียว แต่กดบันทึกในแอปแล้วไม่มีข้อความ');
  out.push('= ยังไม่ได้ Deploy เวอร์ชันใหม่ (Deploy → Manage deployments → ✏️ → New version)');

  ui.alert('ตรวจสภาพ LINE', out.join('\n'), ui.ButtonSet.OK);
}

function testLine() {
  var ui = SpreadsheetApp.getUi();
  if (!LINE_TOKEN) {
    ui.alert('ยังไม่ได้ใส่ LINE_TOKEN ใน Code.gs — ดูวิธีทำใน SETUP.md');
    return;
  }
  try {
    lineSend('🔔 ทดสอบแจ้งเตือนจากชีตเช็คม่าน\nถ้าเห็นข้อความนี้ = ตั้งค่าเรียบร้อยแล้ว');
    ui.alert('ส่งแล้ว — ไปเช็คใน LINE ได้เลย\n' +
             (LINE_TO ? 'ส่งเจาะจงไปที่ ' + LINE_TO : 'ส่งหาทุกคนที่เป็นเพื่อนกับ LINE OA นี้'));
  } catch (err) {
    ui.alert('ส่งไม่สำเร็จ\n\n' + err +
             '\n\n401 = token ผิด/หมดอายุ · 403 = แผนหรือสิทธิ์ไม่ให้ส่ง' +
             '\n429 = ส่งครบโควตาเดือนนี้แล้ว');
  }
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
