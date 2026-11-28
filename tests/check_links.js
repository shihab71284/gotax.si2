#!/usr/bin/env node
/* ============================================================
   GoTax.SI — static integrity checks (no server needed)

   * every internal href/src resolves to a real file
   * every #anchor resolves to an id in the target document
   * hreflang clusters are complete + x-default present + canonical matches
   * sitemap.xml lists real files and no private pages
   * no unrendered {{TOKEN}} or empty placeholders left in the output

   Usage: node tests/check_links.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const problems = [];
function ok(name, cond, extra) {
  if (cond) pass++;
  else { fail++; problems.push('  FAIL  ' + name + (extra ? '\n        ' + extra : '')); }
}

/* ---------- collect the built pages ---------- */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['build', 'node_modules', '.git', 'assets', 'samples', 'tests', 'tools', 'backend'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}
const pages = walk(ROOT).sort();
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const rels = pages.map(rel);
ok('found the expected number of built pages', pages.length === 30, pages.length + ' → ' + rels.join(', '));

const src = new Map();
pages.forEach(p => src.set(rel(p), fs.readFileSync(p, 'utf8')));

/* ---------- 1. no unrendered tokens ---------- */
{
  const leftover = [];
  src.forEach((html, file) => {
    const m = html.match(/\{\{[A-Z_]+\}\}|<!--\s*@(head|header|footer|legalnav)\s*-->/g);
    if (m) leftover.push(file + ': ' + [...new Set(m)].join(', '));
  });
  ok('no unrendered build tokens', leftover.length === 0, leftover.join('\n        '));
}

/* ---------- 2. internal links resolve ---------- */
const idCache = new Map();
function idsOf(file) {
  if (idCache.has(file)) return idCache.get(file);
  const set = new Set();
  const html = src.get(file) || '';
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) set.add(m[1]);
  /* ids the page controllers inject at runtime (groups, tabs, panels) */
  for (const m of html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)) {
    const jsPath = path.join(ROOT, resolve(file, m[1]).file);
    if (!fs.existsSync(jsPath)) continue;
    const js = fs.readFileSync(jsPath, 'utf8');
    for (const q of js.matchAll(/id="([a-z][a-z0-9-]*)"/g)) set.add(q[1]);
  }
  /* section ids produced from data keys (e.g. pricing groups from services.json) */
  try {
    const svc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'services.json'), 'utf8'));
    (svc.groups || []).forEach(g => set.add(g.id));
  } catch (e) { /* ignore */ }
  idCache.set(file, set);
  return set;
}
function resolve(from, href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return { file: from, hash: href.split('#')[1] || null };
  const target = path.normalize(path.join(path.dirname(from), clean)).split(path.sep).join('/');
  return { file: target, hash: href.split('#')[1] || null };
}

{
  const broken = [];
  const anchors = [];
  src.forEach((html, file) => {
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|tel:|data:|blob:|javascript:)/.test(href)) continue;
      if (href.startsWith('//')) continue;
      const r = resolve(file, href);
      let target = r.file;
      if (!target.endsWith('.html') && !/\.(css|js|json|txt|xml|svg|png|jpg|ico|webmanifest)$/.test(target)) {
        target = target.replace(/\/$/, '') + '/index.html';
      }
      if (!fs.existsSync(path.join(ROOT, target))) { broken.push(file + ' → ' + href); continue; }
      if (r.hash && src.has(target) && !idsOf(target).has(r.hash)) anchors.push(file + ' → ' + href + ' (no #' + r.hash + ')');
    }
    /* same-page anchors */
    for (const m of html.matchAll(/href="#([^"]+)"/g)) {
      if (!idsOf(file).has(m[1])) anchors.push(file + ' → #' + m[1]);
    }
  });
  ok('every internal link points at a real file', broken.length === 0, broken.slice(0, 12).join('\n        '));
  ok('every #anchor points at a real id', anchors.length === 0, anchors.slice(0, 12).join('\n        '));
}

/* ---------- 3. per-page head hygiene ---------- */
{
  const noTitle = [], noDesc = [], noCanon = [], noViewport = [], badBase = [];
  src.forEach((html, file) => {
    if (!/<title>[^<]{5,}<\/title>/.test(html)) noTitle.push(file);
    if (!/name="description" content="[^"]{20,}"/.test(html)) noDesc.push(file);
    if (!/rel="canonical" href="https?:\/\/[^"]+"/.test(html)) noCanon.push(file);
    if (!/name="viewport"/.test(html)) noViewport.push(file);
    /* subdirectories must prefix relative asset URLs with ../ */
    const depth = file.split('/').length - 1;
    if (depth > 0) {
      const prefix = '../'.repeat(depth);
      if (html.includes('href="assets/') || html.includes('src="assets/')) badBase.push(file + ' (missing ' + prefix + ' BASE)');
      if (!html.includes(prefix + 'assets/')) badBase.push(file + ' (no ' + prefix + 'assets/ reference)');
    }
  });
  ok('every page has a <title>', noTitle.length === 0, noTitle.join(', '));
  ok('every page has a meta description', noDesc.length === 0, noDesc.join(', '));
  ok('every page has a canonical URL', noCanon.length === 0, noCanon.join(', '));
  ok('every page is mobile-first (viewport meta)', noViewport.length === 0, noViewport.join(', '));
  ok('subdirectory pages use the ../ BASE prefix', badBase.length === 0, badBase.join('\n        '));
}

/* ---------- 4. hreflang clusters ---------- */
{
  const LOCALES = ['en', 'hi', 'bn', 'ar', 'sw', 'es', 'de', 'ko', 'tl', 'fr', 'zh-CN', 'zh-TW'];
  const incomplete = [];
  const noDefault = [];
  const clusters = new Map();
  src.forEach((html, file) => {
    const alts = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)]
      .map(m => ({ lang: m[1], href: m[2] }));
    if (!alts.length) return;
    clusters.set(file, alts);
    const langs = alts.map(a => a.lang);
    const missing = LOCALES.filter(l => !langs.includes(l));
    if (missing.length) incomplete.push(file + ' missing ' + missing.join(','));
    if (!langs.includes('x-default')) noDefault.push(file);
    /* self-reference must be present */
    const canon = (html.match(/rel="canonical" href="([^"]+)"/) || [])[1] || '';
    if (!alts.some(a => a.href === canon)) incomplete.push(file + ' (canonical not in the hreflang cluster)');
  });
  ok('pages with hreflang cover all 12 locales', incomplete.length === 0, incomplete.slice(0, 8).join('\n        '));
  ok('every hreflang cluster has x-default', noDefault.length === 0, noDefault.slice(0, 8).join(', '));
  ok('hreflang clusters exist on the translatable pages', clusters.size >= 17, 'clusters=' + clusters.size);
  /* duplicate hreflang values inside one cluster */
  const dupes = [];
  clusters.forEach((alts, file) => {
    const seen = new Set();
    alts.forEach(a => { if (seen.has(a.lang)) dupes.push(file + ' ' + a.lang); seen.add(a.lang); });
  });
  ok('no duplicate hreflang entries', dupes.length === 0, dupes.join(', '));
}

/* ---------- 5. structured data ---------- */
{
  const bad = [];
  let count = 0;
  src.forEach((html, file) => {
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      count++;
      try { JSON.parse(m[1]); } catch (e) { bad.push(file + ': ' + e.message); }
    }
  });
  ok('JSON-LD blocks are valid JSON (' + count + ' found)', bad.length === 0, bad.slice(0, 6).join('\n        '));
  ok('JSON-LD is present on the main pages', count >= 12, 'count=' + count);
}

/* ---------- 6. sitemap ---------- */
{
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  ok('sitemap has entries', urls.length >= 17, 'urls=' + urls.length);
  const missing = urls.map(u => {
    const p = u.replace(/^https?:\/\/[^/]+\//, '').replace(/\/$/, '') || 'index.html';
    return fs.existsSync(path.join(ROOT, p)) ? null : u + ' → ' + p;
  }).filter(Boolean);
  ok('every sitemap URL is a real file', missing.length === 0, missing.join('\n        '));
  const privatePages = ['account.html', 'admin.html', 'checkout.html', 'receipts.html'];
  const leaked = urls.filter(u => privatePages.some(p => u.endsWith('/' + p)));
  ok('private pages are excluded from the sitemap', leaked.length === 0, leaked.join(', '));
  const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
  ok('robots.txt points at the sitemap', /Sitemap:/i.test(robots));
  ok('robots.txt blocks the private pages',
    privatePages.every(p => robots.includes(p.replace('.html', '')) || /Disallow: \/account|Disallow: \/admin/.test(robots)),
    robots.split('\n').filter(l => l.startsWith('Disallow')).join(' '));
  /* noindex on private pages */
  const notNoindex = privatePages.filter(p => src.has(p) && !/name="robots" content="[^"]*noindex/.test(src.get(p)));
  ok('private pages carry noindex', notNoindex.length === 0, notNoindex.join(', '));
}

/* ---------- 7. legal + disclaimer on every page ---------- */
{
  const noDisclaimer = [];
  const noFooterLegal = [];
  src.forEach((html, file) => {
    if (!/not a law firm|not affiliated with the IRS/i.test(html)) noDisclaimer.push(file);
    if (!/legal\/privacy\.html/.test(html) || !/legal\/terms\.html/.test(html)) noFooterLegal.push(file);
  });
  ok('every page states it is not a law firm / not the IRS', noDisclaimer.length === 0, noDisclaimer.join(', '));
  ok('every page links privacy + terms in the footer', noFooterLegal.length === 0, noFooterLegal.join(', '));
}

/* ---------- 8. scripts and stylesheets ---------- */
{
  const bad = [];
  src.forEach((html, file) => {
    for (const m of html.matchAll(/<script[^>]+src="([^"]+)"[^>]*>/g)) {
      if (/^https?:/.test(m[1])) continue;
      if (!m[0].includes('defer') && !m[0].includes('async')) bad.push(file + ' blocking script: ' + m[1]);
    }
  });
  ok('all page scripts are deferred (fast on slow connections)', bad.length === 0, bad.slice(0, 6).join('\n        '));

  const missingFiles = [];
  src.forEach((html, file) => {
    for (const m of html.matchAll(/(?:href|src)="((?:\.\.\/)*assets\/[^"]+)"/g)) {
      const target = resolve(file, m[1]).file;
      if (!fs.existsSync(path.join(ROOT, target))) missingFiles.push(file + ' → ' + m[1]);
    }
  });
  ok('every asset reference exists', missingFiles.length === 0, missingFiles.slice(0, 10).join('\n        '));
}

/* ---------- 9. page-size budget ---------- */
{
  const heavy = [];
  src.forEach((html, file) => {
    const kb = Buffer.byteLength(html) / 1024;
    if (kb > 90) heavy.push(file + ' = ' + kb.toFixed(0) + ' KB');
  });
  ok('no page exceeds the 90 KB HTML budget', heavy.length === 0, heavy.join(', '));
  const css = fs.statSync(path.join(ROOT, 'assets/css/styles.css')).size / 1024;
  ok('styles.css under 120 KB', css < 120, css.toFixed(0) + ' KB');
}

console.log(problems.join('\n'));
console.log(pass + ' passed, ' + fail + ' failed  (' + pages.length + ' pages checked)');
process.exit(fail ? 1 : 0);
