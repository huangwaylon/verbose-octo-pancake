/**
 * How much of an expense the payer covers themselves, and the two decisions the
 * form's split control makes about it.
 *
 * `payer_share` is the payer's OWN share, so the other person owes the rest. That
 * is what makes a settlement need no special case anywhere (`payer_share: 0`), and
 * it is why the default is keyed on the payer rather than being one household
 * number — see `defaultSplitFor`.
 *
 * Pure and React-free on purpose: the control's transitions are the part worth
 * testing, and inside a hook no test can reach them.
 */

import { EVEN_SHARE, PERSON } from '../schema.js'

/**
 * The share `person` covers by default on an expense they paid for.
 *
 * Keyed on the payer: with 0.8 for p1 and 0.2 for p2, p1 bears 80% of the cost
 * whichever of them actually paid. The two values are independent and need not sum
 * to 1 — only the payer's is ever read, so never mirror one from the other.
 *
 * The `Number.isFinite` guard is the last thing between an unparseable config cell
 * and `splitCents`, which moves money.
 */
export function defaultSplitFor(config, person) {
  const value = person === PERSON.P2 ? config?.defaultSplitP2 : config?.defaultSplitP1
  return Number.isFinite(value) ? value : EVEN_SHARE
}

/**
 * A share as the two split controls see it. An even share drives the segmented
 * control to "Even" and hides the slider; anything else opens Custom showing that
 * number, which is what makes a configured 80% land ready to submit.
 *
 * @param {number} share fraction in [0,1]
 * @returns {{mode: 'even'|'custom', percent: number}}
 */
export function toSplit(share) {
  return { mode: share === EVEN_SHARE ? 'even' : 'custom', percent: Math.round(share * 100) }
}

/**
 * The split after someone taps Even or Custom.
 *
 * Custom re-opens on the payer's configured default rather than a hardcoded 50, so
 * a couple on 80/20 who tap Even and back does not have to drag the slider to
 * where the sheet already says it is.
 *
 * @param {'even'|'custom'} mode
 * @param {number} configuredShare the payer's default, from `defaultSplitFor`
 * @returns {{mode: 'even'|'custom', percent: number}}
 */
export function nextSplit(mode, configuredShare) {
  if (mode === 'even') return { mode: 'even', percent: Math.round(EVEN_SHARE * 100) }
  return { mode: 'custom', percent: Math.round(configuredShare * 100) }
}
