// Service worker: wires Chrome APIs to the coordinator. Stateless between events; all state lives in chrome.storage.
import { createCoordinator } from './coordinator.js';
import { MSG, makeMessage } from '../communication/message-contracts.js';
import { NEED_ACCESS } from '../commands/command-handlers.js';
import { createChromeStorage } from '../prefs/storage-adapter.js';
import { getProvider } from '../toolkit/toolkit-integration.js';
import { DEMO_WORKFLOW } from '../demo/demo-workflow.js';

const ids = {
  extensionId: chrome.runtime.id,
  extensionOrigin: chrome.runtime.getURL(''),
  sidepanelUrl: chrome.runtime.getURL('sidepanel/index.html'),
};

// Clicking the toolbar icon (or the shortcut) fires action.onClicked, which is what grants activeTab for that tab.
// We open the panel ourselves instead of using openPanelOnActionClick, so the grant is certain.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
chrome.action.onClicked.addListener((tab) => {
  // sidePanel.open must be called synchronously inside the click, so there is no await before it.
  if (tab?.id !== undefined) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  notifyPanel(); // an already-open panel re-reads the page now that access is granted
});

// ---- the only module that touches the provider: expose it to the coordinator through a lazy wrapper ----
const provider = {
  getProfile: async () => (await getProvider()).getProfile(),
  saveProfile: async (p) => (await getProvider()).saveProfile(p),
  getStatus: async () => (await getProvider()).getStatus(),
};

/** Turns Chrome's injection error into something the user can act on. */
function explainInjectionFailure(message) {
  if (/chrome:|chrome-extension:|extensions gallery|web ?store|devtools/i.test(message)) {
    return 'Chrome does not let extensions read this kind of page (chrome:// pages, the New Tab page, the Chrome Web Store). Open an ordinary website, then try again.';
  }
  if (/file:/i.test(message)) {
    return 'This is a local file. Turn on "Allow access to file URLs" for Pay Without Sight in chrome://extensions, then reload the page.';
  }
  return 'I do not have access to this page yet. Click the Pay Without Sight icon in the toolbar while this page is showing, then try again. Access ends when you move to a different site.';
}

// ---- bridge to the active tab's content script (injected on demand, never declared in the manifest) ----
function createBridge() {
  let tabId = null;
  const ping = (id) => chrome.tabs.sendMessage(id, makeMessage(MSG.PING)).catch(() => null);
  return {
    async ensure() {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.id) return { ok: false, problem: 'No page is open in this window.' };
      let res = await ping(tab.id);
      if (!res?.ok) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
        } catch (e) {
          return { ok: false, problem: explainInjectionFailure(String(e?.message ?? '')) };
        }
        res = await ping(tab.id);
      }
      if (!res?.ok || typeof res.href !== 'string') return { ok: false, problem: NEED_ACCESS };
      tabId = tab.id;
      return { ok: true, href: res.href };
    },
    async send(type, payload) {
      if (tabId === null) return { ok: false, reason: 'no_tab' };
      try {
        return await chrome.tabs.sendMessage(tabId, makeMessage(type, payload));
      } catch (e) {
        // A click that navigates the page can close the reply channel after the click happened.
        return { ok: false, navigated: type === MSG.CLICK && /closed|port|receiving end/i.test(String(e?.message)) };
      }
    },
  };
}

// ---- pushing "something changed" to the open side panel ----
const panelPorts = new Set();
let pushTimer = null;
function notifyPanel() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    for (const port of panelPorts) {
      try {
        port.postMessage(makeMessage(MSG.VIEW_UPDATE));
      } catch {
        panelPorts.delete(port);
      }
    }
  }, 150);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'pws-panel' || port.sender?.id !== ids.extensionId || port.sender?.url !== ids.sidepanelUrl) {
    port.disconnect();
    return;
  }
  panelPorts.add(port);
  port.onDisconnect.addListener(() => panelPorts.delete(port));
});

chrome.tabs.onActivated.addListener(notifyPanel);
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === 'complete') notifyPanel();
});

// ---- the coordinator (built per worker start; it reloads persisted state on every operation) ----
const coordinator = createCoordinator({
  ids,
  local: createChromeStorage(chrome.storage.local),
  session: createChromeStorage(chrome.storage.session),
  bridge: createBridge(),
  provider,
  workflow: DEMO_WORKFLOW,
  notifyPanel,
});

// Registered synchronously at top level so Chrome can wake a suspended worker for it.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  coordinator
    .handle(msg, sender)
    .then(sendResponse, () => sendResponse({ ok: false, error: 'Something went wrong. Nothing was sent.' }));
  return true; // reply asynchronously
});
