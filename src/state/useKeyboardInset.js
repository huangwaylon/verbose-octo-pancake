import { useEffect } from 'react'
import { keyboardInset } from '../lib/viewport.js'

/** Read by CSS, so a surface can lift its own controls above the software keyboard. */
const KEYBOARD_INSET = '--keyboard-inset'

/**
 * Publish how much of the LAYOUT viewport the software keyboard covers.
 *
 * iOS does not shrink the layout viewport for the keyboard, and `position: fixed` and
 * `dvh` are both anchored to it — so anything that reaches the bottom of the screen
 * puts its own controls behind the keypad, which on the decimal pad has no Done key to
 * escape with. `scrollIntoView` cannot substitute: it moves content within a scroller,
 * and the controls in question are siblings of one (the sheet's footer) or centred in a
 * box exactly one viewport tall (the key screen), where there is nothing to scroll.
 *
 * Mounted by whichever surface owns a text field, rather than once for the app: the
 * `scroll` listener fires per frame while iOS follows the focused field, and the two
 * surfaces that need it are never on screen at the same time. The arithmetic itself is
 * in `lib/viewport.js`, where a test can reach it.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const root = document.documentElement
    let published = null
    const sync = () => {
      const inset = keyboardInset({
        innerHeight: window.innerHeight,
        height: viewport.height,
        offsetTop: viewport.offsetTop,
        scale: viewport.scale,
      })
      // Only on a change. The property is inherited from the root, so every write
      // invalidates computed style for the whole document — the ledger still mounted
      // behind a sheet included — and `scroll` fires every frame while iOS shifts the
      // visual viewport to follow the focused field. The inset is deliberately constant
      // across exactly those events (`keyboardInset` subtracts `offsetTop` so that it
      // is), so without this the keyboard animation pays for a full style invalidation
      // per frame to publish the number it already had.
      if (inset === published) return
      published = inset
      root.style.setProperty(KEYBOARD_INSET, `${inset}px`)
    }
    sync()
    // `scroll` as well as `resize`: iOS shifts the visual viewport within the layout
    // one to follow the focused field, without changing its height.
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
      root.style.removeProperty(KEYBOARD_INSET)
    }
  }, [])
}
