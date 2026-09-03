/**
 * Interpolation yielding React nodes rather than a string, for the strings with inline markup. The
 * alternative — `dangerouslySetInnerHTML` — would put translator-supplied HTML into the DOM.
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
    // Capturing-group split alternates: even index is literal text, odd is the placeholder name.
    const parts = String(translate(locale, key)).split(VAR_PATTERN)
    return parts.map((part, index) => {
      if (index % 2 === 0) return part
      const node = nodes?.[part]
      return <Fragment key={`${key}-${index}`}>{node ?? `{${part}}`}</Fragment>
    })
  }
}
