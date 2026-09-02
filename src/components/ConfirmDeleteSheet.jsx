import { BottomSheet } from './BottomSheet.jsx'
import { useEntryTitle, useMoney, useT } from '../i18n/index.js'

/**
 * The stop between the trash icon and a write.
 *
 * The row's delete control sits a thumb's width from the row itself, so the
 * guard has to be this dialog rather than the button's placement. It names and
 * prices the entry so that "Delete" is answering an actual question, and it says
 * where the entry goes, because a delete someone can undo is a different
 * decision from one they cannot.
 */
export function ConfirmDeleteSheet({ entry, onConfirm, onClose }) {
  const { t } = useT()
  const money = useMoney()
  const title = useEntryTitle(entry)

  return (
    <BottomSheet
      title={t('confirm.deleteTitle')}
      onClose={onClose}
      /* Cancel first in the DOM as well as on screen: BottomSheet focuses the
         first control on open, and on a destructive dialog that must be the
         way out. */
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            {t('common.delete')}
          </button>
        </>
      }
    >
      <p className="confirm__text">
        {t('confirm.deleteBody', {
          description: title,
          amount: money(entry.amountYen),
        })}
      </p>
    </BottomSheet>
  )
}
