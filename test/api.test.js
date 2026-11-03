const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { start } = require('../server/index');
const { backupDatabase } = require('../server/db');

function cookieFrom(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  const raw = list.find(item => item && item.startsWith('cz_session=')) || '';
  const match = raw.match(/cz_session=([^;]+)/);
  return match ? 'cz_session=' + match[1] : '';
}

async function listen() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
  const server = await start({ port: 0, host: '127.0.0.1', dataDir, hashN: 1024, maxFails: 3 });
  const port = server.address().port;
  return {
    server,
    dataDir,
    url: 'http://127.0.0.1:' + port,
    async stop() {
      await new Promise(resolve => server.close(resolve));
      server.db.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

async function call(app, pathName, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(app.url + pathName, {
    method,
    headers: Object.assign(
      body ? { 'content-type': 'application/json' } : {},
      cookie ? { cookie } : {}
    ),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  if (text) data = JSON.parse(text);
  return { status: res.status, data, cookie: cookieFrom(res) || cookie || '' };
}

test('a parent password opens a household and the points stay on the server', async () => {
  const app = await listen();
  try {
    const health = await call(app, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);

    const created = await call(app, '/api/households', {
      method: 'POST',
      body: { name: 'The Roar House', displayName: 'Alex', emoji: '🦖', password: 'correct horse' }
    });
    assert.equal(created.status, 201);
    assert.match(created.cookie, /^cz_session=/);
    assert.equal(created.data.family.name, 'The Roar House');
    assert.equal(created.data.me.role, 'parent');
    assert.equal(created.data.me.is_owner, true);
    assert.equal(created.data.family.password_hash, undefined);

    const anon = await call(app, '/api/state');
    assert.equal(anon.status, 401);

    const slot = await call(app, '/api/slots', {
      method: 'POST',
      cookie: created.cookie,
      body: {
        member_id: created.data.me.id,
        title: 'Homework',
        days: [1, 2, 3, 4, 5],
        start_time: '16:00',
        end_time: '17:00',
        points: 15
      }
    });
    assert.equal(slot.status, 201);
    const homework = slot.data.slots.find(item => item.title === 'Homework');
    const marked = await call(app, '/api/checkins', {
      method: 'POST',
      cookie: created.cookie,
      body: { slotId: homework.id, day: '2026-11-03', status: 'partial', points_awarded: 999 }
    });
    const checkin = marked.data.checkins.find(item => item.slot_id === homework.id);
    assert.equal(checkin.points_awarded, 8);
    assert.equal(checkin.points_possible, 15);
    assert.equal(checkin.duration_minutes, 60);
    assert.equal(checkin.approved, 1);

    const done = await call(app, '/api/checkins', {
      method: 'POST',
      cookie: created.cookie,
      body: { slotId: homework.id, day: '2026-11-03', status: 'done', points_awarded: 999 }
    });
    assert.equal(done.data.checkins.find(item => item.slot_id === homework.id).points_awarded, 15);
  } finally {
    await app.stop();
  }
});

test('households cannot see or edit each other', async () => {
  const app = await listen();
  try {
    const alpha = await call(app, '/api/households', {
      method: 'POST',
      body: { name: 'Alpha', displayName: 'Ada', password: 'alpha-pass' }
    });
    const beta = await call(app, '/api/households', {
      method: 'POST',
      body: { name: 'Beta', displayName: 'Bea', password: 'beta-pass-1' }
    });
    const saved = await call(app, '/api/slots', {
      method: 'POST',
      cookie: alpha.cookie,
      body: { member_id: alpha.data.me.id, title: 'Secret chore', days: [1], start_time: '18:00', end_time: '18:20', points: 5 }
    });
    const secret = saved.data.slots[0];
    const betaState = await call(app, '/api/state', { cookie: beta.cookie });
    assert.equal(betaState.data.slots.length, 0);
    assert.equal(betaState.data.family.invite_code !== alpha.data.family.invite_code, true);
    const stolen = await call(app, '/api/slots/' + secret.id, {
      method: 'PATCH',
      cookie: beta.cookie,
      body: { active: false }
    });
    assert.equal(stolen.status, 404);
  } finally {
    await app.stop();
  }
});

test('a kid PIN can check in, and a parent lock sticks', async () => {
  const app = await listen();
  try {
    const parent = await call(app, '/api/households', {
      method: 'POST',
      body: { name: 'Pins', displayName: 'Pat', password: 'parent-pass' }
    });
    const added = await call(app, '/api/members', {
      method: 'POST',
      cookie: parent.cookie,
      body: { displayName: 'Mia', role: 'kid', emoji: '🦊' }
    });
    const mia = added.data.members.find(item => item.display_name === 'Mia');
    assert.equal(mia.has_pin, false);
    const lookup = await call(app, '/api/lookup', { method: 'POST', body: { code: parent.data.family.invite_code } });
    assert.equal(lookup.data.familyName, 'Pins');
    const joined = await call(app, '/api/join', {
      method: 'POST',
      body: { code: parent.data.family.invite_code, claimId: mia.id, pin: '1234' }
    });
    assert.equal(joined.data.me.display_name, 'Mia');
    assert.equal(joined.data.me.role, 'kid');
    assert.equal(joined.data.family.invite_code, null);

    const slot = await call(app, '/api/slots', {
      method: 'POST',
      cookie: parent.cookie,
      body: { member_id: mia.id, title: 'Reading', days: [2], start_time: '19:00', end_time: '19:30', points: 10 }
    });
    const reading = slot.data.slots.find(item => item.title === 'Reading');
    const blocked = await call(app, '/api/slots', {
      method: 'POST',
      cookie: joined.cookie,
      body: { member_id: mia.id, title: 'Nope', days: [1], start_time: '10:00', end_time: '10:30', points: 1 }
    });
    assert.equal(blocked.status, 403);

    const kidMark = await call(app, '/api/checkins', {
      method: 'POST',
      cookie: joined.cookie,
      body: { slotId: reading.id, day: '2026-11-03', status: 'done', points_awarded: 100 }
    });
    let row = kidMark.data.checkins.find(item => item.slot_id === reading.id);
    assert.equal(row.points_awarded, 10);
    assert.equal(row.approved, 0);
    assert.equal(row.reported_role, 'kid');

    const approved = await call(app, '/api/checkins/' + row.id + '/approve', { method: 'POST', cookie: parent.cookie });
    row = approved.data.checkins.find(item => item.id === row.id);
    assert.equal(row.approved, 1);
    assert.equal(row.points_awarded, 10);

    const again = await call(app, '/api/checkins', {
      method: 'POST',
      cookie: joined.cookie,
      body: { slotId: reading.id, day: '2026-11-03', status: 'missed' }
    });
    assert.equal(again.status, 403);

    const override = await call(app, '/api/checkins', {
      method: 'POST',
      cookie: parent.cookie,
      body: { slotId: reading.id, day: '2026-11-03', status: 'missed' }
    });
    row = override.data.checkins.find(item => item.slot_id === reading.id);
    assert.equal(row.status, 'missed');
    assert.equal(row.points_awarded, 0);
    assert.equal(row.approved, 1);

    const kidExport = await call(app, '/api/export', { cookie: joined.cookie });
    assert.equal(kidExport.status, 403);
    const parentExport = await fetch(app.url + '/api/export', { headers: { cookie: parent.cookie } });
    assert.equal(parentExport.status, 200);
    assert.match(parentExport.headers.get('content-disposition'), /attachment/);
    const exported = await parentExport.json();
    assert.equal(exported.family.name, 'Pins');
    assert.equal(JSON.stringify(exported).includes('pin_hash'), false);
    assert.equal(JSON.stringify(exported).includes('password_hash'), false);
  } finally {
    await app.stop();
  }
});

test('a wrong PIN locks after repeated tries and the backup file opens', async () => {
  const app = await listen();
  try {
    const parent = await call(app, '/api/households', {
      method: 'POST',
      body: { name: 'Locks', displayName: 'Lee', password: 'long-password' }
    });
    const code = parent.data.family.invite_code;
    const first = await call(app, '/api/login', {
      method: 'POST',
      body: { code, memberId: parent.data.me.id, secret: 'nope-nope' }
    });
    assert.equal(first.status, 401);
    await call(app, '/api/login', { method: 'POST', body: { code, memberId: parent.data.me.id, secret: 'nope-nope' } });
    await call(app, '/api/login', { method: 'POST', body: { code, memberId: parent.data.me.id, secret: 'nope-nope' } });
    const locked = await call(app, '/api/login', {
      method: 'POST',
      body: { code, memberId: parent.data.me.id, secret: 'long-password' }
    });
    assert.equal(locked.status, 429);

    const dest = path.join(app.dataDir, 'backups', 'copy.sqlite');
    backupDatabase(app.server.db, dest);
    const copy = new DatabaseSync(dest);
    try {
      const row = copy.prepare('SELECT name FROM families').get();
      assert.equal(row.name, 'Locks');
    } finally {
      copy.close();
    }
  } finally {
    await app.stop();
  }
});
