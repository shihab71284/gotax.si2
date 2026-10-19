/* ============================================================
   GoTax.SI — Tax return preparation intake
   Multi-step, resumable, OCR-prefilled, consent-gated.
   Output: a draft package queued for the licensed CPA/EA partner.
   ============================================================ */
(function () {
  'use strict';
  var W = window;
  if (!W.App) return;

  var STEPS = ['filing', 'income', 'deductions', 'dependents', 'documents', 'consent'];
  var state = App.Store.get('intake', null) || blank();
  state.step = Math.min(state.step || 0, STEPS.length - 1);

  function blank() {
    return {
      step: 0, taxYear: String(new Date().getFullYear() - 1), filingStatus: '',
      income: { w2: false, nec: false, k1: false, int: false, se: false, foreign: false, other: false },
      deductions: { standard: true, itemize: false, eitc: false, child: false, education: false, foreign: false },
      dependents: [], state: '', priorYearUploaded: false,
      documents: [], forms: [], consents: { c1: false, c2: false, c3: false },
      submitted: false, preparer: null, updatedAt: new Date().toISOString()
    };
  }

  new Promise(function (res) {
    if (W.NOTICE_SAMPLES && Object.keys(W.NOTICE_SAMPLES).length) { res(); return; }
    var s = document.createElement('script');
    s.src = (W.App && App.url ? App.url('data/samples.js') : 'data/samples.js'); s.onload = res; s.onerror = res;
    document.head.appendChild(s);
  }).then(function () {
    Promise.all([
      fetch(App.url('data/notices.json')).then(function (r) { return r.json(); }).catch(function () { return {}; })
    ]).then(function () { init(); });
  });

  function init() {
    renderSteps();
    bindNav();
    bindFields();
    renderStep();
    if (state.submitted) showPackageStatus();
    W.I18N.onChange(function () { renderSteps(); renderStep(); });
  }

  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function save() {
    state.updatedAt = new Date().toISOString();
    App.Store.set('intake', state);
    var ind = $('#autosave');
    if (ind) {
      ind.textContent = W.t('cta.saved') + ' · ' + new Date().toLocaleTimeString();
      ind.classList.add('pill-ok');
      setTimeout(function () { ind.classList.remove('pill-ok'); }, 900);
    }
  }

  function renderSteps() {
    var host = $('#intake-steps');
    if (!host) return;
    host.innerHTML = STEPS.map(function (s, i) {
      var cls = i < state.step ? 'done' : (i === state.step ? 'current' : '');
      return '<li class="' + cls + '"><button type="button" data-goto="' + i + '" ' +
        (i > state.step && !state.submitted ? 'disabled' : '') + '>' +
        '<span class="bar"></span><span class="lbl">' + (i + 1) + '. ' + App.escapeHtml(W.t('returns.step' + (i + 1))) + '</span></button></li>';
    }).join('');
    $$('#intake-steps [data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { state.step = +b.dataset.goto; save(); renderSteps(); renderStep(); });
    });
    var pct = $('#intake-progress');
    if (pct) pct.textContent = W.t('common.step', { a: state.step + 1, b: STEPS.length });
  }

  function bindNav() {
    var next = $('#step-next'), back = $('#step-back'), submit = $('#step-submit');
    if (next) next.addEventListener('click', function () {
      if (!validateStep()) return;
      if (state.step < STEPS.length - 1) { state.step++; save(); renderSteps(); renderStep(); scrollTop(); }
    });
    if (back) back.addEventListener('click', function () {
      if (state.step > 0) { state.step--; save(); renderSteps(); renderStep(); scrollTop(); }
    });
    if (submit) submit.addEventListener('click', submitPackage);
    var restart = $('#intake-restart');
    if (restart) restart.addEventListener('click', function () {
      App.confirm(W.t('returns.title'), '<p>' + App.escapeHtml('Clear all answers and start a new intake?') + '</p>', function () {
        state = blank(); save(); renderSteps(); renderStep();
      });
    });
  }
  function scrollTop() { W.scrollTo({ top: ($('#intake') || document.body).offsetTop - 80, behavior: 'smooth' }); }

  function bindFields() {
    document.addEventListener('change', function (e) {
      var el = e.target;
      if (el.dataset && el.dataset.field) {
        var parts = el.dataset.field.split('.');
        if (parts.length === 2) state[parts[0]][parts[1]] = el.type === 'checkbox' ? el.checked : el.value;
        else state[parts[0]] = el.type === 'checkbox' ? el.checked : el.value;
        save(); renderStep();
      }
      if (el.dataset && el.dataset.dependentField) {
        syncDependents();
        save();
      }
    });
    document.addEventListener('input', function (e) {
      var el = e.target;
      if (el.dataset && el.dataset.field) {
        var parts = el.dataset.field.split('.');
        if (parts.length === 2) state[parts[0]][parts[1]] = el.value; else state[parts[0]] = el.value;
        save();
      }
    });
    var dz = $('#docs-dropzone'), input = $('#docs-input');
    if (dz && input) {
      dz.addEventListener('click', function () { input.click(); });
      ['dragover', 'dragenter'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); }); });
      dz.addEventListener('drop', function (e) {
        var fs = (e.dataTransfer && e.dataTransfer.files) || [];
        Array.prototype.forEach.call(fs, handleDoc);
      });
      input.addEventListener('change', function () {
        Array.prototype.forEach.call(input.files, handleDoc);
        input.value = '';
      });
    }
  }

  /* ---------- document upload + OCR prefill ---------- */
  function handleDoc(file) {
    var v = App.validateFile(file);
    if (!v.ok) {
      App.toast(v.reason === 'too-big' ? W.t('common.fileTooBig') : W.t('decoder.badFile'), 'err');
      return;
    }
    var rec = { id: App.uid('doc'), name: file.name, size: file.size, sizeLabel: App.formatBytes(file.size), kind: v.ext, status: 'scanning', at: new Date().toISOString() };
    state.documents.push(rec);
    save(); renderDocList();

    var fallback = /w-?2/i.test(file.name) ? 'W2' : (/1099-?nec/i.test(file.name) ? '1099NEC' : (/1099-?k/i.test(file.name) ? '1099K' : null));
    W.Decode.ingest({ file: file, fallbackSample: fallback }, function () {}).then(function (ocr) {
      rec.status = 'ocr-done';
      rec.pages = ocr.pages;
      rec.notes = ocr.notes;
      var doc = API.saveDocument({
        id: rec.id, name: rec.name, kind: ocr.kind || rec.kind, sizeLabel: rec.sizeLabel, pages: ocr.pages,
        noticeCode: fallback || 'tax-form', scan: 'clean', consentAt: new Date().toISOString(), status: 'prefilled'
      });
      rec.signedUrl = doc.signedUrl;
      rec.deleteAt = doc.deleteAt;
      var parsed = parseTaxForm(ocr.text);
      if (parsed) {
        parsed.documentId = rec.id;
        parsed.fileName = rec.name;
        state.forms.push(parsed);
        rec.formType = parsed.formType;
      }
      save(); renderDocList(); renderForms();
      App.toast(W.t('returns.ocrNote'), 'ok', 3200);
    }).catch(function (err) {
      console.error(err);
      rec.status = 'error';
      save(); renderDocList();
      App.toast(W.t('common.error'), 'err');
    });
  }

  /* Very small W-2 / 1099 field parser (production: OCR + LLM structured output) */
  function parseTaxForm(text) {
    var t = String(text || '');
    var isW2 = /Wage and Tax Statement|Form W-2/i.test(t);
    var isNEC = /1099-NEC|Nonemployee Compensation/i.test(t);
    var isK = /1099-K|Third Party Network/i.test(t);
    if (!isW2 && !isNEC && !isK) return null;
    var out = { formType: isW2 ? 'W-2' : (isNEC ? '1099-NEC' : '1099-K'), year: null, fields: [], confidence: 0.8 };
    var ym = t.match(/\b(20\d{2})\b/); if (ym) out.year = ym[1];
    var einM = t.match(/EIN\s*[:#]?\s*(\d{2}-\d{7})/i) || t.match(/(?:PAYER|FILER)'?S TIN\s*[:#]?\s*(\d{2}-\d{7})/i);
    var nameM = t.match(/(?:Employer's name|PAYER'S name|FILER name)\s*[:#]?\s*([A-Z0-9&.,'\- ]{3,60})/i);
    var ssnM = t.match(/(?:social security number|RECIPIENT'S TIN)\s*[:#]?\s*(\d{3}-\d{2}-\d{4})/i);

    function num(re, label) {
      var m = t.match(re);
      if (m) out.fields.push({ label: label, value: m[1].replace(/,/g, ''), display: m[1], confidence: 0.86, source: m[0].trim().slice(0, 90) });
    }
    if (isW2) {
      if (einM) out.fields.push({ label: 'b — EIN', value: einM[1], display: einM[1], confidence: 0.9, source: einM[0].trim() });
      if (nameM) out.fields.push({ label: 'c — Employer', value: nameM[1].trim(), display: nameM[1].trim(), confidence: 0.85, source: nameM[0].trim() });
      if (ssnM) out.fields.push({ label: 'a — SSN (masked)', value: App.maskSsn(ssnM[1]), display: App.maskSsn(ssnM[1]), confidence: 0.95, source: 'redacted', masked: true });
      num(/1\s+Wages, tips, other compensation[.\s]*([\d,]+\.\d{2})/i, '1 — Wages');
      num(/2\s+Federal income tax withheld[.\s]*([\d,]+\.\d{2})/i, '2 — Federal tax withheld');
      num(/3\s+Social security wages[.\s]*([\d,]+\.\d{2})/i, '3 — Social security wages');
      num(/4\s+Social security tax withheld[.\s]*([\d,]+\.\d{2})/i, '4 — Social security tax withheld');
      num(/5\s+Medicare wages and tips[.\s]*([\d,]+\.\d{2})/i, '5 — Medicare wages');
      num(/6\s+Medicare tax withheld[.\s]*([\d,]+\.\d{2})/i, '6 — Medicare tax withheld');
      num(/16\s+State wages[.\s]*([\d,]+\.\d{2})/i, '16 — State wages');
      num(/17\s+State income tax[.\s]*([\d,]+\.\d{2})/i, '17 — State income tax');
      var stM = t.match(/15\s+State\s*[:#]?\s*([A-Z]{2})/i);
      if (stM) out.fields.push({ label: '15 — State', value: stM[1].toUpperCase(), display: stM[1].toUpperCase(), confidence: 0.9, source: stM[0].trim() });
    } else if (isNEC) {
      if (nameM) out.fields.push({ label: 'Payer', value: nameM[1].trim(), display: nameM[1].trim(), confidence: 0.85, source: nameM[0].trim() });
      if (ssnM) out.fields.push({ label: 'Recipient TIN (masked)', value: App.maskSsn(ssnM[1]), display: App.maskSsn(ssnM[1]), confidence: 0.95, source: 'redacted', masked: true });
      num(/1\s+Nonemployee compensation[.\s]*([\d,]+\.\d{2})/i, '1 — Nonemployee compensation');
      num(/4\s+Federal income tax withheld[.\s]*([\d,]+\.\d{2})/i, '4 — Federal tax withheld');
    } else {
      if (nameM) out.fields.push({ label: 'Filer', value: nameM[1].trim(), display: nameM[1].trim(), confidence: 0.85, source: nameM[0].trim() });
      num(/1a\s+Gross payment amount[^\d]*([\d,]+\.\d{2})/i, '1a — Gross payments');
      num(/3\s+Number of payment transactions[.\s]*([\d,]+)/i, '3 — Number of transactions');
    }
    out.confidence = out.fields.length ? Math.round((out.fields.reduce(function (s, f) { return s + f.confidence; }, 0) / out.fields.length) * 100) / 100 : 0.4;
    return out;
  }

  function renderDocList() {
    var host = $('#doc-list');
    if (!host) return;
    if (!state.documents.length) { host.innerHTML = '<p class="muted small">' + App.escapeHtml(W.t('account.docsEmpty')) + '</p>'; return; }
    host.innerHTML = '<ul class="file-list">' + state.documents.map(function (d) {
      var statusPill = d.status === 'ocr-done' ? '<span class="pill pill-ok">' + App.escapeHtml(W.t('common.processing').replace('…', '')) + ' ✓</span>'
        : d.status === 'error' ? '<span class="pill pill-danger">' + App.escapeHtml(W.t('common.error')) + '</span>'
        : '<span class="pill pill-info">' + App.escapeHtml(W.t('common.processing')) + '</span>';
      return '<li class="file-item"><span>' + App.icons.doc + '</span><span style="flex:1 1 200px">' +
        '<span class="fi-name">' + App.escapeHtml(d.name) + '</span>' +
        '<span class="fi-meta">' + App.escapeHtml(d.sizeLabel || '') + (d.pages ? ' · ' + W.t('decoder.pages', { count: d.pages }) : '') + '</span>' +
        (d.deleteAt ? '<span class="fi-meta">' + App.escapeHtml(W.t('account.retention') + ': ' + W.t('account.retentionIn', { days: Math.max(0, App.daysBetween(new Date(), d.deleteAt)) })) + '</span>' : '') +
        (d.signedUrl ? '<span class="signed-url">' + App.escapeHtml(d.signedUrl) + '</span>' : '') +
        '</span>' + statusPill +
        '<button class="icon-btn" data-del-doc="' + d.id + '" aria-label="' + App.escapeHtml(W.t('cta.delete')) + '">' + App.icons.trash + '</button></li>';
    }).join('') + '</ul>';
    $$('#doc-list [data-del-doc]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.delDoc;
        App.confirm(W.t('cta.delete'), '<p>' + App.escapeHtml(W.t('account.deleteConfirm')) + '</p>', function () {
          state.documents = state.documents.filter(function (d) { return d.id !== id; });
          state.forms = state.forms.filter(function (f) { return f.documentId !== id; });
          API.deleteDocument(id);
          save(); renderDocList(); renderForms();
        });
      });
    });
  }

  function renderForms() {
    var host = $('#form-confirm');
    if (!host) return;
    if (!state.forms.length) { host.innerHTML = ''; return; }
    host.innerHTML = '<h4 class="mt6">' + App.escapeHtml(W.t('returns.confirmValues')) + '</h4>' +
      '<p class="small muted">' + App.escapeHtml(W.t('returns.ocrNote')) + '</p>' +
      state.forms.map(function (f, fi) {
        return '<div class="card card-pad mb4"><div class="row-between mb2"><strong>' + App.escapeHtml(f.formType) +
          (f.year ? ' · ' + App.escapeHtml(f.year) : '') + '</strong>' +
          '<span class="pill ' + (f.confidence >= 0.85 ? 'pill-ok' : 'pill-warn') + '">' + App.escapeHtml(W.t('decoder.confidence')) + ' ' +
          Math.round(f.confidence * 100) + '%</span></div>' +
          '<p class="tiny muted">' + App.escapeHtml(f.fileName) + '</p>' +
          '<div class="field-grid">' + f.fields.map(function (fld, i) {
            return '<div class="extract-card"><div class="ek">' + App.escapeHtml(fld.label) + '</div>' +
              '<input class="input" data-form="' + fi + '" data-field-idx="' + i + '" value="' + App.escapeHtml(fld.display) + '" ' +
              (fld.masked ? 'readonly aria-readonly="true"' : '') + ' style="min-height:40px;font-weight:700">' +
              '<div class="conf"><span class="dot ' + (fld.confidence >= 0.85 ? '' : 'low') + '"></span>' + Math.round(fld.confidence * 100) + '%</div>' +
              '<label class="check tiny mt2"><input type="checkbox" data-confirm="' + fi + '-' + i + '" ' + (fld.confirmed ? 'checked' : '') + '> ' +
              App.escapeHtml(W.t('cta.confirm')) + '</label></div>';
          }).join('') + '</div></div>';
      }).join('');
    $$('#form-confirm input[data-field-idx]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var f = state.forms[+inp.dataset.form], fld = f.fields[+inp.dataset.fieldIdx];
        fld.display = inp.value; fld.value = inp.value; fld.edited = true; fld.confirmed = false;
        save();
      });
    });
    $$('#form-confirm input[data-confirm]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var p = cb.dataset.confirm.split('-');
        state.forms[+p[0]].fields[+p[1]].confirmed = cb.checked;
        save();
      });
    });
  }

  function syncDependents() {
    $$('#dependent-list [data-dep]').forEach(function (row) {
      var i = +row.dataset.dep;
      if (!state.dependents[i]) state.dependents[i] = {};
      $$('[data-dep-field]', row).forEach(function (inp) { state.dependents[i][inp.dataset.depField] = inp.value; });
    });
    state.dependents = state.dependents.filter(function (d) { return d && (d.name || d.rel || d.dob); });
  }

  /* ---------- step rendering ---------- */
  function renderStep() {
    var host = $('#step-body');
    if (!host) return;
    var html = '';
    switch (STEPS[state.step]) {
      case 'filing': html = stepFiling(); break;
      case 'income': html = stepIncome(); break;
      case 'deductions': html = stepDeductions(); break;
      case 'dependents': html = stepDependents(); break;
      case 'documents': html = stepDocuments(); break;
      case 'consent': html = stepConsent(); break;
    }
    host.innerHTML = html;
    W.I18N.apply(host);
    if (STEPS[state.step] === 'documents') { renderDocList(); renderForms(); }
    if (STEPS[state.step] === 'income') { renderDocList(); renderForms(); }
    if (STEPS[state.step] === 'consent') renderChecklist();
    var submit = $('#step-submit'), next = $('#step-next');
    if (submit) submit.hidden = STEPS[state.step] !== 'consent' || state.submitted;
    if (next) next.hidden = STEPS[state.step] === 'consent';
    if (state.submitted) showPackageStatus();
    validateStep(true);
  }

  function stepFiling() {
    var years = [];
    var y = new Date().getFullYear();
    for (var i = y; i >= y - 6; i--) years.push(String(i));
    return '<h3>' + App.escapeHtml(W.t('returns.step1')) + '</h3>' +
      '<div class="field-row">' +
      '<div class="field"><label for="tax-year">' + App.escapeHtml(W.t('returns.taxYear')) + '</label>' +
      '<select class="input" id="tax-year" data-field="taxYear">' +
      years.map(function (yy) { return '<option value="' + yy + '"' + (yy === state.taxYear ? ' selected' : '') + '>' + yy + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label for="state-res">' + App.escapeHtml(W.t('returns.state')) + '</label>' +
      '<input class="input" id="state-res" data-field="state" maxlength="2" placeholder="CA" value="' + App.escapeHtml(state.state || '') + '"></div>' +
      '</div>' +
      '<div class="field"><span class="label">' + App.escapeHtml(W.t('returns.filingStatus')) + '</span>' +
      ['fs1', 'fs2', 'fs3', 'fs4', 'fs5'].map(function (k, i) {
        return '<label class="radio-card"><input type="radio" name="filing" value="' + k + '" data-field="filingStatus"' +
          (state.filingStatus === k ? ' checked' : '') + '><span><span class="rc-title">' + App.escapeHtml(W.t('returns.' + k)) + '</span></span></label>';
      }).join('') + '</div>';
  }

  function stepIncome() {
    var keys = [['w2', 'incW2'], ['nec', 'incNEC'], ['k1', 'incK1'], ['int', 'incINT'], ['se', 'incSE'], ['foreign', 'incForeign'], ['other', 'incOther']];
    return '<h3>' + App.escapeHtml(W.t('returns.step2')) + '</h3>' +
      '<p class="muted">' + App.escapeHtml(W.t('returns.incomeTypes')) + '</p>' +
      keys.map(function (k) {
        return '<label class="radio-card"><input type="checkbox" data-field="income.' + k[0] + '"' + (state.income[k[0]] ? ' checked' : '') + '>' +
          '<span><span class="rc-title">' + App.escapeHtml(W.t('returns.' + k[1])) + '</span>' +
          (k[0] === 'foreign' ? '<span class="rc-desc">' + App.escapeHtml('May require Form 8938 / FinCEN 114 (FBAR) and Form 1116.') + '</span>' : '') +
          '</span></label>';
      }).join('') +
      '<hr><h4>' + App.escapeHtml(W.t('returns.uploadDocs')) + '</h4>' + dropzoneHtml() + '<div id="doc-list"></div><div id="form-confirm"></div>';
  }

  function dropzoneHtml() {
    return '<div class="dropzone" id="docs-dropzone" role="button" tabindex="0" aria-label="' + App.escapeHtml(W.t('returns.uploadDocs')) + '">' +
      App.icons.upload +
      '<div class="dz-title">' + App.escapeHtml(W.t('decoder.dropTitle')) + '</div>' +
      '<div class="dz-sub">' + App.escapeHtml(W.t('decoder.dropSub')) + ' · W-2, 1099-NEC, 1099-K</div>' +
      '<input type="file" id="docs-input" class="visually-hidden" accept=".jpg,.jpeg,.png,.pdf" multiple></div>' +
      '<p class="tiny muted mt2">' + App.escapeHtml(W.t('decoder.consent')) + '</p>';
  }

  function stepDeductions() {
    var keys = [['standard', 'dedStandard'], ['itemize', 'dedItemize'], ['eitc', 'dedEic'], ['child', 'dedChild'], ['education', 'dedEducation'], ['foreign', 'dedForeign']];
    return '<h3>' + App.escapeHtml(W.t('returns.step3')) + '</h3>' +
      '<p class="muted">' + App.escapeHtml(W.t('returns.deductions')) + '</p>' +
      keys.map(function (k) {
        return '<label class="radio-card"><input type="checkbox" data-field="deductions.' + k[0] + '"' + (state.deductions[k[0]] ? ' checked' : '') + '>' +
          '<span><span class="rc-title">' + App.escapeHtml(W.t('returns.' + k[1])) + '</span></span></label>';
      }).join('');
  }

  function stepDependents() {
    return '<h3>' + App.escapeHtml(W.t('returns.step4')) + '</h3>' +
      '<div id="dependent-list">' + state.dependents.map(function (d, i) { return dependentRow(d, i); }).join('') + '</div>' +
      '<button class="btn btn-outline mt4" type="button" id="add-dependent">' + App.escapeHtml(W.t('returns.addDependent')) + '</button>';
  }
  function dependentRow(d, i) {
    d = d || {};
    return '<div class="card card-pad mb4" data-dep="' + i + '">' +
      '<div class="field-row"><div class="field"><label>' + App.escapeHtml(W.t('returns.depName')) + '</label>' +
      '<input class="input" data-dep-field="name" value="' + App.escapeHtml(d.name || '') + '" autocomplete="off"></div>' +
      '<div class="field"><label>' + App.escapeHtml(W.t('returns.depRel')) + '</label>' +
      '<input class="input" data-dep-field="rel" value="' + App.escapeHtml(d.rel || '') + '"></div></div>' +
      '<div class="field-row"><div class="field"><label>' + App.escapeHtml(W.t('returns.depDob')) + '</label>' +
      '<input class="input" type="date" data-dep-field="dob" value="' + App.escapeHtml(d.dob || '') + '"></div>' +
      '<div class="field"><label>' + App.escapeHtml(W.t('returns.depSsn')) + '</label>' +
      '<input class="input mono" data-dep-field="ssn" placeholder="XXX-XX-1234" value="' + App.escapeHtml(d.ssnMasked || '') + '"></div></div>' +
      '<button class="btn btn-sm btn-ghost" type="button" data-del-dep="' + i + '">' + App.escapeHtml(W.t('cta.delete')) + '</button></div>';
  }

  function stepDocuments() {
    return '<h3>' + App.escapeHtml(W.t('returns.step5')) + '</h3>' +
      '<div class="field"><label for="prior-year">' + App.escapeHtml(W.t('returns.priorYear')) + '</label>' +
      '<label class="check-box check"><input type="checkbox" id="prior-year" data-field="priorYearUploaded"' + (state.priorYearUploaded ? ' checked' : '') + '>' +
      '<span>' + App.escapeHtml(W.t('returns.priorYear')) + '</span></label></div>' +
      '<h4>' + App.escapeHtml(W.t('returns.uploadDocs')) + '</h4>' + dropzoneHtml() +
      '<div id="doc-list"></div><div id="form-confirm"></div>' +
      '<hr><h4>' + App.escapeHtml(W.t('returns.checklist')) + '</h4>' +
      '<p class="small muted">' + App.escapeHtml(W.t('returns.checklistSub')) + '</p><div id="checklist-host"></div>';
  }

  function stepConsent() {
    return '<h3>' + App.escapeHtml(W.t('returns.step6')) + '</h3>' +
      '<div class="card card-pad mb4"><h4 class="mt0">' + App.escapeHtml(W.t('returns.checklist')) + '</h4><div id="checklist-host"></div></div>' +
      '<div class="banner banner-info"><span>' + App.icons.info + '</span><div><p>' + App.escapeHtml(W.t('returns.packageNote')) + '</p></div></div>' +
      '<h4>' + App.escapeHtml(W.t('returns.consentTitle')) + '</h4>' +
      [['c1', 'returns.consent1'], ['c2', 'returns.consent2'], ['c3', 'returns.consent3']].map(function (c) {
        return '<label class="check-box check"><input type="checkbox" data-consent="' + c[0] + '"' + (state.consents[c[0]] ? ' checked' : '') + '>' +
          '<span>' + App.escapeHtml(W.t(c[1])) + '</span></label>';
      }).join('') +
      '<div id="package-status"></div>';
  }

  function renderChecklist() {
    var host = $('#checklist-host');
    if (!host) return;
    var items = buildChecklist();
    host.innerHTML = '<ul class="checklist">' + items.map(function (it) {
      var ico = it.have ? App.icons.checkCircle : App.icons.alert;
      return '<li class="' + (it.have ? 'have' : 'missing') + '"><span class="ck-ico">' + ico + '</span>' +
        '<span>' + App.escapeHtml(it.label) + (it.have ? '' : ' — <strong>' + App.escapeHtml(W.t('returns.missing')) + '</strong>') + '</span></li>';
    }).join('') + '</ul>' +
      '<p class="tiny muted mt2">' + items.filter(function (i) { return i.have; }).length + ' / ' + items.length + ' ' +
      App.escapeHtml(W.t('returns.have')) + '</p>';
  }

  function buildChecklist() {
    var inc = state.income, forms = state.forms.map(function (f) { return f.formType; });
    var list = [];
    list.push({ label: W.t('returns.filingStatus') + ': ' + (state.filingStatus ? W.t('returns.' + state.filingStatus) : '—'), have: !!state.filingStatus });
    list.push({ label: W.t('returns.state') + ': ' + (state.state || '—'), have: !!state.state });
    if (inc.w2) list.push({ label: 'W-2 (' + W.t('returns.incW2') + ')', have: forms.indexOf('W-2') >= 0 });
    if (inc.nec) list.push({ label: '1099-NEC (' + W.t('returns.incNEC') + ')', have: forms.indexOf('1099-NEC') >= 0 });
    if (inc.k1) list.push({ label: '1099-K (' + W.t('returns.incK1') + ')', have: forms.indexOf('1099-K') >= 0 });
    if (inc.int) list.push({ label: '1099-INT / 1099-DIV', have: state.documents.some(function (d) { return /int|div|1099/i.test(d.name); }) });
    if (inc.se) list.push({ label: 'Schedule C expenses (receipts, mileage log)', have: state.documents.some(function (d) { return /expense|mileage|schedul/i.test(d.name); }) });
    if (inc.foreign) list.push({ label: 'Foreign income records + Form 8938 / FBAR details', have: false });
    if (state.deductions.itemize) list.push({ label: 'Itemised deduction records (1098, receipts)', have: state.documents.some(function (d) { return /1098|itemi|receipt/i.test(d.name); }) });
    if (state.dependents.length) list.push({ label: W.t('returns.dependents') + ': ' + state.dependents.length, have: state.dependents.every(function (d) { return d.name && d.dob; }) });
    if (state.priorYearUploaded) list.push({ label: W.t('returns.priorYear'), have: true });
    list.push({ label: W.t('returns.consentTitle'), have: !!(state.consents.c1 && state.consents.c2 && state.consents.c3) });
    return list;
  }

  /* ---------- validation & submit ---------- */
  function validateStep(silent) {
    var ok = true, msg = '';
    if (STEPS[state.step] === 'filing' && !state.filingStatus) { ok = false; msg = W.t('returns.filingStatus'); }
    if (STEPS[state.step] === 'consent') {
      var c = state.consents;
      if (!(c.c1 && c.c2 && c.c3)) { ok = false; msg = W.t('returns.consentTitle'); }
      var unconfirmed = state.forms.some(function (f) { return f.fields.some(function (x) { return !x.confirmed && !x.masked; }); });
      if (unconfirmed) { ok = false; msg = W.t('returns.confirmValues'); }
    }
    var btn = $('#step-submit');
    if (btn) btn.disabled = !ok;
    var nb = $('#step-next');
    if (nb) nb.disabled = !ok;
    if (!ok && !silent) App.toast(msg, 'warn');
    return ok;
  }
  $$('#step-next, #step-submit').forEach(function (b) { b.addEventListener('click', function () { validateStep(false); }); });

  document.addEventListener('click', function (e) {
    var add = e.target.closest('#add-dependent');
    if (add) {
      syncDependents();
      state.dependents.push({});
      save(); renderStep();
    }
    var del = e.target.closest('[data-del-dep]');
    if (del) {
      syncDependents();
      state.dependents.splice(+del.dataset.delDep, 1);
      save(); renderStep();
    }
  });
  document.addEventListener('change', function (e) {
    var c = e.target.dataset && e.target.dataset.consent;
    if (c) { state.consents[c] = e.target.checked; save(); validateStep(true); renderChecklist(); }
    if (e.target.id === 'prior-year') { state.priorYearUploaded = e.target.checked; save(); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.dataset && e.target.dataset.depField) { syncDependents(); save(); }
  });

  function submitPackage() {
    if (!validateStep(false)) return;
    var item = API.requestReview({
      kind: 'return-prep',
      noticeCode: 'Form 1040 ' + state.taxYear,
      risk: state.income.foreign ? 'foreign-income' : '',
      reason: 'return-prep-intake',
      locale: W.I18N.current,
      email: (API.user() || {}).email || 'customer@example.com',
      intake: {
        taxYear: state.taxYear, filingStatus: state.filingStatus, income: state.income,
        deductions: state.deductions, dependents: state.dependents.length, state: state.state,
        documents: state.documents.map(function (d) { return { id: d.id, name: d.name }; }),
        forms: state.forms.map(function (f) {
          return { formType: f.formType, year: f.year, fields: f.fields.map(function (x) { return { label: x.label, value: x.masked ? x.value : x.display, confirmed: !!x.confirmed }; }) };
        })
      }
    });
    state.submitted = true;
    state.preparer = { name: 'Jordan Lee, CPA', ptin: 'P01234567', firm: '[PARTNER FIRM NAME — placeholder]', assignedAt: new Date().toISOString(), reviewId: item.id };
    save();
    App.toast(W.t('returns.submitted'), 'ok');
    App.track('returns.submitted', { year: state.taxYear, docs: state.documents.length });
    renderStep();
  }

  function showPackageStatus() {
    var host = $('#package-status');
    if (!host) return;
    var p = state.preparer;
    host.innerHTML = '<div class="banner banner-ok mt6"><span>' + App.icons.checkCircle + '</span><div>' +
      '<h4>' + App.escapeHtml(W.t('returns.submitted')) + '</h4>' +
      '<p>' + App.escapeHtml(W.t('returns.draftPackage')) + ' — ' + App.escapeHtml(W.t('returns.packageNote')) + '</p>' +
      '<div class="kv mt2">' +
      '<div><dt>' + App.escapeHtml(W.t('returns.preparer')) + '</dt><dd>' + App.escapeHtml(p ? p.name : W.t('returns.preparerUnassigned')) + '</dd></div>' +
      '<div><dt>' + App.escapeHtml(W.t('returns.ptin')) + '</dt><dd class="mono">' + App.escapeHtml(p ? p.ptin : '—') + '</dd></div>' +
      '</div></div></div>';
    W.I18N.apply(host);
  }
})();
