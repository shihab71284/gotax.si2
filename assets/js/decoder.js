/* ============================================================
   GoTax.SI — Notice Decoder page controller
   Flow: input -> ingest/OCR -> redaction review -> analysis
         -> bilingual explanation -> add-ons / export
   ============================================================ */
(function () {
  'use strict';
  var W = window;
  if (!W.App) return;
  var D = W.Decode;
  var state = {
    step: 'input',          /* input | redact | running | result */
    file: null,
    ocr: null,
    redaction: null,
    analysis: null,
    explanation: null,
    consentAt: null
  };

  /* ---------- boot ---------- */
  Promise.all([
    fetch(App.url('data/notices.json')).then(function (r) { return r.json(); }).catch(function () { return { notices: [] }; }),
    new Promise(function (res) {
      if (W.NOTICE_SAMPLES && Object.keys(W.NOTICE_SAMPLES).length) { res(); return; }
      var s = document.createElement('script');
      s.src = (W.App && App.url ? App.url('data/samples.js') : 'data/samples.js'); s.onload = res; s.onerror = res;
      document.head.appendChild(s);
    })
  ]).then(function (r) {
    D.setCatalog(r[0].notices || []);
    init();
  });

  function init() {
    bindTabs();
    bindInput();
    bindSamples();
    bindActions();
    W.I18N.onChange(render);
    var q = new URLSearchParams(location.search);
    if (q.get('sample') && D.samples()[q.get('sample')]) {
      selectTab('samples');
      runSample(q.get('sample'));
    } else if (q.get('code')) {
      var code = q.get('code').toUpperCase();
      if (D.samples()[code]) { selectTab('samples'); runSample(code); }
    }
  }

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  function bindTabs() {
    $$('#decoder-tabs button').forEach(function (b) {
      b.addEventListener('click', function () { selectTab(b.dataset.tab); });
    });
  }
  function selectTab(name) {
    $$('#decoder-tabs button').forEach(function (b) {
      var on = b.dataset.tab === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    $$('.decoder-tabpanel').forEach(function (p) { p.hidden = p.dataset.panel !== name; });
  }

  /* ---------- input ---------- */
  function bindInput() {
    var dz = $('#dropzone'), input = $('#file-input');
    if (!dz) return;
    dz.addEventListener('click', function () { input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setFile(f);
    });
    input.addEventListener('change', function () { if (input.files[0]) setFile(input.files[0]); });

    var paste = $('#paste-text');
    if (paste) {
      paste.addEventListener('input', function () { validateReady(); });
    }
    var consent = $('#consent');
    if (consent) consent.addEventListener('change', validateReady);
  }

  function setFile(f) {
    var v = App.validateFile(f);
    var msg = $('#file-msg');
    state.file = null;
    if (!v.ok) {
      var reason = v.reason === 'too-big' ? W.t('common.fileTooBig') : W.t('decoder.badFile');
      msg.className = 'err-msg'; msg.innerHTML = App.icons.alert + '<span>' + App.escapeHtml(reason) + '</span>';
      msg.hidden = false;
      App.audit('upload.rejected', f.name, v.reason);
      return;
    }
    msg.hidden = true;
    state.file = f;
    $('#file-chosen').innerHTML =
      '<span class="file-item"><span>' + App.icons.doc + '</span><span><span class="fi-name">' + App.escapeHtml(f.name) +
      '</span><span class="fi-meta">' + App.formatBytes(f.size) + ' · ' + App.escapeHtml(f.type || 'unknown') + '</span></span></span>';
    $('#file-chosen').hidden = false;
    validateReady();
  }

  function validateReady() {
    var consent = $('#consent');
    var hasInput = !!(state.file || ($('#paste-text') && $('#paste-text').value.trim().length > 20));
    var btn = $('#analyze-btn');
    if (btn) btn.disabled = !(hasInput && consent && consent.checked);
  }

  /* ---------- samples ---------- */
  function bindSamples() {
    var host = $('#sample-list');
    if (!host) return;
    var codes = Object.keys(D.samples()).filter(function (c) { return D.samples()[c].group !== 'return'; });
    host.innerHTML = codes.map(function (code) {
      var s = D.samples()[code];
      var n = D.byCode(code) || {};
      var risk = n.risk || 'low';
      var pill = risk === 'high' ? 'pill-danger' : (risk === 'medium' ? 'pill-warn' : 'pill-ok');
      return '<button type="button" class="sample-card" data-sample="' + App.escapeHtml(code) + '">' +
        '<span class="code">' + App.escapeHtml(code) + '</span>' +
        '<span class="ttl">' + App.escapeHtml(s.label || n.title || code) + '</span>' +
        '<span class="risk"><span class="pill ' + pill + '">' + App.escapeHtml(W.t('notices.risk' + (risk === 'high' ? 'High' : risk === 'medium' ? 'Med' : 'Low'))) + '</span>' +
        ' <span class="pill pill-muted">' + (s.pages || 1) + 'p</span></span></button>';
    }).join('');
    $$('#sample-list [data-sample]').forEach(function (b) {
      b.addEventListener('click', function () { runSample(b.dataset.sample); });
    });
  }
  function runSample(code) {
    var consent = $('#consent');
    if (consent && !consent.checked) {
      App.toast(W.t('decoder.consentRequired'), 'warn');
      consent.focus();
      return;
    }
    state.file = null; state.sampleCode = code;
    start({ sampleCode: code });
  }

  /* ---------- pipeline ---------- */
  function bindActions() {
    var a = $('#analyze-btn');
    if (a) a.addEventListener('click', function () {
      if (!App.rateLimit('analyze')) { App.toast(W.t('decoder.rateLimited'), 'warn'); return; }
      var consent = $('#consent');
      if (consent && !consent.checked) { App.toast(W.t('decoder.consentRequired'), 'warn'); return; }
      state.consentAt = new Date().toISOString();
      start({
        file: state.file,
        text: $('#paste-text') ? $('#paste-text').value : '',
        sampleCode: state.sampleCode
      });
    });
    var rc = $('#confirm-redaction');
    if (rc) rc.addEventListener('click', function () { proceedAfterRedaction(); });
    var re = $('#back-to-input');
    if (re) re.addEventListener('click', function () { reset(); });
    var so = $('#start-over');
    if (so) so.addEventListener('click', function () { reset(); });
    var pdf = $('#download-pdf');
    if (pdf) pdf.addEventListener('click', function () { exportPdf(); });
    var pr = $('#print-view');
    if (pr) pr.addEventListener('click', function () { W.print(); });
    var dl = $('#draft-letter');
    if (dl) dl.addEventListener('click', function () { addDraftLetter(); });
    var hr = $('#request-review');
    if (hr) hr.addEventListener('click', function () { requestReview(); });
    var sv = $('#save-dashboard');
    if (sv) sv.addEventListener('click', function () { saveToDashboard(); });
    var ot = $('#ocr-edit-toggle');
    if (ot) ot.addEventListener('click', function () {
      var ta = $('#ocr-edit');
      ta.hidden = !ta.hidden;
      if (!ta.hidden) { ta.value = state.ocr.clean; ta.focus(); }
    });
    var oe = $('#ocr-edit-apply');
    if (oe) oe.addEventListener('click', function () {
      var ta = $('#ocr-edit');
      state.ocr.clean = ta.value;
      state.ocr.edited = true;
      App.audit('ocr.corrected', 'decoder', 'user edited OCR text');
      ta.hidden = true;
      proceedAfterRedaction();
    });
  }

  function start(input) {
    state.step = 'running';
    render();
    var steps = ['scan', 'ocr'];
    runSteps(steps, function () {
      return D.ingest(input, function (key) { markStep(key, true); });
    }).then(function (ocr) {
      state.ocr = ocr;
      var red = D.redact(ocr.text);
      state.redaction = red;
      state.ocr.clean = red.clean;
      state.ocr.raw = red.clean;
      state.step = 'redact';
      render();
      var el = $('#redaction-panel');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (err) {
      console.error(err);
      state.step = 'input';
      render();
      App.toast(W.t('common.error'), 'err');
    });
  }

  function proceedAfterRedaction() {
    if (state.ocr.edited) {
      var red = D.redact(state.ocr.clean);
      state.ocr.clean = red.clean;
    }
    state.step = 'running';
    render();
    runSteps(['classify', 'explain', 'translate'], function () {
      return App.sleep(700).then(function () {
        var analysis = D.extract(state.ocr.clean, state.ocr.ocrConfidence);
        state.analysis = analysis;
        markStep('classify', true);
        var explanation = D.explain(analysis, W.I18N.current);
        state.explanation = explanation;
        markStep('explain', true);
        markStep('translate', true);
        return { analysis: analysis, explanation: explanation };
      });
    }).then(function () {
      state.step = 'result';
      render();
      var el = $('#result-panel');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      App.track('decode.complete', { code: state.analysis.noticeCode, level: state.analysis.level, risks: state.analysis.risks.length });
    });
  }

  function runSteps(keys, work) {
    keys.forEach(function (k) { markStep(k, false); });
    return work();
  }
  function markStep(key, done) {
    var el = document.querySelector('[data-step="' + key + '"]');
    if (!el) return;
    el.classList.toggle('done', !!done);
    var spin = el.querySelector('.spin');
    if (spin) spin.style.visibility = done ? 'hidden' : 'visible';
  }

  function reset() {
    state = { step: 'input', file: null, ocr: null, redaction: null, analysis: null, explanation: null, consentAt: state.consentAt };
    var ta = $('#paste-text'); if (ta) ta.value = '';
    var fc = $('#file-chosen'); if (fc) { fc.hidden = true; fc.innerHTML = ''; }
    var fi = $('#file-input'); if (fi) fi.value = '';
    render();
    W.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- render ---------- */
  function render() {
    var input = $('#input-panel'), redact = $('#redaction-panel'),
        running = $('#running-panel'), result = $('#result-panel');
    if (input) input.hidden = state.step !== 'input';
    if (redact) redact.hidden = state.step !== 'redact';
    if (running) running.hidden = state.step !== 'running';
    if (result) result.hidden = state.step !== 'result';
    W.I18N.apply(document);
    if (state.step === 'redact') renderRedaction();
    if (state.step === 'result') renderResult();
    validateReady();
    /* translate step label needs the current language name */
    var tr = document.querySelector('[data-step="translate"] .label');
    if (tr) tr.textContent = W.t('decoder.stepTranslate', { lang: W.I18N.name(W.I18N.current) });
  }

  function renderRedaction() {
    var red = state.redaction || { findings: [], count: 0, clean: '' };
    var host = $('#redaction-findings');
    var summary = $('#redaction-summary');
    if (summary) {
      summary.className = 'banner ' + (red.count ? 'banner-warn' : 'banner-info');
      summary.innerHTML = '<span>' + (red.count ? App.icons.shield : App.icons.info) + '</span><div><p>' +
        (red.count ? App.escapeHtml(W.t('decoder.found', { count: red.count })) : App.escapeHtml(W.t('decoder.noneFound'))) +
        '</p></div>';
    }
    if (!host) return;
    if (!red.count) {
      host.innerHTML = '<p class="muted small">' + App.escapeHtml(W.t('decoder.noneFound')) + '</p>';
    } else {
      /* The confirmation list never prints the raw number — only the masked
         form (last four digits kept so the visitor can verify it is theirs). */
      host.innerHTML = red.findings.map(function (f) {
        return '<div class="redact-line after"><span class="tag">' + App.escapeHtml(W.t(f.labelKey)) + '</span>' +
          '<span class="mono">' + App.escapeHtml(f.masked) + '</span>' +
          '<span class="tiny muted">' + App.escapeHtml(W.t('decoder.after')) + '</span></div>';
      }).join('');
    }
    var pre = $('#redaction-preview');
    if (pre) {
      var shown = red.clean.slice(0, 1400);
      pre.innerHTML = '<pre class="addr-box" style="white-space:pre-wrap;max-height:260px;overflow:auto">' +
        App.escapeHtml(shown) + (red.clean.length > shown.length ? '\n…' : '') + '</pre>' +
        '<p class="tiny muted">' + App.escapeHtml(W.t('decoder.pages', { count: state.ocr.pages || 1 })) +
        ' · ' + App.escapeHtml(W.t('decoder.confOcr')) + ': ' + Math.round((state.ocr.ocrConfidence || 0.9) * 100) + '%</p>';
    }
  }

  function renderResult() {
    var a = state.analysis, e = state.explanation;
    if (!a || !e) return;

    /* confidence */
    var conf = $('#confidence');
    if (conf) {
      var pct = Math.round(a.confidence.overall * 100);
      var col = a.level === 'high' ? 'var(--mint-600)' : (a.level === 'medium' ? 'var(--gold-500)' : 'var(--danger)');
      conf.innerHTML =
        '<div class="meter-label"><span>' + App.escapeHtml(W.t('decoder.confOverall')) + '</span>' +
        '<span><strong>' + pct + '%</strong> · ' + App.escapeHtml(W.t('decoder.conf' + cap(a.level))) + '</span></div>' +
        '<div class="meter" style="--pct:' + pct + '%;--col:' + col + '"><span></span></div>' +
        '<div class="row mt2 tiny muted">' +
        '<span class="pill pill-info">' + App.escapeHtml(W.t('decoder.confOcr')) + ' ' + Math.round(a.confidence.ocr * 100) + '%</span>' +
        '<span class="pill pill-info">' + App.escapeHtml(W.t('decoder.confClass')) + ' ' + Math.round(a.confidence.classification * 100) + '%</span>' +
        '<span class="pill pill-muted">' + App.escapeHtml(W.t('decoder.fieldsTitle')) + ' ' + Math.round(a.confidence.coverage * 100) + '%</span>' +
        '</div>' +
        (a.level !== 'high' ? '<p class="small mt2" style="color:var(--warn)">' + App.escapeHtml(W.t('decoder.confLowMsg')) + '</p>' : '');
    }

    /* risk banner */
    var risk = $('#risk-banner');
    if (risk) {
      var high = a.risks.length > 0 || (e.risk === 'high') || a.level === 'low';
      risk.hidden = !high;
      if (high) {
        var tags = a.risks.map(function (r) { return W.t('risk.' + r.tag); }).join(', ') || (e.risk === 'high' ? W.t('notices.riskHigh') : W.t('decoder.confLow'));
        risk.className = 'banner ' + (a.risks.length ? 'banner-danger' : 'banner-warn');
        risk.innerHTML = '<span>' + App.icons.alert + '</span><div><h4>' + App.escapeHtml(W.t('decoder.riskBanner')) + '</h4>' +
          '<p>' + App.escapeHtml(W.t('decoder.riskBannerBody', { risk: tags })) + '</p>' +
          '<div class="btn-row"><button class="btn btn-sm btn-danger" id="risk-review-btn">' + App.escapeHtml(W.t('cta.humanReview')) + '</button>' +
          '<a class="btn btn-sm btn-outline" href="contact.html">' + App.escapeHtml(W.t('nav.contact')) + '</a></div></div>';
        var rb = $('#risk-review-btn');
        if (rb) rb.addEventListener('click', requestReview);
      }
    }

    /* fields */
    var fh = $('#fields-host');
    if (fh) {
      var labels = {
        type: W.t('decoder.fType'), year: W.t('decoder.fYear'), date: W.t('decoder.fDate'),
        owed: W.t('decoder.fOwed'), refund: W.t('decoder.fRefund'), deadline: W.t('decoder.fDeadline'),
        changed: W.t('decoder.fChanged'), actions: W.t('decoder.fActions'), contact: W.t('decoder.fContact')
      };
      fh.innerHTML = a.fields.map(function (f) {
        var missing = f.value === null || f.value === '' || f.value === undefined;
        var val = missing ? W.t('decoder.notFound') : f.value;
        if (f.key === 'owed' || f.key === 'refund') val = missing ? val : W.I18N.money(val);
        if (Array.isArray(val)) val = val;
        var wide = (f.key === 'changed' || f.key === 'actions') ? ' style="grid-column:1/-1"' : '';
        var dot = f.confidence >= 0.85 ? 'hi' : (f.confidence >= 0.5 ? 'low' : 'bad');
        return '<div class="extract-card' + (missing ? ' not-found' : '') + '"' + wide + '>' +
          '<div class="ek">' + App.escapeHtml(labels[f.key] || f.key) + '</div>' +
          '<div class="ev">' + (Array.isArray(val)
            ? '<ul class="mb0">' + val.map(function (x) { return '<li>' + App.escapeHtml(x) + '</li>'; }).join('') + '</ul>'
            : App.escapeHtml(String(val))) + '</div>' +
          (missing ? '' : '<div class="conf"><span class="dot ' + dot + '"></span>' + Math.round(f.confidence * 100) + '% · ' +
            App.escapeHtml(f.method) + (f.quote ? ' · <em title="' + App.escapeHtml(f.quote) + '">' + App.escapeHtml(truncate(f.quote, 60)) + '</em>' : '') + '</div>') +
          '</div>';
      }).join('');
    }

    /* bilingual explanation */
    renderBilingual();

    /* headline */
    var hd = $('#result-headline');
    if (hd) {
      hd.innerHTML = '<span class="pill ' + (e.risk === 'high' ? 'pill-danger' : e.risk === 'medium' ? 'pill-warn' : 'pill-ok') + '">' +
        App.escapeHtml(e.code) + '</span> <strong>' + App.escapeHtml(e.title) + '</strong>' +
        '<div class="tiny muted mt2">' + App.escapeHtml(W.t('decoder.scanClean')) + ' · ' +
        App.escapeHtml(W.t('decoder.pages', { count: state.ocr.pages || 1 })) + '</div>';
    }
  }

  function renderBilingual() {
    var e = state.explanation;
    var enHost = $('#pane-en-body'), locHost = $('#pane-loc-body');
    var locPane = $('#pane-loc');
    if (!enHost) return;
    enHost.innerHTML = sectionsHtml(e.en);
    var loc = e.locale;
    var locLabel = loc === 'en' ? W.t('decoder.englishPane') : W.I18N.name(loc) + ' · ' + loc;
    var lbl = $('#pane-loc-label'); if (lbl) lbl.textContent = locLabel;
    var enLabel = $('#pane-en-label'); if (enLabel) enLabel.textContent = W.t('decoder.englishPane');

    if (loc === 'en') {
      if (locPane) locPane.hidden = true;
      var wrap = $('#bilingual'); if (wrap) wrap.classList.add('single');
      return;
    }
    if (locPane) locPane.hidden = false;
    var wrap2 = $('#bilingual'); if (wrap2) wrap2.classList.remove('single');
    if (!locHost) return;
    if (e.localized && e.translated) {
      locHost.innerHTML = sectionsHtml(e.localized);
    } else {
      /* Reference translation not shipped for this notice/locale in the demo.
         Production runs the translation model here. */
      var summary = getLocalisedSummary(e.code, loc);
      locHost.innerHTML =
        (summary ? '<p><strong>' + App.escapeHtml(summary) + '</strong></p>' : '') +
        sectionsHtml({ sections: e.en.sections }) +
        '<p class="tiny muted">' + App.escapeHtml('Demo: reference translation ships for CP2000 (es, hi, bn, ar, zh-CN). In production this pane is produced by the translation model at run time.') + '</p>';
    }
    var note = $('#pane-loc-note');
    if (note) note.textContent = W.t('lang.mtNote');
    var noteEn = $('#pane-en-note');
    if (noteEn) noteEn.textContent = W.t('lang.englishAuthoritative');
  }

  function getLocalisedSummary(code, loc) {
    var n = D.byCode(code);
    if (!n || !n.summary) return null;
    return n.summary[loc] || n.summary.en;
  }

  function sectionsHtml(block) {
    var keys = ['sec1', 'sec2', 'sec3', 'sec4', 'sec5', 'sec6', 'sec7'];
    return keys.map(function (k, i) {
      var s = (block.sections && block.sections[k]) || { p: [], b: [] };
      var body = (s.p || []).map(function (p) { return '<p>' + App.escapeHtml(p) + '</p>'; }).join('') +
        ((s.b && s.b.length) ? '<ul>' + s.b.map(function (b) { return '<li>' + App.escapeHtml(b) + '</li>'; }).join('') + '</ul>' : '');
      return '<h4>' + (i + 1) + '. ' + App.escapeHtml(W.t('decoder.' + k)) + '</h4>' + body;
    }).join('');
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* ---------- actions ---------- */
  function exportPdf() {
    if (!state.analysis || !state.explanation) return;
    try {
      var doc = D.exportPdf(state.analysis, state.explanation);
      var name = 'gotax-' + (state.analysis.noticeCode || 'notice') + '-explanation-' + W.I18N.current + '.pdf';
      doc.saveAs(name);
      App.audit('explanation.export.pdf', state.analysis.noticeCode, name);
      App.toast(name, 'ok', 2600);
      App.track('decode.export.pdf', { code: state.analysis.noticeCode, locale: W.I18N.current });
    } catch (err) {
      console.error(err);
      App.toast(W.t('common.error'), 'err');
    }
  }

  function addDraftLetter() {
    var a = state.analysis;
    var draft = D.draftLetter(a, state.explanation, { position: 'agree' });
    var conv = API.usdToBtc(29);
    App.modal({
      title: W.t('decoder.addonTitle') + ' — ' + W.t('pricing.letter'),
      bodyHtml:
        '<div class="banner banner-warn"><span>' + App.icons.alert + '</span><div><p>' +
        App.escapeHtml('Never auto-sent to the IRS. A licensed professional reviews this draft before you use it.') + '</p></div></div>' +
        '<textarea class="input mono" id="draft-text" rows="16" spellcheck="false">' + App.escapeHtml(draft.text) + '</textarea>' +
        '<p class="hint">' + App.escapeHtml(draft.disclaimer) + '</p>' +
        '<div class="kv mt4"><div><dt>' + App.escapeHtml(W.t('checkout.usdPrice')) + '</dt><dd>' + W.I18N.money(29) + '</dd></div>' +
        '<div><dt>' + App.escapeHtml(W.t('checkout.btcAmount')) + '</dt><dd>' + W.I18N.btc(conv.btc) + '</dd></div>' +
        '<div><dt>' + App.escapeHtml(W.t('checkout.rate')) + '</dt><dd>1 BTC = ' + W.I18N.money(conv.rate) + '</dd></div></div>',
      actionsHtml:
        '<button class="btn btn-outline" data-close>' + App.escapeHtml(W.t('cta.cancel')) + '</button>' +
        '<button class="btn btn-mint" data-buy>' + App.icons.btc + '<span>' + App.escapeHtml(W.t('cta.payNow')) + '</span></button>',
      onMount: function (m) {
        m.querySelector('[data-buy]').addEventListener('click', function () {
          App.closeModal();
          API.pushCart ? API.pushCart() : null;
          var cart = App.Store.get('cart', []);
          cart = [{ id: 'draft-letter', label: W.t('pricing.letter'), usd: 29, qty: 1 }];
          App.Store.set('cart', cart);
          App.Store.set('pendingDraft', { text: draft.text, code: a.noticeCode, at: new Date().toISOString() });
          location.href = 'checkout.html?service=draft-letter&code=' + encodeURIComponent(a.noticeCode || '');
        });
      }
    });
  }

  function requestReview() {
    var a = state.analysis || {};
    App.modal({
      title: W.t('cta.humanReview'),
      bodyHtml:
        '<p>' + App.escapeHtml('A licensed CPA/EA partner will review the notice, the AI explanation and your questions, and reply in writing.') + '</p>' +
        '<div class="field"><label for="rev-email">' + App.escapeHtml(W.t('checkout.emailLabel')) + '</label>' +
        '<input class="input" id="rev-email" type="email" value="' + App.escapeHtml((API.user() || {}).email || '') + '" autocomplete="email"></div>' +
        '<div class="field"><label for="rev-note">' + App.escapeHtml(W.t('contact.message')) + ' (' + App.escapeHtml(W.t('common.optional')) + ')</label>' +
        '<textarea class="input" id="rev-note" rows="4"></textarea></div>' +
        '<p class="hint">' + App.escapeHtml(W.t('contact.doNotSend')) + '</p>' +
        '<div class="kv"><div><dt>' + App.escapeHtml(W.t('pricing.review')) + '</dt><dd>' + W.I18N.money(49) + '</dd></div></div>',
      actionsHtml:
        '<button class="btn btn-outline" data-close>' + App.escapeHtml(W.t('cta.cancel')) + '</button>' +
        '<button class="btn btn-primary" data-send>' + App.escapeHtml(W.t('cta.submit')) + '</button>',
      onMount: function (m) {
        m.querySelector('[data-send]').addEventListener('click', function () {
          var email = m.querySelector('#rev-email').value.trim();
          if (!email) { App.toast(W.t('checkout.emailLabel'), 'warn'); return; }
          API.requestReview({
            noticeCode: a.noticeCode || 'UNKNOWN',
            risk: (a.risks && a.risks[0] && a.risks[0].tag) || '',
            reason: (a.risks && a.risks.length) ? ('risk.' + a.risks[0].tag) : (a.level === 'low' ? 'low-confidence' : 'user-request'),
            locale: W.I18N.current, email: email, note: m.querySelector('#rev-note').value.trim()
          });
          App.closeModal();
          App.toast(W.t('cta.saved') + ' — ' + W.t('account.statusReview'), 'ok');
        });
      }
    });
  }

  function saveToDashboard() {
    var a = state.analysis, e = state.explanation;
    var c = API.config();
    var doc = API.saveDocument({
      name: state.ocr.name || (state.ocr.kind === 'pasted' ? 'pasted-notice-text.txt' : (state.sampleCode ? 'sample-' + state.sampleCode + '.txt' : 'notice')),
      kind: state.ocr.kind, sizeLabel: state.ocr.sizeLabel || (state.ocr.raw ? App.formatBytes(state.ocr.raw.length) : ''),
      pages: state.ocr.pages || 1, noticeCode: a.noticeCode || 'UNKNOWN',
      scan: 'clean', consentAt: state.consentAt, status: 'explained',
      notes: state.ocr.notes || [],
      redacted: (state.redaction && state.redaction.count) || 0
    });
    var yearField = (a.fields.filter(function (f) { return f.key === 'year'; })[0] || {}).value || '';
    API.saveExplanation({
      documentId: doc.id, code: a.noticeCode || 'UNKNOWN', noticeCode: a.noticeCode || 'UNKNOWN',
      title: e.title, risk: e.risk, source: state.ocr.kind, year: yearField,
      locale: W.I18N.current, confidence: a.confidence.overall, confidenceBreakdown: a.confidence, level: a.level,
      fields: a.fields.map(function (f) { return { key: f.key, value: f.value, confidence: f.confidence }; }),
      deleteAt: doc.deleteAt,
      payload: { analysis: a, explanation: e }
    });
    App.toast(W.t('decoder.savedToAccount'), 'ok');
    var btn = $('#save-dashboard');
    if (btn) { btn.disabled = true; btn.innerHTML = App.icons.checkCircle + '<span>' + App.escapeHtml(W.t('cta.saved')) + '</span>'; }
  }
})();
