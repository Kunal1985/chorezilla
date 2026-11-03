// Sample household so the site works before Supabase is configured.
(function (root, factory) {
  const CZ = (root && root.Chorezilla) || require('./scoring.js');
  const api = factory(CZ);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.ChorezillaDemo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CZ) {
  const VERSION = 1;

  function slot(id, memberId, title, days, start, end, points, created) {
    return {
      id,
      family_id: 'fam-demo',
      member_id: memberId,
      title,
      days,
      start_time: start,
      end_time: end,
      points,
      active: true,
      created_on: created,
      created_at: created + 'T12:00:00.000Z'
    };
  }

  function checkin(id, slotRow, day, status) {
    const duration = CZ.durationMinutes(slotRow.start_time, slotRow.end_time);
    return {
      id,
      family_id: 'fam-demo',
      slot_id: slotRow.id,
      member_id: slotRow.member_id,
      day,
      status,
      points_possible: slotRow.points,
      points_awarded: CZ.pointsFor(status, slotRow.points),
      duration_minutes: duration,
      reported_role: 'kid',
      approved: slotRow.member_id === 'm-alex',
      created_at: day + 'T12:00:00.000Z'
    };
  }

  // Misses are left unmarked so the schedule treats them as wasted time.
  function planned(slotId, day) {
    const dow = CZ.isoDow(day);
    if (slotId === 's-leo-screens' && dow === 1) return 'miss';
    if (slotId === 's-leo-chores' && (dow === 2 || dow === 4)) return 'miss';
    if (slotId === 's-leo-read' && dow === 3) return 'partial';
    return 'done';
  }

  function morningTitle(title) {
    return title === 'Wake up' || title === 'Pack lunches';
  }

  function build(now) {
    const clock = now && now.date ? now : CZ.clockFromDate(now || new Date());
    const today = clock.date;
    const thisMonday = CZ.weekStart(today);
    const created = CZ.addDays(thisMonday, -7);
    const members = [
      { id: 'm-alex', family_id: 'fam-demo', user_id: 'u-alex', display_name: 'Alex', role: 'parent', emoji: '🦖', color: '#2f7d46', created_at: created + 'T12:00:00.000Z' },
      { id: 'm-mia', family_id: 'fam-demo', user_id: 'u-mia', display_name: 'Mia', role: 'kid', emoji: '🦊', color: '#ef6a1a', created_at: created + 'T12:00:00.000Z' },
      { id: 'm-leo', family_id: 'fam-demo', user_id: 'u-leo', display_name: 'Leo', role: 'kid', emoji: '🐻', color: '#2f6f9f', created_at: created + 'T12:00:00.000Z' }
    ];
    const slots = [
      slot('s-mia-wake', 'm-mia', 'Wake up', [1, 2, 3, 4, 5, 6, 7], '07:00', '07:15', 5, created),
      slot('s-mia-hw', 'm-mia', 'Homework', [1, 2, 3, 4, 5], '16:00', '17:00', 15, created),
      slot('s-mia-read', 'm-mia', 'Reading', [1, 2, 3, 4, 5, 6, 7], '19:00', '19:30', 10, created),
      slot('s-mia-bed', 'm-mia', 'Bedtime', [1, 2, 3, 4, 5, 6, 7], '20:30', '21:00', 10, created),
      slot('s-leo-wake', 'm-leo', 'Wake up', [1, 2, 3, 4, 5, 6, 7], '07:15', '07:30', 5, created),
      slot('s-leo-chores', 'm-leo', 'Chores', [1, 2, 3, 4, 5, 6], '17:00', '17:30', 10, created),
      slot('s-leo-screens', 'm-leo', 'Screens off', [1, 2, 3, 4, 5], '18:00', '18:30', 5, created),
      slot('s-leo-read', 'm-leo', 'Reading', [1, 2, 3, 4, 5, 6, 7], '19:00', '19:20', 10, created),
      slot('s-leo-bed', 'm-leo', 'Bedtime', [1, 2, 3, 4, 5, 6, 7], '20:30', '21:00', 10, created),
      slot('s-alex-lunch', 'm-alex', 'Pack lunches', [1, 2, 3, 4, 5], '07:30', '07:45', 5, created),
      slot('s-alex-dishes', 'm-alex', 'Dishes', [1, 2, 3, 4, 5, 6, 7], '19:30', '19:50', 5, created)
    ];
    const checkins = [];
    let n = 1;
    for (const day of CZ.eachDay(created, today)) {
      for (const row of slots) {
        if (!row.days.includes(CZ.isoDow(day))) continue;
        const endMin = CZ.timeToMinutes(row.end_time);
        const closed = day < today || clock.minutes >= endMin;
        if (!closed) {
          if (day === today && morningTitle(row.title) && clock.minutes >= CZ.timeToMinutes(row.start_time)) {
            checkins.push(checkin('c' + n, row, day, 'done'));
            n += 1;
          }
          continue;
        }
        const plan = planned(row.id, day);
        if (plan === 'miss') continue;
        checkins.push(checkin('c' + n, row, day, plan));
        n += 1;
      }
    }
    return {
      version: VERSION,
      mode: 'demo',
      meId: 'm-mia',
      focusDay: today,
      family: { id: 'fam-demo', name: 'The Roar House', invite_code: 'ROAR7K', created_at: created + 'T12:00:00.000Z' },
      members,
      slots,
      checkins,
      prizes: [
        { family_id: 'fam-demo', week_start: created, prize: 'Pizza night — winner picks the toppings' },
        { family_id: 'fam-demo', week_start: thisMonday, prize: 'Pick the movie and a scoop of ice cream' }
      ]
    };
  }

  return { VERSION, build };
});
