// Behaviour for the fake demo site: validation, page-to-page navigation, fake data kept in sessionStorage.
(function () {
  'use strict';
  const page = document.body.dataset.page;
  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem('pws-demo-' + k) || 'null'); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem('pws-demo-' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  const $ = (id) => document.getElementById(id);

  function showError(fieldId, errId, message) {
    const f = $(fieldId), e = $(errId);
    if (f) f.setAttribute('aria-invalid', 'true');
    if (e) { e.textContent = message; e.hidden = false; }
  }
  function clearErrors() {
    document.querySelectorAll('[aria-invalid="true"]').forEach((n) => n.removeAttribute('aria-invalid'));
    document.querySelectorAll('.error').forEach((n) => { n.hidden = true; n.textContent = ''; });
  }
  const val = (id) => ($(id) ? $(id).value.trim() : '');

  if (page === 'personal') {
    // Quirk: opening personal.html?error=1 shows a server-style error on load.
    if (/[?&]error=/.test(location.search)) showError('phone', 'err-phone', 'Enter a phone number in the format +254712345678.');
    $('continue').addEventListener('click', () => {
      clearErrors();
      let firstBad = null;
      const bad = (id, err, msg) => { showError(id, err, msg); firstBad = firstBad || id; };
      if (!val('fullname')) bad('fullname', 'err-fullname', 'Enter your full name.');
      if (!/^\d{8}$/.test(val('nationalid'))) bad('nationalid', 'err-nationalid', 'National ID must be exactly 8 digits.');
      if (!/^\+?\d{9,13}$/.test(val('phone'))) bad('phone', 'err-phone', 'Enter a phone number in the format +254712345678.');
      const d = Number(val('dob-day')), m = Number(val('dob-month')), y = Number(val('dob-year'));
      if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= 2100)) bad('dob-day', 'err-dob', 'Enter a valid date of birth.');
      if (firstBad) { $(firstBad).focus(); return; }
      store.set('personal', { fullname: val('fullname'), nationalid: val('nationalid'), phone: val('phone'), dob: `${d}/${m}/${y}` });
      location.href = 'service.html';
    });
  }

  if (page === 'service') {
    $('continue').addEventListener('click', () => {
      clearErrors();
      let firstBad = null;
      const bad = (id, err, msg) => { showError(id, err, msg); firstBad = firstBad || id; };
      if (!val('service-type')) bad('service-type', 'err-service-type', 'Choose a service.');
      if (!/^PN-\d{5}$/.test(val('permit'))) bad('permit', 'err-permit', 'Permit number must look like PN-12345.');
      if (!document.querySelector('input[name="collect"]:checked')) bad('collect-office', 'err-collect', 'Choose how you will collect your permit.');
      if (!$('declare').checked) bad('declare', 'err-declare', 'You must confirm the declaration.');
      if (firstBad) { $(firstBad).focus(); return; }
      const collect = document.querySelector('input[name="collect"]:checked');
      store.set('service', { service: $('service-type').selectedOptions[0].textContent, permit: val('permit'), collect: collect.nextElementSibling.textContent });
      location.href = 'review.html';
    });
  }

  if (page === 'review') {
    const p = store.get('personal') || {}, s = store.get('service') || {};
    const rows = [['Full name', p.fullname], ['National ID', p.nationalid], ['Phone', p.phone], ['Date of birth', p.dob], ['Service', s.service], ['Permit number', s.permit], ['Collection', s.collect]];
    const dl = $('summary');
    rows.forEach(([k, v]) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v || '(not provided)';
      dl.append(dt, dd);
    });
    $('submit-btn').addEventListener('click', () => {
      clearErrors();
      if (!/^\d{6}$/.test(val('otp'))) { showError('otp', 'err-otp', 'Enter the 6-digit code sent to your phone.'); $('otp').focus(); return; }
      store.set('submitted', true);
      location.href = 'payment.html';
    });
  }

  if (page === 'payment') {
    $('pay-btn').addEventListener('click', () => {
      clearErrors();
      if (!store.get('submitted')) { showError('card-number', 'err-card', 'Submit the application before paying.'); return; }
      if (!/^\d{12,19}$/.test(val('card-number').replace(/\s+/g, ''))) { showError('card-number', 'err-card', 'Enter a card number (fake data only).'); $('card-number').focus(); return; }
      if (!/^\d{3,4}$/.test(val('card-code'))) { showError('card-code', 'err-code', 'Enter the card security code (fake data only).'); $('card-code').focus(); return; }
      const stamp = new Date();
      store.set('receipt', {
        number: 'DEMO-' + String(stamp.getTime()).slice(-8),
        recipient: $('pay-recipient').textContent, total: $('pay-total').textContent,
        purpose: $('pay-purpose').textContent, when: stamp.toLocaleString(),
      });
      location.href = 'receipt.html';
    });
  }

  if (page === 'receipt') {
    const r = store.get('receipt');
    const box = $('receipt');
    if (!r) { box.textContent = 'No receipt yet. Complete the payment first.'; return; }
    const rows = [['Receipt number', r.number], ['Paid to', r.recipient], ['Amount paid', r.total], ['Purpose', r.purpose], ['Date', r.when], ['Status', 'Simulated payment complete. No money moved.']];
    rows.forEach(([k, v]) => {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      box.append(dt, dd);
    });
  }
})();
