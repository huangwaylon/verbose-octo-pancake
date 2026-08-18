/**
 * Everything about the `config` tab: the two-way key map, how each kind of value is
 * read, and what a freshly seeded tab says.
 *
 * Separate from `sheets.js` because none of it touches the network or knows what a
 * ledger row is — it is a pure translation between two-column rows and a config
 * object, and it is the half of that file with the most cases worth pinning.
 */

import { DEFAULT_CONFIG } from '../config.js'
import { cellText } from '../schema.js'
import { normalizeCurrency, parseShare } from './money.js'

/**
 * Sheet key <-> config field, plus how to read the value. One list so the two
 * directions cannot drift. `list`, `fraction` and `code` values are not plain
 * strings, so they need explicit parsers; everything else is text.
 *
 * There are deliberately no email keys. The access token belongs to the account
 * that owns the sheet rather than to either person, so nothing can produce an
 * address to match against — which of the two people this is is a per-device
 * choice, like the locale and the accent.
 */
const CONFIG_FIELDS = [
  ['person1_name', 'person1Name', 'text'],
  ['person2_name', 'person2Name', 'text'],
  ['currency', 'currency', 'code'],
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
  code: (value) => normalizeCurrency(value) || null,
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
 * Config tab rows -> a partial config object. Exported for testing: it is pure,
 * and the percentage-vs-fraction rule needs cases pinned to it.
 *
 * A key that is absent, or present with a blank or unparseable value, is omitted
 * so the caller's defaults win. The FIRST usable value for a key wins: a tab where
 * someone added `currency, USD` at the top and forgot an old `currency, JPY` lower
 * down would otherwise run the whole sheet at JPY, which is a 100x error on every
 * row with a blank currency cell.
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
 * What a freshly seeded `config` tab says the two people are called, and the only
 * place these strings exist. They are NOT in `DEFAULT_CONFIG`: a default there
 * would shadow the localized fallback `nameOf` applies when the sheet says
 * nothing, and everything written to the sheet stays unlocalized regardless of
 * whose device seeded it.
 */
const SEED_NAMES = { person1Name: 'Person 1', person2Name: 'Person 2' }

export function defaultConfigRows() {
  return CONFIG_FIELDS.map(([key, field]) => {
    const value = SEED_NAMES[field] ?? DEFAULT_CONFIG[field]
    return [key, Array.isArray(value) ? value.join(', ') : String(value ?? '')]
  })
}
