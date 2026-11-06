// The v0 default provider: everything comes from our own preferences, and every toolkit capability is false.
import { loadPrefs, savePrefs, TEXT_SIZE_PX } from '../prefs/app-prefs.js';

/**
 * @param {{ storage: { get(key:string):Promise<any>, set(key:string, value:any):Promise<void> } }} deps
 * @returns {import('./provider.js').AccessibilityProvider}
 */
export function createStandaloneProvider({ storage }) {
  return {
    capabilities: Object.freeze({
      profileStore: false,
      kvPersistence: false,
      adaptationConsent: false,
      surfaceRendering: false,
      skills: false,
      pageAudit: false,
      aiProvider: false,
    }),
    async init() {},
    async getStatus() {
      return { mode: 'standalone', integrated: false };
    },
    async getProfile() {
      return loadPrefs(storage);
    },
    async saveProfile(profile) {
      return savePrefs(storage, profile);
    },
    async getSurfaceSettings() {
      const prefs = await loadPrefs(storage);
      return { textSizePx: TEXT_SIZE_PX[prefs.textSize] };
    },
  };
}
