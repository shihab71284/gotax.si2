/* GoTax.SI — pricing page renderer (reads data/services.json) */
(function () {
  'use strict';
  var W = window;
  if (!W.App) return;
  var services = null;

  fetch(App.url('data/services.json')).then(function (r) { return r.json(); }).then(function (d) {
    services = d;
    render();
    W.I18N.onChange(render);
  }).catch(function () {
    var host = document.querySelector('#pricing-groups');
    if (host) host.innerHTML = '<p class="muted">Pricing could not be loaded.</p>';
  });

  function render() {
    renderGroups();
    renderFaq();
    renderRate();
  }

  function unitKey(u) {
    return ({ month: 'pricing.perMonth', letter: 'pricing.perLetter', review: 'pricing.perReview', notice: 'pricing.perNotice', return: 'pricing.perReturn' })[u] || 'pricing.perNotice';
  }

  function renderGroups() {
    var host = document.querySelector('#pricing-groups');
    if (!host || !services) return;
    var crypto = services.crypto || {};
    host.innerHTML = (services.groups || []).map(function (g) {
      return '<section class="section-tight" id="' + App.escapeHtml(g.id) + '">' +
        (g.titleKey ? '<h2>' + App.escapeHtml(W.t(g.titleKey)) + '</h2>' : '<h2 data-i18n="pricing.title">Pricing</h2>') +
        (g.subKey ? '<p class="lead" data-i18n="' + g.subKey + '">' + App.escapeHtml(W.t(g.subKey)) + '</p>' : '') +
        '<div class="price-grid">' + (g.items || []).map(card).join('') + '</div>' +
        (g.id === 'notices' ? '<p class="tiny muted mt4">' + App.escapeHtml(W.t('pricing.noticeFootnote')) + '</p>' : '') +
        '</section>';
    }).join('') +
      '<p class="tiny muted mt4">' + App.escapeHtml(W.t('pricing.processorNote', {
        processor: crypto.processor || 'BTCPay Server', networks: (crypto.networks || []).join(' + '),
        minutes: crypto.invoiceExpiryMinutes || 15, confirmations: crypto.requiredConfirmations || 2
      })) + '</p>';
    W.I18N.apply(host);
  }

  function card(it) {
    var conv = API.usdToBtc(it.usd);
    var buy = 'checkout.html?service=' + encodeURIComponent(it.id);
    return '<article class="price-card' + (it.popular ? ' featured' : '') + '" id="plan-' + App.escapeHtml(it.id) + '">' +
      (it.popular ? '<span class="pc-badge">' + App.escapeHtml(W.t('pricing.badgeFeatured')) + '</span>' : '') +
      (it.addon ? '<span class="pc-addon">' + App.escapeHtml(W.t('pricing.addon')) + '</span>' : '') +
      '<h3 data-i18n="' + it.i18nKey + '">' + App.escapeHtml(W.t(it.i18nKey)) + '</h3>' +
      '<p class="pc-desc small muted" data-i18n="' + it.descKey + '">' + App.escapeHtml(W.t(it.descKey)) + '</p>' +
      '<div class="price-amount">' + W.I18N.money(it.usd) +
      '<span class="price-unit" data-i18n="' + unitKey(it.unit) + '">' + App.escapeHtml(W.t(unitKey(it.unit))) + '</span></div>' +
      '<div class="price-btc" title="' + App.escapeHtml(W.t('checkout.rate') + ': 1 BTC = ' + W.I18N.money(conv.rate)) + '">' +
      App.icons.btc + ' ' + W.I18N.btc(conv.btc) + '</div>' +
      '<ul class="pc-feats">' + (it.features || []).map(function (f) {
        return '<li>' + App.icons.check + '<span data-i18n="' + f + '">' + App.escapeHtml(W.t(f)) + '</span></li>';
      }).join('') + '</ul>' +
      (it.entitlement && API.hasEntitlement(it.entitlement)
        ? '<span class="pill pill-ok pc-owned">' + App.icons.checkCircle + ' ' + App.escapeHtml(W.t('common.unlock')) + '</span>'
        : '<a class="btn ' + (it.popular ? 'btn-primary' : 'btn-outline') + ' btn-block" href="' + buy + '">' +
          App.icons.btc + '<span data-i18n="cta.payNow">' + App.escapeHtml(W.t('cta.payNow')) + '</span></a>') +
      (it.id === 'monthly-plan' ? '<p class="tiny muted mt2" data-i18n="pricing.planCancel">' + App.escapeHtml(W.t('pricing.planCancel')) + '</p>' : '') +
      (it.human ? '<p class="tiny muted mt2">' + App.icons.user + ' ' + App.escapeHtml(W.t('legal.reviewedBy')) + '</p>' : '') +
      '</article>';
  }

  function renderFaq() {
    var host = document.querySelector('#faq-list');
    if (!host || !services || !services.faq) return;
    host.innerHTML = services.faq.map(function (k, i) {
      return '<details class="faq-item"' + (i === 0 ? ' open' : '') + '><summary><span data-i18n="' + k + '">' + App.escapeHtml(W.t(k)) + '</span>' +
        '<span class="faq-ico" aria-hidden="true">' + App.icons.plus + '</span></summary>' +
        '<div class="faq-body"><p data-i18n="' + k.replace('.q', '.a') + '">' + App.escapeHtml(W.t(k.replace('.q', '.a'))) + '</p></div></details>';
    }).join('');
    W.I18N.apply(host);
  }

  function renderRate() {
    var el = document.querySelector('#rate-display');
    if (el) el.textContent = '1 BTC = ' + W.I18N.money(API.rate()) + ' · ' + (API.config().rateSource || '');
  }
})();
