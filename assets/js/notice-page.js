/* GoTax.SI — per-notice SEO page: fills the "your language" pane from
   data/notices.json. The English pane is server-rendered into the HTML so
   crawlers and no-JS visitors see the full guide. */
(function () {
  'use strict';
  var W = window;
  if (!W.App) return;

  var notices = [];
  var code = '';

  function init() {
    var host = document.querySelector('[data-notice-code]');
    code = host ? host.dataset.noticeCode : '';
    fetch(App.url('data/notices.json')).then(function (r) { return r.json(); }).then(function (d) {
      notices = d.notices || [];
      if (W.Decode) W.Decode.setCatalog(notices);
      render();
      W.I18N.onChange(render);
    }).catch(function () {
      var note = document.querySelector('#pane-loc-note');
      if (note) note.textContent = W.t('common.error');
    });
  }

  function current() {
    return notices.filter(function (n) { return n.code === code; })[0] || null;
  }

  function render() {
    var n = current();
    var wrap = document.querySelector('#notice-bilingual');
    var locPane = document.querySelector('#pane-loc');
    var body = document.querySelector('#pane-loc-body');
    var label = document.querySelector('#pane-loc-label');
    var note = document.querySelector('#pane-loc-note');
    if (!wrap || !locPane || !body || !n) return;

    var loc = W.I18N.current;
    var meta = W.I18N.meta(loc);
    if (label) label.textContent = meta.native + (meta.english && meta.english !== meta.native ? ' · ' + meta.english : '');

    if (loc === 'en') {
      locPane.hidden = true;
      wrap.classList.add('single');
      return;
    }
    locPane.hidden = false;
    wrap.classList.remove('single');

    var secs = (n.sections && n.sections[loc]) || null;
    if (!secs) {
      body.innerHTML = '<p class="small">' + App.escapeHtml(W.t('decoder.noTranslation')) + '</p>' +
        '<p class="small muted">' + App.escapeHtml(W.t('notices.helpTranslate')) + '</p>' +
        '<a class="btn btn-sm btn-outline mt2" href="' + App.escapeHtml(App.base() + 'contact.html?notice=' + code) + '">' +
        App.escapeHtml(W.t('contact.title')) + '</a>';
      if (note) { note.textContent = W.t('lang.englishAuthoritative'); note.hidden = false; }
      W.I18N.apply(body);
      return;
    }

    var out = [];
    var summary = (n.summary && (n.summary[loc] || n.summary.en)) || '';
    if (summary) out.push('<p class="lead">' + App.escapeHtml(summary) + '</p>');
    for (var i = 1; i <= 7; i++) {
      var sec = secs['sec' + i];
      if (!sec) continue;
      out.push('<h4>' + App.escapeHtml(W.t('decoder.sec' + i)) + '</h4>');
      (sec.p || []).forEach(function (p) { out.push('<p>' + App.escapeHtml(p) + '</p>'); });
      if (sec.b && sec.b.length) {
        out.push('<ul>' + sec.b.map(function (b) { return '<li>' + App.escapeHtml(b) + '</li>'; }).join('') + '</ul>');
      }
    }
    body.innerHTML = out.join('');
    if (note) { note.textContent = W.t('lang.mtNote'); note.hidden = false; }
    W.I18N.apply(body);
  }

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
