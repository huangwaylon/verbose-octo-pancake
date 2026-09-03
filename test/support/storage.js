/**
 * The fake `localStorage` the module-state tests need: vitest runs in `environment: 'node'`,
 * and both `connection.js` and `snapshot.js` read storage at import time — hence a module
 * loaded fresh per test against a seeded store rather than one store mutated.
 */

/** Returns the live store, so a test can assert on what was written. */
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
