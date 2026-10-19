/* ============================================================
   GoTax.SI — Receipt rendering + PDF export
   Shared by checkout.html and receipts.html.
   A receipt contains: number, UTC date/time, customer, service,
   USD amount, BTC amount, exchange rate, txid + explorer link,
   confirmation count, business details and refund policy ref.
   ============================================================ */
(function () {
  'use strict';
  var W = window;
  if (!W.App) return;

  /* ---------- receipt rendering + PDF (shared with receipts.html) ---------- */
  var Receipts = W.Receipts = {};
  Receipts.render = function (host, r) {
    var cfg = API.config();
    var svc = r.serviceLabel || r.serviceId;
    host.innerHTML =
      '<div class="receipt-head">' +
        '<div><div class="brand" style="font-size:1.1rem"><span class="gt-mark">SI</span>GoTax<span class="si">.SI</span></div>' +
        '<p class="tiny muted mb0">' + App.escapeHtml(cfg.business.name) + '<br>' + App.escapeHtml(cfg.business.address) + '<br>' +
        App.escapeHtml(cfg.business.email) + ' · ' + App.escapeHtml(cfg.business.phone) + '</p></div>' +
        '<div style="text-align:end"><span class="stamp">' + App.escapeHtml(W.t('receipt.paid')) + '</span>' +
        '<p class="tiny muted mt2 mb0">' + App.escapeHtml(W.t('receipt.number')) + '<br><strong class="mono">' + App.escapeHtml(r.id) + '</strong></p></div>' +
      '</div>' +
      '<h2 class="mt6">' + App.escapeHtml(W.t('receipt.title')) + '</h2>' +
      '<table><tbody>' +
        row(W.t('receipt.dateTime'), W.I18N.dateTimeUtc(r.at)) +
        row(W.t('receipt.customer'), App.escapeHtml(r.name || '') + (r.email ? ' &lt;' + App.escapeHtml(r.email) + '&gt;' : '')) +
        row(W.t('receipt.service'), App.escapeHtml(svc)) +
        row(W.t('receipt.usd'), W.I18N.money(r.usd)) +
        (r.btc ? row(W.t('receipt.btc'), W.I18N.btc(r.btc)) : '') +
        (r.rate ? row(W.t('receipt.rate'), '1 BTC = ' + W.I18N.money(r.rate)) : '') +
        row(W.t('receipt.method'), App.escapeHtml(methodLabel(r.method))) +
        (r.txid ? row(W.t('receipt.txid'), '<span class="mono">' + App.escapeHtml(r.txid) + '</span>' +
          (r.method.indexOf('card') === 0 ? '' : ' <a href="' + App.escapeHtml(cfg.explorerBase + r.txid) + '" target="_blank" rel="noopener noreferrer">' + App.escapeHtml(W.t('receipt.explorer')) + ' ↗</a>')) : '') +
        (r.paymentHash ? row(W.t('receipt.lightningPayment'), '<span class="mono">' + App.escapeHtml(r.paymentHash) + '</span>') : '') +
        row(W.t('receipt.confirmations'), String(r.confirmations || 0) + (r.method === 'btc-lightning' ? '' : ' / ' + API.config().requiredConfirmations)) +
      '</tbody></table>' +
      '<hr>' +
      '<p class="small"><strong>' + App.escapeHtml(W.t('receipt.refundRef')) + ':</strong> ' + App.escapeHtml(W.t('receipt.refundRefBody')) + '</p>' +
      '<p class="small muted">' + App.escapeHtml(W.t('legal.disclaimer')) + '</p>' +
      '<p class="small muted">' + App.escapeHtml(W.t('legal.reviewedBy')) + '</p>' +
      '<p class="tiny muted">' + App.escapeHtml(W.t('receipt.thanks')) + '</p>';

    function row(k, v) { return '<tr><td>' + App.escapeHtml(k) + '</td><td>' + v + '</td></tr>'; }
  };
  function methodLabel(m) {
    return ({ 'btc-onchain': 'Bitcoin (on-chain)', 'btc-lightning': 'Bitcoin (Lightning)', 'card': 'Card / bank' })[m] || m;
  }
  Receipts.methodLabel = methodLabel;

  Receipts.downloadPdf = function (r) {
    var cfg = API.config();
    var d = new PDF.Doc({ title: 'GoTax.SI receipt ' + r.id, author: 'GoTax.SI', subject: 'Payment receipt' });
    d.setHeader('GoTax.SI', 'Receipt ' + r.id);
    d.heading(W.t('receipt.title'), { size: 18 });
    d.paragraph('PAID', { size: 12, bold: true, color: [0.06, 0.42, 0.34] });
    d.rule();
    d.kv(W.t('receipt.number'), r.id);
    d.kv(W.t('receipt.dateTime'), W.I18N.dateTimeUtc(r.at));
    d.kv(W.t('receipt.customer'), (r.name || '') + (r.email ? ' <' + r.email + '>' : ''));
    d.kv(W.t('receipt.service'), r.serviceLabel || r.serviceId);
    d.kv(W.t('receipt.usd'), W.I18N.money(r.usd));
    if (r.btc) d.kv(W.t('receipt.btc'), W.I18N.btc(r.btc));
    if (r.rate) d.kv(W.t('receipt.rate'), '1 BTC = ' + W.I18N.money(r.rate));
    d.kv(W.t('receipt.method'), methodLabel(r.method));
    if (r.txid) d.kv(W.t('receipt.txid'), r.txid);
    if (r.txid && r.method.indexOf('card') !== 0) d.kv(W.t('receipt.explorer'), cfg.explorerBase + r.txid);
    if (r.paymentHash) d.kv(W.t('receipt.lightningPayment'), r.paymentHash);
    d.kv(W.t('receipt.confirmations'), String(r.confirmations || 0));
    d.rule();
    d.kv(W.t('receipt.business'), cfg.business.name + ', ' + cfg.business.address);
    d.kv(W.t('receipt.businessEmail'), cfg.business.email + ' · ' + cfg.business.phone);
    d.heading(W.t('receipt.refundRef'), { size: 12, before: 8 });
    d.paragraph(W.t('receipt.refundRefBody'), { size: 9.5 });
    d.paragraph(W.t('legal.disclaimer'), { size: 8.5, color: [0.35, 0.44, 0.5] });
    d.paragraph(W.t('legal.reviewedBy'), { size: 8.5, color: [0.35, 0.44, 0.5] });
    d.saveAs('gotax-receipt-' + r.id + '.pdf');
    App.audit('receipt.export.pdf', r.id, 'downloaded');
  };
})();
