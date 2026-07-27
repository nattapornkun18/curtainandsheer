# Playbook — Connect a static HTML app to Google Sheets (read + write)

Reusable pattern for wiring a **static, single-file HTML app** (hosted on GitHub
Pages or any static host) to a **Google Sheet** as a shared backend, without a
server and without exposing API keys. Written from a real build; the gotchas
below are ones actually hit, not theoretical.

## When to use

- App is a static `index.html` (no backend, no build step).
- Data lives in a Google Sheet that non-technical people also edit by hand.
- Need multiple users/devices to see and update the same records.
- Don't want to run a server or leak a service-account key into client JS.

If the app already has a real backend, use the Sheets API from the server instead.

## Architecture

```
index.html (static host)  --GET-->  Apps Script /exec  --read-->   Google Sheet
                          --POST-->                     --upsert-->
```

Google Apps Script **Web App** is the bridge. It runs as the sheet owner, so the
browser never holds credentials. The exec URL is public by design (see Security).

---

## Step 1 — Inspect the sheet BEFORE writing code

Do not trust a summarized header. Fetch the raw grid and count columns:

```
https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&headers=0
```

Watch for:
- **Merged header cells** → the header spans 2+ rows and a CSV summary will
  collapse groups. `headers=0` gives you every raw cell so you can count.
- **Column count** from a real data row, not the header.
- **Extra columns the app must NOT overwrite** (e.g. a repair-status block filled
  by another team). Note where the app-owned block ends.
- Map every app field to an exact column index (A=0, B=1, …). Lock this down; it
  is the contract between HTML and Apps Script.

## Step 2 — Apps Script backend (`Code.gs`)

Bind via **Extensions → Apps Script** on the target sheet. Key decisions baked in
below: own only the first N columns, skip header rows by testing a key column for
a number, upsert by a business key.

```javascript
var SHEET_NAME = "";        // "" = first tab
var COLS = 19;              // only the app-owned block (A..S); leaves later cols alone
var KEY_COL = 3;            // 1-based column that holds the unique business key (Room No.)

function sheet_() {
  var ss = SpreadsheetApp.getActive();
  return SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
// duck-type, NOT `instanceof Date` (unreliable in Apps Script)
function fmtDate_(v) {
  if (v && typeof v.getTime === "function")
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "dd/MM/yyyy");
  return v == null ? "" : String(v);
}

function doGet() {
  var sh = sheet_(), last = sh.getLastRow(), out = [];
  if (last >= 1) {
    var rows = sh.getRange(1, 1, last, COLS).getValues();
    for (var i = 0; i < rows.length; i++) {
      var key = rows[i][KEY_COL - 1];
      if (key === "" || key == null || isNaN(Number(key))) continue; // skips header rows
      out.push(rowToObj_(rows[i]));
    }
  }
  return json_({ ok: true, records: out });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);                       // serialize concurrent writers
  try {
    var d = JSON.parse(e.postData.contents);
    var sh = sheet_(), row = objToRow_(d), last = sh.getLastRow(), target = -1;
    if (last >= 1) {
      var keys = sh.getRange(1, KEY_COL, last, 1).getValues();
      for (var i = 0; i < keys.length; i++)
        if (String(keys[i][0]) === String(d.key)) { target = i + 1; break; }
    }
    var atRow = target > 0 ? target : last + 1;
    sh.getRange(atRow, 1, 1, COLS).setValues([row]);  // writes A..COLS only → later cols preserved
    return json_({ ok: true, updated: target > 0 });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
// objToRow_ / rowToObj_ : map your fields to the exact column order from Step 1.
```

Deploy: **Deploy → New deployment → ⚙️ → Web app**, *Execute as: Me*, *Who has
access: **Anyone***. Copy the `/exec` URL.

## Step 3 — HTML integration

```javascript
const API = "https://script.google.com/macros/s/XXXX/exec"; // "" = offline only

async function load() {
  // localStorage first = instant paint + offline fallback
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORE) || "{}")); } catch {}
  if (!API) return;
  try {
    const j = await (await fetch(API)).json();
    if (j.records) { state.records = j.records; localStorage.setItem(STORE, JSON.stringify(state)); }
  } catch { /* show a toast, keep local data */ }
}

async function pushToSheet(rec) {
  if (!API) return undefined;
  try {
    await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight
      body: JSON.stringify(rec),
    });
    return true;
  } catch { return false; }  // saved locally, warn "not synced"
}
```

Pattern: **localStorage = cache/offline, Sheet = source of truth.** Read all on
open, upsert one record per save. Keep the app fully functional with `API = ""`
so the repo runs before the backend exists.

---

## Gotchas (all hit in practice)

1. **CORS preflight** — a normal `application/json` POST triggers an OPTIONS
   preflight that Apps Script does not answer. Send `Content-Type: text/plain`;
   the script still does `JSON.parse(e.postData.contents)`. No preflight, works.
2. **302 redirect on every call** — `/exec` 302s to `script.googleusercontent.com`.
   Browsers follow it automatically; server-side fetchers must follow manually.
3. **`instanceof Date` is unreliable** — sheet date cells come back as Date but
   `instanceof` can be false across contexts, silently falling through to
   `String(date)` (`"Thu Jul 23 2026 …"`). Duck-type with `typeof v.getTime`.
4. **Editing code ≠ redeploying** — after changing `Code.gs`, the live URL keeps
   the OLD code until **Manage deployments → Edit → Version: New version →
   Deploy**. "New deployment" instead mints a *new* URL. Same-URL updates need
   New version. (Symptom: verified fix, endpoint unchanged.)
5. **Skip header rows without hardcoding a count** — merged multi-row headers make
   "data starts at row N" fragile. Instead skip any row whose key column is not a
   number; header cells there are blank/text.
6. **Never write the whole row width** — write only the app-owned column count so a
   parallel team's columns (repair status, etc.) survive every upsert.
7. **`window.storage` is NOT a browser API** — it exists only inside the Claude
   artifact sandbox. On GitHub Pages it's undefined and silently kills persistence.
   Use `localStorage`.
8. **`LockService`** — without it, two simultaneous saves can append duplicate
   rows or clobber each other. Wrap `doPost` in a script lock.

## Deploy to GitHub Pages

`index.html` at repo root → **Settings → Pages → Deploy from a branch →**
pick the branch that has the sheet-connected version (mind `main` vs a feature
branch). Push auto-redeploys. URL: `https://<user>.github.io/<repo>/`.

Common snags: pushing to a repo you're only a **collaborator** on 403s until you
**accept the invite**; a wrong cached Git credential (different GitHub account)
also 403s — clear it in the OS credential manager.

## Security

The `/exec` URL is embedded in client JS = **anyone who has it can POST**. That is
inherent to keyless static→Sheets. Acceptable for internal tools. To lock down:
add a shared secret checked in `doPost`, validate payload shape/ranges, or gate
writes behind a rooms/allow-list. Reads can be similarly gated in `doGet`.
