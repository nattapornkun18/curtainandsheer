# Deploy — เชื่อม HTML กับ Google Sheet + ขึ้น GitHub Pages

App เก็บข้อมูลผ่าน **Google Apps Script Web App** เป็นตัวกลาง
GitHub Pages เป็น static host เขียน Google Sheet ตรงๆ ไม่ได้ ต้องมีตัวกลางนี้

```
index.html (GitHub Pages)  --GET-->  Apps Script /exec  --read-->   Google Sheet
                           --POST-->                     --upsert-->
```

- เปิด app → GET ดึงทุกห้องจาก sheet มาแสดง
- กด "บันทึก" → POST ห้องนั้นขึ้น sheet (มีแล้ว = เขียนทับตาม Room No. / ไม่มี = เพิ่มแถวใหม่)
- คอลัมน์ซ่อม (สถานะซ่อม / วันที่ซ่อม / ผู้ซ่อม) app **ไม่แตะ** ทีมซ่อมกรอกเองได้

---

## 1. ตั้ง Apps Script (ตัวกลาง)

1. เปิด Google Sheet เป้าหมาย → เมนู **Extensions → Apps Script**
2. ลบโค้ดเดิมทิ้ง → วางเนื้อหาจาก [apps-script/Code.gs](apps-script/Code.gs) ทั้งหมด
3. ถ้าข้อมูลไม่ได้อยู่แท็บแรก → แก้ `var SHEET_NAME = "";` ใส่ชื่อแท็บ
4. **Deploy → New deployment**
   - เลือกชนิด (เฟือง) → **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - กด **Deploy** → อนุญาตสิทธิ์ (Authorize) ครั้งแรก
5. คัดลอก **Web app URL** (ลงท้าย `/exec`)

> แก้โค้ดใน Apps Script ทีหลัง ต้อง **Deploy → Manage deployments → Edit → New version**
> URL เดิมถึงจะได้โค้ดใหม่

## 2. ใส่ URL ใน HTML

เปิด [index.html](index.html) หาบรรทัด:

```js
const API = "";
```

ใส่ URL ที่ได้:

```js
const API = "https://script.google.com/macros/s/AKfy...xxxx/exec";
```

`API = ""` = ทำงาน offline (localStorage อย่างเดียว ไม่ต่อ sheet)

## 3. ขึ้น GitHub Pages

GitHub deploy `index.html` ให้เองถ้าเปิด Pages:

1. push ขึ้น GitHub (branch `main` หรือจะ merge `dev` ก่อน)
2. repo → **Settings → Pages**
3. Source: **Deploy from a branch**
4. Branch: `main` · folder `/ (root)` → **Save**
5. รอ ~1 นาที ได้ URL `https://<user>.github.io/curtainandsheer/`

แก้ไฟล์แล้ว push ใหม่ → Pages redeploy อัตโนมัติ

---

## เช็คว่าเชื่อมสำเร็จ

- เปิด URL Pages → ควรเห็นห้องที่มีใน sheet ขึ้นมาแล้ว (แท็บ "บันทึกแล้ว")
- ตรวจห้อง → กดบันทึก → เปิด Google Sheet ดู แถวนั้นต้องอัปเดต
- เปิด app คนละเครื่อง → เห็นข้อมูลชุดเดียวกัน

## หมายเหตุ

- ปุ่ม "ล้างข้อมูลทั้งหมด" ลบแค่ cache ในเครื่อง **ไม่ลบแถวใน sheet**
- ส่งขึ้น sheet ไม่ได้ (เน็ตหลุด) → บันทึกในเครื่องก่อน แล้วกดบันทึกซ้ำทีหลังเพื่อ sync
