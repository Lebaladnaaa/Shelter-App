/* Lebaladna Shelter Surveys – offline-first survey app.
 * Data lives on the phone (IndexedDB) and syncs to the team Google Sheet through Apps Script.
 */
(function () {
  'use strict';

  /* ═════════════════════ Config & constants ═════════════════════ */
  const CFG = Object.assign({ apiUrl: '', demo: false, assets: {} }, window.SHELTER_CONFIG || {});
  const ASSET = Object.assign({
    shelterLogo: 'shelter-logo.png',
    lebaladnaLogo: 'lebaladna-logo.png',
    jspdf: 'jspdf.umd.min.js',
    pptx: 'pptxgen.bundle.js'
  }, CFG.assets || {});
  const APP_VERSION = '1.4.0';

  const STATUSES = ['Draft', 'Submitted', 'Approved', 'Roofed', 'Cancelled'];
  const ROOM_NAMES = ['Bedroom', 'Kitchen', 'Bathroom', 'Hall', 'Reception', 'Stairs', 'Animal pen', 'Storage', 'Courtyard'];
  const GRADES = ['A', 'B+', 'B', 'C'];
  const ROOM_COLORS = [
    { fill: '#F4A817', ink: '#1E1A10' }, { fill: '#4F96D9', ink: '#FFFFFF' }, { fill: '#0B2361', ink: '#FFFFFF' },
    { fill: '#E8E2C4', ink: '#1E1A10' }, { fill: '#8CC63F', ink: '#14200A' }, { fill: '#2A9D8F', ink: '#FFFFFF' },
    { fill: '#D9707A', ink: '#FFFFFF' }, { fill: '#7E6BC4', ink: '#FFFFFF' }, { fill: '#C9772F', ink: '#FFFFFF' },
    { fill: '#6D6E71', ink: '#FFFFFF' }
  ];
  const STOCK_LENGTHS = Array.from({ length: 14 }, (_, i) => 210 + i * 30); // 210, 240 … 600 cm
  const DEFAULT_RULES = {
    beam: STOCK_LENGTHS, plank: STOCK_LENGTHS, allowance: 10,
    beamSpacing: 0.6, plankWidth: 0.1, extraBeams: 0, extraPlanks: 0, example: false
  };
  const DEFAULT_PAPERS = [
    { name: 'National ID – front', required: true },
    { name: 'National ID – back', required: true },
    { name: 'Other paper', required: false }
  ];
  const STEPS = [
    { key: 'family', label: 'Family' }, { key: 'rooms', label: 'Rooms' }, { key: 'plan', label: 'Plan' },
    { key: 'papers', label: 'Papers' }, { key: 'wood', label: 'Wood & export' }
  ];
  const PX = 100; // plan units per metre (centimetres)
  const BODY_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Arabic", "Noto Sans", Arial, sans-serif';
  const DISPLAY_FONT = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';

  /* ═════════════════════ Small utilities ═════════════════════ */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nowIso = () => new Date().toISOString();
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r2 = (v) => Math.round(v * 100) / 100;

  function uid() {
    let rnd = '';
    try { rnd = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join(''); }
    catch (e) { rnd = Math.random().toString(36).slice(2, 10); }
    return Date.now().toString(36) + rnd;
  }

  function toNum(v) {
    if (typeof v === 'number') return v;
    const s = String(v == null ? '' : v).trim()
      .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
      .replace(/[۰-۹]/g, (c) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c))
      .replace(/[٫,]/g, '.').replace(/[^0-9.\-]/g, '');
    const n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }
  /** Room side in metres; 345 or 345cm → 3.45 m. */
  function parseLen(str) {
    const v = toNum(str);
    if (!(v > 0)) return null;
    return v >= 30 ? r2(v / 100) : r2(v);
  }
  function fmtM(v) {
    if (!(v > 0)) return '';
    const r = r2(v);
    return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, '');
  }
  const lenLabel = (v) => fmtM(v) + ' m';
  function woodText(map) {
    const keys = Object.keys(map || {}).map(Number).sort((a, b) => a - b);
    return keys.map((k) => k + ' × ' + map[k]).join(', ');
  }
  function fmtWhen(iso) {
    if (!iso) return 'never';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.round(diff / 60) + ' min ago';
    if (diff < 86400) return Math.round(diff / 3600) + ' h ago';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = () => /android/i.test(navigator.userAgent);
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms || 2800);
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  const ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    wood: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="10.5" width="18" height="5" rx="1"/><path d="M7 17v3M17 17v3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>'
  };

  /* ═════════════════════ Wood calculation (same rules as the sheet) ═════════════════════ */
  /** Rules: the lengths (cm) you can buy; a side needs side + allowance, rounded up to the next length. */
  function normRules(r) {
    r = r || DEFAULT_RULES;
    const lens = (list) => Array.from(new Set((list || []).map((x) => Math.round(typeof x === 'object' && x ? x.buy : x)).filter((n) => n > 0))).sort((a, b) => a - b);
    return {
      beam: lens(r.beam),
      plank: lens(r.plank),
      allowance: r.allowance >= 0 ? Math.round(r.allowance) : 10,
      beamSpacing: r.beamSpacing > 0 ? r.beamSpacing : 0.6,
      plankWidth: r.plankWidth > 0 ? r.plankWidth : 0.1,
      extraBeams: Math.max(0, Math.round(r.extraBeams || 0)),
      extraPlanks: Math.max(0, Math.round(r.extraPlanks || 0)),
      example: !!r.example
    };
  }
  const pickFit = (lengths, needCm) => { for (let i = 0; i < lengths.length; i++) if (lengths[i] >= needCm) return lengths[i]; return null; };
  function pickLen(lengths, sideM, allowance) { return pickFit(lengths, Math.round(sideM * 100) + allowance); }
  /** One piece if side + allowance fits the longest length; otherwise two equal halves that meet in the middle. */
  function piecesFor(lengths, sideM, allowance) {
    const need = Math.round(sideM * 100) + allowance;
    const one = pickFit(lengths, need);
    if (one) return { len: one, parts: 1 };
    const half = pickFit(lengths, Math.ceil(need / 2));
    return half ? { len: half, parts: 2 } : null;
  }
  /**
   * Per roofed room: beams lie along the beam side, one every "beam spacing" across the plank side;
   * planks lie along the plank side, one row every "plank width" across the beam side.
   * A side over the longest length (with the wall allowance) uses two pieces meeting in the middle:
   * planks meet on the middle beam (beam count made odd so one sits there); beams meet on a support.
   */
  function calcWood(rooms, rawRules) {
    const rules = normRules(rawRules);
    const res = { rooms: [], beams: {}, planks: {}, roofArea: 0, roofed: 0, warnings: [], notes: [] };
    (rooms || []).forEach((r, i) => {
      const bs = toNum(r.beamSide), ps = toNum(r.plankSide);
      const row = { id: r.id, name: r.name || ('Room ' + (i + 1)), roof: !!r.roof, beamSide: bs, plankSide: ps, color: r.color, notes: [] };
      if (!r.roof) { res.rooms.push(row); return; }
      if (!(bs > 0 && ps > 0)) {
        row.missing = true;
        res.warnings.push(row.name + ': add both sides');
        res.rooms.push(row);
        return;
      }
      res.roofed++;
      res.roofArea += bs * ps;
      const bp = piecesFor(rules.beam, bs, rules.allowance);
      const pp = piecesFor(rules.plank, ps, rules.allowance);
      row.beamCount = Math.ceil(ps / rules.beamSpacing - 1e-9);
      if (pp && pp.parts === 2 && row.beamCount % 2 === 0) row.beamCount += 1; // a beam in the middle for the plank joint
      row.plankRows = Math.ceil(bs / rules.plankWidth - 1e-9);
      if (bp) {
        row.beamLen = bp.len; row.beamParts = bp.parts;
        row.beamQty = row.beamCount * bp.parts + rules.extraBeams;
        res.beams[bp.len] = (res.beams[bp.len] || 0) + row.beamQty;
        if (bp.parts === 2) row.notes.push('beam side ' + fmtM(bs) + ' m is over ' + fmtM(rules.beam[rules.beam.length - 1] / 100) + ' m: 2 beams of ' + bp.len + ' per line, meeting on a support across the middle (support not in the wood list)');
      } else res.warnings.push(row.name + ': beam side ' + fmtM(bs) + ' m is too long even for 2 beams. Split the room');
      if (pp) {
        row.plankLen = pp.len; row.plankParts = pp.parts;
        row.plankQty = row.plankRows * pp.parts + rules.extraPlanks;
        res.planks[pp.len] = (res.planks[pp.len] || 0) + row.plankQty;
        if (pp.parts === 2) row.notes.push('plank side ' + fmtM(ps) + ' m is over ' + fmtM(rules.plank[rules.plank.length - 1] / 100) + ' m: 2 planks of ' + pp.len + ' per row, meeting on the middle beam');
      } else res.warnings.push(row.name + ': plank side ' + fmtM(ps) + ' m is too long even for 2 planks. Split the room');
      row.notes.forEach((n) => res.notes.push(row.name + ': ' + n));
      res.rooms.push(row);
    });
    return res;
  }
  function sumWood(list) {
    const beams = {}, planks = {};
    let area = 0;
    list.forEach((s) => {
      const w = calcWood(s.rooms, S.config.rules);
      Object.keys(w.beams).forEach((k) => { beams[k] = (beams[k] || 0) + w.beams[k]; });
      Object.keys(w.planks).forEach((k) => { planks[k] = (planks[k] || 0) + w.planks[k]; });
      area += w.roofArea;
    });
    return { beams, planks, area };
  }

  /* ═════════════════════ Storage (IndexedDB, memory fallback) ═════════════════════ */
  const DB = (() => {
    let dbp = null;
    const mem = { surveys: new Map(), files: new Map(), meta: new Map() };
    let useMem = false;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((resolve, reject) => {
        let req;
        try { req = indexedDB.open('shelter-surveys', 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => {
          const d = req.result;
          d.createObjectStore('surveys', { keyPath: 'id' });
          d.createObjectStore('files', { keyPath: 'id' });
          d.createObjectStore('meta', { keyPath: 'k' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('blocked'));
      });
      return dbp;
    }
    const wrap = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted')); });
    async function init() {
      try { await open(); return true; } catch (e) { useMem = true; return false; }
    }
    async function get(store, key) {
      if (useMem) return mem[store].get(key);
      const d = await open();
      return wrap(d.transaction(store).objectStore(store).get(key));
    }
    async function put(store, val) {
      if (useMem) { mem[store].set(val.id || val.k, val); return; }
      const d = await open();
      const t = d.transaction(store, 'readwrite');
      t.objectStore(store).put(val);
      return done(t);
    }
    async function del(store, key) {
      if (useMem) { mem[store].delete(key); return; }
      const d = await open();
      const t = d.transaction(store, 'readwrite');
      t.objectStore(store).delete(key);
      return done(t);
    }
    async function all(store) {
      if (useMem) return Array.from(mem[store].values());
      const d = await open();
      return wrap(d.transaction(store).objectStore(store).getAll());
    }
    async function clear() {
      if (useMem) { Object.values(mem).forEach((m) => m.clear()); return; }
      const d = await open();
      const t = d.transaction(['surveys', 'files', 'meta'], 'readwrite');
      ['surveys', 'files', 'meta'].forEach((s) => t.objectStore(s).clear());
      return done(t);
    }
    return {
      init, get, put, del, all, clear,
      meta: async (k) => { const r = await get('meta', k); return r ? r.v : undefined; },
      setMeta: (k, v) => put('meta', { k, v }),
      get memoryOnly() { return useMem; }
    };
  })();

  /* ═════════════════════ State ═════════════════════ */
  const S = {
    me: null,
    surveys: new Map(),
    config: { rules: DEFAULT_RULES, papers: DEFAULT_PAPERS, project: '', updatedAt: null },
    lastPull: '',
    lastSyncAt: 0,
    sync: { state: 'idle', msg: '' },
    list: { filter: 'active', q: '', selecting: false, picked: new Set() },
    cur: null,
    stepOf: {},
    installPrompt: null,
    invite: null,
    pendingDeletes: [] // surveys deleted on this phone, waiting to be deleted from the sheet
  };
  /** Google adds /u/0/, /u/1/… when several accounts are signed in; that form fails for everyone else. */
  const cleanApi = (u) => String(u || '').trim().replace(/\/macros\/u\/\d+\/s\//, '/macros/s/');
  const apiUrl = () => cleanApi((S.me && S.me.api) || CFG.apiUrl || '');
  const curSurvey = () => (S.cur ? S.surveys.get(S.cur.id) : null);

  const saveTimers = new Map();
  function saveLocalSoon(s, ms) {
    clearTimeout(saveTimers.get(s.id));
    saveTimers.set(s.id, setTimeout(() => { saveTimers.delete(s.id); DB.put('surveys', s).catch(() => toast('Could not save on this phone. Free some storage space.')); }, ms == null ? 250 : ms));
  }
  function flushLocal() {
    saveTimers.forEach((t, id) => { clearTimeout(t); const s = S.surveys.get(id); if (s) DB.put('surveys', s).catch(() => {}); });
    saveTimers.clear();
  }
  function touch(s) {
    s.updatedAt = nowIso();
    s.updatedBy = S.me && S.me.name;
    s.dirty = true;
    s.isNew = false;
    saveLocalSoon(s);
    scheduleSync(5000);
    updateSyncPill();
  }
  /** Remove a survey and its photos from this phone only. */
  async function removeLocal(id) {
    const s = S.surveys.get(id);
    S.surveys.delete(id);
    S.list.picked.delete(id);
    clearTimeout(saveTimers.get(id)); saveTimers.delete(id);
    await DB.del('surveys', id).catch(() => {});
    for (const p of (s && s.papers) || []) await DB.del('files', p.id).catch(() => {});
    if (S.cur && S.cur.id === id) { S.cur = null; if (currentView === 'editor') { go(''); toast('This survey was deleted.'); } }
  }
  /** Delete everywhere: from this phone now, from the sheet (and so every other phone) on the next sync. */
  async function deleteSurvey(s) {
    if (!s.isNew && !S.pendingDeletes.some((d) => d.id === s.id)) {
      S.pendingDeletes.push({ id: s.id, code: s.code || '', family: s.family || '' });
      await DB.setMeta('pendingDeletes', S.pendingDeletes).catch(() => {});
    }
    await removeLocal(s.id);
    go('');
    toast('Deleted ' + (s.family || 'the survey'));
    scheduleSync(300);
  }
  function pendingCount() {
    let n = S.pendingDeletes.length;
    S.surveys.forEach((s) => {
      if (s.isNew) return;
      if (s.dirty) n++;
      (s.papers || []).forEach((p) => { if (p.status === 'pending') n++; });
    });
    return n;
  }

  /* ═════════════════════ Sync with the Google Sheet ═════════════════════ */
  let syncing = false, syncAgain = false, syncTimer = null;
  function scheduleSync(ms) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, ms == null ? 2500 : ms);
  }
  async function api(action, body, timeoutMs) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs || 45000) : null;
    let res;
    try {
      res = await fetch(apiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action, key: S.me.key, by: S.me.name, device: S.me.deviceId, v: APP_VERSION }, body || {})),
        redirect: 'follow',
        signal: ctrl ? ctrl.signal : undefined
      });
    } catch (e) {
      const err = new Error('No connection to the sheet');
      err.code = 'offline';
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    let j;
    try { j = await res.json(); } catch (e) {
      const err = new Error('The sheet answered with something unexpected (HTTP ' + res.status + '). Check the connection link.');
      err.code = 'bad_response';
      throw err;
    }
    if (!j.ok) {
      const err = new Error(j.message || j.error || 'Sheet error');
      err.code = j.error || 'error';
      throw err;
    }
    return j;
  }

  async function syncNow() {
    clearTimeout(syncTimer);
    if (CFG.demo || !S.me || !apiUrl() || !S.me.key) { updateSyncPill(); return; }
    if (syncing) { syncAgain = true; return; }
    if (navigator.onLine === false) { S.sync.state = 'offline'; updateSyncPill(); return; }
    syncing = true;
    S.sync.state = 'busy';
    updateSyncPill();
    try {
      await pushDeletes();
      await pushSurveys();
      await pushPapers();
      await pull();
      S.sync = { state: 'ok', msg: '' };
      S.lastSyncAt = Date.now();
      DB.setMeta('lastSyncAt', S.lastSyncAt).catch(() => {});
    } catch (e) {
      if (e.code === 'offline') S.sync = { state: 'offline', msg: e.message };
      else if (e.code === 'bad_key') S.sync = { state: 'badkey', msg: 'The team code on this phone is not accepted. Ask your team lead for the current code and change it in Settings.' };
      else if (e.code === 'busy') { S.sync = { state: 'wait', msg: 'The sheet was busy. Trying again shortly.' }; scheduleSync(8000); }
      else S.sync = { state: 'error', msg: e.message || String(e) };
    } finally {
      syncing = false;
      updateSyncPill();
      if (syncAgain) { syncAgain = false; scheduleSync(600); }
      else if (pendingCount() > 0 && S.sync.state === 'ok') scheduleSync(4000);
    }
  }

  function surveyPayload(s) {
    const keys = ['id', 'code', 'status', 'project', 'area', 'researcher', 'reviewer', 'date', 'family', 'age', 'members',
      'grade', 'nationalId', 'job', 'income', 'mobile', 'notes', 'createdAt', 'deviceId'];
    const o = {};
    keys.forEach((k) => { if (s[k] != null) o[k] = s[k]; });
    o.rooms = (s.rooms || []).map((r) => ({ id: r.id, name: r.name, grade: r.grade, roof: !!r.roof, beamSide: r.beamSide, plankSide: r.plankSide, color: r.color }));
    o.updatedBy = S.me.name;
    return o;
  }

  async function pushDeletes() {
    while (S.pendingDeletes.length) {
      const d = S.pendingDeletes[0];
      await api('deleteSurvey', { id: d.id });
      S.pendingDeletes.shift();
      await DB.setMeta('pendingDeletes', S.pendingDeletes);
    }
  }

  async function pushSurveys() {
    const list = Array.from(S.surveys.values()).filter((s) => s.dirty && !s.isNew);
    for (const s of list) {
      const sentAt = s.updatedAt;
      let res;
      try {
        res = await api('saveSurvey', { survey: surveyPayload(s), layout: s.layout, base: s.base || '' });
      } catch (e) {
        if (e.code === 'deleted') { await removeLocal(s.id); refreshAfterSync(s, false); continue; } // someone deleted it
        throw e;
      }
      const live = S.surveys.get(s.id);
      if (!live) continue;
      live.code = res.code;
      live.base = res.updatedAt;
      if (res.status && res.status !== live.status) live.status = res.status;
      if (live.updatedAt === sentAt) live.dirty = false;
      await DB.put('surveys', live);
      refreshAfterSync(live, true);
    }
  }

  async function pushPapers() {
    for (const s of S.surveys.values()) {
      if (s.isNew || !s.base) continue;
      for (const p of (s.papers || [])) {
        if (p.status !== 'pending') continue;
        const rec = await DB.get('files', p.id);
        if (!rec || !rec.blob) { p.status = 'missing'; await DB.put('surveys', s); continue; }
        const data = await blobToBase64(rec.blob);
        let res;
        try {
          res = await api('uploadFile', { surveyId: s.id, fileId: p.id, paper: p.paper, name: p.name, mime: p.mime, data }, 120000);
        } catch (e) {
          if (e.code === 'survey_missing') { s.dirty = true; await DB.put('surveys', s); continue; }
          if (e.code === 'deleted') { await removeLocal(s.id); break; }
          throw e;
        }
        p.status = 'uploaded';
        p.url = res.url;
        p.uploadedAt = nowIso();
        await DB.put('surveys', s);
        await DB.del('files', p.id).catch(() => {});
        refreshAfterSync(s, false);
      }
    }
  }

  async function applyConfig(res) {
    const c = res && res.config;
    if (!c) return;
    const rules = c.rules || {};
    const hasRules = (rules.beam && rules.beam.length) || (rules.plank && rules.plank.length);
    S.config = {
      rules: hasRules ? rules : Object.assign({}, DEFAULT_RULES, rules, { beam: DEFAULT_RULES.beam, plank: DEFAULT_RULES.plank, example: true }),
      papers: c.papers && c.papers.length ? c.papers : DEFAULT_PAPERS,
      project: c.project || '',
      updatedAt: res.serverTime || nowIso()
    };
    await DB.setMeta('config', S.config);
  }

  function keepFocus(fn) {
    const a = document.activeElement;
    const id = a && a.id;
    const pos = a && typeof a.selectionStart === 'number' ? a.selectionStart : null;
    fn();
    if (!id) return;
    const el = document.getElementById(id);
    if (el && el !== document.activeElement) {
      el.focus({ preventScroll: true });
      if (pos != null && el.setSelectionRange) { try { el.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
    }
  }

  async function pull() {
    const res = await api('pull', { since: S.lastPull || '' }, 60000);
    await applyConfig(res);
    let changedCurrent = false;
    // surveys someone deleted: remove them here too
    for (const d of res.deleted || []) if (S.surveys.has(d.id)) await removeLocal(d.id);
    const gone = new Set((res.deleted || []).map((d) => d.id).concat(S.pendingDeletes.map((d) => d.id)));
    for (const r of res.surveys || []) {
      if (gone.has(r.id)) continue;
      const local = S.surveys.get(r.id);
      if (local && local.dirty) continue; // our newer edits win; they upload next round
      const pendingPapers = local ? (local.papers || []).filter((p) => p.status !== 'uploaded') : [];
      const remotePapers = (r.papers || []).map((p) => {
        const old = local && (local.papers || []).find((q) => q.id === p.id);
        return Object.assign({}, p, old && old.thumb ? { thumb: old.thumb } : {});
      });
      const merged = Object.assign({}, r, {
        layout: r.layout && r.layout.rooms ? r.layout : (local && local.layout) || { rooms: {} },
        papers: remotePapers.concat(pendingPapers.filter((p) => !remotePapers.some((q) => q.id === p.id))),
        base: r.updatedAt, dirty: false, isNew: false
      });
      S.surveys.set(r.id, merged);
      await DB.put('surveys', merged);
      if (S.cur && S.cur.id === r.id) changedCurrent = true;
    }
    S.lastPull = res.serverTime || S.lastPull;
    await DB.setMeta('lastPull', S.lastPull);
    if (!S.cur && currentView === 'list') keepFocus(renderList);
    if (changedCurrent && currentView === 'editor') {
      const a = document.activeElement;
      if (!a || !/INPUT|TEXTAREA|SELECT/.test(a.tagName)) renderEditor(S.cur.id);
    }
  }

  function refreshAfterSync(s, codeMayChange) {
    if (currentView === 'list') keepFocus(renderList);
    else if (currentView === 'editor' && S.cur && S.cur.id === s.id) {
      if (codeMayChange) { const e = $('#eyebrow'); if (e) e.textContent = s.code || 'Not uploaded yet'; }
      if (S.cur.step === 3) renderPapersList();
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  function syncInfo() {
    const p = pendingCount();
    if (CFG.demo) return { cls: '', text: 'Demo' };
    if (!apiUrl() || !S.me || !S.me.key) return { cls: 'err', text: 'Not connected' };
    if (S.sync.state === 'badkey') return { cls: 'err', text: 'Code rejected' };
    if (S.sync.state === 'busy') return { cls: 'busy', text: p ? 'Uploading ' + p : 'Syncing' };
    if (navigator.onLine === false || S.sync.state === 'offline') return { cls: 'wait', text: p ? 'Offline · ' + p : 'Offline' };
    if (S.sync.state === 'error') return { cls: 'err', text: 'Sync problem' };
    if (p) return { cls: 'wait', text: p + ' waiting' };
    return { cls: 'ok', text: 'Saved' };
  }
  function syncPillHtml() {
    const i = syncInfo();
    return '<button class="sync ' + i.cls + '" data-act="sync-info" aria-label="Sync status: ' + esc(i.text) + '"><span class="dot"></span><span>' + esc(i.text) + '</span></button>';
  }
  function updateSyncPill() {
    $$('.sync').forEach((b) => { b.outerHTML = syncPillHtml(); });
  }

  /* ═════════════════════ Routing & rendering ═════════════════════ */
  let currentView = '';
  const app = () => $('#app');

  function route() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    const ready = S.me && S.me.name && (CFG.demo || (S.me.key && apiUrl()));
    if (!ready) { renderWelcome(); return; }
    if (h.indexOf('survey-') === 0) {
      const id = h.slice(7);
      if (S.surveys.has(id)) { renderEditor(id); return; }
      location.replace('#');
      return;
    }
    if (h === 'rules') { renderRules(); return; }
    if (h === 'me') { renderMe(); return; }
    renderList();
  }
  const go = (hash) => { if (location.hash.replace('#', '') === hash) route(); else location.hash = hash; };

  function appbar(opts) {
    const left = opts.back
      ? '<button class="iconbtn" data-act="back" aria-label="Back to surveys">' + ICON.back + '</button>'
      : '<img class="logo" src="' + esc(ASSET.shelterLogo) + '" alt="Shelter team logo">';
    return '<header class="appbar' + (opts.wide ? ' wide' : '') + '"><div class="appbar-inner">' + left +
      '<div class="titles"><span class="eyebrow" id="eyebrow">' + esc(opts.eyebrow || '') + '</span><h1 dir="auto" id="title">' + esc(opts.title) + '</h1></div>' +
      (opts.sync === false ? '' : syncPillHtml()) + (opts.actions || '') + '</div></header>';
  }

  /* ── Welcome / first-run ───────────────────────── */
  function installHelp(compact) {
    if (isStandalone() || CFG.demo) return '';
    let body;
    if (isIOS()) {
      body = '<b>Install on iPhone</b><ol><li>Open this page in <b>Safari</b>.</li><li>Tap the <span class="kbd">Share</span> button (square with an arrow).</li><li>Choose <span class="kbd">Add to Home Screen</span>, then <span class="kbd">Add</span>.</li><li>Open <b>Shelter</b> from your home screen and set it up there. Surveys saved in Safari stay in Safari.</li></ol>';
    } else if (S.installPrompt) {
      body = '<b>Install the app</b><div>It opens without internet and keeps your surveys safe on this phone.</div><div class="btn-row"><button class="btn" data-act="install">Install app</button></div>';
    } else if (isAndroid()) {
      body = '<b>Install on Android</b><ol><li>Open the browser menu (<span class="kbd">⋮</span> or <span class="kbd">☰</span>). This works in Chrome, Samsung Internet and Edge.</li><li>Tap <span class="kbd">Install app</span> or <span class="kbd">Add to Home screen</span>.</li><li>Open <b>Shelter</b> from your home screen. It opens as its own app, also without internet.</li></ol>';
    } else {
      body = '<b>Install on this computer</b><div>In Chrome or Edge, click the install icon at the right end of the address bar.</div>';
    }
    if (compact) body += '<div class="btn-row"><button class="btn quiet sm" data-act="hide-install">Hide</button></div>';
    return '<div class="notice info install">' + body + '</div>';
  }

  function renderWelcome() {
    currentView = 'welcome';
    const inv = S.invite || {};
    const me = S.me || {};
    const needApi = !CFG.apiUrl && !inv.api;
    app().innerHTML =
      '<main class="page"><div class="welcome">' +
      '<div class="logos"><img src="' + esc(ASSET.shelterLogo) + '" alt="Shelter team"><img src="' + esc(ASSET.lebaladnaLogo) + '" alt="Lebaladna"></div>' +
      '<div><span class="eyebrow muted small">Lebaladna · Shelter team</span><h1>Shelter Surveys</h1><p class="muted">Record each house, its rooms and papers. Works without internet and uploads to the team sheet when you are back online.</p></div>' +
      installHelp(false) +
      '<form class="panel" id="welcomeForm" novalidate>' +
      '<div class="fields">' +
      '<label class="field wide"><span>Your name</span><input type="text" id="w-name" autocomplete="name" value="' + esc(me.name || '') + '" required></label>' +
      '<label class="field wide"><span>Team code</span><input type="text" id="w-key" autocapitalize="off" autocomplete="off" value="' + esc(inv.team || me.key || '') + '" required><small>Your team lead gives you this code.</small></label>' +
      '<label class="field wide"' + (needApi ? '' : ' hidden') + '><span>Sheet connection link</span><input type="url" id="w-api" inputmode="url" autocapitalize="off" value="' + esc(inv.api || me.api || '') + '" placeholder="https://script.google.com/macros/s/…/exec"><small>Only needed if your lead did not send you an invite link.</small></label>' +
      '</div>' +
      '<div id="w-msg"></div>' +
      '<div class="btn-row"><button class="btn" type="submit" id="w-go">Start</button></div>' +
      '</form></div></main>';
    $('#welcomeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#w-name').value.trim();
      const key = $('#w-key').value.trim();
      const link = ($('#w-api').value.trim() || CFG.apiUrl || '').trim();
      const msg = $('#w-msg');
      $('#w-name').classList.toggle('bad', !name);
      $('#w-key').classList.toggle('bad', !key);
      if (!name || !key) { msg.innerHTML = '<div class="notice err">Add your name and the team code.</div>'; return; }
      if (!link) { msg.innerHTML = '<div class="notice err">Paste the sheet connection link your lead sent you.</div>'; return; }
      S.me = Object.assign({ deviceId: uid() }, S.me || {}, { name, key, api: link });
      $('#w-go').disabled = true;
      msg.innerHTML = '<div class="notice info">Checking the team code…</div>';
      try {
        const res = await api('ping', {}, 20000);
        await applyConfig(res);
      } catch (err) {
        $('#w-go').disabled = false;
        if (err.code === 'bad_key') { msg.innerHTML = '<div class="notice err">That team code is not accepted. Check it with your team lead.</div>'; return; }
        if (err.code !== 'offline') { msg.innerHTML = '<div class="notice err">' + esc(err.message) + '</div>'; return; }
        toast('No internet now. The app will check the code when you are online.', 4000);
      }
      await DB.setMeta('me', S.me);
      S.invite = null;
      go('');
      scheduleSync(300);
    });
  }

  /* ── Survey list ───────────────────────── */
  /** Search text: ignores Arabic spelling variants (أ/إ/آ→ا, ى→ي, ة→ه), diacritics and Arabic digits. */
  function normText(t) {
    return String(t == null ? '' : t).toLowerCase()
      .replace(/[ً-ْٰـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
      .replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
      .replace(/\s+/g, ' ').trim();
  }
  function matchesSearch(s, words) {
    if (!words.length) return true;
    const hay = normText([s.family, s.area, s.code, s.researcher, s.reviewer, s.mobile, s.nationalId, s.project].join(' '));
    return words.every((w) => hay.indexOf(w) >= 0);
  }

  function filteredSurveys() {
    const f = S.list.filter;
    const words = normText(S.list.q).split(' ').filter(Boolean);
    return Array.from(S.surveys.values())
      .filter((s) => !s.isNew)
      .filter((s) => {
        if (f === 'active') return s.status !== 'Cancelled' && s.status !== 'Roofed';
        if (f === 'mine') return (s.researcher || '').trim().toLowerCase() === (S.me.name || '').trim().toLowerCase();
        if (f === 'all') return true;
        return s.status === f;
      })
      .filter((s) => matchesSearch(s, words))
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  function renderList() {
    currentView = 'list';
    S.cur = null;
    S.surveys.forEach((s, id) => { if (s.isNew) S.surveys.delete(id); });
    const all = Array.from(S.surveys.values());
    const count = (fn) => all.filter(fn).length;
    const chips = [
      ['active', 'Active', count((s) => s.status !== 'Cancelled' && s.status !== 'Roofed')],
      ['mine', 'Mine', count((s) => (s.researcher || '').trim().toLowerCase() === (S.me.name || '').trim().toLowerCase())],
      ['all', 'All', all.length]
    ].concat(STATUSES.map((st) => [st, st, count((s) => s.status === st)]))
      .filter((c) => c[0] !== 'Cancelled' || c[2] > 0); // cancelling = deleting now; show only if old ones exist
    const items = filteredSurveys();
    const sel = S.list.selecting;
    const hideInstall = lsGet('shelter-hide-install') === '1';
    const rulesNote = S.config.rules && S.config.rules.example
      ? '<div class="notice warn"><div><b>Wood rules are still the examples.</b> Set your team\'s rounding in the Google Sheet, tab “Wood rules”.</div><div class="btn-row"><button class="btn ghost sm" data-act="go-rules">See wood rules</button></div></div>' : '';

    app().innerHTML = appbar({
      eyebrow: 'Lebaladna · Shelter', title: 'Surveys', wide: true,
      actions: '<button class="iconbtn" data-act="go-rules" aria-label="Wood rules">' + ICON.wood + '</button><button class="iconbtn" data-act="go-me" aria-label="Settings">' + ICON.gear + '</button>'
    }) +
      '<main class="page wide' + (sel ? ' selecting' : '') + '"><div class="page-inner">' +
      (CFG.demo ? '<div class="notice info small"><div><b>Preview.</b> Try it with the example house or a new survey. Here surveys stay on this device only; the installed app uploads them to your Google Sheet.</div></div>' : '') +
      (hideInstall ? '' : installHelp(true)) +
      (DB.memoryOnly ? '<div class="notice err"><b>This browser cannot keep surveys offline.</b> Install the app or use Chrome / Safari normally (not a private window).</div>' : '') +
      rulesNote +
      '<div class="search-row"><input type="search" id="q" dir="auto" placeholder="Search name, area, code, phone or ID" value="' + esc(S.list.q) + '" aria-label="Search surveys">' +
      '<button class="btn ghost" data-act="toggle-select">' + (sel ? 'Done' : 'Select') + '</button></div>' +
      '<div class="chips" role="group" aria-label="Filter surveys">' + chips.map((c) =>
        '<button class="chip" data-filter="' + esc(c[0]) + '" aria-pressed="' + (S.list.filter === c[0]) + '">' + esc(c[1]) + ' <span class="count">' + c[2] + '</span></button>').join('') + '</div>' +
      '<div class="list" id="list">' + (items.length ? items.map(cardHtml).join('') : emptyHtml(all.length)) + '</div>' +
      '</div></main>' +
      (sel ? selectionBar() : '<button class="btn fab" data-act="new">' + ICON.plus + 'New survey</button>');

    $('#q').addEventListener('input', (e) => {
      S.list.q = e.target.value;
      const its = filteredSurveys();
      $('#list').innerHTML = its.length ? its.map(cardHtml).join('') : emptyHtml(all.length);
    });
  }

  function emptyHtml(total) {
    if (total) return '<div class="empty"><h2>No matches</h2><p>Try another filter or search.</p></div>';
    return '<div class="empty"><h2>No surveys yet</h2><p>Tap <b>New survey</b> at a house to record the family, rooms and papers.</p><button class="btn" data-act="new">' + ICON.plus + 'New survey</button></div>';
  }

  function cardHtml(s) {
    const w = calcWood(s.rooms, S.config.rules);
    const pendingPapers = (s.papers || []).filter((p) => p.status === 'pending').length;
    const waiting = s.dirty || pendingPapers;
    const n = (s.rooms || []).length;
    const bits = [s.area, s.code || 'not uploaded yet', n + (n === 1 ? ' room' : ' rooms') + ', ' + w.roofed + ' to roof'].filter(Boolean);
    const woodLine = [w.beams && Object.keys(w.beams).length ? 'Beams ' + woodText(w.beams) : '', w.planks && Object.keys(w.planks).length ? 'Planks ' + woodText(w.planks) : ''].filter(Boolean).join(' · ');
    const picked = S.list.picked.has(s.id);
    return '<div class="card" role="button" tabindex="0" data-open="' + esc(s.id) + '">' +
      '<input type="checkbox" class="pick" data-pick="' + esc(s.id) + '"' + (picked ? ' checked' : '') + ' aria-label="Select this survey">' +
      '<div class="main"><div class="fam" dir="auto">' + esc(s.family || 'No name yet') + '</div>' +
      '<div class="sub">' + bits.map((x) => '<bdi>' + esc(x) + '</bdi>').join(' · ') + '</div>' +
      (woodLine ? '<div class="wood">' + esc(woodLine) + '</div>' : '') + '</div>' +
      '<div class="side"><span class="status st-' + esc(s.status || 'Draft') + '">' + esc(s.status || 'Draft') + '</span>' +
      (waiting ? '<span class="cloud">Not uploaded</span>' : '') + '</div></div>';
  }

  function selectionBar() {
    const picked = Array.from(S.list.picked).map((id) => S.surveys.get(id)).filter(Boolean);
    const t = sumWood(picked);
    return '<div class="bottombar wide"><div class="bottombar-inner">' +
      '<div class="grow totals"><div><b>' + picked.length + '</b> selected</div>' +
      (picked.length ? '<div>Beams <b>' + esc(woodText(t.beams) || '–') + '</b></div><div>Planks <b>' + esc(woodText(t.planks) || '–') + '</b></div>' : '<div class="muted">Tick houses to add up their wood</div>') +
      '</div><div class="btn-row">' +
      '<button class="btn ghost sm" data-act="pick-all">Select shown</button>' +
      '<button class="btn sm" data-act="export-picked" data-kind="pdf"' + (picked.length ? '' : ' disabled') + '>PDF</button>' +
      '<button class="btn sm" data-act="export-picked" data-kind="pptx"' + (picked.length ? '' : ' disabled') + '>PowerPoint</button>' +
      '</div></div></div>';
  }

  function newSurvey() {
    const s = {
      id: uid(), code: '', status: 'Draft', project: S.config.project || '', area: '', researcher: S.me.name || '', reviewer: '',
      date: today(), family: '', age: '', members: '', grade: '', nationalId: '', job: '', income: '', mobile: '', notes: '',
      rooms: [], layout: { rooms: {} }, papers: [], createdAt: nowIso(), updatedAt: nowIso(), base: '', dirty: false,
      deviceId: S.me.deviceId, isNew: true
    };
    S.surveys.set(s.id, s);
    S.stepOf[s.id] = 0;
    go('survey-' + s.id);
  }

  /* ── Survey editor ───────────────────────── */
  function renderEditor(id) {
    currentView = 'editor';
    const s = S.surveys.get(id);
    if (!S.cur || S.cur.id !== id) S.cur = { id, step: S.stepOf[id] || 0, sel: null };
    ensureLayout(s);
    const step = S.cur.step;
    const steps = STEPS.map((st, i) =>
      '<button class="step' + (i < step ? ' done' : '') + '" data-step="' + i + '"' + (i === step ? ' aria-current="step"' : '') + ' aria-label="Step ' + (i + 1) + ': ' + esc(st.label) + '"><span class="n">' + (i + 1) + '</span><span class="lbl">' + esc(st.label) + '</span></button>').join('');
    let body = '';
    if (step === 0) body = familyStep(s);
    else if (step === 1) body = roomsStep(s);
    else if (step === 2) body = planStep(s);
    else if (step === 3) body = papersStep(s);
    else body = woodStep(s);
    const next = STEPS[step + 1];
    app().innerHTML = appbar({ back: true, eyebrow: s.code || 'Not uploaded yet', title: s.family || 'New survey' }) +
      '<main class="page"><div class="page-inner">' +
      '<nav class="steps" aria-label="Survey steps">' + steps + '</nav>' + body +
      '</div></main>' +
      '<div class="bottombar"><div class="bottombar-inner">' +
      (step > 0 ? '<button class="btn ghost" data-step="' + (step - 1) + '">Back</button>' : '<button class="btn ghost" data-act="back">Surveys</button>') +
      '<span class="grow"></span>' +
      (next ? '<button class="btn" data-step="' + (step + 1) + '">Next: ' + esc(next.label) + '</button>' : '<button class="btn leaf" data-act="back">Done</button>') +
      '</div></div>';
    if (step === 2) setupPlan();
    if (step === 3) renderPapersList();
    window.scrollTo(0, 0);
  }

  function field(key, label, s, opt) {
    opt = opt || {};
    const v = s[key] == null ? '' : s[key];
    const attrs = (opt.attrs || '') + (opt.dir ? ' dir="auto"' : '');
    const inner = opt.textarea
      ? '<textarea id="f-' + key + '" data-f="' + key + '"' + attrs + '>' + esc(v) + '</textarea>'
      : opt.options
        ? '<select id="f-' + key + '" data-f="' + key + '">' + opt.options.map((o) => '<option value="' + esc(o) + '"' + (String(o) === String(v) ? ' selected' : '') + '>' + esc(o || '—') + '</option>').join('') + '</select>'
        : '<input id="f-' + key + '" data-f="' + key + '" type="' + (opt.type || 'text') + '" value="' + esc(v) + '"' + attrs + '>';
    return '<label class="field' + (opt.wide ? ' wide' : '') + '"><span>' + esc(label) + '</span>' + inner + (opt.help ? '<small>' + esc(opt.help) + '</small>' : '') + '</label>';
  }

  function familyStep(s) {
    return '<section class="panel"><div class="panel-head"><h2>Family</h2></div><div class="fields">' +
      field('family', 'Head of family', s, { dir: true, wide: true, attrs: ' autocomplete="off"' }) +
      field('area', 'Area / village', s, { dir: true }) +
      field('mobile', 'Mobile', s, { type: 'tel', attrs: ' inputmode="tel" autocomplete="off"' }) +
      field('age', 'Age', s, { attrs: ' inputmode="numeric"' }) +
      field('members', 'Family members', s, { attrs: ' inputmode="numeric"' }) +
      field('grade', 'Case grade', s, { options: [''].concat(GRADES) }) +
      field('nationalId', 'National ID no.', s, { attrs: ' inputmode="numeric" autocomplete="off"' }) +
      field('job', 'Job', s, { dir: true }) +
      field('income', 'Monthly income', s, { dir: true }) +
      '</div></section>' +
      '<section class="panel"><div class="panel-head"><h2>Visit</h2></div><div class="fields">' +
      field('project', 'Project / team', s, { dir: true, help: 'Printed at the top of the PDF, e.g. Roofing Wadi El Natron Team' }) +
      field('researcher', 'Researcher', s, { dir: true }) +
      field('reviewer', 'Reviewer', s, { dir: true }) +
      field('date', 'Survey date', s, { type: 'date' }) +
      field('status', 'Status', s, { options: STATUSES }) +
      field('notes', 'Notes', s, { textarea: true, wide: true, dir: true }) +
      '</div></section>';
  }

  /* rooms */
  function nextColor(s) {
    const used = new Set((s.rooms || []).map((r) => r.color));
    for (let i = 0; i < ROOM_COLORS.length; i++) if (!used.has(i)) return i;
    return (s.rooms || []).length % ROOM_COLORS.length;
  }
  const measured = (r) => r.beamSide > 0 && r.plankSide > 0;

  function roomsStep(s) {
    return '<section class="panel"><div class="panel-head"><h2>Rooms</h2><span class="small muted">Sizes in metres · 345 is read as 3.45 m</span></div>' +
      '<div class="notice info small"><div><b>Beam side</b> = the side the beams (عروق) lie along. <b>Plank side</b> = the side the planks (ألواح) lie along. Wood length = side + ' + normRules(S.config.rules).allowance + ' cm, rounded up. You can also change the beam direction on the plan. Rooms that will not get a roof can stay without sizes.</div></div>' +
      '<div class="rooms" id="rooms">' + (s.rooms.length ? s.rooms.map((r, i) => roomHtml(s, r, i)).join('') : '<p class="muted">No rooms yet. Add the first one below.</p>') + '</div>' +
      '<div><div class="small muted" style="margin-bottom:6px">Add a room</div><div class="quick">' +
      ROOM_NAMES.map((n) => '<button class="chip" data-addroom="' + esc(n) + '">' + esc(n) + '</button>').join('') +
      '<button class="chip" data-addroom="">Other…</button></div></div></section>';
  }

  function roomWoodHtml(s, i) {
    const r = s.rooms[i];
    if (!r.roof) return '<div class="room-wood"><span class="lab">No new roof for this room</span></div>';
    const w = calcWood(s.rooms, S.config.rules).rooms[i] || {};
    if (w.missing) return '<div class="room-wood warn">Add both sides to work out the wood.</div>';
    const parts = [];
    parts.push('<span><span class="lab">Beams</span>' + (w.beamLen ? w.beamLen + ' × ' + w.beamQty : '<span class="warn">too long even for 2 beams</span>') + '</span>');
    parts.push('<span><span class="lab">Planks</span>' + (w.plankLen ? w.plankLen + ' × ' + w.plankQty : '<span class="warn">too long even for 2 planks</span>') + '</span>');
    parts.push('<span><span class="lab">Area</span>' + fmtM(r.beamSide * r.plankSide) + ' m²</span>');
    return '<div class="room-wood">' + parts.join('') + '</div>' +
      (w.notes && w.notes.length ? '<div class="room-note">' + w.notes.map((n) => esc(n.charAt(0).toUpperCase() + n.slice(1))).join('<br>') + '</div>' : '');
  }

  function roomHtml(s, r, i) {
    const c = ROOM_COLORS[(r.color || 0) % ROOM_COLORS.length];
    return '<div class="room' + (r.roof ? '' : ' off') + '" data-rid="' + esc(r.id) + '">' +
      '<div class="room-head"><span class="swatch" style="--sw:' + c.fill + ';--sw-ink:' + c.ink + '">' + (i + 1) + '</span>' +
      '<input type="text" dir="auto" id="rn-' + esc(r.id) + '" data-rf="name" value="' + esc(r.name) + '" placeholder="Room name" aria-label="Room name">' +
      '<button class="btn danger sm" data-act="remove-room">Remove</button></div>' +
      '<div class="room-meta"><label class="toggle"><input type="checkbox" data-rf="roof" id="rr-' + esc(r.id) + '"' + (r.roof ? ' checked' : '') + '>Roof this room</label>' +
      '<select data-rf="grade" id="rg-' + esc(r.id) + '" aria-label="Room grade">' + [''].concat(GRADES).map((g) => '<option value="' + g + '"' + (g === (r.grade || '') ? ' selected' : '') + '>' + (g ? 'Grade ' + g : 'Grade –') + '</option>').join('') + '</select></div>' +
      '<div class="dims">' +
      '<label class="field"><span>Beam side (m)</span><input type="text" inputmode="decimal" data-rf="beamSide" id="rb-' + esc(r.id) + '" value="' + esc(fmtM(r.beamSide)) + '" placeholder="e.g. 3.45" autocomplete="off"></label>' +
      '<label class="field"><span>Plank side (m)</span><input type="text" inputmode="decimal" data-rf="plankSide" id="rp-' + esc(r.id) + '" value="' + esc(fmtM(r.plankSide)) + '" placeholder="e.g. 4" autocomplete="off"></label>' +
      '</div><div data-wood>' + roomWoodHtml(s, i) + '</div></div>';
  }

  function addRoom(s, name) {
    const count = s.rooms.filter((r) => (r.name || '').replace(/\s+\d+$/, '') === name).length;
    const r = { id: uid(), name: name ? (count ? name + ' ' + (count + 1) : name) : '', grade: '', roof: name !== 'Courtyard', beamSide: null, plankSide: null, color: nextColor(s) };
    s.rooms.push(r);
    touch(s);
    const list = $('#rooms');
    if (list) {
      if (s.rooms.length === 1) list.innerHTML = '';
      list.insertAdjacentHTML('beforeend', roomHtml(s, r, s.rooms.length - 1));
      const target = name ? $('#rb-' + r.id) : $('#rn-' + r.id);
      if (target) { target.focus(); target.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
  }

  function refreshRoomWood(s) {
    $$('#rooms .room').forEach((el) => {
      const i = s.rooms.findIndex((r) => r.id === el.dataset.rid);
      if (i < 0) return;
      const holder = $('[data-wood]', el);
      if (holder) holder.innerHTML = roomWoodHtml(s, i);
      el.classList.toggle('off', !s.rooms[i].roof);
      const sw = $('.swatch', el);
      if (sw) sw.textContent = String(i + 1);
    });
  }

  /* ── Plan (drag & snap) ───────────────────────── */
  function roomWH(r, pl) {
    const a = r.plankSide, b = r.beamSide; // default: planks run left–right, beams top–bottom
    return pl && pl.rot ? { w: b, h: a } : { w: a, h: b };
  }
  function planItems(s) {
    const out = [];
    s.rooms.forEach((r, i) => {
      if (!measured(r)) return;
      const pl = s.layout.rooms[r.id];
      if (!pl) return;
      const d = roomWH(r, pl);
      out.push({ r, i, pl, x: pl.x, y: pl.y, w: d.w, h: d.h });
    });
    return out;
  }
  function bounds(items) {
    const b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    items.forEach((it) => { b.x1 = Math.min(b.x1, it.x); b.y1 = Math.min(b.y1, it.y); b.x2 = Math.max(b.x2, it.x + it.w); b.y2 = Math.max(b.y2, it.y + it.h); });
    return b;
  }
  const hits = (a, b) => a.x < b.x + b.w - 0.02 && b.x < a.x + a.w - 0.02 && a.y < b.y + b.h - 0.02 && b.y < a.y + a.h - 0.02;

  function ensureLayout(s) {
    s.layout = s.layout && s.layout.rooms ? s.layout : { rooms: {} };
    let changed = false;
    s.rooms.forEach((r) => {
      if (measured(r) && !s.layout.rooms[r.id]) { autoPlace(s, r); changed = true; }
    });
    return changed;
  }
  function autoPlace(s, r) {
    const items = planItems(s);
    const d = roomWH(r, null);
    if (!items.length) { s.layout.rooms[r.id] = { x: 0, y: 0, rot: 0 }; s.layout.last = r.id; return; }
    const last = items.find((it) => it.r.id === s.layout.last) || items[items.length - 1];
    let cand = { x: r2(last.x + last.w), y: last.y, w: d.w, h: d.h };
    const b = bounds(items);
    if (cand.x + d.w > 14 || items.some((it) => hits(cand, it))) cand = { x: r2(b.x1), y: r2(b.y2), w: d.w, h: d.h };
    s.layout.rooms[r.id] = { x: cand.x, y: cand.y, rot: 0 };
    s.layout.last = r.id;
  }
  function tidyLayout(s) {
    const items = planItems(s);
    const area = items.reduce((a, it) => a + it.w * it.h, 0);
    const limit = Math.max(6, Math.sqrt(area) * 1.5);
    let x = 0, y = 0, rowH = 0;
    items.forEach((it) => {
      if (x > 0 && x + it.w > limit + 0.01) { x = 0; y = r2(y + rowH); rowH = 0; }
      it.pl.x = r2(x); it.pl.y = r2(y);
      x += it.w; rowH = Math.max(rowH, it.h);
    });
  }

  let planView = null; // viewBox in metres, frozen while dragging
  let drag = null;

  function computeView(items) {
    if (!items.length) return { x: -0.5, y: -0.5, w: 8, h: 6 };
    const b = bounds(items);
    const m = 0.8;
    let w = Math.max(6, b.x2 - b.x1 + 2 * m), h = Math.max(4.5, b.y2 - b.y1 + 2 * m);
    if (h > w * 1.5) w = h / 1.5;
    const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  function planStep(s) {
    const unplaced = s.rooms.filter((r) => !measured(r));
    return '<section class="panel"><div class="panel-head"><h2>House plan</h2><span class="small muted">Drag rooms into place · they snap to each other · each square is 1 m</span></div>' +
      '<div class="plan-tools"><span class="sel-name" id="selName" dir="auto">Tap a room to select it</span>' +
      '<button class="btn ghost sm" data-act="rotate" id="rotBtn" disabled>' + ICON.rotate + 'Turn</button>' +
      '<button class="btn ghost sm" data-act="swap-beams" id="swapBtn" disabled>' + ICON.wood + 'Change beam direction</button>' +
      '<button class="btn ghost sm" data-act="tidy">Line up rooms</button>' +
      '<button class="btn ghost sm" data-act="export" data-kind="png">' + ICON.download + 'Save drawing</button></div>' +
      '<div class="plan-wrap"><svg id="plan" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="House plan"></svg></div>' +
      '<div class="legend"><span><i style="background:#F4A817"></i>Gets a new roof</span><span><i style="background:transparent;border-color:var(--muted)"></i>No new roof</span><span><i class="beam-key"></i>Lines = beams (عروق) and their direction</span></div>' +
      '<div id="planWarn"></div>' +
      (unplaced.length ? '<div class="notice info small"><div><b>Not on the plan (no sizes):</b> <span dir="auto">' + unplaced.map((r) => esc(r.name || 'Unnamed room')).join(', ') + '</span>. Add sizes in Rooms to draw them.</div></div>' : '') +
      '</section>';
  }

  function setupPlan() {
    planView = null;
    renderPlan();
    const svg = $('#plan');
    svg.addEventListener('pointerdown', onPlanDown);
    svg.addEventListener('pointermove', onPlanMove);
    svg.addEventListener('pointerup', onPlanUp);
    svg.addEventListener('pointercancel', onPlanUp);
    svg.addEventListener('keydown', onPlanKey);
    // iPhone: stop the page from scrolling while a room is being dragged
    svg.addEventListener('touchstart', (e) => { if (e.target.closest && e.target.closest('.room-g')) e.preventDefault(); }, { passive: false });
  }

  function renderPlan() {
    const s = curSurvey();
    const svg = $('#plan');
    if (!s || !svg) return;
    const items = planItems(s);
    if (!drag) planView = computeView(items);
    const v = planView;
    const width = svg.clientWidth || svg.parentNode.clientWidth || 340;
    const hPx = clamp(width * v.h / v.w, 240, Math.max(260, window.innerHeight * 0.62));
    svg.style.height = hPx + 'px';
    svg.setAttribute('viewBox', [v.x * PX, v.y * PX, v.w * PX, v.h * PX].map((n) => Math.round(n)).join(' '));
    const ppu = Math.min(width / (v.w * PX), hPx / (v.h * PX)); // screen px per plan unit
    const fs = 13 / ppu;
    const rules = normRules(S.config.rules);
    const wood = calcWood(s.rooms, rules);
    const over = new Set();
    items.forEach((a, i) => items.forEach((b, j) => { if (i < j && hits(a, b)) { over.add(a.r.id); over.add(b.r.id); } }));

    let out = '<defs><pattern id="gridp" width="100" height="100" patternUnits="userSpaceOnUse">' +
      '<path d="M50 0V100M0 50H100" class="grid-minor" vector-effect="non-scaling-stroke" fill="none"/>' +
      '<path d="M100 0H0V100" class="grid-major" vector-effect="non-scaling-stroke" fill="none"/></pattern></defs>' +
      '<rect x="' + (v.x * PX - 400) + '" y="' + (v.y * PX - 400) + '" width="' + (v.w * PX + 800) + '" height="' + (v.h * PX + 800) + '" fill="url(#gridp)"/>';

    items.forEach((it) => {
      const r = it.r;
      const col = ROOM_COLORS[(r.color || 0) % ROOM_COLORS.length];
      const W = it.w * PX, H = it.h * PX;
      const fill = r.roof ? col.fill : 'var(--surface)';
      const ink = r.roof ? col.ink : 'var(--muted)';
      const sel = S.cur.sel === r.id;
      let g = '<g class="room-g' + (r.roof ? '' : ' noroof') + (sel ? ' sel' : '') + (over.has(r.id) ? ' overlap' : '') + '" data-rid="' + esc(r.id) + '" transform="translate(' + (it.x * PX) + ' ' + (it.y * PX) + ')" tabindex="0" role="button" aria-label="' + esc((r.name || 'Room') + ', ' + fmtM(it.w) + ' by ' + fmtM(it.h) + ' metres') + '">' +
        '<rect class="rf" width="' + W + '" height="' + H + '" style="fill:' + fill + '"/>';
      // beams: lie along the beam side, repeated along the plank side
      const wr = wood.rooms[it.i];
      if (r.roof) {
        const beamsVertical = !it.pl.rot; // rot 0: beam side is the height
        roomMarks(wr).forEach((mk) => {
          const across = mk.kind === 'support' ? !beamsVertical : beamsVertical;
          const cls = mk.kind === 'beam' ? 'beam' : mk.kind === 'joint' ? 'beam joint' : 'support';
          const style = mk.kind === 'support' ? '' : ' style="stroke:' + ink + '"';
          g += across
            ? '<line class="' + cls + '" y1="0" y2="' + H + '" x1="' + (W * mk.t) + '" x2="' + (W * mk.t) + '"' + style + ' vector-effect="non-scaling-stroke"/>'
            : '<line class="' + cls + '" x1="0" x2="' + W + '" y1="' + (H * mk.t) + '" y2="' + (H * mk.t) + '"' + style + ' vector-effect="non-scaling-stroke"/>';
        });
      }
      g += '<rect class="rw" width="' + W + '" height="' + H + '" vector-effect="non-scaling-stroke" stroke-width="' + (sel ? 3.5 : 2) + '"/>';
      // dimensions inside the top and left walls
      const showDims = W > fs * 7 && H > fs * 5;
      const off = fs * 1.05;
      if (showDims) {
        const ah = fs * 0.42;
        g += dimSvg(fs * 0.5, off, W - fs * 0.5, off, ah, ink) +
          '<text x="' + (W / 2) + '" y="' + (off + fs * 0.34) + '" text-anchor="middle" style="fill:' + ink + ';stroke:' + fill + ';stroke-width:' + (fs * 0.5) + ';font-size:' + (fs * 0.92) + 'px;font-weight:600">' + esc(lenLabel(it.w)) + '</text>' +
          dimSvg(off, fs * 0.5 + off * 0.9, off, H - fs * 0.5, ah, ink) +
          '<text transform="translate(' + (off + fs * 0.34) + ' ' + (H / 2 + off * 0.45) + ') rotate(-90)" text-anchor="middle" style="fill:' + ink + ';stroke:' + fill + ';stroke-width:' + (fs * 0.5) + ';font-size:' + (fs * 0.92) + 'px;font-weight:600">' + esc(lenLabel(it.h)) + '</text>';
      }
      const name = r.name || 'Room ' + (it.i + 1);
      // keep the name clear of the vertical dimension strip on the left
      const left = showDims ? off * 1.7 : W * 0.08;
      const avail = Math.max(W * 0.3, W - left - fs * 0.4);
      const nfs = Math.min(fs * 1.25, avail / Math.max(3, name.length * 0.58), H * 0.3);
      g += '<text x="' + ((left + W - fs * 0.4) / 2) + '" y="' + (H / 2 + (showDims ? off * 0.45 : 0) + nfs * 0.35) + '" text-anchor="middle" style="fill:' + ink + ';font-size:' + nfs + 'px;font-weight:700">' + esc(name) + '</text>';
      if (!showDims) g += '<text x="' + (W / 2) + '" y="' + (H / 2 + nfs * 1.5) + '" text-anchor="middle" style="fill:' + ink + ';font-size:' + (nfs * 0.8) + 'px">' + esc(fmtM(it.w) + '×' + fmtM(it.h)) + '</text>';
      g += '</g>';
      out += g;
    });

    // scale bar (1 m)
    const sx = (v.x + 0.3) * PX, sy = (v.y + v.h - 0.3) * PX;
    out += '<g class="scale"><line x1="' + sx + '" x2="' + (sx + PX) + '" y1="' + sy + '" y2="' + sy + '" vector-effect="non-scaling-stroke" stroke-width="2"/>' +
      '<line x1="' + sx + '" x2="' + sx + '" y1="' + (sy - fs * 0.4) + '" y2="' + (sy + fs * 0.4) + '" vector-effect="non-scaling-stroke" stroke-width="2"/>' +
      '<line x1="' + (sx + PX) + '" x2="' + (sx + PX) + '" y1="' + (sy - fs * 0.4) + '" y2="' + (sy + fs * 0.4) + '" vector-effect="non-scaling-stroke" stroke-width="2"/>' +
      '<text x="' + (sx + PX / 2) + '" y="' + (sy - fs * 0.6) + '" text-anchor="middle" style="font-size:' + fs + 'px">1 m</text></g>';
    if (!items.length) {
      out += '<text x="' + ((v.x + v.w / 2) * PX) + '" y="' + ((v.y + v.h / 2) * PX) + '" text-anchor="middle" style="fill:var(--muted);font-size:' + (fs * 1.1) + 'px">Add room sizes in step 2 and they appear here</text>';
    }
    svg.innerHTML = out;

    const warn = $('#planWarn');
    if (warn) warn.innerHTML = over.size ? '<div class="notice warn small"><div><b>Rooms overlap.</b> Drag the red-dashed rooms apart.</div></div>' : '';
    updateSelTools();
  }

  function dimSvg(x1, y1, x2, y2, ah, ink) {
    const horiz = Math.abs(y2 - y1) < 1e-6;
    const head = (x, y, dir) => {
      if (horiz) return '<path d="M' + x + ' ' + y + 'l' + (dir * ah) + ' ' + (-ah * 0.55) + 'v' + (ah * 1.1) + 'z" style="fill:' + ink + '"/>';
      return '<path d="M' + x + ' ' + y + 'l' + (-ah * 0.55) + ' ' + (dir * ah) + 'h' + (ah * 1.1) + 'z" style="fill:' + ink + '"/>';
    };
    return '<line class="dimline" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" style="stroke:' + ink + '" vector-effect="non-scaling-stroke"/>' +
      head(x1, y1, 1) + head(x2, y2, -1);
  }

  function updateSelTools() {
    const s = curSurvey();
    const r = s && S.cur.sel ? s.rooms.find((x) => x.id === S.cur.sel) : null;
    const n = $('#selName'), b = $('#rotBtn'), sw = $('#swapBtn');
    const pl = r && s.layout.rooms[r.id];
    if (n) n.textContent = r ? (r.name || 'Room') + ' · beams ' + (pl && pl.rot ? '↔' : '↕') + ' ' + lenLabel(r.beamSide) + ' · planks ' + lenLabel(r.plankSide) : 'Tap a room to select it';
    if (b) b.disabled = !r;
    if (sw) sw.disabled = !r;
  }

  function svgPoint(e) {
    const svg = $('#plan');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x / PX, y: q.y / PX };
  }
  function pxPerMetre() {
    const svg = $('#plan');
    const ctm = svg && svg.getScreenCTM();
    return ctm ? ctm.a * PX : 40;
  }

  function onPlanDown(e) {
    const g = e.target.closest('.room-g');
    if (!g) { S.cur.sel = null; $$('#plan .room-g.sel').forEach((x) => x.classList.remove('sel')); updateSelTools(); return; }
    const s = curSurvey();
    const rid = g.dataset.rid;
    S.cur.sel = rid;
    $$('#plan .room-g').forEach((x) => x.classList.toggle('sel', x === g));
    updateSelTools();
    const pl = s.layout.rooms[rid];
    const p = svgPoint(e);
    drag = { rid, sx: p.x, sy: p.y, ox: pl.x, oy: pl.y, moved: false, g, ppm: pxPerMetre() };
    try { g.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  }
  function onPlanMove(e) {
    if (!drag) return;
    const s = curSurvey();
    const p = svgPoint(e);
    const dx = p.x - drag.sx, dy = p.y - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) * drag.ppm < 5) return;
    drag.moved = true;
    const pos = snapPos(s, drag.rid, drag.ox + dx, drag.oy + dy, 12 / drag.ppm);
    const pl = s.layout.rooms[drag.rid];
    pl.x = pos.x; pl.y = pos.y;
    drag.g.setAttribute('transform', 'translate(' + (pl.x * PX) + ' ' + (pl.y * PX) + ')');
    const items = planItems(s);
    const me = items.find((it) => it.r.id === drag.rid);
    const over = new Set();
    items.forEach((a, i) => items.forEach((b, j) => { if (i < j && hits(a, b)) { over.add(a.r.id); over.add(b.r.id); } }));
    $$('#plan .room-g').forEach((x) => x.classList.toggle('overlap', over.has(x.dataset.rid)));
    if (me) e.preventDefault();
  }
  function onPlanUp() {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (moved) { const s = curSurvey(); s.layout.last = S.cur.sel; touch(s); }
    renderPlan();
  }
  function onPlanKey(e) {
    const g = e.target.closest && e.target.closest('.room-g');
    if (!g) return;
    const s = curSurvey();
    const pl = s.layout.rooms[g.dataset.rid];
    const step = e.shiftKey ? 0.5 : 0.05;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    S.cur.sel = g.dataset.rid;
    if (moves[e.key]) { pl.x = r2(pl.x + moves[e.key][0]); pl.y = r2(pl.y + moves[e.key][1]); }
    else if (e.key === 'r' || e.key === 'R') pl.rot = pl.rot ? 0 : 1;
    else return;
    e.preventDefault();
    touch(s);
    renderPlan();
    const again = $('#plan .room-g[data-rid="' + g.dataset.rid + '"]');
    if (again) again.focus();
  }
  function snapPos(s, rid, x, y, thr) {
    const items = planItems(s);
    const me = items.find((it) => it.r.id === rid);
    if (!me) return { x, y };
    let bx = null, bdx = thr, by = null, bdy = thr;
    items.forEach((o) => {
      if (o.r.id === rid) return;
      [o.x + o.w, o.x - me.w, o.x, o.x + o.w - me.w].forEach((c) => { const d = Math.abs(x - c); if (d < bdx) { bdx = d; bx = c; } });
      [o.y + o.h, o.y - me.h, o.y, o.y + o.h - me.h].forEach((c) => { const d = Math.abs(y - c); if (d < bdy) { bdy = d; by = c; } });
    });
    return { x: r2(bx != null ? bx : Math.round(x / 0.05) * 0.05), y: r2(by != null ? by : Math.round(y / 0.05) * 0.05) };
  }

  /* ── Papers ───────────────────────── */
  function papersStep() {
    return '<section class="panel"><div class="panel-head"><h2>Papers</h2><span class="small muted">Photos upload when you have internet</span></div>' +
      '<div class="papers" id="papers"></div>' +
      '</section>';
  }
  function paperTypes(s) {
    const names = (S.config.papers || DEFAULT_PAPERS).map((p) => ({ name: p.name, required: !!p.required }));
    (s.papers || []).forEach((p) => { if (!names.some((n) => n.name === p.paper)) names.push({ name: p.paper, required: false }); });
    return names;
  }
  function renderPapersList() {
    const s = curSurvey();
    const box = $('#papers');
    if (!s || !box) return;
    box.innerHTML = paperTypes(s).map((t, ti) => {
      const files = (s.papers || []).filter((p) => p.paper === t.name);
      const tag = files.length ? '<span class="tag ok">' + files.length + ' added</span>' : (t.required ? '<span class="tag req">Required</span>' : '<span class="tag">Optional</span>');
      return '<div class="paper"><div class="paper-head"><b dir="auto">' + esc(t.name) + '</b>' + tag + '</div>' +
        (files.length ? '<div class="thumbs">' + files.map((p) => {
          const st = p.status === 'uploaded' ? 'Uploaded' : p.status === 'missing' ? 'Lost – add again' : 'Waiting to upload';
          const isPdf = /pdf/.test(p.mime || '') || /\.pdf$/i.test(p.name || '');
          const img = p.thumb ? '<img src="' + esc(p.thumb) + '" alt="">' : '<span>' + (isPdf ? 'PDF<br>' : '') + 'Tap to open</span>';
          return '<div class="thumb"><button class="open" data-viewpaper="' + esc(p.id) + '" aria-label="Open ' + esc(t.name) + '">' + img + '</button><span class="st">' + st + '</span>' +
            (p.status !== 'uploaded' ? '<button class="x" data-delpaper="' + esc(p.id) + '" aria-label="Remove this photo">×</button>' : '') + '</div>';
        }).join('') + '</div>' : '') +
        '<div class="btn-row">' +
        '<span class="btn ghost sm filebtn">' + ICON.camera + 'Take photo<input type="file" accept="image/*" capture="environment" data-paper="' + ti + '" aria-label="Take a photo of ' + esc(t.name) + '"></span>' +
        '<span class="btn quiet sm filebtn">' + ICON.file + 'Choose file<input type="file" accept="image/*,application/pdf" multiple data-paper="' + ti + '" aria-label="Choose a file for ' + esc(t.name) + '"></span>' +
        '</div></div>';
    }).join('');
  }

  async function addPaperFiles(s, typeName, files) {
    for (const f of files) {
      if (!/^image\//.test(f.type) && f.type !== 'application/pdf') { toast('Only photos or PDF files.'); continue; }
      if (f.size > 15 * 1024 * 1024) { toast('That file is over 15 MB.'); continue; }
      const blob = await compressImage(f);
      const thumb = /^image\//.test(f.type) ? await makeThumb(blob) : '';
      const id = uid();
      try { await DB.put('files', { id, blob, mime: blob.type || f.type }); }
      catch (e) { toast('Not enough space on this phone to keep the photo.'); continue; }
      s.papers = s.papers || [];
      s.papers.push({ id, paper: typeName, name: f.name || 'photo.jpg', mime: blob.type || f.type, size: blob.size, status: 'pending', thumb, addedAt: nowIso() });
    }
    if (!s.base) touch(s); else { s.isNew = false; saveLocalSoon(s, 0); scheduleSync(1500); updateSyncPill(); }
    renderPapersList();
  }

  function b64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  let viewerUrl = null;
  /** Open a paper: from this phone if it is here, otherwise fetched from the team's Drive via the sheet. */
  async function viewPaper(s, pid) {
    const p = (s.papers || []).find((x) => x.id === pid);
    if (!p) return;
    showSheet('<h2 dir="auto">' + esc(p.paper) + '</h2><p class="muted">Opening…</p>');
    let rec = null;
    try { rec = await DB.get('files', pid); } catch (e) { rec = null; }
    if (!rec || !rec.blob) {
      if (CFG.demo || !apiUrl()) { showSheet('<h2>Not on this device</h2><p class="muted">This paper is only on the phone that took it.</p><div class="btn-row"><button class="btn" data-act="close-sheet">Close</button></div>'); return; }
      try {
        const res = await api('getFile', { fileId: pid }, 90000);
        const blob = b64ToBlob(res.data, res.mime);
        rec = { id: pid, blob, mime: res.mime, cached: true };
        DB.put('files', rec).catch(() => {});
        if (!p.thumb && /^image\//.test(res.mime || '')) {
          p.thumb = await makeThumb(blob);
          saveLocalSoon(s, 0);
          if (S.cur && S.cur.id === s.id && S.cur.step === 3) renderPapersList();
        }
      } catch (e) {
        const msg = e.code === 'offline' ? 'Connect to the internet to open papers photographed on other phones. After that they stay on this device.' : (e.message || String(e));
        showSheet('<h2>Could not open it</h2><div class="notice warn"><div>' + esc(msg) + '</div></div><div class="btn-row"><button class="btn" data-act="close-sheet">Close</button></div>');
        return;
      }
    }
    const mime = rec.mime || rec.blob.type || '';
    const ext = /pdf/.test(mime) ? '.pdf' : '.jpg';
    const name = ((s.code || 'Survey') + ' ' + (s.family || '') + ' – ' + p.paper).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() + ext;
    lastExport = { blob: rec.blob, name, type: mime || 'image/jpeg' };
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    viewerUrl = URL.createObjectURL(rec.blob);
    const canShare = (() => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File([rec.blob], name, { type: lastExport.type })] })); } catch (e) { return false; } })();
    showSheet('<h2 dir="auto">' + esc(p.paper) + '</h2>' +
      (/^image\//.test(mime) ? '<img class="viewer" src="' + viewerUrl + '" alt="' + esc(p.paper) + '">' : '<p class="muted">PDF file · ' + Math.max(1, Math.round(rec.blob.size / 1024)) + ' KB</p>') +
      '<div class="btn-row">' + (canShare ? '<button class="btn" data-act="share-export">' + ICON.share + 'Share</button>' : '') +
      '<button class="btn ' + (canShare ? 'ghost' : '') + '" data-act="save-export">' + ICON.download + 'Download</button>' +
      '<button class="btn quiet" data-act="close-sheet">Close</button></div>');
  }

  async function compressImage(file) {
    if (!/^image\//.test(file.type) || file.type === 'image/gif') return file;
    try {
      const img = await decodeImage(file);
      const max = 1800;
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
      if (img.close) img.close();
      return out && out.size < file.size ? out : file;
    } catch (e) { return file; }
  }
  async function decodeImage(blob) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* fall back */ }
    }
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = (er) => { URL.revokeObjectURL(url); rej(er); };
      im.src = url;
    });
  }
  async function makeThumb(blob) {
    try {
      const img = await decodeImage(blob);
      const k = 168 / Math.max(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.7);
    } catch (e) { return ''; }
  }

  /* ── Wood & export ───────────────────────── */
  function woodTableHtml(s) {
    const w = calcWood(s.rooms, S.config.rules);
    const rows = w.rooms.filter((r) => r.roof);
    if (!rows.length) return '<p class="muted">No rooms are marked “Roof this room” yet.</p>';
    return '<div class="table-wrap"><table class="wood"><thead><tr><th>Room</th><th>Size (m)</th><th>Planks</th><th>Beams</th></tr></thead><tbody>' +
      rows.map((r) => {
        const c = ROOM_COLORS[(r.color || 0) % ROOM_COLORS.length];
        return '<tr><td dir="auto"><span class="sw" style="background:' + c.fill + '"></span>' + esc(r.name) + '</td>' +
          '<td class="n">' + (r.missing ? '<span class="muted">sizes missing</span>' : esc(fmtM(r.beamSide) + ' × ' + fmtM(r.plankSide))) + '</td>' +
          '<td class="n">' + (r.plankLen ? r.plankLen + ' × ' + r.plankQty : '–') + '</td>' +
          '<td class="n">' + (r.beamLen ? r.beamLen + ' × ' + r.beamQty : '–') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function woodStep(s) {
    const w = calcWood(s.rooms, S.config.rules);
    const rules = normRules(S.config.rules);
    const totalBox = (title, map) => '<div class="total"><h3>' + title + '</h3>' +
      (Object.keys(map).length ? Object.keys(map).map(Number).sort((a, b) => a - b).map((k) => '<div class="big">' + k + ' cm × ' + map[k] + '</div>').join('') : '<div class="none">Nothing yet</div>') + '</div>';
    const missingPapers = paperTypes(s).filter((t) => t.required && !(s.papers || []).some((p) => p.paper === t.name));
    return '<section class="panel"><div class="panel-head"><h2>Wood to buy</h2><span class="small muted">Lengths in cm × pieces</span></div>' +
      (rules.example ? '<div class="notice warn small"><div><b>Example wood rules.</b> These numbers use example rounding. Set your team\'s rules in the Google Sheet, tab “Wood rules”.</div></div>' : '') +
      woodTableHtml(s) +
      '<div class="totals">' + totalBox('Total beams', w.beams) + totalBox('Total planks', w.planks) +
      '<div class="total"><h3>Roof area</h3><div class="big">' + fmtM(w.roofArea) + ' m²</div><div class="none">' + w.roofed + ' room' + (w.roofed === 1 ? '' : 's') + ' to roof</div></div></div>' +
      (w.warnings.length ? '<div class="notice err small"><div>' + w.warnings.map(esc).join('<br>') + '</div></div>' : '') +
      (w.notes.length ? '<div class="notice warn small"><div><b>Over 6 m:</b><br>' + w.notes.map(esc).join('<br>') + '</div></div>' : '') +
      '</section>' +
      '<section class="panel"><div class="panel-head"><h2>Export for implementation day</h2></div>' +
      '<p class="muted small" style="margin:0">One page with the plan, room sizes and the wood list, like your printed sheet. Share it to WhatsApp or save it.</p>' +
      '<div class="btn-row"><button class="btn" data-act="export" data-kind="pdf">' + ICON.file + 'PDF</button><button class="btn ghost" data-act="export" data-kind="pptx">' + ICON.file + 'PowerPoint</button><button class="btn ghost" data-act="export" data-kind="png">' + ICON.download + 'Drawing image</button></div></section>' +
      '<section class="panel"><div class="panel-head"><h2>Review &amp; status</h2><span class="status st-' + esc(s.status) + '">' + esc(s.status) + '</span></div>' +
      '<div class="small muted">' + [s.researcher ? 'Surveyed by <bdi>' + esc(s.researcher) + '</bdi>' : '', s.reviewer ? 'Reviewer: <bdi>' + esc(s.reviewer) + '</bdi>' : 'No reviewer yet', s.updatedBy ? 'Last saved by <bdi>' + esc(s.updatedBy) + '</bdi>' : ''].filter(Boolean).join(' · ') + '</div>' +
      (missingPapers.length ? '<div class="notice warn small"><div>Missing required papers: <span dir="auto">' + missingPapers.map((t) => esc(t.name)).join(', ') + '</span></div></div>' : '') +
      '<div class="btn-row">' +
      (s.status === 'Draft' ? '<button class="btn leaf" data-setstatus="Submitted">Mark as submitted</button>' : '') +
      (s.status === 'Submitted' ? '<button class="btn leaf" data-setstatus="Approved">Approve</button><button class="btn ghost" data-setstatus="Draft">Send back to draft</button>' : '') +
      (s.status === 'Approved' ? '<button class="btn leaf" data-setstatus="Roofed">Mark as roofed</button><button class="btn ghost" data-setstatus="Submitted">Undo approval</button>' : '') +
      (s.status === 'Roofed' ? '<button class="btn ghost" data-setstatus="Approved">Back to approved</button>' : '') +
      (s.status === 'Cancelled' ? '<button class="btn ghost" data-setstatus="Draft">Restore survey</button>' : '') +
      '<button class="btn danger" data-act="delete-survey">Delete survey</button>' +
      '</div>' +
      '<p class="small muted" style="margin:0">Delete removes it from the sheet and from every phone. Its photos go to the Google Drive trash, and the sheet keeps a copy in the “Deleted” tab.</p>' +
      '</section>';
  }

  /* ── Wood rules (read from the sheet) ───────────────────────── */
  function renderRules() {
    currentView = 'rules';
    S.cur = null;
    const r = normRules(S.config.rules);
    const table = (title, list) => '<div class="total"><h3>' + title + '</h3>' + (list.length
      ? '<div class="room-wood">' + list.map((x) => '<span>' + x + '</span>').join('') + '</div><div class="none">Lengths in cm you can buy</div>'
      : '<div class="none">No lengths yet</div>') + '</div>';
    app().innerHTML = appbar({ back: true, eyebrow: 'From the Google Sheet', title: 'Wood rules' }) +
      '<main class="page"><div class="page-inner">' +
      '<section class="panel"><div class="panel-head"><h2>How lengths are chosen</h2></div>' +
      '<p style="margin:0">Measured side <b>+ ' + r.allowance + ' cm</b> for the walls, then rounded <b>up</b> to the next length below. Example: 3.45 m + ' + r.allowance + ' cm = ' + fmtM(3.45 + r.allowance / 100) + ' m → <b>' + (pickLen(r.beam, 3.45, r.allowance) || '–') + ' cm</b>.</p>' +
      '<div class="notice info small"><div>To change them, open the team Google Sheet: tab <b>Wood rules</b> (one row per length), tab <b>Settings</b> (“Add for walls”, beam spacing, plank width). Phones get changes on their next sync; in the sheet, <b>Shelter → Recalculate wood</b> updates old surveys.</div></div>' +
      (r.example ? '<div class="notice warn small"><div><b>These are example lengths.</b> Delete the word “Example” from the Note column once they are yours.</div></div>' : '') +
      '<div class="small muted">Last downloaded ' + esc(fmtWhen(S.config.updatedAt)) + '</div></section>' +
      '<section class="panel"><div class="totals">' + table('Beams (عروق)', r.beam) + table('Planks (ألواح)', r.plank) + '</div>' +
      '<div class="totals"><div class="total"><h3>Beam spacing</h3><div class="big">' + fmtM(r.beamSpacing) + ' m</div><div class="none">Beams = plank side ÷ spacing, rounded up' + (r.extraBeams ? ' + ' + r.extraBeams : '') + '</div></div>' +
      '<div class="total"><h3>Plank width</h3><div class="big">' + fmtM(r.plankWidth) + ' m</div><div class="none">Planks = beam side ÷ width, rounded up' + (r.extraPlanks ? ' + ' + r.extraPlanks : '') + '</div></div></div></section>' +
      '<section class="panel"><div class="panel-head"><h2>Try a room</h2></div><div class="dims">' +
      '<label class="field"><span>Beam side (m)</span><input type="text" inputmode="decimal" id="t-b" value="3.45"></label>' +
      '<label class="field"><span>Plank side (m)</span><input type="text" inputmode="decimal" id="t-p" value="4"></label></div><div id="t-out" class="room-wood"></div></section>' +
      '</div></main>';
    const upd = () => {
      const b = parseLen($('#t-b').value), p = parseLen($('#t-p').value);
      const w = calcWood([{ id: 't', name: 'Room', roof: true, beamSide: b, plankSide: p }], S.config.rules).rooms[0];
      $('#t-out').innerHTML = w.missing ? '<span class="lab">Type both sides</span>'
        : '<span><span class="lab">Beams</span>' + (w.beamLen ? w.beamLen + ' × ' + w.beamQty : 'too long for the wood') + '</span><span><span class="lab">Planks</span>' + (w.plankLen ? w.plankLen + ' × ' + w.plankQty : 'too long for the wood') + '</span>';
    };
    $('#t-b').addEventListener('input', upd);
    $('#t-p').addEventListener('input', upd);
    upd();
  }

  /* ── Settings ───────────────────────── */
  function renderMe() {
    currentView = 'me';
    S.cur = null;
    const p = pendingCount();
    app().innerHTML = appbar({ back: true, eyebrow: 'This phone', title: 'Settings' }) +
      '<main class="page"><div class="page-inner">' +
      '<form class="panel" id="meForm" novalidate><div class="panel-head"><h2>You</h2></div><div class="fields">' +
      '<label class="field"><span>Your name</span><input type="text" id="m-name" value="' + esc(S.me.name) + '"></label>' +
      '<label class="field"><span>Team code</span><input type="text" id="m-key" autocapitalize="off" value="' + esc(S.me.key || '') + '"></label>' +
      '<label class="field wide"><span>Sheet connection link</span><input type="url" id="m-api" autocapitalize="off" value="' + esc(S.me.api || CFG.apiUrl || '') + '"></label>' +
      '</div><div class="btn-row"><button class="btn" type="submit">Save</button></div></form>' +
      '<section class="panel"><div class="panel-head"><h2>Sync</h2>' + syncPillHtml() + '</div>' +
      '<div class="small">' + S.surveys.size + ' surveys on this phone · ' + p + ' waiting to upload · last sync ' + esc(fmtWhen(S.lastSyncAt ? new Date(S.lastSyncAt).toISOString() : '')) + '</div>' +
      (S.sync.msg ? '<div class="notice ' + (S.sync.state === 'offline' ? 'warn' : 'err') + ' small"><div>' + esc(S.sync.msg) + '</div></div>' : '') +
      '<div class="btn-row"><button class="btn ghost" data-act="sync-now">Sync now</button></div></section>' +
      '<section class="panel"><div class="panel-head"><h2>Invite researchers</h2></div>' +
      '<p class="small muted" style="margin:0">Send this link to a researcher. It fills in the connection and team code; they only add their name. Share it only inside the team.</p>' +
      '<div class="btn-row"><button class="btn ghost" data-act="copy-invite">Copy invite link</button></div><input type="text" id="inviteText" readonly hidden></section>' +
      (isStandalone() ? '' : '<section class="panel"><div class="panel-head"><h2>Install</h2></div>' + installHelp(false) + '</section>') +
      '<section class="panel"><div class="panel-head"><h2>Reset this phone</h2></div>' +
      '<p class="small muted" style="margin:0">Removes all surveys and photos from this phone. Surveys already in the sheet are safe.' + (p ? ' <b>' + p + ' items are not uploaded yet and would be lost.</b>' : '') + '</p>' +
      '<div class="btn-row"><button class="btn danger" data-act="reset">Reset this phone</button></div>' +
      '<div class="small muted">Shelter Surveys ' + APP_VERSION + '</div></section>' +
      '</div></main>';
    $('#meForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#m-name').value.trim(), key = $('#m-key').value.trim(), api = $('#m-api').value.trim();
      if (!name || !key || !api) { toast('Name, team code and link are all needed.'); return; }
      S.me = Object.assign({}, S.me, { name, key, api });
      await DB.setMeta('me', S.me);
      S.sync = { state: 'idle', msg: '' };
      toast('Saved');
      syncNow();
    });
  }

  /* ═════════════════════ Exports (PDF + PowerPoint) ═════════════════════ */
  const scriptLoads = {};
  function loadScript(src) {
    if (!scriptLoads[src]) {
      scriptLoads[src] = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = resolve;
        el.onerror = () => { delete scriptLoads[src]; reject(new Error('Could not load the export tool. Open the app once with internet so it is saved for offline use.')); };
        document.head.appendChild(el);
      });
    }
    return scriptLoads[src];
  }
  const imgCache = {};
  function loadImage(src) {
    if (!imgCache[src]) {
      imgCache[src] = new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => { delete imgCache[src]; rej(new Error('Logo missing')); };
        im.src = src;
      });
    }
    return imgCache[src];
  }
  async function logos() {
    const out = {};
    try { out.shelter = await loadImage(ASSET.shelterLogo); } catch (e) { /* optional */ }
    try { out.lebaladna = await loadImage(ASSET.lebaladnaLogo); } catch (e) { /* optional */ }
    return out;
  }
  function imgDataUrl(im) {
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0);
    return c.toDataURL('image/png');
  }
  async function readyFonts() {
    try {
      if (document.fonts) {
        await Promise.all([document.fonts.load('700 40px "Barlow Condensed"'), document.fonts.load('600 40px "Barlow Condensed"')]);
        await document.fonts.ready;
      }
    } catch (e) { /* fall back to system fonts */ }
  }

  /* canvas drawing helpers */
  function setFont(ctx, size, weight, display) {
    ctx.font = (weight || 400) + ' ' + Math.round(size) + 'px ' + (display ? DISPLAY_FONT : BODY_FONT);
  }
  function fitText(ctx, text, maxW, size, weight, display, min) {
    let s = size;
    setFont(ctx, s, weight, display);
    while (s > (min || 14) && ctx.measureText(text).width > maxW) { s -= 2; setFont(ctx, s, weight, display); }
    return s;
  }
  function drawArrow(ctx, x1, y1, x2, y2, head) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    [[x2, y2, ang], [x1, y1, ang + Math.PI]].forEach(([x, y, a]) => {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - head * Math.cos(a - 0.45), y - head * Math.sin(a - 0.45));
      ctx.lineTo(x - head * Math.cos(a + 0.45), y - head * Math.sin(a + 0.45));
      ctx.closePath(); ctx.fill();
    });
  }
  function labelOn(ctx, text, x, y, size, bg, fg, rotate) {
    ctx.save();
    ctx.translate(x, y);
    if (rotate) ctx.rotate(-Math.PI / 2);
    setFont(ctx, size, 600);
    const w = ctx.measureText(text).width + size * 0.6;
    ctx.fillStyle = bg;
    ctx.fillRect(-w / 2, -size * 0.62, w, size * 1.24);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, size * 0.04);
    ctx.restore();
  }

  /** For a room on the plan: which way its beams run, and the wood length (cm) for each drawn side. */
  function sideInfo(it, wr) {
    const beamsVertical = !it.pl.rot; // rot 0: width = plank side, height = beam side
    return {
      beamsVertical,
      wLen: wr ? (beamsVertical ? wr.plankLen : wr.beamLen) : null,
      hLen: wr ? (beamsVertical ? wr.beamLen : wr.plankLen) : null,
      wParts: wr ? (beamsVertical ? wr.plankParts : wr.beamParts) : 1,
      hParts: wr ? (beamsVertical ? wr.beamParts : wr.plankParts) : 1
    };
  }
  /**
   * Lines to draw inside a roofed room, as fractions across the room:
   * every beam ('beam'), the middle beam where two planks meet ('joint'), and the support where two beams meet ('support').
   * `t` runs across the beams (perpendicular to them); the support runs across the beams at the middle of their length.
   */
  function roomMarks(wr) {
    const out = [];
    if (!wr || !(wr.beamCount > 0)) return out;
    const n = wr.beamCount;
    for (let q = 0; q < n; q++) out.push({ kind: wr.plankParts === 2 && q === (n - 1) / 2 ? 'joint' : 'beam', t: (q + 0.5) / n });
    if (wr.beamParts === 2) out.push({ kind: 'support', t: 0.5 });
    return out;
  }
  /** Where to put the room name so it does not sit on a joint beam or a support line drawn through the middle. */
  function nameSpot(wr, beamsVertical) {
    const spot = { right: false, lower: false };
    if (!wr) return spot;
    if (wr.plankParts === 2) { if (beamsVertical) spot.right = true; else spot.lower = true; }
    if (wr.beamParts === 2) { if (beamsVertical) spot.lower = true; else spot.right = true; }
    return spot;
  }
  /** "3.45 m → 360" (measured → wood to buy); over 6 m: "7.2 m → 2 × 390"; no wood: "3.45 m". */
  const dimText = (m, len, parts) => (len ? fmtM(m) + ' m → ' + (parts === 2 ? '2 × ' : '') + len : lenLabel(m));
  /** Label for a dimension arrow: keeps the wood length, shrinking the text before ever dropping it. */
  function fitDim(ctx, m, len, maxW, size, parts) {
    const long = dimText(m, len, parts);
    for (const sz of [size, size * 0.82, size * 0.68]) {
      setFont(ctx, sz, 600);
      if (ctx.measureText(long).width + sz * 0.8 <= maxW) return { text: long, size: sz };
    }
    return { text: lenLabel(m), size: size * 0.82 };
  }
  function legendText(s) {
    const w = s ? calcWood(s.rooms, S.config.rules) : null;
    const joint = w && w.rooms.some((r) => r.plankParts === 2);
    const support = w && w.rooms.some((r) => r.beamParts === 2);
    return 'Sizes: measured → wood to buy in cm (+' + normRules(S.config.rules).allowance + ' cm for the walls)  ·  Lines = beams (عروق)' +
      (joint ? '  ·  Bold beam = planks meet' : '') + (support ? '  ·  Red dashes = support where beams meet' : '') + '  ·  Wood in cm × pieces';
  }

  function drawPlanCanvas(ctx, s, box) {
    const items = planItems(s);
    ctx.save();
    if (!items.length) {
      setFont(ctx, 34, 400); ctx.fillStyle = '#5D6A71'; ctx.textAlign = 'center';
      ctx.fillText('No rooms with sizes yet', box.x + box.w / 2, box.y + box.h / 2);
      ctx.restore();
      return;
    }
    const rules = normRules(S.config.rules);
    const wood = calcWood(s.rooms, rules);
    const b = bounds(items);
    const bw = b.x2 - b.x1, bh = b.y2 - b.y1;
    const k = Math.min((box.w * 0.96) / bw, (box.h * 0.9) / bh, 170);
    const ox = box.x + (box.w - bw * k) / 2, oy = box.y + (box.h - bh * k) / 2;
    items.forEach((it) => {
      const r = it.r;
      const col = ROOM_COLORS[(r.color || 0) % ROOM_COLORS.length];
      const x = ox + (it.x - b.x1) * k, y = oy + (it.y - b.y1) * k, w = it.w * k, h = it.h * k;
      const fill = r.roof ? col.fill : '#FFFFFF';
      const ink = r.roof ? col.ink : '#6D6E71';
      const wr = wood.rooms[it.i];
      const si = sideInfo(it, r.roof ? wr : null);
      ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
      // beams: one line per beam, running in the beam direction (+ plank joint beam, + support)
      if (r.roof) {
        roomMarks(wr).forEach((mk) => {
          ctx.save();
          if (mk.kind === 'support') {
            ctx.globalAlpha = 1; ctx.strokeStyle = '#D92D20'; ctx.lineWidth = 9; ctx.setLineDash([26, 14]);
          } else {
            ctx.globalAlpha = mk.kind === 'joint' ? 0.95 : 0.42; ctx.strokeStyle = ink; ctx.lineWidth = mk.kind === 'joint' ? 9 : 3;
          }
          ctx.beginPath();
          const across = mk.kind === 'support' ? !si.beamsVertical : si.beamsVertical; // support crosses the beams
          if (across) { ctx.moveTo(x + w * mk.t, y + 4); ctx.lineTo(x + w * mk.t, y + h - 4); }
          else { ctx.moveTo(x + 4, y + h * mk.t); ctx.lineTo(x + w - 4, y + h * mk.t); }
          ctx.stroke(); ctx.restore();
        });
      }
      ctx.lineWidth = r.roof ? 5 : 3; ctx.strokeStyle = r.roof ? '#1D2428' : '#8A969C';
      ctx.strokeRect(x, y, w, h);
      const fs = clamp(Math.min(w, h) * 0.11, 22, 40);
      const off = fs * 1.15;
      const roomy = w > fs * 5 && h > fs * 4;
      if (roomy) {
        ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 3;
        const dw = fitDim(ctx, it.w, si.wLen, w - fs * 1.4, fs * 0.92, si.wParts);
        const dh = fitDim(ctx, it.h, si.hLen, h - off * 2.4, fs * 0.92, si.hParts);
        drawArrow(ctx, x + fs * 0.5, y + off, x + w - fs * 0.5, y + off, fs * 0.45);
        labelOn(ctx, dw.text, x + w / 2, y + off, dw.size, fill, ink, false);
        drawArrow(ctx, x + off, y + off * 1.9, x + off, y + h - fs * 0.5, fs * 0.45);
        labelOn(ctx, dh.text, x + off, y + off * 0.95 + h / 2, dh.size, fill, ink, true);
      }
      const name = r.name || 'Room ' + (it.i + 1);
      const spot = nameSpot(r.roof ? wr : null, si.beamsVertical);
      const left = spot.right ? w / 2 + fs * 0.4 : roomy ? off * 1.8 : w * 0.08;
      const avail = Math.max(w * 0.3, w - left - fs * 0.5);
      const nfs = fitText(ctx, name, avail, clamp(Math.min(w, h) * 0.16, 24, 54), 700, false, 14);
      ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      setFont(ctx, nfs, 700);
      const ny0 = spot.lower ? y + h * 0.74 : y + h / 2 + (roomy ? off * 0.5 : 0);
      ctx.fillText(name, x + (left + w - fs * 0.5) / 2, ny0);
      if (!roomy) {
        setFont(ctx, nfs * 0.8, 400);
        ctx.fillText(fmtM(it.w) + ' × ' + fmtM(it.h) + ' m', x + w / 2, y + h / 2 + nfs * 1.2);
      }
    });
    // scale bar
    const sx = box.x + 6, sy = box.y + box.h + 34;
    ctx.strokeStyle = '#5D6A71'; ctx.fillStyle = '#5D6A71'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + k, sy); ctx.moveTo(sx, sy - 10); ctx.lineTo(sx, sy + 10); ctx.moveTo(sx + k, sy - 10); ctx.lineTo(sx + k, sy + 10); ctx.stroke();
    setFont(ctx, 24, 600); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('1 m', sx + k + 12, sy);
    ctx.restore();
  }

  function drawHeader(ctx, W, m, lg, lines) {
    const lh = 200;
    if (lg.shelter) { const h = lh, w = h * lg.shelter.naturalWidth / lg.shelter.naturalHeight; ctx.drawImage(lg.shelter, m, m * 0.7, w, h); }
    if (lg.lebaladna) { const h = lh * 0.95, w = h * lg.lebaladna.naturalWidth / lg.lebaladna.naturalHeight; ctx.drawImage(lg.lebaladna, W - m - w, m * 0.7, w, h); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#1D2428';
    let y = m * 0.7 + 46;
    lines.forEach((ln) => {
      if (!ln.text) return;
      const size = fitText(ctx, ln.text, W - 2 * m - 2 * 280, ln.size, ln.weight, ln.display, 20);
      ctx.fillStyle = ln.color || '#1D2428';
      setFont(ctx, size, ln.weight, ln.display);
      ctx.fillText(ln.text, W / 2, y);
      y += size * 1.32;
    });
    return Math.max(y, m * 0.7 + lh) + 20;
  }

  function drawSheet(ctx, s, W, H, lg) {
    const m = Math.round(W * 0.055);
    const w = calcWood(s.rooms, S.config.rules);
    const rules = normRules(S.config.rules);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
    const top = drawHeader(ctx, W, m, lg, [
      { text: s.project || S.config.project || 'Lebaladna Shelter', size: 44, weight: 700 },
      { text: 'Name: ' + (s.family || '—'), size: 46, weight: 400 },
      { text: s.area ? 'Area: ' + s.area : '', size: 42, weight: 400 },
      { text: s.mobile || '', size: 40, weight: 400 }
    ]);
    // info strip
    ctx.fillStyle = '#5D6A71'; setFont(ctx, 26, 400); ctx.textAlign = 'center';
    ctx.fillText([s.code || 'Not uploaded yet', s.date, s.researcher ? 'Researcher: ' + s.researcher : '', s.grade ? 'Grade ' + s.grade : ''].filter(Boolean).join('   ·   '), W / 2, top + 6);

    const rows = w.rooms.filter((r) => r.roof);
    const rowH = clamp((H * 0.3) / Math.max(rows.length + 1, 6), 46, 66);
    const tableH = (rows.length + 1) * rowH;
    const totalsH = (2 + Math.max(1, Object.keys(w.beams).length) + Math.max(1, Object.keys(w.planks).length)) * rowH + 52 + 40;
    const extraLines = w.warnings.length + w.notes.length * 2 + (rules.example ? 1 : 0) + (s.notes ? 2 : 0);
    const footerH = 110;
    const planTop = top + 50;
    const planBottom = Math.min(H * 0.72, H - m - footerH - Math.max(tableH, totalsH) - 150 - extraLines * 36);
    drawPlanCanvas(ctx, s, { x: m, y: planTop, w: W - 2 * m, h: Math.max(400, planBottom - planTop) });

    // wood table (Room | Planks | Beams) — same colours as the plan
    const ty = Math.max(planBottom, planTop + 400) + 90;
    const tw = (W - 2 * m) * 0.64, cols = [tw * 0.42, tw * 0.29, tw * 0.29];
    const cellText = (txt, cx, cy, cw, color, weight, align) => {
      const size = fitText(ctx, txt, cw - 24, rowH * 0.46, weight, false, 16);
      setFont(ctx, size, weight); ctx.fillStyle = color; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, align === 'center' ? cx + cw / 2 : cx + 14, cy + rowH / 2);
    };
    ctx.lineWidth = 2; ctx.strokeStyle = '#1D2428';
    ['Room', 'Planks', 'Beams'].forEach((hd, i) => {
      const cx = m + cols.slice(0, i).reduce((a, b) => a + b, 0);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(cx, ty, cols[i], rowH); ctx.strokeRect(cx, ty, cols[i], rowH);
      cellText(hd, cx, ty, cols[i], '#1D2428', 700, i ? 'center' : 'left');
    });
    rows.forEach((r, ri) => {
      const c = ROOM_COLORS[(r.color || 0) % ROOM_COLORS.length];
      const cy = ty + (ri + 1) * rowH;
      const vals = [r.name, r.plankLen ? r.plankLen + ' × ' + r.plankQty : '', r.beamLen ? r.beamLen + ' × ' + r.beamQty : ''];
      vals.forEach((v, i) => {
        const cx = m + cols.slice(0, i).reduce((a, b) => a + b, 0);
        ctx.fillStyle = c.fill; ctx.fillRect(cx, cy, cols[i], rowH); ctx.strokeRect(cx, cy, cols[i], rowH);
        cellText(v || '–', cx, cy, cols[i], c.ink, i ? 600 : 500, i ? 'center' : 'left');
      });
    });
    if (!rows.length) { setFont(ctx, 28, 400); ctx.fillStyle = '#5D6A71'; ctx.textAlign = 'left'; ctx.fillText('No rooms marked for roofing', m, ty + rowH * 1.6); }

    // totals boxes
    const bx = m + tw + 40, bw = W - m - bx;
    let by = ty;
    const totalBox = (title, map) => {
      const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
      const lines = keys.length ? keys.map((kk) => kk + ' × ' + map[kk]) : ['–'];
      ctx.lineWidth = 2; ctx.strokeStyle = '#1D2428';
      ctx.fillStyle = '#F1F4F5'; ctx.fillRect(bx, by, bw, rowH); ctx.strokeRect(bx, by, bw, rowH);
      cellText(title, bx, by, bw, '#1D2428', 700, 'center');
      by += rowH;
      lines.forEach((ln) => { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(bx, by, bw, rowH); ctx.strokeRect(bx, by, bw, rowH); cellText(ln, bx, by, bw, '#1D2428', 600, 'center'); by += rowH; });
      by += 26;
    };
    totalBox('Total beams', w.beams);
    totalBox('Total planks', w.planks);
    setFont(ctx, 26, 400); ctx.fillStyle = '#5D6A71'; ctx.textAlign = 'center';
    ctx.fillText('Roof area ' + fmtM(w.roofArea) + ' m²', bx + bw / 2, by + 10);

    // notes & warnings
    let ny = Math.max(ty + tableH, by) + 60;
    ctx.textAlign = 'left';
    const warnLines = w.warnings.slice();
    if (rules.example) warnLines.unshift('Wood uses EXAMPLE rules – confirm before buying.');
    warnLines.forEach((t) => { setFont(ctx, 26, 600); ctx.fillStyle = '#B42318'; ny = wrapText(ctx, t, m, ny, W - 2 * m, 34, 2) + 38; });
    w.notes.forEach((t) => { setFont(ctx, 26, 600); ctx.fillStyle = '#A9500F'; ny = wrapText(ctx, t + '.', m, ny, W - 2 * m, 34, 2) + 38; });
    if (s.notes) {
      setFont(ctx, 26, 400); ctx.fillStyle = '#1D2428';
      wrapText(ctx, 'Notes: ' + s.notes, m, ny, W - 2 * m, 34, Math.max(1, Math.floor((H - m - footerH - ny) / 34)));
    }
    // footer: what the drawing shows, then the print date
    ctx.fillStyle = '#5D6A71'; ctx.textAlign = 'left';
    const leg = legendText(s);
    fitText(ctx, leg, W - 2 * m, 22, 400, false, 15);
    ctx.fillText(leg, m, H - m * 0.6);
    setFont(ctx, 22, 400); ctx.textAlign = 'right';
    ctx.fillText('Printed ' + today(), W - m, H - m * 0.6 - 34);
  }

  function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
    const words = String(text).split(/\s+/);
    let line = '', n = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y); y += lh; n++; line = words[i];
        if (n >= maxLines - 1) { line = words.slice(i).join(' '); break; }
      } else line = test;
    }
    if (line) {
      let cut = false;
      while (ctx.measureText(line + (cut ? '…' : '')).width > maxW && line.length > 1) { line = line.slice(0, -1); cut = true; }
      ctx.fillText(cut ? line + '…' : line, x, y);
    }
    return y;
  }

  function drawSummary(ctx, list, W, H, lg) {
    const m = Math.round(W * 0.055);
    const t = sumWood(list);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);
    let y = drawHeader(ctx, W, m, lg, [
      { text: 'Purchase list', size: 64, weight: 700, display: true },
      { text: list.length + ' houses · ' + fmtM(t.area) + ' m² of roof', size: 38, weight: 400 },
      { text: 'Printed ' + today(), size: 30, weight: 400, color: '#5D6A71' }
    ]) + 30;
    const colW = (W - 2 * m - 40) / 2;
    const block = (title, map, x) => {
      let yy = y;
      setFont(ctx, 40, 700, true); ctx.fillStyle = '#1D2428'; ctx.textAlign = 'left'; ctx.fillText(title, x, yy); yy += 54;
      const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
      if (!keys.length) { setFont(ctx, 32, 400); ctx.fillText('–', x, yy); yy += 48; }
      keys.forEach((kk) => { setFont(ctx, 40, 600); ctx.fillText(kk + ' cm × ' + map[kk], x, yy); yy += 54; });
      return yy;
    };
    y = Math.max(block('Beams (عروق)', t.beams, m), block('Planks (ألواح)', t.planks, m + colW + 40)) + 30;
    // houses table
    const cols = [0.14, 0.3, 0.22, 0.17, 0.17].map((f) => f * (W - 2 * m));
    const rh = 52;
    const heads = ['Code', 'Head of family', 'Area', 'Beams', 'Planks'];
    ctx.lineWidth = 2; ctx.strokeStyle = '#C9D2D7';
    const maxRows = Math.floor((H - m - 80 - y) / rh) - 1;
    const rows = list.slice(0, maxRows);
    [heads].concat(rows.map((s) => {
      const w = calcWood(s.rooms, S.config.rules);
      return [s.code || '—', s.family || '—', s.area || '', woodText(w.beams) || '–', woodText(w.planks) || '–'];
    })).forEach((cells, ri) => {
      let x = m;
      cells.forEach((c, ci) => {
        if (ri === 0) { ctx.fillStyle = '#E6EBED'; ctx.fillRect(x, y, cols[ci], rh); }
        ctx.strokeRect(x, y, cols[ci], rh);
        const size = fitText(ctx, String(c), cols[ci] - 20, 26, ri === 0 ? 700 : 400, false, 14);
        setFont(ctx, size, ri === 0 ? 700 : 400); ctx.fillStyle = '#1D2428'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(String(c), x + 10, y + rh / 2);
        x += cols[ci];
      });
      y += rh;
    });
    ctx.textBaseline = 'alphabetic';
    if (list.length > rows.length) { setFont(ctx, 26, 400); ctx.fillStyle = '#5D6A71'; ctx.fillText('+ ' + (list.length - rows.length) + ' more houses on the next pages', m, y + 40); }
  }

  async function buildPdf(list) {
    await loadScript(ASSET.jspdf);
    await readyFonts();
    const lg = await logos();
    const jsPDF = window.jspdf.jsPDF;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const W = 1654, H = 2339;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    let first = true;
    const addPage = () => {
      if (!first) pdf.addPage();
      first = false;
      pdf.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    };
    if (list.length > 1) { drawSummary(ctx, list, W, H, lg); addPage(); }
    for (const s of list) { ensureLayout(s); drawSheet(ctx, s, W, H, lg); addPage(); }
    return pdf.output('blob');
  }

  async function buildPptx(list) {
    await loadScript(ASSET.pptx);
    const lg = await logos();
    const logoData = {};
    if (lg.shelter) logoData.shelter = { data: imgDataUrl(lg.shelter), ratio: lg.shelter.naturalWidth / lg.shelter.naturalHeight };
    if (lg.lebaladna) logoData.lebaladna = { data: imgDataUrl(lg.lebaladna), ratio: lg.lebaladna.naturalWidth / lg.lebaladna.naturalHeight };
    const pres = new window.PptxGenJS();
    pres.defineLayout({ name: 'SHELTER', width: 7.5, height: 13.333 });
    pres.layout = 'SHELTER';
    pres.author = 'Lebaladna Shelter';
    pres.title = list.length > 1 ? 'Shelter purchase list' : 'Shelter survey ' + (list[0].code || '');
    if (list.length > 1) summarySlide(pres, list, logoData);
    list.forEach((s) => { ensureLayout(s); surveySlide(pres, s, logoData); });
    let blob = await pres.write({ outputType: 'blob' });
    if (!(blob instanceof Blob)) blob = new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    return blob;
  }

  const hex = (c) => c.replace('#', '').toUpperCase();

  function slideHeader(pres, slide, logoData, lines) {
    if (logoData.shelter) slide.addImage({ data: logoData.shelter.data, x: 0.4, y: 0.35, h: 1.2, w: 1.2 * logoData.shelter.ratio, altText: 'Shelter team logo' });
    if (logoData.lebaladna) { const w = 1.15 * logoData.lebaladna.ratio; slide.addImage({ data: logoData.lebaladna.data, x: 7.5 - 0.4 - w, y: 0.37, h: 1.15, w, altText: 'Lebaladna logo' }); }
    let y = 0.36;
    lines.forEach((ln) => {
      if (!ln.text) return;
      slide.addText(ln.text, { x: 1.75, y, w: 4.0, h: ln.h, fontFace: 'Arial', fontSize: ln.size, bold: !!ln.bold, color: ln.color || '1D2428', align: 'center', valign: 'middle', margin: 0, isTextBox: true, fit: 'shrink' });
      y += ln.h + 0.02;
    });
    return y;
  }

  function surveySlide(pres, s, logoData) {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };
    const w = calcWood(s.rooms, S.config.rules);
    const rules = normRules(S.config.rules);
    let y = slideHeader(pres, slide, logoData, [
      { text: s.project || S.config.project || 'Lebaladna Shelter', size: 13, bold: true, h: 0.34 },
      { text: 'Name: ' + (s.family || '—'), size: 17, h: 0.42 },
      { text: s.area ? 'Area: ' + s.area : '', size: 15, h: 0.38 },
      { text: s.mobile || '', size: 14, h: 0.34 }
    ]);
    y = Math.max(y, 1.65);
    slide.addText([s.code || 'Not uploaded yet', s.date, s.researcher ? 'Researcher: ' + s.researcher : ''].filter(Boolean).join('   ·   '),
      { x: 0.4, y, w: 6.7, h: 0.28, fontFace: 'Arial', fontSize: 9, color: '5D6A71', align: 'center', margin: 0, isTextBox: true });

    // plan as native, editable shapes
    const rows = w.rooms.filter((r) => r.roof);
    const rowH = 0.34;
    const tableH = (rows.length + 1) * rowH;
    const box = { x: 0.5, y: y + 0.45, w: 6.5, h: Math.max(3.5, 13.333 - 0.55 - 0.5 - tableH - 0.55 - (y + 0.45)) };
    box.h = Math.min(box.h, 6.3);
    const items = planItems(s);
    if (items.length) {
      const b = bounds(items);
      const bw = b.x2 - b.x1, bh = b.y2 - b.y1;
      const k = Math.min(box.w / bw, box.h / bh, 0.9);
      const ox = box.x + (box.w - bw * k) / 2, oy = box.y + (box.h - bh * k) / 2;
      items.forEach((it) => {
        const r = it.r;
        const col = ROOM_COLORS[(r.color || 0) % ROOM_COLORS.length];
        const x = ox + (it.x - b.x1) * k, yy = oy + (it.y - b.y1) * k, ww = it.w * k, hh = it.h * k;
        const fill = r.roof ? hex(col.fill) : 'FFFFFF';
        const ink = r.roof ? hex(col.ink) : '6D6E71';
        const name = r.name || 'Room ' + (it.i + 1);
        const wr = w.rooms[it.i];
        const si = sideInfo(it, r.roof ? wr : null);
        // room (fill + walls), then its beams, then the labels on top
        slide.addShape(pres.ShapeType.rect, { x, y: yy, w: ww, h: hh, fill: { color: fill }, line: { color: r.roof ? '1D2428' : '8A969C', width: r.roof ? 1.5 : 1 }, objectName: name });
        if (r.roof) {
          roomMarks(wr).forEach((mk, q) => {
            const across = mk.kind === 'support' ? !si.beamsVertical : si.beamsVertical;
            const geo = across
              ? { x: x + ww * mk.t, y: yy + 0.03, w: 0, h: hh - 0.06 }
              : { x: x + 0.03, y: yy + hh * mk.t, w: ww - 0.06, h: 0 };
            const line = mk.kind === 'support' ? { color: 'D92D20', width: 3, dashType: 'dash' }
              : mk.kind === 'joint' ? { color: ink, width: 2.5 }
                : { color: ink, width: 0.75, transparency: 55 };
            slide.addShape(pres.ShapeType.line, Object.assign(geo, { line, objectName: name + (mk.kind === 'support' ? ' support' : mk.kind === 'joint' ? ' beam where planks meet' : ' beam ' + (q + 1)) }));
          });
        }
        const dims = ww > 1.1 && hh > 0.9;
        const spot = nameSpot(r.roof ? wr : null, si.beamsVertical);
        let nb = { x: x + (dims ? 0.32 : 0), y: yy + (dims ? 0.2 : 0), w: ww - (dims ? 0.36 : 0), h: hh - (dims ? 0.2 : 0) };
        if (spot.right) nb = Object.assign(nb, { x: x + ww / 2 + 0.06, w: ww / 2 - 0.1 });
        if (spot.lower) nb = Object.assign(nb, { y: yy + hh / 2 + 0.06, h: hh / 2 - 0.1 });
        slide.addText(name, {
          x: nb.x, y: nb.y, w: nb.w, h: nb.h,
          fontFace: 'Arial', fontSize: clamp(Math.min(ww, hh) * 11, 9, 16), bold: true, color: ink, align: 'center', valign: 'middle', margin: 0, isTextBox: true
        });
        if (dims) {
          const off = 0.17;
          // keep the wood length: 9 pt, then 7 pt, and only then the measured size alone
          const lab = (m, len, room, parts) => {
            const long = dimText(m, len, parts);
            for (const pt of [9, 7]) {
              const lw = Math.max(0.6, long.length * pt * 0.0081 + 0.12);
              if (lw + 0.2 <= room) return { text: long, w: lw, pt };
            }
            return { text: lenLabel(m), w: 0.6, pt: 8 };
          };
          const top = lab(it.w, si.wLen, ww, si.wParts);
          const side = lab(it.h, si.hLen, hh - off - 0.2, si.hParts);
          slide.addShape(pres.ShapeType.line, { x: x + 0.08, y: yy + off, w: ww - 0.16, h: 0, line: { color: ink, width: 1, beginArrowType: 'triangle', endArrowType: 'triangle' } });
          slide.addText(top.text, { x: x + ww / 2 - top.w / 2, y: yy + off - 0.11, w: top.w, h: 0.22, fontFace: 'Arial', fontSize: top.pt, bold: true, color: ink, fill: { color: fill }, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
          slide.addShape(pres.ShapeType.line, { x: x + off, y: yy + off + 0.16, w: 0, h: hh - off - 0.24, line: { color: ink, width: 1, beginArrowType: 'triangle', endArrowType: 'triangle' } });
          slide.addText(side.text, { x: x + off - side.w / 2, y: yy + off + 0.16 + (hh - off - 0.24) / 2 - 0.11, w: side.w, h: 0.22, rotate: 270, fontFace: 'Arial', fontSize: side.pt, bold: true, color: ink, fill: { color: fill }, align: 'center', valign: 'middle', margin: 0, isTextBox: true });
        } else {
          slide.addText(fmtM(it.w) + ' × ' + fmtM(it.h) + ' m', { x, y: yy + hh - 0.26, w: ww, h: 0.22, fontFace: 'Arial', fontSize: 8, color: ink, align: 'center', margin: 0, isTextBox: true });
        }
      });
      // 1 m scale bar
      slide.addShape(pres.ShapeType.line, { x: box.x, y: box.y + box.h + 0.12, w: k, h: 0, line: { color: '5D6A71', width: 1.5 } });
      slide.addText('1 m', { x: box.x + k + 0.06, y: box.y + box.h + 0.02, w: 0.5, h: 0.2, fontFace: 'Arial', fontSize: 8, color: '5D6A71', margin: 0, isTextBox: true });
    } else {
      slide.addText('No rooms with sizes yet', { x: box.x, y: box.y + box.h / 2 - 0.2, w: box.w, h: 0.4, fontFace: 'Arial', fontSize: 12, color: '5D6A71', align: 'center', isTextBox: true });
    }

    // wood table
    const ty = box.y + box.h + 0.45;
    const border = { type: 'solid', pt: 1, color: '1D2428' };
    const cell = (text, o) => ({ text, options: Object.assign({ fontFace: 'Arial', fontSize: 10, color: '1D2428', border: [border, border, border, border], valign: 'middle', margin: 0.05 }, o || {}) });
    const tRows = [[cell('Room', { bold: true }), cell('Planks', { bold: true, align: 'center' }), cell('Beams', { bold: true, align: 'center' })]];
    rows.forEach((r) => {
      const c = ROOM_COLORS[(r.color || 0) % ROOM_COLORS.length];
      const o = { fill: { color: hex(c.fill) }, color: hex(c.ink) };
      tRows.push([cell(r.name, o), cell(r.plankLen ? r.plankLen + ' × ' + r.plankQty : '–', Object.assign({ align: 'center' }, o)), cell(r.beamLen ? r.beamLen + ' × ' + r.beamQty : '–', Object.assign({ align: 'center' }, o))]);
    });
    slide.addTable(tRows, { x: 0.5, y: ty, w: 4.6, colW: [1.9, 1.35, 1.35], rowH });

    // totals
    let by = ty;
    const totalTable = (title, map) => {
      const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
      const t = [[cell(title, { bold: true, align: 'center', fill: { color: 'F1F4F5' } })]].concat((keys.length ? keys.map((kk) => kk + ' × ' + map[kk]) : ['–']).map((v) => [cell(v, { align: 'center', bold: true })]));
      slide.addTable(t, { x: 5.4, y: by, w: 1.6, colW: [1.6], rowH });
      by += t.length * rowH + 0.25;
    };
    totalTable('Total beams', w.beams);
    totalTable('Total planks', w.planks);

    const foot = [];
    if (rules.example) foot.push({ text: 'Wood uses EXAMPLE rules – confirm before buying.  ', options: { color: 'B42318', bold: true } });
    w.warnings.forEach((t) => foot.push({ text: t + '  ', options: { color: 'B42318' } }));
    w.notes.forEach((t) => foot.push({ text: t + '.  ', options: { color: 'A9500F', bold: true } }));
    foot.push({ text: legendText(s) + '  ·  printed ' + today(), options: { color: '5D6A71' } });
    slide.addText(foot, { x: 0.4, y: 12.25, w: 6.7, h: 0.9, fontFace: 'Arial', fontSize: 8, margin: 0, valign: 'bottom', isTextBox: true });
    if (s.notes) slide.addNotes(s.notes);
  }

  function summarySlide(pres, list, logoData) {
    const slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };
    const t = sumWood(list);
    const y = slideHeader(pres, slide, logoData, [
      { text: 'Purchase list', size: 26, bold: true, h: 0.6 },
      { text: list.length + ' houses · ' + fmtM(t.area) + ' m² of roof', size: 13, h: 0.34 },
      { text: 'Printed ' + today(), size: 11, color: '5D6A71', h: 0.3 }
    ]);
    const border = { type: 'solid', pt: 1, color: 'C9D2D7' };
    const cell = (text, o) => ({ text: String(text), options: Object.assign({ fontFace: 'Arial', fontSize: 11, color: '1D2428', border: [border, border, border, border], valign: 'middle', margin: 0.05 }, o || {}) });
    const block = (title, map, x) => {
      const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
      const rows = [[cell(title, { bold: true, fill: { color: 'E6EBED' } })]].concat((keys.length ? keys.map((kk) => kk + ' cm × ' + map[kk]) : ['–']).map((v) => [cell(v, { bold: true, fontSize: 13 })]));
      slide.addTable(rows, { x, y: Math.max(y, 1.7) + 0.2, w: 3.1, colW: [3.1], rowH: 0.38 });
      return rows.length;
    };
    const n = Math.max(block('Beams (عروق)', t.beams, 0.5), block('Planks (ألواح)', t.planks, 3.9));
    const ty = Math.max(y, 1.7) + 0.2 + n * 0.38 + 0.45;
    const maxRows = Math.floor((13.333 - 0.5 - ty) / 0.32) - 1;
    const rows = [[cell('Code', { bold: true, fill: { color: 'E6EBED' } }), cell('Head of family', { bold: true, fill: { color: 'E6EBED' } }), cell('Area', { bold: true, fill: { color: 'E6EBED' } }), cell('Beams', { bold: true, fill: { color: 'E6EBED' } }), cell('Planks', { bold: true, fill: { color: 'E6EBED' } })]]
      .concat(list.slice(0, maxRows).map((s) => {
        const w = calcWood(s.rooms, S.config.rules);
        return [cell(s.code || '—', { fontSize: 9 }), cell(s.family || '—', { fontSize: 9 }), cell(s.area || '', { fontSize: 9 }), cell(woodText(w.beams) || '–', { fontSize: 9 }), cell(woodText(w.planks) || '–', { fontSize: 9 })];
      }));
    slide.addTable(rows, { x: 0.5, y: ty, w: 6.5, colW: [0.85, 1.85, 1.3, 1.25, 1.25], rowH: 0.32 });
  }

  function exportName(list, ext) {
    const clean = (t) => String(t || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (list.length === 1) return clean((list[0].code || 'Survey') + ' ' + (list[0].family || '')) + ext;
    return 'Shelter purchase list ' + today() + ext;
  }

  let lastExport = null;
  /** The drawing on its own: house name + plan with room names and sizes, as a PNG image. */
  async function buildPng(s) {
    await readyFonts();
    const lg = await logos();
    ensureLayout(s);
    const items = planItems(s);
    const W = 1800, m = Math.round(W * 0.055);
    const b = items.length ? bounds(items) : { x1: 0, y1: 0, x2: 8, y2: 5 };
    const planW = W - 2 * m;
    const planH = clamp(planW * ((b.y2 - b.y1) / Math.max(0.5, b.x2 - b.x1)) * 1.08, 520, 2600);
    const headH = 330, footH = 150;
    const c = document.createElement('canvas');
    c.width = W; c.height = Math.round(headH + planH + footH);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height);
    const top = drawHeader(ctx, W, m, lg, [
      { text: s.project || S.config.project || 'Lebaladna Shelter', size: 44, weight: 700 },
      { text: 'Name: ' + (s.family || '—'), size: 46, weight: 400 },
      { text: [s.area ? 'Area: ' + s.area : '', s.code || ''].filter(Boolean).join('   ·   '), size: 38, weight: 400 }
    ]);
    drawPlanCanvas(ctx, s, { x: m, y: Math.max(top, headH - 20), w: planW, h: planH });
    ctx.fillStyle = '#5D6A71'; setFont(ctx, 24, 400); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    fitText(ctx, legendText(s), W - 2 * m - 220, 24, 400, false, 15);
    ctx.fillText(legendText(s), m, c.height - 36);
    ctx.textAlign = 'right';
    ctx.fillText(today(), W - m, c.height - 36);
    return new Promise((res, rej) => c.toBlob((blob) => (blob ? res(blob) : rej(new Error('Could not make the image.'))), 'image/png'));
  }

  const EXPORT_KIND = {
    pdf: { label: 'PDF', ext: '.pdf', type: 'application/pdf' },
    pptx: { label: 'PowerPoint', ext: '.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    png: { label: 'drawing image', ext: ' – drawing.png', type: 'image/png' }
  };

  async function runExport(kind, list) {
    if (!list.length) return;
    const K = EXPORT_KIND[kind] || EXPORT_KIND.pdf;
    showSheet('<h2>Preparing ' + K.label + '…</h2><p class="muted">This takes a few seconds.</p>');
    try {
      const blob = kind === 'png' ? await buildPng(list[0]) : kind === 'pdf' ? await buildPdf(list) : await buildPptx(list);
      const name = exportName(list, K.ext);
      lastExport = { blob, name, type: K.type };
      if (viewerUrl) URL.revokeObjectURL(viewerUrl);
      viewerUrl = kind === 'png' ? URL.createObjectURL(blob) : null;
      const canShare = (() => { try { return !!(navigator.canShare && navigator.canShare({ files: [new File([blob], name, { type: lastExport.type })] })); } catch (e) { return false; } })();
      showSheet('<h2>Ready</h2>' + (viewerUrl ? '<img class="viewer" src="' + viewerUrl + '" alt="House drawing">' : '') +
        '<p class="muted" dir="auto" style="margin:0;overflow-wrap:anywhere">' + esc(name) + ' · ' + Math.max(1, Math.round(blob.size / 1024)) + ' KB</p>' +
        '<div class="btn-row">' + (canShare ? '<button class="btn" data-act="share-export">' + ICON.share + 'Share (WhatsApp…)</button>' : '') +
        '<button class="btn ' + (canShare ? 'ghost' : '') + '" data-act="save-export">' + ICON.download + 'Download</button>' +
        '<button class="btn quiet" data-act="close-sheet">Close</button></div>');
    } catch (e) {
      console.error(e);
      showSheet('<h2>Export failed</h2><div class="notice err"><div>' + esc(e.message || String(e)) + '</div></div><div class="btn-row"><button class="btn" data-act="close-sheet">Close</button></div>');
    }
  }

  async function saveBlob(name, blob) {
    if (window.claude && typeof window.claude.use === 'function') {
      try {
        const dl = await window.claude.use('downloads');
        if (dl) {
          try { await dl.save({ filename: name, data: blob }); toast('Saved'); }
          catch (e) { if (e && e.code !== 'declined') toast('Could not save the file here.'); }
          return;
        }
      } catch (e) { /* fall through */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 8000);
  }

  function showSheet(inner) {
    let back = $('#sheetBack');
    if (!back) {
      back = document.createElement('div');
      back.id = 'sheetBack';
      back.className = 'sheet-back';
      back.addEventListener('click', (e) => { if (e.target === back) closeSheet(); });
      document.body.appendChild(back);
    }
    back.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + inner + '</div>';
  }
  function closeSheet() {
    const b = $('#sheetBack');
    if (b) b.remove();
    if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
  }

  /* ═════════════════════ Events ═════════════════════ */
  const removeArm = new Map();
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const actEl = t.closest('[data-act]');
    const s = curSurvey();

    const stepEl = t.closest('[data-step]');
    if (stepEl && S.cur) { S.cur.step = Number(stepEl.dataset.step); S.stepOf[S.cur.id] = S.cur.step; renderEditor(S.cur.id); return; }

    const filterEl = t.closest('[data-filter]');
    if (filterEl) { S.list.filter = filterEl.dataset.filter; renderList(); return; }

    const pick = t.closest('[data-pick]');
    if (pick) { e.stopPropagation(); if (pick.checked) S.list.picked.add(pick.dataset.pick); else S.list.picked.delete(pick.dataset.pick); renderList(); return; }

    const open = t.closest('[data-open]');
    if (open && !actEl) {
      if (S.list.selecting) {
        const id = open.dataset.open;
        if (S.list.picked.has(id)) S.list.picked.delete(id); else S.list.picked.add(id);
        renderList();
      } else go('survey-' + open.dataset.open);
      return;
    }

    const add = t.closest('[data-addroom]');
    if (add && s) { addRoom(s, add.dataset.addroom); return; }

    const viewp = t.closest('[data-viewpaper]');
    if (viewp && s) { viewPaper(s, viewp.dataset.viewpaper); return; }

    const delp = t.closest('[data-delpaper]');
    if (delp && s) {
      const id = delp.dataset.delpaper;
      s.papers = (s.papers || []).filter((p) => p.id !== id);
      DB.del('files', id).catch(() => {});
      saveLocalSoon(s, 0); updateSyncPill(); renderPapersList();
      return;
    }

    const st = t.closest('[data-setstatus]');
    if (st && s) {
      s.status = st.dataset.setstatus;
      if (s.status === 'Approved' && !String(s.reviewer || '').trim()) s.reviewer = S.me.name;
      touch(s); renderEditor(s.id); toast('Status: ' + s.status);
      return;
    }

    if (!actEl) return;
    const act = actEl.dataset.act;
    switch (act) {
      case 'back': go(''); break;
      case 'new': newSurvey(); break;
      case 'go-rules': go('rules'); break;
      case 'go-me': go('me'); break;
      case 'install':
        if (S.installPrompt) { S.installPrompt.prompt(); try { await S.installPrompt.userChoice; } catch (err) { /* ignore */ } S.installPrompt = null; route(); }
        break;
      case 'hide-install': lsSet('shelter-hide-install', '1'); renderList(); break;
      case 'toggle-select': S.list.selecting = !S.list.selecting; if (!S.list.selecting) S.list.picked.clear(); renderList(); break;
      case 'pick-all': filteredSurveys().forEach((x) => S.list.picked.add(x.id)); renderList(); break;
      case 'export-picked': runExport(actEl.dataset.kind, Array.from(S.list.picked).map((id) => S.surveys.get(id)).filter(Boolean)); break;
      case 'export': if (s) runExport(actEl.dataset.kind, [s]); break;
      case 'share-export':
        if (lastExport) {
          try { await navigator.share({ files: [new File([lastExport.blob], lastExport.name, { type: lastExport.type })], title: lastExport.name }); }
          catch (err) { if (err && err.name !== 'AbortError') toast('Sharing did not work. Use Save instead.'); }
        }
        break;
      case 'save-export': if (lastExport) saveBlob(lastExport.name, lastExport.blob); break;
      case 'close-sheet': closeSheet(); break;
      case 'sync-info': {
        const i = syncInfo();
        showSheet('<h2>Sync</h2><p style="margin:0"><b>' + esc(i.text) + '</b></p>' +
          '<p class="small muted" style="margin:0">' + pendingCount() + ' item(s) waiting · last sync ' + esc(fmtWhen(S.lastSyncAt ? new Date(S.lastSyncAt).toISOString() : '')) + '</p>' +
          (S.sync.msg ? '<div class="notice ' + (S.sync.state === 'offline' || S.sync.state === 'wait' ? 'warn' : 'err') + ' small"><div>' + esc(S.sync.msg) + '</div></div>' : '') +
          '<p class="small muted" style="margin:0">Everything is kept on this phone until it reaches the sheet. Open the app when you have internet and it uploads by itself.</p>' +
          '<div class="btn-row">' + (CFG.demo ? '' : '<button class="btn" data-act="sync-now">Sync now</button>') + '<button class="btn quiet" data-act="close-sheet">Close</button></div>');
        break;
      }
      case 'sync-now': closeSheet(); S.sync.state = 'idle'; syncNow(); if (currentView === 'me') setTimeout(renderMe, 1500); break;
      case 'copy-invite': {
        const link = location.origin + location.pathname + '?api=' + encodeURIComponent(apiUrl()) + '&team=' + encodeURIComponent(S.me.key || '');
        const box = $('#inviteText');
        try { await navigator.clipboard.writeText(link); toast('Invite link copied'); }
        catch (err) { if (box) { box.hidden = false; box.value = link; box.select(); } toast('Copy the link from the box'); }
        break;
      }
      case 'reset': {
        if (removeArm.get('reset')) {
          await DB.clear();
          S.surveys.clear(); S.me = null; S.lastPull = ''; removeArm.delete('reset');
          go('');
        } else {
          removeArm.set('reset', true); actEl.textContent = 'Tap again to erase this phone';
          setTimeout(() => { removeArm.delete('reset'); if (actEl.isConnected) actEl.textContent = 'Reset this phone'; }, 4000);
        }
        break;
      }
      case 'swap-beams': {
        // same room outline, beams turn 90°: beam side and plank side swap
        if (!s || !S.cur.sel) break;
        const r = s.rooms.find((x) => x.id === S.cur.sel);
        const pl = s.layout.rooms[S.cur.sel];
        if (!r || !pl) break;
        const tmp = r.beamSide; r.beamSide = r.plankSide; r.plankSide = tmp;
        pl.rot = pl.rot ? 0 : 1;
        touch(s); renderPlan();
        toast('Beams now run ' + (pl.rot ? 'left–right' : 'top–bottom') + ' in ' + (r.name || 'this room'));
        break;
      }
      case 'rotate': {
        if (!s || !S.cur.sel) break;
        const pl = s.layout.rooms[S.cur.sel];
        if (pl) { pl.rot = pl.rot ? 0 : 1; touch(s); renderPlan(); }
        break;
      }
      case 'tidy': if (s) { tidyLayout(s); touch(s); renderPlan(); } break;
      case 'remove-room': {
        if (!s) break;
        const card = actEl.closest('.room');
        const rid = card.dataset.rid;
        if (removeArm.get(rid)) {
          s.rooms = s.rooms.filter((r) => r.id !== rid);
          delete s.layout.rooms[rid];
          touch(s);
          card.remove();
          refreshRoomWood(s);
          if (!s.rooms.length) $('#rooms').innerHTML = '<p class="muted">No rooms yet. Add the first one below.</p>';
        } else {
          removeArm.set(rid, true);
          actEl.textContent = 'Tap again';
          setTimeout(() => { removeArm.delete(rid); if (actEl.isConnected) actEl.textContent = 'Remove'; }, 3000);
        }
        break;
      }
      case 'delete-survey': {
        if (!s) break;
        if (removeArm.get('delete')) { removeArm.delete('delete'); deleteSurvey(s); }
        else {
          removeArm.set('delete', true); actEl.textContent = 'Tap again to delete it everywhere';
          setTimeout(() => { removeArm.delete('delete'); if (actEl.isConnected) actEl.textContent = 'Delete survey'; }, 4000);
        }
        break;
      }
      default: break;
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.card[data-open]')) { e.preventDefault(); e.target.click(); }
    if (e.key === 'Escape') closeSheet();
  });

  document.addEventListener('input', (e) => {
    const s = curSurvey();
    if (!s) return;
    const t = e.target;
    if (t.dataset.f) {
      s[t.dataset.f] = t.value;
      touch(s);
      if (t.dataset.f === 'family') { const h = $('#title'); if (h) h.textContent = t.value || 'New survey'; }
      return;
    }
    if (t.dataset.rf) {
      const card = t.closest('.room');
      const r = s.rooms.find((x) => x.id === card.dataset.rid);
      if (!r) return;
      const f = t.dataset.rf;
      if (f === 'roof') r.roof = t.checked;
      else if (f === 'beamSide' || f === 'plankSide') {
        r[f] = parseLen(t.value);
        t.classList.toggle('bad', t.value.trim() !== '' && !r[f]);
        if (measured(r)) ensureLayout(s);
      } else r[f] = t.value;
      touch(s);
      refreshRoomWood(s);
    }
  });
  document.addEventListener('change', async (e) => {
    const t = e.target;
    const s = curSurvey();
    if (t.dataset.rf === 'roof' || t.dataset.rf === 'grade' || t.dataset.f === 'status' || t.dataset.f === 'grade') {
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (t.matches('input[type="file"][data-paper]') && s) {
      const type = paperTypes(s)[Number(t.dataset.paper)];
      const files = Array.from(t.files || []);
      t.value = '';
      if (type && files.length) { toast('Saving photo…', 1500); await addPaperFiles(s, type.name, files); }
    }
  });
  document.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t.dataset && (t.dataset.rf === 'beamSide' || t.dataset.rf === 'plankSide')) {
      const v = parseLen(t.value);
      if (v) t.value = fmtM(v);
    }
  });

  window.addEventListener('resize', () => { if (currentView === 'editor' && S.cur && S.cur.step === 2 && !drag) renderPlan(); });

  /* ═════════════════════ Boot ═════════════════════ */
  function readInvite() {
    try {
      const q = new URLSearchParams(location.search);
      const api = q.get('api'), team = q.get('team');
      if (api || team) {
        S.invite = { api: api || '', team: team || '' };
        history.replaceState(null, '', location.pathname + location.hash);
      }
    } catch (e) { /* ignore */ }
  }

  function seedDemo() {
    const id = uid();
    const r = (name, beamSide, plankSide, color, roof) => ({ id: uid(), name, grade: 'B', roof: roof !== false, beamSide, plankSide, color });
    const rooms = [r('Bedroom 2', 4, 4.45, 0), r('Bedroom', 4, 4.8, 3), r('Courtyard', 3, 8.45, 5, false), r('Bathroom', 2, 2.85, 1), r('Kitchen', 3.45, 4, 2)];
    const L = {};
    L[rooms[0].id] = { x: 0, y: 0, rot: 1 };
    L[rooms[1].id] = { x: 0, y: 4.45, rot: 1 };
    L[rooms[2].id] = { x: 4, y: 0, rot: 1 };
    L[rooms[3].id] = { x: 7, y: 0, rot: 0 };
    L[rooms[4].id] = { x: 7, y: 2, rot: 0 };
    const s = {
      id, code: 'EXAMPLE', status: 'Draft', project: 'Roofing Wadi El Natron Team', area: 'Example village', researcher: 'Demo researcher', reviewer: '',
      date: today(), family: 'Example family', age: '', members: '6', grade: 'B+', nationalId: '', job: '', income: '', mobile: '', notes: 'Example survey to try the app.',
      rooms, layout: { rooms: L }, papers: [], createdAt: nowIso(), updatedAt: nowIso(), base: '', dirty: false, isNew: false
    };
    S.surveys.set(id, s);
    DB.put('surveys', s).catch(() => {});
  }

  function registerSW() {
    if (CFG.demo || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install not available */ });
  }

  async function boot() {
    await DB.init();
    try {
      S.me = (await DB.meta('me')) || null;
      const cfg = await DB.meta('config');
      if (cfg && cfg.rules) S.config = cfg;
      S.lastPull = (await DB.meta('lastPull')) || '';
      S.lastSyncAt = (await DB.meta('lastSyncAt')) || 0;
      S.pendingDeletes = (await DB.meta('pendingDeletes')) || [];
      (await DB.all('surveys')).forEach((s) => { if (!s.isNew) S.surveys.set(s.id, s); });
    } catch (e) { /* start empty */ }
    readInvite();
    if (S.invite && S.me) {
      S.me = Object.assign({}, S.me, S.invite.api ? { api: S.invite.api } : {}, S.invite.team ? { key: S.invite.team } : {});
      DB.setMeta('me', S.me).catch(() => {});
      S.invite = null;
      toast('Connected to the team sheet');
    }
    if (CFG.demo && !S.me) {
      S.me = { name: 'Demo researcher', key: '', api: '', deviceId: uid() };
      DB.setMeta('me', S.me).catch(() => {});
      if (!S.surveys.size) seedDemo();
    }
    window.addEventListener('hashchange', route);
    window.addEventListener('online', () => { S.sync.state = 'idle'; updateSyncPill(); scheduleSync(400); });
    window.addEventListener('offline', () => { S.sync.state = 'offline'; updateSyncPill(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(800); else flushLocal(); });
    window.addEventListener('pagehide', flushLocal);
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installPrompt = e; if (currentView === 'welcome' || currentView === 'list') route(); });
    window.addEventListener('appinstalled', () => { S.installPrompt = null; toast('Installed. Open Shelter from your home screen.'); });
    setInterval(() => {
      // upload quickly when something is waiting; otherwise check the sheet every 5 minutes
      if (navigator.onLine !== false && (pendingCount() > 0 || Date.now() - S.lastSyncAt > 300000)) syncNow();
    }, 30000);
    registerSW();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
    route();
    scheduleSync(700);
  }

  // expose a tiny surface for testing
  window.ShelterApp = { calcWood, parseLen, state: S, buildPdf, buildPptx, DB };

  boot();
})();
