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
 * `drive.file` grants access only to files the user explicitly picks via the
 * Google Picker — not to every sheet in their Drive.
 */
export const OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.file'

export const STORAGE_KEYS = {
  spreadsheetId: 'sf.spreadsheetId',
  spreadsheetName: 'sf.spreadsheetName',
  identity: 'sf.identity',
}

/**
 * Used when the sheet has no `config` tab yet, or a key is missing from it.
 */
export const DEFAULT_CONFIG = {
  person1Name: 'Person 1',
  person2Name: 'Person 2',
  person1Email: '',
  person2Email: '',
  currency: 'USD',
  categories: ['Groceries', 'Dining', 'Household', 'Other'],
}

export function isConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_API_KEY)
}
