/**
 * Build-time configuration, app-wide constants, and the localStorage wrappers.
 *
 * Nothing here is secret, and one value needs saying plainly: `SCRIPT_URL` is
 * PUBLIC. Vite inlines it into the shipped bundle, so anyone can read it, and
 * the app key — which is never a build-time value and only ever lives on a
 * device — is the sole access control. Nothing about this design may depend on
 * the endpoint URL being hard to guess. See SETUP.md.
 */

export const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL ?? ''

export const STORAGE_KEYS = {
  /**
   * The app key, exchanged at SCRIPT_URL for a short-lived Google token. Typed
   * once per device and never written to the sheet or the bundle.
   *
   * NOTE: localStorage is scoped to the ORIGIN, not the path, so every site
   * published from this GitHub Pages account can read this key. That is an
   * accepted trade-off, and the reason nothing untrusted may be published from
   * this origin — see the Security model section of README.md.
   */
  appKey: 'sf.appKey',
  token: 'sf.token',
  spreadsheetId: 'sf.spreadsheetId',
  /** Last successful read, so a cold launch paints before any network call. */
  snapshot: 'sf.snapshot',
  identity: 'sf.identity',
  locale: 'sf.locale',
  accent: 'sf.accent',
}

/**
 * Every localStorage touch in the app goes through these two, because every one
 * of them can throw: Safari in private browsing rejects writes outright. A
 * failure is never fatal — the value just does not survive a reload.
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
 * Used when the sheet has no `config` tab yet, or a key is missing from it.
 *
 * These values are WRITTEN to the shared spreadsheet, so none of them is
 * localized: two people sharing one sheet may read the UI in different
 * languages, and the stored data must not depend on whose device seeded it.
 *
 * The two people's names are deliberately absent. A name defaulted here would
 * shadow `nameOf`'s localized fallback, so a Japanese device with no names in the
 * config tab would read "Person 1" instead of 「ひとり目」. What gets seeded INTO a
 * fresh sheet is `SEED_NAMES` in `lib/sheetConfig.js`, which must stay unlocalized.
 */
export const DEFAULT_CONFIG = {
  categories: ['Groceries', 'Dining', 'Household', 'Other'],
  /**
   * The share each person covers on a new expense they paid for. Per-person
   * rather than one universal number: a couple splitting 80/20 wants p1 to bear
   * 80% of an expense *either* of them paid for, and a single default would
   * invert that every time the other one paid. The pair need not sum to 1 —
   * only the payer's is ever read.
   */
  defaultSplitP1: 0.5,
  defaultSplitP2: 0.5,
  /** Quick-pick suggestions for the note field. Free text is always allowed. */
  notePresets: [],
}

export function isConfigured() {
  return Boolean(SCRIPT_URL)
}

/**
 * Layer whatever the sheet actually specified over the defaults.
 *
 * The partial is what `parseConfigRows` returned — keys the sheet left blank or
 * unparseable are absent, so the default wins for exactly those. Shared with the
 * snapshot cache, which stores the *partial* rather than the merged result: a
 * merged copy would freeze the building build's defaults into every future launch,
 * so a changed default would not take effect until the network read landed.
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
