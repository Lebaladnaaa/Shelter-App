// Minimal in-memory Google Apps Script environment to run Code.gs for testing.
// Unit tests:   node roles_test.js && node backend.test.js && node delete_test.js
// Fake web app: node mock-gas.js ../apps-script/Code.gs 8001   (admin code begad-0001, team code Shelter-2027)
const fs = require('fs');
const vm = require('vm');

function makeEnv(codePath) {
  const sheets = new Map();
  const props = {};
  const files = [];
  let folderSeq = 0;
  const folders = new Map();
  const mails = [];

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr: nr || 1, nc: nc || 1 }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sh.rows[this.r - 1 + i] || [];
        const o = [];
        for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined ? '' : v); }
        out.push(o);
      }
      return out;
    }
    getValue() { return this.getValues()[0][0]; }
    setValues(vals) {
      if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error(`setValues size mismatch ${vals.length}x${vals[0].length} vs ${this.nr}x${this.nc}`);
      vals.forEach((row, i) => {
        const ri = this.r - 1 + i;
        while (this.sh.rows.length <= ri) this.sh.rows.push([]);
        row.forEach((v, j) => { this.sh.rows[ri][this.c - 1 + j] = v; });
      });
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    setFontWeight() { return this; } setBackground() { return this; } setNumberFormat() { return this; } setDataValidation() { return this; }
    getSheet() { return this.sh; } getRow() { return this.r; } getColumn() { return this.c; } getNumRows() { return this.nr; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    getName() { return this.name; }
    getLastRow() { let n = this.rows.length; while (n > 0 && !(this.rows[n - 1] || []).some((v) => v !== '' && v !== undefined && v !== null)) n--; return n; }
    getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
    getMaxRows() { return 1000; }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
    getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
    appendRow(row) { this.rows.length = this.getLastRow(); this.rows.push(row.slice()); }
    deleteRows(start, n) { this.rows.splice(start - 1, n); }
    setFrozenRows() {} hideColumns() {} setColumnWidth() {} clearContents() { this.rows = []; return this; }
  }
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.set(n, s); return s; },
    getId: () => 'SHEETID'
  };
  const dv = { requireValueInList() { return dv; }, setAllowInvalid() { return dv; }, build() { return {}; } };
  function mkFolder(name) {
    const id = 'F' + String(++folderSeq).padStart(30, '0');
    const f = {
      id, name, files: [],
      getId: () => id, getUrl: () => 'https://drive.google.com/drive/folders/' + id,
      createFolder: (n) => mkFolder(n),
      createFile: (blob) => {
        const fid = 'X' + String(files.length + 1).padStart(30, '0');
        const file = { id: fid, name: blob.name, size: blob.bytes.length, bytes: blob.bytes, mime: blob.mime, trashed: false, folder: name, getBlob() { const f = this; return { getBytes: () => f.bytes, getContentType: () => f.mime, getName: () => f.name }; }, getUrl: () => 'https://drive.google.com/file/d/' + fid, setTrashed(t) { this.trashed = t; } };
        files.push(file); f.files.push(file); return file;
      }
    };
    folders.set(id, f);
    return f;
  }
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, newDataValidation: () => dv, getUi: () => { throw new Error('no ui'); } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    DriveApp: { createFolder: (n) => mkFolder(n), getFileById: (id) => { const f = files.find((x) => x.id === id); if (!f) throw new Error('no file'); return f; }, getFolderById: (id) => { const f = folders.get(id); if (!f) throw new Error('no folder'); return f; } },
    CacheService: (() => { const m = new Map(); return { getScriptCache: () => ({ get: (k) => (m.has(k) ? m.get(k) : null), put: (k, v) => { m.set(k, v); } }) }; })(),
    MailApp: { sendEmail: (o) => { mails.push(o); }, getRemainingDailyQuota: () => 100 - mails.length },
    Utilities: { sleep: () => {}, getUuid: () => require('crypto').randomUUID(),
      computeHmacSha256Signature: (value, key) => Array.from(require('crypto').createHmac('sha256', Buffer.from(String(key), 'utf8')).update(Buffer.from(String(value), 'utf8')).digest()), base64Encode: (b) => Buffer.from(b).toString('base64'), base64Decode: (s) => Array.from(Buffer.from(s, 'base64')), newBlob: (bytes, mime, name) => ({ bytes, mime, name }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }) },
    Logger: { log: () => {} },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(codePath || process.argv[2] || require('path').join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
  return { ctx, sheets, files, folders, mails, props };
}
module.exports = { makeEnv };

if (require.main === module) {
  // HTTP server that behaves like the deployed web app
  const http = require('http');
  const env = makeEnv();
  env.ctx.setup();
  // fixed first-time codes for the browser tests (admins); everyone else signs up with the team code
  const urows = env.sheets.get('Users').rows, codeCol = urows[0].indexOf('Code');
  urows[1][codeCol] = 'begad-0001'; urows[2][codeCol] = 'hawary-0002';
  env.sheets.get('Settings').rows.find((r) => r[0] === 'Team code')[1] = 'Shelter-2027';
  const code = 'begad-0001';
  const port = Number(process.argv[3] || 8001);
  http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let out;
      if (req.url.startsWith('/__mail')) out = { content: JSON.stringify(env.mails) };
      else if (req.url.startsWith('/__fresh')) out = { content: JSON.stringify(env.ctx.startFresh_(/keep=1/.test(req.url))) }; // Shelter → Start fresh
      else if (req.url.startsWith('/__dump')) out = { content: JSON.stringify({ sheets: Object.fromEntries([...env.sheets].map(([k, v]) => [k, v.rows])), files: env.files.map((f) => ({ name: f.name, size: f.size, folder: f.folder, trashed: f.trashed })) }) };
      else if (req.method === 'GET') out = env.ctx.doGet();
      else out = env.ctx.doPost({ postData: { contents: body } });
      res.setHeader('Content-Type', 'application/json');
      res.end(out.content);
    });
  }).listen(port, () => console.log('mock GAS on', port, 'team code', code));
}
