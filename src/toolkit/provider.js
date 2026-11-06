// The AccessibilityProvider contract: the single shape the rest of the extension may rely on.

/**
 * @typedef {Object} ProviderCapabilities
 * @property {boolean} profileStore       a reusable accessibility profile store (e.g. Librarian / AbilityModel)
 * @property {boolean} kvPersistence      persistence supplied by the toolkit's KVStore port
 * @property {boolean} adaptationConsent  consent for adaptation proposals (never transaction confirmation)
 * @property {boolean} surfaceRendering   toolkit surface renderers for display settings
 * @property {boolean} skills             skills and registry
 * @property {boolean} pageAudit          auditors such as unlabeled-control checks
 * @property {boolean} aiProvider         optional AI via a backend (never an authority over transactions)
 */

/**
 * @typedef {Object} ProviderStatus
 * @property {'standalone'|'integrated'} mode
 * @property {boolean} integrated
 */

/**
 * @typedef {Object} AccessibilityProvider
 * @property {() => Promise<void>} init
 * @property {() => Promise<ProviderStatus>} getStatus
 * @property {() => Promise<object>} getProfile
 * @property {(profile: object) => Promise<object>} saveProfile
 * @property {() => Promise<{textSizePx:number}>} getSurfaceSettings
 * @property {ProviderCapabilities} capabilities
 */

export const CAPABILITY_KEYS = Object.freeze([
  'profileStore',
  'kvPersistence',
  'adaptationConsent',
  'surfaceRendering',
  'skills',
  'pageAudit',
  'aiProvider',
]);

/** Throws if an object does not satisfy the contract. Used by tests and by toolkit-integration. */
export function assertProvider(p) {
  for (const fn of ['init', 'getStatus', 'getProfile', 'saveProfile', 'getSurfaceSettings']) {
    if (typeof p?.[fn] !== 'function') throw new Error(`AccessibilityProvider is missing ${fn}()`);
  }
  for (const key of CAPABILITY_KEYS) {
    if (typeof p.capabilities?.[key] !== 'boolean') throw new Error(`AccessibilityProvider.capabilities.${key} must be a boolean`);
  }
  return p;
}
