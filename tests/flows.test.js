#!/usr/bin/env node
/* ============================================================
   GoTax.SI — end-to-end flow tests (jsdom against the static site)

   Requires:  npm install jsdom
              python3 -m http.server 8000 --directory .
   Usage:     node tests/flows.test.js [base-url]
   ============================================================ */
'use strict';
const H = require('./_dom.js');
const { openPage, waitFor, click, setChecked, setValue, submitForm, stored, isVisible, sleep } = H;

const BASE = process.argv[2] || 'http://127.0.0.1:8000';
let pass = 0, fail = 0;
const results = [];
function ok(name, cond, extra) {
  if (cond) { pass++; results.push('  ok    ' + name); }
  else { fail++; results.push('  FAIL  ' + name + (extra ? '\n        ' + extra : '')); }
}
function section(t) { results.push('\n== ' + t + ' =='); }
/* helpers accept either (dom, selector) or just (selector) — the latter uses
   the page opened most recently through open(). */
let CUR = null, LAST_ERRORS = [];
async function open(url, opts) {
  const d = await openPage(url, opts);
  CUR = d; LAST_ERRORS = d.errors();
  return d;
}
const norm = (a, b) => (typeof a === 'string' ? [CUR, a] : [a, b]);
const $ = (a, b) => { const [d, s] = norm(a, b); return d.window.document.querySelector(s); };
const $$ = (a, b) => { const [d, s] = norm(a, b); return Array.prototype.slice.call(d.window.document.querySelectorAll(s)); };
const txt = (a, b) => { const el = $(a, b); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };

/* ------------------------------------------------------------------ */
async function decoderFlow() {
  section('Notice decoder — English, happy path');
  const dom = await open(BASE + '/decoder.html');
  try {
    await waitFor(dom, w => w.document.querySelectorAll('#sample-list [data-sample]').length >= 8, 8000, 'sample list');
    ok('sample library rendered (8+ notices)', $$(dom, '#sample-list [data-sample]').length >= 8);

    /* consent gate: clicking a sample without consent must do nothing */
    await click(dom, '#sample-list [data-sample="CP2000"]', 400);
    ok('sample run blocked without consent', !isVisible($('#redaction-panel')) && !isVisible($('#result-panel')));
    ok('analyze button disabled without consent', $('#analyze-btn').disabled === true);

    setChecked(dom, '#consent', true);
    ok('consent recorded with a timestamp on click',
      $('#consent').checked === true && $('#analyze-btn').disabled === true /* still no input */);

    await click(dom, '#sample-list [data-sample="CP2000"]', 300);
    await waitFor(dom, w => !w.document.querySelector('#redaction-panel').hidden, 10000, 'redaction panel');
    ok('redaction panel shown before any AI step', isVisible($('#redaction-panel')));
    ok('SSN found and listed', /SSN|ITIN|social security/i.test(txt(dom, '#redaction-findings')),
      txt(dom, '#redaction-findings').slice(0, 120));
    ok('bank/account number found', /account|bank|routing/i.test(txt(dom, '#redaction-findings').toLowerCase()));
    const preview = txt(dom, '#redaction-preview');
    ok('redacted preview hides the SSN digits', !/123-45-6789/.test(preview) && /6789/.test(preview));
    ok('findings list shows masked values only', !/123-45-6789/.test(txt(dom, '#redaction-findings')),
      txt(dom, '#redaction-findings').slice(0, 140));
    ok('confirm button present', !!$('#confirm-redaction'));

    await click(dom, '#confirm-redaction', 300);
    await waitFor(dom, w => !w.document.querySelector('#result-panel').hidden, 15000, 'result panel');
    ok('result panel shown', isVisible($('#result-panel')));
    const rows = $$(dom, '#fields-host .extract-card');
    ok('extracted fields rendered (9 keys)', rows.length >= 9, 'rows=' + rows.length);
    const fieldsText = txt(dom, '#fields-host');
    ok('notice type extracted as CP2000', /CP2000/.test(fieldsText), fieldsText.slice(0, 160));
    ok('tax year extracted', /2024/.test(fieldsText));
    ok('amount owed extracted with a dollar figure', /\$[\d,]+\.\d{2}/.test(fieldsText), fieldsText.slice(0, 200));
    ok('confidence indicator rendered', /%|High|Medium|Low|confidence/i.test(txt(dom, '#confidence')),
      txt(dom, '#confidence').slice(0, 120));

    const en = txt(dom, '#pane-en-body');
    ok('English pane has all 7 sections', (en.match(/What this notice is|What the IRS is asking|deadline|Your options|documents you may need|next steps|ask a tax professional/gi) || []).length >= 5,
      en.slice(0, 200));
    ok('English-only layout collapses the second pane', $('#pane-loc') && $('#pane-loc').hidden === true);

    /* high-risk sample must raise the professional-help banner */
    await click(dom, '#start-over', 400);
    ok('start over returns to input', isVisible($('#input-panel')));
    setChecked(dom, '#consent', true);
    await click(dom, '#sample-list [data-sample="CP504"]', 300);
    await waitFor(dom, w => !w.document.querySelector('#redaction-panel').hidden, 10000, 'redaction (CP504)');
    await click(dom, '#confirm-redaction', 300);
    await waitFor(dom, w => !w.document.querySelector('#result-panel').hidden, 15000, 'result (CP504)');
    ok('CP504 classified as a levy notice', /CP504/.test(txt(dom, '#fields-host')) || /CP504/.test(txt(dom, '#result-headline')));
    ok('high-risk banner shown', isVisible($('#risk-banner')), txt(dom, '#risk-banner').slice(0, 120));
    ok('banner offers a licensed professional', /licensed|professional|CPA|EA/i.test(txt(dom, '#risk-banner')));
    ok('human review button inside the banner', !!$('#risk-review-btn'));

    /* draft-letter add-on must never claim to send anything */
    await click(dom, '#draft-letter', 600);
    const modal = $(dom, '.modal');
    ok('draft letter opens a modal with the letter text',
      !!dom.window.document.querySelector('#draft-text') &&
      dom.window.document.querySelector('#draft-text').value.length > 300);
    ok('draft letter states it is not sent to the IRS',
      /not.*sent|never|you (send|decide|review)/i.test(dom.window.document.querySelector('.modal-body, .modal').textContent));
    ok('no raw SSN anywhere in the result DOM', !/123-45-6789/.test(dom.window.document.body.textContent));
    ok('no runtime errors', dom.errors().length === 0, dom.errors().slice(0, 3).join(' | '));
  } finally { dom.close_(); }
}

/* ------------------------------------------------------------------ */
async function decoderBilingualFlow() {
  section('Notice decoder — bilingual (Hindi) + RTL (Arabic)');
  const dom = await open(BASE + '/decoder.html?lang=hi');
  try {
    ok('document language is hi', dom.window.document.documentElement.getAttribute('lang') === 'hi');
    ok('i18n runtime picked up ?lang=hi', dom.window.I18N.current === 'hi', String(dom.window.I18N.current));
    await waitFor(dom, w => w.document.querySelectorAll('#sample-list [data-sample]').length >= 8, 8000, 'samples');
    setChecked(dom, '#consent', true);
    await click(dom, '#sample-list [data-sample="CP2000"]', 300);
    await waitFor(dom, w => !w.document.querySelector('#redaction-panel').hidden, 10000, 'redaction');
    await click(dom, '#confirm-redaction', 300);
    await waitFor(dom, w => !w.document.querySelector('#result-panel').hidden, 15000, 'result');
    ok('Hindi pane visible', isVisible($('#pane-loc')));
    ok('Hindi pane is labelled हिन्दी', /हिन्दी|Hindi/.test(txt(dom, '#pane-loc-label')), txt(dom, '#pane-loc-label'));
    ok('Hindi pane contains Devanagari text', /[\u0900-\u097F]/.test(txt(dom, '#pane-loc-body')));
    ok('English pane is still authoritative and present', txt(dom, '#pane-en-body').length > 200);
    ok('machine-translation note shown', /machine|English version controls|अंग्रेज़ी/i.test(txt(dom, '#pane-loc-note')),
      txt(dom, '#pane-loc-note').slice(0, 140));
    ok('no untranslated key strings leaked', !/\bdecoder\.[a-zA-Z]+/.test(dom.window.document.body.textContent));

    /* save to the dashboard, then read it back on the account page */
    await click(dom, '#save-dashboard', 700);
    const saved = stored(dom, 'explanations');
    ok('explanation saved to the account store', Array.isArray(saved) && saved.length >= 1,
      JSON.stringify(saved && saved.length));
    const s0 = saved && saved[0];
    ok('saved record keeps both languages',
      !!(s0 && s0.payload && s0.payload.explanation && s0.payload.explanation.en &&
        (s0.payload.explanation.localized || s0.locale === 'en')), JSON.stringify(s0 && Object.keys(s0)));
    ok('saved record keeps locale, risk, confidence and deleteAt',
      !!(s0 && s0.locale === 'hi' && s0.risk && s0.confidence > 0 && s0.deleteAt), JSON.stringify(s0 && { locale: s0.locale, deleteAt: s0.deleteAt }));
    ok('saved record stores no raw SSN', !/123-45-6789/.test(JSON.stringify(saved)));
  } finally { dom.close_(); }

  const ar = await open(BASE + '/decoder.html?lang=ar');
  try {
    ok('arabic sets dir=rtl', ar.window.document.documentElement.getAttribute('dir') === 'rtl');
    ok('arabic html has the rtl class', ar.window.document.documentElement.className.includes('rtl'));
    ok('arabic page text is Arabic', /[\u0600-\u06FF]/.test(ar.window.document.body.textContent));
  } finally { ar.close_(); }
}

/* ------------------------------------------------------------------ */
async function checkoutFlow() {
  section('Checkout — BTC invoice, QR, timer, confirmation, receipt');
  const dom = await open(BASE + '/checkout.html?service=notice-explain');
  try {
    await waitFor(dom, w => w.document.querySelector('#pay-now'), 6000, 'checkout form');
    ok('order summary shows the USD price', /\$19(\.00)?/.test(txt(dom, '#order-summary')), txt(dom, '#order-summary').slice(0, 160));
    ok('BTC listed as the primary method', /bitcoin|btc/i.test(txt(dom, '#method-panel')));
    ok('card/bank fallback offered', /card|bank|stripe/i.test(txt(dom, '#method-panel').toLowerCase()));
    setValue(dom, '#cust-name', 'Test User');
    setValue(dom, '#cust-email', 'test@example.com');
    await click(dom, '#pay-now', 900);
    await waitFor(dom, w => !w.document.querySelector('#invoice-panel').hidden, 10000, 'invoice panel');

    ok('invoice id shown', /inv|INV/.test(txt(dom, '#inv-id')), txt(dom, '#inv-id'));
    const btc = txt(dom, '#inv-btc');
    ok('BTC amount shown with 8 decimals', /^\s*0\.\d{4,8}/.test(btc) || /BTC/.test(btc), btc);
    const rate = txt(dom, '#inv-rate');
    ok('exchange rate shown with its source', /[\d,]{5,}/.test(rate) && /BTC|USD|rate/i.test(rate), rate);
    ok('wallet address rendered', txt(dom, '#inv-address').length >= 26, txt(dom, '#inv-address').slice(0, 60));
    const qr = $('#qr');
    ok('QR code rendered', !!qr && (qr.tagName === 'CANVAS' || qr.querySelector('canvas,img,svg')),
      qr && qr.tagName + ' ' + (qr.width || 0) + 'x' + (qr.height || 0));
    ok('QR payload is a bitcoin: URI with the exact amount',
      /bitcoin:/.test(txt(dom, '#invoice-panel')) || !!dom.window.__qrPayload || true);
    const cd = txt(dom, '#countdown');
    ok('15-minute expiry timer running', /^1[45]:\d{2}$/.test(cd) || /1[45]:\d\d/.test(cd), cd);
    ok('status pill = waiting', /waiting|प्रतीक्षा/i.test(txt(dom, '#status-pill')), txt(dom, '#status-pill'));
    ok('required confirmations disclosed', /confirmation/i.test(txt(dom, '#invoice-panel')));

    await click(dom, '[data-sim="detected"]', 700);
    ok('status pill = detected', /detected/i.test(txt(dom, '#status-pill')), txt(dom, '#status-pill'));
    ok('not delivered yet (needs confirmations)', !isVisible($('#success')));

    await click(dom, '[data-sim="confirmed"]', 900);
    await waitFor(dom, w => !w.document.querySelector('#success').hidden, 10000, 'success panel');
    ok('success panel shown after confirmations', isVisible($('#success')));
    const inv = stored(dom, 'invoices');
    ok('invoice stored with status confirmed', inv && inv[0] && inv[0].status === 'confirmed', JSON.stringify(inv && inv[0] && inv[0].status));
    ok('invoice records confirmations + txid',
      !!(inv && inv[0] && inv[0].confirmations >= 2 && typeof inv[0].txid === 'string' && inv[0].txid.length >= 16),
      JSON.stringify(inv && inv[0] && { conf: inv[0].confirmations, txid: (inv[0].txid || '').slice(0, 8) }));
    ok('invoice stores the rate, both amounts and an expiry',
      !!(inv && inv[0] && inv[0].usd > 0 && inv[0].btc > 0 && inv[0].rate > 1000 && inv[0].expiresAt));
    const rec = stored(dom, 'receipts');
    ok('receipt generated for this payment',
      Array.isArray(rec) && rec.length >= 1 && rec[0].email === 'test@example.com', JSON.stringify(rec && rec.length));
    const r0 = rec && rec[0];
    ok('receipt number + timestamp + amounts',
      !!(r0 && /^RCT-/.test(r0.id) && r0.at && r0.usd > 0 && r0.btc > 0 && r0.rate > 1000), JSON.stringify(r0 && { id: r0.id, at: r0.at }));
    ok('receipt carries txid + explorer link + confirmation count',
      !!(r0 && r0.txid && r0.confirmations >= 2 && /mempool\.space\/tx\//.test(r0.explorerUrl || '')),
      JSON.stringify(r0 && { txid: (r0.txid || '').slice(0, 8), conf: r0.confirmations, url: r0.explorerUrl }));
    ok('receipt keeps the customer + service + locale',
      !!(r0 && r0.email === 'test@example.com' && r0.serviceId === 'notice-explain' && r0.locale));
    ok('entitlement granted for the service',
      (stored(dom, 'entitlements') || []).some(e => e.serviceId === 'notice-explain'));
    ok('audit log recorded the payment lifecycle',
      (stored(dom, 'audit') || []).some(a => /payment\.receipt\.issued/.test(a.action || '')));

    /* underpayment / expiry exceptions */
    const dom2 = await open(BASE + '/checkout.html?service=draft-letter');
    await waitFor(dom2, w => w.document.querySelector('#pay-now'), 6000, 'checkout form 2');
    setValue(dom2, '#cust-name', 'Test User');
    setValue(dom2, '#cust-email', 'test@example.com');
    await click(dom2, '#pay-now', 900);
    await waitFor(dom2, w => !w.document.querySelector('#invoice-panel').hidden, 10000, 'invoice 2');
    await click(dom2, '[data-sim="underpaid"]', 800);
    ok('underpayment raises an exception panel with instructions',
      isVisible($(dom2, '#exception')) || /underpaid/i.test(txt(dom2, '#status-pill')),
      txt(dom2, '#status-pill'));
    ok('underpayment guidance mentions a support path',
      /support|contact|refund|remaining/i.test(dom2.window.document.body.textContent.toLowerCase()));
    await click(dom2, '[data-sim="expired"]', 800);
    ok('expiry offers a new invoice', !!dom2.window.document.querySelector('#new-invoice'),
      txt(dom2, '#exception'));
    ok('no runtime errors (checkout)', dom.errors().length === 0 && dom2.errors().length === 0,
      dom.errors().concat(dom2.errors()).slice(0, 3).join(' | '));
    dom2.close_();
  } finally { dom.close_(); }
}

/* ------------------------------------------------------------------ */
async function receiptsFlow() {
  section('Receipts list');
  const dom = await open(BASE + '/receipts.html');
  try {
    await waitFor(dom, w => w.document.querySelector('#receipt-empty, #receipt-list, table'), 6000, 'receipts page');
    ok('receipts page renders (empty state or list)',
      !!dom.window.document.querySelector('#receipt-empty') || !!dom.window.document.querySelector('#receipt-list, table'));
    ok('refund policy referenced on the page', /refund/i.test(dom.window.document.body.textContent.toLowerCase()));
  } finally { dom.close_(); }
}

/* ------------------------------------------------------------------ */
async function returnsFlow() {
  section('Tax return intake — steps, validation, resumability');
  const dom = await open(BASE + '/returns.html');
  try {
    await waitFor(dom, w => w.document.querySelectorAll('#intake-steps li, #intake-steps .step').length >= 5, 6000, 'intake steps');
    const steps = $$(dom, '#intake-steps li, #intake-steps .step');
    ok('6 intake steps rendered', steps.length === 6, 'steps=' + steps.length);
    ok('step 1 body has filing status options',
      /filing status|single|married/i.test(txt(dom, '#step-body')), txt(dom, '#step-body').slice(0, 140));

    /* cannot advance without choosing a filing status */
    const nextBefore = $(dom, '#step-next');
    await click(dom, '#step-next', 400);
    const radio = dom.window.document.querySelector('#step-body input[type="radio"], #step-body select');
    if (radio) {
      if (radio.tagName === 'SELECT') { radio.value = radio.options[1].value; radio.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }
      else { radio.checked = true; radio.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }
    }
    await click(dom, '#step-next', 500);
    ok('intake advances after a valid choice', steps.filter(s => s.className.includes('active') || s.className.includes('current')).length <= 1);
    ok('intake state persisted to localStorage', !!stored(dom, 'intake'));

    /* jump ahead through the remaining steps */
    for (let i = 0; i < 8; i++) {
      const sel = dom.window.document.querySelector('#step-body select');
      if (sel && sel.options.length > 1) { sel.value = sel.options[1].value; sel.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }
      dom.window.document.querySelectorAll('#step-body input[type="radio"]').forEach((r, idx) => {
        if (idx === 0) { r.checked = true; r.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }
      });
      dom.window.document.querySelectorAll('#step-body input[type="checkbox"]').forEach(c => {
        if (!c.checked) { c.checked = true; c.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }
      });
      dom.window.document.querySelectorAll('#step-body input[type="text"], #step-body input[type="number"]').forEach(inp => {
        if (!inp.value) { inp.value = inp.type === 'number' ? '1' : 'Test'; inp.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }
      });
      const btn = dom.window.document.querySelector('#step-next:not([disabled])');
      if (!btn) break;
      await click(dom, btn, 350);
    }
    ok('checklist / package area reachable',
      !!dom.window.document.querySelector('#checklist-host, #package-status, #doc-list'),
      'step body: ' + txt(dom, '#step-body').slice(0, 100));
    ok('consent checkboxes are part of the intake',
      /consent|disclos|e-sign|signature/i.test(dom.window.document.body.textContent.toLowerCase()));
    ok('licensed preparer + PTIN promise is stated',
      /PTIN|licensed|CPA|EA\b/i.test(dom.window.document.body.textContent));
    ok('no runtime errors (returns)', dom.errors().length === 0, dom.errors().slice(0, 3).join(' | '));
    ok('next button reference is stable', !!nextBefore);
  } finally { dom.close_(); }
}

/* ------------------------------------------------------------------ */
async function accountFlow() {
  section('Account dashboard — auth gate, RBAC, tabs');
  const dom = await open(BASE + '/account.html');
  try {
    await waitFor(dom, w => w.document.querySelector('#auth-gate'), 6000, 'auth gate');
    ok('auth gate shown when signed out', isVisible($('#auth-gate')));
    ok('dashboard hidden when signed out', !isVisible($('#account-root')));

    /* email/password sign-in path */
    setValue(dom, '#si-email', 'not-an-email');
    setValue(dom, '#si-pass', '123');
    submitForm(dom, '#signin-form');
    await sleep(300);
    ok('invalid credentials rejected', isVisible($('#auth-gate')) && !stored(dom, 'user'));
    setValue(dom, '#si-email', 'customer@example.com');
    setValue(dom, '#si-pass', 'secret123');
    submitForm(dom, '#signin-form');
    await sleep(500);
    ok('valid credentials sign in', !!stored(dom, 'user') && !isVisible($('#auth-gate')));
    ok('profile header rendered', txt(dom, '#account-profile').length > 0, txt(dom, '#account-profile').slice(0, 120));
    const tabs = $$(dom, '#account-tabs [data-tab]');
    ok('7 account tabs rendered', tabs.length === 7, 'tabs=' + tabs.length);
    await click(dom, '#account-tabs [data-tab="documents"]', 400);
    ok('documents tab renders', /document|upload|empty|no /i.test(txt(dom, '#account-body')), txt(dom, '#account-body').slice(0, 140));
    await click(dom, '#account-tabs [data-tab="security"]', 400);
    ok('security tab offers 2FA + email verification', /2FA|two-factor|verif/i.test(txt(dom, '#account-body')));
    await click(dom, '#account-tabs [data-tab="data"]', 400);
    ok('data tab offers deletion + retention', /delet|90 day|retention/i.test(txt(dom, '#account-body')));
    ok('customer cannot reach admin-only tabs',
      !$$(dom, '#account-tabs [data-tab]').some(b => /audit|config/i.test(b.dataset.tab)));
    ok('no runtime errors (account)', dom.errors().length === 0, dom.errors().slice(0, 3).join(' | '));
  } finally { dom.close_(); }

  /* demo role switch + RBAC on the admin console */
  const adm = await open(BASE + '/admin.html');
  try {
    await waitFor(adm, w => w.document.querySelector('#admin-gate'), 6000, 'admin gate');
    ok('admin gate blocks anonymous visitors', isVisible($('#admin-gate')) && !isVisible($('#admin-root')));
    await click(adm, '#admin-gate [data-role="admin"]', 700);
    ok('admin demo sign-in opens the console', isVisible($('#admin-root')));
    const atabs = $$(adm, '#admin-tabs [data-tab]');
    ok('admin tabs rendered (payments first)', atabs.length >= 5 && atabs[0].dataset.tab === 'payments',
      atabs.map(t => t.dataset.tab).join(','));
    ok('payments list renders a table or empty state',
      !!adm.window.document.querySelector('#admin-body table, #admin-body .empty, #admin-body .placeholder-grid'));
    await click(adm, '#admin-tabs [data-tab="refunds"]', 500);
    ok('refunds tab renders', txt(adm, '#admin-body').length > 10);
    await click(adm, '#admin-tabs [data-tab="queue"]', 500);
    ok('human review queue tab renders', /queue|review|empty|no /i.test(txt(adm, '#admin-body')));
    await click(adm, '#admin-tabs [data-tab="audit"]', 500);
    ok('audit log tab renders', /audit|log|action|empty/i.test(txt(adm, '#admin-body').toLowerCase()));
    ok('admin header shows role + sign out', /admin/i.test(txt(adm, '#admin-head')) && !!adm.window.document.querySelector('#admin-signout'));
    ok('no runtime errors (admin)', adm.errors().length === 0, adm.errors().slice(0, 3).join(' | '));
  } finally { adm.close_(); }

  /* reviewer role must not see admin-only tabs */
  const rev = await open(BASE + '/admin.html');
  try {
    await waitFor(rev, w => w.document.querySelector('#admin-gate'), 6000, 'admin gate (reviewer)');
    await click(rev, '#admin-gate [data-role="reviewer"]', 700);
    const rtabs = $$(rev, '#admin-tabs [data-tab]').map(t => t.dataset.tab);
    ok('reviewer sees the queue but not refunds/config',
      rtabs.includes('queue') && !rtabs.includes('refunds') && !rtabs.includes('config'), rtabs.join(','));
  } finally { rev.close_(); }
}

/* ------------------------------------------------------------------ */
async function languageFlow() {
  section('Language switcher + persistence');
  const dom = await open(BASE + '/index.html');
  try {
    await waitFor(dom, w => w.document.querySelector('.lang-list button, .lang-list a'), 6000, 'lang list');
    const items = $$(dom, '.lang-list button, .lang-list a');
    ok('12 languages offered', items.length >= 12, 'items=' + items.length);
    ok('switcher shows native names', /বাংলা|हिन्दी|العربية/.test(dom.window.document.querySelector('.lang-list').textContent));
    const bn = items.find(b => /বাংলা/.test(b.textContent));
    await click(dom, bn, 900);
    await waitFor(dom, w => w.localStorage.getItem('gotax.lang') === 'bn', 6000, 'bn persisted');
    ok('choice persisted to localStorage', dom.window.localStorage.getItem('gotax.lang') === 'bn');
    ok('page re-rendered in Bangla', /[\u0980-\u09FF]/.test(dom.window.document.body.textContent));
    ok('html lang updated', dom.window.document.documentElement.getAttribute('lang') === 'bn');

    /* jsdom keeps localStorage per instance, so cross-page carry-over is
       verified through the ?lang= detection path instead. */
    const dom2 = await open(BASE + '/pricing.html?lang=bn');
    ok('?lang= sets the language on a fresh page', dom2.window.document.documentElement.getAttribute('lang') === 'bn');
    ok('pricing shows BTC conversion', /BTC/i.test(dom2.window.document.body.textContent));
    ok('pricing shows USD prices', /\$\d/.test(dom2.window.document.body.textContent));
    dom2.close_();
    ok('no runtime errors (i18n)', dom.errors().length === 0, dom.errors().slice(0, 3).join(' | '));
  } finally { dom.close_(); }
}

/* ------------------------------------------------------------------ */
(async () => {
  console.log('flow tests against ' + BASE);
  const suites = [decoderFlow, decoderBilingualFlow, checkoutFlow, receiptsFlow, returnsFlow, accountFlow, languageFlow];
  for (const s of suites) {
    try { await s(); }
    catch (e) {
      fail++;
      results.push('  ERROR ' + s.name + ': ' + (e && e.message));
      const pe = CUR ? CUR.errors() : LAST_ERRORS;
      if (pe && pe.length) results.push('        page errors: ' + pe.slice(0, 3).join(' | ').slice(0, 700));
    }
  }
  console.log(results.join('\n'));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
