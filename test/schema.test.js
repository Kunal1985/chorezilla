const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('the sqlite schema stores households, sessions, and check-in points', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'server/schema.sql'), 'utf8');
  for (const table of ['families', 'members', 'slots', 'checkins', 'prizes', 'sessions']) {
    assert.match(sql, new RegExp('CREATE TABLE IF NOT EXISTS ' + table));
  }
  assert.match(sql, /password_hash/);
  assert.match(sql, /pin_hash/);
  assert.match(sql, /points_awarded/);
  assert.match(sql, /UNIQUE \(slot_id, day\)/);
  assert.doesNotMatch(sql, /supabase/i);
  assert.doesNotMatch(sql, /service_role/);
});
