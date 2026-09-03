import { useT } from '../i18n/index.js'

/**
 * The footer both forms wear. Cancel comes before submit in the DOM as well as on screen. The submit
 * button carries `aria-describedby` for a save failure because IT produced it — ids are
 * document-global, so it can point into a `<form>` this sits outside of.
 *
 * `busy` disables all three, not the submit alone: the leading control writes to the sheet too, and
 * two writes in flight race for one row.
 *
 * @param {object} props
 * @param {string} props.formId the `<form>` this submits, since the button is outside it
 * @param {import('react').ReactNode} [props.leading] the `push-end` control, delete or retire
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
