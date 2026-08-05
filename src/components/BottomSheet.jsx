import { useEffect, useId, useRef } from 'react'
import { useT } from '../i18n/index.js'
import { CloseIcon } from './icons.jsx'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Bottom sheet on phones, centred dialog on wider screens (the CSS decides
 * which). Handles Escape, backdrop dismissal, background scroll locking, focus
 * trapping, and moving focus into the panel on open.
 */
export function BottomSheet({ title, onClose, children, footer }) {
  const { t } = useT()
  const panel = useRef(null)
  const titleId = useId()

  useEffect(() => {
    const node = panel.current

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose()
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

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Focus the first control rather than the panel, so a phone keyboard
    // comes straight up for the amount field.
    const focusable = node?.querySelector('input, select, textarea, button:not([data-dismiss])')
    focusable?.focus({ preventScroll: true })

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      node?.removeEventListener('focusin', onFocusIn)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  return (
    <div className="sheet">
      <div className="sheet__backdrop" onClick={onClose} />
      <div
        className="sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panel}
      >
        <div className="sheet__handle" />
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
