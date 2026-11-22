const { makeEnv } = require('./mock-gas.js');
const assert = require('assert');
const env = makeEnv(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'));
const C = env.ctx;
C.setup();
C.setup(); // running twice must not duplicate settings
const settings = env.sheets.get('Settings').rows;
assert.equal(settings.filter(r => r[0] === 'Team code').length, 1, 'team code once');
const key = env.sheets.get('Users').rows[1][env.sheets.get('Users').rows[0].indexOf('Code')]; // Begad (admin)
const call = (o) => JSON.parse(C.doPost({ postData: { contents: JSON.stringify(o) } }).content);

assert.equal(call({ action: 'ping', key: 'nope' }).error, 'bad_key');
const ping = call({ action: 'ping', key });
assert.ok(ping.ok && ping.config.rules.beam.length === 14 && ping.config.rules.beam[0] === 210 && ping.config.rules.beam[13] === 600 && ping.config.rules.example === false && ping.config.rules.allowance === 10, 'ping config ' + JSON.stringify(ping.config.rules));
assert.equal(ping.config.papers.length, 3);

const rooms = [
  { id: 'r1', name: 'Kitchen', roof: true, beamSide: 3.45, plankSide: 4, color: 2 },
  { id: 'r2', name: 'Bathroom', roof: true, beamSide: 2, plankSide: 2.85, color: 1 },
  { id: 'r3', name: 'Bedroom', roof: true, beamSide: 4, plankSide: 4.8, color: 3 },
  { id: 'r4', name: 'Courtyard', roof: false, beamSide: null, plankSide: null, color: 5 }
];
const survey = { id: 'abc12345', status: 'Draft', family: 'ناجح علي', area: 'عزبة', mobile: '01120395627', nationalId: '26504132501234', rooms };
let r = call({ action: 'saveSurvey', key, by: 'Osama', survey, layout: { rooms: { r1: { x: 0, y: 0, rot: 0 } } } });
assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.code, 'SH-0001');
const s2 = call({ action: 'saveSurvey', key, by: 'Mona', survey: { id: 'def67890', family: 'B', rooms: [] } });
assert.equal(s2.code, 'SH-0002');

const sv = env.sheets.get('Surveys').rows; const h = sv[0];
const row = sv[1];
const col = (n) => row[h.indexOf(n)];
assert.equal(col('Beams to buy (cm × pcs)'), '240 × 5, 390 × 7, 450 × 8', 'beams text: ' + col('Beams to buy (cm × pcs)'));
assert.equal(col('Planks to buy (cm × pcs)'), '300 × 20, 420 × 35, 510 × 40', 'planks: ' + col('Planks to buy (cm × pcs)'));
assert.equal(col('Mobile'), '01120395627');
const roomRows = env.sheets.get('Rooms').rows.filter(x => x[0] === 'abc12345');
assert.equal(roomRows.length, 4);
const kitchen = roomRows.find(x => x[4] === 'Kitchen');
const rh = env.sheets.get('Rooms').rows[0];
assert.equal(kitchen[rh.indexOf('Beam length (cm)')], 390); assert.equal(kitchen[rh.indexOf('Beams (pcs)')], 7);
assert.equal(kitchen[rh.indexOf('Plank length (cm)')], 420); assert.equal(kitchen[rh.indexOf('Planks (pcs)')], 35);

// update with fewer rooms → Rooms tab rows replaced
r = call({ action: 'saveSurvey', key, by: 'Osama', survey: Object.assign({}, survey, { rooms: rooms.slice(0, 2) }), base: r.updatedAt });
assert.equal(env.sheets.get('Rooms').rows.filter(x => x[0] === 'abc12345').length, 2);
assert.equal(env.sheets.get('Surveys').getLastRow ? 0 : 0, 0);
assert.equal(env.sheets.get('Surveys').rows.length, 3, 'no duplicate survey rows');
assert.equal(env.sheets.get('Drawings').rows.length, 2, 'drawing rows');

// upload
const up = call({ action: 'uploadFile', key, by: 'Osama', surveyId: 'abc12345', fileId: 'file000001', paper: 'National ID – front', mime: 'image/jpeg', data: Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from('hello world, a photo')]).toString('base64') });
assert.ok(up.ok, JSON.stringify(up));
const dup = call({ action: 'uploadFile', key, surveyId: 'abc12345', fileId: 'file000001', paper: 'x', mime: 'image/jpeg', data: '/9j/4AcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw==' });
assert.ok(dup.duplicate, 'duplicate upload detected');
assert.equal(env.files.length, 1);
assert.equal(call({ action: 'uploadFile', key, surveyId: 'zzzzzzzzz', fileId: 'file000002', data: '/9j/4AcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBw==' }).error, 'survey_missing');

// pull
let p = call({ action: 'pull', key, since: '' });
assert.equal(p.surveys.length, 2);
const ps = p.surveys.find(x => x.id === 'abc12345');
assert.equal(ps.papers.length, 1); assert.equal(ps.layout.rooms.r1.x, 0); assert.equal(ps.code, 'SH-0001');
assert.equal(ps.rooms.length, 2);
const since = p.serverTime;
p = call({ action: 'pull', key, since });
assert.ok(p.surveys.length <= 2, 'pull since');

// lead edits status in the sheet → kept when phone saves with old base
const sheet = env.sheets.get('Surveys');
const statusCol = h.indexOf('Status') + 1;
sheet.rows[1][statusCol - 1] = 'Approved';
C.onEdit({ range: sheet.getRange(2, statusCol) });
assert.equal(sheet.rows[1][h.indexOf('Updated by')], 'Sheet edit');
r = call({ action: 'saveSurvey', key, by: 'Osama', survey: Object.assign({}, survey, { status: 'Submitted' }), base: '2000-01-01' });
assert.equal(r.status, 'Approved', 'lead status kept');
p = call({ action: 'pull', key, since });
assert.equal(p.surveys.length, 1);

// your own rules: change Wood rules then recalc
const rules = env.sheets.get('Wood rules');
rules.rows = [['Wood', 'Room side up to (m)', 'Buy length (cm)', 'Note'], ['Beam', 3.5, 400, ''], ['Beam', 5, 500, ''], ['Plank', 5, 5, '']]; // older layout still read; 5 → metres → 500 cm
C.recalculateWood();
const row2 = env.sheets.get('Surveys').rows[1];
assert.equal(row2[h.indexOf('Beams to buy (cm × pcs)')], '400 × 12, 500 × 8', row2[h.indexOf('Beams to buy (cm × pcs)')]);
assert.equal(row2[h.indexOf('Planks to buy (cm × pcs)')], '500 × 95');
assert.equal(call({ action: 'ping', key }).config.rules.example, false);
const gf = call({ action: 'getFile', key, fileId: 'file000001' });
assert.ok(gf.ok && Buffer.from(gf.data, 'base64').slice(4).toString() === 'hello world, a photo' && gf.mime === 'image/jpeg', 'getFile returns the photo');
assert.equal(call({ action: 'getFile', key, fileId: 'nofile0001' }).error, 'not_found');
assert.equal(call({ action: 'getFile', key: 'wrong', fileId: 'file000001' }).error, 'bad_key');
// boundaries: beams side + 30 cm, planks side + 10 cm, rounded up to 210…600 in 30 cm steps
const R = { beam: [210,240,270,300,330,360,390,420,450,480,510,540,570,600], plank: [210,240,270,300,330,360,390,420,450,480,510,540,570,600], allowance: 10, beamAllowance: 30, beamSpacing: 0.6, plankWidth: 0.1, extraBeams: 0, extraPlanks: 0 };
const one = (b, p) => C.calcWood([{ id: 'x', name: 'R', roof: true, beamSide: b, plankSide: p }], R);
assert.equal(one(1.8, 2.0).rooms[0].beamLen, 210, 'beam 1.80 + 0.30 = 2.10 exactly');
assert.equal(one(1.81, 2.0).rooms[0].beamLen, 240, '1.81 + 0.30 → 2.40');
assert.equal(one(3.45, 2.0).rooms[0].beamLen, 390, '3.45 + 0.30 = 3.75 → 3.90');
assert.equal(one(2.0, 2.0).rooms[0].plankLen, 210, 'plank 2.00 + 0.10 = 2.10 exactly');
assert.equal(one(0.8, 1.2).rooms[0].plankLen, 210, 'short sides use the shortest');
assert.equal(one(5.7, 2).rooms[0].beamLen, 600, '5.70 + 0.30 = 6.00: the longest beam');
const tooLong = one(5.71, 2);
assert.ok(tooLong.rooms[0].invalid && !tooLong.rooms[0].beamLen && tooLong.invalid === 1, 'over 6 m with the walls: invalid');
assert.ok(/INVALID beam side 5.71 m\. Beams can't be more than 6 m .*Make it the plank side/.test(tooLong.warnings[0]), tooLong.warnings[0]);
assert.ok(/Both sides are too long for one beam/.test(one(6.2, 5.8).warnings[0]), 'both sides long: split the room');
assert.equal(one(2, 6.2).invalid, undefined, 'swapped: fine (planks may join over a beam)');
assert.equal(one(4.8, 4).rooms[0].beamLen, 510, '4.80 + 0.30 = 5.10');
// setup replaces an untouched old example tab with the new lengths list
const env2 = makeEnv(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'));
env2.ctx.SpreadsheetApp.getActiveSpreadsheet().insertSheet('Wood rules').rows = [['Wood', 'Room side up to (m)', 'Buy length (cm)', 'Note'], ['Beam', 4.2, 420, 'Example – replace'], ['Plank', 4.2, 420, 'Example']];
env2.ctx.setup();
const wr = env2.sheets.get('Wood rules').rows;
assert.equal(wr[0][1], 'Length (cm)'); assert.equal(wr.length, 29, 'header + 14 beams + 14 planks');
assert.ok(env2.sheets.get('Settings').rows.some(r => r[0] === 'Add for walls (cm)' && r[1] === 10));
assert.ok(env2.sheets.get('Settings').rows.some(r => r[0] === 'Add for beams (cm)' && r[1] === 30));
// over 6 m: two pieces meeting in the middle
const big = C.calcWood([{ id: 'h', name: 'Hall', roof: true, beamSide: 4, plankSide: 7.2 }], R);
const hr = big.rooms[0];
assert.equal(hr.plankLen, 390, '7.20 + 0.10 = 7.30 → 2 × 365 → 390'); assert.equal(hr.plankParts, 2);
assert.equal(hr.plankQty, 80, '40 rows × 2 planks');
assert.equal(hr.beamCount, 13, '12 beams → 13 so one sits in the middle'); assert.equal(hr.beamQty, 13); assert.equal(hr.beamLen, 450, '4 + 0.30');
assert.ok(/meeting on the middle beam/.test(big.notes[0]), big.notes[0]);
const wideAll = C.calcWood([{ id: 'w', name: 'Store', roof: true, beamSide: 6.5, plankSide: 3 }], R), wide = wideAll.rooms[0];
assert.ok(wide.invalid && !wide.beamLen && !wideAll.beams[330], 'no beams split in two any more: invalid'); assert.equal(wide.plankLen, 330);
const odd = C.calcWood([{ id: 'o', name: 'X', roof: true, beamSide: 3, plankSide: 6.5 }], R).rooms[0];
assert.equal(odd.beamCount, 11, 'already odd stays'); assert.equal(odd.plankLen, 330);
const huge = C.calcWood([{ id: 'z', name: 'Z', roof: true, beamSide: 3, plankSide: 12.5 }], R);
assert.ok(/too long even for 2 planks/.test(huge.warnings[0]), huge.warnings[0]);
console.log('backend tests passed');
