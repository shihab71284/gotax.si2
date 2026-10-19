/* GoTax.SI — contact page: validated form, rate limit, FAQ, ?invoice= prefill */
(function () {
  'use strict';
  var W = window;
  if (!W.App) return;

  var SENSITIVE = /\b(\d{3}-\d{2}-\d{4}|\d{9}|\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/;

  function init() {
    var form = document.querySelector('#contact-form');
    if (form) {
      form.addEventListener('submit', submit);
      prefill();
      /* live guard: warn before a sensitive number is sent */
      var msg = form.querySelector('#c-message');
      msg.addEventListener('blur', function () {
        if (SENSITIVE.test(msg.value)) {
          App.toast(W.t('contact.doNotSend'), 'err', 6000);
          msg.setCustomValidity(W.t('contact.doNotSend'));
        } else {
          msg.setCustomValidity('');
        }
      });
    }
    fetch(App.url('data/services.json')).then(function (r) { return r.json(); }).then(function (d) {
      renderFaq(d);
      W.I18N.onChange(function () { renderFaq(d); });
    }).catch(function () {});
  }

  function prefill() {
    var q = new URLSearchParams(location.search);
    var inv = q.get('invoice');
    if (inv) {
      var ref = document.querySelector('#c-ref');
      if (ref) ref.value = inv;
      var topic = document.querySelector('#c-topic');
      if (topic) topic.value = 'payment';
      var msg = document.querySelector('#c-message');
      if (msg) {
        msg.value = 'I need help with invoice ' + inv + '. ';
        msg.focus();
      }
      var card = document.querySelector('#contact-form');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    var notice = q.get('notice');
    if (notice) {
      var t2 = document.querySelector('#c-topic'); if (t2) t2.value = 'notice';
      var r2 = document.querySelector('#c-ref'); if (r2) r2.value = notice;
    }
  }

  function submit(e) {
    e.preventDefault();
    var form = e.target;
    var status = document.querySelector('#c-status');
    var data = {
      name: form.querySelector('#c-name').value.trim(),
      email: form.querySelector('#c-email').value.trim(),
      topic: form.querySelector('#c-topic').value,
      ref: form.querySelector('#c-ref').value.trim(),
      message: form.querySelector('#c-message').value.trim(),
      urgent: form.querySelector('#c-urgent').checked,
      consent: form.querySelector('#c-consent').checked
    };

    if (!data.name || !/.+@.+\..+/.test(data.email) || data.message.length < 10) {
      App.toast(W.t('contact.formError'), 'err');
      return;
    }
    if (!data.consent) { App.toast(W.t('decoder.consentRequired'), 'warn'); return; }
    if (SENSITIVE.test(data.message)) {
      App.toast(W.t('contact.doNotSend'), 'err', 7000);
      return;
    }
    if (!App.rateLimit('contact')) {
      App.toast(W.t('decoder.rateLimited'), 'warn');
      return;
    }

    var btn = form.querySelector('#c-submit');
    btn.disabled = true;
    if (status) status.textContent = W.t('common.saving');

    /* mock POST /api/v1/contact — the real backend enqueues an email + audit row */
    setTimeout(function () {
      var id = App.uid('MSG');
      App.Store.push('messages', {
        id: id, at: new Date().toISOString(), locale: W.I18N.current,
        name: data.name, email: data.email, topic: data.topic, ref: data.ref,
        message: data.message.slice(0, 400), urgent: data.urgent,
        consentAt: new Date().toISOString(), status: 'received'
      });
      App.audit('contact.message', id, 'topic=' + data.topic + (data.urgent ? ' urgent' : ''));
      App.track('contact.submitted', { topic: data.topic, urgent: data.urgent });
      if (status) status.textContent = '';
      btn.disabled = false;
      form.reset();
      App.modal({
        title: W.t('contact.sent'),
        bodyHtml: '<p>' + App.escapeHtml(W.t('contact.sentBody')) + '</p>' +
          '<div class="kv"><div><dt>' + App.escapeHtml(W.t('admin.reference')) + '</dt><dd class="mono">' + App.escapeHtml(id) + '</dd></div>' +
          '<div><dt>' + App.escapeHtml(W.t('contact.hours')) + '</dt><dd>' + App.escapeHtml(W.t('contact.hoursVal')) + '</dd></div></div>' +
          (data.urgent ? '<div class="banner banner-warn mt4"><span>' + App.icons.alert + '</span><div><p class="mb0">' +
            App.escapeHtml(W.t('contact.urgentBody')) + '</p><a class="btn btn-sm btn-primary mt2" href="decoder.html">' +
            App.escapeHtml(W.t('cta.talkToPro')) + '</a></div></div>' : ''),
        actionsHtml: '<button class="btn btn-primary" data-close>' + App.escapeHtml(W.t('cta.close')) + '</button>'
      });
    }, 700);
  }

  function renderFaq(services) {
    var host = document.querySelector('#faq-list');
    if (!host || !services || !services.faq) return;
    host.innerHTML = services.faq.slice(0, 6).map(function (k) {
      return '<details class="faq-item"><summary><span data-i18n="' + k + '">' + App.escapeHtml(W.t(k)) + '</span>' +
        '<span class="faq-ico" aria-hidden="true">' + App.icons.plus + '</span></summary>' +
        '<div class="faq-body"><p data-i18n="' + k.replace('.q', '.a') + '">' + App.escapeHtml(W.t(k.replace('.q', '.a'))) + '</p></div></details>';
    }).join('');
    W.I18N.apply(host);
  }

  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
