import { memo } from 'react'
import { isSettlement as isTransfer } from '../schema.js'
import { useEntryTitle, useT } from '../i18n/index.js'
import { EntryLine } from './EntryLine.jsx'
import { EntryMeta } from './EntryMeta.jsx'
import { TrashIcon } from './icons.jsx'

/**
 * One row in the month's list. `label` arrives from the list, so a long month resolves the two names
 * once instead of per row; `me` is who the split is stated for.
 *
 * Memoised because a row is the app's most repeated unit: without it, adding one entry makes every
 * other row re-derive its title, meta sentence and `Intl` formatter for byte-identical markup.
 */
function EntryRowInner({ entry, label, me, onEdit, onDelete }) {
  const { t } = useT()
  const description = useEntryTitle(entry)
  const isSettlement = isTransfer(entry)

  return (
    <EntryLine
      entry={entry}
      description={description}
      meta={<EntryMeta entry={entry} label={label} me={me} />}
      settlement={isSettlement}
      /* A row still saving refuses an edit or a delete (`entryWriteRefusal`), so it offers neither
         rather than letting someone fill in a form it will then turn down. */
      onOpen={entry.pending ? undefined : () => onEdit(entry)}
    >
      <button
        type="button"
        className="btn btn--icon entry__delete"
        onClick={() => onDelete(entry)}
        disabled={Boolean(entry.pending)}
        aria-label={isSettlement ? t('entry.deleteSettlement') : t('entry.delete', { description })}
      >
        <TrashIcon width={18} height={18} />
      </button>
    </EntryLine>
  )
}

export const EntryRow = memo(EntryRowInner)
