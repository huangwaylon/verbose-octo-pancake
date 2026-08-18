import { useEffect, useId, useRef } from 'react'
import { useT } from '../i18n/index.js'
import { useKeyboardInset } from '../state/useKeyboardInset.js'
import { CloseIcon } from './icons.jsx'

/** Every stop the focus trap cycles through. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Where focus LANDS on open, which is deliberately narrower than the trap's list:
 * the first field, never a link and never the close button — a sheet that opens with
 * focus on its own dismiss control raises no keyboard and reads as already leaving.
 */
const FIRST_FIELD = 'input, select, textarea, button:not([data-dismiss])'

/**
 * A modal panel: full-screen page or bottom sheet on phones, centred dialog on wider
 * screens (the CSS decides which). Handles Escape, backdrop dismissal, background
 * scroll locking, focus trapping, moving focus into the panel on open, and staying
 * clear of the software keyboard.
 *
 * `full` opts into the full-screen phone treatment, and it is opt-in because it is a
 * claim about the CONTENT: a page's worth of form earns the whole screen, while a
 * one-sentence confirmation in the same panel would become 600px of white asking
 * whether to delete a ¥480 coffee. It changes nothing at or above 48rem.
 */
export function BottomSheet({ title, full = false, onClose, children, footer }) {
  const { t } = useT()
  const panel = useRef(null)
  const titleId = useId()

  /**
   * Read through a ref so the effects below do not depend on `onClose`'s identity.
   * Every caller passes a fresh inline arrow, so a re-render of the screen behind
   * the sheet — a focus refresh landing while someone types — would otherwise
   * re-run the open effect and yank focus back to the first field mid-entry.
   */
  const close = useRef(onClose)
  close.current = onClose

  // Opening the sheet: lock the background and move focus in, exactly once.
  useEffect(() => {
    const node = panel.current
    const root = document.documentElement
    const previous = { root: root.style.overflow, body: document.body.style.overflow }
    /**
     * Both elements, not just `body`. Setting it on `body` alone reaches the viewport
     * only through the spec's propagation rule, which applies while `html` declares no
     * `overflow` of its own — one declaration added to that rule in `base.css` and the
     * ledger silently pans behind every sheet again. Safari is also the platform where
     * a body-only lock is least reliable for touch panning. `overflow: hidden` keeps
     * the scroll position, unlike the `position: fixed` version of this trick.
     */
    root.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'

    /**
     * Where focus came from, so closing can put it back. Without this the VoiceOver
     * cursor lands on `<body>` every time a sheet closes, and a phone user restarts
     * from the top of the page after every entry.
     */
    const opener = document.activeElement

    // Focus the first control rather than the panel, so a phone keyboard
    // comes straight up for the amount field.
    const focusable = node?.querySelector(FIRST_FIELD)
    focusable?.focus({ preventScroll: true })

    return () => {
      root.style.overflow = previous.root
      document.body.style.overflow = previous.body
      // `isConnected` because the opener is often gone by now: the row's own trash
      // control opens the delete confirmation, and confirming unmounts the row. The
      // add button is the honest fallback — it is where the flow started.
      const fallback = document.querySelector('.add-action')
      const restore = opener?.isConnected ? opener : fallback
      restore?.focus?.({ preventScroll: true })
    }
  }, [])

  // Escape, the focus trap, and keeping the focused field above the keyboard.
  useEffect(() => {
    const node = panel.current

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        close.current()
        return
      }
      if (event.key !== 'Tab' || !node) return
      // Queried per keypress, not once on mount: the split slider and the
      // preset chips appear and disappear, so a captured list goes stale and
      // the trap starts letting Tab past the panel again.
      const stops = node.querySelectorAll(FOCUSABLE)
      if (!stops.length) return
      const first = stops[0]
      const last = stops[stops.length - 1]
      const inside = node.contains(document.activeElement)
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    // iOS raises the keyboard over the sheet without scrolling anything, so a
    // lower field — or the footer's Save button — stays behind it. Optional
    // call: there is no DOM under the static-markup render tests.
    const onFocusIn = (event) => event.target.scrollIntoView?.({ block: 'nearest' })
    node?.addEventListener('focusin', onFocusIn)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      node?.removeEventListener('focusin', onFocusIn)
    }
  }, [])

  /**
   * Lift the panel clear of the software keyboard. `scrollIntoView` above cannot do
   * this job: it scrolls within `.sheet__body`, and the footer holding Save is a
   * sibling of that body, not content inside it. The decimal keypad has no Done key,
   * so a footer behind the keyboard leaves no way to submit at all.
   */
  useKeyboardInset()

  return (
    <div className="sheet">
      {/* Below 48rem a `full` panel covers this entirely, so backdrop dismissal is a
          wider-screen affordance — which is why the X and the footer's Cancel both
          stay: they are the only two routes a phone has. */}
      <div className="sheet__backdrop" onClick={onClose} />
      <div
        className={full ? 'sheet__panel sheet__panel--full' : 'sheet__panel'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panel}
      >
        <header className="sheet__header">
          <h2 className="sheet__title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="btn btn--icon"
            onClick={onClose}
            aria-label={t('common.close')}
            data-dismiss
          >
            <CloseIcon />
          </button>
        </header>
        <div className="sheet__body">{children}</div>
        {footer ? <footer className="sheet__footer">{footer}</footer> : null}
      </div>
    </div>
  )
}
