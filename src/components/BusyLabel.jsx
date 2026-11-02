/**
 * A busy button's contents: the spinner BESIDE the label, never instead of it. Alone it names the
 * button nothing, and the button narrows mid-tap, sliding the control beside it under the thumb.
 */
export function BusyLabel({ busy, children }) {
  return (
    <>
      {busy ? <span className="spinner" /> : null}
      {children}
    </>
  )
}
