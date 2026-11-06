// Unit tests for message contracts: schema, type, sender id and role validation.
import { describe, it, expect } from 'vitest';
import { MSG, makeMessage, validateMessage, senderRole, isWellFormedGrant } from '../src/communication/message-contracts.js';

const ctx = {
  extensionId: 'abcdefghijklmnop',
  extensionOrigin: 'chrome-extension://abcdefghijklmnop/',
  sidepanelUrl: 'chrome-extension://abcdefghijklmnop/sidepanel/index.html',
};
const panel = { id: ctx.extensionId, url: ctx.sidepanelUrl };
const content = { id: ctx.extensionId, tab: { id: 5 }, url: 'https://example.org/' };
const worker = { id: ctx.extensionId, url: 'chrome-extension://abcdefghijklmnop/background/service-worker.js' };

describe('senderRole', () => {
  it('identifies the three components', () => {
    expect(senderRole(panel, ctx)).toBe('sidepanel');
    expect(senderRole(content, ctx)).toBe('content');
    expect(senderRole(worker, ctx)).toBe('service-worker');
  });
  it('still recognises the side panel when it is opened in a tab, and never mistakes other extension pages for a content script', () => {
    expect(senderRole({ ...panel, tab: { id: 9 } }, ctx)).toBe('sidepanel');
    expect(senderRole({ id: ctx.extensionId, tab: { id: 9 }, url: 'chrome-extension://abcdefghijklmnop/other.html' }, ctx)).toBeNull();
  });
  it('rejects foreign extension ids and missing senders', () => {
    expect(senderRole({ ...panel, id: 'someoneelse' }, ctx)).toBeNull();
    expect(senderRole(undefined, ctx)).toBeNull();
    expect(senderRole({ url: ctx.sidepanelUrl }, ctx)).toBeNull();
  });
  it('rejects an extension page that is not the side panel or worker', () => {
    expect(senderRole({ id: ctx.extensionId, url: 'https://evil.example/' }, ctx)).toBeNull();
  });
});

describe('validateMessage', () => {
  it('accepts well-formed messages from the right sender', () => {
    expect(validateMessage(makeMessage(MSG.COMMAND, { text: 'where am i' }), panel, ctx)).toMatchObject({ ok: true, type: MSG.COMMAND, role: 'sidepanel' });
    expect(validateMessage(makeMessage(MSG.PAGE_EVENT, { reason: 'input' }), content, ctx).ok).toBe(true);
    expect(validateMessage(makeMessage(MSG.PING), worker, ctx).ok).toBe(true);
  });

  it('rejects unexpected senders', () => {
    expect(validateMessage(makeMessage(MSG.GET_VIEW), { id: 'x' }, ctx).ok).toBe(false);
    expect(validateMessage(makeMessage(MSG.GET_VIEW), undefined, ctx).ok).toBe(false);
  });

  it('rejects the wrong role for a type (a page cannot confirm a payment)', () => {
    expect(validateMessage(makeMessage(MSG.CONFIRM, { kind: 'payment' }), content, ctx).ok).toBe(false);
    expect(validateMessage(makeMessage(MSG.EXECUTE, { kind: 'payment' }), content, ctx).ok).toBe(false);
    expect(validateMessage(makeMessage(MSG.CLICK, { actionId: 'a1' }), panel, ctx).ok).toBe(false);
  });

  it('rejects malformed shapes', () => {
    for (const bad of [null, undefined, 'text', 42, [], { type: MSG.GET_VIEW }, { v: 1 }, { v: 2, type: MSG.GET_VIEW, payload: {} },
      { v: 1, type: 'pws/unknown', payload: {} }, { v: 1, type: MSG.GET_VIEW, payload: [] }, { v: 1, type: MSG.GET_VIEW, payload: {}, extra: 1 }]) {
      expect(validateMessage(bad, panel, ctx).ok).toBe(false);
    }
  });

  it('rejects bad payloads', () => {
    expect(validateMessage(makeMessage(MSG.COMMAND, {}), panel, ctx).ok).toBe(false);
    expect(validateMessage(makeMessage(MSG.COMMAND, { text: 5 }), panel, ctx).ok).toBe(false);
    expect(validateMessage(makeMessage(MSG.COMMAND, { text: 'x'.repeat(201) }), panel, ctx).ok).toBe(false);
    expect(validateMessage(makeMessage(MSG.CONFIRM, { kind: 'transfer' }), panel, ctx).ok).toBe(false);
    expect(validateMessage(makeMessage(MSG.COMMAND, { text: 'help', extra: true }), panel, ctx).ok).toBe(false);
    expect(validateMessage(makeMessage(MSG.PAGE_EVENT, { reason: 'click' }), content, ctx).ok).toBe(false);
  });

  it('rejects prototype pollution style payloads and oversized messages', () => {
    const polluted = JSON.parse('{"v":1,"type":"pws/command","payload":{"text":"help","__proto__":{"x":1}}}');
    // JSON.parse makes __proto__ an own key, which the strict extra-field check rejects.
    expect(validateMessage(polluted, panel, ctx).ok).toBe(false);
    const withCtor = { v: 1, type: MSG.COMMAND, payload: { text: 'help', constructor: 'x' } };
    expect(validateMessage(withCtor, panel, ctx).ok).toBe(false);
    expect(validateMessage(makeMessage(MSG.SET_PREFS, { prefs: { a: 'x'.repeat(30000) } }), panel, ctx).ok).toBe(false);
  });

  it('validates discover selectors as a bounded string map', () => {
    const ok = makeMessage(MSG.DISCOVER, { detailSelectors: { recipient: '#r' }, receiptSelector: '#receipt' });
    expect(validateMessage(ok, worker, ctx).ok).toBe(true);
    expect(validateMessage(makeMessage(MSG.DISCOVER, { detailSelectors: { recipient: 5 } }), worker, ctx).ok).toBe(false);
  });
});

describe('isWellFormedGrant', () => {
  it('accepts only complete grants', () => {
    expect(isWellFormedGrant({ kind: 'payment', token: '12345678', expiresAt: 5 })).toBe(true);
    expect(isWellFormedGrant({ kind: 'payment', token: 'short', expiresAt: 5 })).toBe(false);
    expect(isWellFormedGrant({ kind: 'other', token: '12345678', expiresAt: 5 })).toBe(false);
    expect(isWellFormedGrant(null)).toBe(false);
  });
});
