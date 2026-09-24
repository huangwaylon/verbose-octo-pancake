import { useState } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { useT } from '../i18n/index.js'

/**
 * The stop between a destructive control and a write, and the one home of that shape.
 *
 * Cancel comes FIRST in the DOM as well as on screen, because `BottomSheet` focuses the first
 * control it finds and on a destructive dialog that must be the way out. Content-sized rather than
 * full screen, because a one-sentence question in a full-screen panel is 600px of white.
 *
 * The caller supplies the sentence: only it knows what is destroyed and whether it can be undone.
 *
 * A caller whose write is not optimistic returns its promise from `onConfirm`, and the sheet stays
 * up and busy until it settles, so nothing can act on what is being destroyed in the meantime.
 */
export function ConfirmSheet({ title, body, confirmLabel, onConfirm, onClose }) {
  const { t } = useT()
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet
      title={title}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--danger" onClick={confirm} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {confirmLabel ?? t('common.delete')}
          </button>
        </>
      }
    >
      <p className="confirm__text">{body}</p>
    </BottomSheet>
  )
}
