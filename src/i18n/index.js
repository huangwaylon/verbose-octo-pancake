/**
 * Tiny i18n layer: a module singleton plus a `useSyncExternalStore` hook.
 *
 * A singleton rather than a context because non-React modules need the same `t`
 * (`useLedger`'s errors, toast text), and because `test/render.test.jsx` renders
 * components bare with no provider to wire up. There is exactly one locale per
 * tab, so the multi-tenant argument for context does not apply.
 *
 * Both catalogs are statically imported: ~2 KB gzipped for the pair is cheaper
 * than the round trip and Suspense boundary a dynamic import would cost.
 */

import { useMemo, useSyncExternalStore } from 'react'
import { STORAGE_KEYS, readStored, writeStored } from '../config.js'
import { formatCents } from '../lib/money.js'
import { nameOf } from '../lib/identity.js'
import { CATALOGS, DEFAULT_LOCALE, SUPPORTED } from './catalogs.js'

/** `{name}` — the only interpolation syntax. */
export const VAR_PATTERN = /\{(\w+)\}/g

const numberFormats = new Map()
const pluralRules = new Map()

function numberFormat(locale) {
  let format = numberFormats.get(locale)
  if (!format) {
    format = new Intl.NumberFormat(locale)
    numberFormats.set(locale, format)
  }
  return format
}

/**
 * Plural category via `Intl.PluralRules` rather than a hand-rolled CLDR table.
 * `en` yields one|other; `ja` yields other for every count, which is correct —
 * Japanese has a single cardinal category.
 */
function selectPlural(locale, count) {
  let rules = pluralRules.get(locale)
  if (!rules) {
    rules = new Intl.PluralRules(locale)
    pluralRules.set(locale, rules)
  }
  return rules.select(count)
}

const warned = new Set()

function lookup(locale, key) {
  const value = CATALOGS[locale]?.[key] ?? CATALOGS[DEFAULT_LOCALE]?.[key]
  if (value == null) {
    // Never throw: a missing string must not blank the app. Structural
    // guarantees live in test/i18n.test.js, not at runtime.
    if (import.meta.env?.DEV && !warned.has(key)) {
      warned.add(key)
      console.warn(`[i18n] missing key: ${key}`)
    }
    return key
  }
  return value
}

/**
 * Substitute `{name}` placeholders. An unknown placeholder is left visible
 * rather than blanked, so the failure is obvious and the test catches it.
 * Numbers route through Intl so `{count}` reads 1,234 rather than 1234.
 */
export function interpolate(template, vars, locale) {
  if (!vars) return template
  return String(template).replace(VAR_PATTERN, (whole, name) => {
    if (!(name in vars)) return whole
    const value = vars[name]
    return typeof value === 'number' ? numberFormat(locale).format(value) : String(value)
  })
}

/**
 * Translate for an explicit locale. A catalog value is either a string or, for a
 * pluralised key, an object keyed by plural category — the only case where a
 * value is not a string, which makes `typeof` an unambiguous discriminator.
 */
export function translate(locale, key, vars) {
  const entry = lookup(locale, key)
  if (entry && typeof entry === 'object') {
    const count = Number(vars?.count ?? 0)
    // `?? entry.other` keeps an unexpected category (a locale with few/many
    // added later) readable instead of undefined.
    const branch = entry[selectPlural(locale, count)] ?? entry.other
    return interpolate(branch, vars, locale)
  }
  return interpolate(entry, vars, locale)
}

function detectLocale() {
  const stored = readStored(STORAGE_KEYS.locale)
  if (SUPPORTED.includes(stored)) return stored
  const preferences =
    (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || []
  for (const tag of preferences) {
    const base = String(tag ?? '').toLowerCase().split('-')[0]
    if (SUPPORTED.includes(base)) return base
  }
  return DEFAULT_LOCALE
}

// Runs at module load, which also happens under vitest's `node` environment, so
// every storage/navigator touch above is guarded.
let current = detectLocale()

const listeners = new Set()

export function getLocale() {
  return current
}

function onLocaleChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reflect the locale onto the document. No-op outside a browser. */
export function syncDocumentLocale(tag = current) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = tag
  document.title = translate(tag, 'app.name')
}

export function setLocale(tag) {
  const next = SUPPORTED.includes(tag) ? tag : DEFAULT_LOCALE
  if (next === current) return
  current = next
  writeStored(STORAGE_KEYS.locale, next)
  syncDocumentLocale(next)
  for (const listener of listeners) listener()
}

/** Locale-bound translate. Safe to import from non-React modules. */
export function t(key, vars) {
  return translate(current, key, vars)
}

/**
 * The hook components use. The third `getServerSnapshot` argument is
 * load-bearing: without it `useSyncExternalStore` throws "Missing
 * getServerSnapshot" under `renderToStaticMarkup`, which is exactly how the
 * render tests run.
 */
export function useT() {
  const locale = useSyncExternalStore(onLocaleChange, getLocale, getLocale)
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
 * The three relative-day strings `dates.dayLabel` needs, memoised per locale so
 * a long list builds them once rather than per row.
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
 * The two people's names, and the same names labelled relative to the viewer so
 * the UI can say "You". Bound here rather than in `identity.js` so that module
 * stays pure, and memoised so seven components stop rebuilding the same three
 * strings on every render.
 */
export function usePeopleLabels(config, me) {
  const { t, locale } = useT()
  return useMemo(() => {
    const fallbacks = { p1: t('common.person1'), p2: t('common.person2') }
    const you = t('common.you')
    const name = (person) => nameOf(config, person, fallbacks)
    return { name, label: (person) => (person === me ? you : name(person)) }
    // `locale` is the dependency that matters; `t` is derived from it.
  }, [config, me, locale])
}

/**
 * A currency- and locale-bound money formatter, so call sites stop silently
 * inheriting the runtime locale and the `trimZeroCents` policy lives in one
 * place. Pass the entry's own currency where one exists; a mixed-currency sheet
 * is only rendered correctly per row.
 */
export function useMoney(currency) {
  const { locale } = useT()
  return useMemo(
    () =>
      (cents, opts) =>
        formatCents(cents, currency, { locale, ...opts }),
    [locale, currency],
  )
}
