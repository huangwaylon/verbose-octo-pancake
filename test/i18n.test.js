import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { CATALOGS, DEFAULT_LOCALE, LOCALE_LABELS, SUPPORTED } from '../src/i18n/catalogs.js'
import {
  errorMessage,
  getLocale,
  i18nError,
  interpolate,
  setLocale,
  t,
  translate,
} from '../src/i18n/index.js'
import { ENTRY_ERROR } from '../src/schema.js'
import { CONNECTION_ERROR } from '../src/lib/connection.js'
import { ACCENTS } from '../src/lib/theme.js'

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
  // A percent sign is the same string in both languages. It stays in the catalog
  // rather than being inlined so the *placement* of the symbol remains a
  // translation decision.
  'summary.share',
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

  // Sets, not occurrence counts: Japanese sentence order legitimately repeats a
  // name English uses once (`settings.defaultSplitValue`). What must never differ
  // is *which* placeholders exist.
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

function sourceFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sourceFiles(path, found)
    else if (/\.jsx?$/.test(name)) found.push(path)
  }
  return found
}

describe('catalog usage', () => {
  /** Keys built at runtime from a code, e.g. t(`error.${code}`). Each family
      has its own coverage test below, since this scan cannot see them. */
  const DYNAMIC_PREFIXES = ['error.', 'accent.']

  const referenced = new Set()
  // The catalogs themselves are excluded, or every key marks itself as referenced
  // by being defined and the dead-key check below becomes vacuous.
  const CATALOG_FILES = ['en.js', 'ja.js'].map((name) => join('src', 'i18n', name))
  for (const file of sourceFiles('src').filter((path) => !CATALOG_FILES.includes(path))) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\b(?:t|tn)\(\s*['"]([\w.]+)['"]/g)) {
      referenced.add(match[1])
    }
    // The explicit-locale form, used where a hook cannot be: translate(locale, 'key').
    for (const match of source.matchAll(/\btranslate\(\s*[^,]+,\s*['"]([\w.]+)['"]/g)) {
      referenced.add(match[1])
    }
    // Keys handed to a helper rather than to `t` directly — `errorMessage`'s
    // fallback key, `App`'s report(). Matching every literal that IS a catalog key
    // covers all of them without encoding each helper's argument position, at the
    // cost of counting a key named in a comment as referenced.
    for (const match of source.matchAll(/['"](\w+(?:\.\w+)+)['"]/g)) {
      if (match[1] in CATALOGS[DEFAULT_LOCALE]) referenced.add(match[1])
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
      (key) => !referenced.has(key) && !DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix)),
    )
    expect(dead).toEqual([])
  })

  it('finds a meaningful number of keys, so the scan itself cannot silently break', () => {
    expect(referenced.size).toBeGreaterThan(60)
  })

  it('names every accent preset, in every locale', () => {
    // Same blind spot as the codes below: t(`accent.${preset}`) is built from
    // the ACCENTS list, so an added preset would show an empty swatch label.
    const untranslated = []
    for (const preset of ACCENTS) {
      for (const tag of SUPPORTED) {
        if (!(`accent.${preset}` in CATALOGS[tag])) untranslated.push(`${tag}: accent.${preset}`)
      }
    }
    expect(untranslated).toEqual([])
  })

  it('translates every validation code, in every locale', () => {
    // `error.<code>` is built at runtime, so the dead-key and unknown-key scans
    // above cannot see it: a new ENTRY_ERROR would otherwise reach a person as
    // the bare string "badAmount".
    const untranslated = []
    for (const code of Object.values(ENTRY_ERROR)) {
      for (const tag of SUPPORTED) {
        if (!(`error.${code}` in CATALOGS[tag])) untranslated.push(`${tag}: error.${code}`)
      }
    }
    expect(untranslated).toEqual([])
  })

  it('translates every connection failure code, in every locale', () => {
    // The same blind spot, one step worse: these codes are attached to an error
    // rather than passed to t(), so the usage scan cannot see them either. Without
    // this, a rotated key would surface as the bare string "badKey".
    const untranslated = []
    for (const code of Object.values(CONNECTION_ERROR)) {
      for (const tag of SUPPORTED) {
        if (!(`error.${code}` in CATALOGS[tag])) untranslated.push(`${tag}: error.${code}`)
      }
    }
    expect(untranslated).toEqual([])
  })
})

describe('no hardcoded user-facing strings in components', () => {
  /**
   * An attribute nobody sees rendered is the easiest place to leave English
   * behind — `aria-label="Add an expense"` shipped on the FAB and no catalog
   * check could see it, because the string never went near a catalog.
   *
   * `aria-valuetext` earns its place here: the split slider's spoken value is a
   * whole sentence, and it is the only spoken string in the app that is not also
   * visible on screen, so nothing else would catch it going untranslated.
   */
  const SPOKEN_ATTRIBUTES = ['aria-label', 'aria-valuetext', 'alt', 'placeholder', 'title']

  it('passes every spoken attribute through t(), not a bare literal', () => {
    const offenders = []
    for (const file of sourceFiles('src').filter((path) => path.endsWith('.jsx'))) {
      const source = readFileSync(file, 'utf8')
      for (const attribute of SPOKEN_ATTRIBUTES) {
        // Only the literal form is a failure: the `{t('key')}` expression form is
        // the fix, and `attr=""` is a deliberate "no accessible name".
        const literal = new RegExp(`\\b${attribute}=("[^"]+"|'[^']+')`, 'g')
        for (const match of source.matchAll(literal)) {
          offenders.push(`${file}: ${attribute}=${match[1]}`)
        }
      }
    }
    expect(offenders).toEqual([])
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
    expect(translate('en', 'settings.removeRows', { count: 1 })).toBe('Permanently remove 1 row')
    expect(translate('en', 'settings.removeRows', { count: 2 })).toBe('Permanently remove 2 rows')
    expect(translate('en', 'settings.removeRows', { count: 0 })).toBe('Permanently remove 0 rows')
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

/**
 * The one path from a caught error to a sentence on screen. `cause.message` must
 * never be it: `sheets.js` and `connection.js` keep the API's own English there for
 * consoles, so showing it hands a Japanese reader "HTTP 403".
 */
describe('errorMessage', () => {
  it('prefers the error’s own key, which says something specific', () => {
    expect(errorMessage(i18nError('error.entryGone'), 'toast.deleteFailed')).toBe(
      translate('en', 'error.entryGone'),
    )
  })

  it('falls back to the caller’s key, naming the action rather than the transport', () => {
    const transport = new Error('Google Sheets: The caller does not have permission (HTTP 403)')
    transport.i18nKey = 'error.sheetRequest'
    expect(errorMessage(transport, 'toast.deleteFailed')).toBe(
      translate('en', 'error.sheetRequest'),
    )

    for (const cause of [new Error('raw English'), undefined, null, {}]) {
      expect(errorMessage(cause, 'toast.deleteFailed')).toBe(translate('en', 'toast.deleteFailed'))
    }
  })

  it('never returns the raw message, whatever the cause looks like', () => {
    expect(errorMessage(new Error('HTTP 403'), 'error.readSheet')).not.toContain('403')
  })

  it('keeps an error’s interpolation vars, so no placeholder reaches the screen', () => {
    // No error key carries a placeholder today; this is what stops the first one
    // that does from rendering the literal '{count}'.
    const cause = i18nError('settings.removedRows', { count: 3 })
    expect(errorMessage(cause, 'error.readSheet')).toBe('Removed 3 deleted rows.')
    expect(errorMessage(cause, 'error.readSheet')).not.toContain('{count}')
  })

  it('translates into the active locale, not the one the error was thrown in', () => {
    const cause = i18nError('error.entryGone')
    setLocale('ja')
    expect(errorMessage(cause, 'error.readSheet')).toBe(translate('ja', 'error.entryGone'))
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
