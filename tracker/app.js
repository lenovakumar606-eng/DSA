(function () {
  'use strict';

  // ================= Config =================
  const SECTIONS = [
    { id: 'study',     name: 'Study',            icon: '📚' },
    { id: 'ai',        name: 'AI Learning',      icon: '🤖' },
    { id: 'content',   name: 'Content Creation', icon: '🎬' },
    { id: 'instagram', name: 'Instagram',        icon: '📸' },
  ];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // Monday-first order for pickers; values are JS getDay() numbers.
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const SESSION_KEY = 'wmt.session';
  const THEME_KEY = 'wmt.theme';

  // ================= Storage =================
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { toast('⚠️ Could not save. Browser storage may be full or blocked.'); return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch (e) {} },
  };

  // ================= Date helpers (local time, no UTC shifts) =================
  const pad = (n) => String(n).padStart(2, '0');
  const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const todayKey = () => toKey(new Date());
  const dayName = (k) => DAY_NAMES[fromKey(k).getDay()];
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const off = (x.getDay() + 6) % 7; return addDays(x, -off); };
  const fmtShort = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const fmtDate = (k) => fromKey(k).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtHours = (h) => { const r = Math.round(h * 100) / 100; return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, ''); };
  const fmtTime = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ================= State =================
  const state = {
    user: null,          // { email, name }
    entries: [],         // { id, section, date, hours, notes, updatedAt }
    reminders: [],       // { id, text, type:'weekly'|'date', days:[0-6], date, time, enabled, lastFired }
    view: 'week',
    anchor: new Date(),
  };
  const dataKey = () => `wmt.data.${state.user.email}`;
  function load() {
    const d = store.get(dataKey(), {});
    state.entries = Array.isArray(d.entries) ? d.entries : [];
    state.reminders = Array.isArray(d.reminders) ? d.reminders : [];
    state.view = d.view === 'month' ? 'month' : 'week';
  }
  function save() {
    store.set(dataKey(), { entries: state.entries, reminders: state.reminders, view: state.view });
  }

  // ================= DOM =================
  const $ = (id) => document.getElementById(id);
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return node;
  }
  function toast(msg, ms = 3500) {
    const t = el('div', { class: 'toast', text: msg });
    $('toasts').append(t);
    setTimeout(() => t.remove(), ms);
  }

  // ================= Login =================
  function showLogin() {
    $('appScreen').hidden = true;
    $('loginScreen').hidden = false;
    $('loginEmail').focus();
  }
  function showApp() {
    $('loginScreen').hidden = true;
    $('appScreen').hidden = false;
    $('userLabel').textContent = state.user.name ? `Hi, ${state.user.name} · ${state.user.email}` : state.user.email;
    load();
    state.anchor = new Date();
    render();
    renderReminderBadge();
    startReminderLoop();
  }
  $('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('loginEmail').value.trim().toLowerCase();
    const name = $('loginName').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      $('loginError').textContent = 'Please enter a valid email address.';
      return;
    }
    $('loginError').textContent = '';
    // Keep a name previously saved for this email if none was typed now.
    const known = store.get(`wmt.profile.${email}`, {});
    state.user = { email, name: name || known.name || '' };
    store.set(`wmt.profile.${email}`, { name: state.user.name });
    store.set(SESSION_KEY, state.user);
    showApp();
  });
  $('logoutBtn').addEventListener('click', () => {
    closeMenu();
    store.remove(SESSION_KEY);
    stopReminderLoop();
    state.user = null;
    $('loginForm').reset();
    showLogin();
  });

  // ================= Theme =================
  function isDark() {
    const t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function syncThemeIcon() { $('themeBtn').textContent = isDark() ? '☀️' : '🌙'; }
  $('themeBtn').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    syncThemeIcon();
  });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncThemeIcon);

  // ================= Menu / backup =================
  function closeMenu() { $('menu').hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); }
  $('menuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = $('menu').hidden;
    $('menu').hidden = !open;
    $('menuBtn').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => { if (!$('menu').contains(e.target)) closeMenu(); });

  $('exportBtn').addEventListener('click', () => {
    closeMenu();
    const data = { app: 'weekly-monthly-tracker', version: 1, email: state.user.email, exportedAt: new Date().toISOString(), entries: state.entries, reminders: state.reminders };
    download(`tracker-backup-${todayKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
  });
  $('importBtn').addEventListener('click', () => { closeMenu(); $('importFile').click(); });
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.entries)) throw new Error('bad file');
      const valid = data.entries.filter((x) => x && SECTIONS.some((s) => s.id === x.section) && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && isFinite(x.hours));
      const ids = new Set(state.entries.map((x) => x.id));
      let added = 0;
      for (const x of valid) {
        if (ids.has(x.id)) continue;
        state.entries.push({ id: x.id || uid(), section: x.section, date: x.date, hours: Number(x.hours), notes: String(x.notes || ''), updatedAt: x.updatedAt || Date.now() });
        added++;
      }
      if (Array.isArray(data.reminders)) {
        const rIds = new Set(state.reminders.map((r) => r.id));
        for (const r of data.reminders) if (r && r.id && !rIds.has(r.id) && r.time) state.reminders.push(r);
      }
      save(); render(); renderReminderBadge();
      toast(`✅ Imported ${added} new entr${added === 1 ? 'y' : 'ies'}.`);
    } catch (err) {
      toast('⚠️ That file is not a valid tracker backup.');
    }
  });
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = el('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ================= Period =================
  function period() {
    if (state.view === 'week') {
      const start = startOfWeek(state.anchor);
      const end = addDays(start, 6);
      return { start, end, label: `${fmtShort(start)} – ${fmtShort(end)} ${end.getFullYear()}` };
    }
    const start = new Date(state.anchor.getFullYear(), state.anchor.getMonth(), 1);
    const end = new Date(state.anchor.getFullYear(), state.anchor.getMonth() + 1, 0);
    return { start, end, label: start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
  }
  function shift(dir) {
    const a = state.anchor;
    state.anchor = state.view === 'week' ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1);
    render();
  }
  $('prevBtn').addEventListener('click', () => shift(-1));
  $('nextBtn').addEventListener('click', () => shift(1));
  $('todayBtn').addEventListener('click', () => { state.anchor = new Date(); render(); });
  for (const tab of [$('tabWeek'), $('tabMonth')]) {
    tab.addEventListener('click', () => {
      state.view = tab.dataset.view;
      save();
      render();
    });
  }

  // ================= Render =================
  function render() {
    const p = period();
    const startK = toKey(p.start), endK = toKey(p.end), tK = todayKey();
    const inPeriod = state.entries.filter((e) => e.date >= startK && e.date <= endK);

    $('tabWeek').setAttribute('aria-selected', String(state.view === 'week'));
    $('tabMonth').setAttribute('aria-selected', String(state.view === 'month'));
    $('periodLabel').textContent = p.label;
    $('todayBtn').disabled = tK >= startK && tK <= endK;
    syncThemeIcon();

    // Totals
    const stats = SECTIONS.map((s) => {
      const list = inPeriod.filter((e) => e.section === s.id);
      return { s, list, hours: list.reduce((a, e) => a + (Number(e.hours) || 0), 0), days: new Set(list.map((e) => e.date)).size };
    });
    const grand = stats.reduce((a, x) => a + x.hours, 0);
    const activeDays = new Set(inPeriod.map((e) => e.date)).size;
    const totalDays = Math.round((p.end - p.start) / 864e5) + 1;

    const summary = $('summary');
    summary.replaceChildren(
      ...stats.map((x) => el('div', { class: `stat ${x.s.id}` },
        el('div', { class: 'label', text: `${x.s.icon} ${x.s.name}` }),
        el('div', { class: 'value' }, fmtHours(x.hours), el('small', { text: ' h' })),
        el('div', { class: 'sub', text: state.view === 'month' ? `${x.days} active day${x.days === 1 ? '' : 's'}` : `${x.list.length} entr${x.list.length === 1 ? 'y' : 'ies'}` })
      )),
      el('div', { class: 'stat total' },
        el('div', { class: 'label', text: state.view === 'week' ? 'Weekly grand total' : 'Monthly grand total' }),
        el('div', { class: 'value' }, fmtHours(grand), el('small', { text: ' h' })),
        el('div', { class: 'sub', text: `${activeDays} of ${totalDays} days active` })
      )
    );

    // Bar chart (monthly)
    $('chartCard').hidden = state.view !== 'month';
    if (state.view === 'month') {
      const max = Math.max(1, ...stats.map((x) => x.hours));
      $('chart').replaceChildren(...stats.map((x) => el('div', { class: `bar-row ${x.s.id}` },
        el('div', { class: 'bar-name', text: `${x.s.icon} ${x.s.name}` }),
        el('div', { class: 'bar-track', role: 'img', 'aria-label': `${x.s.name}: ${fmtHours(x.hours)} hours` },
          el('div', { class: 'bar-fill', style: `width:${(x.hours / max) * 100}%` })),
        el('div', { class: 'bar-val', text: `${fmtHours(x.hours)} h` })
      )));
    }

    // Section tables
    $('sections').replaceChildren(...stats.map((x) => renderSection(x, tK)));
  }

  function renderSection(x, tK) {
    const rows = [...x.list].sort((a, b) => (a.date === b.date ? (a.updatedAt || 0) - (b.updatedAt || 0) : a.date < b.date ? -1 : 1));
    const body = rows.length
      ? el('div', { class: 'table-wrap' },
          el('table', null,
            el('thead', null, el('tr', null,
              el('th', { text: 'Date' }), el('th', { text: 'Day' }), el('th', { class: 'num', text: 'Hours' }),
              el('th', { text: 'What I learned / did' }), el('th', { 'aria-label': 'Actions' }))),
            el('tbody', null, rows.map((e) => el('tr', { class: e.date === tK ? 'is-today' : null },
              el('td', { class: 'date', text: fmtDate(e.date) }),
              el('td', { text: dayName(e.date).slice(0, 3) }),
              el('td', { class: 'num', text: fmtHours(e.hours) }),
              el('td', { class: 'notes', text: e.notes || '—' }),
              el('td', { class: 'actions' },
                el('button', { title: 'Edit', 'aria-label': 'Edit entry', onclick: () => openEntry(x.s.id, e) }, '✏️'),
                el('button', { title: 'Delete', 'aria-label': 'Delete entry', onclick: () => deleteEntry(e.id) }, '🗑️'))
            ))),
            el('tfoot', null, el('tr', null,
              el('td', { colspan: '2', text: 'Total' }), el('td', { class: 'num', text: fmtHours(x.hours) }), el('td', { colspan: '2' })))
          ))
      : el('div', { class: 'empty', text: `No ${x.s.name} entries this ${state.view}. Tap “+ Add” to log one.` });

    return el('section', { class: `section ${x.s.id}`, 'aria-label': x.s.name },
      el('div', { class: 'section-head' },
        el('div', null,
          el('h2', null, el('span', { 'aria-hidden': 'true', text: x.s.icon }), x.s.name),
          el('div', { class: 'hrs', text: `${fmtHours(x.hours)} h this ${state.view}` })),
        el('button', { class: 'add', onclick: () => openEntry(x.s.id) }, '+ Add')),
      body);
  }

  // ================= Entry dialog =================
  let editingId = null;
  const entryDialog = $('entryDialog');
  $('entrySection').replaceChildren(...SECTIONS.map((s) => el('option', { value: s.id, text: `${s.icon} ${s.name}` })));

  function syncDay() {
    const v = $('entryDate').value;
    $('entryDay').value = /^\d{4}-\d{2}-\d{2}$/.test(v) ? dayName(v) : '';
  }
  function openEntry(sectionId, entry) {
    editingId = entry ? entry.id : null;
    $('entryTitle').textContent = entry ? 'Edit entry' : 'Add entry';
    $('entrySection').value = sectionId || SECTIONS[0].id;
    // New entries default to today, or to the period's first day if today is outside the shown period.
    let defDate = todayKey();
    if (!entry) {
      const p = period();
      if (defDate < toKey(p.start) || defDate > toKey(p.end)) defDate = toKey(p.start);
    }
    $('entryDate').value = entry ? entry.date : defDate;
    $('entryHours').value = entry ? entry.hours : '';
    $('entryNotes').value = entry ? entry.notes : '';
    $('entryDelete').hidden = !entry;
    $('entryError').textContent = '';
    syncDay();
    entryDialog.showModal();
    (entry ? $('entryNotes') : $('entryHours')).focus();
  }
  $('entryDate').addEventListener('input', syncDay);
  $('entryDate').addEventListener('change', syncDay);
  entryDialog.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const v = Math.min(24, Math.max(0, (Number($('entryHours').value) || 0) + Number(b.dataset.step)));
    $('entryHours').value = v;
  }));
  $('entryCancel').addEventListener('click', () => entryDialog.close());
  $('entryDelete').addEventListener('click', () => {
    if (editingId && deleteEntry(editingId)) entryDialog.close();
  });
  $('entryForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const date = $('entryDate').value;
    const hoursRaw = $('entryHours').value.trim();
    const hours = Number(hoursRaw);
    const notes = $('entryNotes').value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { $('entryError').textContent = 'Please pick a date.'; return; }
    if (hoursRaw === '' || !isFinite(hours) || hours < 0 || hours > 24) { $('entryError').textContent = 'Hours must be between 0 and 24.'; return; }
    const record = { section: $('entrySection').value, date, hours: Math.round(hours * 100) / 100, notes, updatedAt: Date.now() };
    if (editingId) {
      const i = state.entries.findIndex((x) => x.id === editingId);
      if (i >= 0) state.entries[i] = { ...state.entries[i], ...record };
    } else {
      state.entries.push({ id: uid(), ...record });
    }
    save();
    entryDialog.close();
    // Jump to the period containing the saved entry so the user sees it.
    state.anchor = fromKey(date);
    render();
    toast(editingId ? '✅ Entry updated' : '✅ Entry added');
  });
  function deleteEntry(id) {
    const e = state.entries.find((x) => x.id === id);
    if (!e) return false;
    if (!confirm(`Delete this ${SECTIONS.find((s) => s.id === e.section).name} entry from ${fmtDate(e.date)}?`)) return false;
    state.entries = state.entries.filter((x) => x.id !== id);
    save(); render();
    toast('🗑️ Entry deleted');
    return true;
  }
  $('fab').addEventListener('click', () => openEntry(SECTIONS[0].id));

  // ================= Reminders =================
  const reminderDialog = $('reminderDialog');
  $('remWeekly').replaceChildren(...WEEK_ORDER.map((d) => el('label', null,
    el('input', { type: 'checkbox', value: String(d), 'aria-label': DAY_NAMES[d] }),
    el('span', { text: DAY_NAMES[d].slice(0, 3) }))));

  function remWhen(r) {
    if (r.type === 'date') return `${fmtDate(r.date)} (${dayName(r.date)}) at ${fmtTime(r.time)}`;
    const days = WEEK_ORDER.filter((d) => r.days.includes(d));
    const label = days.length === 7 ? 'Every day' : days.map((d) => DAY_NAMES[d].slice(0, 3)).join(', ');
    return `${label} at ${fmtTime(r.time)}`;
  }
  function renderReminderBadge() {
    const n = state.reminders.filter((r) => r.enabled).length;
    $('reminderCount').hidden = n === 0;
    $('reminderCount').textContent = String(n);
    // Today's banner
    const now = new Date(), tK = toKey(now);
    const todays = state.reminders.filter((r) => r.enabled && occursOn(r, now)).sort((a, b) => a.time.localeCompare(b.time));
    const banner = $('reminderBanner');
    banner.hidden = todays.length === 0;
    if (todays.length) {
      banner.replaceChildren(el('b', { text: '🔔 Today: ' }),
        ...todays.flatMap((r, i) => [i ? ' · ' : '', `${r.text} (${fmtTime(r.time)})${r.lastFired === tK ? ' ✓' : ''}`]));
    }
  }
  function renderNotifStatus() {
    const box = $('notifStatus');
    if (!('Notification' in window)) {
      box.replaceChildren('ℹ️ This browser does not support pop-up notifications; reminders will show inside the page.');
      return;
    }
    if (Notification.permission === 'granted') {
      box.replaceChildren('✅ Pop-up notifications are on.');
    } else if (Notification.permission === 'denied') {
      box.replaceChildren('🚫 Notifications are blocked for this site. Allow them in your browser settings to get pop-ups.');
    } else {
      box.replaceChildren('Get a pop-up when a reminder is due:',
        el('button', { type: 'button', class: 'btn primary small', onclick: async () => {
          try { await Notification.requestPermission(); } catch (e) {}
          renderNotifStatus();
        } }, 'Enable notifications'));
    }
  }
  function renderReminderList() {
    const list = $('reminderList');
    if (!state.reminders.length) {
      list.replaceChildren(el('li', { class: 'empty', text: 'No reminders yet. Add one below.' }));
      return;
    }
    list.replaceChildren(...state.reminders.map((r) => el('li', { class: r.enabled ? null : 'off' },
      el('div', { class: 'r-main' },
        el('div', { class: 'r-text', text: r.text }),
        el('div', { class: 'r-when', text: remWhen(r) + (r.enabled ? '' : ' · paused') })),
      el('div', { class: 'r-actions' },
        el('button', { type: 'button', class: 'btn ghost small', title: r.enabled ? 'Pause' : 'Resume', onclick: () => { r.enabled = !r.enabled; save(); renderReminderList(); renderReminderBadge(); } }, r.enabled ? '⏸' : '▶️'),
        el('button', { type: 'button', class: 'btn ghost small', title: 'Add to calendar', onclick: () => exportIcs(r) }, '📅 Calendar'),
        el('button', { type: 'button', class: 'btn ghost small danger', title: 'Delete', onclick: () => {
          state.reminders = state.reminders.filter((x) => x.id !== r.id); save(); renderReminderList(); renderReminderBadge();
        } }, '🗑️'))
    )));
  }
  $('reminderBtn').addEventListener('click', () => {
    renderNotifStatus();
    renderReminderList();
    $('remDate').value = todayKey();
    $('remError').textContent = '';
    reminderDialog.showModal();
  });
  $('reminderClose').addEventListener('click', () => reminderDialog.close());
  document.querySelectorAll('input[name="remType"]').forEach((r) => r.addEventListener('change', () => {
    const isDate = document.querySelector('input[name="remType"]:checked').value === 'date';
    $('remWeekly').hidden = isDate;
    $('remDateWrap').hidden = !isDate;
  }));
  $('reminderForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('remText').value.trim();
    const type = document.querySelector('input[name="remType"]:checked').value;
    const time = $('remTime').value;
    const days = [...$('remWeekly').querySelectorAll('input:checked')].map((i) => Number(i.value));
    const date = $('remDate').value;
    const err = (m) => { $('remError').textContent = m; };
    if (!text) return err('Please write a short message.');
    if (!/^\d{2}:\d{2}$/.test(time)) return err('Please choose a time.');
    if (type === 'weekly' && !days.length) return err('Choose at least one day.');
    if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('Please pick a date.');
    err('');
    state.reminders.push({ id: uid(), text, type, days: type === 'weekly' ? days : [], date: type === 'date' ? date : null, time, enabled: true, lastFired: null });
    save();
    $('remText').value = '';
    $('remWeekly').querySelectorAll('input').forEach((i) => { i.checked = false; });
    renderReminderList();
    renderReminderBadge();
    toast('🔔 Reminder added');
    if ('Notification' in window && Notification.permission === 'default') renderNotifStatus();
  });

  function occursOn(r, d) {
    return r.type === 'date' ? r.date === toKey(d) : r.days.includes(d.getDay());
  }
  let reminderTimer = null;
  function checkReminders() {
    if (!state.user) return;
    const now = new Date(), tK = toKey(now);
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    let changed = false;
    for (const r of state.reminders) {
      if (!r.enabled || r.lastFired === tK || !occursOn(r, now) || hhmm < r.time) continue;
      r.lastFired = tK;
      changed = true;
      fireReminder(r);
    }
    if (changed) { save(); renderReminderBadge(); }
  }
  async function fireReminder(r) {
    toast(`🔔 ${r.text}`, 10000);
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body: r.text, tag: `wmt-${r.id}` };
    try {
      new Notification('Tracker reminder', opts);
    } catch (e) {
      // Android Chrome only allows notifications via a service worker registration.
      try {
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        if (reg) reg.showNotification('Tracker reminder', opts);
      } catch (e2) {}
    }
  }
  function startReminderLoop() {
    stopReminderLoop();
    checkReminders();
    reminderTimer = setInterval(checkReminders, 20000);
  }
  function stopReminderLoop() { if (reminderTimer) clearInterval(reminderTimer); reminderTimer = null; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); renderReminderBadge(); } });

  function exportIcs(r) {
    const [h, m] = r.time.split(':').map(Number);
    let start;
    if (r.type === 'date') {
      start = fromKey(r.date);
    } else {
      // First matching weekday from today onward.
      start = new Date(); start.setHours(0, 0, 0, 0);
      while (!r.days.includes(start.getDay())) start = addDays(start, 1);
    }
    start.setHours(h, m, 0, 0);
    const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const nowUtc = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Weekly Monthly Tracker//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${r.id}@weekly-monthly-tracker`,
      `DTSTAMP:${nowUtc}`,
      `DTSTART:${stamp(start)}`,
      'DURATION:PT15M',
      r.type === 'weekly' ? `RRULE:FREQ=WEEKLY;BYDAY=${WEEK_ORDER.filter((d) => r.days.includes(d)).map((d) => ICS_DAYS[d]).join(',')}` : null,
      `SUMMARY:${esc(r.text)}`,
      'DESCRIPTION:Reminder from your Weekly & Monthly Tracker',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(r.text)}`, 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean);
    download(`reminder-${r.text.slice(0, 24).replace(/[^\w-]+/g, '-').toLowerCase() || 'tracker'}.ics`, lines.join('\r\n'), 'text/calendar');
    toast('📅 Calendar file downloaded. Open it to add the reminder.');
  }

  // ================= Boot =================
  syncThemeIcon();
  const session = store.get(SESSION_KEY, null);
  if (session && session.email) { state.user = session; showApp(); } else { showLogin(); }
})();
