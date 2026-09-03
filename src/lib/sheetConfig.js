/**
 * Everything about the `config` tab: the two-way key map, how each kind of value is read, and what
 * a freshly seeded tab says. Separate from `sheets.js` because none of it touches the network or
 * knows what a ledger row is.
 */

import { DEFAULT_CONFIG } from '../config.js'
import { cellText } from '../schema.js'
import { parseShare } from './money.js'

/**
 * Sheet key <-> config field, plus how to read the value. One list so the two directions cannot
 * drift. There are deliberately no email keys: the token belongs to the account that owns the
 * sheet rather than to either person, so which of the two this is is a per-device choice.
 */
const CONFIG_FIELDS = [
  ['person1_name', 'person1Name', 'text'],
  ['person2_name', 'person2Name', 'text'],
  ['categories', 'categories', 'list'],
  ['default_split_p1', 'defaultSplitP1', 'fraction'],
  ['default_split_p2', 'defaultSplitP2', 'fraction'],
  ['note_presets', 'notePresets', 'list'],
]

/** The same list keyed for lookup, built once rather than per read. */
const BY_KEY = new Map(CONFIG_FIELDS.map(([key, field, kind]) => [key, { field, kind }]))

/** Each kind answers null for a value it cannot use, so the default wins. */
const PARSERS = {
  text: (value) => value,
  fraction: parseShare,
  list: (value) => {
    const list = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    // An empty list must never shadow a default, or the category picker is empty.
    return list.length ? list : null
  },
}

/**
 * The two lists above agree, asserted at import: at the read, a kind with no parser throws inside
 * `loadAll`, which no caller can tell from a lost spreadsheet — the app shows its error gate over
 * one cosmetic config key.
 */
for (const [, , kind] of CONFIG_FIELDS) {
  if (!PARSERS[kind]) throw new TypeError(`config: no parser for kind ${kind}`)
}

/**
 * Config tab rows -> a partial config object. A key that is absent, blank or unparseable is
 * omitted so the caller's defaults win, and the FIRST usable value for a key wins: a stale
 * `default_split_p1, 50` below a fresh `80` would otherwise run the whole sheet at the even split,
 * moving money on every expense that person paid for.
 */
export function parseConfigRows(rows) {
  const parsed = {}

  for (const row of rows) {
    const key = cellText(row, 0).toLowerCase()
    const value = cellText(row, 1)
    const spec = BY_KEY.get(key)
    if (!spec || !value || spec.field in parsed) continue

    const result = PARSERS[spec.kind](value)
    if (result != null) parsed[spec.field] = result
  }

  return parsed
}

/**
 * Whether two partial configs say the same thing. `parseConfigRows` builds a fresh object per read,
 * so without this the config's IDENTITY changes on every refresh even though the tab almost never
 * does — and identity is what every `memo` keyed on the config compares, so a resume would
 * re-render the whole ledger to arrive at the same screen. Arrays compare element-wise; anything
 * else falls through to `===` and merely loses the optimization.
 */
export function sameSheetConfig(a, b) {
  const left = a ?? {}
  const right = b ?? {}
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => {
    const one = left[key]
    const two = right[key]
    if (Array.isArray(one) || Array.isArray(two)) {
      return (
        Array.isArray(one) &&
        Array.isArray(two) &&
        one.length === two.length &&
        one.every((item, index) => item === two[index])
      )
    }
    return one === two
  })
}

/**
 * What a freshly seeded `config` tab says the two people are called — the only names ever written
 * INTO a sheet, and unlocalized whatever device seeded it. NOT in `DEFAULT_CONFIG`: a default there
 * would shadow the localized fallback `nameOf` applies when the sheet says nothing.
 */
const SEED_NAMES = { person1Name: 'Person 1', person2Name: 'Person 2' }

export function defaultConfigRows() {
  return CONFIG_FIELDS.map(([key, field]) => {
    const value = SEED_NAMES[field] ?? DEFAULT_CONFIG[field]
    return [key, Array.isArray(value) ? value.join(', ') : String(value ?? '')]
  })
}
