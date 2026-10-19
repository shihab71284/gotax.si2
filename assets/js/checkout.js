/* ============================================================
   GoTax.SI — Checkout (Bitcoin on-chain + Lightning, optional card)
   ------------------------------------------------------------
   Invoice lifecycle: waiting -> detected -> confirmed
   Exceptions: underpaid / overpaid / expired, each with recovery
   instructions and a support path. Production swaps API.* for
   BTCPay Server webhook-driven state.
   ============================================================ */
(function () {
  'use strict';
  var W = window;
  if (!W.App) return;

  var SERVICES = null;
  var state = { cart: [], invoice: null, timer: null, method: 'btc-onchain' };

  fetch(App.url('data/services.json')).then(function (r) { return r.json(); }).then(function (data) {
    SERVICES = data;
    init();
  }).catch(init);

  function init() {
    loadCartFromUrl();
    if (!state.cart.length) { renderEmpty(); return; }
    bind();
    render();
    W.I18N.onChange(render);
  }

  /* ---------- cart ---------- */
  function serviceById(id) {
    var out = null;
    ((SERVICES && SERVICES.groups) || []).forEach(function (g) {
      (g.items || []).forEach(function (i) { if (i.id === id) out = i; });
    });
    return out;
  }
  function loadCartFromUrl() {
    var q = new URLSearchParams(location.search);
    var id = q.get('service');
    if (id) {
      var svc = serviceById(id) || { id: id, name: id, usd: defaultPrice(id), unit: '' };
      state.cart = [{ id: svc.id, label: svc.i18nKey ? W.t(svc.i18nKey) : svc.name, usd: svc.usd, qty: 1 }];
      App.Store.set('cart', state.cart);
      return;
    }
    var stored = App.Store.get('cart', []);
    state.cart = Array.isArray(stored) && stored.length ? stored : [];
  }
  function defaultPrice(id) {
    return ({ 'notice-explain': 19, 'draft-letter': 29, 'human-review': 49, 'monthly-plan': 39 })[id] || 19;
  }
  function cartTotal() {
    return state.cart.reduce(function (s, l) { return s + (l.usd || 0) * (l.qty || 1); }, 0);
  }

  function renderEmpty() {
    var host = document.querySelector('#checkout-root');
    if (host) {
      host.innerHTML = '<div class="card card-pad center"><h2>' + App.escapeHtml(W.t('checkout.title')) + '</h2>' +
        '<p class="muted">' + App.escapeHtml(W.t('checkout.empty')) + '</p>' +
        '<a class="btn btn-primary" href="pricing.html">' + App.escapeHtml(W.t('checkout.browse')) + '</a></div>';
      W.I18N.apply(host);
    }
  }

  /* ---------- render ---------- */
  function render() {
    var total = cartTotal();
    var conv = API.usdToBtc(total);
    var sum = document.querySelector('#order-summary');
    if (sum) {
      sum.innerHTML =
        '<h3>' + App.escapeHtml(W.t('checkout.orderSummary')) + '</h3>' +
        state.cart.map(function (l) {
          return '<div class="pay-line"><span class="k">' + App.escapeHtml(l.label) + (l.qty > 1 ? ' × ' + l.qty : '') + '</span>' +
            '<span class="v">' + W.I18N.money(l.usd * (l.qty || 1)) + '</span></div>';
        }).join('') +
        '<div class="pay-line pay-total"><span class="k">' + App.escapeHtml(W.t('checkout.usdPrice')) + '</span><span class="v">' + W.I18N.money(total) + '</span></div>' +
        '<div class="pay-line"><span class="k">' + App.escapeHtml(W.t('checkout.btcAmount')) + '</span><span class="v">' + W.I18N.btc(conv.btc) + '</span></div>' +
        '<div class="pay-line"><span class="k">' + App.escapeHtml(W.t('checkout.rate')) + '</span><span class="v">1 BTC = ' + W.I18N.money(conv.rate) + '</span></div>' +
        '<p class="tiny muted mt4" style="color:#a9c6d0">' + App.escapeHtml(W.t('checkout.bitcoinDesc')) + '</p>';
    }

    var rate = document.querySelector('#rate-display');
    if (rate) rate.textContent = '1 BTC = ' + W.I18N.money(conv.rate) + ' · ' + (API.config().rateSource || '');

    var payBtn = document.querySelector('#pay-now');
    if (payBtn && !state.invoice) {
      payBtn.innerHTML = App.icons.btc + '<span>' + App.escapeHtml(W.t('cta.payNow') + ' — ' + W.I18N.btc(conv.btc)) + '</span>';
    }
    var cardBtn = document.querySelector('#pay-card');
    if (cardBtn && !state.invoice) cardBtn.innerHTML = App.icons.card + '<span>' + App.escapeHtml(W.t('cta.payWithCard') + ' — ' + W.I18N.money(total)) + '</span>';

    if (state.invoice) renderInvoice();
    W.I18N.apply(document);
  }

  function bind() {
    document.querySelectorAll('input[name="pay-method"]').forEach(function (r) {
      r.addEventListener('change', function () {
        state.method = r.value;
        var cardHint = document.querySelector('#card-hint');
        if (cardHint) cardHint.hidden = r.value !== 'card';
      });
    });
    var pay = document.querySelector('#pay-now');
    if (pay) pay.addEventListener('click', function () { createInvoice(state.method === 'card' ? 'btc-onchain' : state.method); });
    var card = document.querySelector('#pay-card');
    if (card) card.addEventListener('click', function () { payByCard(); });
    var again = document.querySelector('#new-invoice');
    if (again) again.addEventListener('click', function () {
      state.invoice = null; clearInterval(state.timer);
      document.querySelector('#invoice-panel').hidden = true;
      document.querySelector('#method-panel').hidden = false;
      render();
    });
  }

  function createInvoice(method) {
    var total = cartTotal();
    var user = API.user() || {};
    var nameEl = document.querySelector('#cust-name'), emailEl = document.querySelector('#cust-email');
    var inv = API.createInvoice({
      usd: total, method: method, serviceId: state.cart.map(function (l) { return l.id; }).join('+'),
      serviceLabel: state.cart.map(function (l) { return l.label; }).join(', '),
      name: (nameEl && nameEl.value.trim()) || user.name || 'Customer',
      email: (emailEl && emailEl.value.trim()) || user.email || '',
      locale: W.I18N.current
    });
    state.invoice = inv;
    document.querySelector('#method-panel').hidden = true;
    document.querySelector('#invoice-panel').hidden = false;
    renderInvoice();
    App.track('checkout.invoice.created', { method: method, usd: total });
    document.querySelector('#invoice-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderInvoice() {
    var inv = state.invoice;
    var panel = document.querySelector('#invoice-panel');
    if (!inv || !panel) return;
    var isLn = inv.method === 'btc-lightning';
    var payload = isLn ? inv.bolt11 : inv.uri;
    var cfg = API.config();

    panel.querySelector('#inv-id').textContent = inv.id;
    panel.querySelector('#inv-usd').textContent = W.I18N.money(inv.usd);
    panel.querySelector('#inv-btc').textContent = W.I18N.btc(inv.btc);
    panel.querySelector('#inv-rate').textContent = '1 BTC = ' + W.I18N.money(inv.rate);
    panel.querySelector('#inv-conf').textContent = inv.confirmations + ' / ' + inv.requiredConfirmations;

    var addr = panel.querySelector('#inv-address');
    if (addr) {
      addr.textContent = isLn ? inv.bolt11 : inv.address;
      addr.title = isLn ? W.t('checkout.bolt11') : W.t('checkout.orSend');
    }
    var labelAddr = panel.querySelector('#inv-address-label');
    if (labelAddr) labelAddr.textContent = isLn ? W.t('checkout.bolt11') : W.t('checkout.orSend');

    var canvas = panel.querySelector('#qr');
    if (canvas) {
      try { QR.toCanvas(canvas, payload, { scale: 5 }); } catch (e) { console.warn('QR failed', e); }
    }
    var copyAddr = panel.querySelector('#copy-address');
    if (copyAddr) copyAddr.onclick = function () { copy(isLn ? inv.bolt11 : inv.address, W.t('cta.copied')); };
    var copyInv = panel.querySelector('#copy-invoice');
    if (copyInv) copyInv.onclick = function () { copy(inv.id, W.t('cta.copied')); };

    updateStatusUi();
    startTimer();
    W.I18N.apply(panel);
  }

  function copy(text, msg) {
    var done = function () { App.toast(msg || W.t('cta.copied'), 'ok', 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  /* ---------- countdown ---------- */
  function startTimer() {
    clearInterval(state.timer);
    var el = document.querySelector('#countdown');
    var tick = function () {
      var inv = state.invoice;
      if (!inv) return;
      var left = new Date(inv.expiresAt).getTime() - Date.now();
      if (inv.status === 'confirmed' || inv.status === 'refunded') { el.textContent = '—'; return; }
      if (left <= 0) {
        el.textContent = '00:00';
        el.classList.add('urgent');
        if (inv.status === 'waiting') API.setInvoiceStatus(inv.id, 'expired');
        state.invoice = API.invoice(inv.id);
        updateStatusUi();
        clearInterval(state.timer);
        return;
      }
      var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      el.classList.toggle('urgent', left < 120000);
    };
    tick();
    state.timer = setInterval(tick, 1000);
  }

  function updateStatusUi() {
    var inv = state.invoice;
    var panel = document.querySelector('#invoice-panel');
    if (!inv || !panel) return;
    var rows = panel.querySelectorAll('[data-status-row]');
    var order = ['waiting', 'detected', 'confirmed'];
    var idx = order.indexOf(inv.status);
    rows.forEach(function (r) {
      var s = r.dataset.statusRow;
      var i = order.indexOf(s);
      r.classList.remove('active', 'done');
      if (inv.status === 'confirmed') r.classList.add('done');
      else if (idx >= 0 && i < idx) r.classList.add('done');
      else if (i === idx) r.classList.add('active');
    });
    var pill = panel.querySelector('#status-pill');
    var map = {
      waiting: ['pill-warn', W.t('checkout.statusWaiting')],
      detected: ['pill-info', W.t('checkout.statusDetected')],
      confirmed: ['pill-ok', W.t('checkout.statusConfirmed')],
      expired: ['pill-muted', W.t('checkout.statusExpired')],
      underpaid: ['pill-danger', W.t('checkout.statusUnderpaid')],
      overpaid: ['pill-warn', W.t('checkout.statusOverpaid')],
      refunded: ['pill-info', W.t('admin.refunded')]
    };
    var m = map[inv.status] || map.waiting;
    pill.className = 'pill ' + m[0];
    pill.textContent = m[1];
    panel.querySelector('#inv-conf').textContent = inv.confirmations + ' / ' + inv.requiredConfirmations;

    /* exception banners */
    var ex = panel.querySelector('#exception');
    ex.hidden = ['waiting', 'detected', 'confirmed'].indexOf(inv.status) >= 0;
    if (!ex.hidden) {
      var body = inv.status === 'underpaid' ? W.t('checkout.underpaidBody', { amount: W.I18N.money(Math.max(0, inv.usd - (inv.paidUsd || 0))) })
        : inv.status === 'overpaid' ? W.t('checkout.overpaidBody', { amount: W.I18N.money(Math.max(0, (inv.paidUsd || 0) - inv.usd)) })
        : W.t('checkout.expiredBody');
      ex.className = 'banner ' + (inv.status === 'underpaid' ? 'banner-danger' : 'banner-warn');
      ex.innerHTML = '<span>' + App.icons.alert + '</span><div><h4>' + App.escapeHtml(m[1]) + '</h4><p>' + App.escapeHtml(body) + '</p>' +
        '<div class="btn-row"><button class="btn btn-sm btn-outline" data-newinv>' + App.escapeHtml(W.t('checkout.newInvoice')) + '</button>' +
        '<a class="btn btn-sm btn-primary" href="contact.html?invoice=' + encodeURIComponent(inv.id) + '">' + App.escapeHtml(W.t('checkout.needHelp')) + '</a></div></div>';
      ex.querySelector('[data-newinv]').onclick = function () { document.querySelector('#new-invoice').click(); };
    }

    /* success */
    var ok = panel.querySelector('#success');
    ok.hidden = inv.status !== 'confirmed';
    if (inv.status === 'confirmed') {
      var receipt = App.Store.list('receipts').filter(function (r) { return r.invoiceId === inv.id; })[0];
      if (receipt) {
        ok.innerHTML = '<span>' + App.icons.checkCircle + '</span><div><h4>' + App.escapeHtml(W.t('checkout.thanks')) + '</h4>' +
          '<p>' + App.escapeHtml(W.t('checkout.receiptSent')) + '</p>' +
          '<div class="btn-row"><a class="btn btn-sm btn-primary" href="receipts.html?id=' + encodeURIComponent(receipt.id) + '">' +
          App.escapeHtml(W.t('cta.viewReceipt')) + '</a>' +
          '<button class="btn btn-sm btn-outline" data-receipt-pdf>' + App.escapeHtml(W.t('cta.downloadPdf')) + '</button>' +
          '<a class="btn btn-sm btn-ghost" href="account.html">' + App.escapeHtml(W.t('cta.goToDashboard')) + '</a></div></div>';
        ok.querySelector('[data-receipt-pdf]').onclick = function () { if (W.Receipts) W.Receipts.downloadPdf(receipt); };
      }
      clearInterval(state.timer);
    }
    /* demo simulation buttons */
    var sims = panel.querySelectorAll('[data-sim]');
    sims.forEach(function (b) { b.hidden = inv.status === 'confirmed' || inv.status === 'expired'; });
  }

  /* ---------- demo payment simulation ---------- */
  W.addEventListener('DOMContentLoaded', function () {
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sim]');
      if (!b || !state.invoice) return;
      var inv = state.invoice;
      var kind = b.dataset.sim;
      if (kind === 'detected') {
        API.setInvoiceStatus(inv.id, 'detected', { txid: App.hex(32), confirmations: 0, paidUsd: inv.usd });
      } else if (kind === 'confirmed') {
        API.setInvoiceStatus(inv.id, 'detected', { txid: inv.txid || App.hex(32), confirmations: 0, paidUsd: inv.usd });
        API.setInvoiceStatus(inv.id, 'confirmed', { confirmations: inv.requiredConfirmations || API.config().requiredConfirmations, paidUsd: inv.usd, txid: inv.txid || App.hex(32) });
      } else if (kind === 'underpaid') {
        API.setInvoiceStatus(inv.id, 'underpaid', { txid: App.hex(32), paidUsd: Math.round(inv.usd * 0.6 * 100) / 100 });
      } else if (kind === 'expired') {
        API.setInvoiceStatus(inv.id, 'expired');
      }
      state.invoice = API.invoice(inv.id);
      updateStatusUi();
      render();
    });
  });

  function payByCard() {
    var total = cartTotal();
    var nameEl = document.querySelector('#cust-name'), emailEl = document.querySelector('#cust-email');
    App.modal({
      title: W.t('checkout.card'),
      bodyHtml:
        '<p class="small muted">' + App.escapeHtml(W.t('checkout.cardDesc')) + '</p>' +
        '<div class="field"><label for="card-num">Card number</label><input class="input mono" id="card-num" inputmode="numeric" placeholder="4242 4242 4242 4242" autocomplete="cc-number"></div>' +
        '<div class="field-row"><div class="field"><label for="card-exp">Expiry</label><input class="input mono" id="card-exp" placeholder="12/28" autocomplete="cc-exp"></div>' +
        '<div class="field"><label for="card-cvc">CVC</label><input class="input mono" id="card-cvc" placeholder="123" autocomplete="cc-csc"></div></div>' +
        '<p class="tiny muted">' + App.escapeHtml('Demo only — never enter a real card number here. Production uses a hosted PCI-compliant form; card data never touches this server.') + '</p>',
      actionsHtml: '<button class="btn btn-outline" data-close>' + App.escapeHtml(W.t('cta.cancel')) + '</button>' +
        '<button class="btn btn-primary" data-pay>' + App.escapeHtml(W.t('cta.payNow') + ' — ' + W.I18N.money(total)) + '</button>',
      onMount: function (m) {
        m.querySelector('[data-pay]').addEventListener('click', function () {
          var num = m.querySelector('#card-num').value.replace(/\s/g, '');
          if (num.length < 12) { App.toast(W.t('common.error'), 'warn'); return; }
          var inv = API.createInvoice({
            usd: total, method: 'card', serviceId: state.cart.map(function (l) { return l.id; }).join('+'),
            serviceLabel: state.cart.map(function (l) { return l.label; }).join(', '),
            name: (nameEl && nameEl.value.trim()) || (API.user() || {}).name || 'Customer',
            email: (emailEl && emailEl.value.trim()) || (API.user() || {}).email || '',
            locale: W.I18N.current
          });
          state.invoice = inv;
          App.closeModal();
          document.querySelector('#method-panel').hidden = true;
          document.querySelector('#invoice-panel').hidden = false;
          API.setInvoiceStatus(inv.id, 'confirmed', { confirmations: 0, paidUsd: total, txid: 'card_' + App.hex(12) });
          state.invoice = API.invoice(inv.id);
          renderInvoice();
          updateStatusUi();
          App.toast(W.t('checkout.paid'), 'ok');
        });
      }
    });
  }

})();
