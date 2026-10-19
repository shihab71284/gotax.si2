/* ============================================================
   GoTax.SI — Admin / Reviewer console (placeholder dashboard)
   Payments · manual reconciliation · refunds · review queue ·
   documents & retention · configuration · full audit log
   RBAC: admin (all) / reviewer (queue + documents only)
   ============================================================ */
(function () {
  'use strict';
  var W = window;
  if (!W.App) return;

  var TABS_ADMIN = ['payments', 'refunds', 'queue', 'documents', 'config', 'audit'];
  var TABS_REVIEWER = ['queue', 'documents'];
  var current = 'payments';
  var filter = { q: '', status: 'all' };
  var role = null;

  function init() {
    var u = API.user();
    var gate = document.querySelector('#admin-gate');
    var root = document.querySelector('#admin-root');
    if (!u || (u.role !== 'admin' && u.role !== 'reviewer')) {
      if (gate) { gate.hidden = false; bindGate(); }
      if (root) root.hidden = true;
      return;
    }
    role = u.role;
    if (gate) gate.hidden = true;
    if (root) root.hidden = false;
    var tabs = role === 'admin' ? TABS_ADMIN : TABS_REVIEWER;
    if (tabs.indexOf(current) < 0) current = tabs[0];
    renderTabs();
    renderHead();
    render();
    W.I18N.onChange(function () { renderTabs(); renderHead(); render(); });
  }

  function bindGate() {
    var form = document.querySelector('#admin-signin');
    if (!form) return;
    form.querySelectorAll('[data-role]').forEach(function (b) {
      b.addEventListener('click', function () {
        API.signIn(b.dataset.role);
        App.audit('auth.signIn', b.dataset.role, 'demo console');
        init();
      });
    });
  }

  function renderHead() {
    var h = document.querySelector('#admin-head');
    if (!h) return;
    var u = API.user();
    h.innerHTML = '<div><h1 class="mt0">' + App.escapeHtml(W.t('admin.title')) + '</h1>' +
      '<p class="muted small">' + App.escapeHtml(W.t('admin.subtitle')) + '</p></div>' +
      '<div class="pills"><span class="pill pill-info">' + App.icons.shield + ' ' + App.escapeHtml(u.role) + '</span>' +
      '<span class="pill pill-muted">' + App.escapeHtml(u.email || '') + '</span>' +
      '<button class="btn btn-sm btn-ghost" id="admin-signout">' + App.escapeHtml(W.t('cta.signOut')) + '</button></div>';
    h.querySelector('#admin-signout').addEventListener('click', function () { API.signOut(); location.reload(); });
  }

  function renderTabs() {
    var host = document.querySelector('#admin-tabs');
    if (!host) return;
    var tabs = role === 'admin' ? TABS_ADMIN : TABS_REVIEWER;
    host.innerHTML = tabs.map(function (t) {
      return '<button class="tab' + (t === current ? ' active' : '') + '" data-tab="' + t + '">' +
        App.escapeHtml(W.t('admin.tab' + t.charAt(0).toUpperCase() + t.slice(1))) + '</button>';
    }).join('');
    host.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { current = b.dataset.tab; renderTabs(); render(); });
    });
  }

  function render() {
    var host = document.querySelector('#admin-body');
    if (!host) return;
    var fn = { payments: tabPayments, refunds: tabRefunds, queue: tabQueue, documents: tabDocuments, config: tabConfig, audit: tabAudit }[current];
    host.innerHTML = fn();
    W.I18N.apply(host);
    ({ payments: bindPayments, refunds: bindRefunds, queue: bindQueue, documents: bindDocuments, config: bindConfig, audit: function () {} }[current] || function () {})();
  }
  function money(n) { return W.I18N.money(n || 0); }
  function pill(status) {
    var m = { waiting: 'pill-warn', detected: 'pill-info', confirmed: 'pill-ok', expired: 'pill-muted', underpaid: 'pill-danger', overpaid: 'pill-warn', refunded: 'pill-info', queued: 'pill-warn', claimed: 'pill-info', done: 'pill-ok' };
    var key = 'checkout.status' + status.charAt(0).toUpperCase() + status.slice(1);
    var label = W.I18N.current ? W.t(key) : status;
    if (label === key || /^admin\./.test(label)) label = W.t('admin.status' + status.charAt(0).toUpperCase() + status.slice(1));
    return '<span class="pill ' + (m[status] || 'pill-muted') + '">' + App.escapeHtml(label || status) + '</span>';
  }

  /* ---------------- payments ---------------- */
  function tabPayments() {
    var invs = API.listInvoices();
    var conf = invs.filter(function (i) { return i.status === 'confirmed'; });
    var revenue = conf.reduce(function (s, i) { return s + (i.usd || 0); }, 0);
    var btc = conf.reduce(function (s, i) { return s + (i.btc || 0); }, 0);
    var open = invs.filter(function (i) { return i.status === 'waiting' || i.status === 'detected'; });
    var rows = invs.filter(function (i) {
      if (filter.status !== 'all' && i.status !== filter.status) return false;
      if (!filter.q) return true;
      var q = filter.q.toLowerCase();
      return [i.id, i.email, i.name, i.serviceId, i.txid, i.address].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    return '<div class="stat-grid">' +
      stat('receipt', W.t('admin.invoices'), invs.length, '') +
      stat('btc', W.t('admin.revenue'), money(revenue), W.I18N.btc(btc)) +
      stat('clock', W.t('admin.awaiting'), open.length, W.t('admin.awaitingSub')) +
      stat('shield', W.t('admin.rate'), money(API.rate()), API.config().rateSource) +
      '</div>' +
      '<div class="toolbar mt6">' +
      '<input class="input" id="adm-q" type="search" placeholder="' + App.escapeHtml(W.t('admin.search')) + '" value="' + App.escapeHtml(filter.q) + '">' +
      '<select class="input" id="adm-status" style="max-width:200px">' +
      ['all', 'waiting', 'detected', 'confirmed', 'underpaid', 'expired', 'refunded'].map(function (s) {
        return '<option value="' + s + '"' + (s === filter.status ? ' selected' : '') + '>' + App.escapeHtml(s === 'all' ? W.t('admin.allStatuses') : s) + '</option>';
      }).join('') + '</select>' +
      '<button class="btn btn-sm btn-outline" id="adm-seed">' + App.icons.plus + '<span>' + App.escapeHtml(W.t('admin.seedDemo')) + '</span></button>' +
      '</div>' +
      (rows.length ? '<div class="table-wrap"><table><thead><tr>' +
      '<th>' + App.escapeHtml(W.t('checkout.invoice')) + '</th><th>' + App.escapeHtml(W.t('admin.customer')) + '</th>' +
      '<th>' + App.escapeHtml(W.t('receipt.service')) + '</th><th>' + App.escapeHtml(W.t('receipt.usd')) + '</th>' +
      '<th>' + App.escapeHtml(W.t('receipt.btc')) + '</th><th>' + App.escapeHtml(W.t('admin.confirmations')) + '</th>' +
      '<th>' + App.escapeHtml(W.t('admin.status')) + '</th><th>' + App.escapeHtml(W.t('receipt.txid')) + '</th><th></th></tr></thead><tbody>' +
      rows.map(function (i) {
        return '<tr><td class="mono tiny">' + App.escapeHtml(i.id) + '<br><span class="muted">' + App.escapeHtml(W.I18N.dateTimeUtc(i.createdAt)) + '</span></td>' +
          '<td class="tiny">' + App.escapeHtml(i.name || '—') + '<br><span class="muted">' + App.escapeHtml(i.email || '—') + '</span></td>' +
          '<td class="tiny">' + App.escapeHtml(i.serviceLabel || i.serviceId || '—') + '</td>' +
          '<td>' + money(i.usd) + '</td><td class="mono tiny">' + App.escapeHtml(W.I18N.btc(i.btc)) + '<br><span class="muted">@ ' + money(i.rate) + '</span></td>' +
          '<td class="mono tiny">' + (i.confirmations || 0) + ' / ' + (i.requiredConfirmations || 0) + '</td>' +
          '<td>' + pill(i.status) + '</td>' +
          '<td class="tiny mono">' + (i.txid ? '<a href="' + App.escapeHtml(API.config().explorerBase + i.txid) + '" target="_blank" rel="noopener noreferrer">' + App.escapeHtml(i.txid.slice(0, 12)) + '… ↗</a>' : '—') + '</td>' +
          '<td><button class="btn btn-sm btn-outline" data-recon="' + i.id + '">' + App.escapeHtml(W.t('admin.reconcile')) + '</button></td></tr>';
      }).join('') + '</tbody></table></div>' : empty(W.t('admin.noPayments')));
  }
  function bindPayments() {
    var q = document.querySelector('#adm-q'), st = document.querySelector('#adm-status');
    if (q) q.addEventListener('input', debounce(function () { filter.q = q.value; render(); }, 250));
    if (st) st.addEventListener('change', function () { filter.status = st.value; render(); });
    var seed = document.querySelector('#adm-seed');
    if (seed) seed.addEventListener('click', function () { seedDemoPayments(); render(); });
    document.querySelectorAll('[data-recon]').forEach(function (b) {
      b.addEventListener('click', function () { reconcile(b.dataset.recon); });
    });
  }

  function reconcile(id) {
    var inv = API.invoice(id);
    if (!inv) return;
    App.modal({
      title: W.t('admin.reconcile') + ' · ' + inv.id,
      bodyHtml:
        '<div class="kv"><div><dt>' + App.escapeHtml(W.t('admin.status')) + '</dt><dd>' + pill(inv.status) + '</dd></div>' +
        '<div><dt>' + App.escapeHtml(W.t('receipt.usd')) + '</dt><dd>' + money(inv.usd) + '</dd></div>' +
        '<div><dt>' + App.escapeHtml(W.t('receipt.btc')) + '</dt><dd class="mono">' + App.escapeHtml(W.I18N.btc(inv.btc)) + '</dd></div>' +
        '<div><dt>' + App.escapeHtml(W.t('admin.expires')) + '</dt><dd>' + App.escapeHtml(W.I18N.dateTimeUtc(inv.expiresAt)) + '</dd></div></div>' +
        '<div class="field"><label for="rc-status">' + App.escapeHtml(W.t('admin.setStatus')) + '</label>' +
        '<select class="input" id="rc-status">' +
        ['waiting', 'detected', 'confirmed', 'underpaid', 'overpaid', 'expired', 'refunded'].map(function (s) {
          return '<option value="' + s + '"' + (s === inv.status ? ' selected' : '') + '>' + s + '</option>';
        }).join('') + '</select></div>' +
        '<div class="field-row"><div class="field"><label for="rc-txid">' + App.escapeHtml(W.t('receipt.txid')) + '</label>' +
        '<input class="input mono" id="rc-txid" value="' + App.escapeHtml(inv.txid || '') + '" placeholder="64 hex chars"></div>' +
        '<div class="field"><label for="rc-conf">' + App.escapeHtml(W.t('admin.confirmations')) + '</label>' +
        '<input class="input" id="rc-conf" type="number" min="0" max="99" value="' + (inv.confirmations || 0) + '"></div></div>' +
        '<div class="field"><label for="rc-paid">' + App.escapeHtml(W.t('admin.paidUsd')) + '</label>' +
        '<input class="input" id="rc-paid" type="number" step="0.01" value="' + (inv.paidUsd || inv.usd) + '"></div>' +
        '<p class="tiny muted">' + App.escapeHtml(W.t('admin.reconNote')) + '</p>',
      actionsHtml:
        '<button class="btn btn-outline" data-close>' + App.escapeHtml(W.t('cta.cancel')) + '</button>' +
        '<button class="btn btn-danger" data-refund>' + App.escapeHtml(W.t('admin.refund')) + '</button>' +
        '<button class="btn btn-primary" data-save>' + App.escapeHtml(W.t('cta.save')) + '</button>',
      onMount: function (m) {
        m.querySelector('[data-save]').addEventListener('click', function () {
          var status = m.querySelector('#rc-status').value;
          var patch = {
            txid: m.querySelector('#rc-txid').value.trim(),
            confirmations: Math.max(0, +m.querySelector('#rc-conf').value || 0),
            paidUsd: +m.querySelector('#rc-paid').value || 0,
            reconciledBy: (API.user() || {}).email || 'admin',
            reconciledAt: new Date().toISOString()
          };
          API.setInvoiceStatus(id, status, patch);
          App.closeModal();
          App.toast(W.t('cta.saved'), 'ok');
          render();
        });
        m.querySelector('[data-refund]').addEventListener('click', function () {
          App.closeModal();
          refundModal(inv);
        });
      }
    });
  }

  function refundModal(inv) {
    App.modal({
      title: W.t('admin.refund') + ' · ' + inv.id,
      bodyHtml: '<div class="field"><label for="rf-amt">' + App.escapeHtml(W.t('admin.refundAmount')) + '</label>' +
        '<input class="input" id="rf-amt" type="number" step="0.01" value="' + inv.usd + '"></div>' +
        '<div class="field"><label for="rf-reason">' + App.escapeHtml(W.t('admin.refundReason')) + '</label>' +
        '<select class="input" id="rf-reason">' +
        ['duplicate-payment', 'overpayment', 'service-not-delivered', 'customer-request', 'other'].map(function (r) {
          return '<option value="' + r + '">' + App.escapeHtml(W.t('admin.reason_' + r)) + '</option>';
        }).join('') + '</select></div>' +
        '<p class="tiny muted">' + App.escapeHtml(W.t('admin.refundNote')) + ' · <a href="legal/refunds.html">' + App.escapeHtml(W.t('legal.refunds')) + '</a></p>',
      actionsHtml: '<button class="btn btn-outline" data-close>' + App.escapeHtml(W.t('cta.cancel')) + '</button>' +
        '<button class="btn btn-danger" data-do>' + App.escapeHtml(W.t('admin.refund')) + '</button>',
      onMount: function (m) {
        m.querySelector('[data-do]').addEventListener('click', function () {
          var amt = Math.max(0, +m.querySelector('#rf-amt').value || 0);
          var reason = m.querySelector('#rf-reason').value;
          API.refund(inv.id, amt, reason);
          App.closeModal();
          App.toast(W.t('admin.refundRecorded'), 'ok');
          render();
        });
      }
    });
  }

  function seedDemoPayments() {
    var specs = [
      { usd: 19, serviceId: 'notice-explain', serviceLabel: 'Notice explanation (1 notice)', method: 'btc-onchain', status: 'confirmed', name: 'Ayesha Rahman', email: 'ayesha@example.com' },
      { usd: 29, serviceId: 'draft-letter', serviceLabel: 'Draft response letter', method: 'btc-lightning', status: 'confirmed', name: 'Luis Moreno', email: 'luis@example.com' },
      { usd: 189, serviceId: 'return-1040', serviceLabel: 'Form 1040 preparation', method: 'card', status: 'confirmed', name: 'Wei Chen', email: 'wei@example.com' },
      { usd: 49, serviceId: 'human-review', serviceLabel: 'Licensed professional review', method: 'btc-onchain', status: 'waiting', name: 'Fatuma Ali', email: 'fatuma@example.com' },
      { usd: 19, serviceId: 'notice-explain', serviceLabel: 'Notice explanation (1 notice)', method: 'btc-onchain', status: 'underpaid', name: 'Ravi Kumar', email: 'ravi@example.com' }
    ];
    specs.forEach(function (s, i) {
      var inv = API.createInvoice(s);
      if (s.status === 'confirmed') {
        API.setInvoiceStatus(inv.id, 'detected', { txid: s.method === 'card' ? 'card_' + App.hex(12) : App.hex(32), confirmations: 0, paidUsd: s.usd });
        API.setInvoiceStatus(inv.id, 'confirmed', { txid: s.method === 'card' ? 'card_' + App.hex(12) : App.hex(32), confirmations: inv.requiredConfirmations || 2, paidUsd: s.usd });
      } else if (s.status === 'underpaid') {
        API.setInvoiceStatus(inv.id, 'underpaid', { txid: App.hex(32), paidUsd: Math.round(s.usd * 0.6 * 100) / 100 });
      }
      /* backdate so the list looks lived-in */
      var all = App.Store.list('invoices');
      var idx = all.findIndex(function (x) { return x.id === inv.id; });
      if (idx >= 0) { all[idx].createdAt = new Date(Date.now() - (i + 1) * 86400000 * 1.3).toISOString(); App.Store.set('invoices', all); }
    });
    if (!API.listReviews().length) {
      API.requestReview({ kind: 'notice', noticeCode: 'CP504', risk: 'levy', reason: 'risk.levy', locale: 'en', email: 'fatuma@example.com', note: 'Wage levy notice — customer asked for options.' });
      API.requestReview({ kind: 'return-prep', noticeCode: 'Form 1040 ' + (new Date().getFullYear() - 1), risk: 'foreign-income', reason: 'return-prep-intake', locale: 'es', email: 'luis@example.com' });
      API.requestReview({ kind: 'notice', noticeCode: 'LTR5071C', risk: 'identity-theft', reason: 'risk.identity-theft', locale: 'bn', email: 'ayesha@example.com' });
    }
    App.audit('admin.seed', 'demo', 'sample payments + queue items created');
  }

  /* ---------------- refunds ---------------- */
  function tabRefunds() {
    var refs = API.listRefunds();
    var invs = API.listInvoices().filter(function (i) { return i.status === 'refunded'; });
    return '<h3 class="mt0 mb4">' + App.escapeHtml(W.t('admin.refundsRecord')) + '</h3>' +
      '<p class="small muted">' + App.escapeHtml(W.t('admin.refundsNote')) + ' · <a href="legal/refunds.html">' + App.escapeHtml(W.t('legal.refunds')) + '</a></p>' +
      ((refs.length || invs.length) ? '<div class="table-wrap"><table><thead><tr>' +
      '<th>' + App.escapeHtml(W.t('admin.refundId')) + '</th><th>' + App.escapeHtml(W.t('checkout.invoice')) + '</th>' +
      '<th>' + App.escapeHtml(W.t('admin.refundAmount')) + '</th><th>' + App.escapeHtml(W.t('admin.refundReason')) + '</th>' +
      '<th>' + App.escapeHtml(W.t('admin.refundBy')) + '</th><th>' + App.escapeHtml(W.t('account.auditAt')) + '</th></tr></thead><tbody>' +
      refs.map(function (r) {
        return '<tr><td class="mono tiny">' + App.escapeHtml(r.id) + '</td><td class="mono tiny">' + App.escapeHtml(r.invoiceId) + '</td>' +
          '<td>' + money(r.usd) + '</td><td class="tiny">' + App.escapeHtml(W.t('admin.reason_' + (r.reason || 'other'))) + '</td>' +
          '<td class="tiny">' + App.escapeHtml(r.by || '—') + '</td><td class="tiny mono">' + App.escapeHtml(W.I18N.dateTimeUtc(r.at)) + '</td></tr>';
      }).join('') +
      invs.filter(function (i) { return !refs.some(function (r) { return r.invoiceId === i.id; }); }).map(function (i) {
        return '<tr><td class="tiny muted">—</td><td class="mono tiny">' + App.escapeHtml(i.id) + '</td><td>' + money(i.refundedUsd || i.usd) + '</td>' +
          '<td class="tiny">' + App.escapeHtml(W.t('admin.reason_' + (i.refundReason || 'other'))) + '</td><td class="tiny">—</td>' +
          '<td class="tiny mono">' + App.escapeHtml(W.I18N.dateTimeUtc(i.refundedAt || i.updatedAt)) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : empty(W.t('admin.noRefunds'))) +
      '<div class="banner banner-info mt6"><span>' + App.icons.info + '</span><div><p>' + App.escapeHtml(W.t('admin.refundPolicyNote')) + '</p></div></div>';
  }
  function bindRefunds() {}

  /* ---------------- review queue ---------------- */
  function tabQueue() {
    var items = API.listReviews();
    var users = [
      { name: 'Jordan Lee, CPA', ptin: 'P01234567' },
      { name: 'Priya Natarajan, EA', ptin: 'P00998877' },
      { name: '[PARTNER NAME — placeholder]', ptin: 'P00000000' }
    ];
    return '<div class="row-between mb4"><h3 class="mt0">' + App.escapeHtml(W.t('admin.queue')) + '</h3>' +
      '<span class="pill pill-warn">' + items.filter(function (i) { return i.status === 'queued'; }).length + ' ' + App.escapeHtml(W.t('admin.awaiting')) + '</span></div>' +
      '<p class="small muted">' + App.escapeHtml(W.t('admin.queueNote')) + '</p>' +
      (items.length ? '<div class="card-list">' + items.map(function (r) {
        var risky = ['levy', 'lien', 'audit', 'identity-theft', 'fraud', 'criminal'].indexOf(r.risk) >= 0;
        return '<article class="card card-pad' + (risky ? ' card-flag' : '') + '">' +
          '<div class="row-between"><div><h4 class="mt0">' + App.icons.brain + ' ' + App.escapeHtml(r.noticeCode || r.kind) + '</h4>' +
          '<p class="small muted mb0">' + App.escapeHtml(W.t('admin.reason') + ': ' + (r.reason || '—')) + ' · ' + App.escapeHtml(W.t('account.locale') + ': ' + (r.locale || 'en')) + ' · ' + App.escapeHtml(W.I18N.dateTimeUtc(r.at)) + '</p>' +
          '<p class="tiny muted">' + App.escapeHtml(r.email || '') + (r.note ? ' — “' + App.escapeHtml(r.note) + '”' : '') + '</p></div>' +
          '<div class="pills">' + (r.risk ? '<span class="pill pill-danger">' + App.icons.alert + ' ' + App.escapeHtml(r.risk) + '</span>' : '') + pill(r.status) + '</div></div>' +
          '<div class="field-row mt4">' +
          '<div class="field"><label>' + App.escapeHtml(W.t('returns.preparer')) + '</label>' +
          '<select class="input" data-assign="' + r.id + '">' +
          '<option value="">' + App.escapeHtml(W.t('returns.preparerUnassigned')) + '</option>' +
          users.map(function (u) { return '<option value="' + App.escapeHtml(u.name) + '|' + u.ptin + '"' + (r.assignee === u.name ? ' selected' : '') + '>' + App.escapeHtml(u.name + ' · ' + u.ptin) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="field"><label>' + App.escapeHtml(W.t('admin.setStatus')) + '</label>' +
          '<select class="input" data-qstatus="' + r.id + '">' +
          ['queued', 'claimed', 'done'].map(function (s) { return '<option value="' + s + '"' + (s === r.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
          '</select></div></div>' +
          '<div class="field"><label>' + App.escapeHtml(W.t('admin.reply')) + '</label>' +
          '<textarea class="input" rows="3" data-reply="' + r.id + '" placeholder="' + App.escapeHtml(W.t('admin.replyPlaceholder')) + '">' + App.escapeHtml(r.reply || '') + '</textarea></div>' +
          '<div class="btn-row"><button class="btn btn-sm btn-primary" data-qsave="' + r.id + '">' + App.icons.check + '<span>' + App.escapeHtml(W.t('cta.save')) + '</span></button>' +
          (r.kind === 'return-prep' ? '<button class="btn btn-sm btn-outline" data-qdraft="' + r.id + '">' + App.icons.doc + '<span>' + App.escapeHtml(W.t('admin.viewIntake')) + '</span></button>' : '') +
          '</div></article>';
      }).join('') + '</div>' : empty(W.t('admin.noQueue')));
  }
  function bindQueue() {
    document.querySelectorAll('[data-qsave]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.qsave;
        var asg = document.querySelector('[data-assign="' + id + '"]').value;
        var st = document.querySelector('[data-qstatus="' + id + '"]').value;
        var reply = document.querySelector('[data-reply="' + id + '"]').value.trim();
        var patch = { status: st, reply: reply, updatedAt: new Date().toISOString(), updatedBy: (API.user() || {}).email };
        if (asg) { patch.assignee = asg.split('|')[0]; patch.ptin = asg.split('|')[1]; }
        API.updateReview(id, patch);
        App.toast(W.t('cta.saved'), 'ok');
        render();
      });
    });
    document.querySelectorAll('[data-qdraft]').forEach(function (b) {
      b.addEventListener('click', function () {
        var item = API.listReviews().filter(function (x) { return x.id === b.dataset.qdraft; })[0];
        var intake = item.intake || {};
        var body = '<div class="kv">' +
          kv(W.t('returns.taxYear'), intake.taxYear || '—') +
          kv(W.t('returns.filingStatus'), intake.filingStatus ? W.t('returns.' + intake.filingStatus) : '—') +
          kv(W.t('returns.state'), intake.state || '—') +
          kv(W.t('returns.dependents'), String(intake.dependents || 0)) +
          '</div><h4>' + App.escapeHtml(W.t('returns.incomeTypes')) + '</h4><ul class="plain small">' +
          Object.keys(intake.income || {}).filter(function (k) { return intake.income[k]; }).map(function (k) {
            return '<li>' + App.icons.check + ' ' + App.escapeHtml(k) + '</li>';
          }).join('') + '</ul>' +
          (intake.forms && intake.forms.length ? '<h4>' + App.escapeHtml(W.t('returns.confirmValues')) + '</h4>' +
            intake.forms.map(function (f) {
              return '<div class="mb4"><strong class="small">' + App.escapeHtml(f.formType) + (f.year ? ' · ' + App.escapeHtml(f.year) : '') + '</strong>' +
                '<table><tbody>' + f.fields.map(function (x) {
                  return '<tr><td class="tiny">' + App.escapeHtml(x.label) + '</td><td class="mono tiny">' + App.escapeHtml(x.value) + '</td>' +
                    '<td class="tiny">' + (x.confirmed ? '<span class="pill pill-ok">' + App.icons.check + '</span>' : '<span class="pill pill-warn">?</span>') + '</td></tr>';
                }).join('') + '</tbody></table></div>';
            }).join('') : '');
        App.modal({ title: W.t('admin.viewIntake'), bodyHtml: body, actionsHtml: '<button class="btn btn-primary" data-close>' + App.escapeHtml(W.t('cta.close')) + '</button>' });
        function kv(k, v) { return '<div><dt>' + App.escapeHtml(k) + '</dt><dd>' + App.escapeHtml(String(v)) + '</dd></div>'; }
      });
    });
  }

  /* ---------------- documents ---------------- */
  function tabDocuments() {
    var docs = API.listDocuments();
    var cfg = API.config();
    return '<div class="row-between mb4"><h3 class="mt0">' + App.escapeHtml(W.t('admin.documents')) + '</h3>' +
      '<div class="btn-row"><button class="btn btn-sm btn-outline" id="purge">' + App.icons.trash + '<span>' + App.escapeHtml(W.t('account.purgeNow')) + '</span></button>' +
      '<button class="btn btn-sm btn-ghost" id="doc-seed">' + App.icons.plus + '<span>' + App.escapeHtml(W.t('admin.seedDemo')) + '</span></button></div></div>' +
      '<p class="small muted">' + App.escapeHtml(W.t('admin.docsNote', { days: cfg.retentionDays })) + '</p>' +
      (docs.length ? '<div class="table-wrap"><table><thead><tr><th>' + App.escapeHtml(W.t('account.documents')) + '</th>' +
      '<th>' + App.escapeHtml(W.t('admin.notice')) + '</th><th>' + App.escapeHtml(W.t('account.scan')) + '</th>' +
      '<th>' + App.escapeHtml(W.t('account.signedUrl')) + '</th><th>' + App.escapeHtml(W.t('account.autoDelete')) + '</th><th>' +
      App.escapeHtml(W.t('decoder.consent')) + '</th><th></th></tr></thead><tbody>' +
      docs.map(function (d) {
        return '<tr><td class="tiny">' + App.icons.doc + ' ' + App.escapeHtml(d.name) + '<br><span class="muted mono">' + App.escapeHtml(d.id) + '</span></td>' +
          '<td class="tiny">' + App.escapeHtml(d.noticeCode || '—') + '</td>' +
          '<td>' + (d.scan === 'clean' ? '<span class="pill pill-ok">' + App.icons.shield + ' clean</span>' : '<span class="pill pill-warn">' + App.escapeHtml(d.scan || 'pending') + '</span>') + '</td>' +
          '<td class="tiny mono">' + App.escapeHtml((d.signedUrl || '—').slice(0, 34)) + '…</td>' +
          '<td class="tiny">' + App.escapeHtml(W.I18N.date(d.deleteAt)) + '</td>' +
          '<td class="tiny">' + (d.consent ? App.icons.check + ' ' + App.escapeHtml(W.I18N.dateTimeUtc(d.consent.at)) : '—') + '</td>' +
          '<td><button class="icon-btn" data-deldoc="' + d.id + '" aria-label="' + App.escapeHtml(W.t('cta.delete')) + '">' + App.icons.trash + '</button></td></tr>';
      }).join('') + '</tbody></table></div>' : empty(W.t('account.docsEmpty')));
  }
  function bindDocuments() {
    var p = document.querySelector('#purge');
    if (p) p.addEventListener('click', function () {
      var n = API.purgeExpired();
      App.toast(n ? W.t('account.purged', { count: n }) : W.t('account.nothingToPurge'), 'ok');
      render();
    });
    var s = document.querySelector('#doc-seed');
    if (s) s.addEventListener('click', function () {
      ['CP2000-sample.pdf', 'CP504-photo.jpg', 'W-2-2024.pdf'].forEach(function (n, i) {
        API.saveDocument({ name: n, kind: i === 1 ? 'jpeg' : 'pdf', sizeLabel: (120 + i * 90) + ' KB', pages: i === 2 ? 1 : 2, noticeCode: n.split('-')[0], scan: 'clean', status: 'explained' });
      });
      render();
    });
    document.querySelectorAll('[data-deldoc]').forEach(function (b) {
      b.addEventListener('click', function () {
        App.confirm(W.t('cta.delete'), '<p>' + App.escapeHtml(W.t('admin.deleteDocWarn')) + '</p>', function () {
          API.deleteDocument(b.dataset.deldoc); render();
        });
      });
    });
  }

  /* ---------------- config ---------------- */
  function tabConfig() {
    var c = API.config();
    return '<h3 class="mt0 mb4">' + App.escapeHtml(W.t('admin.config')) + '</h3>' +
      '<p class="small muted">' + App.escapeHtml(W.t('admin.configNote')) + '</p>' +
      '<form id="cfg-form" class="card card-pad">' +
      '<h4 class="mt0">' + App.icons.btc + ' ' + App.escapeHtml(W.t('admin.payments')) + '</h4>' +
      '<div class="field-grid">' +
      field('btcRateUsd', W.t('admin.btcRate'), c.btcRateUsd, 'number') +
      field('rateSource', W.t('admin.rateSource'), c.rateSource, 'text') +
      field('requiredConfirmations', W.t('admin.requiredConfirmations'), c.requiredConfirmations, 'number') +
      field('invoiceExpiryMinutes', W.t('admin.expiryMinutes'), c.invoiceExpiryMinutes, 'number') +
      '</div>' +
      '<h4 class="mt6">' + App.icons.shield + ' ' + App.escapeHtml(W.t('admin.privacyConfig')) + '</h4>' +
      '<div class="field-grid">' +
      field('retentionDays', W.t('account.retentionDays'), c.retentionDays, 'number') +
      field('signedUrlMinutes', W.t('admin.signedUrlMinutes'), c.signedUrlMinutes, 'number') +
      field('maxUploadMb', W.t('admin.maxUploadMb'), c.maxUploadMb, 'number') +
      field('rlMax', W.t('admin.rateLimitMax'), c.rateLimit.max, 'number') +
      '</div>' +
      '<h4 class="mt6">' + App.icons.doc + ' ' + App.escapeHtml(W.t('admin.business')) + '</h4>' +
      '<div class="field-grid">' +
      field('bizName', W.t('admin.businessName'), c.business.name, 'text') +
      field('bizEmail', W.t('admin.businessEmail'), c.business.email, 'text') +
      field('bizPhone', W.t('admin.businessPhone'), c.business.phone, 'text') +
      field('bizAddress', W.t('admin.businessAddress'), c.business.address, 'text') +
      field('explorerBase', W.t('admin.explorerBase'), c.explorerBase, 'text') +
      field('apiBase', W.t('admin.apiBase'), c.apiBase, 'text') +
      '</div>' +
      '<p class="tiny muted">' + App.escapeHtml(W.t('admin.placeholderNote')) + '</p>' +
      '<div class="btn-row mt4"><button class="btn btn-primary" type="submit">' + App.icons.check + '<span>' + App.escapeHtml(W.t('cta.save')) + '</span></button>' +
      '<button class="btn btn-ghost" type="button" id="cfg-reset">' + App.escapeHtml(W.t('admin.resetDefaults')) + '</button></div>' +
      '</form>';

    function field(id, label, value, type) {
      return '<div class="field"><label for="cfg-' + id + '">' + App.escapeHtml(label) + '</label>' +
        '<input class="input' + (type === 'number' ? '' : ' mono') + '" id="cfg-' + id + '" type="' + type + '" value="' + App.escapeHtml(String(value)) + '"></div>';
    }
  }
  function bindConfig() {
    var form = document.querySelector('#cfg-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var g = function (id) { return document.querySelector('#cfg-' + id); };
      var patch = {
        btcRateUsd: +g('btcRateUsd').value || API.config().btcRateUsd,
        rateSource: g('rateSource').value,
        requiredConfirmations: Math.max(0, +g('requiredConfirmations').value || 0),
        invoiceExpiryMinutes: Math.max(1, +g('invoiceExpiryMinutes').value || 15),
        retentionDays: Math.max(1, +g('retentionDays').value || 90),
        signedUrlMinutes: Math.max(1, +g('signedUrlMinutes').value || 5),
        maxUploadMb: Math.max(1, +g('maxUploadMb').value || 15),
        rateLimit: { max: Math.max(1, +g('rlMax').value || 6), windowMs: 60000 },
        explorerBase: g('explorerBase').value,
        apiBase: g('apiBase').value,
        business: { name: g('bizName').value, email: g('bizEmail').value, phone: g('bizPhone').value, address: g('bizAddress').value }
      };
      API.saveConfig(patch);
      App.Store.remove('rate');
      App.toast(W.t('cta.saved'), 'ok');
      renderHead(); render();
    });
    var reset = document.querySelector('#cfg-reset');
    if (reset) reset.addEventListener('click', function () {
      App.Store.remove('settings');
      App.toast(W.t('admin.resetDefaults'), 'ok');
      render();
    });
  }

  /* ---------------- audit ---------------- */
  function tabAudit() {
    var rows = API.listAudit().slice(0, 120);
    return '<h3 class="mt0 mb2">' + App.escapeHtml(W.t('account.auditLog')) + '</h3>' +
      '<p class="small muted">' + App.escapeHtml(W.t('admin.auditNote')) + '</p>' +
      (rows.length ? '<div class="table-wrap"><table><thead><tr><th>' + App.escapeHtml(W.t('account.auditAt')) + '</th>' +
      '<th>' + App.escapeHtml(W.t('account.auditActor')) + '</th><th>' + App.escapeHtml(W.t('account.auditEvent')) + '</th>' +
      '<th>' + App.escapeHtml(W.t('account.auditTarget')) + '</th><th>' + App.escapeHtml(W.t('admin.detail')) + '</th></tr></thead><tbody>' +
      rows.map(function (a) {
        return '<tr><td class="tiny mono">' + App.escapeHtml(W.I18N.dateTimeUtc(a.at)) + '</td>' +
          '<td class="tiny">' + App.escapeHtml(a.actor) + '</td><td class="tiny"><span class="pill pill-muted">' + App.escapeHtml(a.action) + '</span></td>' +
          '<td class="tiny mono">' + App.escapeHtml(a.target || '—') + '</td><td class="tiny">' + App.escapeHtml(a.detail || '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : empty('No audit events.'));
  }

  function stat(icon, label, n, sub) {
    return '<div class="stat-card"><div class="stat-icon">' + (App.icons[icon] || '') + '</div>' +
      '<div class="stat-n">' + n + '</div><div class="stat-label">' + App.escapeHtml(label) + '</div>' +
      (sub ? '<div class="stat-sub">' + App.escapeHtml(sub) + '</div>' : '') + '</div>';
  }
  function empty(msg) { return '<p class="muted small">' + App.escapeHtml(msg) + '</p>'; }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
