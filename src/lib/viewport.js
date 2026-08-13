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
 * @param {{innerHeight: number, height: number, offsetTop: number}} viewport
 * @returns {number} whole pixels, never negative
 */
export function keyboardInset({ innerHeight, height, offsetTop } = {}) {
  if (!Number.isFinite(innerHeight) || !Number.isFinite(height)) return 0
  const covered = innerHeight - height - (Number.isFinite(offsetTop) ? offsetTop : 0)
  // Rounded down: a fractional inset from a zoomed viewport would leave a hairline
  // of keyboard over the footer, and half a pixel of slack never shows.
  return covered > 0 ? Math.floor(covered) : 0
}
