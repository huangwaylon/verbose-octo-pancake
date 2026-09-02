import { ConfirmSheet } from './ConfirmSheet.jsx'
import { useEntryTitle, useMoney, useT } from '../i18n/index.js'

/**
 * The stop between an entry's trash icon and a write.
 *
 * The row's delete control sits a thumb's width from the row itself, so the guard has to be
 * this dialog rather than the button's placement. It names and prices the entry so that
 * "Delete" is answering an actual question, and it says where the entry goes, because a delete
 * someone can undo is a different decision from one they cannot.
 *
 * A thin wrapper over `ConfirmSheet` with a real job of its own: turning an entry into that
 * sentence. The dialog's own rules — Cancel first in the DOM, content-sized — stay in one
 * place, which is what keeps the two destructive confirmations from drifting apart.
 */
export function ConfirmDeleteSheet({ entry, onConfirm, onClose }) {
  const { t } = useT()
  const money = useMoney()
  const title = useEntryTitle(entry)

  return (
    <ConfirmSheet
      title={t('confirm.deleteTitle')}
      body={t('confirm.deleteBody', { description: title, amount: money(entry.amountYen) })}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
}
