/**
 * A module singleton rather than a context, because non-React modules need the same `t` and
 * `test/render.test.jsx` renders components bare. Both catalogs are statically imported: 6.3 KB
 * gzipped, and a split chunk saves nothing once the worker precaches.
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

function selectPlural(locale, count) {
  return cached(pluralRules, locale, () => new Intl.PluralRules(locale)).select(count)
}

const warned = new Set()

function lookup(locale, key) {
  const value = CATALOGS[locale]?.[key] ?? CATALOGS[DEFAULT_LOCALE]?.[key]
  if (value == null) {
    // Never throw: a missing string must not blank the app. Structure is the test's job.
    if (import.meta.env?.DEV && !warned.has(key)) {
      warned.add(key)
      console.warn(`[i18n] missing key: ${key}`)
    }
    return key
  }
  return value
}

/** An unknown placeholder stays visible, so it is obvious. */
export function interpolate(template, vars, locale) {
  if (!vars) return template
  return String(template).replace(VAR_PATTERN, (whole, name) => {
    if (!(name in vars)) return whole
    const value = vars[name]
    if (typeof value !== 'number') return String(value)
    // Through Intl so `{count}` reads 1,234.
    return cached(numberFormats, locale, () => new Intl.NumberFormat(locale)).format(value)
  })
}

/** A pluralised value is an object keyed by CLDR category — a catalog's only non-string. */
export function translate(locale, key, vars) {
  const entry = lookup(locale, key)
  if (entry && typeof entry === 'object') {
    const count = Number(vars?.count ?? 0)
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

export function t(key, vars) {
  return translate(store.get(), key, vars)
}

/**
 * The one way to throw something a person will read. Key and vars stay on the error so
 * `errorMessage` can re-translate rather than render a bare `{count}`. `sheets.js` and
 * `connection.js` deliberately keep English and attach an `i18nKey` instead.
 */
export function i18nError(key, vars) {
  const error = new Error(translate(store.get(), key, vars))
  error.i18nKey = key
  if (vars) error.i18nVars = vars
  return error
}

/**
 * The one way a caught error becomes a sentence. `cause.message` is never shown: a Japanese reader
 * must not be handed "The caller does not have permission (HTTP 403)". Without an `i18nKey` it falls
 * back to the caller's key, naming the action rather than the transport.
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

/** Bound here, not in `identity.js`, so that module stays pure. */
export function usePeopleLabels(config, me) {
  const { t, locale } = useT()
  return useMemo(() => {
    const fallbacks = { p1: t('common.person1'), p2: t('common.person2') }
    const you = t('common.you')
    const name = (person) => nameOf(config, person, fallbacks)
    return {
      name,
      label: (person) => (person === me ? you : name(person)),
      /** English inflects: `label` in a `{name}’s` string reads "You’s share". */
      possessive: (person) =>
        person === me
          ? t('common.yourPossessive')
          : t('common.namePossessive', { name: name(person) }),
    }
    // `locale` is the dependency that matters; `t` derives from it.
  }, [config, me, locale])
}

/** Three surfaces need the same string, or a confirmation reads "Delete Expense?". */
export function useEntryTitle(entry) {
  const { t, locale } = useT()
  return useMemo(
    () =>
      entry.type === ENTRY_TYPE.SETTLEMENT
        ? t('entry.settled')
        : entry.description || entry.category || t('entry.expense'),
    // `locale` is the dependency that matters; `t` derives from it.
    [entry, locale],
  )
}

/** Stable per locale, so the `memo`ised rows can call it. */
export function useMoney() {
  const { locale } = useT()
  return useMemo(() => (yen) => formatYen(yen, { locale }), [locale])
}
