// 1.7 accounts — sign-up, log-in, sessions, lock-out, forgot password (email + manager code), old phones, merge.
const { makeEnv } = require('./mock-gas.js');
const assert = require('assert');
const crypto = require('crypto');
const env = makeEnv(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'));
const C = env.ctx;
const raw = (o) => JSON.parse(C.doPost({ postData: { contents: JSON.stringify(o) } }).content);
const users = () => env.sheets.get('Users').rows;
const col = (n) => users()[0].indexOf(n);
const rowOf = (id) => users().find((r) => r[col('User ID')] === id);
const loginJson = (id) => JSON.parse(rowOf(id)[col('Log-in (app use – do not edit)')] || '{}');
const tab = (name) => { const rows = env.sheets.get(name).rows, h = rows[0]; return rows.slice(1).map((x) => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
const setting = (k, v) => { const row = env.sheets.get('Settings').rows.find((r) => r[0] === k); if (v !== undefined) row[1] = v; return row[1]; };
// what the phone sends: PBKDF2 happens in the browser; here any 64 hex characters stand in for it
const pw = (s) => crypto.createHash('sha256').update('pw:' + s).digest('hex');
const as = (who, o) => raw(Object.assign({ uid: who.id, token: who.token, deviceName: who.device || 'Android phone', v: '1.7.0' }, o));
const clearLocks = () => { C.CacheService.getScriptCache().put('n_badkey', '0'); };

C.setup();
setting('Team code', 'Shelter-2027');
const begadCode = users()[1][col('Code')];
assert.ok(/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(begadCode), 'first-time admin code');
assert.ok(env.props.LOGIN_PEPPER && env.props.LOGIN_PEPPER.length === 64, 'secret pepper in Script Properties');
assert.ok(!JSON.stringify(env.sheets.get('Settings').rows).includes(env.props.LOGIN_PEPPER), 'pepper not in the sheet');

// ── admin: first-time code → choose username + password (once)
let r = raw({ key: begadCode, action: 'ping' });
assert.ok(r.ok && r.me.role === 'Admin' && r.me.hasLogin === false && r.me.username === '', JSON.stringify(r.me));
r = raw({ key: begadCode, action: 'setLogin', username: 'Begad', pass: pw('begad pass 1'), email: 'begad@example.org', deviceName: 'Begad PC' });
assert.ok(r.ok && r.me.token && r.me.username === 'begad' && r.me.hasLogin, JSON.stringify(r));
const B = { id: r.me.id, token: r.me.token };
assert.equal(raw({ key: begadCode, action: 'ping' }).error, 'bad_key', 'the first-time code works only until a password is set');
assert.equal(rowOf(B.id)[col('Code')], '', 'code cleared in the sheet');
r = as(B, { action: 'ping' });
assert.ok(r.ok && r.me.role === 'Admin' && r.me.hasLogin && r.me.email === 'begad@example.org');
assert.equal(as(B, { action: 'setLogin', username: 'other', pass: pw('x') }).error, 'already');

// ── what is stored: no password, no session key, no reset code in the clear
const lj = loginJson(B.id);
assert.ok(lj.s && lj.h && lj.sessions.length === 1, JSON.stringify(lj));
const rowText = JSON.stringify(rowOf(B.id));
assert.ok(!rowText.includes(pw('begad pass 1')) && !rowText.includes(B.token), 'only hashes in the sheet');
assert.notEqual(lj.h, crypto.createHash('sha256').update(lj.s + ':' + pw('begad pass 1')).digest('base64'), 'not a plain hash: keyed with the pepper');

// ── sign-up with the team code
const signup = (o) => raw(Object.assign({ action: 'signup', teamCode: 'shelter 2027', pass: pw('pass-' + o.username), deviceName: 'Android phone' }, o));
assert.equal(signup({ teamCode: 'nope', name: 'Ahmed', username: 'ahmed' }).error, 'bad_key', 'team code needed');
assert.equal(signup({ name: 'Ahmed', username: 'ab' }).error, 'bad_username');
assert.equal(signup({ name: 'Ahmed', username: 'أحمد' }).error, 'bad_username', 'English letters only');
assert.equal(signup({ name: 'Ahmed', username: 'ahmed', email: 'not-an-email' }).error, 'bad_email');
assert.equal(signup({ name: 'Ahmed', username: 'ahmed', pass: 'plain password' }).error, 'bad_request', 'only the stretched password is accepted');
assert.equal(signup({ name: 'A', username: 'ahmed' }).error, 'bad_request', 'a real name');
r = signup({ name: 'Ahmed Saad', username: 'Ahmed.S', email: 'ahmed@example.org' });
assert.ok(r.ok && r.me.role === 'Researcher' && r.me.username === 'ahmed.s' && r.me.token, JSON.stringify(r));
const A = { id: r.me.id, token: r.me.token };
assert.equal(signup({ name: 'Other Ahmed', username: 'AHMED.s' }).error, 'username_taken', 'usernames are unique, any capitals');
assert.ok(as(A, { action: 'pull', since: '' }).ok, 'a new account works at once');
assert.ok(tab('History').some((h) => h.Action === 'Joined' && /New account "ahmed.s"/.test(h.Changes)));

// ── log in, several phones, log out
const login = (username, pass, device) => raw({ action: 'login', username, pass, deviceName: device || 'Phone 2' });
r = login('ahmed.s', pw('pass-wrong'));
assert.equal(r.error, 'wrong_login');
assert.equal(login('nobody', pw('x')).message, r.message, 'unknown usernames get the same answer');
r = login(' Ahmed.S ', pw('pass-Ahmed.S'), 'Ahmed tablet');
assert.ok(r.ok && r.me.id === A.id && r.me.token !== A.token, 'same account on a second phone: ' + JSON.stringify(r));
const A2 = { id: A.id, token: r.me.token };
assert.ok(as(A, { action: 'ping' }).ok && as(A2, { action: 'ping' }).ok, 'both phones work');
assert.ok(as(A2, { action: 'logout' }).ok);
assert.equal(as(A2, { action: 'ping' }).error, 'need_login', 'logged out phone');
assert.ok(as(A, { action: 'ping' }).ok, 'the other phone still works');
assert.equal(as({ id: A.id, token: 'f'.repeat(48) }, { action: 'ping' }).error, 'need_login', 'a made-up key');
assert.equal(as({ id: B.id, token: A.token }, { action: 'ping' }).error, 'need_login', 'someone else\'s key');
for (let i = 0; i < 12; i++) login('ahmed.s', pw('pass-Ahmed.S'), 'phone ' + i);
assert.equal(loginJson(A.id).sessions.length, 10, 'at most 10 phones; the oldest drop off');
assert.equal(as(A, { action: 'ping' }).error, 'need_login', 'the oldest phone was logged out');
r = login('ahmed.s', pw('pass-Ahmed.S'), 'Ahmed phone');
const A3 = { id: A.id, token: r.me.token };

// ── 5 wrong passwords lock the username for 15 minutes, even with the right one after
signup({ name: 'Locky', username: 'locky' });
for (let i = 0; i < 5; i++) assert.equal(login('locky', pw('guess' + i)).error, 'wrong_login');
assert.equal(login('locky', pw('pass-locky')).error, 'locked');
assert.ok(login('ahmed.s', pw('pass-Ahmed.S')).ok, 'other usernames are not locked');
clearLocks();

// ── change password: the other phones log out
r = login('ahmed.s', pw('pass-Ahmed.S'), 'Ahmed other');
const A4 = { id: A.id, token: r.me.token };
assert.equal(as(A3, { action: 'changePassword', oldPass: pw('wrong'), pass: pw('new ahmed') }).error, 'wrong_login');
assert.ok(as(A3, { action: 'changePassword', oldPass: pw('pass-Ahmed.S'), pass: pw('new ahmed') }).ok);
assert.ok(as(A3, { action: 'ping' }).ok, 'this phone stays in');
assert.equal(as(A4, { action: 'ping' }).error, 'need_login', 'other phones are logged out');
assert.equal(login('ahmed.s', pw('pass-Ahmed.S')).error, 'wrong_login', 'old password gone');
assert.ok(login('ahmed.s', pw('new ahmed')).ok, 'new password works');
clearLocks();

// ── forgot password, by email
const mailsBefore = env.mails.length;
r = raw({ action: 'resetRequest', username: 'ahmed.s' });
assert.ok(r.ok && /If this username has an email/.test(r.message));
assert.equal(env.mails.length, mailsBefore + 1, 'one email');
const mail = env.mails[env.mails.length - 1];
assert.equal(mail.to, 'ahmed@example.org');
const code = (mail.subject.match(/(\d{6})/) || [])[1];
assert.ok(code && mail.body.includes(code) && mail.body.includes('ahmed.s'), mail.subject);
assert.ok(!JSON.stringify(rowOf(A.id)).includes(code), 'the code is kept only as a hash');
assert.deepEqual(raw({ action: 'resetRequest', username: 'nobody' }), r, 'same answer for unknown usernames');
assert.deepEqual(raw({ action: 'resetRequest', username: 'locky' }), r, 'same answer without an email');
assert.equal(env.mails.length, mailsBefore + 1, 'no email for them');
const wrongCode = String((Number(code) + 1) % 1000000).padStart(6, '0');
const reset = (username, c, pass, device) => raw({ action: 'resetPassword', username, code: c, pass, deviceName: device || 'New phone' });
assert.equal(reset('ahmed.s', wrongCode, pw('after reset')).error, 'bad_code');
r = reset('ahmed.s', code, pw('after reset'));
assert.ok(r.ok && r.me.id === A.id && r.me.token, JSON.stringify(r));
const A5 = { id: A.id, token: r.me.token };
assert.equal(as(A3, { action: 'ping' }).error, 'need_login', 'a reset logs out every other phone');
assert.ok(as(A5, { action: 'ping' }).ok);
assert.equal(reset('ahmed.s', code, pw('again')).error, 'bad_code', 'a code works once');
assert.ok(login('ahmed.s', pw('after reset')).ok);
assert.ok(tab('History').some((h) => /New password with a code \(by email\)/.test(h.Changes)));
// five wrong tries end a code; codes expire
raw({ action: 'resetRequest', username: 'ahmed.s' });
const code2 = env.mails[env.mails.length - 1].subject.match(/(\d{6})/)[1];
for (let i = 0; i < 5; i++) reset('ahmed.s', String((Number(code2) + 1 + i) % 1000000).padStart(6, '0'), pw('x'));
assert.equal(reset('ahmed.s', code2, pw('x')).error, 'bad_code', 'dead after 5 wrong tries');
raw({ action: 'resetRequest', username: 'ahmed.s' });
assert.equal(raw({ action: 'resetRequest', username: 'ahmed.s' }).ok, true);
const n3 = env.mails.length;
raw({ action: 'resetRequest', username: 'ahmed.s' });
assert.equal(env.mails.length, n3, 'at most 3 emails an hour per username');

// ── a manager makes a one-time code (WhatsApp); limits by role
const mona = signup({ name: 'Mona', username: 'mona' }).me;
const M = { id: mona.id, token: mona.token };
assert.ok(as(B, { action: 'saveUser', user: { id: M.id, role: 'Manager' } }).ok);
const sara = signup({ name: 'Sara', username: 'sara' }).me;
assert.ok(as(B, { action: 'saveUser', user: { id: sara.id, role: 'Team leader' } }).ok);
assert.equal(as(A5, { action: 'issueReset', id: sara.id }).error, 'not_allowed', 'researchers can\'t');
r = as(M, { action: 'issueReset', id: A.id });
assert.ok(r.ok && /^\d{6}$/.test(r.code) && r.username === 'ahmed.s' && r.hours === 24, JSON.stringify(r));
assert.ok(r.users.every((u) => u.email === undefined), 'managers don\'t see emails');
assert.ok(reset('ahmed.s', r.code, pw('from mona')).ok, 'the manager\'s code works');
assert.ok(tab('History').some((h) => /New password with a code \(from Mona\)/.test(h.Changes)));
assert.ok(as(M, { action: 'issueReset', id: sara.id }).ok, 'team leaders too');
assert.equal(as(M, { action: 'issueReset', id: B.id }).error, 'not_allowed', 'not for admins');
assert.equal(as(M, { action: 'issueReset', id: M.id }).error, 'not_allowed', 'not for yourself');
assert.ok(as(B, { action: 'issueReset', id: M.id }).ok, 'admins can for managers');

// ── phones from before 1.7: the old phone key keeps working until they set a username
const old = raw({ key: 'Shelter-2027', action: 'ping', name: 'Omar', deviceName: 'Old phone', v: '1.6.1' });
assert.ok(old.ok && old.me.token && old.me.hasLogin === false, 'an old app can still join: ' + JSON.stringify(old.me));
const O = { id: old.me.id, token: old.me.token };
assert.ok(raw({ key: 'Shelter-2027', uid: O.id, token: O.token, action: 'pull', since: '' }).ok, 'old app with its phone key');
assert.ok(as(O, { action: 'saveSurvey', survey: { id: 'srvomar001', family: 'Omar house', rooms: [] } }).ok);
assert.equal(as(O, { action: 'setLogin', username: 'mona', pass: pw('o') }).error, 'username_taken');
r = as(O, { action: 'setLogin', username: 'omar', pass: pw('omar pass'), email: '' });
assert.ok(r.ok && r.me.token === O.token && r.me.hasLogin, 'same account, same phone key: ' + JSON.stringify(r));
assert.equal(rowOf(O.id)[col('Phone key (app use – do not edit)')], '', 'old key moved into the hashed sessions');
assert.ok(raw({ key: 'Shelter-2027', uid: O.id, token: O.token, action: 'ping' }).ok, 'a not-yet-updated app on that phone keeps working');
r = login('omar', pw('omar pass'), 'Omar new phone');
assert.ok(r.ok && r.me.id === O.id, 'and Omar can log in on any phone now');
assert.equal(raw({ key: 'Shelter-2027', action: 'ping', name: 'Omar', uid: O.id, token: 'bad' }).error, 'need_login', 'no new entry from a phone that had one');
// someone from before 1.7 who never set a username: a manager's code gives them one
const old2 = raw({ key: 'Shelter-2027', action: 'ping', name: 'Hany', deviceName: 'Old phone 2' });
assert.equal(as(M, { action: 'issueReset', id: old2.me.id }).error, 'bad_username', 'needs a username');
r = as(M, { action: 'issueReset', id: old2.me.id, username: 'hany' });
assert.ok(r.ok && r.username === 'hany');
r = reset('hany', r.code, pw('hany pass'));
assert.ok(r.ok && r.me.id === old2.me.id && r.me.hasLogin);
assert.equal(as({ id: old2.me.id, token: old2.me.token }, { action: 'ping' }).error, 'need_login', 'the lost phone\'s old key stops working');

// ── switched off and waiting
assert.ok(as(B, { action: 'saveUser', user: { id: sara.id, active: false } }).ok);
assert.equal(login('sara', pw('pass-sara')).error, 'blocked', 'switched off: told only after the right password');
assert.equal(login('sara', pw('nope')).error, 'wrong_login');
clearLocks();
setting('New people need approval', 'Yes');
r = signup({ name: 'Wait Person', username: 'waity' });
assert.equal(r.me.role, 'Waiting');
assert.equal(as({ id: r.me.id, token: r.me.token }, { action: 'pull' }).error, 'pending');
assert.equal(login('waity', pw('pass-waity')).me.role, 'Waiting');
setting('New people need approval', 'No');

// ── merge: Tarek logged in twice (an old account with his day and photo, and a new one)
const tOld = raw({ key: 'Shelter-2027', action: 'ping', name: 'Tarek', deviceName: 'Tarek old phone' }).me;
const TO = { id: tOld.id, token: tOld.token };
assert.ok(as(B, { action: 'saveUser', user: { id: TO.id, role: 'Team leader' } }).ok);
const loc = { lat: 30.6, lng: 32.2, acc: 5, at: '2026-11-01T00:00:00Z' };
assert.ok(as(TO, { action: 'saveSurvey', survey: { id: 'srvtarek01', family: 'Tarek house', rooms: [], location: loc, status: 'Submitted' } }).ok);
assert.ok(as(B, { action: 'saveSurvey', survey: { id: 'srvtarek01', family: 'Tarek house', rooms: [], location: loc, status: 'Approved' } }).ok);
const day = as(B, { action: 'saveTask', task: { name: 'Day T', date: '2026-11-20', leaderId: TO.id, surveyIds: ['srvtarek01'], houseLeaders: { srvtarek01: TO.id } } });
assert.ok(day.ok, JSON.stringify(day));
assert.ok(as(TO, { action: 'setHouseState', surveyId: 'srvtarek01', state: 'Roofed' }).ok);
const small = () => '/9j/' + 'A'.repeat(200);
assert.ok(as(TO, { action: 'addPhoto', kind: 'team', image: small() }).ok);
const tNew = signup({ name: 'Tarek Ali', username: 'tarek' }).me;
const TN = { id: tNew.id, token: tNew.token };
assert.equal(as(M, { action: 'mergeUser', from: TO.id, into: TN.id }).error, 'not_allowed', 'admins only');
assert.equal(as(B, { action: 'mergeUser', from: B.id, into: TN.id }).error, 'not_allowed', 'not your own account away');
assert.equal(as(B, { action: 'mergeUser', from: TN.id, into: TN.id }).error, 'bad_request');
r = as(B, { action: 'mergeUser', from: TO.id, into: TN.id });
assert.ok(r.ok && r.moved.surveys === 1 && r.moved.days === 1 && r.moved.photos === 1, JSON.stringify(r));
const sv = as(B, { action: 'pull', since: '' }).surveys.find((s) => s.id === 'srvtarek01');
assert.ok(sv.createdById === TN.id && sv.leaderId === TN.id && sv.teamId === TN.id && sv.researcher === 'Tarek Ali', JSON.stringify(sv));
assert.equal(tab('Surveys').find((s) => s['Survey ID'] === 'srvtarek01')['Team leader'], 'Tarek Ali');
const t1 = as(B, { action: 'pull', since: '' }).tasks.find((t) => t.id === day.task.id);
assert.ok(t1.leaderId === TN.id && (t1.houseLeaders.srvtarek01 || t1.leaderId) === TN.id, JSON.stringify(t1));
assert.equal(tab('Photos').find((p) => p.Kind === 'team')['Team ID'], TN.id);
r = as(TO, { action: 'ping' });
assert.ok(r.ok && r.me.id === TN.id && r.me.role === 'Team leader' && r.me.username === 'tarek', 'the old phone now works as the merged account, higher role kept: ' + JSON.stringify(r.me));
assert.ok(as({ id: TN.id, token: TO.token }, { action: 'ping' }).ok, 'and keeps working once it uses the new id');
assert.ok(!as(B, { action: 'ping' }).users.some((u) => u.id === TO.id), 'the old entry is hidden from Users');
assert.equal(rowOf(TO.id)[col('Active')], 'No');
assert.ok(tab('History').some((h) => h.Action === 'Users merged' && /1 survey\(s\), 1 day\(s\), 1 photo\(s\)/.test(h.Changes)));
assert.equal(as(B, { action: 'mergeUser', from: TO.id, into: TN.id }).error, 'not_found', 'merged once');

// ── nothing secret leaves the sheet
const everything = JSON.stringify(as(B, { action: 'pull', since: '' }));
['Log-in (app use', 'Phone key', users()[2][col('Code')], env.props.LOGIN_PEPPER].forEach((x) => assert.ok(!everything.includes(x), 'leaked: ' + x));
users().slice(1).forEach((row) => { const j = row[col('Log-in (app use – do not edit)')]; if (j) assert.ok(!/[0-9a-f]{64}/.test(j), 'no raw passwords: ' + j.slice(0, 80)); });
assert.ok(as(B, { action: 'ping' }).users.find((u) => u.id === A.id).email === 'ahmed@example.org', 'admins see emails');
const A6 = { id: A.id, token: login('ahmed.s', pw('from mona')).me.token };
assert.ok(as(A6, { action: 'saveMe', email: 'new@example.org' }).ok && as(A6, { action: 'ping' }).me.email === 'new@example.org');
assert.equal(as(A6, { action: 'saveMe', email: 'nope' }).error, 'bad_email');

console.log('auth tests passed · users ' + (users().length - 1) + ' · emails ' + env.mails.length);
