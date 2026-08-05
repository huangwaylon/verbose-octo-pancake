/**
 * The locale registry. Kept separate from `index.js` so the engine and the data
 * can be imported independently — `test/i18n.test.js` loads this without pulling
 * in React.
 */

import en from './en.js'
import ja from './ja.js'

export const CATALOGS = { en, ja }

/**
 * `'en'` rather than `'en-US'` deliberately: it is the fallback locale for every
 * `Intl` call, and `en-GB` would render USD as "US$42.10".
 */
export const DEFAULT_LOCALE = 'en'

export const SUPPORTED = Object.keys(CATALOGS)

/** Shown in the language switcher, each label in its own language. */
export const LOCALE_LABELS = { en: 'English', ja: '日本語' }
