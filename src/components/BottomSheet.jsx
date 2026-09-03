import { useEffect, useId, useRef } from 'react'
import { useT } from '../i18n/index.js'
import { useKeyboardInset } from '../state/useKeyboardInset.js'
import { CloseIcon } from './icons.jsx'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Narrower than the trap's list: never the close button, which raises no keyboard. */
const FIRST_FIELD = 'input, select, textarea, button:not([data-dismiss])'

/**
 * A modal panel: full-screen page or bottom sheet on phones, centred dialog above 48rem (the CSS
 * decides which). `full` is opt-in because it is a claim about the CONTENT: a one-sentence
 * confirmation in a full-screen panel is 600px of white.
 */
export function BottomSheet({ title, full = false, onClose, children, footer }) {
  const { t } = useT()
  const panel = useRef(null)
  const titleId = useId()

  /**
   * Through a ref so the effects below do not depend on `onClose`'s identity: every caller passes a
   * fresh arrow, so a re-render behind the sheet would re-run the open effect and yank focus back.
   */
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const node = panel.current
    const root = document.documentElement
    const previous = { root: root.style.overflow, body: document.body.style.overflow }
    /**
     * Both elements: `body` alone reaches the viewport through the spec's propagation rule, which
     * applies only while `html` declares no `overflow` — one declaration in `base.css` and the
     * ledger silently pans behind every sheet.
     */
    root.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'

    // So closing can put focus back, or the VoiceOver cursor lands on `<body>`.
    const opener = document.activeElement

    const focusable = node?.querySelector(FIRST_FIELD)
    focusable?.focus({ preventScroll: true })

    return () => {
      root.style.overflow = previous.root
      document.body.style.overflow = previous.body
      // The opener is often gone by now: confirming a delete unmounts the row it came from.
      const fallback = document.querySelector('.add-action')
      const restore = opener?.isConnected ? opener : fallback
      restore?.focus?.({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const node = panel.current

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        close.current()
        return
      }
      if (event.key !== 'Tab' || !node) return
      // Per keypress: the slider and the chips come and go, so a captured list goes stale and
      // Tab escapes the panel again.
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

    // iOS raises the keyboard over the sheet without scrolling. Optional call: no DOM in tests.
    const onFocusIn = (event) => event.target.scrollIntoView?.({ block: 'nearest' })
    node?.addEventListener('focusin', onFocusIn)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      node?.removeEventListener('focusin', onFocusIn)
    }
  }, [])

  /**
   * `scrollIntoView` above cannot do this: it scrolls within `.sheet__body`, and the footer holding
   * Save is a sibling. The keypad has no Done key, so a covered footer cannot submit at all.
   */
  useKeyboardInset()

  return (
    <div className="sheet">
      {/* A `full` panel covers this below 48rem, so the X and Cancel are a phone's only ways out. */}
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
