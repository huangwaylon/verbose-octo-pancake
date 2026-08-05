import { useEffect, useId, useRef } from 'react'
import { useT } from '../i18n/index.js'
import { CloseIcon } from './icons.jsx'

/**
 * Bottom sheet on phones, centred dialog on wider screens (the CSS decides
 * which). Handles Escape, backdrop dismissal, background scroll locking, and
 * moving focus into the panel on open.
 */
export function BottomSheet({ title, onClose, children, footer }) {
  const { t } = useT()
  const panel = useRef(null)
  const titleId = useId()

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Focus the first control rather than the panel, so a phone keyboard
    // comes straight up for the amount field.
    const focusable = panel.current?.querySelector(
      'input, select, textarea, button:not([data-dismiss])',
    )
    focusable?.focus({ preventScroll: true })

    return () => {
      document.removeEventListener('keydown', onKeyDown)
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
            className="btn btn--icon btn--ghost"
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
