const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('the migration keeps each family inside row level security', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/001_init.sql'), 'utf8');
  for (const table of ['families', 'members', 'slots', 'checkins', 'prizes']) {
    assert.match(sql, new RegExp('alter table public\\.' + table + ' enable row level security'));
  }
  assert.match(sql, /apply_checkin_score/);
  assert.match(sql, /round\(pts \* 0\.5\)::int/);
  assert.match(sql, /unclaimed_profiles/);
  assert.match(sql, /revoke all on public\.families/);
  assert.doesNotMatch(sql, /service_role/);
});
