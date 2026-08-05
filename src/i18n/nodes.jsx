/**
 * Interpolation that yields React nodes instead of a string, for the handful of
 * strings containing inline markup (`<code>` spans in the gates and settings).
 *
 * The alternative — `dangerouslySetInnerHTML` with markup inside the catalog —
 * would put translator-supplied HTML into the DOM, which is exactly the injection
 * path this app has no reason to open.
 */

import { Fragment } from 'react'
import { VAR_PATTERN, translate, useT } from './index.js'

/**
 * @returns {(key: string, nodes: Record<string, import('react').ReactNode>) =>
 *   import('react').ReactNode[]} alternating text and substituted nodes
 */
export function useTNodes() {
  const { locale } = useT()
  return (key, nodes) => {
    // String.split with a capturing group alternates: even index is literal
    // text, odd index is the captured placeholder name.
    const parts = String(translate(locale, key)).split(VAR_PATTERN)
    return parts.map((part, index) => {
      if (index % 2 === 0) return part
      const node = nodes?.[part]
      return <Fragment key={`${key}-${index}`}>{node ?? `{${part}}`}</Fragment>
    })
  }
}
