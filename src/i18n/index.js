/**
 * Tiny i18n layer: a module singleton plus a `useSyncExternalStore` hook.
 *
 * A singleton rather than a context because non-React modules need the same `t`
 * (`useLedger`'s errors, toast text), and because `test/render.test.jsx` renders
 * components bare with no provider to wire up.
 *
 * Both catalogs are statically imported: 6.3 KB gzipped for the pair, and after the
 * app is installed a split chunk saves no download at all — every byte comes from the
 * service worker's precache either way.
 */

import { useMemo } from 'react'
import { STORAGE_KEYS } from '../config.js'
import { ENTRY_TYPE } from '../schema.js'
import { formatYen } from '../lib/money.js'
import { cached } from '../lib/memo.js'
import { storedPreference } from '../lib/preference.js'
import { nameOf } from '../lib/identity.js'
import { CATALOGS, DEFAULT_LOCALE, SUPPORTED } from './catalogs.js'

/** `{name}` — the only interpolation syntax. */
export const VAR_PATTERN = /\{(\w+)\}/g

const numberFormats = new Map()
const pluralRules = new Map()

/**
 * Plural category via `Intl.PluralRules` rather than a hand-rolled CLDR table.
 * `en` yields one|other; `ja` yields other for every count, which is correct.
 */
function selectPlural(locale, count) {
  return cached(pluralRules, locale, () => new Intl.PluralRules(locale)).select(count)
}

const warned = new Set()

function lookup(locale, key) {
  const value = CATALOGS[locale]?.[key] ?? CATALOGS[DEFAULT_LOCALE]?.[key]
  if (value == null) {
    // Never throw: a missing string must not blank the app. Structural guarantees
    // live in test/i18n.test.js, not at runtime.
    if (import.meta.env?.DEV && !warned.has(key)) {
      warned.add(key)
      console.warn(`[i18n] missing key: ${key}`)
    }
    return key
  }
  return value
}

/** Substitute `{name}`. An unknown placeholder stays visible, so it is obvious. */
export function interpolate(template, vars, locale) {
  if (!vars) return template
  return String(template).replace(VAR_PATTERN, (whole, name) => {
    if (!(name in vars)) return whole
    const value = vars[name]
    if (typeof value !== 'number') return String(value)
    // Through Intl so `{count}` reads 1,234 rather than 1234.
    return cached(numberFormats, locale, () => new Intl.NumberFormat(locale)).format(value)
  })
}

/**
 * Translate for an explicit locale. A catalog value is either a string or, for a
 * pluralised key, an object keyed by plural category — the only case where a value
 * is not a string, which makes `typeof` an unambiguous discriminator.
 */
export function translate(locale, key, vars) {
  const entry = lookup(locale, key)
  if (entry && typeof entry === 'object') {
    const count = Number(vars?.count ?? 0)
    // `?? entry.other` keeps an unexpected category (a locale with few/many added
    // later) readable instead of undefined.
    const branch = entry[selectPlural(locale, count)] ?? entry.other
    return interpolate(branch, vars, locale)
  }
  return interpolate(entry, vars, locale)
}

const store = storedPreference({
  key: STORAGE_KEYS.locale,
  values: SUPPORTED,
  fallback: DEFAULT_LOCALE,
  detect: () => {
    const preferences =
      (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || []
    for (const tag of preferences) {
      const base = String(tag ?? '')
        .toLowerCase()
        .split('-')[0]
      if (SUPPORTED.includes(base)) return base
    }
    return null
  },
})

export const getLocale = store.get

/** Reflect the locale onto the document. No-op outside a browser. */
export function syncDocumentLocale() {
  if (typeof document === 'undefined') return
  const tag = store.get()
  document.documentElement.lang = tag
  document.title = translate(tag, 'app.name')
}

export function setLocale(tag) {
  store.set(tag)
  syncDocumentLocale()
}

/** Locale-bound translate. Safe to import from non-React modules. */
export function t(key, vars) {
  return translate(store.get(), key, vars)
}

/**
 * An error whose message is already in the reader's language, with the key and vars
 * kept on it so `errorMessage` can re-translate the same sentence rather than
 * rendering a bare `{count}`.
 *
 * The one way to throw something a person will read. `connection.js` and `sheets.js`
 * deliberately do not use it — their messages stay English for logs and carry an
 * `i18nKey` the UI translates at render time instead.
 */
export function i18nError(key, vars) {
  const error = new Error(translate(store.get(), key, vars))
  error.i18nKey = key
  if (vars) error.i18nVars = vars
  return error
}

/**
 * The one way a caught error becomes a sentence on screen.
 *
 * `cause.message` is never shown: `sheets.js` keeps the API's own English text there
 * on purpose, and a Japanese reader must not be handed "The caller does not have
 * permission (HTTP 403)". Anything without an `i18nKey` falls back to the caller's
 * own key, which names the action that failed rather than the transport.
 *
 * @param {unknown} cause
 * @param {string} fallbackKey
 * @returns {string}
 */
export function errorMessage(cause, fallbackKey) {
  return cause?.i18nKey ? t(cause.i18nKey, cause.i18nVars) : t(fallbackKey)
}

export function useT() {
  const locale = store.use()
  return useMemo(
    () => ({
      locale,
      t: (key, vars) => translate(locale, key, vars),
      setLocale,
    }),
    [locale],
  )
}

/**
 * The three relative-day strings `dates.dayLabel` needs, memoised per locale so a
 * long list builds them once rather than per row.
 */
export function useDayLabels() {
  const { locale } = useT()
  return useMemo(
    () => ({
      today: translate(locale, 'date.today'),
      yesterday: translate(locale, 'date.yesterday'),
      none: translate(locale, 'date.none'),
    }),
    [locale],
  )
}

/**
 * The two people's names, and the same names labelled relative to the viewer so the UI
 * can say "You". Bound here rather than in `identity.js` so that module stays pure, and
 * memoised so every caller stops rebuilding the same three strings per render.
 */
export function usePeopleLabels(config, me) {
  const { t, locale } = useT()
  return useMemo(() => {
    const fallbacks = { p1: t('common.person1'), p2: t('common.person2') }
    const you = t('common.you')
    const name = (person) => nameOf(config, person, fallbacks)
    return {
      name,
      label: (person) => (person === me ? you : name(person)),
      /**
       * A separate function because English inflects: interpolating `label` into a
       * `{name}’s` string reads "You’s share" for whoever is holding the phone.
       * Japanese takes a uniform particle, so which form applies is a catalog
       * decision rather than a rule here.
       */
      possessive: (person) =>
        person === me
          ? t('common.yourPossessive')
          : t('common.namePossessive', { name: name(person) }),
    }
    // `locale` is the dependency that matters; `t` is derived from it.
  }, [config, me, locale])
}

/**
 * An entry's one-line title. Three surfaces need exactly the same string — the list
 * row, the delete confirmation and the deleted list — and a confirmation that reads
 * "Delete Expense?" for a row with neither note nor category is why the fallback chain
 * lives in one place rather than three.
 */
export function useEntryTitle(entry) {
  const { t, locale } = useT()
  return useMemo(
    () =>
      entry.type === ENTRY_TYPE.SETTLEMENT
        ? t('entry.settled')
        : entry.description || entry.category || t('entry.expense'),
    // `locale` is the dependency that matters; `t` is derived from it.
    [entry, locale],
  )
}

/**
 * A locale-bound money formatter, so call sites stop silently inheriting the runtime
 * locale. Stable per locale, which keeps it safe to call inside the `memo`ised row
 * components: the identity only changes when the language does.
 */
export function useMoney() {
  const { locale } = useT()
  return useMemo(() => (yen) => formatYen(yen, { locale }), [locale])
}
