import { useT } from '../i18n/index.js'

/**
 * The footer both forms wear: an optional leading control, Cancel, then submit.
 *
 * Cancel comes before submit in the DOM as well as on screen, the same ordering
 * `ConfirmSheet` keeps. The submit button carries `aria-describedby` for a save failure
 * because IT is the control that produced it — and ids being document-global is what lets it
 * point at a message inside a `<form>` this sits outside of.
 *
 * `busy` disables all three rather than the submit alone: the leading control on each of these
 * forms writes to the sheet too, and a second write started while the first is in flight is
 * two writes racing for one row.
 *
 * @param {object} props
 * @param {string} props.formId the `<form>` this submits, since the button is outside it
 * @param {import('react').ReactNode} [props.leading] the `push-end` control, delete or retire
 * @param {string} [props.describedBy] the save error's id, when there is one
 */
export function SheetFormFooter({ formId, busy, editing, onCancel, leading = null, describedBy }) {
  const { t } = useT()

  return (
    <>
      {leading}
      <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
        {t('common.cancel')}
      </button>
      <button
        type="submit"
        form={formId}
        className="btn btn--primary"
        disabled={busy}
        aria-describedby={describedBy}
      >
        {busy ? <span className="spinner" /> : editing ? t('common.save') : t('common.add')}
      </button>
    </>
  )
}
