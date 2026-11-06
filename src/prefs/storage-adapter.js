// Thin key/value storage adapters: one over a chrome.storage area, one in memory for tests.

/** @param {chrome.storage.StorageArea} area */
export function createChromeStorage(area) {
  return {
    async get(key) {
      const result = await area.get(key);
      return result && key in result ? result[key] : null;
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
  };
}

export function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    async get(key) {
      return data.has(key) ? structuredClone(data.get(key)) : null;
    },
    async set(key, value) {
      data.set(key, structuredClone(value));
    },
    async remove(key) {
      data.delete(key);
    },
    _dump: () => Object.fromEntries(data),
  };
}
