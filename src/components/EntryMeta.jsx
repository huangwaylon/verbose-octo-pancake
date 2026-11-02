import { EVEN_SHARE, isSettlement, otherPerson } from '../schema.js'
import { PERSON_MARK } from '../lib/identity.js'
import { percentOf, shareFor } from '../lib/split.js'
import { useT } from '../i18n/index.js'
import { useTNodes } from '../i18n/nodes.jsx'

/**
 * An entry's second line — who paid, the category when the title is the note, and the split when it
 * is not the even one — shared by the month's list and the deleted list, so a tombstone says what its
 * live twin said. `date` leads it in the deleted list, whose rows span the month.
 *
 * Seen and heard differently, as the hero figure is: at 320px a name per row is an ellipsis where
 * the category should be, so the eye gets the people as marks and the split as the VIEWER's share,
 * while a screen reader, which has no use for a panda, hears the sentence.
 */
export function EntryMeta({ entry, label, me, date = null }) {
  const { t } = useT()
  const tNodes = useTNodes()
  const separator = t('entry.metaSeparator')
  const payer = entry.payer
  const other = otherPerson(payer)

  if (isSettlement(entry)) {
    return (
      <Lines
        date={date}
        seen={tNodes('entry.settlementDirection', {
          payer: <Mark person={payer} />,
          other: <Mark person={other} />,
        })}
        heard={t('entry.settlementMeta', { payer: label(payer), other: label(other) })}
      />
    )
  }

  // The title is the note when there is one, and the category otherwise; never both lines saying it.
  const category = entry.description ? entry.category : ''
  const percent = entry.payerShare === EVEN_SHARE ? null : percentOf(shareFor(entry, me))

  return (
    <Lines
      date={date}
      seen={
        <>
          <Mark person={payer} />
          {/* A separator after the mark too: "🐻 0%" reads as the bear's 0%. The category is the
              one part that shrinks, so a long one never pushes the share — the figure that moves
              money — off the end of the line. */}
          {category && <span className="entry__meta-category">{separator + category}</span>}
          {percent != null && (
            <span className="entry__meta-share">
              {separator + t('entry.sharePercent', { percent })}
            </span>
          )}
        </>
      }
      heard={[
        category
          ? t('entry.paidCategory', { name: label(payer), category })
          : t('common.paid', { name: label(payer) }),
        percent != null && t('entry.yourShare', { percent }),
      ]
        .filter(Boolean)
        .join(separator)}
    />
  )
}

function Lines({ date, seen, heard }) {
  const { t } = useT()
  const tNodes = useTNodes()
  return (
    <>
      <span className="entry__meta-seen" aria-hidden="true">
        {date ? tNodes('deleted.dated', { date, meta: seen }) : seen}
      </span>
      <span className="visually-hidden">
        {date ? t('deleted.dated', { date, meta: heard }) : heard}
      </span>
    </>
  )
}

function Mark({ person }) {
  return <span className="entry__mark">{PERSON_MARK[person]}</span>
}
