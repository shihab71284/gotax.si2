#!/usr/bin/env node
/* ============================================================
   GoTax.SI — jsdom smoke test
   Loads each built page from a local static server, executes the
   real scripts, and fails on uncaught errors / console errors.

   Requires:  npm install jsdom        (dev dependency, tests only)
              python3 -m http.server 8000 --directory .
   Usage:     node tests/smoke.js [base-url]
   ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');

function loadJsdom() {
  const candidates = ['jsdom', path.join(__dirname, '..', 'node_modules', 'jsdom'), '/tmp/jd/node_modules/jsdom'];
  for (const c of candidates) {
    try { const m = require(c); if (m && m.JSDOM) return m; } catch (e) { /* next */ }
  }
  console.error('jsdom not found. Run: npm install jsdom');
  process.exit(2);
}
const { JSDOM, VirtualConsole } = loadJsdom();

const BASE = process.argv[2] || 'http://127.0.0.1:8000';
const PAGES = [
  ['index.html', []],
  ['decoder.html', ['sample-list']],
  ['returns.html', ['intake-steps']],
  ['pricing.html', ['pricing-groups']],
  ['checkout.html?service=notice-explain', ['order-summary']],
  ['contact.html', ['contact-form']],
  ['account.html', ['auth-gate']],
  ['admin.html', ['admin-gate']],
  ['receipts.html', ['receipt-empty']],
  ['notices/index.html', ['notice-all']],
  ['notices/cp2000.html', ['pane-en-body']],
  ['legal/privacy.html', []],
  ['legal/terms.html', []],
  ['legal/disclaimer.html', []],
  ['legal/refunds.html', []],
  ['legal/retention.html', []],
  ['legal/index.html', []],
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;

async function runPage(rel, expectIds) {
  const url = BASE + '/' + rel;
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  vc.on('warn', (...a) => { /* warnings are fine (font fallbacks etc.) */ });

  let dom;
  try {
    dom = await JSDOM.fromURL(url, {
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      virtualConsole: vc,
    });
  } catch (e) {
    console.log('  FAIL  ' + rel + ' — could not load: ' + e.message);
    failures++;
    return;
  }
  const w = dom.window;
  w.addEventListener('error', e => errors.push('window.error: ' + (e.error && e.error.stack || e.message)));
  w.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + (e.reason && e.reason.stack || e.reason)));

  /* node fetch for the page's data loads + missing browser APIs */
  w.fetch = (u, o) => fetch(new URL(u, url).href, o);
  if (!w.URL.createObjectURL) w.URL.createObjectURL = () => 'blob:mock';
  if (!w.URL.revokeObjectURL) w.URL.revokeObjectURL = () => {};
  w.matchMedia = w.matchMedia || (q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  w.scrollTo = () => {};
  w.print = () => {};
  if (w.document.querySelector('canvas') && !w.HTMLCanvasElement.prototype.getContext.__patched) {
    /* jsdom has no canvas backend; QR drawing must not throw */
    const orig = w.HTMLCanvasElement.prototype.getContext;
    w.HTMLCanvasElement.prototype.getContext = function (type) {
      try { const c = orig.apply(this, arguments); if (c) return c; } catch (e) { /* fall through */ }
      return {
        canvas: this, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '',
        fillRect() {}, clearRect() {}, strokeRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
        stroke() {}, fill() {}, arc() {}, save() {}, restore() {}, translate() {}, scale() {}, setTransform() {},
        measureText: () => ({ width: 10 }), fillText() {}, strokeText() {}, drawImage() {}, createLinearGradient: () => ({ addColorStop() {} }),
        getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData() {},
      };
    };
    w.HTMLCanvasElement.prototype.getContext.__patched = true;
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
  }

  await sleep(2500);

  const doc = w.document;
  const problems = [];
  for (const id of expectIds) if (!doc.getElementById(id)) problems.push('missing #' + id);

  /* every page must have hydrated chrome + a language switcher */
  if (!doc.querySelector('.lang-list')) problems.push('language switcher did not build');
  if (!doc.querySelector('[data-year]') || !/\d{4}/.test(doc.querySelector('[data-year]').textContent)) problems.push('year not set');
  if (!doc.querySelector('footer .disclaimer-bar, .disclaimer-bar')) problems.push('disclaimer bar missing');
  const html = doc.documentElement;
  if (html.getAttribute('lang') !== 'en') problems.push('html lang=' + html.getAttribute('lang'));

  /* no unresolved i18n keys leaking into the DOM */
  const leaked = [...doc.querySelectorAll('[data-i18n]')]
    .map(el => el.textContent.trim())
    .filter(t => /^[a-z0-9]+\.[A-Za-z0-9_.]+$/.test(t));
  if (leaked.length) problems.push('untranslated keys visible: ' + leaked.slice(0, 5).join(', '));

  const badErrors = errors.filter(e => !/Could not load|css|font|Error: Not implemented: navigation|canvas/i.test(e));
  if (badErrors.length) problems.push('runtime errors:\n      ' + badErrors.slice(0, 4).join('\n      '));

  if (problems.length) {
    console.log('  FAIL  ' + rel);
    problems.forEach(p => console.log('        - ' + p));
    failures++;
  } else {
    console.log('  ok    ' + rel);
  }
  w.close();
}

(async () => {
  console.log('smoke test against ' + BASE);
  for (const [rel, ids] of PAGES) await runPage(rel, ids);
  console.log(failures ? '\n' + failures + ' page(s) failed' : '\nall pages passed');
  process.exit(failures ? 1 : 0);
})();
