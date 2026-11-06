// Our own preference model: verbosity, read-back opt-in, instruction text size. Stored under the "pws." namespace.

export const PREFS_KEY = 'pws.prefs.v1';

export const DEFAULT_PREFS = Object.freeze({
  verbosity: 'normal', // 'minimal' | 'normal'
  readBackEnabled: false, // reading ordinary field values back on request; off by default
  textSize: 'normal', // 'normal' | 'large' | 'xlarge'
});

export const TEXT_SIZE_PX = Object.freeze({ normal: 18, large: 22, xlarge: 28 });

const ENUMS = {
  verbosity: ['minimal', 'normal'],
  textSize: ['normal', 'large', 'xlarge'],
};

/** Keeps only known keys with valid values; anything else falls back to the default. */
export function sanitizePrefs(input, base = DEFAULT_PREFS) {
  const out = { ...base };
  if (input && typeof input === 'object') {
    for (const key of Object.keys(DEFAULT_PREFS)) {
      if (!Object.hasOwn(input, key)) continue;
      const v = input[key];
      if (ENUMS[key]) {
        if (ENUMS[key].includes(v)) out[key] = v;
      } else if (typeof DEFAULT_PREFS[key] === 'boolean') {
        if (typeof v === 'boolean') out[key] = v;
      }
    }
  }
  return out;
}

export async function loadPrefs(storage) {
  return sanitizePrefs(await storage.get(PREFS_KEY));
}

/** Merges a partial update into the stored prefs and returns the result. */
export async function savePrefs(storage, partial) {
  const merged = sanitizePrefs(partial, await loadPrefs(storage));
  await storage.set(PREFS_KEY, merged);
  return merged;
}
