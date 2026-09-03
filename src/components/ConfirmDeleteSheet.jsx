import { ConfirmSheet } from './ConfirmSheet.jsx'
import { useEntryTitle, useMoney, useT } from '../i18n/index.js'

/**
 * `ConfirmSheet`'s entry-shaped wrapper. The row's delete control sits a thumb's width from the row,
 * so the guard has to be this dialog. It names and prices the entry so "Delete" answers an actual
 * question, and says where the entry goes, because a recoverable delete is a different decision.
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
