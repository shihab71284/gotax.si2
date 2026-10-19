#!/usr/bin/env node
/* GoTax.SI — i18n key audit
   Collects every translation key referenced by the built HTML pages and the
   page scripts, then reports keys missing from each dictionary.
   Usage: node tests/check_i18n_keys.js [--json] */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
global.window = {};
const I18N_DIR = path.join(ROOT, 'assets', 'js', 'i18n');

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['node_modules', 'build', 'samples', 'backend', 'tests'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.includes(path.extname(e.name))) out.push(p);
  }
  return out;
}

/* ---------- collect used keys ---------- */
const used = new Map();      // key -> Set(files)
const dynamic = new Set();   // literal prefixes built at runtime: t('a.b' + x)
function add(key, file, isDynamic) {
  if (!key || !/^[a-z0-9]+\.[A-Za-z0-9_.\-]+$/.test(key)) return;
  if (isDynamic) { dynamic.add(key); return; }
  if (!used.has(key)) used.set(key, new Set());
  used.get(key).add(path.relative(ROOT, file));
}

const htmlFiles = walk(ROOT, ['.html']);
const jsFiles = walk(path.join(ROOT, 'assets', 'js'), ['.js']).filter(f => !f.includes('/i18n/'));

for (const f of htmlFiles) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/data-i18n="([^"]+)"/g)) add(m[1].trim(), f);
  for (const m of s.matchAll(/data-i18n-html="([^"]+)"/g)) add(m[1].trim(), f);
  for (const m of s.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    m[1].split(';').forEach(pair => { const k = pair.split(':')[1]; if (k) add(k.trim(), f); });
  }
}
for (const f of jsFiles) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt\(\s*'([^']+)'(\s*\+)?/g)) add(m[1], f, !!m[2]);
  for (const m of s.matchAll(/W\.t\(\s*'([^']+)'(\s*\+)?/g)) add(m[1], f, !!m[2]);
  for (const m of s.matchAll(/'((?:cta|common|decoder|account|admin|returns|notices|checkout|pricing|legal|contact|receipt)\.[A-Za-z0-9_.]*)'\s*\+/g)) add(m[1], f, true);
  for (const m of s.matchAll(/(?:i18nKey|descKey|titleKey|subKey)\s*:\s*'([^']+)'/g)) add(m[1], f);
  /* data-i18n="..." emitted from JS strings */
  for (const m of s.matchAll(/data-i18n="'\s*\+\s*[A-Za-z0-9_.]+/g)) { /* dynamic, skipped */ }
}
/* keys referenced from data/services.json */
try {
  const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'services.json'), 'utf8'));
  const seen = [];
  JSON.stringify(services, (k, v) => { if (typeof v === 'string' && /^[a-z]+\.[A-Za-z0-9_.]+$/.test(v)) seen.push(v); return v; });
  seen.forEach(k => add(k, 'data/services.json'));
} catch (e) { /* ignore */ }

/* ---------- load dictionaries ---------- */
const dicts = {};
for (const f of fs.readdirSync(I18N_DIR).filter(x => x.endsWith('.js'))) {
  const code = f.replace('.js', '');
  global.window = {};
  try {
    require(path.join(I18N_DIR, f));
    dicts[code] = (global.window.I18N && global.window.I18N[code]) || {};
  } catch (e) {
    console.error('FAILED TO LOAD', f, e.message);
    process.exitCode = 1;
  }
}
delete require.cache[require.cache.length]; // no-op, keeps linters quiet

const en = dicts.en || {};
const locales = Object.keys(dicts).sort();
const usedKeys = [...used.keys()].sort();

/* ---------- report ---------- */
const missingInEn = usedKeys.filter(k => !(k in en));
if (dynamic.size) console.log('dynamic key prefixes (checked separately): ' + [...dynamic].sort().join(', ') + '\n');
const parity = {};
for (const code of locales) {
  if (code === 'en') continue;
  parity[code] = {
    count: Object.keys(dicts[code]).length,
    missingFromUsed: usedKeys.filter(k => !(k in dicts[code])),
    extra: Object.keys(dicts[code]).filter(k => !(k in en))
  };
}

console.log('locales: ' + locales.length + '  (' + locales.join(', ') + ')');
console.log('en keys: ' + Object.keys(en).length);
console.log('keys referenced by pages/scripts/data: ' + usedKeys.length);
console.log('');
if (missingInEn.length) {
  console.log('MISSING FROM en.js (' + missingInEn.length + '):');
  missingInEn.forEach(k => console.log('  ' + k + '   <- ' + [...used.get(k)].slice(0, 2).join(', ')));
} else {
  console.log('OK: every referenced key exists in en.js');
}
console.log('');
for (const code of locales) {
  if (code === 'en') continue;
  const p = parity[code];
  const flag = p.missingFromUsed.length ? 'MISSING ' + p.missingFromUsed.length : 'ok';
  console.log(code.padEnd(6) + ' keys=' + String(p.count).padEnd(5) + ' ' + flag + (p.extra.length ? '  extra=' + p.extra.length : ''));
}
if (process.argv.includes('--json')) {
  fs.writeFileSync(path.join(ROOT, 'tests', 'i18n-report.json'),
    JSON.stringify({ usedKeys, missingInEn, parity }, null, 2));
  console.log('\nwrote tests/i18n-report.json');
}
process.exitCode = missingInEn.length ? 1 : process.exitCode;
