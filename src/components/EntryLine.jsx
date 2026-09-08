import { useMoney } from '../i18n/index.js'
import { SwapIcon } from './icons.jsx'

/**
 * One line in an entry list. Both lists render this, and what they disagree about is whether the
 * left side is a control: in the month's list it IS the edit affordance, in the deleted list the
 * same classes are inert text where a press state would promise a tap that does nothing. So `onOpen`
 * decides the element, and `app.css` carries the touch rules on `button.entry__main` alone.
 */
export function EntryLine({ entry, description, meta, settlement = false, onOpen, children }) {
  const money = useMoney()
  const className = `entry${settlement ? ' entry--settlement' : ''}${
    entry.pending ? ' entry--pending' : ''
  }`

  const body = (
    <>
      <span className="entry__desc">
        {/* The glyph belongs with the class it goes with, not composed identically by both lists. */}
        {settlement && <SwapIcon width={16} height={16} />}
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
