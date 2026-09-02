import { BottomSheet } from './BottomSheet.jsx'
import { useT } from '../i18n/index.js'

/**
 * The stop between a destructive control and a write, and the one home of that shape.
 *
 * Two things about it are load-bearing and neither is visual. Cancel comes FIRST in the DOM as
 * well as on screen, because `BottomSheet` focuses the first control it finds and on a
 * destructive dialog that must be the way out. And it is content-sized rather than full
 * screen — `full` is a claim about the content, and a one-sentence question in a full-screen
 * panel is 600px of white asking whether to delete a ¥480 coffee.
 *
 * The caller supplies the sentence, because only the caller knows what is being destroyed and
 * whether it can be undone. A delete someone can recover from is a different decision from one
 * they cannot, and the body is where that gets said.
 */
export function ConfirmSheet({ title, body, confirmLabel, onConfirm, onClose }) {
  const { t } = useT()

  return (
    <BottomSheet
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            {confirmLabel ?? t('common.delete')}
          </button>
        </>
      }
    >
      <p className="confirm__text">{body}</p>
    </BottomSheet>
  )
}
