const test = require('node:test');
const assert = require('node:assert');
const CZ = require('../lib/scoring');

function row(memberId, points, wastedMinutes, streak) {
  return { memberId, points, wastedMinutes, streak };
}

test('the crown follows points, then wasted minutes, then streak', () => {
  assert.deepEqual(
    CZ.pickWinners([
      row('mia', 40, 30, 1),
      row('leo', 25, 0, 9),
      row('alex', 10, 0, 9)
    ]),
    ['mia']
  );
  assert.deepEqual(
    CZ.pickWinners([
      row('mia', 20, 30, 4),
      row('leo', 20, 10, 1)
    ]),
    ['leo']
  );
  assert.deepEqual(
    CZ.pickWinners([
      row('mia', 20, 10, 4),
      row('leo', 20, 10, 1)
    ]),
    ['mia']
  );
});

test('a full tie shares the crown and zero points crowns nobody', () => {
  assert.deepEqual(
    CZ.pickWinners([
      row('leo', 12, 5, 2),
      row('mia', 12, 5, 2)
    ]).sort(),
    ['leo', 'mia']
  );
  assert.deepEqual(
    CZ.pickWinners([
      row('mia', 0, 40, 0),
      row('leo', 0, 10, 0)
    ]),
    []
  );
  assert.deepEqual(CZ.pickWinners([]), []);
});

test('a week board ignores open slots and scores synthesized misses', () => {
  const slots = [
    { id: 'mia-hw', member_id: 'mia', title: 'Homework', days: [1, 2], start_time: '16:00', end_time: '17:00', points: 15, active: true, created_on: '2026-11-02' },
    { id: 'leo-chores', member_id: 'leo', title: 'Chores', days: [1, 2], start_time: '17:00', end_time: '17:30', points: 10, active: true, created_on: '2026-11-02' },
    { id: 'mia-read', member_id: 'mia', title: 'Reading', days: [3], start_time: '19:00', end_time: '19:30', points: 10, active: true, created_on: '2026-11-02' }
  ];
  const checkins = [{
    id: 'c1',
    slot_id: 'mia-hw',
    day: '2026-11-02',
    status: 'done',
    points_possible: 15,
    points_awarded: 15,
    duration_minutes: 60,
    approved: true,
    reported_role: 'kid'
  }];
  const clock = { date: '2026-11-03', minutes: 18 * 60 };
  const occ = CZ.expandSchedule({
    slots,
    checkins,
    from: '2026-11-02',
    to: '2026-11-08',
    clock
  });
  const members = [{ id: 'mia' }, { id: 'leo' }];
  const board = CZ.weekBoard(occ, members, '2026-11-02', clock.date);
  const mia = board.rows.find(item => item.memberId === 'mia');
  const leo = board.rows.find(item => item.memberId === 'leo');
  // Monday homework was marked done. Tuesday's homework had ended by 18:00 with no check-in.
  assert.equal(mia.points, 15);
  assert.equal(mia.wastedMinutes, 60);
  assert.equal(mia.pointsCost, 15);
  assert.equal(leo.points, 0);
  assert.equal(leo.wastedMinutes, 60);
  assert.equal(leo.pointsCost, 20);
  assert.deepEqual(board.winners, ['mia']);
  const future = occ.filter(item => item.day > clock.date);
  assert.equal(future.length, 1);
  assert.equal(future[0].title, 'Reading');
  assert.equal(future[0].status, 'pending');
  assert.equal(future[0].pointsCost, 0);
});
