/* GoTax.SI — Receipts page: list, view, re-send by email, download PDF */
(function () {
  'use strict';
  var W = window;
  if (!W.App) return;

  function init() {
    var q = new URLSearchParams(location.search);
    renderList(q.get('id'));
    W.I18N.onChange(function () { renderList(q.get('id')); });
  }

  function renderList(selectedId) {
    var receipts = API.listReceipts();
    var list = document.querySelector('#receipt-list');
    var detail = document.querySelector('#receipt-detail');
    var empty = document.querySelector('#receipt-empty');

    if (list) {
      list.innerHTML = receipts.length ? receipts.map(function (r) {
        return '<button class="receipt-row' + (r.id === selectedId ? ' active' : '') + '" data-id="' + App.escapeHtml(r.id) + '">' +
          '<span class="rr-ico">' + App.icons.receipt + '</span>' +
          '<span class="rr-main"><span class="rr-id mono">' + App.escapeHtml(r.id) + '</span>' +
          '<span class="rr-meta">' + App.escapeHtml(r.serviceLabel || r.serviceId || '') + ' · ' + App.escapeHtml(W.I18N.dateTimeUtc(r.at)) + '</span></span>' +
          '<span class="rr-amt"><strong>' + App.escapeHtml(W.I18N.money(r.usd)) + '</strong>' +
          (r.btc ? '<span class="tiny muted">' + App.escapeHtml(W.I18N.btc(r.btc)) + '</span>' : '') + '</span></button>';
      }).join('') : '';
      list.querySelectorAll('[data-id]').forEach(function (b) {
        b.addEventListener('click', function () {
          history.replaceState(null, '', '?id=' + encodeURIComponent(b.dataset.id));
          renderList(b.dataset.id);
        });
      });
    }

    var r = receipts.filter(function (x) { return x.id === selectedId; })[0] || receipts[0] || null;
    if (!r) {
      if (detail) detail.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    if (detail) {
      detail.hidden = false;
      var host = detail.querySelector('#receipt-body');
      if (host && W.Receipts) W.Receipts.render(host, r);
      var meta = detail.querySelector('#receipt-meta');
      if (meta) {
        meta.innerHTML = '<span class="pill pill-ok">' + App.icons.checkCircle + ' ' + App.escapeHtml(W.t('receipt.paid')) + '</span>' +
          '<span class="pill pill-muted">' + App.escapeHtml(W.Receipts ? W.Receipts.methodLabel(r.method) : r.method) + '</span>' +
          '<span class="pill pill-info">' + App.escapeHtml(W.t('receipt.confirmations') + ': ' + (r.confirmations || 0)) + '</span>';
      }
      var email = detail.querySelector('#receipt-email');
      if (email) email.textContent = r.email || '—';
      detail.querySelectorAll('[data-pdf]').forEach(function (b) {
        b.onclick = function () { if (W.Receipts) W.Receipts.downloadPdf(r); };
      });
      detail.querySelectorAll('[data-email-receipt]').forEach(function (b) {
        b.onclick = function () {
          App.audit('receipt.email.sent', r.id, 'to ' + (r.email || 'customer'));
          App.toast(W.t('receipt.emailed', { email: r.email || 'you' }), 'ok');
        };
      });
      detail.querySelectorAll('[data-explorer]').forEach(function (b) {
        b.href = API.config().explorerBase + r.txid;
        b.hidden = !r.txid || String(r.method).indexOf('card') === 0;
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
