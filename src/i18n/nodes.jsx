/**
 * Interpolation that yields React nodes instead of a string, for the handful of
 * strings containing inline markup (`<code>` spans in the gates and settings).
 *
 * The alternative — `dangerouslySetInnerHTML` with markup inside the catalog —
 * would put translator-supplied HTML into the DOM, which is exactly the injection
 * path this app has no reason to open.
 */

import { Fragment } from 'react'
import { VAR_PATTERN, getLocale, translate, useT } from './index.js'

/**
 * @param {string} locale
 * @param {string} key
 * @param {Record<string, import('react').ReactNode>} nodes
 * @returns {import('react').ReactNode[]} alternating text and substituted nodes
 */
export function translateNodes(locale, key, nodes) {
  const template = translate(locale, key)
  // String.split with a capturing group alternates: even index is literal text,
  // odd index is the captured placeholder name.
  const parts = String(template).split(VAR_PATTERN)
  return parts.map((part, index) => {
    if (index % 2 === 0) return part
    const node = nodes?.[part]
    return <Fragment key={`${key}-${index}`}>{node ?? `{${part}}`}</Fragment>
  })
}

/** Locale-bound form, for non-hook call sites. */
export function tNodes(key, nodes) {
  return translateNodes(getLocale(), key, nodes)
}

/** Hook form, so a component re-renders when the locale changes. */
export function useTNodes() {
  const { locale } = useT()
  return (key, nodes) => translateNodes(locale, key, nodes)
}
