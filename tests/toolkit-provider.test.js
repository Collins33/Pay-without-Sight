// Tests for the standalone provider and the single provider factory: capabilities false, truthful status, own prefs.
import { describe, it, expect } from 'vitest';
import { createProvider } from '../src/toolkit/toolkit-integration.js';
import { createStandaloneProvider } from '../src/toolkit/standalone-provider.js';
import { assertProvider } from '../src/toolkit/provider.js';
import { createMemoryStorage } from '../src/prefs/storage-adapter.js';

describe('standalone provider', () => {
  it('reports standalone, not integrated, with every capability false', async () => {
    const p = await createProvider(createMemoryStorage());
    expect(await p.getStatus()).toEqual({ mode: 'standalone', integrated: false });
    expect(Object.keys(p.capabilities).sort()).toEqual(['adaptationConsent', 'aiProvider', 'kvPersistence', 'pageAudit', 'profileStore', 'skills', 'surfaceRendering']);
    expect(Object.values(p.capabilities).every((v) => v === false)).toBe(true);
  });

  it('serves the profile and surface settings from our own prefs', async () => {
    const storage = createMemoryStorage();
    const p = await createProvider(storage);
    expect((await p.getProfile()).readBackEnabled).toBe(false);
    await p.saveProfile({ textSize: 'xlarge', verbosity: 'minimal' });
    expect(await p.getProfile()).toMatchObject({ textSize: 'xlarge', verbosity: 'minimal' });
    expect(await p.getSurfaceSettings()).toEqual({ textSizePx: 28 });
    expect(Object.keys(storage._dump()).every((k) => k.startsWith('pws.'))).toBe(true);
  });

  it('assertProvider rejects an incomplete provider', () => {
    expect(() => assertProvider({})).toThrow();
    expect(() => assertProvider(createStandaloneProvider({ storage: createMemoryStorage() }))).not.toThrow();
  });
});
