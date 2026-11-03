(function () {
  const CZ = window.Chorezilla;
  const DEMO_KEY = 'chorezilla-demo-v1';
  const SCREENS = ['today', 'week', 'board', 'wasted', 'family'];
  const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const EMOJIS = ['🦖', '🦊', '🐻', '🐱', '🐼', '🐸', '🦄', '🐙', '🐯', '🐧'];
  const PALETTE = ['#2f7d46', '#ef6a1a', '#2f6f9f', '#8b4d9e', '#c43d5c', '#0f8b8d', '#c47b12'];
  const TEMPLATES = [
    { title: 'Wake up', days: [1, 2, 3, 4, 5], start_time: '07:00', end_time: '07:15', points: 5 },
    { title: 'Make your bed', days: [1, 2, 3, 4, 5, 6, 7], start_time: '07:15', end_time: '07:25', points: 5 },
    { title: 'Homework', days: [1, 2, 3, 4, 5], start_time: '16:00', end_time: '17:00', points: 15 },
    { title: 'Reading', days: [1, 2, 3, 4, 5, 6, 7], start_time: '19:00', end_time: '19:30', points: 10 },
    { title: 'Chores', days: [1, 2, 3, 4, 5, 6], start_time: '17:00', end_time: '17:30', points: 10 },
    { title: 'Screens off', days: [1, 2, 3, 4, 5], start_time: '18:00', end_time: '18:30', points: 5 },
    { title: 'Practice', days: [2, 4], start_time: '16:30', end_time: '17:15', points: 10 },
    { title: 'Bedtime', days: [1, 2, 3, 4, 5], start_time: '20:30', end_time: '21:00', points: 10 }
  ];

  const state = {
    ready: false,
    booting: true,
    busy: false,
    mode: 'demo',
    screen: 'today',
    authPanel: 'email',
    family: null,
    members: [],
    slots: [],
    checkins: [],
    prizes: [],
    meId: null,
    selectedId: null,
    focusDay: null,
    viewWeek: null,
    editor: null,
    join: null,
    api: false,
    loginMember: null,
    claimId: null,
    error: ''
  };

  let toastTimer = 0;
  let renderedScreen = '';

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function toast(text, tone) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.className = 'show ' + (tone || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 4200);
  }

  function uid() {
    return crypto.randomUUID();
  }

  function me() {
    return state.members.find(member => member.id === state.meId) || null;
  }

  function isParent() {
    return Boolean(me() && me().role === 'parent');
  }

  function memberName(id) {
    const member = state.members.find(item => item.id === id);
    return member ? member.display_name : 'Someone';
  }

  function orderedMembers() {
    return state.members.slice().sort((a, b) => {
      if (a.role !== b.role) return a.role === 'kid' ? -1 : 1;
      return a.display_name.localeCompare(b.display_name);
    });
  }

  function selectedMemberId() {
    const self = me();
    if (!self) return null;
    if (self.role === 'kid') return self.id;
    if (state.selectedId && state.members.some(member => member.id === state.selectedId)) return state.selectedId;
    const kid = state.members.find(member => member.role === 'kid');
    return (kid || self).id;
  }

  function normalizeSlot(slot) {
    return {
      id: slot.id,
      family_id: slot.family_id,
      member_id: slot.member_id,
      title: slot.title,
      days: (slot.days || []).map(Number),
      start_time: CZ.normTime(slot.start_time),
      end_time: CZ.normTime(slot.end_time),
      points: Number(slot.points) || 0,
      active: slot.active !== false,
      created_on: slot.created_on || (slot.created_at ? CZ.localISODate(new Date(slot.created_at)) : '1970-01-01'),
      created_at: slot.created_at || null
    };
  }

  function normalizeCheckin(row) {
    const awarded = Number(row.points_awarded);
    const possible = Number(row.points_possible);
    const duration = Number(row.duration_minutes);
    return {
      id: row.id,
      family_id: row.family_id,
      slot_id: row.slot_id,
      member_id: row.member_id,
      day: String(row.day).slice(0, 10),
      status: row.status,
      points_awarded: Number.isFinite(awarded) ? awarded : null,
      points_possible: Number.isFinite(possible) ? possible : null,
      duration_minutes: Number.isFinite(duration) ? duration : null,
      reported_role: row.reported_role || null,
      approved: Boolean(row.approved)
    };
  }

  function schedule() {
    const now = CZ.clockFromDate(new Date());
    const occ = CZ.expandSchedule({
      slots: state.slots.map(normalizeSlot),
      checkins: state.checkins.map(normalizeCheckin),
      from: CZ.addDays(now.date, -120),
      to: now.date,
      clock: now
    });
    const monday = CZ.weekStart(now.date);
    return { now, occ, monday, board: CZ.weekBoard(occ, state.members, monday, now.date) };
  }

  function focusDay(now) {
    const monday = CZ.weekStart(now.date);
    if (!state.focusDay || state.focusDay < monday || state.focusDay > now.date) return now.date;
    return state.focusDay;
  }

  function viewedMonday(now) {
    const current = CZ.weekStart(now.date);
    if (!state.viewWeek || state.viewWeek > current) return current;
    return state.viewWeek;
  }

  function prizeFor(monday) {
    const row = state.prizes.find(item => String(item.week_start).slice(0, 10) === monday);
    return row ? row.prize : '';
  }

  function formatTime(value) {
    const [h, m] = CZ.normTime(value).split(':').map(Number);
    const suffix = h >= 12 ? 'pm' : 'am';
    return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + suffix;
  }

  function formatLong(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC'
    });
  }

  function formatShort(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'UTC'
    });
  }

  function formatDuration(mins) {
    const m = Math.max(0, Math.round(mins));
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (!h) return r === 1 ? '1 min' : r + ' min';
    if (!r) return h === 1 ? '1 hour' : h + ' hours';
    return h + ' hr ' + r + ' min';
  }

  function dayList(days) {
    return days.slice().sort((a, b) => a - b).map(day => DAY_SHORT[day - 1]).join(' ');
  }

  function mascot() {
    return '<svg class="mascot" viewBox="0 0 64 64" aria-hidden="true"><path d="M18 24 22 12l5 9 5-12 5 12 5-9 4 12" fill="#f0b429"/><ellipse cx="32" cy="38" rx="20" ry="17" fill="#3faf5a"/><ellipse cx="32" cy="43" rx="12" ry="10" fill="#c6efb4"/><circle cx="24" cy="36" r="3.4" fill="#173528"/><circle cx="40" cy="36" r="3.4" fill="#173528"/><circle cx="25.2" cy="34.8" r="1.2" fill="#fff"/><circle cx="41.2" cy="34.8" r="1.2" fill="#fff"/><path d="M25 45c2.4 3.2 11.6 3.2 14 0" fill="none" stroke="#173528" stroke-width="2.2" stroke-linecap="round"/><rect x="30" y="44.2" width="3.4" height="4.2" rx="1" fill="#fff"/></svg>';
  }

  function persist() {
    if (state.mode !== 'demo') return;
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify({
        version: 1,
        meId: state.meId,
        selectedId: state.selectedId,
        focusDay: state.focusDay,
        family: state.family,
        members: state.members,
        slots: state.slots,
        checkins: state.checkins,
        prizes: state.prizes
      }));
    } catch (err) { /* private mode */ }
  }

  function loadDemo(reset) {
    let data = null;
    if (!reset) {
      try {
        const raw = localStorage.getItem(DEMO_KEY);
        if (raw) data = JSON.parse(raw);
      } catch (err) { data = null; }
    }
    if (!data || data.version !== 1 || !data.family || !Array.isArray(data.slots)) {
      data = window.ChorezillaDemo.build(new Date());
    }
    state.mode = 'demo';
    state.family = data.family;
    state.members = data.members;
    state.slots = data.slots;
    state.checkins = data.checkins;
    state.prizes = data.prizes || [];
    state.meId = data.meId || 'm-mia';
    state.selectedId = data.selectedId || null;
    state.focusDay = data.focusDay || null;
    persist();
  }

  function fail(err) {
    const message = (err && err.message) || 'Something went wrong';
    state.error = message;
    toast(message, 'bad');
  }

  async function withBusy(fn) {
    if (state.busy) return;
    state.busy = true;
    try {
      await fn();
    } catch (err) {
      fail(err);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function api(path, options) {
    const opts = options || {};
    const res = await fetch(path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (err) { data = { error: text }; }
    }
    if (!res.ok) {
      const error = new Error((data && data.error) || 'Something went wrong');
      error.status = res.status;
      throw error;
    }
    return data;
  }

  function applyState(data) {
    state.mode = 'live';
    state.family = data.family;
    state.members = data.members || [];
    state.slots = (data.slots || []).map(normalizeSlot);
    state.checkins = (data.checkins || []).map(normalizeCheckin);
    state.prizes = (data.prizes || []).map(row => Object.assign({}, row, {
      week_start: String(row.week_start).slice(0, 10)
    }));
    state.meId = data.me.id;
  }

  async function refresh() {
    applyState(await api('/api/state'));
  }

  function showAuthScreen() {
    state.screen = 'auth';
    state.authPanel = 'home';
    state.mode = 'demo';
    state.family = null;
    state.members = [];
    state.slots = [];
    state.checkins = [];
    state.prizes = [];
    state.meId = null;
    state.join = null;
    state.loginMember = null;
    state.claimId = null;
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    render();
  }

  function goto(screen) {
    if (!SCREENS.includes(screen)) return;
    state.editor = null;
    if (location.hash === '#' + screen) {
      state.screen = screen;
      render();
      return;
    }
    location.hash = screen;
  }

  function onHash() {
    const name = location.hash.replace('#', '');
    if (!SCREENS.includes(name) || !state.family) return;
    state.screen = name;
    state.editor = null;
    render();
  }

  function findCheckin(slotId, day) {
    return state.checkins.find(item => item.slot_id === slotId && String(item.day).slice(0, 10) === day);
  }

  async function mark(slotId, day, status) {
    const slot = state.slots.map(normalizeSlot).find(item => item.id === slotId);
    if (!slot || !['done', 'partial', 'missed'].includes(status)) return;
    const self = me();
    if (!self) return;
    if (self.role === 'kid' && slot.member_id !== self.id) return;
    const existing = findCheckin(slotId, day);
    if (existing && existing.approved && self.role !== 'parent') {
      toast('A parent already checked this one.', 'mid');
      return;
    }
    const duration = CZ.durationMinutes(slot.start_time, slot.end_time);
    const message = CZ.resultMessage(status, slot.points, duration);
    await withBusy(async () => {
      if (state.mode === 'demo') {
        const row = {
          id: existing ? existing.id : uid(),
          family_id: state.family.id,
          slot_id: slot.id,
          member_id: slot.member_id,
          day,
          status,
          points_possible: slot.points,
          points_awarded: CZ.pointsFor(status, slot.points),
          duration_minutes: duration,
          reported_role: self.role,
          approved: self.role === 'parent'
        };
        if (existing) {
          const index = state.checkins.findIndex(item => item.id === existing.id);
          state.checkins[index] = row;
        } else state.checkins.push(row);
        persist();
      } else {
        applyState(await api('/api/checkins', { method: 'POST', body: { slotId, day, status } }));
      }
      toast(message.text, message.tone);
    });
  }

  async function approve(id) {
    if (!isParent()) return;
    await withBusy(async () => {
      if (state.mode === 'demo') {
        const row = state.checkins.find(item => item.id === id);
        if (row) row.approved = true;
        persist();
      } else {
        applyState(await api('/api/checkins/' + encodeURIComponent(id) + '/approve', { method: 'POST' }));
      }
      toast('Checked. The points stay.', 'good');
    });
  }

  function readSlot(form) {
    const title = String(new FormData(form).get('title') || '').trim();
    const start = String(new FormData(form).get('start') || '');
    const end = String(new FormData(form).get('end') || '');
    const points = Math.round(Number(form.points.value));
    const days = [...form.querySelectorAll('input[name=day]:checked')].map(input => Number(input.value));
    if (!title || title.length > 60) return { error: 'Give the routine a short name.' };
    if (!start || !end || CZ.durationMinutes(start, end) <= 0) return { error: 'End time has to be after the start, on the same day.' };
    if (!Number.isFinite(points) || points < 0 || points > 100) return { error: 'Points should be from 0 to 100.' };
    if (!days.length) return { error: 'Pick at least one day.' };
    return { title, start, end, points, days };
  }

  async function saveSlot(form) {
    const parsed = readSlot(form);
    if (parsed.error) { toast(parsed.error, 'bad'); return; }
    const editor = state.editor || {};
    await withBusy(async () => {
      if (state.mode === 'demo') {
        if (editor.id) {
          const row = state.slots.find(item => item.id === editor.id);
          Object.assign(row, {
            title: parsed.title,
            days: parsed.days,
            start_time: parsed.start,
            end_time: parsed.end,
            points: parsed.points
          });
        } else {
          const today = CZ.clockFromDate(new Date()).date;
          state.slots.push({
            id: uid(),
            family_id: state.family.id,
            member_id: editor.member_id,
            title: parsed.title,
            days: parsed.days,
            start_time: parsed.start,
            end_time: parsed.end,
            points: parsed.points,
            active: true,
            created_on: today,
            created_at: new Date().toISOString()
          });
        }
        persist();
      } else if (editor.id) {
        applyState(await api('/api/slots/' + encodeURIComponent(editor.id), {
          method: 'PATCH',
          body: {
            title: parsed.title,
            days: parsed.days,
            start_time: parsed.start,
            end_time: parsed.end,
            points: parsed.points
          }
        }));
      } else {
        applyState(await api('/api/slots', {
          method: 'POST',
          body: {
            member_id: editor.member_id,
            title: parsed.title,
            days: parsed.days,
            start_time: parsed.start,
            end_time: parsed.end,
            points: parsed.points
          }
        }));
      }
      state.editor = null;
      toast('Routine saved.', 'good');
    });
  }

  async function setActive(id, active) {
    await withBusy(async () => {
      if (state.mode === 'demo') {
        const row = state.slots.find(item => item.id === id);
        if (row) row.active = active;
        persist();
      } else {
        applyState(await api('/api/slots/' + encodeURIComponent(id), { method: 'PATCH', body: { active } }));
      }
      toast(active ? 'Routine is back.' : 'Routine archived.', 'good');
    });
  }

  async function savePrize(form, monday) {
    const prize = String(new FormData(form).get('prize') || '').trim().slice(0, 140);
    if (!prize) { toast('Write the prize first.', 'bad'); return; }
    await withBusy(async () => {
      if (state.mode === 'demo') {
        const index = state.prizes.findIndex(item => item.week_start === monday);
        const row = { family_id: state.family.id, week_start: monday, prize };
        if (index >= 0) state.prizes[index] = row;
        else state.prizes.push(row);
        persist();
      } else {
        applyState(await api('/api/prizes', { method: 'PUT', body: { weekStart: monday, prize } }));
      }
      toast('Prize saved. Make it something they want.', 'good');
    });
  }

  async function renameFamily(form) {
    const name = String(new FormData(form).get('name') || '').trim().slice(0, 80);
    if (!name) { toast('The family needs a name.', 'bad'); return; }
    await withBusy(async () => {
      if (state.mode === 'demo') {
        state.family = Object.assign({}, state.family, { name });
        persist();
      } else {
        applyState(await api('/api/family', { method: 'PATCH', body: { name } }));
      }
      toast('Name saved.', 'good');
    });
  }

  async function addMember(form) {
    const name = String(new FormData(form).get('name') || '').trim().slice(0, 40);
    const role = form.role && form.role.value === 'parent' ? 'parent' : 'kid';
    const emoji = String(new FormData(form).get('emoji') || (role === 'parent' ? '🦖' : '🦊'));
    if (!name) { toast('Add a name.', 'bad'); return; }
    const color = PALETTE[state.members.length % PALETTE.length];
    await withBusy(async () => {
      if (state.mode === 'demo') {
        state.members.push({
          id: uid(),
          family_id: state.family.id,
          user_id: null,
          display_name: name,
          role,
          emoji,
          color,
          created_at: new Date().toISOString()
        });
        persist();
      } else {
        applyState(await api('/api/members', { method: 'POST', body: { displayName: name, role, emoji } }));
      }
      form.reset();
      toast(name + ' is in the house.', 'good');
    });
  }

  async function saveRole(id, role) {
    if (role !== 'parent' && role !== 'kid') return;
    if (role === 'kid' && !state.members.some(member => member.role === 'parent' && member.id !== id)) {
      toast('The family needs a parent.', 'bad');
      render();
      return;
    }
    await withBusy(async () => {
      if (state.mode === 'demo') {
        const member = state.members.find(item => item.id === id);
        if (member) member.role = role;
        persist();
      } else {
        applyState(await api('/api/members/' + encodeURIComponent(id), { method: 'PATCH', body: { role } }));
      }
    });
  }

  async function deleteMember(id) {
    const member = state.members.find(item => item.id === id);
    if (!member || member.id === state.meId) return;
    if (member.role === 'parent' && state.members.filter(item => item.role === 'parent').length < 2) {
      toast('The family needs a parent.', 'bad');
      return;
    }
    if (!confirm('Remove ' + member.display_name + '? Their routines and points go too.')) return;
    await withBusy(async () => {
      if (state.mode === 'demo') {
        state.members = state.members.filter(item => item.id !== id);
        const slotIds = new Set(state.slots.filter(item => item.member_id === id).map(item => item.id));
        state.slots = state.slots.filter(item => item.member_id !== id);
        state.checkins = state.checkins.filter(item => !slotIds.has(item.slot_id));
        persist();
      } else {
        applyState(await api('/api/members/' + encodeURIComponent(id), { method: 'DELETE' }));
      }
      if (state.selectedId === id) state.selectedId = null;
      toast(member.display_name + ' left the board.', 'mid');
    });
  }

  async function regenerate() {
    if (!confirm('Make a new invite code? The old one will stop working.')) return;
    await withBusy(async () => {
      if (state.mode === 'demo') {
        state.family = Object.assign({}, state.family, { invite_code: uid().slice(0, 6).toUpperCase() });
        persist();
      } else {
        applyState(await api('/api/invite', { method: 'POST' }));
      }
      toast('New invite code ready.', 'good');
    });
  }

  async function copyCode() {
    const code = state.family && state.family.invite_code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast('Invite code copied.', 'good');
    } catch (err) {
      toast('Code: ' + code, 'mid');
    }
  }

  function openEditor(slot) {
    const memberId = slot ? slot.member_id : selectedMemberId();
    state.editor = slot ? {
      id: slot.id,
      member_id: memberId,
      title: slot.title,
      days: slot.days.slice(),
      start_time: CZ.normTime(slot.start_time),
      end_time: CZ.normTime(slot.end_time),
      points: slot.points
    } : {
      id: null,
      member_id: memberId,
      title: '',
      days: [1, 2, 3, 4, 5],
      start_time: '16:00',
      end_time: '16:30',
      points: 10
    };
    render();
    const el = document.getElementById('editor');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function applyTemplate(index) {
    const template = TEMPLATES[index];
    if (!template || !state.editor) return;
    state.editor = Object.assign({}, state.editor, {
      title: template.title,
      days: template.days.slice(),
      start_time: template.start_time,
      end_time: template.end_time,
      points: template.points
    });
    render();
  }

  function stake(occ) {
    if (occ.status === 'pending') {
      return '<p class="stake">Worth ' + occ.fullPoints + ' points · ' + occ.duration + ' min</p>';
    }
    const message = CZ.resultMessage(occ.status, occ.fullPoints, occ.duration);
    return '<p class="stake ' + message.tone + '">' + esc(message.text) + '</p>';
  }

  function heroHtml() {
    const person = me();
    const demo = state.mode === 'demo';
    const asButtons = demo ? state.members.map(member =>
      '<button type="button" data-act="view-as" data-id="' + esc(member.id) + '" class="' + (member.id === state.meId ? 'on' : '') + '">' +
      esc(member.emoji) + ' ' + esc(member.display_name) + '</button>'
    ).join('') : '';
    return '<header class="hero"><div class="hero-inner"><div class="brand">' + mascot() +
      '<div><p class="word">CHORE<b>ZILLA</b></p><p class="tag">Routines. Points. A crown.</p></div></div>' +
      '<div class="family-line"><strong>' + esc(state.family.name) + '</strong>' +
      (demo ? '<span class="demo-pill">Sample family · this device</span>' : '<span class="pill-note">Hi, ' + esc(person ? person.display_name : '') + '</span>') +
      '</div>' +
      (demo ? '<div class="as"><span>See it as</span>' + asButtons + '</div>' : '') +
      '</div></header>';
  }

  function stripHtml(model) {
    const winners = new Set(model.board.winners);
    return '<div class="strip">' + model.board.rows.slice().sort((a, b) => b.points - a.points).map(row => {
      const member = state.members.find(item => item.id === row.memberId);
      if (!member) return '';
      return '<button type="button" class="score' + (winners.has(member.id) ? ' on' : '') + '" data-act="nav" data-screen="board" style="--c:' + esc(member.color) + '">' +
        '<span class="av">' + esc(member.emoji) + '</span><span class="score-name"><strong>' + esc(member.display_name) +
        '</strong><em>' + row.points + ' pts' + (winners.has(member.id) ? ' 👑' : '') + '</em></span></button>';
    }).join('') + '</div>';
  }

  function peopleHtml() {
    if (!isParent()) return '';
    const current = selectedMemberId();
    return '<div class="people" role="group" aria-label="Whose routines">' + orderedMembers().map(member =>
      '<button type="button" data-act="pick-member" data-id="' + esc(member.id) + '" class="' + (member.id === current ? 'on' : '') + '">' +
      '<span class="av" style="--c:' + esc(member.color) + '">' + esc(member.emoji) + '</span>' + esc(member.display_name) + '</button>'
    ).join('') + '</div>';
  }

  function todayHtml(model) {
    const memberId = selectedMemberId();
    const member = state.members.find(item => item.id === memberId);
    const day = focusDay(model.now);
    const monday = model.monday;
    const days = CZ.eachDay(monday, CZ.addDays(monday, 6));
    const mine = model.occ.filter(item => item.memberId === memberId && item.day === day)
      .sort((a, b) => a.start.localeCompare(b.start));
    const earned = mine.reduce((sum, item) => sum + (item.status === 'pending' ? 0 : item.pointsAwarded), 0);
    const open = mine.filter(item => item.status === 'pending').reduce((sum, item) => sum + item.fullPoints, 0);
    const summary = open
      ? earned + ' pts so far · ' + open + ' still open'
      : (mine.length ? earned + ' pts today' : '');
    const datebar = '<div class="datebar">' + days.map(iso => {
      const future = iso > model.now.date;
      return '<button type="button" data-act="pick-day" data-day="' + iso + '"' +
        (future ? ' disabled' : '') + ' class="' + (iso === day ? 'on' : '') + '">' +
        DAY_SHORT[CZ.isoDow(iso) - 1] + '<small>' + Number(iso.slice(8)) + '</small></button>';
    }).join('') + '</div>';
    const cards = mine.length ? mine.map(occ => cardHtml(occ)).join('') :
      '<div class="empty">' + mascot() + '<h2>Nothing on this day</h2><p>No routines for ' + esc(member ? member.display_name : 'them') + '.</p>' +
      (isParent() ? '<button type="button" class="btn primary" data-act="nav" data-screen="week">Build the week</button>' : '') + '</div>';
    const banner = state.mode === 'demo' && state.api
      ? '<p class="banner">This is the sample house. <button type="button" data-act="show-auth">Sign in</button></p>'
      : '';
    return banner + '<h1>' + esc(member ? member.display_name : '') + '\'s day</h1><p class="sub">' +
      esc(formatLong(day)) + (summary ? ' · ' + summary : '') + '</p>' + datebar + peopleHtml() +
      '<p class="hint">Done earns the points. Half is late. Missed spends the minutes.</p>' + cards;
  }

  function cardHtml(occ) {
    const locked = occ.approved && !isParent();
    const half = CZ.pointsFor('partial', occ.fullPoints);
    const choices = locked ? '' :
      '<div class="choices">' +
      choiceBtn(occ, 'done', 'Done', '+' + occ.fullPoints) +
      choiceBtn(occ, 'partial', 'Half', '+' + half) +
      choiceBtn(occ, 'missed', 'Missed', '0') +
      '</div>';
    let note = '';
    if (locked) note = '<p class="locknote">A parent checked this.</p>';
    else if (!occ.id && occ.status === 'missed') note = '<p class="locknote">Not tapped. Counted as a miss.</p>';
    else if (occ.id && occ.reportedRole === 'kid' && !occ.approved) {
      note = isParent()
        ? '<p class="locknote">' + esc(memberName(occ.memberId)) + ' says ' + esc(occ.status) + '.</p>' +
          '<button type="button" class="btn primary tiny approve" data-act="approve" data-id="' + esc(occ.id) + '">Looks right</button>'
        : '<p class="locknote">Waiting for a parent to check this.</p>';
    } else if (occ.approved && occ.reportedRole === 'parent') note = '<p class="locknote">A parent logged this.</p>';
    else if (occ.approved) note = '<p class="locknote">A parent checked this.</p>';
    return '<article class="card ' + esc(occ.status) + '"><p class="when">' + formatTime(occ.start) + ' – ' + formatTime(occ.end) +
      ' · ' + occ.duration + ' min</p><h3>' + esc(occ.title) + '</h3>' + stake(occ) + choices + note + '</article>';
  }

  function choiceBtn(occ, status, label, sub) {
    const on = occ.status === status ? ' on' : '';
    return '<button type="button" class="choice ' + status + on + '" data-act="mark" data-id="' + esc(occ.slotId) +
      '" data-day="' + esc(occ.day) + '" data-status="' + status + '" aria-label="' + esc(label + ' ' + occ.title) +
      '" aria-pressed="' + (on ? 'true' : 'false') + '"><b>' +
      label + '</b><small>' + sub + '</small></button>';
  }

  function weekHtml() {
    const memberId = selectedMemberId();
    const member = state.members.find(item => item.id === memberId);
    const slots = state.slots.map(normalizeSlot).filter(slot => slot.member_id === memberId && slot.active)
      .sort((a, b) => a.start_time.localeCompare(b.start_time) || a.title.localeCompare(b.title));
    const archived = state.slots.map(normalizeSlot).filter(slot => slot.member_id === memberId && !slot.active);
    const rows = slots.length ? slots.map(slot =>
      '<article class="card"><div class="slotrow"><div><h3>' + esc(slot.title) + '</h3><p>' +
      formatTime(slot.start_time) + ' – ' + formatTime(slot.end_time) + ' · ' + esc(dayList(slot.days)) +
      ' · ' + slot.points + ' pts</p></div>' +
      (isParent() ? '<button type="button" class="icon-btn" data-act="edit-slot" data-id="' + esc(slot.id) + '">Edit</button>' : '') +
      '</div></article>'
    ).join('') : '<div class="empty">' + mascot() + '<h2>No routines yet</h2><p>Add wake up, homework, reading, chores, screens, bedtime.</p></div>';
    const archivedHtml = archived.length && isParent()
      ? '<details class="rules"><summary>Archived (' + archived.length + ')</summary>' + archived.map(slot =>
        '<div class="slotrow"><p>' + esc(slot.title) + '</p><button type="button" class="btn tiny" data-act="restore" data-id="' + esc(slot.id) + '">Restore</button></div>'
      ).join('') + '</details>'
      : '';
    return '<h1>' + esc(member ? member.display_name : '') + '\'s week</h1><p class="sub">The same routines repeat each week.</p>' +
      peopleHtml() +
      (isParent() ? '<button type="button" class="btn primary" data-act="new-slot">Add a routine</button>' : '') +
      rows + editorHtml() + archivedHtml;
  }

  function editorHtml() {
    if (!state.editor || !isParent()) return '';
    const editor = state.editor;
    const days = [1, 2, 3, 4, 5, 6, 7].map(day =>
      '<label class="day">' + DAY_SHORT[day - 1] +
      '<input type="checkbox" name="day" value="' + day + '"' + (editor.days.includes(day) ? ' checked' : '') + '></label>'
    ).join('');
    const chips = TEMPLATES.map((template, index) =>
      '<button type="button" class="chip" data-act="template" data-i="' + index + '">' + esc(template.title) + '</button>'
    ).join('');
    return '<form class="editor" id="editor" data-form="slot"><h2>' + (editor.id ? 'Edit routine' : 'New routine') +
      '</h2><p class="sub">For ' + esc(memberName(editor.member_id)) + '. A new routine starts today, so it does not punish last week.</p>' +
      '<div class="templates">' + chips + '</div>' +
      '<label class="field">Name<input name="title" maxlength="60" required value="' + esc(editor.title) + '"></label>' +
      '<div class="days">' + days + '</div>' +
      '<div class="row2"><label class="field">Start<input type="time" name="start" required value="' + esc(editor.start_time) + '"></label>' +
      '<label class="field">End<input type="time" name="end" required value="' + esc(editor.end_time) + '"></label></div>' +
      '<label class="field">Points if done<input name="points" type="number" min="0" max="100" required value="' + esc(editor.points) + '"></label>' +
      '<div class="actions"><button class="btn primary" type="submit">Save routine</button>' +
      '<button class="btn ghost" type="button" data-act="close-editor">Cancel</button>' +
      (editor.id ? '<button class="btn danger" type="button" data-act="archive" data-id="' + esc(editor.id) + '">Archive</button>' : '') +
      '</div></form>';
  }

  function boardHtml(model) {
    const monday = viewedMonday(model.now);
    const sunday = CZ.addDays(monday, 6);
    const asOf = monday === model.monday ? model.now.date : sunday;
    const board = CZ.weekBoard(model.occ, state.members, monday, asOf);
    const prize = prizeFor(monday);
    const names = board.winners.map(memberName);
    let crown = '<div class="winner"><div class="crown-badge">👑</div><h2>No crown yet</h2><p>Points start when a routine is finished, or when its time runs out.</p></div>';
    if (names.length === 1) {
      crown = '<div class="winner"><span class="spark" aria-hidden="true"></span><div class="crown-badge">👑</div><h2>' +
        esc(names[0]) + ' wears the crown</h2><p>' + (prize ? 'Prize: ' + esc(prize) : 'Parents still need to name the prize.') + '</p></div>';
    } else if (names.length > 1) {
      crown = '<div class="winner"><span class="spark" aria-hidden="true"></span><div class="crown-badge">👑</div><h2>' +
        esc(joinNames(names)) + ' share the crown</h2><p>Share the prize' + (prize ? ': ' + esc(prize) : '') + '.</p></div>';
    }
    const rows = rankRows(board.rows).map((row, index) => {
      const member = state.members.find(item => item.id === row.memberId);
      if (!member) return '';
      const streak = row.streak > 0 ? '🔥 ' + row.streak + '-day streak' : (row.scoredCount ? 'Streak ready to restart' : 'Nothing scored yet');
      return '<article class="rank"><div class="pos">' + (board.winners.includes(member.id) ? '👑' : String(index + 1)) +
        '</div><span class="av" style="--c:' + esc(member.color) + '">' + esc(member.emoji) + '</span><div class="grow"><h3>' +
        esc(member.display_name) + '</h3><p class="sub">' + row.points + ' pts · ' + row.wastedMinutes + ' min lost · ' + streak + '</p></div></article>';
    }).join('');
    const past = pastWeeks(model.occ, model.monday);
    const history = past.length ? '<h2>Earlier weeks</h2><div class="weeklist">' + past.map(week => {
      const old = CZ.weekBoard(model.occ, state.members, week, CZ.addDays(week, 6));
      const label = old.winners.length ? 'Crown: ' + joinNames(old.winners.map(memberName)) : 'No crown';
      const oldPrize = prizeFor(week);
      return '<button type="button" data-act="week" data-week="' + week + '"><strong>Week of ' + esc(formatShort(week)) +
        '</strong><br>' + esc(label) + (oldPrize ? ' · ' + esc(oldPrize) : '') + '</button>';
    }).join('') + '</div>' : '';
    const looking = monday === model.monday ? '' :
      '<p class="banner">Looking at the week of ' + esc(formatShort(monday)) +
      '. <button type="button" data-act="this-week">Back to this week</button></p>';
    const prizeForm = isParent()
      ? '<form data-form="prize" data-week="' + monday + '" class="field">Set the prize<input name="prize" maxlength="140" value="' +
        esc(prize) + '" placeholder="Movie pick, ice cream, park trip"><button class="btn primary" type="submit">Save prize</button></form>'
      : (names.length ? '' : '<p class="hint">Parents have not set a prize yet.</p>');
    return looking + '<h1>' + (monday === model.monday ? 'This week' : 'Week of ' + esc(formatShort(monday))) + '</h1>' +
      '<p class="sub">' + esc(formatShort(monday)) + ' – ' + esc(formatShort(sunday)) + '</p>' +
      crown + prizeForm + rows + history + rulesHtml();
  }

  function rulesHtml() {
    return '<details class="rules"><summary>How points work</summary>' +
      '<p>Done earns every point. Half is for late or unfinished, rounded half up, so 5 points becomes 3 and 15 becomes 8. Missed earns nothing. The minutes and the points you skipped show on Time.</p>' +
      '<p>The crown is the most points that week. A tie goes to fewer wasted minutes, then the longer streak. A streak day means every routine was Done. Today does not break a streak while routines are still open and nothing was missed or half.</p>' +
      '<p>An empty day does not count. A routine only starts costing points from the day it was added.</p></details>';
  }

  function wastedHtml(model) {
    const monday = viewedMonday(model.now);
    const sunday = CZ.addDays(monday, 6);
    const asOf = monday === model.monday ? model.now.date : sunday;
    const board = CZ.weekBoard(model.occ, state.members, monday, asOf);
    const inWeek = model.occ.filter(item => item.day >= monday && item.day <= sunday && item.status !== 'pending');
    const minutes = board.rows.reduce((sum, row) => sum + row.wastedMinutes, 0);
    const cost = board.rows.reduce((sum, row) => sum + row.pointsCost, 0);
    const costLabel = cost === 1 ? '1 point' : cost + ' points';
    const headline = minutes
      ? 'The house let ' + formatDuration(minutes) + ' wander off. That cost ' + costLabel + '.'
      : 'Nothing wandered off. Chorezilla is proud.';
    const worst = board.rows.slice().sort((a, b) => b.wastedMinutes - a.wastedMinutes)[0];
    const jab = worst && worst.wastedMinutes > 0 ? memberName(worst.memberId) + ' left the most time on the table.' : '';
    const cards = orderedMembers().map(member => {
      const row = board.rows.find(item => item.memberId === member.id) || { wastedMinutes: 0, pointsCost: 0, scheduledMinutes: 0 };
      const width = row.scheduledMinutes ? Math.min(100, Math.round(row.wastedMinutes / row.scheduledMinutes * 100)) : 0;
      const lines = inWeek.filter(item => item.memberId === member.id && (item.status === 'missed' || item.status === 'partial'));
      const list = lines.length ? lines.map(item =>
        '<div class="missrow"><span>' + esc(formatShort(item.day)) + ' · ' + esc(item.title) +
        (item.status === 'partial' ? ' · half' : '') + '</span><span>' + item.wastedMinutes + ' min = ' + item.pointsCost + ' pts</span></div>'
      ).join('') : '<p class="sub">Clean week.</p>';
      return '<article class="membercard"><div class="who"><span class="av" style="--c:' + esc(member.color) + '">' +
        esc(member.emoji) + '</span><div><h3>' + esc(member.display_name) + '</h3><p class="sub">' +
        formatDuration(row.wastedMinutes) + ' lost · ' + row.pointsCost + ' points left behind</p></div></div>' +
        '<div class="meter" role="img" aria-label="Wasted ' + width + ' percent"><span style="width:' + width + '%"></span></div>' + list + '</article>';
    }).join('');
    const past = pastWeeks(model.occ, model.monday);
    const jumps = '<div class="datebar"><button type="button" data-act="this-week" class="' + (monday === model.monday ? 'on' : '') + '">This week</button>' +
      past.slice(0, 6).map(week => '<button type="button" data-act="week" data-week="' + week + '" class="' + (week === monday ? 'on' : '') + '">' +
        esc(formatShort(week)) + '</button>').join('') + '</div>';
    return '<h1>Time wasted</h1>' + jumps +
      '<div class="wastehero"><h2>' + esc(headline) + '</h2>' + (jab ? '<p>' + esc(jab) + '</p>' : '') + '</div>' + cards;
  }

  function familyHtml() {
    const self = me();
    const parentCount = state.members.filter(member => member.role === 'parent').length;
    const people = orderedMembers().map(member => {
      const canDelete = isParent() && member.id !== self.id && !(member.role === 'parent' && parentCount < 2);
      const roleControl = isParent()
        ? '<label class="field">Role<select data-act="role" data-id="' + esc(member.id) + '">' +
          '<option value="kid"' + (member.role === 'kid' ? ' selected' : '') + '>Kid</option>' +
          '<option value="parent"' + (member.role === 'parent' ? ' selected' : '') + '>Parent</option></select></label>'
        : '<span class="role">' + (member.role === 'parent' ? 'Parent' : 'Kid') + '</span>';
      return '<article class="card"><div class="who"><span class="av" style="--c:' + esc(member.color) + '">' + esc(member.emoji) +
        '</span><div><h3>' + esc(member.display_name) + (member.id === self.id ? ' · you' : '') + '</h3><p class="sub">' +
        loginLabel(member) + '</p></div></div>' + roleControl +
        (canDelete ? '<button type="button" class="btn tiny danger" data-act="delete-member" data-id="' + esc(member.id) + '">Remove</button>' : '') +
        '</article>';
    }).join('');
    const invite = isParent()
      ? '<h2>Invite</h2><p class="sub">Anyone with this code can join, including as a parent. Share it only with your household.</p>' +
        '<div class="codeblock"><input readonly value="' + esc(state.family.invite_code) + '" aria-label="Invite code">' +
        '<button type="button" class="btn" data-act="copy-code">Copy</button></div>' +
        '<div class="actions"><button type="button" class="btn ghost" data-act="regen">New code</button>' +
        (state.mode === 'live' ? '<a class="btn" href="/api/export">Download household data</a>' : '') + '</div>' +
        '<h2>Add someone</h2><form data-form="member"><label class="field">Name<input name="name" maxlength="40" required></label>' +
        '<div class="seg"><label><input type="radio" name="role" value="kid" checked>Kid</label><label><input type="radio" name="role" value="parent">Parent</label></div>' +
        emojiPicker('🦊') + '<button class="btn primary" type="submit">Add to the family</button></form>'
      : '<p class="hint">Ask a parent to change the roster or the invite code.</p>';
    const rename = isParent()
      ? '<form data-form="rename" class="field">Family name<input name="name" maxlength="80" value="' + esc(state.family.name) + '"><button class="btn" type="submit">Save name</button></form>'
      : '';
    const session = state.mode === 'live'
      ? '<p class="sub">Signed in as ' + esc(self ? self.display_name : '') + '</p><button type="button" class="btn" data-act="sign-out">Sign out</button>'
      : '<button type="button" class="btn danger" data-act="reset-demo">Reset sample family</button>' +
        (state.api ? '<button type="button" class="btn" data-act="show-auth">Sign in</button>' : '');
    return '<h1>House</h1>' + rename + invite + '<h2>People</h2>' + people + '<div class="actions">' + session + '</div>';
  }

  function loginLabel(member) {
    if (state.mode !== 'live') return member.user_id ? 'Sample profile' : 'No login yet';
    if (member.is_owner) return 'Parent password';
    if (member.has_pin) return 'PIN set';
    return 'No PIN yet';
  }

  function emojiPicker(selected) {
    return '<div class="emoji-row">' + EMOJIS.map(emoji =>
      '<button type="button" class="emoji' + (emoji === selected ? ' on' : '') + '" data-act="emoji" data-emoji="' + emoji + '">' + emoji + '</button>'
    ).join('') + '<input type="hidden" name="emoji" id="emoji-pick" value="' + selected + '"></div>';
  }

  function authHtml() {
    let body = homeAuthHtml();
    if (state.authPanel === 'create') body = createAuthHtml();
    else if (state.authPanel === 'join') body = joinAuthHtml();
    if (state.error) body += '<p class="hint">' + esc(state.error) + '</p>';
    return '<header class="hero"><div class="hero-inner"><div class="brand">' + mascot() +
      '<div><p class="word">CHORE<b>ZILLA</b></p><p class="tag">Routines. Points. A crown.</p></div></div></div></header>' +
      '<div class="auth-wrap"><div class="authcard">' + body +
      '<button type="button" class="btn full" data-act="use-demo">Play the sample family</button></div></div>';
  }

  function homeAuthHtml() {
    if (!state.api) {
      return '<h2>Sample family</h2><p>This copy has no server, so the sample house stays on this device.</p>';
    }
    return '<h2>Your household</h2><p>A parent makes the house with a password. Everyone else joins with the invite code, their name, and a 4-digit PIN.</p>' +
      '<div class="actions"><button type="button" class="btn primary" data-act="show-create">Create a household</button>' +
      '<button type="button" class="btn" data-act="show-join">I have a code</button></div>';
  }

  function createAuthHtml() {
    return '<h2>Create a household</h2><p>You are the parent. The password is yours. Kids get a PIN instead.</p>' +
      '<form data-form="create"><label class="field">Family name<input name="family" maxlength="80" required placeholder="The Roar House"></label>' +
      '<label class="field">Your name<input name="name" maxlength="40" required autocomplete="nickname"></label>' +
      emojiPicker('🦖') +
      '<label class="field">Password<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>' +
      '<label class="field">Password again<input name="password2" type="password" minlength="8" required autocomplete="new-password"></label>' +
      '<button class="btn primary full" type="submit">Create the household</button></form>' +
      '<button type="button" class="btn ghost" data-act="auth-home">Back</button>';
  }

  function joinAuthHtml() {
    if (!state.join) {
      return '<h2>Join or sign in</h2><form data-form="lookup"><label class="field">Invite code<input name="code" maxlength="12" required autocapitalize="characters" autocomplete="off"></label>' +
        '<button class="btn primary" type="submit">Find the household</button></form>' +
        '<button type="button" class="btn ghost" data-act="auth-home">Back</button>';
    }
    const members = state.join.members || [];
    const ready = members.filter(member => member.is_owner || member.has_pin);
    const waiting = members.filter(member => !member.is_owner && !member.has_pin);
    const picked = members.find(member => member.id === state.loginMember);
    const claim = members.find(member => member.id === state.claimId);
    const readyButtons = ready.map(member =>
      '<button type="button" class="profile' + (member.id === state.loginMember ? ' on' : '') + '" data-act="pick-login" data-id="' + esc(member.id) + '"><span class="av">' +
      esc(member.emoji) + '</span><span><b>' + esc(member.display_name) + '</b><small class="sub">' +
      (member.is_owner ? 'Parent password' : 'PIN') + '</small></span></button>'
    ).join('');
    const waitButtons = waiting.map(member =>
      '<button type="button" class="profile' + (member.id === state.claimId ? ' on' : '') + '" data-act="pick-claim" data-id="' + esc(member.id) + '"><span class="av">' +
      esc(member.emoji) + '</span><span><b>I\'m ' + esc(member.display_name) + '</b><small class="sub">' + esc(member.role) + '</small></span></button>'
    ).join('');
    const sign = picked
      ? '<form data-form="login"><p class="sub">Signing in as ' + esc(picked.display_name) + '</p><label class="field">' +
        (picked.is_owner ? 'Household password' : 'PIN') +
        '<input name="secret" ' + (picked.is_owner
          ? 'type="password" minlength="8" autocomplete="current-password"'
          : 'type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="one-time-code"') +
        ' required></label><button class="btn primary" type="submit">Sign in</button></form>'
      : '';
    const claimForm = claim
      ? '<form data-form="claim"><p class="sub">Set a 4-digit PIN for ' + esc(claim.display_name) + '.</p><label class="field">PIN<input name="pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required autocomplete="new-password"></label>' +
        '<button class="btn primary" type="submit">Join as ' + esc(claim.display_name) + '</button></form>'
      : '';
    return '<h2>' + esc(state.join.familyName) + '</h2>' +
      (ready.length ? '<h3>Sign in</h3>' + readyButtons + sign : '') +
      (waiting.length ? '<h3>First time</h3>' + waitButtons + claimForm : '') +
      '<h3>New person</h3><form data-form="join-new"><label class="field">Name<input name="name" maxlength="40" required></label>' +
      '<div class="seg"><label><input type="radio" name="role" value="kid" checked>Kid</label><label><input type="radio" name="role" value="parent">Parent</label></div>' +
      emojiPicker('🦊') +
      '<label class="field">PIN<input name="pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required autocomplete="new-password"></label>' +
      '<button class="btn primary" type="submit">Join</button></form>' +
      '<button type="button" class="btn ghost" data-act="auth-home">Back</button>';
  }

  function navHtml() {
    const icons = {
      today: '<circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7 4.9 19.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      week: '<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      board: '<path fill="currentColor" d="M3 16.5h18v2.2H3zm1.1-1.6 2.3-6.2 2.7 3.4L12 4.2l2.9 7.9 2.7-3.4 2.3 6.2z"/>',
      wasted: '<circle cx="12" cy="13" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10v4l2 2M9 3h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      family: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-5H10v5H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
    };
    const items = [['today', 'Today'], ['week', 'Week'], ['board', 'Crown'], ['wasted', 'Time'], ['family', 'House']];
    return '<nav class="nav" aria-label="Main"><div class="nav-inner">' + items.map(item =>
      '<button type="button" data-act="nav" data-screen="' + item[0] + '" class="' + (state.screen === item[0] ? 'on' : '') + '"' +
      (state.screen === item[0] ? ' aria-current="page"' : '') + '><span aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22">' +
      icons[item[0]] + '</svg></span>' + item[1] + '</button>'
    ).join('') + '</div></nav>';
  }

  function view() {
    if (!state.ready) return '<div class="hero"><div class="hero-inner"><p class="boot">Waking Chorezilla…</p></div></div>';
    if (state.screen === 'auth' || !state.family) return authHtml();
    const model = schedule();
    const body = {
      today: () => todayHtml(model),
      week: () => weekHtml(),
      board: () => boardHtml(model),
      wasted: () => wastedHtml(model),
      family: () => familyHtml()
    }[state.screen] || (() => todayHtml(model));
    return heroHtml() + '<main class="wrap" id="main">' + stripHtml(model) + body() + '</main>' + navHtml();
  }

  function render() {
    document.getElementById('app').innerHTML = view();
    const titles = { today: 'Today', week: 'Week', board: 'Crown', wasted: 'Time', family: 'House', auth: 'Sign in', onboard: 'Your family' };
    document.title = 'Chorezilla · ' + (titles[state.screen] || 'Today');
    if (renderedScreen !== state.screen) {
      window.scrollTo(0, 0);
      renderedScreen = state.screen;
      const toastEl = document.getElementById('toast');
      if (toastEl) toastEl.className = '';
    }
  }

  function pastWeeks(occ, currentMonday) {
    const set = new Set();
    for (const item of occ) {
      if (item.status === 'pending') continue;
      const monday = CZ.weekStart(item.day);
      if (monday < currentMonday) set.add(monday);
    }
    return [...set].sort().reverse();
  }

  function rankRows(rows) {
    return rows.slice().sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (a.wastedMinutes !== b.wastedMinutes) return a.wastedMinutes - b.wastedMinutes;
      if (b.streak !== a.streak) return b.streak - a.streak;
      return memberName(a.memberId).localeCompare(memberName(b.memberId));
    });
  }

  function joinNames(names) {
    if (names.length <= 1) return names[0] || '';
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
  }

  async function onSubmit(event) {
    const form = event.target;
    if (!form || !form.dataset) return;
    event.preventDefault();
    state.error = '';
    const kind = form.dataset.form;
    if (kind === 'slot') return saveSlot(form);
    if (kind === 'prize') return savePrize(form, form.dataset.week);
    if (kind === 'rename') return renameFamily(form);
    if (kind === 'member') return addMember(form);
    if (kind === 'create') {
      const family = String(new FormData(form).get('family') || '').trim();
      const name = String(new FormData(form).get('name') || '').trim();
      const emoji = String(new FormData(form).get('emoji') || '🦖');
      const password = String(new FormData(form).get('password') || '');
      const again = String(new FormData(form).get('password2') || '');
      if (password !== again) { toast('Those passwords do not match.', 'bad'); return; }
      await withBusy(async () => {
        applyState(await api('/api/households', { method: 'POST', body: { name: family, displayName: name, emoji, password } }));
        toast('The house is open.', 'good');
        goto('week');
      });
      return;
    }
    if (kind === 'lookup') {
      const code = String(new FormData(form).get('code') || '').trim().toUpperCase();
      await withBusy(async () => {
        state.join = await api('/api/lookup', { method: 'POST', body: { code } });
        state.loginMember = null;
        state.claimId = null;
        state.authPanel = 'join';
      });
      return;
    }
    if (kind === 'login') {
      const secret = String(new FormData(form).get('secret') || '');
      await withBusy(async () => {
        applyState(await api('/api/login', {
          method: 'POST',
          body: { code: state.join.code, memberId: state.loginMember, secret }
        }));
        goto('today');
      });
      return;
    }
    if (kind === 'claim') {
      const pin = String(new FormData(form).get('pin') || '').trim();
      await withBusy(async () => {
        applyState(await api('/api/join', { method: 'POST', body: { code: state.join.code, claimId: state.claimId, pin } }));
        goto('today');
      });
      return;
    }
    if (kind === 'join-new') {
      const name = String(new FormData(form).get('name') || '').trim();
      const role = form.role && form.role.value === 'parent' ? 'parent' : 'kid';
      const emoji = String(new FormData(form).get('emoji') || '🦊');
      const pin = String(new FormData(form).get('pin') || '').trim();
      if (!name) { toast('Add your name.', 'bad'); return; }
      await withBusy(async () => {
        applyState(await api('/api/join', {
          method: 'POST',
          body: { code: state.join.code, displayName: name, role, emoji, pin }
        }));
        goto('today');
      });
    }
  }

  function onChange(event) {
    const el = event.target.closest('[data-act=role]');
    if (!el) return;
    saveRole(el.dataset.id, el.value);
  }

  function onClick(event) {
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'nav') return goto(btn.dataset.screen);
    if (act === 'view-as') {
      state.meId = btn.dataset.id;
      const person = state.members.find(member => member.id === state.meId);
      const kid = state.members.find(member => member.role === 'kid');
      state.selectedId = person && person.role === 'kid' ? person.id : (kid || person).id;
      state.editor = null;
      persist();
      render();
      return;
    }
    if (act === 'pick-member') {
      state.selectedId = btn.dataset.id;
      state.editor = null;
      persist();
      render();
      return;
    }
    if (act === 'pick-day') {
      state.focusDay = btn.dataset.day;
      persist();
      render();
      return;
    }
    if (act === 'mark') return mark(btn.dataset.id, btn.dataset.day, btn.dataset.status);
    if (act === 'approve') return approve(btn.dataset.id);
    if (act === 'edit-slot') {
      const slot = state.slots.map(normalizeSlot).find(item => item.id === btn.dataset.id);
      if (slot) openEditor(slot);
      return;
    }
    if (act === 'new-slot') return openEditor(null);
    if (act === 'close-editor') { state.editor = null; render(); return; }
    if (act === 'template') return applyTemplate(Number(btn.dataset.i));
    if (act === 'archive') {
      if (confirm('Archive this routine? Past check-ins stay. Unmarked days stop counting.')) {
        state.editor = null;
        setActive(btn.dataset.id, false);
      }
      return;
    }
    if (act === 'restore') return setActive(btn.dataset.id, true);
    if (act === 'week') { state.viewWeek = btn.dataset.week; render(); return; }
    if (act === 'this-week') { state.viewWeek = null; render(); return; }
    if (act === 'copy-code') return copyCode();
    if (act === 'regen') return regenerate();
    if (act === 'delete-member') return deleteMember(btn.dataset.id);
    if (act === 'emoji') {
      const input = document.querySelector('#emoji-pick');
      if (input) input.value = btn.dataset.emoji;
      btn.parentElement.querySelectorAll('.emoji').forEach(el => el.classList.toggle('on', el === btn));
      return;
    }
    if (act === 'use-demo') {
      loadDemo(false);
      goto('today');
      return;
    }
    if (act === 'show-auth') return showAuthScreen();
    if (act === 'show-create') { state.authPanel = 'create'; state.error = ''; render(); return; }
    if (act === 'show-join') { state.authPanel = 'join'; state.join = null; state.error = ''; render(); return; }
    if (act === 'auth-home') { state.authPanel = 'home'; state.error = ''; render(); return; }
    if (act === 'pick-login') {
      state.loginMember = btn.dataset.id;
      state.claimId = null;
      render();
      return;
    }
    if (act === 'pick-claim') {
      state.claimId = btn.dataset.id;
      state.loginMember = null;
      render();
      return;
    }
    if (act === 'sign-out') {
      api('/api/logout', { method: 'POST' }).catch(() => {}).then(() => showAuthScreen());
      return;
    }
    if (act === 'reset-demo') {
      if (!confirm('Reset the sample family? Practice taps on this device will be cleared.')) return;
      try { localStorage.removeItem(DEMO_KEY); } catch (err) { /* ignore */ }
      loadDemo(true);
      state.viewWeek = null;
      goto('today');
      return;
    }
  }

  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  function bind() {
    const app = document.getElementById('app');
    app.addEventListener('click', onClick);
    app.addEventListener('submit', onSubmit);
    app.addEventListener('change', onChange);
    window.addEventListener('hashchange', () => {
      if (state.booting) return;
      onHash();
    });
  }

  async function boot() {
    bind();
    state.booting = true;
    try {
      const health = await fetch('/api/health', { credentials: 'same-origin' });
      if (health.ok) {
        state.api = true;
        const meRes = await fetch('/api/state', { credentials: 'same-origin' });
        if (meRes.status === 401) {
          state.screen = 'auth';
          state.authPanel = 'home';
        } else if (meRes.ok) {
          applyState(await meRes.json());
        } else {
          state.screen = 'auth';
          state.authPanel = 'home';
          state.error = 'The server did not answer.';
        }
      } else loadDemo(false);
    } catch (err) {
      loadDemo(false);
    }
    state.ready = true;
    if (state.family) {
      const name = location.hash.replace('#', '');
      state.screen = SCREENS.includes(name) ? name : 'today';
      if (location.hash !== '#' + state.screen) location.hash = state.screen;
    }
    state.booting = false;
    render();
    registerSW();
  }

  boot();
})();
