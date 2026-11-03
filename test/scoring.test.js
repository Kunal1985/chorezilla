const test = require('node:test');
const assert = require('node:assert');
const CZ = require('../lib/scoring');

test('partial points round half up', () => {
  assert.equal(CZ.pointsFor('done', 15), 15);
  assert.equal(CZ.pointsFor('partial', 15), 8);
  assert.equal(CZ.pointsFor('partial', 5), 3);
  assert.equal(CZ.pointsFor('partial', 1), 1);
  assert.equal(CZ.pointsFor('partial', 10), 5);
  assert.equal(CZ.pointsFor('partial', 0), 0);
  assert.equal(CZ.pointsFor('missed', 15), 0);
  assert.equal(CZ.pointsFor('pending', 15), 0);
});

test('missed time costs the full slot and partial costs the rest', () => {
  assert.deepEqual(CZ.wastedFor('missed', 30, 15), { minutes: 30, pointsCost: 15 });
  assert.deepEqual(CZ.wastedFor('partial', 30, 15), { minutes: 15, pointsCost: 7 });
  assert.deepEqual(CZ.wastedFor('partial', 45, 10), { minutes: 23, pointsCost: 5 });
  assert.deepEqual(CZ.wastedFor('done', 30, 15), { minutes: 0, pointsCost: 0 });
  assert.deepEqual(CZ.wastedFor('pending', 30, 15), { minutes: 0, pointsCost: 0 });
  assert.equal(CZ.wastedFor('partial', 30, 15).pointsCost + CZ.pointsFor('partial', 15), 15);
});

test('roar copy names the minutes and the points', () => {
  assert.equal(CZ.resultMessage('done', 10, 30).text, 'Roar! +10 points.');
  assert.equal(CZ.resultMessage('done', 1, 15).text, 'Roar! +1 point.');
  assert.equal(CZ.resultMessage('missed', 15, 30).text, 'You lost 30 minutes = 15 points.');
  assert.equal(CZ.resultMessage('missed', 5, 1).text, 'You lost 1 minute = 5 points.');
  assert.equal(
    CZ.resultMessage('partial', 15, 60).text,
    'Half credit: +8. 30 minutes slipped away = 7 points.'
  );
  assert.equal(CZ.resultMessage('missed', 15, 30).tone, 'bad');
});

test('duration and week boundaries', () => {
  assert.equal(CZ.durationMinutes('07:00', '07:15'), 15);
  assert.equal(CZ.durationMinutes('16:00:00', '17:00:00'), 60);
  assert.equal(CZ.durationMinutes('19:00', '19:20'), 20);
  assert.equal(CZ.durationMinutes('21:00', '07:00'), 0);
  assert.equal(CZ.weekStart('2026-11-03'), '2026-11-02');
  assert.equal(CZ.weekStart('2026-11-02'), '2026-11-02');
  assert.equal(CZ.weekStart('2026-11-01'), '2026-10-26');
  assert.equal(CZ.isoDow('2026-11-03'), 2);
  assert.equal(CZ.isoDow('2026-11-01'), 7);
  assert.equal(CZ.addDays('2026-10-31', 1), '2026-11-01');
  assert.deepEqual(CZ.eachDay('2026-11-02', '2026-11-04'), ['2026-11-02', '2026-11-03', '2026-11-04']);
});

test('closed days with no check-in are missed, open slots stay pending', () => {
  const slots = [{
    id: 'wake',
    member_id: 'mia',
    title: 'Wake up',
    days: [1, 2],
    start_time: '07:00',
    end_time: '07:15',
    points: 10,
    active: true,
    created_on: '2026-11-02'
  }];
  const occ = CZ.expandSchedule({
    slots,
    checkins: [],
    from: '2026-11-01',
    to: '2026-11-03',
    clock: { date: '2026-11-03', minutes: 8 * 60 }
  });
  const byDay = Object.fromEntries(occ.map(item => [item.day, item]));
  assert.equal(byDay['2026-11-01'], undefined);
  assert.equal(byDay['2026-11-02'].status, 'missed');
  assert.equal(byDay['2026-11-02'].synthesized, true);
  assert.equal(byDay['2026-11-02'].pointsCost, 10);
  assert.equal(byDay['2026-11-02'].wastedMinutes, 15);
  assert.equal(byDay['2026-11-03'].status, 'missed');
});

test('a slot still inside its window is pending and can be marked early', () => {
  const slots = [{
    id: 'hw',
    member_id: 'mia',
    title: 'Homework',
    days: [2],
    start_time: '16:00',
    end_time: '17:00',
    points: 15,
    active: true,
    created_on: '2026-11-02'
  }];
  const open = CZ.expandSchedule({
    slots,
    checkins: [],
    from: '2026-11-03',
    to: '2026-11-03',
    clock: { date: '2026-11-03', minutes: 15 * 60 }
  });
  assert.equal(open[0].status, 'pending');
  assert.equal(open[0].pointsCost, 0);
  const marked = CZ.expandSchedule({
    slots,
    checkins: [{
      id: 'c1',
      slot_id: 'hw',
      member_id: 'mia',
      day: '2026-11-03',
      status: 'partial',
      points_possible: 15,
      points_awarded: 8,
      duration_minutes: 60,
      approved: false,
      reported_role: 'kid'
    }],
    from: '2026-11-03',
    to: '2026-11-03',
    clock: { date: '2026-11-03', minutes: 15 * 60 }
  });
  assert.equal(marked[0].status, 'partial');
  assert.equal(marked[0].pointsAwarded, 8);
  assert.equal(marked[0].wastedMinutes, 30);
  assert.equal(marked[0].pointsCost, 7);
  assert.equal(marked[0].synthesized, false);
});

test('archived slots keep stored check-ins and stop inventing misses', () => {
  const slots = [{
    id: 'chores',
    member_id: 'leo',
    title: 'Chores',
    days: [1, 2, 3, 4, 5],
    start_time: '17:00',
    end_time: '17:30',
    points: 10,
    active: false,
    created_on: '2026-11-02'
  }];
  const occ = CZ.expandSchedule({
    slots,
    checkins: [{
      id: 'c1',
      slot_id: 'chores',
      day: '2026-11-02',
      status: 'done',
      points_possible: 10,
      points_awarded: 10,
      duration_minutes: 30
    }],
    from: '2026-11-02',
    to: '2026-11-04',
    clock: { date: '2026-11-04', minutes: 20 * 60 }
  });
  assert.equal(occ.length, 1);
  assert.equal(occ[0].day, '2026-11-02');
  assert.equal(occ[0].pointsAwarded, 10);
});

test('streak skips today while it is open, and a miss resets it', () => {
  const slots = [{
    id: 'bed',
    member_id: 'mia',
    title: 'Bedtime',
    days: [1, 2, 3, 4, 5, 6, 7],
    start_time: '20:30',
    end_time: '21:00',
    points: 10,
    active: true,
    created_on: '2026-11-01'
  }];
  function occ(checkins, minutes) {
    return CZ.expandSchedule({
      slots,
      checkins,
      from: '2026-11-01',
      to: '2026-11-03',
      clock: { date: '2026-11-03', minutes }
    });
  }
  const done = ['2026-11-01', '2026-11-02'].map((day, i) => ({
    id: 'c' + i,
    slot_id: 'bed',
    day,
    status: 'done',
    points_possible: 10,
    points_awarded: 10,
    duration_minutes: 30
  }));
  const openToday = occ(done, 15 * 60);
  assert.equal(CZ.currentStreak(openToday, 'mia', '2026-11-03'), 2);
  const missedToday = occ(done.concat([{
    id: 'c9',
    slot_id: 'bed',
    day: '2026-11-03',
    status: 'missed',
    points_possible: 10,
    points_awarded: 0,
    duration_minutes: 30
  }]), 22 * 60);
  assert.equal(CZ.currentStreak(missedToday, 'mia', '2026-11-03'), 0);
  const partialYesterday = occ([{
    id: 'c1',
    slot_id: 'bed',
    day: '2026-11-01',
    status: 'done',
    points_possible: 10,
    points_awarded: 10,
    duration_minutes: 30
  }, {
    id: 'c2',
    slot_id: 'bed',
    day: '2026-11-02',
    status: 'partial',
    points_possible: 10,
    points_awarded: 5,
    duration_minutes: 30
  }], 15 * 60);
  assert.equal(CZ.currentStreak(partialYesterday, 'mia', '2026-11-03'), 0);
});

test('a perfect today extends the streak and empty days do not break it', () => {
  const occurrences = [
    { memberId: 'mia', day: '2026-11-01', status: 'done' },
    { memberId: 'mia', day: '2026-11-03', status: 'done' }
  ];
  assert.equal(CZ.currentStreak(occurrences, 'mia', '2026-11-03'), 2);
});
