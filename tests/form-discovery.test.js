// @vitest-environment jsdom
// DOM tests for form discovery against the demo pages: labels, required, errors, sensitivity, and no values.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDiscovery } from '../src/content/form-discovery.js';

// vitest runs from the project root; jsdom replaces URL so we avoid import.meta.url here.
const demo = (name) => new DOMParser().parseFromString(readFileSync(join(process.cwd(), 'src/demo/demo-site', name), 'utf8'), 'text/html');
const html = (body) => new DOMParser().parseFromString(`<!doctype html><html lang="en"><head><title>T</title></head><body>${body}</body></html>`, 'text/html');
const byName = (res, name) => res.fields.find((f) => f.name === name);

describe('personal details page', () => {
  const doc = demo('personal.html');
  const res = createDiscovery(doc, { salt: 's' }).discover();

  it('finds labelled, required fields', () => {
    expect(res.title).toMatch(/Personal details/);
    expect(byName(res, 'Full name')).toMatchObject({ type: 'text', required: true, filled: false, sensitive: false, nameSource: 'label' });
    expect(res.counts.required).toBe(6);
  });

  it('reads hints through aria-describedby', () => {
    expect(byName(res, 'National ID number').description).toMatch(/8 digits/);
  });

  it('prefixes the multi-field date with its legend', () => {
    const names = res.fields.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['Date of birth: Day', 'Date of birth: Month', 'Date of birth: Year']));
  });

  it('lists the Continue button as an ordinary action', () => {
    expect(res.actions.find((a) => a.name === 'Continue')).toMatchObject({ consequentialKind: null });
  });

  it('reports a visible error and the invalid field', () => {
    const d = demo('personal.html');
    const phone = d.getElementById('phone');
    phone.setAttribute('aria-invalid', 'true');
    const err = d.getElementById('err-phone');
    err.textContent = 'Enter a phone number in the format +254712345678.';
    err.hidden = false;
    const r = createDiscovery(d, { salt: 's' }).discover();
    expect(r.errors[0]).toMatchObject({ fieldId: expect.any(String) });
    expect(r.errors[0].text).toMatch(/phone number/);
    expect(byName(r, 'Phone number')).toMatchObject({ invalid: true });
    expect(byName(r, 'Phone number').errorText).toMatch(/format/);
    expect(r.counts.errors).toBe(1);
  });

  it('hidden error paragraphs are not reported', () => {
    expect(res.errors).toEqual([]);
  });
});

describe('service page', () => {
  const res = createDiscovery(demo('service.html'), { salt: 's' }).discover();
  it('collapses radios into one group named by its legend', () => {
    const g = byName(res, 'How will you collect your permit?');
    expect(g).toMatchObject({ type: 'radio-group', optionCount: 2, required: true, filled: false });
    expect(res.fields.filter((f) => f.type === 'radio-group')).toHaveLength(1);
  });
  it('treats an unchecked required checkbox and an unselected dropdown as empty', () => {
    expect(byName(res, 'I confirm the information I have given is true')).toMatchObject({ type: 'checkbox', filled: false, required: true });
    expect(byName(res, 'Service')).toMatchObject({ type: 'select', filled: false });
  });
});

describe('review and payment pages: sensitive fields', () => {
  it('flags the one-time-code field and does not report whether it is filled', () => {
    const res = createDiscovery(demo('review.html'), { salt: 's' }).discover();
    const otp = byName(res, 'Verification code');
    expect(otp).toMatchObject({ sensitive: true, sensitiveCategory: 'otp', filled: null, required: true });
    expect(res.actions.find((a) => a.name === 'Submit application').consequentialKind).toBe('submission');
  });

  it('flags card number and security code; Pay now is a payment action', () => {
    const res = createDiscovery(demo('payment.html'), { salt: 's' }).discover();
    expect(byName(res, 'Card number')).toMatchObject({ sensitive: true, sensitiveCategory: 'card-number', filled: null });
    expect(byName(res, 'Card security code')).toMatchObject({ sensitive: true, sensitiveCategory: 'card-security-code', filled: null });
    expect(res.actions.find((a) => a.name === 'Pay now').consequentialKind).toBe('payment');
  });

  it('extracts payment details from configured selectors as display text', () => {
    const res = createDiscovery(demo('payment.html'), { salt: 's' }).discover({
      detailSelectors: { recipient: '#pay-recipient', amount: '#pay-amount', fees: '#pay-fees', total: '#pay-total', purpose: '#pay-purpose' },
    });
    expect(res.details).toEqual({
      recipient: 'Demo County Revenue Authority', amount: 'KES 2,500.00', fees: 'KES 50.00', total: 'KES 2,550.00', purpose: 'Business permit renewal (demo)',
    });
  });
});

describe('no values leave the page', () => {
  it('never reads .value of a sensitive field (a throwing getter proves it)', () => {
    const d = html('<label for="c">Verification code</label><input id="c" type="text" autocomplete="one-time-code" required>' +
      '<label for="p">Password</label><input id="p" type="password">' +
      '<label for="n">Card number</label><input id="n" type="text" autocomplete="cc-number">');
    for (const id of ['c', 'p', 'n']) {
      Object.defineProperty(d.getElementById(id), 'value', { get() { throw new Error('VALUE READ FROM SENSITIVE FIELD'); } });
    }
    const res = createDiscovery(d, { salt: 's' }).discover();
    expect(res.fields.every((f) => f.sensitive && f.filled === null)).toBe(true);
  });

  it('the discovery result contains no field values, only filled/empty', () => {
    const d = demo('personal.html');
    // Values chosen so none of them appears in the page's own static text (hints, headings).
    const secrets = { fullname: 'Wanjiru Njeri Kamau', nationalid: '87654321', phone: '+254700111222', 'dob-day': '17' };
    for (const [id, v] of Object.entries(secrets)) d.getElementById(id).value = v;
    const res = createDiscovery(d, { salt: 's' }).discover();
    const json = JSON.stringify(res);
    for (const v of Object.values(secrets)) expect(json).not.toContain(v);
    expect(byName(res, 'Full name').filled).toBe(true);
    expect(byName(res, 'Date of birth: Month').filled).toBe(false);
    expect(Object.keys(byName(res, 'Full name'))).not.toContain('value');
  });

  it('fingerprint changes when any ordinary value changes, but is not the value', () => {
    const d = demo('personal.html');
    d.getElementById('fullname').value = 'Alice';
    const disc = createDiscovery(d, { salt: 's' });
    const a = disc.discover().fingerprint;
    expect(a).toBe(disc.discover().fingerprint);
    d.getElementById('fullname').value = 'Alicf';
    const b = disc.discover().fingerprint;
    expect(b).not.toBe(a);
    expect(b).not.toContain('Alicf');
  });

  it('fingerprint ignores sensitive fields entirely', () => {
    const d = html('<label for="a">Name</label><input id="a"><label for="o">Verification code</label><input id="o" autocomplete="one-time-code">');
    const disc = createDiscovery(d, { salt: 's' });
    const a = disc.discover().fingerprint;
    d.getElementById('o').value = '123456';
    expect(disc.discover().fingerprint).toBe(a);
  });

  it('fingerprints differ between salts', () => {
    const d = demo('personal.html');
    expect(createDiscovery(d, { salt: 'one' }).discover().fingerprint).not.toBe(createDiscovery(d, { salt: 'two' }).discover().fingerprint);
  });
});

describe('generic semantic discovery', () => {
  it('uses aria-labelledby, aria-label, wrapping label, title and placeholder as a last resort', () => {
    const d = html(`
      <span id="l1">Surname</span><input id="a" aria-labelledby="l1">
      <input id="b" aria-label="Middle name">
      <label>Wrapped city <input id="c" type="text"></label>
      <input id="d" title="Postcode title">
      <input id="e" placeholder="Only a placeholder">
      <input id="f">`);
    const res = createDiscovery(d, { salt: 's' }).discover();
    const src = Object.fromEntries(res.fields.map((f) => [f.name, f.nameSource]));
    expect(src['Surname']).toBe('aria-labelledby');
    expect(src['Middle name']).toBe('aria-label');
    expect(src['Wrapped city']).toBe('label');
    expect(src['Postcode title']).toBe('title');
    expect(src['Only a placeholder']).toBe('placeholder');
    expect(res.fields.find((f) => f.unlabelled)).toBeTruthy();
    expect(res.counts.unlabelled).toBe(1);
    expect(res.fields.find((f) => f.name === 'Only a placeholder').weakName).toBe(true);
  });

  it('supports aria-required and aria-invalid with aria-errormessage', () => {
    const d = html('<label for="a">Email</label><input id="a" aria-required="true" aria-invalid="true" aria-errormessage="e1"><p id="e1" role="alert">Email looks wrong</p>');
    const f = createDiscovery(d, { salt: 's' }).discover().fields[0];
    expect(f).toMatchObject({ required: true, invalid: true, errorText: 'Email looks wrong' });
  });

  it('skips hidden controls and hidden inputs', () => {
    const d = html('<input type="hidden" name="csrf" value="x"><div hidden><input id="h"></div><input id="v" aria-label="Visible"><input aria-label="Aria hidden" aria-hidden="true">');
    const res = createDiscovery(d, { salt: 's' }).discover();
    expect(res.fields.map((f) => f.name)).toEqual(['Visible']);
  });

  it('gives each field and action a stable id that resolves to its element', () => {
    const d = demo('personal.html');
    const disc = createDiscovery(d, { salt: 's' });
    const res = disc.discover();
    const f = byName(res, 'Full name');
    expect(disc.getElement(f.id)).toBe(d.getElementById('fullname'));
    const a = res.actions.find((x) => x.name === 'Continue');
    expect(disc.getElement(a.id)).toBe(d.getElementById('continue'));
  });

  it('works on a page with no form', () => {
    const res = createDiscovery(html('<h1>Hello</h1><p>No form</p>'), { salt: 's' }).discover();
    expect(res.fields).toEqual([]);
    expect(res.headings[0]).toEqual({ level: 1, text: 'Hello' });
  });
});
