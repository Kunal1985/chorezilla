// Chorezilla scoring (v1). Browser global and CommonJS.
//
// A slot is worth its full points and its full minutes.
//   done    — earn every point. Nothing is wasted.
//   partial — late or incomplete. Earn half the points, rounded half up
//             (Math.round). Half the minutes, rounded the same way, count as wasted.
//             The points you did not earn are the cost.
//   missed  — earn nothing. Every minute and every point counts as wasted.
//   pending — the slot is still open. It is not scored and not wasted.
//
// A day before today with no check-in is treated as missed once the slot exists
// (created_on). Today stays pending until the end time, unless someone marks it.
// The crown goes to the most points that week. Ties break on fewer wasted
// minutes, then the longer streak. Nobody wears it until someone has points.
// A streak day is a day where every slot is done. Partial or missed breaks it.
// Today does not break a streak while slots are still open and nothing is missed.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.Chorezilla = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function parseISO(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function isoOfUTC(date) {
    return date.toISOString().slice(0, 10);
  }

  function localISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  function clockFromDate(date) {
    return {
      date: localISODate(date),
      minutes: date.getHours() * 60 + date.getMinutes()
    };
  }

  function addDays(iso, n) {
    const dt = parseISO(iso);
    dt.setUTCDate(dt.getUTCDate() + n);
    return isoOfUTC(dt);
  }

  function isoDow(iso) {
    const day = parseISO(iso).getUTCDay();
    return day === 0 ? 7 : day;
  }

  function weekStart(iso) {
    const dow = isoDow(iso);
    return addDays(iso, 1 - dow);
  }

  function eachDay(from, to) {
    const out = [];
    let day = from;
    while (day <= to) {
      out.push(day);
      day = addDays(day, 1);
    }
    return out;
  }

  function normTime(value) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
    if (!match) return '00:00';
    return String(match[1]).padStart(2, '0') + ':' + match[2];
  }

  function timeToMinutes(value) {
    const [h, m] = normTime(value).split(':').map(Number);
    return h * 60 + m;
  }

  function durationMinutes(start, end) {
    const mins = timeToMinutes(end) - timeToMinutes(start);
    return mins > 0 ? mins : 0;
  }

  function pointsFor(status, fullPoints) {
    const pts = Math.max(0, Number(fullPoints) || 0);
    if (status === 'done') return pts;
    if (status === 'partial') return Math.round(pts * 0.5);
    return 0;
  }

  function wastedFor(status, duration, fullPoints) {
    const mins = Math.max(0, Number(duration) || 0);
    const full = Math.max(0, Number(fullPoints) || 0);
    if (status === 'missed') return { minutes: mins, pointsCost: full };
    if (status === 'partial') {
      return {
        minutes: Math.round(mins * 0.5),
        pointsCost: Math.max(0, full - pointsFor('partial', full))
      };
    }
    return { minutes: 0, pointsCost: 0 };
  }

  function plural(n, word) {
    return n === 1 ? '1 ' + word : n + ' ' + word + 's';
  }

  function resultMessage(status, fullPoints, duration) {
    const awarded = pointsFor(status, fullPoints);
    const waste = wastedFor(status, duration, fullPoints);
    if (status === 'done') {
      return { tone: 'good', text: 'Roar! +' + plural(awarded, 'point') + '.' };
    }
    if (status === 'partial') {
      return {
        tone: 'mid',
        text: 'Half credit: +' + awarded + '. ' + plural(waste.minutes, 'minute') + ' slipped away = ' + plural(waste.pointsCost, 'point') + '.'
      };
    }
    if (status === 'missed') {
      return {
        tone: 'bad',
        text: 'You lost ' + plural(waste.minutes, 'minute') + ' = ' + plural(waste.pointsCost, 'point') + '.'
      };
    }
    return { tone: 'neutral', text: '' };
  }

  function expandSchedule({ slots, checkins, from, to, clock }) {
    const list = [];
    const seen = new Set();
    const slotById = new Map((slots || []).map(slot => [slot.id, slot]));
    const days = eachDay(from, to);
    const byKey = new Map();
    for (const checkin of checkins || []) byKey.set(checkin.slot_id + '|' + checkin.day, checkin);

    function pushOcc(slot, day, checkin) {
      const start = normTime(slot.start_time);
      const end = normTime(slot.end_time);
      const hasDuration = checkin && Number.isFinite(Number(checkin.duration_minutes));
      const hasPossible = checkin && Number.isFinite(Number(checkin.points_possible));
      const duration = hasDuration ? Number(checkin.duration_minutes) : durationMinutes(start, end);
      const fullPoints = hasPossible ? Number(checkin.points_possible) : Number(slot.points) || 0;
      const endMin = timeToMinutes(end);
      let phase = 'open';
      if (day > clock.date) phase = 'future';
      else if (day < clock.date || clock.minutes >= endMin) phase = 'closed';

      let status = 'pending';
      let pointsAwarded = 0;
      let approved = false;
      let reportedRole = null;
      let id = null;
      let synthesized = false;
      if (checkin) {
        status = checkin.status;
        pointsAwarded = Number.isFinite(Number(checkin.points_awarded))
          ? Number(checkin.points_awarded)
          : pointsFor(status, fullPoints);
        approved = Boolean(checkin.approved);
        reportedRole = checkin.reported_role || null;
        id = checkin.id;
      } else if (phase === 'closed') {
        status = 'missed';
        synthesized = true;
      }
      const waste = wastedFor(status, duration, fullPoints);
      list.push({
        id,
        slotId: slot.id,
        memberId: slot.member_id,
        day,
        title: slot.title,
        start,
        end,
        fullPoints,
        duration,
        status,
        pointsAwarded,
        wastedMinutes: waste.minutes,
        pointsCost: waste.pointsCost,
        approved,
        reportedRole,
        synthesized,
        phase
      });
      seen.add(slot.id + '|' + day);
    }

    for (const slot of slots || []) {
      if (slot.active === false) continue;
      const created = slot.created_on || '1970-01-01';
      const dayset = new Set((slot.days || []).map(Number));
      for (const day of days) {
        if (day < created) continue;
        if (!dayset.has(isoDow(day))) continue;
        pushOcc(slot, day, byKey.get(slot.id + '|' + day) || null);
      }
    }

    for (const checkin of checkins || []) {
      const key = checkin.slot_id + '|' + checkin.day;
      if (seen.has(key)) continue;
      if (checkin.day < from || checkin.day > to) continue;
      const slot = slotById.get(checkin.slot_id);
      if (!slot) continue;
      pushOcc(slot, checkin.day, checkin);
    }

    list.sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
    return list;
  }

  function summarizeMember(occurrences, memberId) {
    const scored = occurrences.filter(item => item.memberId === memberId && item.status !== 'pending');
    return {
      memberId,
      points: scored.reduce((sum, item) => sum + item.pointsAwarded, 0),
      wastedMinutes: scored.reduce((sum, item) => sum + item.wastedMinutes, 0),
      pointsCost: scored.reduce((sum, item) => sum + item.pointsCost, 0),
      scheduledMinutes: scored.reduce((sum, item) => sum + item.duration, 0),
      scoredCount: scored.length,
      doneCount: scored.filter(item => item.status === 'done').length,
      partialCount: scored.filter(item => item.status === 'partial').length,
      missedCount: scored.filter(item => item.status === 'missed').length
    };
  }

  function dayKind(statuses, day, today) {
    if (!statuses || !statuses.length) return 'empty';
    const norm = statuses.map(status => (status === 'pending' && day < today ? 'missed' : status));
    if (norm.every(status => status === 'done')) return 'perfect';
    if (norm.some(status => status === 'missed' || status === 'partial')) return 'broken';
    return 'open';
  }

  function currentStreak(occurrences, memberId, today) {
    const byDay = new Map();
    for (const item of occurrences) {
      if (item.memberId !== memberId || item.day > today) continue;
      if (!byDay.has(item.day)) byDay.set(item.day, []);
      byDay.get(item.day).push(item.status);
    }
    let day = today;
    let streak = 0;
    let lookingAtToday = true;
    for (let i = 0; i < 120; i += 1) {
      const kind = dayKind(byDay.get(day), day, today);
      if (kind === 'empty') {
        day = addDays(day, -1);
        continue;
      }
      if (kind === 'open') {
        if (lookingAtToday) {
          lookingAtToday = false;
          day = addDays(day, -1);
          continue;
        }
        break;
      }
      if (kind === 'perfect') {
        streak += 1;
        lookingAtToday = false;
        day = addDays(day, -1);
        continue;
      }
      return lookingAtToday ? 0 : streak;
    }
    return streak;
  }

  function pickWinners(rows) {
    const contenders = (rows || []).filter(row => row.points > 0);
    if (!contenders.length) return [];
    const ranked = contenders.slice().sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (a.wastedMinutes !== b.wastedMinutes) return a.wastedMinutes - b.wastedMinutes;
      if (b.streak !== a.streak) return b.streak - a.streak;
      return String(a.memberId).localeCompare(String(b.memberId));
    });
    const top = ranked[0];
    return ranked
      .filter(row => row.points === top.points && row.wastedMinutes === top.wastedMinutes && row.streak === top.streak)
      .map(row => row.memberId);
  }

  function weekBoard(occurrences, members, monday, asOf) {
    const inWeek = occurrences.filter(item => item.day >= monday && item.day <= addDays(monday, 6));
    const rows = (members || []).map(member => {
      const summary = summarizeMember(inWeek, member.id);
      return Object.assign(summary, {
        streak: currentStreak(occurrences, member.id, asOf)
      });
    });
    return { monday, rows, winners: pickWinners(rows) };
  }

  return {
    parseISO,
    localISODate,
    clockFromDate,
    addDays,
    isoDow,
    weekStart,
    eachDay,
    normTime,
    timeToMinutes,
    durationMinutes,
    pointsFor,
    wastedFor,
    resultMessage,
    expandSchedule,
    summarizeMember,
    currentStreak,
    pickWinners,
    weekBoard
  };
});
