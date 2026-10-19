/* GoTax.SI — home page: notice library preview, pricing summary, FAQ */
(function () {
  'use strict';
  var W = window;
  if (!W.App) return;
  function riskKey(risk) {
    return 'notices.risk' + ({ high: 'High', medium: 'Med', low: 'Low' }[risk] || 'Med');
  }

  var notices = [], services = null;

  Promise.all([
    fetch(App.url('data/notices.json')).then(function (r) { return r.json(); }).catch(function () { return { notices: [] }; }),
    fetch(App.url('data/services.json')).then(function (r) { return r.json(); }).catch(function () { return null; })
  ]).then(function (res) {
    notices = (res[0] && res[0].notices) || [];
    services = res[1];
    if (W.Decode) W.Decode.setCatalog(notices);
    renderAll();
    W.I18N.onChange(renderAll);
  });

  function renderAll() {
    renderNotices();
    renderPricing();
    renderFaq();
    renderRate();
  }

  function slug(code) { return String(code).toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  function renderNotices() {
    var host = document.querySelector('#notice-grid');
    if (!host) return;
    var order = ['CP2000', 'CP14', 'CP501', 'CP504', 'LTR3219C', 'LTR5071C'];
    var list = order.map(function (c) {
      return notices.filter(function (n) { return n.code === c; })[0];
    }).filter(Boolean);
    if (!list.length) list = notices.slice(0, 6);
    host.innerHTML = list.map(function (n) {
      var summary = (n.summary && (n.summary[W.I18N.current] || n.summary.en)) || '';
      var riskCls = n.risk === 'high' ? 'pill-danger' : n.risk === 'medium' ? 'pill-warn' : 'pill-ok';
      return '<article class="notice-card card">' +
        '<div class="nc-head"><span class="nc-code mono">' + App.escapeHtml(n.code) + '</span>' +
        '<span class="pill ' + riskCls + '">' + App.escapeHtml(W.t(riskKey(n.risk))) + '</span></div>' +
        '<h3 class="nc-title">' + App.escapeHtml(n.title) + '</h3>' +
        '<p class="nc-sum small">' + App.escapeHtml(summary) + '</p>' +
        '<p class="nc-deadline tiny muted">' + App.icons.clock + ' ' + App.escapeHtml(W.t('notices.deadlineTypical') + ': ' + (n.typicalDeadline || '—')) + '</p>' +
        '<div class="nc-actions"><a class="btn btn-sm btn-outline" href="notices/' + slug(n.code) + '.html">' + App.icons.doc + '<span>' + App.escapeHtml(W.t('cta.learnMore')) + '</span></a>' +
        '<a class="btn btn-sm btn-primary" href="decoder.html?code=' + encodeURIComponent(n.code) + '">' + App.icons.scan + '<span>' + App.escapeHtml(W.t('notices.decodeYours')) + '</span></a></div>' +
        '</article>';
    }).join('');
    W.I18N.apply(host);
  }

  function renderPricing() {
    var host = document.querySelector('#price-summary');
    if (!host || !services) return;
    var group = (services.groups || []).filter(function (g) { return g.id === 'notices'; })[0] || { items: [] };
    host.innerHTML = group.items.map(function (it) {
      var conv = API.usdToBtc(it.usd);
      return '<article class="price-card' + (it.popular ? ' featured' : '') + '">' +
        (it.popular ? '<span class="pc-badge">' + App.escapeHtml(W.t('pricing.badgeFeatured')) + '</span>' : '') +
        '<h3>' + App.escapeHtml(W.t(it.i18nKey)) + '</h3>' +
        '<p class="pc-desc small muted">' + App.escapeHtml(W.t(it.descKey)) + '</p>' +
        '<div class="price-amount">' + W.I18N.money(it.usd) + '<span class="price-unit">' + App.escapeHtml(W.t(it.unit === 'month' ? 'pricing.perMonth' : it.unit === 'letter' ? 'pricing.perLetter' : it.unit === 'review' ? 'pricing.perReview' : 'pricing.perNotice')) + '</span></div>' +
        '<div class="price-btc">' + App.icons.btc + ' ' + W.I18N.btc(conv.btc) + '</div>' +
        '<ul class="pc-feats">' + (it.features || []).map(function (f) { return '<li>' + App.icons.check + '<span>' + App.escapeHtml(W.t(f)) + '</span></li>'; }).join('') + '</ul>' +
        '<a class="btn ' + (it.popular ? 'btn-primary' : 'btn-outline') + ' btn-block" href="checkout.html?service=' + encodeURIComponent(it.id) + '">' +
        App.icons.btc + '<span>' + App.escapeHtml(W.t('cta.payNow')) + '</span></a>' +
        '</article>';
    }).join('');
    W.I18N.apply(host);
  }

  function renderFaq() {
    var host = document.querySelector('#faq-list');
    if (!host || !services || !services.faq) return;
    host.innerHTML = services.faq.map(function (k, i) {
      var ak = k.replace('.q', '.a');
      return '<details class="faq-item"' + (i === 0 ? ' open' : '') + '>' +
        '<summary><span>' + App.escapeHtml(W.t(k)) + '</span><span class="faq-ico" aria-hidden="true">' + App.icons.plus + '</span></summary>' +
        '<div class="faq-body"><p>' + App.escapeHtml(W.t(ak)) + '</p></div></details>';
    }).join('');
    W.I18N.apply(host);
  }

  function renderRate() {
    var el = document.querySelector('#rate-display');
    if (el) el.textContent = '1 BTC = ' + W.I18N.money(API.rate());
  }
})();
