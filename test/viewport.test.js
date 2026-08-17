import { describe, expect, it } from 'vitest'

import { keyboardInset } from '../src/lib/viewport.js'

/**
 * The one piece of arithmetic behind the sheet clearing the software keyboard.
 *
 * `position: fixed` and `dvh` are both anchored to the layout viewport, which iOS
 * does not shrink for the keyboard, so this difference is the only signal there is —
 * and getting it wrong leaves the Save button under a keypad that has no Done key.
 */
describe('keyboardInset', () => {
  it('is zero with no keyboard, whatever the viewport size', () => {
    expect(keyboardInset({ innerHeight: 852, height: 852, offsetTop: 0 })).toBe(0)
    expect(keyboardInset({ innerHeight: 375, height: 375, offsetTop: 0 })).toBe(0)
  })

  it('is the covered height when a keyboard is up', () => {
    // iPhone SE with the decimal keypad: 667 layout, 331 visual.
    expect(keyboardInset({ innerHeight: 667, height: 331, offsetTop: 0 })).toBe(336)
  })

  it('accounts for the visual viewport being scrolled within the layout one', () => {
    // iOS shifts the visual viewport to follow the focused field. Ignoring offsetTop
    // reports an inset smaller than the keyboard, so the footer stays half-covered.
    expect(keyboardInset({ innerHeight: 667, height: 331, offsetTop: 100 })).toBe(236)
  })

  it('never goes negative, however the viewport is reported', () => {
    // A pinch-zoomed visual viewport can be taller than the layout one.
    expect(keyboardInset({ innerHeight: 667, height: 800, offsetTop: 0 })).toBe(0)
    expect(keyboardInset({ innerHeight: 667, height: 600, offsetTop: 300 })).toBe(0)
  })

  it('reads a zoomed viewport at its unzoomed scale, rather than inventing a keyboard', () => {
    // Zoom shrinks the visual viewport exactly as a keyboard does, so the bare
    // difference reports 426px of keypad that is not there — and at full screen that
    // opens the form at half the screen's height.
    expect(keyboardInset({ innerHeight: 852, height: 426, offsetTop: 0, scale: 2 })).toBe(0)
    // But a keyboard UNDER that zoom is still real, and still has no Done key: at 2x a
    // 336px keypad covers 168 CSS px of the visible region.
    expect(keyboardInset({ innerHeight: 852, height: 258, offsetTop: 0, scale: 2 })).toBe(336)
    // iOS's near-1 scale at rest must not cost a pixel to the floor.
    expect(
      keyboardInset({ innerHeight: 667, height: 331, offsetTop: 0, scale: 1.0000000000000002 }),
    ).toBe(336)
  })

  it('floors a fractional inset rather than rounding it up', () => {
    // Rounding up would leave the panel a hairline short of the keyboard's top edge.
    expect(keyboardInset({ innerHeight: 667.5, height: 331.2, offsetTop: 0 })).toBe(336)
  })

  it('answers zero rather than NaN when there is no visual viewport to read', () => {
    // Every browser the app runs on has one; a test renderer does not.
    expect(keyboardInset()).toBe(0)
    expect(keyboardInset({})).toBe(0)
    expect(keyboardInset({ innerHeight: 667 })).toBe(0)
  })
})
