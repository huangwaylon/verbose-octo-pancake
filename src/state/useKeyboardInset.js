import { useEffect } from 'react'
import { keyboardInset } from '../lib/viewport.js'

/** Read by CSS, so a surface can lift its own controls above the software keyboard. */
const KEYBOARD_INSET = '--keyboard-inset'

/**
 * Publish how much of the LAYOUT viewport the software keyboard covers. iOS does not shrink the
 * layout viewport for it, and `position: fixed` and `dvh` are both anchored to it — so anything
 * reaching the bottom of the screen puts its own controls behind the keypad, which on the decimal
 * pad has no Done key. `scrollIntoView` cannot substitute: it moves content within a scroller, and
 * the controls in question are siblings of one (the sheet's footer) or centred in a box exactly one
 * viewport tall (the key screen).
 *
 * Mounted by whichever surface owns a text field rather than once for the app: the `scroll`
 * listener fires per frame while iOS follows the focused field, and the two surfaces are never on
 * screen together. The arithmetic is in `lib/viewport.js`, where a test can reach it.
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
      // Only on a change: the property is inherited from the root, so every write invalidates
      // computed style for the whole document — the ledger behind a sheet included — and `scroll`
      // fires every frame while iOS shifts the visual viewport, across which the inset is constant.
      if (inset === published) return
      published = inset
      root.style.setProperty(KEYBOARD_INSET, `${inset}px`)
    }
    sync()
    // `scroll` as well as `resize`: iOS shifts the visual viewport within the layout one to follow
    // the focused field, without changing its height.
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
      root.style.removeProperty(KEYBOARD_INSET)
    }
  }, [])
}
