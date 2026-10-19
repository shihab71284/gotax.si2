/* GoTax.SI — notice library index: searchable, risk-filtered list */
(function () {
  'use strict';
  var W = window;
  if (!W.App) return;
  function riskKey(risk) {
    return 'notices.risk' + ({ high: 'High', medium: 'Med', low: 'Low' }[risk] || 'Med');
  }

  var notices = [];
  var q = '';
  var risk = 'all';

  fetch(App.url('data/notices.json')).then(function (r) { return r.json(); }).then(function (d) {
    notices = d.notices || [];
    if (W.Decode) W.Decode.setCatalog(notices);
    render();
    W.I18N.onChange(render);
  }).catch(function () {
    var h = document.querySelector('#notice-all');
    if (h) h.innerHTML = '<p class="muted">The notice library could not be loaded.</p>';
  });

  function slug(code) { return String(code).toLowerCase().replace(/[^a-z0-9]+/g, ''); }

  function bind() {
    var s = document.querySelector('#notice-search');
    if (s) s.addEventListener('input', function () { q = s.value.toLowerCase().trim(); render(); });
    document.querySelectorAll('.chip-filter').forEach(function (b) {
      b.addEventListener('click', function () {
        risk = b.dataset.risk;
        document.querySelectorAll('.chip-filter').forEach(function (x) {
          x.classList.toggle('btn-outline', x === b);
          x.classList.toggle('btn-ghost', x !== b);
        });
        render();
      });
    });
  }

  function matches(n) {
    if (risk !== 'all' && n.risk !== risk) return false;
    if (!q) return true;
    var hay = [n.code, n.title, (n.aliases || []).join(' '), (n.riskTags || []).join(' '),
      ((n.summary && (n.summary[W.I18N.current] || n.summary.en)) || ''),
      (n.sections && n.sections[W.I18N.current] && n.sections[W.I18N.current].sec1 && n.sections[W.I18N.current].sec1.p || []).join(' ')
    ].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function render() {
    var host = document.querySelector('#notice-all');
    var none = document.querySelector('#notice-none');
    if (!host) return;
    var order = { high: 0, medium: 1, low: 2 };
    var list = notices.filter(matches).sort(function (a, b) { return (order[a.risk] || 3) - (order[b.risk] || 3); });
    if (none) none.hidden = list.length > 0;
    host.innerHTML = list.map(function (n) {
      var riskCls = n.risk === 'high' ? 'pill-danger' : n.risk === 'medium' ? 'pill-warn' : 'pill-ok';
      var summary = (n.summary && (n.summary[W.I18N.current] || n.summary.en)) || '';
      return '<article class="notice-row card">' +
        '<div class="nr-main">' +
        '<div class="nr-top"><span class="nr-code mono">' + App.escapeHtml(n.code) + '</span>' +
        (n.aliases && n.aliases.length ? '<span class="tiny muted">aka ' + App.escapeHtml(n.aliases.join(', ')) + '</span>' : '') +
        '<span class="pill ' + riskCls + '">' + App.escapeHtml(W.t(riskKey(n.risk))) + '</span></div>' +
        '<h2 class="nr-title">' + App.escapeHtml(n.title) + '</h2>' +
        '<p class="nr-sum small">' + App.escapeHtml(summary) + '</p>' +
        '<p class="nr-meta tiny muted">' + App.icons.clock + ' ' + App.escapeHtml(W.t('notices.deadlineTypical') + ': ' + (n.typicalDeadline || '—')) +
        (n.riskTags && n.riskTags.length ? ' · ' + App.icons.alert + ' ' + App.escapeHtml(n.riskTags.map(function (t) { return W.t('risk.' + t) || t; }).join(', ')) : '') + '</p>' +
        '</div>' +
        '<div class="nr-actions">' +
        '<a class="btn btn-sm btn-outline" href="' + slug(n.code) + '.html">' + App.icons.doc + '<span>' + App.escapeHtml(W.t('cta.learnMore')) + '</span></a>' +
        '<a class="btn btn-sm btn-primary" href="../decoder.html?code=' + encodeURIComponent(n.code) + '">' + App.icons.scan + '<span>' + App.escapeHtml(W.t('notices.decodeYours')) + '</span></a>' +
        '</div></article>';
    }).join('');
    W.I18N.apply(host);
  }

  document.addEventListener('DOMContentLoaded', bind);
  if (document.readyState !== 'loading') bind();
})();
