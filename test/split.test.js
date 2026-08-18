import { describe, expect, it } from 'vitest'

import { EVEN_SHARE, PERSON } from '../src/schema.js'
import { defaultSplitFor, nextSplit, splitAtPercent, toSplit } from '../src/lib/split.js'

/**
 * The split decides how much of an expense each person owes, so every fallback
 * here is one step from `splitCents` and a wrong number on somebody's balance.
 *
 * The transitions exist as pure functions specifically so they can be tested: the
 * control that uses them lives in a hook, and there is no renderer for hooks here.
 */

describe('defaultSplitFor', () => {
  const config = { defaultSplitP1: 0.8, defaultSplitP2: 0.2 }

  it('reads only the payer’s own value', () => {
    expect(defaultSplitFor(config, PERSON.P1)).toBe(0.8)
    expect(defaultSplitFor(config, PERSON.P2)).toBe(0.2)
  })

  it('treats the two values as independent, never mirroring one from the other', () => {
    // The pair need not sum to 1. Both people covering 80% of what they pay for is
    // a coherent arrangement, and 0.2 must not be inferred from 0.8.
    const lopsided = { defaultSplitP1: 0.8, defaultSplitP2: 0.8 }
    expect(defaultSplitFor(lopsided, PERSON.P1)).toBe(0.8)
    expect(defaultSplitFor(lopsided, PERSON.P2)).toBe(0.8)
  })

  it('falls back per person, so one configured key does not decide the other', () => {
    expect(defaultSplitFor({ defaultSplitP1: 0.8 }, PERSON.P2)).toBe(EVEN_SHARE)
    expect(defaultSplitFor({ defaultSplitP2: 0.2 }, PERSON.P1)).toBe(EVEN_SHARE)
  })

  it('never yields a non-finite share, whatever the config carries', () => {
    // The last guard before splitCents, which throws on NaN rather than moving
    // money wrongly — but only after the form has already shown a nonsense split.
    for (const value of [NaN, Infinity, undefined, null, 'half', {}]) {
      expect(defaultSplitFor({ defaultSplitP1: value }, PERSON.P1)).toBe(EVEN_SHARE)
    }
    expect(defaultSplitFor(undefined, PERSON.P1)).toBe(EVEN_SHARE)
  })
})

describe('toSplit', () => {
  it('shows an even share as Even, with the slider hidden', () => {
    expect(toSplit(EVEN_SHARE)).toEqual({ mode: 'even', percent: 50, share: EVEN_SHARE })
  })

  it('opens Custom on the stored number, so a configured 80% lands ready to submit', () => {
    expect(toSplit(0.8)).toEqual({ mode: 'custom', percent: 80, share: 0.8 })
    expect(toSplit(0)).toEqual({ mode: 'custom', percent: 0, share: 0 })
    expect(toSplit(1)).toEqual({ mode: 'custom', percent: 100, share: 1 })
  })

  it('carries the exact share, so displaying it cannot re-quantize it', () => {
    // A default_split_p1 of 33.3 stores 0.333. The slider is whole percents, so it
    // shows 33 — but saving 0.33 would move ¥300 of a ¥100,000 expense on an edit
    // that only touched the note.
    const split = toSplit(0.333)
    expect(split.percent).toBe(33)
    expect(split.share).toBe(0.333)
  })
})

describe('splitAtPercent', () => {
  it('is the only place a slider position becomes a share', () => {
    // Once someone actually moves the control, whole percents ARE the decision.
    expect(splitAtPercent(70)).toEqual({ mode: 'custom', percent: 70, share: 0.7 })
    expect(splitAtPercent(0)).toEqual({ mode: 'custom', percent: 0, share: 0 })
    expect(splitAtPercent(100)).toEqual({ mode: 'custom', percent: 100, share: 1 })
  })

  it('stays Custom at 50, which is a decision rather than the default', () => {
    expect(splitAtPercent(50).mode).toBe('custom')
  })
})

describe('nextSplit', () => {
  it('returns to the payer’s configured default when Custom is re-opened', () => {
    // Not a hardcoded 50: a couple on 80/20 who tap Even and back should not have
    // to drag the slider to where the sheet already says it is.
    expect(nextSplit('custom', 0.8)).toEqual({ mode: 'custom', percent: 80, share: 0.8 })
    expect(nextSplit('custom', 0.2)).toEqual({ mode: 'custom', percent: 20, share: 0.2 })
  })

  it('reads as Custom even when the configured default is exactly even', () => {
    // Routing this through `toSplit` would answer 'even' and hide the slider the
    // person just asked for.
    expect(nextSplit('custom', EVEN_SHARE).mode).toBe('custom')
  })

  it('is exactly even when Even is chosen, whatever the default is', () => {
    expect(nextSplit('even', 0.8)).toEqual({ mode: 'even', percent: 50, share: EVEN_SHARE })
    expect(nextSplit('even', EVEN_SHARE)).toEqual({ mode: 'even', percent: 50, share: EVEN_SHARE })
  })
})
