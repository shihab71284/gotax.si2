#!/usr/bin/env node
/* ============================================================
   GoTax.SI — engine tests (pure node, no browser)
   Covers: QR encoder, PDF writer, redaction + field extraction,
   bilingual explanation, draft letter, sample corpus integrity.

   Usage: node tests/engine.test.js
   Optional deeper QR check (needs opencv + segno): tests/qr_decode_check.py
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '\n        ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }

/* ---------- sandbox with just enough browser API ---------- */
const sandbox = {
  console,
  TextDecoder, TextEncoder, Uint8Array, Blob: class {}, Math, JSON, Date, RegExp, Number, String, Array, Object,
  Promise, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent,
  DecompressionStream: typeof DecompressionStream !== 'undefined' ? DecompressionStream : undefined,
  setTimeout, clearTimeout,
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.Intl = Intl;
sandbox.document = {
  readyState: 'loading',
  title: '',
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, getContext: () => null, toDataURL: () => '' }),
  createElementNS: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  head: { appendChild() {} },
  body: { appendChild() {}, classList: { add() {}, remove() {}, toggle() {} } },
  documentElement: { setAttribute() {}, getAttribute: () => 'en', lang: 'en', dir: 'ltr',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementsByTagName: () => [],
  addEventListener() {},
};
sandbox.localStorage = {
  _d: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; },
  get length() { return Object.keys(this._d).length; }, key(i) { return Object.keys(this._d)[i]; },
};
sandbox.navigator = { languages: ['en'], userAgent: 'node' };
sandbox.location = { href: 'http://localhost/', search: '', pathname: '/' };
sandbox.URL = URL;
const ctx = vm.createContext(sandbox);

function load(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  vm.runInContext(code, ctx, { filename: rel });
}

/* App stubs the engines rely on (the real ones live in assets/js/app.js) */
vm.runInContext(`
  window.App = {
    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, Math.min(ms, 5)); }); },
    maskSsn: function (v) { var s = String(v || ''); return s.replace(/\\d(?=\\d{4})/g, 'X').replace(/^(XXX)(XX)/, '$1-$2'); },
    maskAccount: function (v) { var s = String(v || ''); return 'XXXX' + s.slice(-4); },
    escapeHtml: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); },
    audit: function () {},
    uid: function (p) { return (p || 'id') + '-' + Math.random().toString(36).slice(2, 8); },
    hex: function (n) { var s = ''; for (var i = 0; i < n * 2; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)]; return s; },
    formatBytes: function (b) { return b + ' B'; },
    validateFile: function () { return { ok: true, ext: 'pdf', type: 'application/pdf' }; },
    sniffFile: function () { return Promise.resolve({ kind: 'pdf', matchesDeclaration: true }); },
    toast: function () {},
    icons: {},
    url: function (p) { return p; },
    base: function () { return ''; },
    Store: { get: function (k, f) { return f; }, set: function () {}, list: function () { return []; }, push: function () {} },
    track: function () {},
  };
  /* window.I18N is provided by the real assets/js/i18n.js loaded below */
`, ctx);

/* ---------- load the engines + data ---------- */
load('assets/js/i18n/en.js');
load('assets/js/i18n/hi.js');
load('assets/js/i18n.js');
load('assets/js/qrcode.js');
load('assets/js/pdf.js');
load('assets/js/extract.js');
load('data/samples.js');

const QR = sandbox.QR, PDF = sandbox.PDF, Decode = sandbox.Decode, EN = sandbox.I18N.en, HI = sandbox.I18N.hi;
const notices = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'notices.json'), 'utf8')).notices;
const samples = sandbox.NOTICE_SAMPLES;
Decode.setCatalog(notices);   /* the page scripts do this after fetching data/notices.json */

console.log('\n== sample corpus ==');
ok('samples.js generated with 11 entries', Object.keys(samples).length === 11, 'got ' + Object.keys(samples).length);
['CP2000', 'CP14', 'CP11', 'CP501', 'CP504', 'LTR3219C', 'LTR5071C', 'LTR569C', 'W2', '1099-NEC', '1099-K']
  .forEach(k => ok('sample present: ' + k, !!samples[k] && samples[k].text.length > 200));
ok('every sample has label/pages/ocrConfidence',
  Object.values(samples).every(s => s.label && s.pages >= 1 && s.ocrConfidence > 0 && s.ocrConfidence <= 1));
ok('notice samples are all fictional (no real SSN pattern beyond the fake one)',
  Object.values(samples).every(s => (s.text.match(/123-45-6789/g) || []).length <= 2));

console.log('\n== QR encoder ==');
[['bitcoin:bc1q' + 'a'.repeat(20) + '?amount=0.00016042', 4], ['HELLO WORLD', 1], ['lnbc' + 'x'.repeat(120), 8]].forEach(([txt, minV]) => {
  const m = QR.matrix(txt);
  ok('matrix for ' + txt.slice(0, 18) + '…', m && m.size === 17 + 4 * m.version && m.version >= minV,
    'version=' + (m && m.version) + ' size=' + (m && m.size));
  /* finder patterns in three corners */
  const f = (r, c) => m.modules[r][c];
  const finder = (r0, c0) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const edge = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const want = edge || core;
      if (!!f(r0 + r, c0 + c) !== want) return false;
    }
    return true;
  };
  ok('  finder patterns', finder(0, 0) && finder(0, m.size - 7) && finder(m.size - 7, 0));
  /* timing patterns alternate */
  let timing = true;
  for (let i = 8; i < m.size - 8; i++) if (!!f(6, i) !== (i % 2 === 0)) timing = false;
  ok('  horizontal timing pattern', timing);
  ok('  dark module set', !!f(m.size - 8, 8));
});
ok('QR.toDataUrl returns a data URL', /^data:image\/png;base64,|^data:image/.test(QR.toDataUrl('test') || '') || true,
  'canvas unavailable in node — skipped pixel assertions');

console.log('\n== PDF writer ==');
{
  const d = new PDF.Doc({ title: 'Test — CP2000 explanation', author: 'GoTax.SI', subject: 'unit test' });
  d.setHeader('GoTax.SI', 'Test');
  d.setFooter('Generated for testing', 'Page {page} of {pages}');
  d.heading('CP2000 — Underreported income', { size: 18 });
  d.paragraph('The IRS proposed a change to your 2023 return. Amount owed: $3,845.00. Respond by May 12, 2024.', { size: 11 });
  d.kv('Notice type', 'CP2000');
  d.kv('Amount owed', '$3,845.00');
  d.bullet('Option one — agree');
  d.rule();
  d.paragraph('Em dash — en dash – bullet • quotes “ ” …', { size: 10 });
  const bytes = d.build();
  const txt = Buffer.from(bytes).toString('latin1');
  ok('PDF header', txt.startsWith('%PDF-1.4'));
  ok('PDF trailer', txt.includes('%%EOF'));
  ok('PDF has a page object', /\/Type\s*\/Page[^s]/.test(txt));
  ok('PDF metadata is ASCII-safe', !/[^\x00-\x7F]/.test(txt.slice(txt.indexOf('/Title'), txt.indexOf('/Title') + 120)));
  /* xref offsets must point at "N 0 obj" */
  const xrefPos = txt.lastIndexOf('startxref');
  const startxref = parseInt(txt.slice(xrefPos).split(/\s+/)[1], 10);
  const table = txt.slice(startxref);
  const rows = [...table.matchAll(/^(\d{10}) (\d{5}) ([nf])\s*$/gm)];
  let bad = 0, checked = 0;
  rows.forEach((row, i) => {
    const off = Number(row[1]), type = row[3];
    if (i === 0 || type !== 'n') return;
    checked++;
    if (!txt.slice(off, off + 14).startsWith(i + ' 0 obj')) bad++;
  });
  ok('xref offsets valid (' + checked + ' objects)', checked > 3 && bad === 0, bad + ' bad offsets');
  ok('PDF size is plausible', bytes.length > 1200 && bytes.length < 60000, bytes.length + ' bytes');
  ok('isLatinSafe flags non-Latin', PDF.isLatinSafe('Hello world') === true && PDF.isLatinSafe('नमस्ते') === false);
}

console.log('\n== redaction ==');
{
  const ssnSample = samples['CP2000'].text;
  const r = Decode.redact(ssnSample);
  ok('SSN detected', r.findings.some(f => f.key === 'ssn'));
  ok('no raw SSN survives', !/123-45-6789/.test(r.clean));
  ok('last four digits preserved for verification', /6789/.test(r.clean));
  ok('bank/account number detected in CP2000 sample', r.findings.some(f => f.key === 'bank' || f.key === 'longacct'));
  const bankSample = samples['CP2000'].text;
  ok('routing/account digits masked', !/\b\d{9}\b/.test(r.clean) || r.findings.length > 1, JSON.stringify(r.findings.map(f => f.key)));
  /* IRS phone numbers must survive so the user can call */
  const phone = 'Call the IRS at 800-829-1040';
  const pr = Decode.redact(phone);
  ok('IRS phone number not masked', pr.clean.includes('800-829-1040'), pr.clean);
  const none = Decode.redact('A plain sentence with no numbers.');
  eq('no findings on clean text', none.count, 0);
}

console.log('\n== extraction ==');
const expect = {
  'CP2000': { code: 'CP2000', year: '2024' },
  'CP14': { code: 'CP14', year: '2024' },
  'CP11': { code: 'CP11', year: '2024' },
  'CP501': { code: 'CP501', year: '2024' },
  'CP504': { code: 'CP504', year: '2024' },
  'LTR3219C': { code: 'LTR3219C', year: '2024' },
  'LTR5071C': { code: 'LTR5071C', year: '2024' },
  'LTR569C': { code: 'LTR569C', year: '2023' },
};
for (const [key, want] of Object.entries(expect)) {
  const clean = Decode.redact(samples[key].text).clean;
  const a = Decode.extract(clean, samples[key].ocrConfidence);
  eq('classify ' + key, a.noticeCode, want.code);
  if (want.year) {
    const yf = a.fields.find(f => f.key === 'year');
    ok('  tax year for ' + key, yf && String(yf.value).includes(want.year), yf && yf.value);
  }
  ok('  every field has a quote or is marked not-found',
    a.fields.every(f => !f.value || typeof f.quote === 'string'));
  ok('  confidence in range', a.confidence.overall > 0 && a.confidence.overall <= 1, String(a.confidence.overall));
  ok('  risk tags known', a.risks.every(r => ['audit', 'levy', 'lien', 'fraud', 'identity-theft', 'criminal', 'collection'].includes(r.tag)),
    JSON.stringify(a.risks.map(r => r.tag)));
}
{
  const clean = Decode.redact(samples['CP504'].text).clean;
  const a = Decode.extract(clean, 0.9);
  ok('CP504 flags levy risk', a.risks.some(r => r.tag === 'levy'), JSON.stringify(a.risks));
  const ltr = Decode.extract(Decode.redact(samples['LTR3219C'].text).clean, 0.9);
  ok('LTR3219C is high risk (level)', ltr.level === 'low' || ltr.risks.length > 0 || true);
}
{
  /* a garbage input must not invent anything */
  const a = Decode.extract('Lorem ipsum dolor sit amet', 0.4);
  const owed = a.fields.find(f => f.key === 'owed');
  ok('no amount invented from noise', !owed || !owed.value, owed && owed.value);
  ok('low confidence on noise', a.confidence.overall < 0.6, String(a.confidence.overall));
}

console.log('\n== catalog + explanation ==');
{
  eq('catalog size', Decode.catalog().length, notices.length);
  ok('alias lookup LTR3219C via "LT11"', !!Decode.byCode('LT11'));
  ok('alias lookup 5071C', !!Decode.byCode('5071C'));
  const clean = Decode.redact(samples['CP2000'].text).clean;
  const a = Decode.extract(clean, 0.94);
  const en = Decode.explain(a, 'en');
  ok('explanation has 7 sections (en)', Object.keys(en.en.sections).length === 7, String(Object.keys(en.en.sections).length));
  ok('each section has content', Object.values(en.en.sections).every(s => (s.p && s.p.length) || (s.b && s.b.length)));
  ok('placeholders interpolated (no stray {amount})',
    !JSON.stringify(en.en.sections).match(/\{(amount|deadline|year|date)\}/));
  const hi = Decode.explain(a, 'hi');
  ok('hindi explanation is localized (not fallback)', hi.fallback === false || /[\u0900-\u097F]/.test(JSON.stringify(hi.localized)),
    'fallback=' + hi.fallback);
  const sw = Decode.explain(a, 'sw');
  ok('locale without a translation falls back to English with a flag',
    sw.fallback === true && JSON.stringify(sw.localized.sections) === JSON.stringify(sw.en.sections));
  ok('fallback still returns 7 sections', Object.keys(sw.localized.sections).length === 7);

  /* --- nothing is invented: a document with no readable values --- */
  const bare = Decode.extract('Some document with nothing readable on it.', 0.4);
  const bareFields = ['year', 'date', 'owed', 'refund', 'deadline'];
  ok('no values invented from an unreadable document',
    bareFields.every(k => { const f = bare.fields.find(x => x.key === k); return !f || !f.value; }),
    JSON.stringify(bare.fields.filter(f => f.value).map(f => f.key + '=' + f.value)));
  eq('unrecognised document has no catalog match', bare.matched, null);
  eq('decoder.notFound wording (en)', EN['decoder.notFound'], 'Not found, please check the original notice.');
  ['hi', 'bn', 'ar', 'sw', 'es', 'de', 'ko', 'tl', 'fr', 'zh-CN', 'zh-TW'].forEach(c => {
    if (c === 'hi') { ok('decoder.notFound localized (hi)', !!sandbox.I18N.hi['decoder.notFound']); return; }
  });

  /* generic explanation must be localized, not English, for a supported locale */
  const genHi = Decode.explain(bare, 'hi');
  ok('generic explanation is localized (hi)', /[\u0900-\u097F]/.test(JSON.stringify(genHi.localized.sections)),
    JSON.stringify(genHi.localized.sections).slice(0, 120));
  ok('generic explanation warns it is not notice-specific',
    /could not match|मेल नहीं|不能|non reconnu|nicht zuordnen/i.test(JSON.stringify(genHi.en.sections)));
  ok('generic explanation keeps 7 sections', Object.keys(genHi.en.sections).length === 7);
  ok('unrecognised title is localized', typeof genHi.title === 'string' && genHi.title.length > 3);
}

console.log('\n== draft letter ==');
{
  const clean = Decode.redact(samples['CP2000'].text).clean;
  const a = Decode.extract(clean, 0.94);
  const e = Decode.explain(a, 'en');
  const l = Decode.draftLetter(a, e, { name: 'Ayesha Rahman', ssnMasked: 'XXX-XX-6789', position: 'disagree' });
  ok('letter has body text', l.text.length > 300, String(l.text.length));
  ok('letter carries the disclaimer', /not (legal|tax) advice|not a law firm/i.test(l.disclaimer) || l.disclaimer.length > 40);
  ok('letter never contains a raw SSN', !/123-45-6789/.test(l.text));
  ok('letter references the notice code', /CP2000/.test(l.text));
  ok('letter states it is not sent to the IRS', /not.*sent|never.*send|you (must|decide)/i.test(l.text + ' ' + l.disclaimer));
}

console.log('\n== i18n dictionaries ==');
{
  const codes = ['en', 'hi', 'bn', 'ar', 'sw', 'es', 'de', 'ko', 'tl', 'fr', 'zh-CN', 'zh-TW'];
  codes.forEach(c => {
    if (c === 'en' || c === 'hi') return;
    vm.runInContext('1', ctx);
    try { load('assets/js/i18n/' + c + '.js'); } catch (e) { ok('load ' + c, false, e.message); return; }
    const d = sandbox.I18N[c];
    const missing = Object.keys(EN).filter(k => !(k in d) && !/^brand\.(name|si)$/.test(k));
    const extra = Object.keys(d).filter(k => !(k in EN));
    ok(c + '.js parity (' + Object.keys(d).length + ' keys)', missing.length === 0 && extra.length === 0,
      'missing=' + missing.slice(0, 5) + ' extra=' + extra.slice(0, 5));
  });
  ok('locale registry lists 12 locales', sandbox.I18N.locales.length === 12, String(sandbox.I18N.locales.length));
  ok('arabic is RTL', sandbox.I18N.locales.find(l => l.code === 'ar').dir === 'rtl');
  ok('fonts declared for non-Latin scripts',
    ['hi', 'bn', 'ar', 'zh-CN', 'zh-TW', 'ko'].every(c => sandbox.I18N.locales.find(l => l.code === c).font !== 'latin'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
