// @vitest-environment jsdom
// End-to-end on the demo pages: real coordinator + real discovery + real content-side click gate, fake Chrome.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCoordinator } from '../src/background/coordinator.js';
import { MSG, makeMessage } from '../src/communication/message-contracts.js';
import { createMemoryStorage } from '../src/prefs/storage-adapter.js';
import { createStandaloneProvider } from '../src/toolkit/standalone-provider.js';
import { createDiscovery, readTextBySelector } from '../src/content/form-discovery.js';
import { focusElement, clickAction, readBackValue } from '../src/content/interaction-manager.js';
import { DEMO_WORKFLOW } from '../src/demo/demo-workflow.js';

const ids = { extensionId: 'testextensionid', extensionOrigin: 'chrome-extension://testextensionid/', sidepanelUrl: 'chrome-extension://testextensionid/sidepanel/index.html' };
const panel = { id: ids.extensionId, url: ids.sidepanelUrl };
const contentSender = { id: ids.extensionId, tab: { id: 1 }, url: 'http://localhost:4173/review.html' };

const SUMMARY = '<dt>Full name</dt><dd>Test Person</dd>';

/** Fake chrome: a "tab" showing one demo page at a time, wired to the real content-side code. */
function makeWorld() {
  const clock = { t: 1_000_000 };
  const world = { clock, href: '', clicks: [], local: createMemoryStorage(), session: createMemoryStorage(), discovery: null };

  world.load = (name, href = `http://localhost:4173/${name}`) => {
    const html = readFileSync(join(process.cwd(), 'src/demo/demo-site', name), 'utf8');
    document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>[\s\S]*$/i, '');
    document.querySelectorAll('script').forEach((s) => s.remove());
    world.href = href;
    world.discovery = createDiscovery(document, { salt: 'test-salt', href });
    if (name === 'review.html') document.getElementById('summary').innerHTML = SUMMARY;
    document.querySelectorAll('button, a.button').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); world.clicks.push(b.textContent.trim()); }));
  };

  let discoverOptions = {};
  world.bridge = {
    async ensure() { return { ok: true, href: world.href }; },
    async send(type, payload) {
      switch (type) {
        case MSG.DISCOVER:
          discoverOptions = payload;
          return { ok: true, result: world.discovery.discover(payload) };
        case MSG.FOCUS: {
          if (!world.discovery.getEntry(payload.fieldId)) world.discovery.discover(discoverOptions);
          return focusElement(world.discovery.getElement(payload.fieldId));
        }
        case MSG.CLICK: {
          if (!world.discovery.getEntry(payload.actionId)) world.discovery.discover(discoverOptions);
          return clickAction(world.discovery.getElement(payload.actionId), { grant: payload.grant, now: () => clock.t });
        }
        case MSG.READ_BACK: return readBackValue(world.discovery.getElement(payload.fieldId), { enabled: true });
        case MSG.READ_TEXT: { const text = readTextBySelector(document, payload.selector); return text ? { ok: true, text } : { ok: false }; }
        default: return { ok: false };
      }
    },
  };

  world.coordinator = () => createCoordinator({
    ids, local: world.local, session: world.session, bridge: world.bridge, workflow: DEMO_WORKFLOW, now: () => clock.t,
    provider: createStandaloneProvider({ storage: world.local }),
  });
  return world;
}

const call = (c, type, payload = {}, sender = panel) => c.handle(makeMessage(type, payload), sender);
const tx = (res) => res.view.transaction.pending;

let world;
beforeEach(() => { world = makeWorld(); });

describe('submission flow on the review page', () => {
  it('shows what will be submitted as filled/empty and never a value; nothing is authorised yet', async () => {
    world.load('review.html');
    const c = world.coordinator();
    const res = await call(c, MSG.GET_VIEW);
    expect(tx(res)).toMatchObject({ kind: 'submission', status: 'awaiting_confirmation' });
    const labels = Object.fromEntries(tx(res).lines.map((l) => [l.label, l.value]));
    expect(labels['Verification code']).toMatch(/sensitive/);
    expect(JSON.stringify(res)).not.toMatch(/token/i);
    expect(world.clicks).toEqual([]);
  });

  it('refuses to execute without a confirmation, and nothing is clicked', async () => {
    world.load('review.html');
    const c = world.coordinator();
    await call(c, MSG.GET_VIEW);
    const res = await call(c, MSG.EXECUTE, { kind: 'submission' });
    expect(res.ok).toBe(false);
    expect(world.clicks).toEqual([]);
  });

  it('a plain click on the submit control without a grant is refused inside the page', async () => {
    world.load('review.html');
    const c = world.coordinator();
    const view = await call(c, MSG.GET_VIEW);
    expect(view.ok).toBe(true);
    const page = world.discovery.discover({});
    const submit = page.actions.find((a) => a.consequentialKind === 'submission');
    const res = await world.bridge.send(MSG.CLICK, { actionId: submit.id });
    expect(res).toMatchObject({ ok: false, reason: 'consequential_requires_confirmation' });
    expect(world.clicks).toEqual([]);
  });

  it('confirm then execute clicks exactly once, using a grant', async () => {
    world.load('review.html');
    const c = world.coordinator();
    await call(c, MSG.GET_VIEW);
    expect((await call(c, MSG.CONFIRM, { kind: 'submission' })).ok).toBe(true);
    const res = await call(c, MSG.EXECUTE, { kind: 'submission' });
    expect(res.ok).toBe(true);
    expect(world.clicks).toEqual(['Submit application']);
    expect(tx(res).status).toBe('activated');
    // The confirmation is single use.
    expect((await call(c, MSG.EXECUTE, { kind: 'submission' })).ok).toBe(false);
    expect(world.clicks).toHaveLength(1);
  });

  it('changing any detail after confirming invalidates the confirmation and the panel says so', async () => {
    world.load('review.html');
    const c = world.coordinator();
    await call(c, MSG.GET_VIEW);
    await call(c, MSG.CONFIRM, { kind: 'submission' });
    document.getElementById('summary').innerHTML = '<dt>Full name</dt><dd>Someone Else</dd>';
    const view = await call(c, MSG.GET_VIEW);
    expect(tx(view).status).toBe('awaiting_confirmation');
    expect(tx(view).notice.text).toMatch(/no longer valid/i);
    const res = await call(c, MSG.EXECUTE, { kind: 'submission' });
    expect(res.ok).toBe(false);
    expect(world.clicks).toEqual([]);
  });

  it('a changed ordinary field value also invalidates it, without exposing the value', async () => {
    world.load('review.html');
    const c = world.coordinator();
    await call(c, MSG.GET_VIEW);
    await call(c, MSG.CONFIRM, { kind: 'submission' });
    const extra = document.createElement('input');
    extra.setAttribute('aria-label', 'Extra note');
    document.querySelector('form').append(extra);
    const view = await call(c, MSG.GET_VIEW);
    expect(tx(view).status).toBe('awaiting_confirmation');
    extra.value = 'secret-ish-text';
    expect(JSON.stringify(await call(c, MSG.GET_VIEW))).not.toContain('secret-ish-text');
  });

  it('typing into the sensitive code field does not disturb a confirmation, and its value is never read', async () => {
    world.load('review.html');
    const otp = document.getElementById('otp');
    Object.defineProperty(otp, 'value', { get() { throw new Error('OTP VALUE READ'); }, set() {}, configurable: true });
    const c = world.coordinator();
    await call(c, MSG.GET_VIEW);
    await call(c, MSG.CONFIRM, { kind: 'submission' });
    expect(tx(await call(c, MSG.GET_VIEW)).status).toBe('confirmed');
  });

  it('the confirmation expires', async () => {
    world.load('review.html');
    const c = world.coordinator();
    await call(c, MSG.GET_VIEW);
    await call(c, MSG.CONFIRM, { kind: 'submission' });
    world.clock.t += 121_000;
    const res = await call(c, MSG.EXECUTE, { kind: 'submission' });
    expect(res.ok).toBe(false);
    expect(world.clicks).toEqual([]);
  });

  it('refuses to confirm while a required field is empty', async () => {
    world.load('service.html');
    const c = world.coordinator();
    const res = await call(c, MSG.CONFIRM, { kind: 'submission' });
    expect(res.ok).toBe(false);
  });
});

describe('payment flow', () => {
  async function submitFirst(c) {
    world.load('review.html');
    await call(c, MSG.GET_VIEW);
    await call(c, MSG.CONFIRM, { kind: 'submission' });
    await call(c, MSG.EXECUTE, { kind: 'submission' });
    world.clicks.length = 0;
    world.load('payment.html'); // the site accepted the submission and moved on
  }

  it('is blocked until the submission is completed', async () => {
    world.load('payment.html');
    const c = world.coordinator();
    const res = await call(c, MSG.GET_VIEW);
    expect(tx(res)).toBeNull();
    expect(res.view.transaction.blockedReason).toMatch(/submission/);
    expect((await call(c, MSG.CONFIRM, { kind: 'payment' })).ok).toBe(false);
  });

  it('shows recipient, amount, fees, total and purpose, and needs its own confirmation', async () => {
    const c = world.coordinator();
    await submitFirst(c);
    const res = await call(c, MSG.GET_VIEW);
    const lines = Object.fromEntries(tx(res).lines.map((l) => [l.label, l.value]));
    expect(tx(res).kind).toBe('payment');
    expect(lines).toMatchObject({ Recipient: 'Demo County Revenue Authority', Amount: 'KES 2,500.00', Fees: 'KES 50.00', Total: 'KES 2,550.00', Purpose: 'Business permit renewal (demo)' });
    expect((await call(c, MSG.EXECUTE, { kind: 'payment' })).ok).toBe(false);
    expect(world.clicks).toEqual([]);
  });

  it('a submission confirmation cannot pay; a payment confirmation pays once', async () => {
    const c = world.coordinator();
    await submitFirst(c);
    await call(c, MSG.GET_VIEW);
    expect((await call(c, MSG.CONFIRM, { kind: 'submission' })).ok).toBe(false);
    expect((await call(c, MSG.CONFIRM, { kind: 'payment' })).ok).toBe(true);
    expect((await call(c, MSG.EXECUTE, { kind: 'payment' })).ok).toBe(true);
    expect(world.clicks).toEqual(['Pay now']);
  });

  it('a changed amount after confirming invalidates the payment confirmation', async () => {
    const c = world.coordinator();
    await submitFirst(c);
    await call(c, MSG.GET_VIEW);
    await call(c, MSG.CONFIRM, { kind: 'payment' });
    document.getElementById('pay-amount').textContent = 'KES 2,600.00';
    document.getElementById('pay-total').textContent = 'KES 2,650.00';
    const view = await call(c, MSG.GET_VIEW);
    expect(tx(view).status).toBe('awaiting_confirmation');
    expect(tx(view).notice.text).toMatch(/no longer valid/i);
    expect((await call(c, MSG.EXECUTE, { kind: 'payment' })).ok).toBe(false);
    expect(world.clicks).toEqual([]);
  });

  it('inconsistent totals are never offered for confirmation', async () => {
    const c = world.coordinator();
    await submitFirst(c);
    document.getElementById('pay-total').textContent = 'KES 9,999.00';
    const res = await call(c, MSG.GET_VIEW);
    expect(tx(res)).toBeNull();
    expect((await call(c, MSG.CONFIRM, { kind: 'payment' })).ok).toBe(false);
  });

  it('reaching the receipt completes the payment; the receipt can be read', async () => {
    const c = world.coordinator();
    await submitFirst(c);
    await call(c, MSG.GET_VIEW);
    await call(c, MSG.CONFIRM, { kind: 'payment' });
    await call(c, MSG.EXECUTE, { kind: 'payment' });
    world.load('receipt.html');
    document.getElementById('receipt').innerHTML = '<dt>Receipt number</dt><dd>DEMO-1234</dd>';
    const res = await call(c, MSG.COMMAND, { text: 'read receipt' });
    expect(res.message).toContain('DEMO-1234');
    expect(res.view.transaction.completed).toEqual({ submission: true, payment: true });
    expect(res.view.transaction.pending).toBeNull();
  });
});

describe('commands through the coordinator', () => {
  it('where am I / list fields / go to / next on the demo', async () => {
    world.load('personal.html');
    const c = world.coordinator();
    const where = await call(c, MSG.COMMAND, { text: 'where am I' });
    expect(where.message).toContain('Personal details');
    expect(where.message).toContain('6 fields, 6 required, 6 empty');
    const list = await call(c, MSG.COMMAND, { text: 'list fields' });
    expect(list.lines[0]).toBe('1. Full name, text, required, empty.');
    const go = await call(c, MSG.COMMAND, { text: 'go to national id' });
    expect(go.message).toContain('National ID number');
    expect(document.activeElement.id).toBe('nationalid');
    const next = await call(c, MSG.COMMAND, { text: 'next' });
    expect(next.message).toContain('Next required field');
  });

  it('typed values never appear in any result', async () => {
    world.load('personal.html');
    document.getElementById('fullname').value = 'Wanjiru Kamau';
    const c = world.coordinator();
    const outputs = [await call(c, MSG.COMMAND, { text: 'list fields' }), await call(c, MSG.COMMAND, { text: 'where am i' }), await call(c, MSG.GET_VIEW)];
    expect(JSON.stringify(outputs)).not.toContain('Wanjiru');
  });

  it('read back works only after the preference is enabled and never for sensitive fields', async () => {
    world.load('review.html');
    document.getElementById('otp').value = '123456';
    const c = world.coordinator();
    expect((await call(c, MSG.COMMAND, { text: 'read back verification code' })).message).toMatch(/off/i);
    await call(c, MSG.SET_PREFS, { prefs: { readBackEnabled: true } });
    const res = await call(c, MSG.COMMAND, { text: 'read back verification code' });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain('123456');
  });

  it('pay on a non-payment page is refused and nothing is clicked', async () => {
    world.load('personal.html');
    const c = world.coordinator();
    expect((await call(c, MSG.COMMAND, { text: 'pay now' })).ok).toBe(false);
    expect(world.clicks).toEqual([]);
  });

  it('works on any other website using generic discovery, and reports an unknown page', async () => {
    world.load('personal.html', 'https://example.org/signup');
    const c = world.coordinator();
    const where = await call(c, MSG.COMMAND, { text: 'where am I' });
    expect(where.message).toContain('unknown page');
    const res = await call(c, MSG.GET_VIEW);
    expect(res.view).toMatchObject({ service: 'Any website', stage: null });
    expect((await call(c, MSG.COMMAND, { text: 'go to full name' })).ok).toBe(true);
    expect((await call(c, MSG.COMMAND, { text: 'submit' })).ok).toBe(false);
  });

  it('on any other website a payment or submission can never be confirmed or executed', async () => {
    world.load('payment.html', 'https://shop.example/checkout');
    const c = world.coordinator();
    await call(c, MSG.GET_VIEW);
    expect((await call(c, MSG.CONFIRM, { kind: 'payment' })).ok).toBe(false);
    expect((await call(c, MSG.EXECUTE, { kind: 'payment' })).ok).toBe(false);
    expect(world.clicks).toEqual([]);
  });

  it('reports a readable problem when the page cannot be reached', async () => {
    const c = world.coordinator();
    world.bridge.ensure = async () => ({ ok: false, problem: 'No page is open in this window.' });
    const res = await call(c, MSG.COMMAND, { text: 'where am i' });
    expect(res).toMatchObject({ ok: false, message: 'No page is open in this window.' });
    expect((await call(c, MSG.COMMAND, { text: 'help' })).ok).toBe(true);
  });
});

describe('message validation at the coordinator', () => {
  it('rejects the content script confirming or executing', async () => {
    world.load('review.html');
    const c = world.coordinator();
    await call(c, MSG.GET_VIEW);
    expect((await call(c, MSG.CONFIRM, { kind: 'submission' }, contentSender)).ok).toBe(false);
    expect((await call(c, MSG.EXECUTE, { kind: 'submission' }, contentSender)).ok).toBe(false);
  });

  it('rejects foreign senders and malformed messages', async () => {
    world.load('review.html');
    const c = world.coordinator();
    expect((await call(c, MSG.GET_VIEW, {}, { id: 'someone-else', url: ids.sidepanelUrl })).ok).toBe(false);
    expect((await c.handle({ type: MSG.CONFIRM }, panel)).ok).toBe(false);
    expect((await c.handle({ v: 1, type: MSG.CONFIRM, payload: { kind: 'refund' } }, panel)).ok).toBe(false);
    expect((await c.handle('confirm', panel)).ok).toBe(false);
  });
});

describe('persistence across a service worker restart', () => {
  it('workflow position, preferences and a live confirmation survive a brand new coordinator', async () => {
    world.load('review.html');
    const first = world.coordinator();
    await call(first, MSG.GET_VIEW);
    await call(first, MSG.SET_PREFS, { prefs: { verbosity: 'minimal', textSize: 'large' } });
    await call(first, MSG.CONFIRM, { kind: 'submission' });

    const reborn = world.coordinator(); // same storage, no in-memory state
    const res = await call(reborn, MSG.GET_VIEW);
    expect(res.view.savedPosition).toMatchObject({ stageId: 'review', furthestIndex: 2 });
    expect(res.view.prefs).toMatchObject({ verbosity: 'minimal', textSize: 'large', readBackEnabled: false });
    expect(tx(res).status).toBe('confirmed');
    expect((await call(reborn, MSG.EXECUTE, { kind: 'submission' })).ok).toBe(true);
  });

  it('a saved position is kept but not shown as current on another website', async () => {
    world.load('payment.html');
    await call(world.coordinator(), MSG.GET_VIEW);
    world.load('personal.html', 'https://example.org/');
    const res = await call(world.coordinator(), MSG.GET_VIEW);
    expect(res.view.stage).toBeNull();
    expect(res.view.savedPosition.stageId).toBe('payment');
  });

  it('reset clears progress and any pending confirmation', async () => {
    world.load('review.html');
    const c = world.coordinator();
    await call(c, MSG.GET_VIEW);
    await call(c, MSG.CONFIRM, { kind: 'submission' });
    const res = await call(c, MSG.RESET);
    expect(tx(res).status).toBe('awaiting_confirmation');
    expect((await call(c, MSG.EXECUTE, { kind: 'submission' })).ok).toBe(false);
  });
});

describe('status', () => {
  it('reports standalone mode truthfully', async () => {
    const res = await call(world.coordinator(), MSG.GET_STATUS);
    expect(res.status).toMatchObject({ mode: 'standalone', integrated: false, worker: 'running' });
  });
});
