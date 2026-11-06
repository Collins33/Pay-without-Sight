// The ONLY module that constructs an AccessibilityProvider. Today it returns the standalone provider.
import { createStandaloneProvider } from './standalone-provider.js';
import { assertProvider } from './provider.js';
import { createChromeStorage } from '../prefs/storage-adapter.js';

/** Builds a provider over the given storage. Exported so tests can inject an in-memory store. */
export async function createProvider(storage) {
  // ---------------------------------------------------------------------------------------------
  // FUTURE SEAM: the AI for Accessibility Toolkit plugs in HERE and nowhere else.
  //
  //   import { createToolkit } from '<toolkit package>';          // not installed in v0
  //   const { datastore, librarian } = createToolkit({
  //     ports: {
  //       KVStore:   /* required: wrap chrome.storage.local under a namespace separate from "pws." */,
  //       Clock:     /* () => Date.now() */,
  //       Scheduler: /* chrome.alarms based */,
  //       Consent:   /* adaptation consent, surfaced in the side panel. NEVER used for transactions */,
  //       Actuation: /* the actuation port */,
  //     },
  //   });
  //   return assertProvider(createToolkitProvider({ datastore, librarian, fallback: standalone }));
  //
  // Verify every name and signature above against the toolkit's own source before wiring it in.
  // Transaction confirmation (src/safety) must stay completely separate from toolkit consent.
  // ---------------------------------------------------------------------------------------------
  const provider = assertProvider(createStandaloneProvider({ storage }));
  await provider.init();
  return provider;
}

let providerPromise = null;

/** Initialised once per service worker start. */
export function getProvider() {
  if (!providerPromise) providerPromise = createProvider(createChromeStorage(chrome.storage.local));
  return providerPromise;
}
