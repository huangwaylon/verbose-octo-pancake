/**
 * Build-time configuration and app-wide constants.
 *
 * Nothing here is secret. The OAuth client ID and API key are public by
 * design — they are restricted by HTTP referrer / authorized JavaScript
 * origin in the Google Cloud console, not by being hidden. See SETUP.md.
 */

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
export const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY ?? ''

/**
 * Three scopes, all non-sensitive, so the consent screen still needs no
 * Google verification review.
 *
 * `drive.file` grants access only to files the user explicitly picks via the
 * Google Picker — not to every sheet in their Drive. It must never widen to
 * `spreadsheets`, which would expose every sheet in the account.
 *
 * `openid` + `userinfo.email` exist solely so `getUserEmail()` can match the
 * signed-in address against the config tab and skip the "which one are you?"
 * prompt. They grant no file access of any kind. Without them the userinfo
 * endpoint returns 401 and identity falls back to a manual choice.
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
}

/**
 * Used when the sheet has no `config` tab yet, or a key is missing from it.
 *
 * These values are WRITTEN to the shared spreadsheet by `configToRows`, so none
 * of them is localized: two people sharing one sheet may be reading the UI in
 * different languages, and the stored data must not depend on whose device
 * seeded it. Category names are English defaults and are meant to be edited in
 * the sheet's config tab.
 *
 * `currency` is per-sheet (here and in the config tab); the UI language is
 * per-device (localStorage). They are deliberately independent — a yen sheet
 * read in English is a normal thing to want.
 */
export const DEFAULT_CONFIG = {
  person1Name: 'Person 1',
  person2Name: 'Person 2',
  person1Email: '',
  person2Email: '',
  currency: 'JPY',
  categories: ['Groceries', 'Dining', 'Household', 'Other'],
}

export function isConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_API_KEY)
}
