/* ============================================================
   GoTax.SI — app core: config, storage, mock API, UI primitives
   ------------------------------------------------------------
   The demo persists everything in localStorage behind a single
   `API` object. Swapping in the real backend means replacing the
   bodies of these functions with fetch() calls to the same
   contract (see backend/openapi.yaml and README.md).
   ============================================================ */
(function () {
  'use strict';
  var W = window;

  /* ---------- configuration (overridable by the server) ---------- */
  var DEFAULTS = {
    apiBase: '/api/v1',
    btcRateUsd: 118450,          /* fallback; live rate comes from the processor */
    rateSource: 'btcpay:BTC_USD',
    requiredConfirmations: 2,
    invoiceExpiryMinutes: 15,
    retentionDays: 90,
    signedUrlMinutes: 5,
    maxUploadMb: 15,
    allowedUploadTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    rateLimit: { max: 6, windowMs: 60000 },   /* analyses per minute per device */
    supportEmail: 'support@gotax.si',
    supportPhone: '+1 (555) 010-4477',
    explorerBase: 'https://mempool.space/tx/',
    business: {
      name: '[COMPANY LEGAL NAME — placeholder]',
      address: '[COMPANY ADDRESS — placeholder]',
      email: 'support@gotax.si',
      phone: '+1 (555) 010-4477'
    }
  };
  var cfg = W.__GOTAX_CONFIG__ || {};
  W.CONFIG = Object.assign({}, DEFAULTS, cfg);

  /* ---------- tiny helpers ---------- */
  var App = W.App = {};
  App.escapeHtml = function (s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  App.el = function (sel, root) { return (root || document).querySelector(sel); };
  App.els = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  App.uid = function (prefix) {
    var s = '';
    var a = (W.crypto && W.crypto.getRandomValues) ? new Uint8Array(6) : [];
    if (a.length) W.crypto.getRandomValues(a);
    for (var i = 0; i < 6; i++) s += (a.length ? a[i] : Math.floor(Math.random() * 256)).toString(16).padStart(2, '0');
    return (prefix || 'id') + '-' + s.toUpperCase();
  };
  App.hex = function (bytes) {
    var a = new Uint8Array(bytes), s = '';
    if (W.crypto && W.crypto.getRandomValues) W.crypto.getRandomValues(a);
    else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < a.length; j++) s += a[j].toString(16).padStart(2, '0');
    return s;
  };
  App.formatBytes = function (n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  };
  App.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  App.daysBetween = function (a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000); };

  /* mask "123-45-6789" -> "***-**-6789"; accounts -> "••••4321" */
  App.maskSsn = function (s) {
    var d = String(s).replace(/\D/g, '');
    if (d.length === 9) return '***-**-' + d.slice(5);
    if (d.length >= 4) return '***-**-' + d.slice(-4);
    return '***';
  };
  App.maskAccount = function (s) {
    var d = String(s).replace(/\D/g, '');
    return '••••' + d.slice(-4);
  };

  /* ---------- asset URLs ---------- */
  App.base = function () {
    if (typeof W.__GOTAX_BASE__ === 'string' && W.__GOTAX_BASE__) return W.__GOTAX_BASE__;
    if (W.I18N && W.I18N.base) return W.I18N.base();
    return '';
  };
  App.url = function (p) {
    var s = String(p || '');
    if (/^(https?:)?\/\//.test(s) || s.charAt(0) === '#' || s.indexOf('data:') === 0) return s;
    return App.base() + s.replace(/^\/+/, '');
  };

  /* ---------- storage ---------- */
  var LS = 'gotax.';
  var Store = App.Store = {
    get: function (key, fallback) {
      try {
        var raw = W.localStorage.getItem(LS + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { W.localStorage.setItem(LS + key, JSON.stringify(value)); return true; }
      catch (e) { console.warn('[store] write failed', e); return false; }
    },
    remove: function (key) { try { W.localStorage.removeItem(LS + key); } catch (e) {} },
    list: function (key) { return Store.get(key, []); },
    push: function (key, item) { var l = Store.list(key); l.unshift(item); Store.set(key, l.slice(0, 200)); return item; },
    update: function (key, id, patch) {
      var l = Store.list(key), i = l.findIndex(function (x) { return x.id === id; });
      if (i >= 0) { l[i] = Object.assign({}, l[i], patch); Store.set(key, l); return l[i]; }
      return null;
    },
    clearAll: function () {
      try {
        Object.keys(W.localStorage).filter(function (k) { return k.indexOf(LS) === 0; })
          .forEach(function (k) { W.localStorage.removeItem(k); });
      } catch (e) {}
    }
  };

  /* ---------- audit log ---------- */
  App.audit = function (action, target, detail) {
    var u = API.user();
    return Store.push('audit', {
      id: App.uid('aud'),
      at: new Date().toISOString(),
      actor: u ? (u.role + ':' + (u.email || u.id)) : 'anonymous',
      action: action,
      target: target || '',
      detail: detail || ''
    });
  };

  /* ---------- rate limiting (client-side demo guard) ---------- */
  App.rateLimit = function (key) {
    var now = Date.now();
    var hits = (Store.get('rl.' + key, []) || []).filter(function (t) { return now - t < CONFIG.rateLimit.windowMs; });
    if (hits.length >= CONFIG.rateLimit.max) return false;
    hits.push(now);
    Store.set('rl.' + key, hits);
    return true;
  };

  /* ---------- toasts ---------- */
  App.toast = function (msg, kind, ms) {
    var host = App.el('.toast-host') || (function () {
      var d = document.createElement('div'); d.className = 'toast-host'; d.setAttribute('aria-live', 'polite');
      document.body.appendChild(d); return d;
    })();
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.setAttribute('role', 'status');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s'; t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 320);
    }, ms || 4200);
  };

  /* ---------- modal ---------- */
  App.modal = function (opts) {
    var old = App.el('#app-modal'); if (old) old.remove();
    var m = document.createElement('div');
    m.className = 'modal'; m.id = 'app-modal'; m.setAttribute('data-open', 'true'); m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', opts.title || 'Dialog');
    m.innerHTML =
      '<div class="modal-scrim" data-close></div>' +
      '<div class="modal-box">' +
        '<button class="icon-btn modal-close" data-close aria-label="' + App.escapeHtml(W.t ? W.t('cta.close') : 'Close') + '">' + ICONS.x + '</button>' +
        (opts.title ? '<h3>' + App.escapeHtml(opts.title) + '</h3>' : '') +
        '<div class="modal-body">' + (opts.bodyHtml || '') + '</div>' +
        (opts.actionsHtml ? '<div class="btn-row mt6 modal-actions">' + opts.actionsHtml + '</div>' : '') +
      '</div>';
    document.body.appendChild(m);
    document.body.classList.add('no-scroll');
    var focusable = m.querySelector('button:not([data-close]), input, select, textarea, [data-close]');
    if (focusable) focusable.focus();
    m.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) App.closeModal();
    });
    m.addEventListener('keydown', function (e) { if (e.key === 'Escape') App.closeModal(); });
    if (opts.onMount) opts.onMount(m);
    return m;
  };
  App.closeModal = function () {
    var m = App.el('#app-modal'); if (m) m.remove();
    document.body.classList.remove('no-scroll');
  };
  App.confirm = function (title, bodyHtml, onYes, yesLabel) {
    App.modal({
      title: title, bodyHtml: bodyHtml,
      actionsHtml: '<button class="btn btn-outline" data-close>' + App.escapeHtml(W.t('cta.cancel')) + '</button>' +
                   '<button class="btn btn-danger" data-yes>' + App.escapeHtml(yesLabel || W.t('cta.confirm')) + '</button>',
      onMount: function (m) {
        m.querySelector('[data-yes]').addEventListener('click', function () { App.closeModal(); onYes && onYes(); });
      }
    });
  };

  /* ---------- icons (inline SVG, no external requests) ---------- */
  var ICONS = W.ICONS = {
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 118 0v3"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>',
    checkCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 16H3l9-16z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8.2v.1"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 2.6 15 0 18-2.6-3-2.6-15.4 0-18z"/></svg>',
    caret: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    btc: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.2 10.6c.4-1.9-1.1-2.9-3.1-3.6l.7-2.6-1.6-.4-.6 2.5-1.3-.3.6-2.5L7.3 3l-.7 2.6c-.3-.1-.6-.2-1-.3v0L4.1 5l.3 1.2s.7-.2.7-.1c.4-.1.6.1.7.3l-.8 3v.2c0 0 .1 0 0 0l-.1.3-1 4c-.1.2-.3.5-.7.4 0 0-.7-.1-.7-.1L3 16l1.6.4.8.2-.7 2.8 1.6.4.6-2.6c.3.1.6.2.9.3l-.6 2.6 1.6.4.7-2.7c2.7.5 4.8.3 5.7-2.2.7-2-.1-3.2-1.6-4 1.1-.3 1.9-1 2.1-2.5zm-3.8 5c-.5 2-4 1-5.1.7l1-3.9c1.1.3 4.6.8 4.1 3.2zm.5-5.1c-.5 1.9-3.4.9-4.3.7l.9-3.6c.9.2 3.9.7 3.4 2.9z"/></svg>',
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h3"/></svg>',
    qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h8"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.4-3.4 4-5 7-5s5.6 1.6 7 5"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="2"/><path d="M7 16h10v4H7z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/></svg>',
    scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3"/><path d="M4 12h16"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L21 21"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V9l-6-6z"/><path d="M13 3v6h6"/><path d="M9 14h6"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 007.5.5l2-2A5 5 0 0012.5 4.5l-1 1"/><path d="M14 11a5 5 0 00-7.5-.5l-2 2A5 5 0 0011.5 19.5l1-1"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>',
    receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
    brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 4A2.5 2.5 0 007 6.5 2.5 2.5 0 005 9c0 .9.4 1.6 1 2.1-.6.5-1 1.3-1 2.1A2.7 2.7 0 007.7 16 2.5 2.5 0 0012 18.5V5.5A2.5 2.5 0 009.5 4z"/><path d="M14.5 4A2.5 2.5 0 0117 6.5 2.5 2.5 0 0119 9c0 .9-.4 1.6-1 2.1.6.5 1 1.3 1 2.1a2.7 2.7 0 01-2.7 2.8A2.5 2.5 0 0112 18.5"/><path d="M9 9h2M9 13h2"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11V4h7l9 9-7 7-9-9z"/><circle cx="8" cy="8" r="1.4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/></svg>'
  };
  App.icons = ICONS;

  /* ---------- file validation + simulated malware scan ---------- */
  App.validateFile = function (file) {
    if (!file) return { ok: false, reason: 'no-file' };
    var maxBytes = CONFIG.maxUploadMb * 1024 * 1024;
    if (file.size > maxBytes) return { ok: false, reason: 'too-big' };
    var type = (file.type || '').toLowerCase();
    var name = (file.name || '').toLowerCase();
    var extOk = /\.(jpe?g|png|pdf)$/.test(name);
    var typeOk = CONFIG.allowedUploadTypes.indexOf(type) >= 0;
    if (!typeOk && !extOk) return { ok: false, reason: 'bad-type' };
    return { ok: true, type: type || 'application/octet-stream', ext: name.split('.').pop() };
  };

  /* Read the first bytes to confirm the declared type (magic-byte check). */
  App.sniffFile = function (file) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () {
        var b = new Uint8Array(fr.result);
        var head = Array.prototype.slice.call(b, 0, 5);
        var kind = 'unknown';
        if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) kind = 'jpeg';
        else if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47) kind = 'png';
        else if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) kind = 'pdf';
        resolve({ kind: kind, matchesDeclaration: kind !== 'unknown' });
      };
      fr.onerror = function () { resolve({ kind: 'unknown', matchesDeclaration: false }); };
      fr.readAsArrayBuffer(file.slice(0, 5));
    });
  };

  /* ---------- mock API (same shape as the real HTTP API) ---------- */
  var API = W.API = {};

  API.config = function () { return Object.assign({}, CONFIG, Store.get('settings', {})); };
  API.saveConfig = function (patch) {
    var s = Object.assign(Store.get('settings', {}), patch);
    Store.set('settings', s); App.audit('settings.update', 'system', JSON.stringify(patch).slice(0, 200));
    return API.config();
  };

  /* sessions: demo role switcher (customer / reviewer / admin) */
  API.user = function () { return Store.get('user', null); };
  API.signIn = function (roleOrCreds) {
    var creds = (roleOrCreds && typeof roleOrCreds === 'object') ? roleOrCreds : null;
    var role = creds ? (creds.role || 'customer') : (roleOrCreds || 'customer');
    var users = {
      customer: { id: 'usr-demo-cust', role: 'customer', name: 'Ayesha Rahman', email: 'ayesha@example.com', emailVerified: true, twoFactor: false },
      reviewer: { id: 'usr-demo-cpa', role: 'reviewer', name: 'Jordan Lee, CPA', email: 'jordan@partner-cpa.example', emailVerified: true, twoFactor: true, ptin: 'P01234567' },
      admin: { id: 'usr-demo-admin', role: 'admin', name: 'Site Admin', email: 'admin@gotax.si', emailVerified: true, twoFactor: true }
    };
    var u = Object.assign({}, users[role] || users.customer);
    if (creds) {
      if (creds.email) u.email = creds.email;
      if (creds.name) u.name = creds.name;
      u.emailVerified = false;
    }
    u.sessionId = App.hex(16);
    u.signedInAt = new Date().toISOString();
    Store.set('user', u);
    App.audit('auth.signIn', u.id, 'role=' + u.role);
    return u;
  };
  API.signOut = function () { var u = API.user(); if (u) App.audit('auth.signOut', u.id); Store.remove('user'); };
  API.requireRole = function (roles) {
    var u = API.user();
    if (!u) return null;
    if (roles.indexOf(u.role) < 0) return null;
    return u;
  };

  API.rate = function () {
    var c = API.config();
    var stored = Store.get('rate', null);
    if (stored && Date.now() - stored.at < 60000) return stored.usd;
    /* demo: deterministic-ish drift around the configured base rate */
    var drift = (Math.sin(Date.now() / 900000) * 0.004);
    var usd = Math.round(c.btcRateUsd * (1 + drift) * 100) / 100;
    Store.set('rate', { usd: usd, at: Date.now(), source: c.rateSource });
    return usd;
  };

  API.usdToBtc = function (usd) {
    var r = API.rate();
    return { usd: usd, rate: r, btc: Math.round((usd / r) * 1e8) / 1e8 };
  };

  /* invoices / payments */
  API.createInvoice = function (opts) {
    var c = API.config();
    var conv = API.usdToBtc(opts.usd);
    var method = opts.method || 'btc-onchain';
    var inv = {
      id: App.uid('INV'),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + c.invoiceExpiryMinutes * 60000).toISOString(),
      serviceId: opts.serviceId, serviceLabel: opts.serviceLabel,
      usd: opts.usd, rate: conv.rate, btc: conv.btc,
      method: method,
      status: 'waiting',
      confirmations: 0, requiredConfirmations: method === 'btc-lightning' ? 0 : c.requiredConfirmations,
      address: method === 'btc-lightning' ? '' : ('bc1q' + App.hex(20)),
      bolt11: method === 'btc-lightning' ? ('lnbc' + opts.usd.toFixed(0) + 'u1p' + App.hex(35)) : '',
      txid: '', paymentHash: method === 'btc-lightning' ? App.hex(32) : '',
      email: opts.email || '', name: opts.name || '',
      locale: opts.locale || 'en',
      uri: method === 'btc-lightning'
        ? ('lightning:' + 'lnbc' + opts.usd.toFixed(0) + 'u1p' + App.hex(35))
        : ('bitcoin:' + 'bc1q' + App.hex(20) + '?amount=' + conv.btc.toFixed(8))
    };
    Store.push('invoices', inv);
    App.audit('payment.invoice.created', inv.id, inv.method + ' ' + inv.usd + ' USD');
    return inv;
  };

  API.invoice = function (id) {
    return Store.list('invoices').filter(function (i) { return i.id === id; })[0] || null;
  };

  API.setInvoiceStatus = function (id, status, patch) {
    var p = Object.assign({ status: status, updatedAt: new Date().toISOString() }, patch || {});
    var inv = Store.update('invoices', id, p);
    if (inv) {
      App.audit('payment.status.' + status, id, 'txid=' + (inv.txid || '-') + ' conf=' + inv.confirmations);
      if (status === 'confirmed') API.deliver(inv);
    }
    return inv;
  };

  /* On confirmation: create a receipt and unlock the purchased service. */
  API.deliver = function (inv) {
    var receipt = {
      id: App.uid('RCT'),
      invoiceId: inv.id,
      at: new Date().toISOString(),
      name: inv.name || (API.user() || {}).name || 'Customer',
      email: inv.email || (API.user() || {}).email || '',
      serviceId: inv.serviceId, serviceLabel: inv.serviceLabel,
      usd: inv.usd, btc: inv.btc, rate: inv.rate, method: inv.method,
      txid: inv.txid || (inv.paymentHash ? '' : App.hex(32)),
      paymentHash: inv.paymentHash || '',
      confirmations: inv.confirmations,
      locale: inv.locale,
      explorerUrl: inv.txid ? CONFIG.explorerBase + inv.txid : ''
    };
    Store.push('receipts', receipt);
    Store.push('entitlements', { id: App.uid('ent'), serviceId: inv.serviceId, receiptId: receipt.id, at: receipt.at });
    App.audit('payment.receipt.issued', receipt.id, 'invoice=' + inv.id);
    return receipt;
  };

  API.hasEntitlement = function (serviceId) {
    return Store.list('entitlements').some(function (e) { return e.serviceId === serviceId; });
  };

  API.refund = function (invoiceId, amountUsd, reason) {
    var inv = Store.update('invoices', invoiceId, { status: 'refunded', refundedUsd: amountUsd, refundReason: reason, refundedAt: new Date().toISOString() });
    Store.push('refunds', { id: App.uid('REF'), invoiceId: invoiceId, usd: amountUsd, reason: reason, at: new Date().toISOString(), by: (API.user() || {}).email || 'admin' });
    App.audit('payment.refund.recorded', invoiceId, amountUsd + ' USD — ' + reason);
    return inv;
  };

  /* documents + explanations (see decoder.js for the analysis pipeline) */
  API.saveDocument = function (doc) {
    var c = API.config();
    doc.id = doc.id || App.uid('doc');
    doc.createdAt = doc.createdAt || new Date().toISOString();
    doc.deleteAt = new Date(Date.now() + c.retentionDays * 86400000).toISOString();
    doc.signedUrl = '/private/' + doc.id + '?sig=' + App.hex(8) + '&exp=' + (Date.now() + c.signedUrlMinutes * 60000);
    doc.signedUrlExpiresAt = new Date(Date.now() + c.signedUrlMinutes * 60000).toISOString();
    doc.consent = { granted: true, at: doc.consentAt || new Date().toISOString(), version: 'v1.0' };
    Store.push('documents', doc);
    App.audit('document.upload', doc.id, (doc.name || 'pasted-text') + ' ' + (doc.sizeLabel || ''));
    return doc;
  };
  API.saveExplanation = function (ex) {
    ex.id = ex.id || App.uid('exp');
    ex.createdAt = ex.createdAt || new Date().toISOString();
    ex.status = ex.status || 'ai-ready';
    Store.push('explanations', ex);
    App.audit('explanation.created', ex.id, ex.noticeCode + ' lang=' + ex.locale);
    return ex;
  };
  API.deleteDocument = function (id) {
    var l = Store.list('documents').filter(function (d) { return d.id !== id; });
    Store.set('documents', l);
    App.audit('document.delete', id, 'user-requested deletion');
  };
  API.deleteAllData = function () {
    ['documents', 'explanations', 'audit'].forEach(function (k) { Store.set(k, []); });
    Store.remove('user');
    App.audit('privacy.deleteAll', 'account', 'erasure request fulfilled');
  };
  API.purgeExpired = function () {
    var now = Date.now();
    var keep = Store.list('documents').filter(function (d) { return new Date(d.deleteAt).getTime() > now; });
    var removed = Store.list('documents').length - keep.length;
    if (removed > 0) { Store.set('documents', keep); App.audit('retention.autopurge', 'documents', removed + ' file(s) deleted'); }
    return removed;
  };
  API.requestReview = function (payload) {
    var item = Object.assign({ id: App.uid('rev'), at: new Date().toISOString(), status: 'queued', assignee: '' }, payload);
    Store.push('reviewQueue', item);
    App.audit('review.requested', item.id, item.reason || item.noticeCode || 'manual');
    return item;
  };

  /* ---------- read helpers (newest-first lists) ---------- */
  API.listDocuments = function () { return Store.list('documents'); };
  API.getDocument = function (id) { return Store.list('documents').filter(function (d) { return d.id === id; })[0] || null; };
  API.viewDocument = function (id) {
    var d = API.getDocument(id);
    if (!d) return null;
    /* every file view is audited (who, what, when) — no content is logged */
    App.audit('document.view', id, (d.name || '') + ' via signed URL');
    return d;
  };
  API.listExplanations = function () { return Store.list('explanations'); };
  API.deleteExplanation = function (id) {
    Store.set('explanations', Store.list('explanations').filter(function (e) { return e.id !== id; }));
    App.audit('explanation.delete', id, 'user-requested deletion');
  };
  API.listInvoices = function () { return Store.list('invoices'); };
  API.listReceipts = function () { return Store.list('receipts'); };
  API.listRefunds = function () { return Store.list('refunds'); };
  API.listEntitlements = function () { return Store.list('entitlements'); };
  API.listReviews = function () { return Store.list('reviewQueue'); };
  API.updateReview = function (id, patch) {
    var item = Store.update('reviewQueue', id, patch);
    if (item) App.audit('review.updated', id, JSON.stringify(patch).slice(0, 160));
    return item;
  };
  API.listAudit = function () { return Store.list('audit'); };

  /* ---------- header / footer behaviour ---------- */
  App.bootChrome = function () {
    /* mobile drawer */
    var menuBtn = App.el('#menu-btn'), drawer = App.el('#drawer');
    if (menuBtn && drawer) {
      var open = function (v) {
        drawer.setAttribute('data-open', v ? 'true' : 'false');
        menuBtn.setAttribute('aria-expanded', v ? 'true' : 'false');
        document.body.classList.toggle('no-scroll', !!v);
        if (v) { var f = drawer.querySelector('a,button'); if (f) f.focus(); }
      };
      menuBtn.addEventListener('click', function () { open(drawer.getAttribute('data-open') !== 'true'); });
      App.els('[data-close-drawer]', drawer).forEach(function (b) { b.addEventListener('click', function () { open(false); }); });
      drawer.addEventListener('click', function (e) { if (e.target.classList.contains('drawer-scrim')) open(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawer.getAttribute('data-open') === 'true') open(false); });
    }
    App.buildLangSwitcher();
    App.renderAccountChip();
    App.buildCookieBar();
    App.trackPageView();
  };

  App.buildLangSwitcher = function () {
    var hosts = App.els('[data-lang-switcher]');
    if (!hosts.length) return;
    hosts.forEach(function (host) {
      host.classList.add('lang');
      host.innerHTML =
        '<button class="lang-btn" aria-haspopup="true" aria-expanded="false" data-lang-toggle>' +
          '<span class="globe">' + ICONS.globe + '</span>' +
          '<span data-i18n-current-locale>' + App.escapeHtml(W.I18N.meta(W.I18N.current).native) + '</span>' +
          '<span class="caret">' + ICONS.caret + '</span>' +
        '</button>' +
        '<div class="lang-panel" data-lang-panel role="dialog" aria-label="' + App.escapeHtml(W.t('lang.choose')) + '">' +
          '<h4 data-i18n="lang.choose">Choose your language</h4>' +
          '<ul class="lang-list" role="radiogroup"></ul>' +
          '<p class="lang-note" data-i18n="lang.remembered"></p>' +
          '<p class="lang-note" data-i18n="lang.mtNote"></p>' +
        '</div>';
      var list = host.querySelector('.lang-list');
      W.I18N.locales.forEach(function (l) {
        var li = document.createElement('li');
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', l.code === W.I18N.current ? 'true' : 'false');
        b.dataset.code = l.code;
        b.innerHTML = '<span>' + App.escapeHtml(l.label) + '<span class="native">' + App.escapeHtml(l.native) + '</span></span>' +
                      '<span class="tick" aria-hidden="true"></span>';
        b.addEventListener('click', function () {
          W.I18N.set(l.code);
          App.toast(W.I18N.name(l.code) + ' — ' + W.t('lang.remembered'), 'ok', 2600);
          closePanel();
        });
        li.appendChild(b); list.appendChild(li);
      });
      var toggle = host.querySelector('[data-lang-toggle]');
      var panel = host.querySelector('[data-lang-panel]');
      var closePanel = function () { panel.setAttribute('data-open', 'false'); toggle.setAttribute('aria-expanded', 'false'); };
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var openNow = panel.getAttribute('data-open') === 'true';
        panel.setAttribute('data-open', openNow ? 'false' : 'true');
        toggle.setAttribute('aria-expanded', openNow ? 'false' : 'true');
      });
      document.addEventListener('click', function (e) {
        if (!host.contains(e.target)) closePanel();
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
    });
    W.I18N.onChange(function (code) {
      App.els('.lang-list button').forEach(function (b) {
        b.setAttribute('aria-checked', b.dataset.code === code ? 'true' : 'false');
        b.querySelector('.tick').textContent = b.dataset.code === code ? '✓' : '';
      });
      App.els('[data-i18n-current-locale]').forEach(function (s) { s.textContent = W.I18N.meta(code).native; });
    });
  };

  App.renderAccountChip = function () {
    var u = API.user();
    App.els('[data-account-chip]').forEach(function (host) {
      if (u) {
        host.innerHTML = '<a class="btn btn-sm btn-outline" href="account.html">' +
          '<span>' + ICONS.user + '</span><span>' + App.escapeHtml(u.name.split(' ')[0]) + '</span></a>';
      } else {
        host.innerHTML = '<a class="btn btn-sm btn-outline" href="account.html" data-i18n="cta.signIn">Sign in</a>';
      }
      if (W.I18N) W.I18N.apply(host);
    });
  };

  App.buildCookieBar = function () {
    if (Store.get('cookieConsent', null)) return;
    var bar = document.createElement('div');
    bar.className = 'cookie-bar'; bar.setAttribute('data-open', 'true'); bar.setAttribute('role', 'region');
    bar.innerHTML =
      '<p data-i18n="footer.analytics"></p>' +
      '<div class="btn-row">' +
        '<button class="btn btn-sm btn-primary" data-accept>' + App.escapeHtml(W.t('cta.confirm')) + '</button>' +
        '<button class="btn btn-sm btn-ghost" data-decline>' + App.escapeHtml(W.t('cta.cancel')) + '</button>' +
      '</div>';
    document.body.appendChild(bar);
    W.I18N.apply(bar);
    bar.querySelector('[data-accept]').addEventListener('click', function () {
      Store.set('cookieConsent', { analytics: true, at: new Date().toISOString() }); bar.remove();
    });
    bar.querySelector('[data-decline]').addEventListener('click', function () {
      Store.set('cookieConsent', { analytics: false, at: new Date().toISOString() }); bar.remove();
    });
  };

  /* privacy-first analytics stub: counts only, no personal data, no ids */
  App.trackPageView = function () {
    var consent = Store.get('cookieConsent', null);
    if (!consent || !consent.analytics) return;
    var events = Store.get('analytics', []);
    events.push({ p: W.location.pathname.split('/').pop() || 'index', l: W.I18N.current, t: Date.now() });
    Store.set('analytics', events.slice(-500));
  };
  App.track = function (name, props) {
    var consent = Store.get('cookieConsent', null);
    if (!consent || !consent.analytics) return;
    var events = Store.get('analytics', []);
    events.push({ e: name, p: props || {}, l: W.I18N.current, t: Date.now() });
    Store.set('analytics', events.slice(-500));
  };

  /* ---------- sample data seeding ---------- */
  App.seed = function () {
    if (Store.get('seeded', false)) return;
    var now = Date.now();
    var day = 86400000;
    var rate = CONFIG.btcRateUsd;
    function inv(i, serviceId, label, usd, method, status, daysAgo) {
      var btc = Math.round((usd / rate) * 1e8) / 1e8;
      var at = new Date(now - daysAgo * day).toISOString();
      var txid = method.indexOf('lightning') === 0 ? '' : App.hex(32);
      return {
        id: 'INV-S' + String(i).padStart(3, '0'), createdAt: at,
        expiresAt: new Date(now - daysAgo * day + 900000).toISOString(),
        serviceId: serviceId, serviceLabel: label, usd: usd, btc: btc, rate: rate, method: method,
        status: status, confirmations: status === 'confirmed' ? CONFIG.requiredConfirmations : 0,
        requiredConfirmations: method === 'btc-lightning' ? 0 : CONFIG.requiredConfirmations,
        address: txid ? 'bc1q' + App.hex(20) : '', bolt11: method === 'btc-lightning' ? 'lnbc' + usd + 'u1p' + App.hex(30) : '',
        txid: txid, paymentHash: method === 'btc-lightning' ? App.hex(32) : '',
        email: 'customer' + i + '@example.com', name: ['Ayesha Rahman', 'Miguel Santos', 'Wei Chen', 'Fatima Noor', 'John Carter', 'Priya Sharma'][i % 6],
        locale: ['en', 'es', 'zh-CN', 'ar', 'en', 'hi'][i % 6]
      };
    }
    var seeds = [
      inv(1, 'notice-explain', 'Notice explanation — CP2000', 19, 'btc-onchain', 'confirmed', 12),
      inv(2, 'draft-letter', 'Draft response letter — CP14', 29, 'btc-onchain', 'confirmed', 9),
      inv(3, 'return-1040', 'Tax return prep — Form 1040', 189, 'btc-lightning', 'confirmed', 6),
      inv(4, 'notice-explain', 'Notice explanation — CP504', 19, 'card', 'confirmed', 4),
      inv(5, 'human-review', 'Human review by CPA/EA', 49, 'btc-onchain', 'detected', 1),
      inv(6, 'monthly-plan', 'Monthly plan', 39, 'btc-onchain', 'waiting', 0),
      inv(7, 'notice-explain', 'Notice explanation — LTR3219C', 19, 'btc-onchain', 'underpaid', 2),
      inv(8, 'draft-letter', 'Draft response letter — CP501', 29, 'btc-onchain', 'expired', 3)
    ];
    Store.set('invoices', seeds);
    Store.set('receipts', seeds.filter(function (s) { return s.status === 'confirmed'; }).map(function (s, i) {
      return {
        id: 'RCT-S' + String(i + 1).padStart(3, '0'), invoiceId: s.id, at: s.createdAt, name: s.name, email: s.email,
        serviceId: s.serviceId, serviceLabel: s.serviceLabel, usd: s.usd, btc: s.btc, rate: s.rate, method: s.method,
        txid: s.txid, paymentHash: s.paymentHash, confirmations: s.confirmations, locale: s.locale,
        explorerUrl: s.txid ? CONFIG.explorerBase + s.txid : ''
      };
    }));
    Store.set('entitlements', seeds.filter(function (s) { return s.status === 'confirmed'; }).map(function (s) {
      return { id: App.uid('ent'), serviceId: s.serviceId, receiptId: 'RCT', at: s.createdAt };
    }));
    Store.set('documents', [
      {
        id: 'doc-s1', name: 'irs-cp2000-sample.pdf', kind: 'pdf', sizeLabel: '412 KB', pages: 2,
        noticeCode: 'CP2000', createdAt: new Date(now - 12 * day).toISOString(),
        deleteAt: new Date(now + (CONFIG.retentionDays - 12) * day).toISOString(),
        signedUrl: '/private/doc-s1?sig=' + App.hex(8) + '&exp=' + (now + 300000),
        signedUrlExpiresAt: new Date(now + 300000).toISOString(),
        scan: 'clean', consent: { granted: true, at: new Date(now - 12 * day).toISOString(), version: 'v1.0' },
        status: 'explained'
      },
      {
        id: 'doc-s2', name: 'w2-2024-employer.jpg', kind: 'jpeg', sizeLabel: '1.2 MB', pages: 1,
        noticeCode: 'W-2', createdAt: new Date(now - 6 * day).toISOString(),
        deleteAt: new Date(now + (CONFIG.retentionDays - 6) * day).toISOString(),
        signedUrl: '/private/doc-s2?sig=' + App.hex(8) + '&exp=' + (now + 300000),
        signedUrlExpiresAt: new Date(now + 300000).toISOString(),
        scan: 'clean', consent: { granted: true, at: new Date(now - 6 * day).toISOString(), version: 'v1.0' },
        status: 'prefilled'
      }
    ]);
    Store.set('reviewQueue', [
      { id: 'rev-s1', at: new Date(now - 2 * day).toISOString(), status: 'queued', assignee: '', noticeCode: 'CP504', risk: 'levy', reason: 'risk.levy', locale: 'en', email: 'customer5@example.com' },
      { id: 'rev-s2', at: new Date(now - 1 * day).toISOString(), status: 'in-review', assignee: 'jordan@partner-cpa.example', noticeCode: 'CP2000', risk: '', reason: 'low-ocr-confidence', locale: 'bn', email: 'customer1@example.com' },
      { id: 'rev-s3', at: new Date(now - 5 * 3600000).toISOString(), status: 'queued', assignee: '', noticeCode: 'LTR5071C', risk: 'fraud', reason: 'risk.fraud', locale: 'zh-CN', email: 'customer3@example.com' }
    ]);
    Store.set('audit', [
      { id: App.uid('aud'), at: new Date(now - 12 * day).toISOString(), actor: 'customer:ayesha@example.com', action: 'document.upload', target: 'doc-s1', detail: 'irs-cp2000-sample.pdf 412 KB' },
      { id: App.uid('aud'), at: new Date(now - 12 * day + 60000).toISOString(), actor: 'system', action: 'redaction.applied', target: 'doc-s1', detail: '2 SSN, 1 bank account masked' },
      { id: App.uid('aud'), at: new Date(now - 12 * day + 90000).toISOString(), actor: 'system', action: 'explanation.created', target: 'exp-s1', detail: 'CP2000 lang=en,bn' },
      { id: App.uid('aud'), at: new Date(now - 6 * day).toISOString(), actor: 'reviewer:jordan@partner-cpa.example', action: 'document.view', target: 'doc-s2', detail: 'signed URL issued' },
      { id: App.uid('aud'), at: new Date(now - 2 * day).toISOString(), actor: 'system', action: 'review.requested', target: 'rev-s1', detail: 'CP504 levy risk' }
    ]);
    Store.set('seeded', true);
  };

  /* ---------- boot ---------- */
  function boot() {
    App.seed();
    API.purgeExpired();
    App.bootChrome();
    if (W.I18N) {
      W.I18N.apply(document);
      W.I18N.onChange(function () {
        App.renderAccountChip();
        document.dispatchEvent(new CustomEvent('gotax:langchange', { detail: { locale: W.I18N.current } }));
      });
    }
    /* footer year */
    App.els('[data-year]').forEach(function (n) { n.textContent = String(new Date().getFullYear()); });
    /* demo banner */
    if (App.el('[data-demo-banner]')) {
      App.el('[data-demo-banner]').textContent = W.t('common.demoMode');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
