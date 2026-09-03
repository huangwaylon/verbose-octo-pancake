/**
 * Get-or-make against a `Map`, in one place. Pure and dependency-free, so `money.js` and `dates.js`
 * can use it without reaching for anything that reads the i18n singleton. The key must name
 * everything that decides the value: keyed on less than the options it passes, this hands back a
 * formatter built for a different shape.
 */
export function cached(store, key, make) {
  // `has`, not truthiness: a falsy cached value would be rebuilt on every call — silently, since
  // the value is right.
  if (store.has(key)) return store.get(key)
  const value = make()
  store.set(key, value)
  return value
}
