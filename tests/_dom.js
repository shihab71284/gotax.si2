/* Shared jsdom harness for GoTax.SI tests.
   Not a test itself — required by tests/smoke.js and tests/flows.test.js.
   Needs: npm install jsdom   (dev dependency) */
'use strict';
const path = require('path');

function loadJsdom() {
  const candidates = ['jsdom', path.join(__dirname, '..', 'node_modules', 'jsdom'), '/tmp/jd/node_modules/jsdom'];
  for (const c of candidates) {
    try { const m = require(c); if (m && m.JSDOM) return m; } catch (e) { /* next */ }
  }
  throw new Error('jsdom not found. Run: npm install jsdom');
}
const { JSDOM, VirtualConsole } = loadJsdom();
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Poll until fn() returns truthy (or throws nothing) — used for async UI work. */
async function waitFor(dom, fn, timeout = 8000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    let v = null;
    try { v = fn(dom.window, dom.window.document); } catch (e) { v = null; }
    if (v) return v;
    await sleep(120);
  }
  throw new Error('timeout waiting for ' + label);
}

/** Patch the browser APIs jsdom lacks so the real page scripts can run. */
function polyfill(dom, url) {
  const w = dom.window;
  w.fetch = (u, o) => fetch(new URL(u, url).href, o);
  if (!w.URL.createObjectURL) w.URL.createObjectURL = () => 'blob:mock';
  if (!w.URL.revokeObjectURL) w.URL.revokeObjectURL = () => {};
  w.matchMedia = w.matchMedia || (q => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  w.scrollTo = () => {};
  w.scroll = () => {};
  /* jsdom implements neither; real browsers do */
  w.Element.prototype.scrollIntoView = function () {};
  w.Element.prototype.scrollIntoViewIfNeeded = function () {};
  w.HTMLElement.prototype.focus = w.HTMLElement.prototype.focus || function () {};
  w.print = () => { w.__printed = (w.__printed || 0) + 1; };
  w.alert = () => {};
  if (!w.navigator.clipboard) {
    Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
  }
  /* jsdom ships no 2D canvas backend; the QR renderer must not throw */
  const origGetContext = w.HTMLCanvasElement.prototype.getContext;
  w.HTMLCanvasElement.prototype.getContext = function (type) {
    if (type !== '2d') return origGetContext.apply(this, arguments);
    const noop = () => {};
    return {
      canvas: this, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '', globalAlpha: 1,
      fillRect: noop, clearRect: noop, strokeRect: noop, beginPath: noop, closePath: noop, moveTo: noop,
      lineTo: noop, stroke: noop, fill: noop, arc: noop, rect: noop, save: noop, restore: noop,
      translate: noop, scale: noop, rotate: noop, setTransform: noop, fillText: noop, strokeText: noop,
      drawImage: noop, measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop: noop }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: noop,
    };
  };
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgo=';
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb && cb(new w.Blob(['x'], { type: 'image/png' })); };
  /* downloads: jsdom has no anchor navigation */
  const origClick = w.HTMLAnchorElement.prototype.click;
  w.HTMLAnchorElement.prototype.click = function () {
    if (this.download || /^blob:|^data:/.test(this.href || '')) { w.__downloaded = (w.__downloaded || []).concat([this.download || this.href.slice(0, 30)]); return; }
    return origClick.apply(this, arguments);
  };
}

/** Open a page from the static server, run its scripts, capture errors. */
async function openPage(url, { wait = 2200 } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.stack || e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  const dom = await JSDOM.fromURL(url, {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  });
  const w = dom.window;
  w.addEventListener('error', e => errors.push('window.error: ' + ((e.error && e.error.stack) || e.message)));
  w.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + ((e.reason && e.reason.stack) || e.reason)));
  polyfill(dom, url);
  await sleep(wait);
  dom.__errors = errors;
  dom.errors = () => errors.filter(e => !/Could not load|\.css|font|Not implemented: navigation|canvas|Blob\.text/i.test(e));
  dom.close_ = () => { try { w.close(); } catch (e) { /* already closed */ } };
  return dom;
}

/** Click a node (by selector or element) and let the handlers run. */
async function click(dom, selOrEl, wait = 300) {
  const el = typeof selOrEl === 'string' ? dom.window.document.querySelector(selOrEl) : selOrEl;
  if (!el) throw new Error('click target not found: ' + selOrEl);
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, view: dom.window }));
  await sleep(wait);
  return el;
}

function setChecked(dom, sel, checked = true) {
  const el = dom.window.document.querySelector(sel);
  if (!el) throw new Error('checkbox not found: ' + sel);
  el.checked = checked;
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  return el;
}

function setValue(dom, sel, value) {
  const el = dom.window.document.querySelector(sel);
  if (!el) throw new Error('input not found: ' + sel);
  el.value = value;
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  return el;
}

function submitForm(dom, sel) {
  const el = dom.window.document.querySelector(sel);
  if (!el) throw new Error('form not found: ' + sel);
  el.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  return el;
}

/** Read a localStorage JSON value written by the page. */
function stored(dom, key) {
  const raw = dom.window.localStorage.getItem('gotax.' + key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return raw; }
}

const isVisible = el => !!el && !el.hidden && el.getAttribute('aria-hidden') !== 'true';

module.exports = { openPage, waitFor, click, setChecked, setValue, submitForm, stored, isVisible, sleep };
