/**
 * Donut chart, hand-rolled in inline SVG.
 *
 * No charting library: one would dwarf the rest of the bundle, and CLAUDE.md
 * forbids a new dependency without a clear reason. The geometry here is a
 * `stroke-dasharray` trick rather than arc-path math — with r chosen so the
 * circumference is exactly 100, a slice's dash length *is* its percentage.
 *
 * Form choice, deliberately narrow: a donut is only honest as part-to-whole at a
 * glance, and only up to about six segments. Past that adjacent slices blur, so
 * the tail folds into a single "Other". Anything needing precise comparison reads
 * off the legend, which carries name, value and share for every slice — that is
 * also the required relief for the three series colors that fall below 3:1
 * against white.
 */

/* r such that 2*pi*r === 100, so dasharray units are percentage points. */
const RADIUS = 15.91549431
const CIRCUMFERENCE = 100
const CENTER = 21
const THICKNESS = 5

/** Surface-colored gap between adjacent fills, in viewBox units (~2px as drawn). */
const GAP = 0.6

/** Hard cap. The palette's slot order is the colorblindness-safety mechanism and
 *  must never be cycled, so a 7th category is folded rather than recolored. */
export const MAX_SLICES = 6

/**
 * Fold a sorted-descending list down to at most MAX_SLICES entries, summing the
 * tail into one bucket.
 *
 * @param {{key: string, label: string, valueCents: number}[]} items
 * @param {string} otherLabel
 * @returns {{key: string, label: string, valueCents: number}[]}
 */
export function foldTail(items, otherLabel) {
  const list = Array.isArray(items) ? items.filter((item) => item.valueCents > 0) : []
  if (list.length <= MAX_SLICES) return list

  const head = list.slice(0, MAX_SLICES - 1)
  const tail = list.slice(MAX_SLICES - 1)
  return [
    ...head,
    {
      key: '__other__',
      label: otherLabel,
      valueCents: tail.reduce((sum, item) => sum + item.valueCents, 0),
    },
  ]
}

/**
 * @param {object} props
 * @param {{key: string, label: string, valueCents: number}[]} props.items sorted desc
 * @param {(cents: number) => string} props.formatMoney
 * @param {string} props.label accessible name for the figure
 * @param {string} props.otherLabel
 * @param {(percent: number) => string} props.formatShare
 */
export function DonutChart({ items, formatMoney, label, otherLabel, formatShare }) {
  const slices = foldTail(items, otherLabel)
  const total = slices.reduce((sum, item) => sum + item.valueCents, 0)
  if (!slices.length || total <= 0) return null

  // A lone slice gets no gap: a 100% ring with a notch in it just looks broken.
  const gap = slices.length > 1 ? GAP : 0

  let offset = 0
  const drawn = slices.map((item, index) => {
    const share = (item.valueCents / total) * 100
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
              /* Inline style, not a `stroke` attribute: `var()` is not valid in
                 an SVG presentation attribute, and any CSS rule on
                 .chart__slice would override the attribute anyway and paint
                 every slice the same color. */
              style={{ stroke: slice.color, strokeWidth: THICKNESS }}
              strokeDasharray={`${slice.dash} ${CIRCUMFERENCE - slice.dash}`}
              strokeDashoffset={slice.offset}
              /* Start at 12 o'clock instead of 3, which is where a reader
                 expects a part-to-whole ring to begin. */
              transform={`rotate(-90 ${CENTER} ${CENTER})`}
            >
              <title>{`${slice.label} ${formatMoney(slice.valueCents)}`}</title>
            </circle>
          ))}
        </svg>
      </div>

      {/* Real text, not a color key: this doubles as the table view. */}
      <ul className="chart__legend">
        {drawn.map((slice) => (
          <li className="chart__item" key={slice.key}>
            <span
              className="chart__swatch"
              style={{ backgroundColor: slice.color }}
              aria-hidden="true"
            />
            <span className="chart__name" title={slice.label}>
              {slice.label}
            </span>
            <span>
              <span className="chart__value">{formatMoney(slice.valueCents)}</span>{' '}
              <span className="chart__share">{formatShare(Math.round(slice.share))}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
