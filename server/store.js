const { randomBytes, randomUUID } = require('crypto');
const CZ = require('../lib/scoring');
const { hashSecret, verifySecret, newToken, hashToken } = require('./auth');

const PALETTE = ['#2f7d46', '#ef6a1a', '#2f6f9f', '#8b4d9e', '#c43d5c', '#0f8b8d', '#c47b12'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanText(value, max, label) {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw httpError(400, label);
  return text;
}

function parseTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) throw httpError(400, 'Use a start and end time.');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw httpError(400, 'Use a start and end time.');
  return String(hour).padStart(2, '0') + ':' + match[2];
}

function parseDays(days) {
  if (!Array.isArray(days) || !days.length) throw httpError(400, 'Pick at least one day.');
  const unique = [...new Set(days.map(Number))].sort((a, b) => a - b);
  if (unique.length !== days.length || unique.some(day => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw httpError(400, 'Days are Monday (1) through Sunday (7).');
  }
  return unique;
}

function parsePoints(value) {
  const points = Math.round(Number(value));
  if (!Number.isInteger(points) || points < 0 || points > 100) throw httpError(400, 'Points should be from 0 to 100.');
  return points;
}

function parseEmoji(value, fallback) {
  const emoji = String(value || fallback || '🦖').trim();
  if (!emoji || emoji.length > 8) throw httpError(400, 'Pick a shorter picture.');
  return emoji;
}

function parsePin(value) {
  const pin = String(value || '').trim();
  if (!/^[0-9]{4}$/.test(pin)) throw httpError(400, 'The PIN is 4 numbers.');
  return pin;
}

function parsePassword(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 200) throw httpError(400, 'Use a password of at least 8 characters.');
  return password;
}

function parseDay(value) {
  const day = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw httpError(400, 'That day is not valid.');
  const today = new Date().toISOString().slice(0, 10);
  const earliest = CZ.addDays(today, -120);
  const latest = CZ.addDays(today, 1);
  if (day < earliest || day > latest) throw httpError(400, 'That day is outside the window.');
  return day;
}

function parseWeek(value) {
  const day = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || CZ.weekStart(day) !== day) {
    throw httpError(400, 'The prize week has to start on Monday.');
  }
  return day;
}

function inviteCode(db) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (!db.prepare('SELECT id FROM families WHERE invite_code = ?').get(code)) return code;
  }
  throw httpError(500, 'Could not make an invite code.');
}

function publicMember(row) {
  return {
    id: row.id,
    family_id: row.family_id,
    display_name: row.display_name,
    role: row.role,
    emoji: row.emoji,
    color: row.color,
    is_owner: row.is_owner === 1,
    has_pin: Boolean(row.pin_hash),
    created_at: row.created_at
  };
}

function publicSlot(row) {
  return {
    id: row.id,
    family_id: row.family_id,
    member_id: row.member_id,
    title: row.title,
    days: JSON.parse(row.days),
    start_time: row.start_time,
    end_time: row.end_time,
    points: row.points,
    active: row.active === 1,
    created_at: row.created_at
  };
}

function publicCheckin(row) {
  return {
    id: row.id,
    family_id: row.family_id,
    slot_id: row.slot_id,
    member_id: row.member_id,
    day: row.day,
    status: row.status,
    points_possible: row.points_possible,
    points_awarded: row.points_awarded,
    duration_minutes: row.duration_minutes,
    reported_role: row.reported_role,
    approved: row.approved === 1,
    created_at: row.created_at
  };
}

function createStore(db, { hashN = 16384, maxFails = 8, lockMs = 15 * 60 * 1000 } = {}) {
  const failures = new Map();

  function locked(key) {
    const row = failures.get(key);
    if (!row) return false;
    if (Date.now() - row.start > lockMs) {
      failures.delete(key);
      return false;
    }
    return row.n >= maxFails;
  }

  function noteFail(key) {
    const now = Date.now();
    const row = failures.get(key);
    if (!row || now - row.start > lockMs) {
      failures.set(key, { n: 1, start: now });
      return;
    }
    row.n += 1;
  }

  function memberById(id) {
    return db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  }

  function requireMember(memberId) {
    const member = memberById(memberId);
    if (!member) throw httpError(401, 'Sign in again.');
    return member;
  }

  function requireParent(member) {
    if (member.role !== 'parent') throw httpError(403, 'Parents only.');
    return member;
  }

  function familyOf(member) {
    const family = db.prepare('SELECT * FROM families WHERE id = ?').get(member.family_id);
    if (!family) throw httpError(401, 'Sign in again.');
    return family;
  }

  function nameTaken(familyId, name, exceptId) {
    const rows = db.prepare('SELECT id, display_name FROM members WHERE family_id = ?').all(familyId);
    return rows.some(row => row.id !== exceptId && row.display_name.toLowerCase() === name.toLowerCase());
  }

  function stateFor(member) {
    const family = familyOf(member);
    const since = CZ.addDays(new Date().toISOString().slice(0, 10), -120);
    return {
      me: publicMember(member),
      family: {
        id: family.id,
        name: family.name,
        invite_code: member.role === 'parent' ? family.invite_code : null
      },
      members: db.prepare('SELECT * FROM members WHERE family_id = ? ORDER BY created_at').all(family.id).map(publicMember),
      slots: db.prepare('SELECT * FROM slots WHERE family_id = ?').all(family.id).map(publicSlot),
      checkins: db.prepare('SELECT * FROM checkins WHERE family_id = ? AND day >= ?').all(family.id, since).map(publicCheckin),
      prizes: db.prepare('SELECT * FROM prizes WHERE family_id = ?').all(family.id)
    };
  }

  function openSession(memberId) {
    const token = newToken();
    const expires = new Date(Date.now() + SESSION_MS).toISOString();
    db.prepare('INSERT INTO sessions (token_hash, member_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), memberId, expires, new Date().toISOString());
    return token;
  }

  function memberForToken(token) {
    if (!token) return null;
    const row = db.prepare(`
      SELECT members.* FROM sessions
      JOIN members ON members.id = sessions.member_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(hashToken(token), new Date().toISOString());
    return row || null;
  }

  function endSession(token) {
    if (!token) return;
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  function createHousehold({ name, displayName, emoji, password }) {
    const familyName = cleanText(name, 80, 'The family needs a name.');
    const person = cleanText(displayName, 40, 'Add your name.');
    const secret = parsePassword(password);
    const familyId = randomUUID();
    const memberId = randomUUID();
    const now = new Date().toISOString();
    const code = inviteCode(db);
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO families (id, name, invite_code, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(familyId, familyName, code, hashSecret(secret, hashN), now);
      db.prepare(`INSERT INTO members
        (id, family_id, display_name, role, emoji, color, pin_hash, is_owner, created_at)
        VALUES (?, ?, ?, 'parent', ?, ?, NULL, 1, ?)`)
        .run(memberId, familyId, person, parseEmoji(emoji, '🦖'), PALETTE[0], now);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { token: openSession(memberId), state: stateFor(memberById(memberId)) };
  }

  function lookup(code) {
    const family = db.prepare('SELECT * FROM families WHERE invite_code = ?').get(String(code || '').trim().toUpperCase());
    if (!family) throw httpError(404, 'Invite code not found.');
    const members = db.prepare('SELECT * FROM members WHERE family_id = ? ORDER BY created_at').all(family.id).map(publicMember);
    return { code: family.invite_code, familyName: family.name, members };
  }

  function join({ code, displayName, role, emoji, pin, claimId }) {
    const family = db.prepare('SELECT * FROM families WHERE invite_code = ?').get(String(code || '').trim().toUpperCase());
    if (!family) throw httpError(404, 'Invite code not found.');
    const secret = parsePin(pin);
    const now = new Date().toISOString();
    let memberId = claimId || null;
    db.exec('BEGIN');
    try {
      if (memberId) {
        const existing = db.prepare('SELECT * FROM members WHERE id = ? AND family_id = ?').get(memberId, family.id);
        if (!existing || existing.is_owner || existing.pin_hash) throw httpError(400, 'That profile is gone.');
        db.prepare('UPDATE members SET pin_hash = ? WHERE id = ?').run(hashSecret(secret, hashN), existing.id);
      } else {
        const person = cleanText(displayName, 40, 'Add your name.');
        if (nameTaken(family.id, person)) throw httpError(400, 'Someone in the house already has that name.');
        const wanted = role === 'parent' ? 'parent' : 'kid';
        memberId = randomUUID();
        const count = db.prepare('SELECT count(*) AS n FROM members WHERE family_id = ?').get(family.id).n;
        db.prepare(`INSERT INTO members
          (id, family_id, display_name, role, emoji, color, pin_hash, is_owner, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`)
          .run(memberId, family.id, person, wanted, parseEmoji(emoji, wanted === 'parent' ? '🦖' : '🦊'), PALETTE[count % PALETTE.length], hashSecret(secret, hashN), now);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { token: openSession(memberId), state: stateFor(memberById(memberId)) };
  }

  function login({ code, memberId, secret }) {
    const family = db.prepare('SELECT * FROM families WHERE invite_code = ?').get(String(code || '').trim().toUpperCase());
    if (!family) throw httpError(404, 'Invite code not found.');
    const member = db.prepare('SELECT * FROM members WHERE id = ? AND family_id = ?').get(memberId, family.id);
    if (!member) throw httpError(404, 'Pick a name from the house.');
    const key = family.invite_code + ':' + member.id;
    if (locked(key)) throw httpError(429, 'Too many tries. Wait a bit and try again.');
    const ok = member.is_owner
      ? verifySecret(secret, family.password_hash)
      : Boolean(member.pin_hash) && verifySecret(secret, member.pin_hash);
    if (!ok) {
      noteFail(key);
      throw httpError(401, member.is_owner ? 'That password is not right.' : 'That PIN is not right.');
    }
    failures.delete(key);
    return { token: openSession(member.id), state: stateFor(member) };
  }

  function addMember(actorId, input) {
    const actor = requireParent(requireMember(actorId));
    const person = cleanText(input.displayName, 40, 'Add a name.');
    if (nameTaken(actor.family_id, person)) throw httpError(400, 'Someone in the house already has that name.');
    const role = input.role === 'parent' ? 'parent' : 'kid';
    const count = db.prepare('SELECT count(*) AS n FROM members WHERE family_id = ?').get(actor.family_id).n;
    const id = randomUUID();
    db.prepare(`INSERT INTO members
      (id, family_id, display_name, role, emoji, color, pin_hash, is_owner, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?)`)
      .run(id, actor.family_id, person, role, parseEmoji(input.emoji, role === 'parent' ? '🦖' : '🦊'), PALETTE[count % PALETTE.length], new Date().toISOString());
    return stateFor(actor);
  }

  function updateMember(actorId, memberId, input) {
    const actor = requireParent(requireMember(actorId));
    const member = db.prepare('SELECT * FROM members WHERE id = ? AND family_id = ?').get(memberId, actor.family_id);
    if (!member) throw httpError(404, 'That person is not in the house.');
    if (input.role && input.role !== 'parent' && input.role !== 'kid') throw httpError(400, 'Role has to be parent or kid.');
    const nextRole = input.role || member.role;
    if (member.is_owner && nextRole !== 'parent') throw httpError(400, 'The household parent stays a parent.');
    if (member.role === 'parent' && nextRole !== 'parent') {
      const others = db.prepare(`SELECT count(*) AS n FROM members WHERE family_id = ? AND role = 'parent' AND id <> ?`)
        .get(actor.family_id, member.id).n;
      if (!others) throw httpError(400, 'The family needs a parent.');
    }
    let name = member.display_name;
    if (input.displayName != null) {
      name = cleanText(input.displayName, 40, 'Add a name.');
      if (nameTaken(actor.family_id, name, member.id)) throw httpError(400, 'Someone in the house already has that name.');
    }
    const emoji = input.emoji != null ? parseEmoji(input.emoji, member.emoji) : member.emoji;
    db.prepare('UPDATE members SET display_name = ?, role = ?, emoji = ? WHERE id = ?').run(name, nextRole, emoji, member.id);
    return stateFor(requireMember(actorId));
  }

  function deleteMember(actorId, memberId) {
    const actor = requireParent(requireMember(actorId));
    if (actor.id === memberId) throw httpError(400, 'You cannot remove yourself.');
    const member = db.prepare('SELECT * FROM members WHERE id = ? AND family_id = ?').get(memberId, actor.family_id);
    if (!member) throw httpError(404, 'That person is not in the house.');
    if (member.is_owner) throw httpError(400, 'The household parent stays.');
    if (member.role === 'parent') {
      const others = db.prepare(`SELECT count(*) AS n FROM members WHERE family_id = ? AND role = 'parent' AND id <> ?`)
        .get(actor.family_id, member.id).n;
      if (!others) throw httpError(400, 'The family needs a parent.');
    }
    db.prepare('DELETE FROM members WHERE id = ?').run(member.id);
    return stateFor(actor);
  }

  function saveSlot(actorId, input, slotId) {
    const actor = requireParent(requireMember(actorId));
    const title = cleanText(input.title, 60, 'Give the routine a short name.');
    const start = parseTime(input.start_time || input.start);
    const end = parseTime(input.end_time || input.end);
    if (CZ.durationMinutes(start, end) <= 0) throw httpError(400, 'End time has to be after the start, on the same day.');
    const points = parsePoints(input.points);
    const days = JSON.stringify(parseDays(input.days));
    if (slotId) {
      const slot = db.prepare('SELECT * FROM slots WHERE id = ? AND family_id = ?').get(slotId, actor.family_id);
      if (!slot) throw httpError(404, 'That routine is not in the house.');
      const active = input.active == null ? slot.active : (input.active ? 1 : 0);
      db.prepare('UPDATE slots SET title = ?, days = ?, start_time = ?, end_time = ?, points = ?, active = ? WHERE id = ?')
        .run(title, days, start, end, points, active, slot.id);
    } else {
      const member = db.prepare('SELECT id FROM members WHERE id = ? AND family_id = ?').get(input.member_id, actor.family_id);
      if (!member) throw httpError(400, 'Pick someone in the house.');
      db.prepare(`INSERT INTO slots
        (id, family_id, member_id, title, days, start_time, end_time, points, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
        .run(randomUUID(), actor.family_id, member.id, title, days, start, end, points, new Date().toISOString());
    }
    return stateFor(actor);
  }

  function setSlotActive(actorId, slotId, active) {
    const actor = requireParent(requireMember(actorId));
    const slot = db.prepare('SELECT * FROM slots WHERE id = ? AND family_id = ?').get(slotId, actor.family_id);
    if (!slot) throw httpError(404, 'That routine is not in the house.');
    db.prepare('UPDATE slots SET active = ? WHERE id = ?').run(active ? 1 : 0, slot.id);
    return stateFor(actor);
  }

  function saveCheckin(actorId, input) {
    const actor = requireMember(actorId);
    const status = input.status;
    if (!['done', 'partial', 'missed'].includes(status)) throw httpError(400, 'Mark it done, half, or missed.');
    const day = parseDay(input.day);
    const slot = db.prepare('SELECT * FROM slots WHERE id = ? AND family_id = ?').get(input.slotId || input.slot_id, actor.family_id);
    if (!slot) throw httpError(404, 'That routine is not in the house.');
    if (actor.role !== 'parent' && slot.member_id !== actor.id) throw httpError(403, 'That routine is not yours.');
    const existing = db.prepare('SELECT * FROM checkins WHERE slot_id = ? AND day = ?').get(slot.id, day);
    if (existing && existing.approved && actor.role !== 'parent') {
      throw httpError(403, 'A parent already checked this one.');
    }
    const duration = CZ.durationMinutes(slot.start_time, slot.end_time);
    const awarded = CZ.pointsFor(status, slot.points);
    const now = new Date().toISOString();
    const approved = actor.role === 'parent' ? 1 : 0;
    if (existing) {
      db.prepare(`UPDATE checkins
        SET status = ?, points_possible = ?, points_awarded = ?, duration_minutes = ?,
            reported_role = ?, approved = ?, updated_at = ?
        WHERE id = ?`)
        .run(status, slot.points, awarded, duration, actor.role, approved, now, existing.id);
    } else {
      db.prepare(`INSERT INTO checkins
        (id, family_id, slot_id, member_id, day, status, points_possible, points_awarded, duration_minutes, reported_role, approved, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), slot.family_id, slot.id, slot.member_id, day, status, slot.points, awarded, duration, actor.role, approved, now, now);
    }
    return stateFor(actor);
  }

  function approveCheckin(actorId, checkinId) {
    const actor = requireParent(requireMember(actorId));
    const row = db.prepare('SELECT * FROM checkins WHERE id = ? AND family_id = ?').get(checkinId, actor.family_id);
    if (!row) throw httpError(404, 'That check-in is not in the house.');
    db.prepare('UPDATE checkins SET approved = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
    return stateFor(actor);
  }

  function savePrize(actorId, input) {
    const actor = requireParent(requireMember(actorId));
    const week = parseWeek(input.weekStart || input.week_start);
    const prize = cleanText(input.prize, 140, 'Write the prize first.');
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO prizes (family_id, week_start, prize, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (family_id, week_start) DO UPDATE SET prize = excluded.prize, updated_at = excluded.updated_at`)
      .run(actor.family_id, week, prize, now);
    return stateFor(actor);
  }

  function renameFamily(actorId, name) {
    const actor = requireParent(requireMember(actorId));
    const next = cleanText(name, 80, 'The family needs a name.');
    db.prepare('UPDATE families SET name = ? WHERE id = ?').run(next, actor.family_id);
    return stateFor(actor);
  }

  function regenerateInvite(actorId) {
    const actor = requireParent(requireMember(actorId));
    const code = inviteCode(db);
    db.prepare('UPDATE families SET invite_code = ? WHERE id = ?').run(code, actor.family_id);
    return stateFor(actor);
  }

  return {
    httpError,
    stateFor,
    memberForToken,
    endSession,
    createHousehold,
    lookup,
    join,
    login,
    addMember,
    updateMember,
    deleteMember,
    saveSlot,
    setSlotActive,
    saveCheckin,
    approveCheckin,
    savePrize,
    renameFamily,
    regenerateInvite
  };
}

module.exports = { createStore, httpError };
