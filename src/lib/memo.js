/**
 * Get-or-make against a `Map`, in one place.
 *
 * Every caller is memoising an `Intl` constructor, which costs an order of magnitude more
 * than reusing one and is asked for once per amount and per day heading in a month's
 * ledger. Pure and dependency-free, so `money.js` and `dates.js` can use it without
 * reaching for anything that reads the i18n singleton.
 *
 * The key must name everything that decides the value: a cache keyed on less than the
 * options it passes hands back a formatter built for a different shape.
 */
export function cached(store, key, make) {
  // `has`, not truthiness: a cached value that is falsy would be rebuilt on every call,
  // which is exactly the cost this exists to avoid — silently, since the value is right.
  if (store.has(key)) return store.get(key)
  const value = make()
  store.set(key, value)
  return value
}
