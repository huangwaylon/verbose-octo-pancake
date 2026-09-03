/**
 * Build-time configuration, app-wide constants, and the localStorage wrappers.
 *
 * `SCRIPT_URL` is PUBLIC: Vite inlines it into the shipped bundle, so the app key — which is
 * never a build-time value and only ever lives on a device — is the sole access control. Nothing
 * about this design may depend on the endpoint URL being hard to guess. See SETUP.md.
 */

export const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL ?? ''

export const STORAGE_KEYS = {
  /**
   * The app key, exchanged at SCRIPT_URL for a short-lived Google token. Typed once per device and
   * never written to the sheet or the bundle. localStorage is scoped to the ORIGIN, not the path,
   * so every site published from this GitHub Pages account can read it: accepted, and the reason
   * nothing untrusted may be published from this origin — see README's Security model.
   */
  appKey: 'sf.appKey',
  token: 'sf.token',
  spreadsheetId: 'sf.spreadsheetId',
  /** Last successful read, so a cold launch paints before any network call. */
  snapshot: 'sf.snapshot',
  identity: 'sf.identity',
  locale: 'sf.locale',
  accent: 'sf.accent',
  /** Which of the summary's two per-person figures is on screen. */
  summaryView: 'sf.summaryView',
}

/**
 * Every localStorage touch goes through these two, because every one of them can throw: Safari in
 * private browsing rejects writes outright. A failure is never fatal.
 */
export function readStored(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key, value) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage blocked. Nothing to do: this is a cache, never the source of truth.
  }
}

/**
 * Used when the sheet has no `config` tab yet, or a key is missing from it. These values are
 * WRITTEN to the shared spreadsheet, so none is localized: two people sharing one sheet may read the
 * UI in different languages, and the stored data must not depend on whose device seeded it. The two
 * people's names are deliberately absent, because a name defaulted here would shadow `nameOf`'s
 * localized fallback; a fresh sheet is seeded from `SEED_NAMES` in `lib/sheetConfig.js`.
 *
 * Frozen, arrays included: every reader but `mergeConfig` reaches it directly rather than through a
 * defensive clone, so a mutation anywhere would change what every later read defaults to.
 */
export const DEFAULT_CONFIG = Object.freeze({
  /**
   * The same list `CATEGORIES` in `scripts/bank_to_ledger.py` classifies into — one vocabulary, or
   * an imported row lands on a category the picker does not offer. Groceries is first because
   * `config.categories[0]` is what a new entry starts on.
   */
  categories: Object.freeze([
    'Groceries',
    'Dining',
    'Household',
    'Travel',
    'Rent',
    'Gym',
    'Wedding',
    'Other',
  ]),
  /**
   * The share each person covers on a new expense they paid for. Per-person rather than one
   * universal number: a couple splitting 80/20 wants p1 to bear 80% of an expense *either* of them
   * paid for. The pair need not sum to 1 — only the payer's is read.
   */
  defaultSplitP1: 0.5,
  defaultSplitP2: 0.5,
  /** Quick-pick suggestions for the note field. Free text is always allowed. */
  notePresets: Object.freeze([]),
})

/**
 * The spreadsheet's own URL, for the two places that link out to it. One home because two copies
 * of a template is two chances to break a link nothing in the suite follows.
 */
export function sheetUrl(spreadsheetId) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
}

export function isConfigured() {
  return Boolean(SCRIPT_URL)
}

/**
 * Layer whatever the sheet actually specified over the defaults. `partial` is what
 * `parseConfigRows` returned — keys the sheet left blank or unparseable are absent, so the default
 * wins for exactly those. Shared with the snapshot cache, which stores the *partial* rather than
 * the merged result: a merged copy would freeze the building build's defaults into every launch.
 */
export function mergeConfig(partial) {
  return {
    ...DEFAULT_CONFIG,
    // Cloned so a caller mutating the arrays cannot corrupt the shared defaults.
    categories: [...DEFAULT_CONFIG.categories],
    notePresets: [...DEFAULT_CONFIG.notePresets],
    ...(partial ?? {}),
  }
}
