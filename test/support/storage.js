/**
 * The fake `localStorage` the module-state tests need.
 *
 * vitest runs in `environment: 'node'`, so there is none to speak of — and both
 * `connection.js` and `snapshot.js` read storage at import time, which is why each
 * test loads its module fresh against a seeded store rather than mutating one.
 */

/**
 * @param {Record<string, string>} seed initial contents
 * @returns {Map<string, string>} the live store, so a test can assert on writes
 */
export function installStorage(seed = {}) {
  const store = new Map(Object.entries(seed))
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  return store
}

/** For `afterEach`: leaving a global behind leaks into every other file. */
export function removeStorage() {
  delete globalThis.localStorage
}
