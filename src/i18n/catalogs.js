/** Separate from `index.js` so `test/i18n.test.js` can load the data without pulling in React. */

import en from './en.js'
import ja from './ja.js'

export const CATALOGS = { en, ja }

/** `'en'` rather than `'en-US'`: the `Intl` fallback, and `en-GB` renders USD as "US$42.10". */
export const DEFAULT_LOCALE = 'en'

export const SUPPORTED = Object.keys(CATALOGS)

/** Shown in the language switcher, each label in its own language. */
export const LOCALE_LABELS = { en: 'English', ja: '日本語' }
