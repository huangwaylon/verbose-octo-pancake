/**
 * A button that is on or off. `aria-pressed` says which, because the fill alone carries it by colour
 * and VoiceOver announces both states identically without it; the label never flips, since a
 * flipping label never says whether it names the state on screen or the one a tap away.
 */
export function ToggleButton({ pressed, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={`btn btn--sm ${pressed ? 'btn--primary' : 'btn--ghost'}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
