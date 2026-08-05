import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { CATALOGS, DEFAULT_LOCALE, LOCALE_LABELS, SUPPORTED } from '../src/i18n/catalogs.js'
import { getLocale, interpolate, setLocale, t, translate } from '../src/i18n/index.js'

/**
 * The catalogs are data maintained by hand, so the interesting failures are
 * structural: a key added to one locale and not the other, a translator writing
 * {cnt} for {count}, a plural branch missing. Every check here is one of those.
 *
 * The locale is a module singleton, so anything that changes it must put it back
 * or the state leaks into other files.
 */
afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

const OTHER_LOCALES = SUPPORTED.filter((tag) => tag !== DEFAULT_LOCALE)

/** Keys whose translation is legitimately identical to the English. */
const SAME_IN_BOTH = new Set([
  // Each language is named in its own language in the switcher.
  'settings.language.en',
  'settings.language.ja',
  // A percent sign and a bare "0" are the same string in both languages. They
  // stay in the catalog rather than being inlined so the *placement* of the
  // symbol remains a translation decision.
  'summary.share',
  'form.amountPlaceholder',
])

function placeholdersIn(value) {
  const found = new Set()
  const collect = (text) => {
    for (const match of String(text).matchAll(/\{(\w+)\}/g)) found.add(match[1])
  }
  if (value && typeof value === 'object') Object.values(value).forEach(collect)
  else collect(value)
  return found
}

describe('catalog parity', () => {
  it.each(OTHER_LOCALES)('%s has exactly the same keys as the reference locale', (tag) => {
    const reference = Object.keys(CATALOGS[DEFAULT_LOCALE]).sort()
    const other = Object.keys(CATALOGS[tag]).sort()

    const missing = reference.filter((key) => !CATALOGS[tag][key])
    const extra = other.filter((key) => !(key in CATALOGS[DEFAULT_LOCALE]))
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  it.each(OTHER_LOCALES)('%s uses the same value shape per key', (tag) => {
    const mismatched = Object.keys(CATALOGS[DEFAULT_LOCALE]).filter(
      (key) => typeof CATALOGS[tag][key] !== typeof CATALOGS[DEFAULT_LOCALE][key],
    )
    expect(mismatched).toEqual([])
  })

  it.each(OTHER_LOCALES)('%s interpolates exactly the same placeholders', (tag) => {
    const drifted = []
    for (const key of Object.keys(CATALOGS[DEFAULT_LOCALE])) {
      const expected = [...placeholdersIn(CATALOGS[DEFAULT_LOCALE][key])].sort()
      const actual = [...placeholdersIn(CATALOGS[tag][key])].sort()
      if (expected.join() !== actual.join()) drifted.push({ key, expected, actual })
    }
    // This is the check that stops a literal "{payer}" reaching a user.
    expect(drifted).toEqual([])
  })

  it.each(SUPPORTED)('%s supplies every plural category its locale actually has', (tag) => {
    const categories = new Intl.PluralRules(tag).resolvedOptions().pluralCategories.sort()
    const wrong = []
    for (const [key, value] of Object.entries(CATALOGS[tag])) {
      if (!value || typeof value !== 'object') continue
      const branches = Object.keys(value).sort()
      // Exact, not superset: catches a missing 'one' in en AND a redundant
      // 'one' in ja, and stays correct for any locale added later.
      if (branches.join() !== categories.join()) wrong.push({ key, branches, categories })
    }
    expect(wrong).toEqual([])
  })

  it.each(SUPPORTED)('%s has no blank values', (tag) => {
    const blank = Object.entries(CATALOGS[tag])
      .filter(([, value]) =>
        value && typeof value === 'object'
          ? Object.values(value).some((branch) => !String(branch).trim())
          : !String(value).trim(),
      )
      .map(([key]) => key)
    expect(blank).toEqual([])
  })

  it.each(OTHER_LOCALES)('%s is actually translated, not copy-pasted English', (tag) => {
    const untranslated = Object.keys(CATALOGS[DEFAULT_LOCALE]).filter((key) => {
      if (SAME_IN_BOTH.has(key)) return false
      const a = CATALOGS[DEFAULT_LOCALE][key]
      const b = CATALOGS[tag][key]
      if (typeof a === 'object') return false
      return a === b
    })
    expect(untranslated).toEqual([])
  })
})

describe('catalog usage', () => {
  /** Keys built at runtime from a code, e.g. t(`error.${code}`). */
  const DYNAMIC_PREFIXES = ['error.']

  function sourceFiles(dir, found = []) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) sourceFiles(path, found)
      else if (/\.jsx?$/.test(name)) found.push(path)
    }
    return found
  }

  const referenced = new Set()
  for (const file of sourceFiles('src')) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\b(?:t|tn)\(\s*['"]([\w.]+)['"]/g)) {
      referenced.add(match[1])
    }
    // The explicit-locale form, used where a hook cannot be: translate(locale, 'key').
    for (const match of source.matchAll(/\btranslate\(\s*[^,]+,\s*['"]([\w.]+)['"]/g)) {
      referenced.add(match[1])
    }
  }

  it('references only keys that exist in every catalog', () => {
    const unknown = [...referenced].filter((key) =>
      SUPPORTED.some((tag) => !(key in CATALOGS[tag])),
    )
    expect(unknown).toEqual([])
  })

  it('has no dead keys left in the catalogs', () => {
    const dead = Object.keys(CATALOGS[DEFAULT_LOCALE]).filter(
      (key) =>
        !referenced.has(key) &&
        !DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix)) &&
        !SAME_IN_BOTH.has(key),
    )
    expect(dead).toEqual([])
  })

  it('finds a meaningful number of keys, so the scan itself cannot silently break', () => {
    expect(referenced.size).toBeGreaterThan(60)
  })
})

describe('engine', () => {
  it('substitutes named placeholders', () => {
    expect(interpolate('You owe {name}', { name: 'Sam' }, 'en')).toBe('You owe Sam')
  })

  it('leaves an unknown placeholder visible rather than blanking it', () => {
    expect(interpolate('Hello {who}', { other: 'x' }, 'en')).toBe('Hello {who}')
  })

  it('groups numbers through Intl so a count does not read as 1234', () => {
    expect(interpolate('{count} rows', { count: 1234 }, 'en')).toBe('1,234 rows')
  })

  it('selects English plurals by count', () => {
    expect(translate('en', 'settings.removeRows', { count: 1 })).toBe(
      'Permanently remove 1 row',
    )
    expect(translate('en', 'settings.removeRows', { count: 2 })).toBe(
      'Permanently remove 2 rows',
    )
    expect(translate('en', 'settings.removeRows', { count: 0 })).toBe(
      'Permanently remove 0 rows',
    )
  })

  it('uses the single Japanese cardinal form for every count', () => {
    expect(translate('ja', 'settings.removeRows', { count: 1 })).toBe('1行を完全に削除')
    expect(translate('ja', 'settings.removeRows', { count: 2 })).toBe('2行を完全に削除')
  })

  it('returns the key itself for a missing one instead of throwing', () => {
    expect(translate('en', 'nope.not.here')).toBe('nope.not.here')
  })

  it('falls back to the reference locale for a key a translation lacks', () => {
    // Simulated by asking for a locale that does not exist at all.
    expect(translate('de', 'balance.title')).toBe('Balance')
  })
})

describe('locale switching', () => {
  it('defaults to the reference locale under the test environment', () => {
    expect(getLocale()).toBe(DEFAULT_LOCALE)
  })

  it('switches and reports the new locale', () => {
    setLocale('ja')
    expect(getLocale()).toBe('ja')
    expect(t('balance.title')).toBe('貸し借り')
  })

  it('ignores an unsupported tag rather than blanking the UI', () => {
    setLocale('ja')
    setLocale('kl')
    expect(getLocale()).toBe(DEFAULT_LOCALE)
  })

  it('labels each language in its own language', () => {
    expect(LOCALE_LABELS.en).toBe('English')
    expect(LOCALE_LABELS.ja).toBe('日本語')
  })
})
