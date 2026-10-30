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

/**
 * Whether two flat records hold the same values, key for key; an array value compares by its items.
 * Key-driven rather than a field list, so a field added later is covered: a list that missed one
 * would call two different rows equal and freeze the newer off the screen. It decides when a read
 * may keep the object already on screen, which is the identity every `memo` compares.
 */
export function sameFields(a, b) {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => {
    const x = a[key]
    const y = b[key]
    if (Array.isArray(x) && Array.isArray(y)) {
      return x.length === y.length && x.every((item, index) => item === y[index])
    }
    return x === y
  })
}
