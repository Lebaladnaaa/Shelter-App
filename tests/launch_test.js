// 1.8 launch changes — beams +30 cm / over 6 m blocks submit, private drafts, room notes, doors & windows,
// house entrance, start fresh (keep admins), data reset marker, account key for a new sheet.
const { makeEnv } = require('./mock-gas.js');
const assert = require('assert');
const crypto = require('crypto');
const env = makeEnv(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'));
const C = env.ctx;
const raw = (o) => JSON.parse(C.doPost({ postData: { contents: JSON.stringify(o) } }).content);
const tab = (name) => { const rows = env.sheets.get(name).rows, h = rows[0]; return rows.slice(1).map((x) => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
const setting = (k, v) => { const row = env.sheets.get('Settings').rows.find((r) => r[0] === k); if (v !== undefined) row[1] = v; return row && row[1]; };
const pw = (s) => crypto.createHash('sha256').update(s).digest('hex');
const as = (who, o) => raw(Object.assign({ uid: who.id, token: who.token, deviceName: 'Phone', v: '1.8.0' }, o));

C.setup();
setting('Team code', 'Shelter-2027');
assert.equal(setting('Add for beams (cm)'), 30, 'new setting');
const users0 = env.sheets.get('Users').rows, codeCol = users0[0].indexOf('Code');
const begad = raw({ key: users0[1][codeCol], action: 'setLogin', username: 'begad', pass: pw('b') }).me;
const hawary = raw({ key: users0[2][codeCol], action: 'setLogin', username: 'hawary', pass: pw('h') }).me;
const B = { id: begad.id, token: begad.token }, H = { id: hawary.id, token: hawary.token };
const signup = (name, username) => { const r = raw({ action: 'signup', teamCode: 'Shelter-2027', name, username, pass: pw(username) }); return { id: r.me.id, token: r.me.token }; };
const A = signup('Ahmed', 'ahmed'), M = signup('Mona', 'mona');
assert.ok(as(B, { action: 'saveUser', user: { id: M.id, role: 'Manager' } }).ok);
const loc = { lat: 30.6, lng: 32.2, acc: 5, at: '2026-11-22T08:00:00Z' };
const save = (who, s) => as(who, { action: 'saveSurvey', survey: s });

// ── beams: side + 30 cm; over 6 m can't be submitted
const cfg = as(A, { action: 'ping' }).config;
assert.equal(cfg.rules.beamAllowance, 30, 'the phones get the beam allowance');
assert.ok(cfg.dataEpoch, 'and the data marker');
let r = save(A, { id: 'srvwood001', family: 'Long beam', location: loc, status: 'Submitted',
  rooms: [{ id: 'r1', name: 'Hall', roof: true, beamSide: 5.8, plankSide: 3 }] });
assert.ok(r.ok && r.status === 'Draft' && r.needWood === true, 'invalid beam: kept as Draft ' + JSON.stringify(r));
let room = tab('Rooms').find((x) => x['Survey ID'] === 'srvwood001');
assert.ok(/INVALID/.test(room['Wood note']) && room['Beam length (cm)'] === '', JSON.stringify(room));
assert.equal(save(M, { id: 'srvwood002', family: 'Manager too', location: loc, status: 'Approved', rooms: [{ id: 'r1', name: 'Hall', roof: true, beamSide: 6.1, plankSide: 3 }] }).status, 'Draft', 'managers can\'t approve it either');
r = save(A, { id: 'srvwood001', family: 'Long beam', location: loc, status: 'Submitted', rooms: [{ id: 'r1', name: 'Hall', roof: true, beamSide: 3, plankSide: 5.8 }] });
assert.ok(r.ok && r.status === 'Submitted' && !r.needWood, 'swapped to the plank side: goes through');
room = tab('Rooms').find((x) => x['Survey ID'] === 'srvwood001');
assert.equal(room['Beam length (cm)'], 330, '3 + 0.30 → 330'); assert.equal(room['Plank length (cm)'], 600, '5.8 + 0.10 → 600');

// ── room notes, doors and windows per wall, one entrance
r = save(A, { id: 'srvwall001', family: 'Walls', location: loc, rooms: [
  { id: 'r1', name: 'Hall', roof: true, beamSide: 3, plankSide: 4, notes: 'Crack in the left wall', walls: { b: 'entrance', r: 'window', t: 'both', l: 'bogus' } },
  { id: 'r2', name: 'Kitchen', roof: true, beamSide: 2.5, plankSide: 3, notes: '', walls: { l: 'entrance', t: 'door' } }] });
assert.ok(r.ok);
const sv = as(A, { action: 'pull', since: '' }).surveys.find((x) => x.id === 'srvwall001');
assert.deepEqual(sv.rooms[0].walls, { t: 'both', r: 'window', b: 'entrance' }, 'unknown values dropped');
assert.equal(sv.rooms[1].walls.l, 'door', 'only one house entrance: a second one becomes a door');
assert.equal(sv.rooms[0].notes, 'Crack in the left wall');
const rooms = tab('Rooms').filter((x) => x['Survey ID'] === 'srvwall001');
assert.equal(rooms[0]['Doors'], 'top, bottom (entrance)'); assert.equal(rooms[0]['Windows'], 'top, right'); assert.equal(rooms[0]['Room notes'], 'Crack in the left wall');
assert.equal(rooms[1]['Doors'], 'top, left');
assert.equal(tab('Surveys').find((x) => x['Survey ID'] === 'srvwall001')['Entrance'], 'Hall – bottom wall');
save(A, { id: 'srvwall001', family: 'Walls', location: loc, rooms: [
  { id: 'r1', name: 'Hall', roof: true, beamSide: 3, plankSide: 4, notes: 'Crack fixed', walls: { b: 'entrance' } },
  { id: 'r2', name: 'Kitchen', roof: true, beamSide: 2.5, plankSide: 3, walls: { t: 'door' } }] });
assert.ok(tab('History').some((h) => /Hall: notes changed, doors\/windows changed/.test(h.Changes)), 'History shows it');

// ── drafts: only their maker sees them, even admins don't
assert.ok(as(A, { action: 'pull', since: '' }).surveys.some((x) => x.id === 'srvwall001'), 'the maker sees the draft');
assert.ok(!as(B, { action: 'pull', since: '' }).surveys.some((x) => x.id === 'srvwall001'), 'admins don\'t');
assert.ok(!as(M, { action: 'pull', since: '' }).surveys.some((x) => x.id === 'srvwall001'), 'managers don\'t');
assert.ok(as(M, { action: 'pull', since: '' }).surveys.some((x) => x.id === 'srvwood001'), 'submitted ones are seen');
assert.ok(!as(M, { action: 'recentChanges' }).changes.some((c) => c.surveyId === 'srvwall001'), 'nor in recent changes');
// it went back to Draft: other phones remove their copy at the next sync
const since = as(M, { action: 'pull', since: '' }).serverTime;
assert.ok(save(A, { id: 'srvwood001', family: 'Long beam', location: loc, status: 'Draft', rooms: [{ id: 'r1', name: 'Hall', roof: true, beamSide: 3, plankSide: 5.8 }] }).ok);
const inc = as(M, { action: 'pull', since });
assert.ok(!inc.surveys.some((x) => x.id === 'srvwood001') && inc.deleted.some((d) => d.id === 'srvwood001' && d.hidden), 'sent as removed: ' + JSON.stringify(inc.deleted));
assert.ok(as(A, { action: 'pull', since }).surveys.some((x) => x.id === 'srvwood001'), 'still there for its maker');

// ── start fresh: everything goes, the admins stay logged in, phones get a new marker
save(A, { id: 'srvkeep001', family: 'Submitted', location: loc, status: 'Submitted', rooms: [{ id: 'r1', name: 'Hall', roof: true, beamSide: 3, plankSide: 4 }] });
const epoch1 = cfg.dataEpoch;
const res = C.startFresh_(false);
assert.ok(res.surveys >= 4 && res.kept === 2 && res.users === 2, JSON.stringify(res));
['Surveys', 'Rooms', 'Drawings', 'Papers', 'Implementation days', 'Photos', 'Deleted'].forEach((t) => assert.equal(env.sheets.get(t).rows.length, 1, t + ' emptied'));
assert.deepEqual(tab('History').map((h) => h.Action), ['Started fresh'], 'History starts again with that one line');
assert.deepEqual(tab('Users').map((u) => u.Name).sort(), ['Begad', 'Hawary']);
assert.ok(as(B, { action: 'ping' }).ok && as(H, { action: 'ping' }).ok, 'the admins stay logged in');
assert.equal(as(A, { action: 'ping' }).error, 'need_login', 'others are gone');
const epoch2 = as(B, { action: 'ping' }).config.dataEpoch;
assert.ok(epoch2 && epoch2 !== epoch1, 'new data marker: phones clear their copy');
assert.equal(as(B, { action: 'saveSurvey', survey: { id: 'srvnew0001', family: 'First real' } }).code, 'SH-0001', 'codes start again');
assert.equal(setting('Team code'), 'Shelter-2027', 'settings stay');
// keeping everyone
const K = signup('Karim', 'karim');
C.startFresh_(true);
assert.ok(as(K, { action: 'ping' }).ok, 'keep all accounts: still logged in');

// ── moving to a new sheet: same Users tab + the same account key = same accounts and log-ins
const env2 = makeEnv(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'));
env.sheets.forEach((sh, name) => { const n = env2.ctx.SpreadsheetApp.getActiveSpreadsheet().insertSheet(name); n.rows = sh.rows.map((x) => x.slice()); }); // File → Make a copy
env2.ctx.setup();
const raw2 = (o) => JSON.parse(env2.ctx.doPost({ postData: { contents: JSON.stringify(o) } }).content);
assert.equal(raw2({ uid: B.id, token: B.token, action: 'ping' }).error, 'need_login', 'without the key, log-ins don\'t match');
env2.props.LOGIN_PEPPER = env.props.LOGIN_PEPPER; // Shelter → Set the account key
assert.ok(raw2({ uid: B.id, token: B.token, action: 'ping' }).ok, 'with it, phones stay logged in');
assert.ok(raw2({ action: 'login', username: 'karim', pass: pw('karim') }).ok, 'and passwords work');

console.log('launch tests passed');
