const test = require('node:test');
const assert = require('node:assert');
const CZ = require('../lib/scoring');
const demo = require('../site/demo');

const CLOCK = { date: '2026-11-03', minutes: 15 * 60 };

function picture(clock) {
  const state = demo.build(clock);
  const occ = CZ.expandSchedule({
    slots: state.slots,
    checkins: state.checkins,
    from: CZ.addDays(clock.date, -21),
    to: clock.date,
    clock
  });
  return { state, occ };
}

test('the sample house works with no server', () => {
  const { state, occ } = picture(CLOCK);
  assert.equal(state.family.name, 'The Roar House');
  assert.equal(state.members.length, 3);
  assert.ok(state.slots.length >= 8);
  assert.ok(state.prizes.find(item => item.week_start === '2026-11-02'));
  const thisWeek = CZ.weekBoard(occ, state.members, '2026-11-02', CLOCK.date);
  const lastWeek = CZ.weekBoard(occ, state.members, '2026-10-26', '2026-11-01');
  const mia = thisWeek.rows.find(item => item.memberId === 'm-mia');
  const leo = thisWeek.rows.find(item => item.memberId === 'm-leo');
  assert.ok(mia.points > leo.points, 'Mia should lead the live week');
  assert.ok(leo.wastedMinutes > mia.wastedMinutes, 'Leo should show wasted time');
  assert.deepEqual(thisWeek.winners, ['m-mia']);
  assert.deepEqual(lastWeek.winners, ['m-mia']);
  assert.ok(mia.streak >= 7);
  assert.equal(leo.streak, 0);
  const partial = state.checkins.find(item => item.slot_id === 's-leo-read' && item.status === 'partial');
  assert.ok(partial);
  const mondayScreens = occ.find(item => item.slotId === 's-leo-screens' && item.day === '2026-11-02');
  assert.equal(mondayScreens.status, 'missed');
  assert.equal(mondayScreens.synthesized, true);
  assert.equal(mondayScreens.wastedMinutes, 30);
  assert.equal(mondayScreens.pointsCost, 5);
});
