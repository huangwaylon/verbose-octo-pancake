import { useMoney } from '../i18n/index.js'

/**
 * One line in an entry list: the description and its meta line, the amount, and one
 * trailing control.
 *
 * Both lists render this — the month's and the deleted one — and what they disagree about
 * is whether the left side is a control. That difference is load-bearing rather than
 * cosmetic: in the month's list it IS the edit affordance, while in the deleted list the
 * same classes are inert text, where a press state would promise a tap that does nothing.
 * So `onOpen` decides the element, and `app.css` carries the touch and selection rules on
 * `button.entry__main` alone to match.
 *
 * The pending class lives here rather than in either caller, because an optimistic row
 * looks the same on both surfaces.
 */
export function EntryLine({
  entry,
  description,
  meta,
  icon = null,
  settlement = false,
  onOpen,
  children,
}) {
  // Safe inside the memoised row components: `useMoney`'s identity only changes with
  // the language.
  const money = useMoney()
  const className = `entry${settlement ? ' entry--settlement' : ''}${
    entry.pending ? ' entry--pending' : ''
  }`

  const body = (
    <>
      <span className="entry__desc">
        {icon}
        {description}
      </span>
      <span className="entry__meta">{meta}</span>
    </>
  )

  return (
    <li className={className}>
      {onOpen ? (
        <button type="button" className="entry__main" onClick={onOpen}>
          {body}
        </button>
      ) : (
        <span className="entry__main">{body}</span>
      )}
      <span className="entry__amount tnum">{money(entry.amountYen)}</span>
      {children}
    </li>
  )
}
