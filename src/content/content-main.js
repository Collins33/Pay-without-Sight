// Content script entry: injected on demand. Answers validated messages from the service worker only.
import { MSG, makeMessage, validateMessage } from '../communication/message-contracts.js';
import { createDiscovery, readTextBySelector } from './form-discovery.js';
import { watchPage } from './page-observer.js';
import { focusElement, clickAction, readBackValue } from './interaction-manager.js';

(function init() {
  if (globalThis.__pwsContentLoaded) return; // guard against double injection in this isolated world
  globalThis.__pwsContentLoaded = true;

  const discovery = createDiscovery(document);
  const ctx = {
    extensionId: chrome.runtime.id,
    extensionOrigin: chrome.runtime.getURL(''),
    sidepanelUrl: chrome.runtime.getURL('sidepanel/index.html'),
  };
  let lastOptions = {};

  function handle(type, payload) {
    switch (type) {
      case MSG.PING:
        return { ok: true, href: location.href };
      case MSG.DISCOVER:
        lastOptions = { detailSelectors: payload.detailSelectors ?? {}, fingerprintSelectors: payload.fingerprintSelectors ?? {} };
        return { ok: true, result: discovery.discover(lastOptions), receipt: payload.receiptSelector ? readTextBySelector(document, payload.receiptSelector) : null };
      case MSG.FOCUS: {
        if (!discovery.getEntry(payload.fieldId)) discovery.discover(lastOptions);
        const el = discovery.getElement(payload.fieldId);
        return el ? focusElement(el) : { ok: false, reason: 'not_found' };
      }
      case MSG.CLICK: {
        if (!discovery.getEntry(payload.actionId)) discovery.discover(lastOptions);
        const el = discovery.getElement(payload.actionId);
        if (!el) return { ok: false, reason: 'not_found' };
        // clickAction refuses any consequential control without a valid, matching, unexpired grant.
        return clickAction(el, { grant: payload.grant, now: () => Date.now() });
      }
      case MSG.READ_BACK: {
        if (!discovery.getEntry(payload.fieldId)) discovery.discover(lastOptions);
        const entry = discovery.getEntry(payload.fieldId);
        // The service worker only asks when the user enabled read-back; the page is told so explicitly.
        return entry ? readBackValue(entry.el, { enabled: true }) : { ok: false, reason: 'not_found' };
      }
      case MSG.READ_TEXT: {
        const text = readTextBySelector(document, payload.selector);
        return text ? { ok: true, text } : { ok: false, reason: 'not_found' };
      }
      default:
        return { ok: false, error: 'Unhandled message type.' };
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const checked = validateMessage(msg, sender, ctx);
    if (!checked.ok) {
      sendResponse({ ok: false, error: checked.error });
      return false;
    }
    if (checked.role !== 'service-worker') {
      sendResponse({ ok: false, error: 'Rejected: only the service worker may command the page.' });
      return false;
    }
    try {
      sendResponse(handle(checked.type, checked.payload));
    } catch {
      sendResponse({ ok: false, error: 'The page could not be read.' });
    }
    return false;
  });

  const notify = (reason) => {
    try {
      const p = chrome.runtime.sendMessage(makeMessage(MSG.PAGE_EVENT, { reason }));
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* extension reloaded or panel closed */ }
  };
  watchPage(document, notify);
  notify('ready');
})();
