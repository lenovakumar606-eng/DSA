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
  // Device-only settings (signed-in session, theme) always stay in this browser.
  const local = {
    ok: (() => { try { localStorage.setItem('wmt.probe', '1'); localStorage.removeItem('wmt.probe'); return true; } catch (e) { return false; } })(),
    get(key, fallback) {
      try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); } catch (e) { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) {} },
  };

  // Account data (accounts, entries, reminders). Kept in memory and saved to:
  //  - 'cloud':  the viewer's private storage in their Claude account, when opened as a Claude artifact
  //              (also mirrored to this browser as a backup when possible)
  //  - 'local':  this browser's localStorage (local file, GitHub Pages, any normal website)
  //  - 'memory': nowhere; the page can't save in this view, so we warn the user
  const DEVICE_KEYS = new Set([SESSION_KEY, THEME_KEY]);
  const DELETE = Symbol('delete');
  const store = {
    mode: 'memory',
    mem: new Map(),
    db: null,
    uid: null,
    queues: new Map(),
    warned: false,
    get(key, fallback) {
      // Return a copy so callers can't mutate the cache by accident.
      return this.mem.has(key) ? JSON.parse(JSON.stringify(this.mem.get(key))) : fallback;
    },
    keys(prefix) { return [...this.mem.keys()].filter((k) => k.startsWith(prefix)); },
    // Resolves true once saved (or false if it could not be saved).
    set(key, value) { this.mem.set(key, value); return this.persist(key, value); },
    remove(key) { this.mem.delete(key); return this.persist(key, DELETE); },
    async persist(key, value) {
      let ok = false;
      if (local.ok) ok = value === DELETE ? (local.remove(key), true) : local.set(key, value);
      if (this.mode === 'cloud') ok = await this.cloudWrite(key, value);
      if (this.mode === 'memory') ok = false;
      if (!ok && !this.warned) {
        this.warned = true;
        toast(this.mode === 'memory'
          ? '⚠️ This view cannot save. Your changes will be lost when you close the page.'
          : '⚠️ Could not save your latest change. Check your connection; it will be kept while this page stays open.', 6000);
      }
      if (ok) this.warned = false;
      return ok;
    },
    // One write at a time per document; a burst of changes collapses into the latest value.
    cloudWrite(key, value) {
      return new Promise((resolve) => {
        let q = this.queues.get(key);
        if (!q) { q = { busy: false, has: false, next: null, waiters: [] }; this.queues.set(key, q); }
        q.next = value; q.has = true; q.waiters.push(resolve);
        if (!q.busy) this.pump(key, q);
      });
    },
    async pump(key, q) {
      q.busy = true;
      while (q.has) {
        const value = q.next, waiters = q.waiters;
        q.has = false; q.waiters = [];
        const write = () => {
          const ref = this.db.doc(`data/users/${this.uid}/${encKey(key)}`);
          return value === DELETE ? ref.delete() : ref.set({ v: value });
        };
        let ok = true;
        try { await write(); } catch (e) {
          if (e && e.code === 'unavailable') {
            await new Promise((r) => setTimeout(r, 400 + Math.random() * 800));
            try { await write(); } catch (e2) { ok = false; }
          } else ok = false;
        }
        waiters.forEach((r) => r(ok));
      }
      q.busy = false;
    },
  };
  // Document ids allow only letters, digits and _ - . : @ + ; everything else (and ~ itself) becomes ~XX.
  const encKey = (k) => k.replace(/[^A-Za-z0-9_\-.:@+]/g, (c) => [...new TextEncoder().encode(c)].map((b) => '~' + b.toString(16).padStart(2, '0')).join(''));
  const decKey = (k) => { try { return decodeURIComponent(k.replace(/~([0-9a-f]{2})/g, '%$1')); } catch (e) { return k; } };

  async function initStorage() {
    // Everything this browser already has (also used to carry old data over to cloud storage).
    const localData = new Map();
    if (local.ok) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('wmt.') && !DEVICE_KEYS.has(k) && k !== 'wmt.probe') {
            const v = local.get(k, undefined);
            if (v !== undefined) localData.set(k, v);
          }
        }
      } catch (e) {}
    }
    // Inside the Claude artifact viewer: use the viewer's private, account-backed storage.
    if (window.claude && typeof window.claude.use === 'function') {
      try {
        const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        const id = user ? await user.id() : null;
        if (db && id) {
          const snap = await db.collection(`data/users/${id}`).limit(1000).get();
          store.db = db; store.uid = id; store.mode = 'cloud';
          for (const d of snap.docs) { const body = d.data(); if (body && 'v' in body) store.mem.set(decKey(d.id), body.v); }
          // First use of cloud storage: bring over what this browser had (e.g. an account made before this update).
          if (store.mem.size === 0) for (const [k, v] of localData) { store.mem.set(k, v); store.cloudWrite(k, v); }
        }
      } catch (e) { store.mode = 'memory'; store.db = null; }
    }
    if (store.mode !== 'cloud') {
      store.mode = local.ok ? 'local' : 'memory';
      for (const [k, v] of localData) store.mem.set(k, v);
    }
  }

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
    focus: null,         // section id shown full screen, or null for the overview
  };
  // Entries are saved one record per month (wmt.entries.<email>.<YYYY-MM>) so no record grows too large.
  const dataKey = () => `wmt.data.${state.user.email}`;
  const entriesPrefix = (email) => `wmt.entries.${email}.`;
  let savedMonths = new Map(); // month -> JSON last saved
  let savedData = '';
  function load() {
    const d = store.get(dataKey(), {});
    const byId = new Map();
    for (const k of store.keys(entriesPrefix(state.user.email))) {
      const list = store.get(k, []);
      if (Array.isArray(list)) for (const e of list) if (e && e.id) byId.set(e.id, e);
    }
    // Older versions kept every entry inside the data record.
    const legacy = Array.isArray(d.entries) ? d.entries : [];
    for (const e of legacy) if (e && e.id && !byId.has(e.id)) byId.set(e.id, e);
    state.entries = [...byId.values()].filter((e) => SECTIONS.some((s) => s.id === e.section) && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
    state.reminders = Array.isArray(d.reminders) ? d.reminders.map(cleanReminder).filter(Boolean) : [];
    state.view = d.view === 'month' ? 'month' : 'week';
    savedMonths = new Map();
    for (const k of store.keys(entriesPrefix(state.user.email))) savedMonths.set(k.slice(-7), JSON.stringify(store.get(k, [])));
    savedData = legacy.length ? '' : JSON.stringify({ reminders: d.reminders || [], view: d.view || 'week' });
    if (legacy.length) save(); // move old entries into monthly records
  }
  function save() {
    const email = state.user.email;
    const groups = new Map();
    for (const e of state.entries) {
      const m = e.date.slice(0, 7);
      if (!groups.has(m)) groups.set(m, []);
      groups.get(m).push(e);
    }
    for (const m of new Set([...groups.keys(), ...savedMonths.keys()])) {
      const list = groups.get(m) || [];
      const json = JSON.stringify(list);
      if (json === (savedMonths.get(m) || '[]') && savedMonths.has(m) === list.length > 0) continue;
      if (list.length) { store.set(entriesPrefix(email) + m, list); savedMonths.set(m, json); }
      else { store.remove(entriesPrefix(email) + m); savedMonths.delete(m); }
    }
    const data = { reminders: state.reminders, view: state.view };
    const json = JSON.stringify(data);
    if (json !== savedData) { store.set(dataKey(), data); savedData = json; }
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
    while ($('toasts').children.length > 2) $('toasts').firstChild.remove(); // keep only the latest messages
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
    state.focus = null;
    focusFromHash();
    render();
    renderReminderBadge();
    startReminderLoop();
  }
  // ---- Password hashing (PBKDF2-SHA256, salted; the password itself is never stored) ----
  const PBKDF2_ITERATIONS = 150000;
  const accountKey = (email) => `wmt.account.${email}`;
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function hashPassword(password, saltBytes, iterations) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256);
    return b64(bits);
  }
  async function makeCredential(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { salt: b64(salt), iterations: PBKDF2_ITERATIONS, hash: await hashPassword(password, salt, PBKDF2_ITERATIONS) };
  }
  async function checkPassword(account, password) {
    const h = await hashPassword(password, unb64(account.salt), account.iterations);
    // Constant-time compare.
    let diff = h.length ^ account.hash.length;
    for (let i = 0; i < Math.max(h.length, account.hash.length); i++) diff |= (h.charCodeAt(i) || 0) ^ (account.hash.charCodeAt(i) || 0);
    return diff === 0;
  }
  const cryptoOk = () => !!(window.crypto && crypto.subtle && crypto.getRandomValues);

  // Session: localStorage when "keep me signed in", otherwise only for this tab.
  function readSession() {
    let s = local.get(SESSION_KEY, null);
    if (!s) { try { s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { s = null; } }
    // Ignore sessions from before passwords existed, or for deleted accounts.
    return s && s.email && store.get(accountKey(s.email), null) ? s : null;
  }
  function writeSession(user, remember) {
    local.remove(SESSION_KEY);
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    if (remember) local.set(SESSION_KEY, user);
    else { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(user)); } catch (e) {} }
  }

  let authMode = 'signin';
  function setAuthMode(mode) {
    authMode = mode;
    const up = mode === 'signup';
    $('modeSignIn').setAttribute('aria-selected', String(!up));
    $('modeSignUp').setAttribute('aria-selected', String(up));
    $('nameWrap').hidden = !up;
    $('confirmWrap').hidden = !up;
    $('forgotBtn').hidden = up;
    $('loginPassword').autocomplete = up ? 'new-password' : 'current-password';
    $('loginSubmit').textContent = up ? 'Create account' : 'Sign in';
    $('loginError').textContent = '';
  }
  $('modeSignIn').addEventListener('click', () => setAuthMode('signin'));
  $('modeSignUp').addEventListener('click', () => setAuthMode('signup'));
  document.querySelectorAll('.pw-toggle').forEach((b) => b.addEventListener('click', () => {
    const input = $(b.dataset.target);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.textContent = show ? 'Hide' : 'Show';
    b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  }));

  let loginBusy = false;
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (loginBusy) return;
    const err = (m) => { $('loginError').textContent = m; };
    const email = $('loginEmail').value.trim().toLowerCase();
    const password = $('loginPassword').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err('Please enter a valid email address.');
    if (password.length < 6) return err('Password must be at least 6 characters.');
    if (!cryptoOk()) return err('This browser cannot secure passwords here. Open the page over https or as a local file in Chrome, Edge, Firefox or Safari.');
    const account = store.get(accountKey(email), null);

    loginBusy = true;
    $('loginSubmit').disabled = true;
    try {
      if (authMode === 'signup') {
        if (account) return err('An account with this email already exists. Sign in instead.');
        if (password !== $('loginConfirm').value) return err('The two passwords do not match.');
        const name = $('loginName').value.trim() || store.get(`wmt.profile.${email}`, {}).name || '';
        const saved = await store.set(accountKey(email), { name, ...(await makeCredential(password)), createdAt: Date.now() });
        if (!saved && store.mode !== 'memory') { store.mem.delete(accountKey(email)); return err('Could not save your account. Check your internet connection and try again.'); }
        state.user = { email, name };
      } else {
        if (!account) {
          // Data saved before passwords existed: ask the user to set one.
          const legacy = store.get(`wmt.data.${email}`, null) || store.keys(entriesPrefix(email)).length > 0;
          return err(legacy ? 'This email has saved entries but no password yet. Choose “Create account” to set one; your entries are kept.' : 'No account found for this email. Choose “Create account”.');
        }
        if (!(await checkPassword(account, password))) {
          await new Promise((r) => setTimeout(r, 600)); // slow down guessing
          return err('Wrong password. Try again.');
        }
        state.user = { email, name: account.name || '' };
      }
      err('');
      writeSession(state.user, $('loginRemember').checked);
      $('loginPassword').value = '';
      $('loginConfirm').value = '';
      showApp();
    } catch (ex) {
      err('Something went wrong while checking the password. Please try again.');
    } finally {
      loginBusy = false;
      $('loginSubmit').disabled = false;
    }
  });

  $('forgotBtn').addEventListener('click', async () => {
    const email = $('loginEmail').value.trim().toLowerCase();
    if (!email || !store.get(accountKey(email), null)) {
      $('loginError').textContent = 'Type your account email above first, then tap “Forgot password?”.';
      return;
    }
    const ok = await askConfirm({
      title: 'Reset this account?',
      text: 'Passwords are stored only on this device, so they cannot be recovered or emailed. You can reset the account, but this permanently erases all entries and reminders saved for this email on this device.',
      typeToConfirm: email,
      yes: 'Erase and reset',
    });
    if (!ok) return;
    store.remove(accountKey(email));
    store.remove(`wmt.data.${email}`);
    store.remove(`wmt.profile.${email}`);
    for (const k of store.keys(entriesPrefix(email))) store.remove(k);
    setAuthMode('signup');
    $('loginError').textContent = '';
    toast('Account reset. Create a new password to start again.');
  });

  $('logoutBtn').addEventListener('click', () => {
    closeMenu();
    local.remove(SESSION_KEY);
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    stopReminderLoop();
    state.user = null;
    $('loginForm').reset();
    setAuthMode('signin');
    showLogin();
  });

  // ---- Change password ----
  const pwDialog = $('pwDialog');
  $('changePwBtn').addEventListener('click', () => {
    closeMenu();
    $('pwForm').reset();
    $('pwError').textContent = '';
    pwDialog.showModal();
    $('pwCurrent').focus();
  });
  $('pwCancel').addEventListener('click', () => pwDialog.close());
  $('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = (m) => { $('pwError').textContent = m; };
    const account = store.get(accountKey(state.user.email), null);
    if (!account) return err('Account not found. Please sign out and create it again.');
    const cur = $('pwCurrent').value, nw = $('pwNew').value;
    if (nw.length < 6) return err('New password must be at least 6 characters.');
    if (nw !== $('pwNew2').value) return err('The new passwords do not match.');
    try {
      if (!(await checkPassword(account, cur))) return err('Current password is wrong.');
      if (!(await store.set(accountKey(state.user.email), { ...account, ...(await makeCredential(nw)) })) && store.mode !== 'memory') {
        store.mem.set(accountKey(state.user.email), account);
        return err('Could not save the new password. Check your internet connection and try again.');
      }
    } catch (ex) { return err('Could not change the password. Please try again.'); }
    pwDialog.close();
    toast('🔑 Password changed');
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

  // ---- In-page confirm (browser confirm() is blocked in some app views) ----
  const confirmDialog = $('confirmDialog');
  function askConfirm({ title, text, yes = 'Delete', typeToConfirm = null }) {
    return new Promise((resolve) => {
      $('confirmTitle').textContent = title;
      $('confirmText').textContent = text;
      $('confirmYes').textContent = yes;
      $('confirmTypeWrap').hidden = !typeToConfirm;
      $('confirmType').value = '';
      $('confirmTypeLabel').textContent = typeToConfirm ? `Type ${typeToConfirm} to confirm` : '';
      $('confirmYes').disabled = !!typeToConfirm;
      $('confirmType').oninput = () => { $('confirmYes').disabled = $('confirmType').value.trim().toLowerCase() !== typeToConfirm; };
      const done = (v) => { confirmDialog.onclose = null; if (confirmDialog.open) confirmDialog.close(); resolve(v); };
      $('confirmYes').onclick = () => done(true);
      $('confirmNo').onclick = () => done(false);
      confirmDialog.onclose = () => done(false); // Esc key
      confirmDialog.showModal();
      (typeToConfirm ? $('confirmType') : $('confirmNo')).focus();
    });
  }

  // ---- File dialog: copy or download (downloads are blocked in some views), or paste to import ----
  const fileDialog = $('fileDialog');
  let fileDialogData = null;
  function openFileDialog({ mode, title, help, name, content, type }) {
    fileDialogData = { name, content, type };
    const exporting = mode === 'export';
    $('fileTitle').textContent = title;
    $('fileHelp').textContent = help;
    $('fileText').value = exporting ? content : '';
    $('fileText').readOnly = exporting;
    $('fileText').placeholder = exporting ? '' : 'Paste your backup JSON here, or choose a backup file.';
    $('fileError').textContent = '';
    $('fileCopy').hidden = !exporting;
    $('fileDownload').hidden = !exporting;
    $('fileChoose').hidden = exporting;
    $('fileImport').hidden = exporting;
    fileDialog.showModal();
    if (!exporting) $('fileText').focus();
  }
  $('fileClose').addEventListener('click', () => fileDialog.close());
  $('fileCopy').addEventListener('click', () => {
    const ta = $('fileText');
    const fallback = () => { ta.focus(); ta.select(); toast('Text selected. Press Ctrl+C (or Copy) to copy it.'); };
    try {
      navigator.clipboard.writeText(ta.value).then(() => toast('📋 Copied'), fallback);
    } catch (e) { fallback(); }
  });
  $('fileDownload').addEventListener('click', () => {
    const d = fileDialogData;
    if (d) download(d.name, d.content, d.type);
  });
  $('fileChoose').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { $('fileText').value = await file.text(); }
    catch (err) { $('fileError').textContent = 'Could not read that file.'; }
  });
  $('fileImport').addEventListener('click', () => {
    const added = importBackup($('fileText').value);
    if (added == null) { $('fileError').textContent = 'That is not a valid tracker backup. Paste the full JSON from “Export backup”.'; return; }
    fileDialog.close();
    toast(`✅ Imported ${added} new entr${added === 1 ? 'y' : 'ies'}.`);
  });

  $('exportBtn').addEventListener('click', () => {
    closeMenu();
    const data = { app: 'weekly-monthly-tracker', version: 1, email: state.user.email, exportedAt: new Date().toISOString(), entries: state.entries, reminders: state.reminders };
    openFileDialog({
      mode: 'export',
      title: 'Export backup',
      help: `${state.entries.length} entries and ${state.reminders.length} reminders. Download the file, or copy the text and keep it somewhere safe (notes, email to yourself).`,
      name: `tracker-backup-${todayKey()}.json`,
      content: JSON.stringify(data, null, 2),
      type: 'application/json',
    });
  });
  $('importBtn').addEventListener('click', () => {
    closeMenu();
    openFileDialog({ mode: 'import', title: 'Import backup', help: 'Entries you already have are kept. Only new entries and reminders are added.' });
  });

  const isTime = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const isDateKey = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(fromKey(d));
  function cleanReminder(r) {
    if (!r || typeof r !== 'object' || !isTime(r.time) || typeof r.text !== 'string' || !r.text.trim()) return null;
    if (r.type === 'date') {
      if (!isDateKey(r.date)) return null;
      return { id: String(r.id || uid()), text: r.text.trim().slice(0, 120), type: 'date', days: [], date: r.date, time: r.time, enabled: r.enabled !== false, lastFired: isDateKey(r.lastFired) ? r.lastFired : null };
    }
    const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
    if (!days.length) return null;
    return { id: String(r.id || uid()), text: r.text.trim().slice(0, 120), type: 'weekly', days, date: null, time: r.time, enabled: r.enabled !== false, lastFired: isDateKey(r.lastFired) ? r.lastFired : null };
  }
  // Returns the number of entries added, or null if the text is not a valid backup.
  function importBackup(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return null; }
    if (!data || !Array.isArray(data.entries)) return null;
    const ids = new Set(state.entries.map((x) => x.id));
    let added = 0;
    for (const x of data.entries) {
      if (!x || !SECTIONS.some((s) => s.id === x.section) || !isDateKey(x.date)) continue;
      const hours = Number(x.hours);
      if (!isFinite(hours) || hours < 0 || hours > 24) continue;
      const id = x.id ? String(x.id) : uid();
      if (ids.has(id)) continue;
      ids.add(id);
      state.entries.push({ id, section: x.section, date: x.date, hours, notes: String(x.notes || ''), updatedAt: Number(x.updatedAt) || Date.now() });
      added++;
    }
    if (Array.isArray(data.reminders)) {
      const rIds = new Set(state.reminders.map((r) => r.id));
      for (const raw of data.reminders) {
        const r = cleanReminder(raw);
        if (r && !rIds.has(r.id)) { rIds.add(r.id); state.reminders.push(r); }
      }
    }
    save(); render(); renderReminderBadge();
    return added;
  }
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
      ...stats.map((x) => el('button', { type: 'button', class: `stat ${x.s.id}`, title: `Open ${x.s.name} full screen`, onclick: () => openFocus(x.s.id) },
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

    // Full-screen section
    document.body.classList.toggle('focus-mode', !!state.focus);
    $('focusBar').hidden = !state.focus;
    summary.hidden = !!state.focus;
    if (state.focus) {
      $('chartCard').hidden = true;
      const x = stats.find((y) => y.s.id === state.focus);
      renderFocusTabs();
      $('sections').replaceChildren(renderFocus(x, p, tK));
      return;
    }

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
        el('button', { type: 'button', class: 'open-btn', title: `Open ${x.s.name} full screen`, onclick: () => openFocus(x.s.id) },
          el('h2', null, el('span', { 'aria-hidden': 'true', text: x.s.icon }), x.s.name, el('span', { class: 'expand', 'aria-hidden': 'true', text: '⤢' })),
          el('div', { class: 'hrs', text: `${fmtHours(x.hours)} h this ${state.view}` })),
        el('button', { class: 'add', onclick: () => openEntry(x.s.id) }, '+ Add')),
      body);
  }

  // ================= Full-screen section =================
  function openFocus(id) {
    state.focus = id;
    try { if (location.hash !== '#' + id) location.hash = id; } catch (e) {}
    render();
    window.scrollTo(0, 0);
    $('focusBack').focus({ preventScroll: true });
  }
  function closeFocus() {
    if (!state.focus) return;
    const id = state.focus;
    state.focus = null;
    try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch (e) {
      try { location.hash = ''; } catch (e2) {}
    }
    render();
    const btn = document.querySelector(`.section.${id} .open-btn`);
    if (btn) btn.focus({ preventScroll: false });
  }
  function focusFromHash() {
    let h = '';
    try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
    const id = SECTIONS.some((s) => s.id === h) ? h : null;
    if (id === state.focus || !state.user) return;
    state.focus = id;
    render();
  }
  window.addEventListener('hashchange', focusFromHash);
  $('focusBack').addEventListener('click', closeFocus);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.focus && !document.querySelector('dialog[open]')) closeFocus();
  });
  function renderFocusTabs() {
    $('focusTabs').replaceChildren(...SECTIONS.map((s) => el('button', {
      type: 'button', role: 'tab', class: `chip ${s.id}`, 'aria-selected': String(s.id === state.focus),
      onclick: () => openFocus(s.id),
    }, el('span', { 'aria-hidden': 'true', text: s.icon }), ' ', s.name)));
  }

  function renderFocus(x, p, tK) {
    const days = [];
    for (let d = new Date(p.start); d <= p.end; d = addDays(d, 1)) days.push(toKey(d));
    const perDay = new Map(days.map((k) => [k, 0]));
    for (const e of x.list) perDay.set(e.date, (perDay.get(e.date) || 0) + (Number(e.hours) || 0));
    const best = [...perDay].reduce((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
    const elapsed = days.filter((k) => k <= tK).length || days.length;

    const stat = (label, value, sub) => el('div', { class: 'fstat' },
      el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), sub ? el('div', { class: 'sub', text: sub }) : null);
    const statsRow = el('div', { class: 'fstats' },
      stat('Total hours', `${fmtHours(x.hours)} h`, `this ${state.view}`),
      stat('Active days', String(x.days), `of ${days.length} days`),
      stat('Average', `${fmtHours(x.days ? x.hours / x.days : 0)} h`, 'per active day'),
      stat('Best day', best[1] ? `${fmtHours(best[1])} h` : '—', best[1] ? `${dayName(best[0]).slice(0, 3)}, ${fmtShort(fromKey(best[0]))}` : `in ${elapsed} day${elapsed === 1 ? '' : 's'} so far`));

    const head = el('div', { class: 'section-head focus-head' },
      el('div', null,
        el('h2', null, el('span', { 'aria-hidden': 'true', text: x.s.icon }), x.s.name),
        el('div', { class: 'hrs', text: `${x.list.length} entr${x.list.length === 1 ? 'y' : 'ies'} · ${$('periodLabel').textContent}` })),
      el('button', { class: 'add', onclick: () => openEntry(x.s.id) }, '+ Add'));

    // Table: reuse the section renderer's table, without its header.
    const table = renderSection(x, tK).lastChild;

    return el('section', { class: `section focus ${x.s.id}`, 'aria-label': `${x.s.name} full screen` },
      head,
      el('div', { class: 'focus-body' }, statsRow, renderDailyChart(x, days, perDay, tK), table));
  }

  function renderDailyChart(x, days, perDay, tK) {
    const maxVal = Math.max(...perDay.values());
    const top = Math.max(1, Math.ceil(maxVal));
    const tip = el('div', { class: 'tip', role: 'status', hidden: true });
    const showTip = (col, k, h) => {
      tip.textContent = `${dayName(k)}, ${fmtShort(fromKey(k))} · ${h ? fmtHours(h) + ' h' : 'no entry'}`;
      tip.hidden = false;
      const plot = col.parentElement.getBoundingClientRect(), r = col.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(r.left - plot.left + r.width / 2, 70), plot.width - 70)}px`;
    };
    const isWeek = days.length <= 7;
    const cols = days.map((k) => {
      const h = perDay.get(k) || 0;
      const d = fromKey(k);
      const label = isWeek ? DAY_NAMES[d.getDay()].slice(0, 3) : String(d.getDate());
      const minor = !isWeek && d.getDate() !== 1 && d.getDate() % 5 !== 0;
      const col = el('button', {
        type: 'button',
        class: `col${k === tK ? ' today' : ''}${minor ? ' minor' : ''}`,
        'aria-label': `${dayName(k)} ${fmtDate(k)}: ${h ? fmtHours(h) + ' hours' : 'no entry'}. Add an entry for this day.`,
        onclick: () => openEntry(x.s.id, null, k),
      },
        el('span', { class: 'bar-area' }, el('span', { class: 'bar', style: `height:${(h / top) * 100}%` })),
        el('span', { class: 'xl', text: label }));
      col.addEventListener('pointerenter', () => showTip(col, k, h));
      col.addEventListener('focus', () => showTip(col, k, h));
      col.addEventListener('pointerleave', () => { tip.hidden = true; });
      col.addEventListener('blur', () => { tip.hidden = true; });
      return col;
    });
    const grid = [top, top / 2, 0].map((v) => el('div', { class: 'gl', style: `bottom:${(v / top) * 100}%` }, el('span', { text: `${fmtHours(v)}h` })));
    return el('div', { class: 'daily' },
      el('div', { class: 'daily-head' },
        el('h3', { text: 'Hours per day' }),
        el('span', { class: 'muted', text: 'Tap a day to log hours for it' })),
      el('div', { class: `plot${isWeek ? ' week' : ''}` }, el('div', { class: 'grid' }, grid), el('div', { class: 'cols' }, cols), tip));
  }

  // ================= Entry dialog =================
  let editingId = null;
  const entryDialog = $('entryDialog');
  $('entrySection').replaceChildren(...SECTIONS.map((s) => el('option', { value: s.id, text: `${s.icon} ${s.name}` })));

  function syncDay() {
    const v = $('entryDate').value;
    $('entryDay').value = /^\d{4}-\d{2}-\d{2}$/.test(v) ? dayName(v) : '';
  }
  function openEntry(sectionId, entry, presetDate) {
    editingId = entry ? entry.id : null;
    $('entryTitle').textContent = entry ? 'Edit entry' : 'Add entry';
    $('entrySection').value = sectionId || SECTIONS[0].id;
    // New entries default to today, or to the period's first day if today is outside the shown period.
    let defDate = todayKey();
    if (!entry) {
      const p = period();
      if (defDate < toKey(p.start) || defDate > toKey(p.end)) defDate = toKey(p.start);
    }
    $('entryDate').value = entry ? entry.date : (presetDate || defDate);
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
  $('entryDelete').addEventListener('click', async () => {
    if (editingId && await deleteEntry(editingId)) entryDialog.close();
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
  async function deleteEntry(id) {
    const e = state.entries.find((x) => x.id === id);
    if (!e) return false;
    const ok = await askConfirm({
      title: 'Delete entry?',
      text: `${SECTIONS.find((s) => s.id === e.section).name} · ${fmtDate(e.date)} · ${fmtHours(e.hours)} h. This cannot be undone.`,
    });
    if (!ok) return false;
    state.entries = state.entries.filter((x) => x.id !== id);
    save(); render();
    toast('🗑️ Entry deleted');
    return true;
  }
  $('fab').addEventListener('click', () => openEntry(state.focus || SECTIONS[0].id));

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
        el('button', { type: 'button', class: 'btn ghost small danger', title: 'Delete', onclick: async () => {
          if (!await askConfirm({ title: 'Delete reminder?', text: `“${r.text}” · ${remWhen(r)}` })) return;
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
    if (type === 'date' && !isDateKey(date)) return err('Please pick a date.');
    const now = new Date(), tK = toKey(now), nowHM = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (type === 'date' && (date < tK || (date === tK && time <= nowHM))) return err('That date and time has already passed. Pick a future time.');
    err('');
    // If today's time has already passed, start from the next occurrence instead of firing right away.
    const passedToday = type === 'weekly' && days.includes(now.getDay()) && time <= nowHM;
    state.reminders.push({ id: uid(), text, type, days: type === 'weekly' ? days : [], date: type === 'date' ? date : null, time, enabled: true, lastFired: passedToday ? tK : null });
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
  let lastSeenDay = todayKey();
  const LATE_LIMIT_MIN = 120; // a reminder missed by more than 2 hours is skipped instead of popping up late
  function checkReminders() {
    if (!state.user) return;
    const now = new Date(), tK = toKey(now);
    // The day changed while the page was open: refresh "today" highlights and the banner.
    if (tK !== lastSeenDay) { lastSeenDay = tK; render(); renderReminderBadge(); }
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    let changed = false;
    for (const r of state.reminders) {
      if (!r.enabled || r.lastFired === tK || !occursOn(r, now) || hhmm < r.time) continue;
      const [h, m] = r.time.split(':').map(Number);
      r.lastFired = tK;
      changed = true;
      if (nowMin - (h * 60 + m) <= LATE_LIMIT_MIN) fireReminder(r);
    }
    if (changed) {
      save(); renderReminderBadge();
      if (reminderDialog.open) renderReminderList();
    }
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) { checkReminders(); renderReminderBadge(); } });

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
    openFileDialog({
      mode: 'export',
      title: 'Add to calendar',
      help: 'Download this .ics file and open it to add the reminder to Google Calendar, Apple Calendar or Outlook. Your calendar will then remind you even when this page is closed.',
      name: `reminder-${r.text.slice(0, 24).replace(/[^\w-]+/g, '-').toLowerCase() || 'tracker'}.ics`,
      content: lines.join('\r\n'),
      type: 'text/calendar',
    });
  }

  // ================= Boot =================
  syncThemeIcon();
  setAuthMode('signin');
  showLogin();
  $('loginSubmit').disabled = true;
  $('loginSubmit').textContent = 'Loading…';
  initStorage().then(() => {
    $('loginSubmit').disabled = false;
    setAuthMode(authMode);
    const note = $('storageNote');
    note.textContent = {
      cloud: 'Your account and entries are saved privately to your Claude account, so they are there on any device where you open this link.',
      local: 'Your account and entries are saved in this browser on this device.',
      memory: '⚠️ This view cannot save anything. You can still sign in, but your account and entries will be lost when you close the page. Open the link in a normal browser tab to keep your data.',
    }[store.mode];
    note.classList.toggle('error', store.mode === 'memory');
    const session = readSession();
    if (session) { state.user = session; showApp(); }
  });
})();
