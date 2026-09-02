/** Inline SVG icons. Kept local so the app needs no icon dependency or CDN. */

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
}

export function PlusIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function ChevronLeftIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

export function ChevronRightIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

/**
 * An eight-tooth cog, and the one icon here whose path is not hand-drawn.
 *
 * Every point is `(12 + r·cos θ, 12 + r·sin θ)` at `θ = 45k° ± 13°`, on `r = 9.2` at a
 * tooth's tip and `r = 6.5` at its root — so the eight teeth are centred on the 45°
 * steps and every shoulder is radial, symmetric by construction. A hand-transcribed
 * gear lands one tooth slightly off, which at 20px reads as an unfinished glyph.
 * Regenerate rather than retouch: the symmetry is in the arithmetic, not the digits.
 */
export function SettingsIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="2.9" />
      <path d="M10.54 5.67L9.93 3.04A9.2 9.2 0 0 1 14.07 3.04L13.46 5.67A6.5 6.5 0 0 1 15.44 6.49L16.88 4.2A9.2 9.2 0 0 1 19.8 7.12L17.51 8.56A6.5 6.5 0 0 1 18.33 10.54L20.96 9.93A9.2 9.2 0 0 1 20.96 14.07L18.33 13.46A6.5 6.5 0 0 1 17.51 15.44L19.8 16.88A9.2 9.2 0 0 1 16.88 19.8L15.44 17.51A6.5 6.5 0 0 1 13.46 18.33L14.07 20.96A9.2 9.2 0 0 1 9.93 20.96L10.54 18.33A6.5 6.5 0 0 1 8.56 17.51L7.12 19.8A9.2 9.2 0 0 1 4.2 16.88L6.49 15.44A6.5 6.5 0 0 1 5.67 13.46L3.04 14.07A9.2 9.2 0 0 1 3.04 9.93L5.67 10.54A6.5 6.5 0 0 1 6.49 8.56L4.2 7.12A9.2 9.2 0 0 1 7.12 4.2L8.56 6.49A6.5 6.5 0 0 1 10.54 5.67Z" />
    </svg>
  )
}

export function RefreshIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M21 12a9 9 0 11-3.2-6.9" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

export function TrashIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  )
}

export function CloseIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

/**
 * Retire / restore a recurring cost: a clock. Not a trash can — nothing is destroyed and the
 * same control brings it back, so a destructive glyph would promise the wrong thing.
 */
export function RetireIcon(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  )
}

export function SwapIcon(props) {
  return (
    <svg {...base} {...props}>
      <path d="M7 10h13l-3-3M17 14H4l3 3" />
    </svg>
  )
}

export function WalletIcon(props) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19M16 14.5h2" />
    </svg>
  )
}
