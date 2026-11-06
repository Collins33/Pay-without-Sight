// @vitest-environment jsdom
// Tests that the interaction manager refuses consequential clicks without a valid grant, and read-back rules.
import { describe, it, expect, vi } from 'vitest';
import { clickAction, focusElement, readBackValue, classifyElement } from '../src/content/interaction-manager.js';
import { classifyActionText, isForwardNavigation } from '../src/content/action-classifier.js';

function page(body) {
  document.body.innerHTML = body;
  return document;
}
const NOW = 1_000_000;
const good = (kind, extra = {}) => ({ kind, token: 'abcdefgh12345678', expiresAt: NOW + 5000, ...extra });

describe('clickAction on a consequential control', () => {
  function setup(label = 'Pay now') {
    page(`<button id="b" type="button">${label}</button>`);
    const el = document.getElementById('b');
    const spy = vi.fn();
    el.addEventListener('click', spy);
    return { el, spy };
  }

  it('refuses with no grant', () => {
    const { el, spy } = setup();
    expect(clickAction(el, { now: () => NOW })).toMatchObject({ ok: false, reason: 'consequential_requires_confirmation', kind: 'payment' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a malformed grant', () => {
    const { el, spy } = setup();
    for (const grant of [{}, { kind: 'payment' }, { kind: 'payment', token: 'x', expiresAt: NOW + 1 }, 'token', null]) {
      expect(clickAction(el, { grant, now: () => NOW }).ok).toBe(false);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a grant for a different kind (submission grant cannot pay)', () => {
    const { el, spy } = setup();
    expect(clickAction(el, { grant: good('submission'), now: () => NOW })).toMatchObject({ ok: false, reason: 'confirmation_is_for_a_different_action' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses an expired grant', () => {
    const { el, spy } = setup();
    expect(clickAction(el, { grant: good('payment', { expiresAt: NOW }), now: () => NOW })).toMatchObject({ ok: false, reason: 'confirmation_expired' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('clicks with a valid, matching, unexpired grant', () => {
    const { el, spy } = setup();
    expect(clickAction(el, { grant: good('payment'), now: () => NOW })).toMatchObject({ ok: true, kind: 'payment' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('gates the submission button too', () => {
    const { el, spy } = setup('Submit application');
    expect(clickAction(el, { now: () => NOW }).ok).toBe(false);
    expect(clickAction(el, { grant: good('submission'), now: () => NOW }).ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('gates an unlabelled submit button conservatively', () => {
    page('<form><input id="b" type="submit" value="Go"></form>');
    const el = document.getElementById('b');
    expect(classifyElement(el)).toBe('submission');
    expect(clickAction(el, { now: () => NOW }).ok).toBe(false);
  });

  it('does not click a disabled control even with a grant', () => {
    page('<button id="b" disabled>Pay now</button>');
    expect(clickAction(document.getElementById('b'), { grant: good('payment'), now: () => NOW })).toMatchObject({ ok: false, reason: 'disabled' });
  });
});

describe('ordinary interactions', () => {
  it('clicks ordinary navigation without a grant', () => {
    page('<button id="b" type="button">Continue</button>');
    const el = document.getElementById('b');
    const spy = vi.fn();
    el.addEventListener('click', spy);
    expect(clickAction(el, { now: () => NOW })).toMatchObject({ ok: true, kind: null });
    expect(spy).toHaveBeenCalled();
  });

  it('focuses a control', () => {
    page('<input id="i" aria-label="Name">');
    const el = document.getElementById('i');
    expect(focusElement(el).ok).toBe(true);
    expect(document.activeElement).toBe(el);
  });
});

describe('readBackValue', () => {
  it('is off unless enabled', () => {
    page('<label for="n">Name</label><input id="n" value="Alice">');
    expect(readBackValue(document.getElementById('n'), { enabled: false })).toEqual({ ok: false, reason: 'read_back_disabled' });
  });

  it('reads an ordinary field when enabled', () => {
    page('<label for="n">Name</label><input id="n" value="Alice">');
    expect(readBackValue(document.getElementById('n'), { enabled: true })).toEqual({ ok: true, value: 'Alice' });
  });

  it('refuses sensitive fields and never reads their value', () => {
    page('<label for="o">Verification code</label><input id="o" autocomplete="one-time-code" value="123456"><label for="p">Password</label><input id="p" type="password" value="hunter2">');
    for (const id of ['o', 'p']) {
      const el = document.getElementById(id);
      Object.defineProperty(el, 'value', { get() { throw new Error('READ'); } });
      expect(readBackValue(el, { enabled: true })).toEqual({ ok: false, reason: 'sensitive' });
    }
  });

  it('reads select text and checkbox state', () => {
    page('<label for="s">Service</label><select id="s"><option value="">Choose</option><option value="r" selected>Renew</option></select><input id="c" type="checkbox" aria-label="Agree" checked>');
    expect(readBackValue(document.getElementById('s'), { enabled: true }).value).toBe('Renew');
    expect(readBackValue(document.getElementById('c'), { enabled: true }).value).toBe('checked');
  });
});

describe('action classifier', () => {
  it('classifies labels', () => {
    expect(classifyActionText({ text: 'Pay now' })).toBe('payment');
    expect(classifyActionText({ text: 'Make payment' })).toBe('payment');
    expect(classifyActionText({ text: 'Submit application' })).toBe('submission');
    expect(classifyActionText({ text: 'Confirm' })).toBe('submission');
    expect(classifyActionText({ text: 'Continue' })).toBeNull();
    expect(classifyActionText({ text: 'Back' })).toBeNull();
    expect(classifyActionText({ text: 'Pay and continue' })).toBe('payment');
    expect(classifyActionText({ text: 'Details', type: 'button' })).toBeNull();
  });
  it('detects forward navigation', () => {
    expect(isForwardNavigation('Continue')).toBe(true);
    expect(isForwardNavigation('Save and continue')).toBe(true);
    expect(isForwardNavigation('Submit application')).toBe(false);
  });
});
