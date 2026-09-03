import { describe, expect, it } from 'vitest'

import { EVEN_SHARE, PERSON } from '../src/schema.js'
import { defaultSplitFor, nextSplit, splitAtPercent, toSplit } from '../src/lib/split.js'

// Every fallback here is one step from `splitYen` and a wrong number on somebody's balance.
// The transitions are pure functions specifically so they can be tested: the control using
// them lives in a hook, and there is no renderer for hooks here.

describe('defaultSplitFor', () => {
  const config = { defaultSplitP1: 0.8, defaultSplitP2: 0.2 }

  it('reads only the payer’s own value', () => {
    expect(defaultSplitFor(config, PERSON.P1)).toBe(0.8)
    expect(defaultSplitFor(config, PERSON.P2)).toBe(0.2)
  })

  it('treats the two values as independent, never mirroring one from the other', () => {
    // Both covering 80% of what they pay for is coherent, so 0.2 must not follow from 0.8.
    const lopsided = { defaultSplitP1: 0.8, defaultSplitP2: 0.8 }
    expect(defaultSplitFor(lopsided, PERSON.P1)).toBe(0.8)
    expect(defaultSplitFor(lopsided, PERSON.P2)).toBe(0.8)
  })

  it('falls back per person, so one configured key does not decide the other', () => {
    expect(defaultSplitFor({ defaultSplitP1: 0.8 }, PERSON.P2)).toBe(EVEN_SHARE)
    expect(defaultSplitFor({ defaultSplitP2: 0.2 }, PERSON.P1)).toBe(EVEN_SHARE)
  })

  it('never yields a non-finite share, whatever the config carries', () => {
    // The last guard before splitYen, which throws on NaN — but only after the form has
    // already shown a nonsense split.
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
    // A stored 0.333 shows as 33 on the whole-percent slider, but saving 0.33 moves ¥300 of
    // a ¥100,000 expense on an edit that only touched the note.
    const split = toSplit(0.333)
    expect(split.percent).toBe(33)
    expect(split.share).toBe(0.333)
  })
})

describe('splitAtPercent', () => {
  it('is the only place a slider position becomes a share', () => {
    // Once someone moves the control, whole percents ARE the decision.
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
    // Not a hardcoded 50: a couple on 80/20 who tap Even and back should not have to drag
    // the slider back to where the sheet already says it is.
    expect(nextSplit('custom', 0.8)).toEqual({ mode: 'custom', percent: 80, share: 0.8 })
    expect(nextSplit('custom', 0.2)).toEqual({ mode: 'custom', percent: 20, share: 0.2 })
  })

  it('reads as Custom even when the configured default is exactly even', () => {
    // Routing through `toSplit` would answer 'even' and hide the slider just asked for.
    expect(nextSplit('custom', EVEN_SHARE).mode).toBe('custom')
  })

  it('is exactly even when Even is chosen, whatever the default is', () => {
    expect(nextSplit('even', 0.8)).toEqual({ mode: 'even', percent: 50, share: EVEN_SHARE })
    expect(nextSplit('even', EVEN_SHARE)).toEqual({ mode: 'even', percent: 50, share: EVEN_SHARE })
  })
})

// The third mode, for the recurring tab's blank `payer_share`: "follow whoever pays, at
// whatever their default is, forever". So it has to keep saving null — resolving it to a number
// detaches the cost from `default_split_p*` and switches on unattended posting.
describe('following the default', () => {
  it('reads a null share as its own mode, and keeps the share null', () => {
    const split = toSplit(null, 0.8)
    expect(split.mode).toBe('default')
    expect(split.share).toBeNull()
    // The slider still has a position to show, which is what the mode's hint names.
    expect(split.percent).toBe(80)
  })

  it('goes back to null after Even, rather than saving the even share', () => {
    // The render tests only ever show the INITIAL mode, so tapping Even and back would
    // otherwise pin 0.5 with nothing to catch it.
    expect(nextSplit('even', 0.8).share).toBe(EVEN_SHARE)
    expect(nextSplit('default', 0.8)).toEqual({ mode: 'default', percent: 80, share: null })
  })

  it('leaves a numeric share alone, whatever default is passed beside it', () => {
    // The entry form passes a configured default too, and it must change nothing there.
    expect(toSplit(EVEN_SHARE, 0.8)).toEqual({ mode: 'even', percent: 50, share: EVEN_SHARE })
    expect(toSplit(0.3, 0.8)).toEqual({ mode: 'custom', percent: 30, share: 0.3 })
  })
})
