/**
 * Build-time configuration, app-wide constants, and the localStorage wrappers.
 *
 * Nothing here is secret. The OAuth client ID and API key are public by design —
 * they are restricted by authorized origin / HTTP referrer in the Google Cloud
 * console, not by being hidden. See SETUP.md.
 */

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
export const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY ?? ''

/**
 * Three scopes, all non-sensitive, so the consent screen needs no Google
 * verification review.
 *
 * `drive.file` grants access only to files the user explicitly picks in the
 * Google Picker, plus files this app creates. It must never widen to
 * `spreadsheets`, which would expose every sheet in the account.
 *
 * `openid` + `userinfo.email` exist solely so the signed-in address can be
 * matched against the config tab, skipping the "which one are you?" prompt. They
 * grant no file access.
 */
export const OAUTH_SCOPE = [
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

export const STORAGE_KEYS = {
  spreadsheetId: 'sf.spreadsheetId',
  spreadsheetName: 'sf.spreadsheetName',
  identity: 'sf.identity',
  token: 'sf.token',
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
 * `currency` is per-sheet; the UI language is per-device. Deliberately
 * independent — a yen sheet read in English is a normal thing to want.
 */
export const DEFAULT_CONFIG = {
  person1Name: 'Person 1',
  person2Name: 'Person 2',
  person1Email: '',
  person2Email: '',
  currency: 'JPY',
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
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_API_KEY)
}
