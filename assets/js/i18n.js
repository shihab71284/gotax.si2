/* ============================================================
   GoTax.SI — i18n runtime
   ------------------------------------------------------------
   English (en.js) is always loaded first: it is the source of
   truth and the fallback for every other locale. Other locale
   dictionaries are fetched lazily (one file per language) so the
   first paint stays small on slow connections.
   Usage:  t('decoder.title')   t('common.step', {a:1,b:6})
           data-i18n="nav.home" / data-i18n-html / data-i18n-attr
   ============================================================ */
(function () {
  'use strict';
  var W = window;
  var I = W.I18N = W.I18N || {};
  var LS_KEY = 'gotax.lang';
  var listeners = [];
  var loading = null;

  I.defaultLocale = 'en';
  I.current = I.defaultLocale;

  function ls() {
    try { return W.localStorage; } catch (e) { return null; }
  }
  function codeOf(entry) { return entry.code; }
  I.codes = function () { return (I.locales || []).map(codeOf); };
  I.meta = function (code) {
    var list = I.locales || [];
    for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
    return list[0];
  };
  I.name = function (code) { return (I.meta(code) || {}).native || code; };

  /* ---- detection: stored choice > URL ?lang= > navigator ---- */
  function detect() {
    var store = ls();
    var saved = store && store.getItem(LS_KEY);
    if (saved && I.meta(saved) && I.meta(saved).code === saved) return saved;
    try {
      var q = new URLSearchParams(W.location.search).get('lang');
      if (q && I.meta(q)) return q;
    } catch (e) { /* ignore */ }
    var nav = (W.navigator.languages || [W.navigator.language || 'en']);
    for (var i = 0; i < nav.length; i++) {
      var c = nav[i];
      if (I.meta(c) && I.meta(c).code === c) return c;
      var short = String(c).split('-')[0];
      var m = (I.locales || []).filter(function (l) { return l.code.split('-')[0] === short; })[0];
      if (m) return m.code;
    }
    return I.defaultLocale;
  }

  /* ---- dictionary access with English fallback ---- */
  function dict(code) { return I[code] || null; }

  function lookup(code, key) {
    var d = dict(code);
    if (d && Object.prototype.hasOwnProperty.call(d, key)) return d[key];
    d = dict(I.defaultLocale);
    if (d && Object.prototype.hasOwnProperty.call(d, key)) return d[key];
    return null;
  }

  function interpolate(str, params) {
    if (!params) return str;
    return String(str).replace(/\{(\w+(?:-\w+)*)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(params, k) ? params[k] : m;
    });
  }

  /**
   * Translate a key. Falls back to English, then to the key itself
   * (so a missing string is visible in development instead of blank).
   */
  W.t = I.t = function (key, params) {
    var v = lookup(I.current, key);
    if (v === null) v = key;
    return interpolate(v, params);
  };

  /** True when the string came from the English fallback dictionary. */
  I.isFallback = function (key) {
    var d = dict(I.current);
    return !(d && Object.prototype.hasOwnProperty.call(d, key));
  };

  /* Resolve asset URLs against the site base so pages in sub-folders
     (legal/, notices/) load their dictionaries correctly. */
  function base() {
    if (typeof W.__GOTAX_BASE__ === 'string' && W.__GOTAX_BASE__) return W.__GOTAX_BASE__;
    var ss = document.getElementsByTagName('script');
    for (var i = 0; i < ss.length; i++) {
      var src = ss[i].getAttribute('src') || '';
      var m = src.match(/^(.*\/)assets\/js\/i18n\.js$/);
      if (m) return m[1];
    }
    return '';
  }
  I.base = base;

  /* ---- lazy locale loading ---- */
  I.load = function (code, cb) {
    if (code === I.defaultLocale || dict(code)) { if (cb) cb(); return; }
    if (loading && loading.code === code) { loading.cbs.push(cb); return; }
    loading = { code: code, cbs: cb ? [cb] : [] };
    var s = document.createElement('script');
    s.src = base() + 'assets/js/i18n/' + code + '.js';
    s.async = true;
    var finish = function () {
      var cbs = loading ? loading.cbs : [];
      loading = null;
      cbs.forEach(function (f) { if (typeof f === 'function') f(); });
    };
    s.onload = finish;
    s.onerror = function () {
      /* keep English; do not break the page */
      console.warn('[i18n] could not load locale ' + code + ', using English fallback');
      finish();
    };
    document.head.appendChild(s);
  };

  /* ---- document language / direction ---- */
  I.applyDocument = function () {
    var m = I.meta(I.current) || { code: 'en', dir: 'ltr' };
    var el = document.documentElement;
    el.setAttribute('lang', m.code);
    el.setAttribute('dir', m.dir === 'rtl' ? 'rtl' : 'ltr');
    el.classList.toggle('rtl', m.dir === 'rtl');
  };

  /* ---- translate a subtree ---- */
  I.apply = function (root) {
    root = root || document;
    var i, nodes;
    nodes = root.querySelectorAll('[data-i18n]');
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var key = n.getAttribute('data-i18n');
      var val = W.t(key, readParams(n));
      if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') n.value = val;
      else n.textContent = val;
      /* mark untranslated (English fallback) strings for the MT note */
      if (I.current !== 'en' && I.isFallback(key)) n.setAttribute('data-i18n-fallback', '');
      else n.removeAttribute('data-i18n-fallback');
    }
    nodes = root.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < nodes.length; i++) {
      var h = nodes[i];
      h.innerHTML = W.t(h.getAttribute('data-i18n-html'), readParams(h));
    }
    nodes = root.querySelectorAll('[data-i18n-attr]');
    for (i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      var spec = a.getAttribute('data-i18n-attr'); /* "placeholder:key;aria-label:key2" */
      spec.split(';').forEach(function (pair) {
        var parts = pair.split(':');
        if (parts.length === 2 && parts[0] && parts[1]) {
          a.setAttribute(parts[0].trim(), W.t(parts[1].trim(), readParams(a)));
        }
      });
    }
    /* language switcher label */
    var lab = root.querySelectorAll('[data-i18n-current-locale]');
    for (i = 0; i < lab.length; i++) lab[i].textContent = I.meta(I.current).native;
  };

  function readParams(el) {
    var raw = el.getAttribute('data-i18n-params');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /* ---- public API ---- */
  I.set = function (code, opts) {
    if (!I.meta(code)) code = I.defaultLocale;
    var finish = function () {
      I.current = code;
      var store = ls();
      if (store) { try { store.setItem(LS_KEY, code); } catch (e) { /* private mode */ } }
      I.applyDocument();
      I.apply(document);
      listeners.forEach(function (f) { try { f(code); } catch (e) { console.error(e); } });
    };
    I.load(code, finish);
    if (opts && opts.reload !== false) {
      /* no reload needed; everything re-renders through listeners */
    }
  };

  I.onChange = function (fn) { listeners.push(fn); };

  /* ---- formatting helpers (money always latin digits for clarity) ---- */
  I.money = function (n) {
    if (n === null || n === undefined || isNaN(n)) return '';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  I.btc = function (n) {
    if (n === null || n === undefined || isNaN(n)) return '';
    var s = Number(n).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
    return (s === '' ? '0' : s) + ' BTC';
  };
  I.date = function (v) {
    if (!v) return '';
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    try {
      return new Intl.DateTimeFormat(I.current === 'en' ? 'en-US' : I.current, {
        year: 'numeric', month: 'short', day: 'numeric'
      }).format(d);
    } catch (e) { return d.toISOString().slice(0, 10); }
  };
  I.dateTimeUtc = function (v) {
    var d = (v instanceof Date) ? v : new Date(v || Date.now());
    if (isNaN(d.getTime())) return '';
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  };

  /* ---- boot: apply stored language before first paint of dynamic parts ---- */
  I.current = detect();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      I.load(I.current, function () { I.applyDocument(); I.apply(document); });
    });
  } else {
    I.load(I.current, function () { I.applyDocument(); I.apply(document); });
  }
  I.applyDocument();
})();
