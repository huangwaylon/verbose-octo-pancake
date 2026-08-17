/**
 * Visual-viewport arithmetic, kept pure so it can be tested without a browser.
 *
 * `position: fixed` is anchored to the LAYOUT viewport, which iOS does not shrink
 * when the software keyboard appears (Safari's default is
 * `interactive-widget=resizes-visual`). A bottom-anchored sheet therefore keeps its
 * full height and puts its footer — the Save button — behind the keyboard, and
 * `dvh` does not help because it tracks the layout viewport too.
 */

/**
 * How many pixels of the layout viewport are covered from the bottom, which is the
 * keyboard's height whenever one is up.
 *
 * `offsetTop` matters because iOS scrolls the visual viewport within the layout one
 * to keep the focused field visible: without it, a page scrolled up by the keyboard
 * reports an inset smaller than the keyboard actually is.
 *
 * `scale` matters because zoom shrinks the visual viewport exactly as a keyboard does.
 * `height` is CSS pixels of the *visible* region, so at 2x it reports half the screen
 * and the bare difference invents ~400px of keyboard that is not there — which the
 * full-screen panel would subtract from its own height, opening the form at half the
 * screen. Multiplying it back up is what makes the two cases one formula: the page is
 * deliberately zoomable, and answering zero instead would put Save behind a real
 * keypad that has no Done key. `offsetTop` is already layout-relative, so it is not
 * scaled.
 *
 * @param {{innerHeight: number, height: number, offsetTop: number, scale: number}} viewport
 * @returns {number} whole pixels, never negative
 */
export function keyboardInset({ innerHeight, height, offsetTop, scale } = {}) {
  if (!Number.isFinite(innerHeight) || !Number.isFinite(height)) return 0
  // Rounded before the subtraction: iOS reports a scale of 1.0000000000000002 at rest
  // often enough that the product would land a pixel short and lose one to the floor.
  const visible = Math.round(height * (Number.isFinite(scale) ? scale : 1))
  const covered = innerHeight - visible - (Number.isFinite(offsetTop) ? offsetTop : 0)
  // Rounded down: a fractional inset would leave a hairline of keyboard over the
  // footer, and half a pixel of slack never shows.
  return covered > 0 ? Math.floor(covered) : 0
}
