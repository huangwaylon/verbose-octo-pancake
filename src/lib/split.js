/**
 * How much of an expense the payer covers themselves, and the two decisions the form's split
 * control makes about it. `payer_share` is the payer's OWN share, so the other person owes the
 * rest — which is what makes a settlement need no special case anywhere (`payer_share: 0`).
 *
 * Pure and React-free on purpose: inside a hook no test can reach these transitions.
 */

import { EVEN_SHARE, PERSON } from '../schema.js'

/**
 * The share `person` covers by default on an expense they paid for. Keyed on the payer, not one
 * household number: with 0.8 for p1 and 0.2 for p2, p1 bears 80% whichever of them paid. The two
 * are independent and need not sum to 1, so never mirror one from the other. The `isFinite` guard
 * is the last thing between an unparseable config cell and `splitYen`.
 */
export function defaultSplitFor(config, person) {
  const value = person === PERSON.P2 ? config?.defaultSplitP2 : config?.defaultSplitP1
  return Number.isFinite(value) ? value : EVEN_SHARE
}

/**
 * A share as the two split controls see it. An even share drives the segmented control to "Even"
 * and hides the slider; anything else opens Custom on that number. A NULL share is the recurring
 * tab's blank `payer_share` — a durable "follow whoever pays, at their default" rather than an
 * unfilled draft — so it gets its own mode and the control keeps it blank.
 *
 * `share` is carried alongside the whole-percent `percent` and is what gets SAVED: saving
 * `percent / 100` would rewrite a stored 0.333 as 0.33 and move money on an edit that only
 * touched the note.
 *
 * @param {number|null} share fraction in [0,1], or null for "follow the default"
 * @returns {{mode: 'default'|'even'|'custom', percent: number, share: number|null}}
 */
export function toSplit(share, configuredShare = EVEN_SHARE) {
  if (share == null) {
    return { mode: 'default', percent: Math.round(configuredShare * 100), share: null }
  }
  return {
    mode: share === EVEN_SHARE ? 'even' : 'custom',
    percent: Math.round(share * 100),
    share,
  }
}

/**
 * The split after someone taps Default, Even or Custom. Custom re-opens on `configuredShare` — the
 * payer's default, from `defaultSplitFor` — rather than a hardcoded 50, so tapping Even and back
 * does not mean dragging the slider to where the sheet already says it is.
 */
export function nextSplit(mode, configuredShare) {
  if (mode === 'default') return toSplit(null, configuredShare)
  if (mode === 'even') return toSplit(EVEN_SHARE)
  // Custom on exactly the even share still has to read as Custom, so this cannot route through
  // `toSplit`, which would answer 'even' for it.
  return { mode: 'custom', percent: Math.round(configuredShare * 100), share: configuredShare }
}

/** Dragging or tapping a preset: whole percents, and the share follows exactly. */
export function splitAtPercent(percent) {
  return { mode: 'custom', percent, share: percent / 100 }
}
