/**
 * Visual-viewport arithmetic, pure so it can be tested without a browser.
 * `state/useKeyboardInset.js` publishes the result.
 */

/**
 * How many pixels of the LAYOUT viewport are covered from the bottom — the software keyboard's
 * height whenever one is up.
 *
 * `offsetTop`, because iOS scrolls the visual viewport within the layout one to follow the focused
 * field, so without it a scrolled page reports an inset smaller than the keyboard is. `scale`,
 * because zoom shrinks the visual viewport exactly as a keyboard does, so at 2x the bare
 * difference invents ~400px of keyboard.
 *
 * @returns {number} whole pixels, never negative
 */
export function keyboardInset({ innerHeight, height, offsetTop, scale } = {}) {
  if (!Number.isFinite(innerHeight) || !Number.isFinite(height)) return 0
  // Rounded before the subtraction: iOS reports a scale of 1.0000000000000002 at rest often
  // enough that the product would land a pixel short and lose one to the floor.
  const visible = Math.round(height * (Number.isFinite(scale) ? scale : 1))
  const covered = innerHeight - visible - (Number.isFinite(offsetTop) ? offsetTop : 0)
  // Floored: a fractional inset leaves a hairline of keyboard over the footer.
  return covered > 0 ? Math.floor(covered) : 0
}
