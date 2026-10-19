/* ============================================================
   GoTax.SI — Account / Dashboard
   Documents · explanations · orders & receipts · review queue ·
   security · data & privacy (retention, export, delete) · audit log
   ============================================================ */
(function () {
  'use strict';
  var W = window;
  if (!W.App) return;
  var TABS = ['overview', 'documents', 'explanations', 'orders', 'reviews', 'security', 'data'];
  var current = (new URLSearchParams(location.search).get('tab') || 'overview');
  if (TABS.indexOf(current) < 0) current = 'overview';

  function init() {
    var user = API.user();
    var gate = document.querySelector('#auth-gate');
    var host = document.querySelector('#account-root');
    if (!user) { gate.hidden = false; if (host) host.hidden = true; bindAuth(); return; }
    gate.hidden = true; if (host) host.hidden = false;
    renderTabs();
    bindTabs();
    renderProfile();
    renderTab();
    W.I18N.onChange(function () { renderTabs(); renderTab(); });
  }

  function bindAuth() {
    /* Demo console: switch identity without a real auth backend. The buttons
       are inert in production builds once the real API is wired in. */
    document.querySelectorAll('#auth-gate [data-demo-role]').forEach(function (b) {
      b.addEventListener('click', function () {
        API.signIn(b.dataset.demoRole);
        App.audit('auth.signIn', (API.user() || {}).id, 'demo console role=' + b.dataset.demoRole);
        var u = API.user() || {};
        App.toast(W.t('account.welcome', { name: u.name || '' }), 'ok');
        init();
      });
    });
    var form = document.querySelector('#signin-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = form.querySelector('#si-email').value.trim();
      var pass = form.querySelector('#si-pass').value;
      if (!email || !/.+@.+\..+/.test(email) || pass.length < 6) { App.toast(W.t('account.authError'), 'err'); return; }
      API.signIn({ email: email, name: email.split('@')[0], pass: pass, role: 'customer' });
      App.track('account.signin');
      init();
    });
  }

  function renderTabs() {
    var host = document.querySelector('#account-tabs');
    if (!host) return;
    host.innerHTML = TABS.map(function (t) {
      return '<button class="tab' + (t === current ? ' active' : '') + '" data-tab="' + t + '" role="tab" aria-selected="' + (t === current) + '">' +
        App.escapeHtml(W.t('account.tab' + t.charAt(0).toUpperCase() + t.slice(1))) + '</button>';
    }).join('');
    host.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        current = b.dataset.tab;
        renderTabs(); renderTab();
        history.replaceState(null, '', '?tab=' + current);
      });
    });
  }

  function bindTabs() {
    var out = document.querySelector('#signout');
    if (out) out.addEventListener('click', function () { API.signOut(); location.reload(); });
  }

  function renderProfile() {
    var u = API.user();
    var host = document.querySelector('#account-profile');
    if (!host || !u) return;
    host.innerHTML =
      '<div class="avatar" aria-hidden="true">' + App.escapeHtml((u.name || u.email || 'G').slice(0, 1).toUpperCase()) + '</div>' +
      '<div><div class="acct-name">' + App.escapeHtml(u.name || '') + '</div>' +
      '<div class="acct-email">' + App.escapeHtml(u.email || '') + '</div>' +
      '<div class="pills mt2">' +
      '<span class="pill pill-info">' + App.escapeHtml(W.t('account.role') + ': ' + u.role) + '</span>' +
      (u.emailVerified ? '<span class="pill pill-ok">' + App.icons.check + ' ' + App.escapeHtml(W.t('account.emailVerified')) + '</span>'
        : '<span class="pill pill-warn">' + App.escapeHtml(W.t('account.emailNotVerified')) + '</span>') +
      (u.twoFactor ? '<span class="pill pill-ok">' + App.icons.shield + ' ' + App.escapeHtml(W.t('account.2faOn')) + '</span>'
        : '<span class="pill pill-muted">' + App.escapeHtml(W.t('account.2faOff')) + '</span>') +
      '</div></div>';
  }

  function renderTab() {
    var host = document.querySelector('#account-body');
    if (!host) return;
    var html = {
      overview: tabOverview, documents: tabDocuments, explanations: tabExplanations,
      orders: tabOrders, reviews: tabReviews, security: tabSecurity, data: tabData
    }[current]();
    host.innerHTML = html;
    W.I18N.apply(host);
    ({ overview: bindOverview, documents: bindDocuments, explanations: bindExplanations, orders: bindOrders, reviews: bindReviews, security: bindSecurity, data: bindData }[current] || function () {})();
  }

  /* ---------------- overview ---------------- */
  function tabOverview() {
    var docs = API.listDocuments(), exps = API.listExplanations(), invs = API.listInvoices(), reviews = API.listReviews();
    var open = invs.filter(function (i) { return i.status === 'waiting' || i.status === 'detected'; });
    return '<div class="stat-grid">' +
      stat('doc', W.t('account.documents'), docs.length, docs.length ? W.t('account.retentionIn', { days: API.config().retentionDays }) : '') +
      stat('brain', W.t('account.explanations'), exps.length, exps.length ? W.t('decoder.confidence') + ' ' + Math.round(((exps[0] || {}).confidence || 0) * 100) + '%' : '') +
      stat('receipt', W.t('account.orders'), invs.length, open.length ? open.length + ' open' : '') +
      stat('shield', W.t('account.reviews'), reviews.length, reviews.filter(function (r) { return r.status === 'queued' || r.status === 'claimed'; }).length + ' open') +
      '</div>' +
      (open.length ? '<div class="banner banner-warn mt4"><span>' + App.icons.alert + '</span><div><h4>' +
        App.escapeHtml(W.t('account.openInvoice')) + '</h4><p>' + App.escapeHtml(W.t('account.openInvoiceBody')) + '</p>' +
        '<a class="btn btn-sm btn-primary" href="checkout.html">' + App.escapeHtml(W.t('cta.continue')) + '</a></div></div>' : '') +
      '<div class="grid two mt6">' +
      '<div class="card card-pad"><h3 class="mt0">' + App.escapeHtml(W.t('account.recentDocs')) + '</h3>' +
      (docs.length ? '<ul class="plain">' + docs.slice(0, 4).map(function (d) {
        return '<li class="row-between small"><span>' + App.escapeHtml(d.name) + '</span><span class="pill pill-muted">' + App.escapeHtml(d.status || 'stored') + '</span></li>';
      }).join('') + '</ul>' : empty(W.t('account.docsEmpty'))) +
      '</div>' +
      '<div class="card card-pad"><h3 class="mt0">' + App.escapeHtml(W.t('account.quickActions')) + '</h3>' +
      '<div class="btn-col">' +
      '<a class="btn btn-primary" href="decoder.html">' + App.icons.search + '<span>' + App.escapeHtml(W.t('cta.decode')) + '</span></a>' +
      '<a class="btn btn-outline" href="returns.html">' + App.icons.file + '<span>' + App.escapeHtml(W.t('cta.startReturn')) + '</span></a>' +
      '<a class="btn btn-ghost" href="pricing.html">' + App.icons.tag + '<span>' + App.escapeHtml(W.t('cta.viewPricing')) + '</span></a>' +
      '</div></div></div>';
  }
  function stat(icon, label, n, sub) {
    return '<div class="stat-card"><div class="stat-icon">' + (App.icons[icon] || '') + '</div>' +
      '<div class="stat-n">' + n + '</div><div class="stat-label">' + App.escapeHtml(label) + '</div>' +
      (sub ? '<div class="stat-sub">' + App.escapeHtml(sub) + '</div>' : '') + '</div>';
  }
  function empty(msg) { return '<p class="muted small">' + App.escapeHtml(msg) + '</p>'; }
  function bindOverview() {}

  /* ---------------- documents ---------------- */
  function tabDocuments() {
    var docs = API.listDocuments();
    return '<div class="row-between mb4"><h3 class="mt0">' + App.escapeHtml(W.t('account.documents')) + '</h3>' +
      '<a class="btn btn-sm btn-outline" href="decoder.html">' + App.icons.upload + '<span>' + App.escapeHtml(W.t('cta.upload')) + '</span></a></div>' +
      '<p class="small muted">' + App.escapeHtml(W.t('account.retentionNote', { days: API.config().retentionDays })) + '</p>' +
      (docs.length ? '<ul class="file-list">' + docs.map(function (d) {
        return '<li class="file-item"><span>' + App.icons.doc + '</span>' +
          '<span style="flex:1 1 200px">' +
          '<span class="fi-name">' + App.escapeHtml(d.name) + '</span>' +
          '<span class="fi-meta">' + App.escapeHtml((d.kind || '').toUpperCase()) + (d.sizeLabel ? ' · ' + App.escapeHtml(d.sizeLabel) : '') +
          (d.pages ? ' · ' + W.t('decoder.pages', { count: d.pages }) : '') + ' · ' + App.escapeHtml(W.I18N.dateTimeUtc(d.at || d.createdAt)) + '</span>' +
          (d.signedUrl ? '<span class="signed-url" title="' + App.escapeHtml(W.t('account.signedUrl')) + '">' + App.icons.link + ' ' + App.escapeHtml(d.signedUrl) + '</span>' : '') +
          (d.deleteAt ? '<span class="fi-meta">' + App.icons.clock + ' ' + App.escapeHtml(W.t('account.deletesIn', { days: Math.max(0, App.daysBetween(new Date(), d.deleteAt)) })) + '</span>' : '') +
          '</span>' +
          '<span class="pill ' + (d.scan === 'clean' ? 'pill-ok' : 'pill-warn') + '">' + App.icons.shield + ' ' + App.escapeHtml(W.t('account.scanClean')) + '</span>' +
          '<button class="btn btn-sm btn-ghost" data-view-doc="' + d.id + '">' + App.icons.eye + '</button>' +
          '<button class="icon-btn" data-del="' + d.id + '" aria-label="' + App.escapeHtml(W.t('cta.delete')) + '">' + App.icons.trash + '</button></li>';
      }).join('') + '</ul>' : empty(W.t('account.docsEmpty')));
  }
  function bindDocuments() {
    document.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () {
        App.confirm(W.t('cta.delete'), '<p>' + App.escapeHtml(W.t('account.deleteConfirm')) + '</p>', function () {
          API.deleteDocument(b.dataset.del);
          App.toast(W.t('cta.deleted'), 'ok');
          renderTab();
        });
      });
    });
    document.querySelectorAll('[data-view-doc]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = API.getDocument(b.dataset.viewDoc);
        API.viewDocument(d.id);
        App.modal({
          title: d.name,
          bodyHtml: '<p class="small muted">' + App.escapeHtml(W.t('account.privateStorage')) + '</p>' +
            '<div class="kv">' +
            '<div><dt>' + App.escapeHtml(W.t('account.kind')) + '</dt><dd>' + App.escapeHtml((d.kind || '').toUpperCase()) + '</dd></div>' +
            '<div><dt>' + App.escapeHtml(W.t('account.size')) + '</dt><dd>' + App.escapeHtml(d.sizeLabel || '—') + '</dd></div>' +
            '<div><dt>' + App.escapeHtml(W.t('account.scan')) + '</dt><dd>' + App.escapeHtml(d.scan || 'clean') + '</dd></div>' +
            '<div><dt>' + App.escapeHtml(W.t('account.signedUrl')) + '</dt><dd class="mono tiny">' + App.escapeHtml(d.signedUrl || '—') + '</dd></div>' +
            '<div><dt>' + App.escapeHtml(W.t('account.expires')) + '</dt><dd>' + App.escapeHtml(W.I18N.dateTimeUtc(d.signedUrlExpiresAt)) + '</dd></div>' +
            '<div><dt>' + App.escapeHtml(W.t('account.autoDelete')) + '</dt><dd>' + App.escapeHtml(W.I18N.date(d.deleteAt)) + '</dd></div>' +
            '</div><p class="tiny muted">' + App.escapeHtml(W.t('account.viewLogged')) + '</p>',
          actionsHtml: '<button class="btn btn-primary" data-close>' + App.escapeHtml(W.t('cta.close')) + '</button>'
        });
      });
    });
  }

  /* ---------------- explanations ---------------- */
  function tabExplanations() {
    var exps = API.listExplanations();
    return '<h3 class="mt0 mb4">' + App.escapeHtml(W.t('account.explanations')) + '</h3>' +
      (exps.length ? '<div class="card-list">' + exps.map(function (e) {
        return '<article class="card card-pad"><div class="row-between">' +
          '<div><h4 class="mt0">' + App.icons.brain + ' ' + App.escapeHtml(e.code || 'Notice') + ' · ' + App.escapeHtml(e.title || '') + '</h4>' +
          '<p class="small muted mb0">' + App.escapeHtml(e.source || 'pasted') + ' · ' + App.escapeHtml(W.I18N.dateTimeUtc(e.at)) + ' · ' +
          App.escapeHtml(W.t('decoder.taxYear') + ': ' + (e.year || W.t('decoder.notFound'))) + '</p></div>' +
          '<span class="pill ' + (e.level === 'high' ? 'pill-ok' : e.level === 'medium' ? 'pill-warn' : 'pill-danger') + '">' +
          App.escapeHtml(W.t('decoder.confidence')) + ' ' + Math.round((e.confidence || 0) * 100) + '%</span></div>' +
          '<div class="btn-row mt4">' +
          '<button class="btn btn-sm btn-outline" data-open="' + e.id + '">' + App.icons.eye + '<span>' + App.escapeHtml(W.t('cta.view')) + '</span></button>' +
          '<button class="btn btn-sm btn-ghost" data-pdf="' + e.id + '">' + App.icons.download + '<span>' + App.escapeHtml(W.t('cta.downloadPdf')) + '</span></button>' +
          '<button class="btn btn-sm btn-ghost" data-del-exp="' + e.id + '">' + App.icons.trash + '<span>' + App.escapeHtml(W.t('cta.delete')) + '</span></button>' +
          '</div></article>';
      }).join('') + '</div>' : empty(W.t('account.noExplanations')));
  }
  function bindExplanations() {
    document.querySelectorAll('[data-del-exp]').forEach(function (b) {
      b.addEventListener('click', function () {
        App.confirm(W.t('cta.delete'), '<p>' + App.escapeHtml(W.t('account.deleteConfirm')) + '</p>', function () {
          API.deleteExplanation(b.dataset.delExp); renderTab();
        });
      });
    });
    document.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () { location.href = 'decoder.html?saved=' + b.dataset.open; });
    });
    document.querySelectorAll('[data-pdf]').forEach(function (b) {
      b.addEventListener('click', function () {
        var e = API.listExplanations().filter(function (x) { return x.id === b.dataset.pdf; })[0];
        if (!e || !e.payload) { App.toast(W.t('common.error'), 'warn'); return; }
        try {
          var doc = W.Decode.exportPdf(e.payload.analysis, e.payload.explanation);
          doc.saveAs((e.code || 'notice') + '-explanation.pdf');
          App.audit('explanation.export.pdf', e.id, 'downloaded');
        } catch (err) { App.toast(String(err.message || err), 'err'); }
      });
    });
  }

  /* ---------------- orders & receipts ---------------- */
  function tabOrders() {
    var invs = API.listInvoices(), receipts = API.listReceipts();
    return '<h3 class="mt0 mb4">' + App.escapeHtml(W.t('account.orders')) + '</h3>' +
      (invs.length ? '<div class="table-wrap"><table><thead><tr>' +
      '<th>' + App.escapeHtml(W.t('checkout.invoice')) + '</th><th>' + App.escapeHtml(W.t('receipt.service')) + '</th>' +
      '<th>' + App.escapeHtml(W.t('receipt.usd')) + '</th><th>' + App.escapeHtml(W.t('receipt.btc')) + '</th>' +
      '<th>' + App.escapeHtml(W.t('admin.status')) + '</th><th>' + App.escapeHtml(W.t('receipt.method')) + '</th><th></th></tr></thead><tbody>' +
      invs.map(function (i) {
        return '<tr><td class="mono tiny">' + App.escapeHtml(i.id) + '</td><td>' + App.escapeHtml(i.serviceLabel || i.serviceId || '') + '</td>' +
          '<td>' + App.escapeHtml(W.I18N.money(i.usd)) + '</td><td class="mono tiny">' + App.escapeHtml(W.I18N.btc(i.btc)) + '</td>' +
          '<td>' + statusPill(i.status) + '</td><td class="tiny">' + App.escapeHtml(i.method || '') + '</td>' +
          '<td>' + (i.status === 'confirmed' ? '' : '<a class="btn btn-sm btn-outline" href="checkout.html?service=' + encodeURIComponent(i.serviceId || '') + '">' + App.escapeHtml(W.t('cta.payNow')) + '</a>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : empty(W.t('account.noOrders'))) +
      '<h3 class="mt8 mb4">' + App.escapeHtml(W.t('account.receipts')) + '</h3>' +
      (receipts.length ? '<ul class="file-list">' + receipts.map(function (r) {
        return '<li class="file-item"><span>' + App.icons.receipt + '</span>' +
          '<span style="flex:1 1 200px"><span class="fi-name">' + App.escapeHtml(r.id) + '</span>' +
          '<span class="fi-meta">' + App.escapeHtml(r.serviceLabel || '') + ' · ' + App.escapeHtml(W.I18N.money(r.usd)) +
          (r.btc ? ' · ' + W.I18N.btc(r.btc) : '') + ' · ' + App.escapeHtml(W.I18N.dateTimeUtc(r.at)) + '</span></span>' +
          '<a class="btn btn-sm btn-ghost" href="receipts.html?id=' + encodeURIComponent(r.id) + '">' + App.icons.eye + '</a>' +
          '<button class="btn btn-sm btn-ghost" data-receipt-pdf="' + r.id + '">' + App.icons.download + '</button></li>';
      }).join('') + '</ul>' : empty(W.t('account.noReceipts')));
  }
  function statusPill(s) {
    var m = { waiting: 'pill-warn', detected: 'pill-info', confirmed: 'pill-ok', expired: 'pill-muted', underpaid: 'pill-danger', overpaid: 'pill-warn', refunded: 'pill-info' };
    return '<span class="pill ' + (m[s] || 'pill-muted') + '">' + App.escapeHtml(W.t('checkout.status' + s.charAt(0).toUpperCase() + s.slice(1))) + '</span>';
  }
  function bindOrders() {
    document.querySelectorAll('[data-receipt-pdf]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = API.listReceipts().filter(function (x) { return x.id === b.dataset.receiptPdf; })[0];
        if (r && W.Receipts) W.Receipts.downloadPdf(r);
      });
    });
  }

  /* ---------------- review queue ---------------- */
  function tabReviews() {
    var reviews = API.listReviews();
    return '<h3 class="mt0 mb2">' + App.escapeHtml(W.t('account.reviews')) + '</h3>' +
      '<p class="small muted">' + App.escapeHtml(W.t('returns.packageNote')) + '</p>' +
      (reviews.length ? '<div class="card-list">' + reviews.map(function (r) {
        return '<article class="card card-pad"><div class="row-between">' +
          '<div><h4 class="mt0">' + App.escapeHtml(r.kind === 'return-prep' ? W.t('cta.startReturn') : (r.noticeCode || 'Review')) + '</h4>' +
          '<p class="small muted mb0">' + App.escapeHtml(W.t('admin.reason') + ': ' + (r.reason || '—')) + ' · ' + App.escapeHtml(W.I18N.dateTimeUtc(r.at)) + '</p></div>' +
          '<span class="pill ' + (r.status === 'done' ? 'pill-ok' : r.status === 'claimed' ? 'pill-info' : 'pill-warn') + '">' +
          App.escapeHtml(W.t('admin.status' + r.status.charAt(0).toUpperCase() + r.status.slice(1))) + '</span></div>' +
          (r.assignee ? '<p class="tiny muted mt2">' + App.escapeHtml(W.t('returns.preparer') + ': ' + r.assignee) + '</p>' : '') +
          '</article>';
      }).join('') + '</div>' : empty(W.t('account.noReviews')));
  }
  function bindReviews() {}

  /* ---------------- security ---------------- */
  function tabSecurity() {
    var u = API.user() || {};
    var audit = API.listAudit().slice(0, 30);
    return '<h3 class="mt0 mb4">' + App.escapeHtml(W.t('account.security')) + '</h3>' +
      '<div class="grid two">' +
      '<div class="card card-pad"><h4 class="mt0">' + App.icons.shield + ' ' + App.escapeHtml(W.t('account.2fa')) + '</h4>' +
      '<p class="small muted">' + App.escapeHtml(W.t('account.2faDesc')) + '</p>' +
      '<label class="check"><input type="checkbox" id="tfa"' + (u.twoFactor ? ' checked' : '') + '><span>' + App.escapeHtml(W.t('account.enable2fa')) + '</span></label>' +
      '<p class="tiny muted mt2">' + App.escapeHtml('TOTP authenticator apps supported: 1Password, Authy, Google Authenticator, Aegis.') + '</p></div>' +
      '<div class="card card-pad"><h4 class="mt0">' + App.icons.mail + ' ' + App.escapeHtml(W.t('account.emailVerify')) + '</h4>' +
      '<p class="small muted">' + (u.emailVerified ? App.escapeHtml(W.t('account.emailVerified')) : App.escapeHtml(W.t('account.emailNotVerified'))) + '</p>' +
      (u.emailVerified ? '' : '<button class="btn btn-sm btn-primary" id="verify-email">' + App.escapeHtml(W.t('account.sendVerify')) + '</button>') +
      '<hr><h4 class="mt4">' + App.escapeHtml(W.t('account.sessions')) + '</h4>' +
      '<p class="small mono tiny">' + App.escapeHtml((u.sessionId || '').slice(0, 24)) + '… · ' + App.escapeHtml(navigator.platform || '') + '</p>' +
      '<button class="btn btn-sm btn-ghost" id="signout-all">' + App.escapeHtml(W.t('account.signOutAll')) + '</button></div>' +
      '</div>' +
      '<h4 class="mt6">' + App.icons.clock + ' ' + App.escapeHtml(W.t('account.auditLog')) + '</h4>' +
      '<p class="small muted">' + App.escapeHtml(W.t('account.auditDesc')) + '</p>' +
      (audit.length ? '<div class="table-wrap"><table><thead><tr><th>' + App.escapeHtml(W.t('account.auditAt')) + '</th><th>' +
      App.escapeHtml(W.t('account.auditEvent')) + '</th><th>' + App.escapeHtml(W.t('account.auditTarget')) + '</th><th>' +
      App.escapeHtml(W.t('account.auditActor')) + '</th></tr></thead><tbody>' + audit.map(function (a) {
        return '<tr><td class="tiny mono">' + App.escapeHtml(W.I18N.dateTimeUtc(a.at)) + '</td><td class="tiny">' + App.escapeHtml(a.action) + '</td>' +
          '<td class="tiny mono">' + App.escapeHtml(a.target || '—') + '</td><td class="tiny">' + App.escapeHtml(a.actor || 'system') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : empty('No audit events yet.'));
  }
  function bindSecurity() {
    var tfa = document.querySelector('#tfa');
    if (tfa) tfa.addEventListener('change', function () {
      var u = API.user(); u.twoFactor = tfa.checked; App.Store.set('user', u);
      App.audit('security.2fa', u.email, tfa.checked ? 'enabled' : 'disabled');
      App.toast(tfa.checked ? W.t('account.2faOn') : W.t('account.2faOff'), 'ok');
      renderProfile();
    });
    var ve = document.querySelector('#verify-email');
    if (ve) ve.addEventListener('click', function () {
      var u = API.user(); u.emailVerified = true; App.Store.set('user', u);
      App.audit('security.email.verified', u.email, 'confirmed');
      App.toast(W.t('account.emailVerified'), 'ok'); renderProfile(); renderTab();
    });
    var so = document.querySelector('#signout-all');
    if (so) so.addEventListener('click', function () { API.signOut(); location.href = 'account.html'; });
  }

  /* ---------------- data & privacy ---------------- */
  function tabData() {
    var cfg = API.config();
    return '<h3 class="mt0 mb4">' + App.escapeHtml(W.t('account.data')) + '</h3>' +
      '<div class="grid two">' +
      '<div class="card card-pad"><h4 class="mt0">' + App.icons.clock + ' ' + App.escapeHtml(W.t('account.retention')) + '</h4>' +
      '<p class="small muted">' + App.escapeHtml(W.t('account.retentionDesc')) + '</p>' +
      '<div class="field"><label for="ret-days">' + App.escapeHtml(W.t('account.retentionDays')) + '</label>' +
      '<select class="input" id="ret-days">' + [7, 30, 60, 90, 180, 365].map(function (d) {
        return '<option value="' + d + '"' + (d === cfg.retentionDays ? ' selected' : '') + '>' + d + '</option>';
      }).join('') + '</select></div>' +
      '<p class="tiny muted">' + App.escapeHtml(W.t('account.retentionIn', { days: cfg.retentionDays })) + '</p>' +
      '<button class="btn btn-sm btn-primary" id="ret-save">' + App.escapeHtml(W.t('cta.save')) + '</button>' +
      '<button class="btn btn-sm btn-ghost" id="purge-now">' + App.escapeHtml(W.t('account.purgeNow')) + '</button></div>' +
      '<div class="card card-pad"><h4 class="mt0">' + App.icons.download + ' ' + App.escapeHtml(W.t('account.exportData')) + '</h4>' +
      '<p class="small muted">' + App.escapeHtml(W.t('account.exportDesc')) + '</p>' +
      '<button class="btn btn-sm btn-outline" id="export-json">' + App.icons.download + '<span>' + App.escapeHtml(W.t('account.exportJson')) + '</span></button>' +
      '<hr><h4 class="mt4">' + App.icons.trash + ' ' + App.escapeHtml(W.t('account.deleteAll')) + '</h4>' +
      '<p class="small muted">' + App.escapeHtml(W.t('account.deleteAllDesc')) + '</p>' +
      '<button class="btn btn-sm btn-danger" id="delete-all">' + App.icons.trash + '<span>' + App.escapeHtml(W.t('account.deleteAllData')) + '</span></button></div>' +
      '</div>' +
      '<div class="card card-pad mt6"><h4 class="mt0">' + App.icons.shield + ' ' + App.escapeHtml(W.t('account.privacySummary')) + '</h4>' +
      '<ul class="plain small">' +
      ['account.priv1', 'account.priv2', 'account.priv3', 'account.priv4', 'account.priv5'].map(function (k) {
        return '<li>' + App.icons.check + ' ' + App.escapeHtml(W.t(k)) + '</li>';
      }).join('') + '</ul>' +
      '<p class="small muted">' + App.escapeHtml(W.t('legal.privacy')) + ' · <a href="legal/retention.html">' + App.escapeHtml(W.t('legal.retention')) + '</a></p></div>';
  }
  function bindData() {
    var save = document.querySelector('#ret-save');
    if (save) save.addEventListener('click', function () {
      var days = +document.querySelector('#ret-days').value;
      API.saveConfig({ retentionDays: days });
      App.audit('privacy.retention.changed', String(days), 'updated');
      App.toast(W.t('cta.saved'), 'ok');
      renderTab();
    });
    var purge = document.querySelector('#purge-now');
    if (purge) purge.addEventListener('click', function () {
      var n = API.purgeExpired();
      App.toast(n ? W.t('account.purged', { count: n }) : W.t('account.nothingToPurge'), 'ok');
      renderTab();
    });
    var exp = document.querySelector('#export-json');
    if (exp) exp.addEventListener('click', function () {
      var payload = {
        exportedAt: new Date().toISOString(),
        account: { email: (API.user() || {}).email, name: (API.user() || {}).name, role: (API.user() || {}).role },
        documents: API.listDocuments().map(function (d) {
          return { id: d.id, name: d.name, kind: d.kind, sizeLabel: d.sizeLabel, at: d.at, deleteAt: d.deleteAt, noticeCode: d.noticeCode };
        }),
        explanations: API.listExplanations().map(function (e) { return { id: e.id, code: e.code, title: e.title, at: e.at, confidence: e.confidence, payload: e.payload }; }),
        invoices: API.listInvoices(),
        receipts: API.listReceipts(),
        reviews: API.listReviews(),
        audit: API.listAudit(),
        consents: App.Store.get('consents', []),
        note: 'SSNs, TINs and full document contents are never stored or exported. See legal/retention.html.'
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gotax-data-export-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      App.audit('privacy.export', payload.documents.length + ' docs', 'downloaded');
      App.toast(W.t('account.exported'), 'ok');
    });
    var del = document.querySelector('#delete-all');
    if (del) del.addEventListener('click', function () {
      App.modal({
        title: W.t('account.deleteAllData'),
        bodyHtml: '<p>' + App.escapeHtml(W.t('account.deleteAllDesc')) + '</p>' +
          '<p class="small">' + App.escapeHtml(W.t('account.deleteAllWarn')) + '</p>' +
          '<div class="field"><label for="del-word">' + App.escapeHtml(W.t('account.typeDelete')) + '</label>' +
          '<input class="input" id="del-word" autocomplete="off" placeholder="DELETE"></div>',
        actionsHtml: '<button class="btn btn-outline" data-close>' + App.escapeHtml(W.t('cta.cancel')) + '</button>' +
          '<button class="btn btn-danger" data-del>' + App.escapeHtml(W.t('account.deleteAllData')) + '</button>',
        onMount: function (m) {
          m.querySelector('[data-del]').addEventListener('click', function () {
            if (m.querySelector('#del-word').value.trim().toUpperCase() !== 'DELETE') { App.toast(W.t('account.typeDelete'), 'warn'); return; }
            API.deleteAllData();
            App.closeModal();
            App.toast(W.t('account.deletedAll'), 'ok', 4000);
            API.signOut();
            location.href = 'index.html';
          });
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
