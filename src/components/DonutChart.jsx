/**
 * Donut chart, hand-rolled in inline SVG: no charting library, and a `stroke-dasharray` trick rather
 * than arc-path math — r is chosen so the circumference is exactly 100, making a dash a percentage.
 *
 * A donut is only honest up to about six segments, so the tail folds into one "Other". The legend
 * carries name, value and share per slice, which is also the required relief for the three series
 * colors that fall below 3:1 against white.
 */

/* r such that 2*pi*r === 100, so dasharray units are percentage points. */
const RADIUS = 15.91549431
const CIRCUMFERENCE = 100
const CENTER = 21
const THICKNESS = 5

/** Gap between adjacent fills, in viewBox units (~2px as drawn). */
const GAP = 0.6

/** The palette's slot order is the colorblindness-safety mechanism and must never be cycled. */
export const MAX_SLICES = 6

export function foldTail(items, otherLabel) {
  const list = Array.isArray(items) ? items.filter((item) => item.valueYen > 0) : []
  if (list.length <= MAX_SLICES) return list

  const head = list.slice(0, MAX_SLICES - 1)
  const tail = list.slice(MAX_SLICES - 1)
  return [
    ...head,
    {
      key: '__other__',
      label: otherLabel,
      valueYen: tail.reduce((sum, item) => sum + item.valueYen, 0),
    },
  ]
}

/**
 * @param {object} props
 * @param {{key: string, label: string, valueYen: number}[]} props.items sorted desc
 * @param {string} props.label accessible name for the figure
 */
export function DonutChart({ items, formatMoney, label, otherLabel, formatShare }) {
  const slices = foldTail(items, otherLabel)
  const total = slices.reduce((sum, item) => sum + item.valueYen, 0)
  if (!slices.length || total <= 0) return null

  // A lone slice gets no gap: a 100% ring with a notch looks broken.
  const gap = slices.length > 1 ? GAP : 0

  let offset = 0
  const drawn = slices.map((item, index) => {
    const share = (item.valueYen / total) * 100
    const dash = Math.max(0, share - gap)
    const segment = {
      ...item,
      share,
      color: `var(--series-${index + 1})`,
      dash,
      // Negative offset advances clockwise from the 12 o'clock rotation below.
      offset: -offset,
    }
    offset += share
    return segment
  })

  return (
    <div className="chart">
      <div className="chart__figure">
        <svg
          className="chart__svg"
          viewBox="0 0 42 42"
          role="img"
          aria-label={label}
          focusable="false"
        >
          {drawn.map((slice) => (
            <circle
              key={slice.key}
              className="chart__slice"
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              /* Inline, not an attribute: `var()` is invalid there, and a CSS rule on
                 .chart__slice would override it and paint every slice one color. */
              style={{ stroke: slice.color, strokeWidth: THICKNESS }}
              strokeDasharray={`${slice.dash} ${CIRCUMFERENCE - slice.dash}`}
              strokeDashoffset={slice.offset}
              /* Start at 12 o'clock, where a reader expects a ring to begin. */
              transform={`rotate(-90 ${CENTER} ${CENTER})`}
            >
              <title>{`${slice.label} ${formatMoney(slice.valueYen)}`}</title>
            </circle>
          ))}
        </svg>
      </div>

      {/* Real text, not a color key: it doubles as the table view. */}
      <ul className="chart__legend">
        {drawn.map((slice) => (
          <li className="chart__item" key={slice.key}>
            <span
              className="chart__swatch"
              style={{ backgroundColor: slice.color }}
              aria-hidden="true"
            />
            {/* No `title`: the name wraps in full, and iOS has no hover to show one. */}
            <span className="chart__name">{slice.label}</span>
            <span>
              <span className="chart__value">{formatMoney(slice.valueYen)}</span>{' '}
              <span className="chart__share">{formatShare(Math.round(slice.share))}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
