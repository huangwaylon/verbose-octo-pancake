import { useEffect, useId, useState } from 'react'
import { errorMessage, useT } from '../i18n/index.js'
import { BusyLabel } from './BusyLabel.jsx'

/**
 * The save state both forms hold FOR this footer: whether a write is in flight, and the sentence to
 * show above it if one failed.
 *
 * `busy` is deliberately not cleared on success — the sheet unmounts, and clearing it first makes
 * the button flash back to "Save". `clearError` stays a separate call, because WHEN it happens is a
 * decision each form makes at its own validation point: before the input is judged, or two messages
 * sit on screen at once, one of them about a write that was never attempted.
 *
 * The failure sits last in a form that can be a phone's height of fields, so it is scrolled to: below
 * the fold, a failed save is a spinner that stops and nothing else.
 *
 * A hook beside the control that consumes it, as `useEntrySplit` sits beside `SplitField`.
 */
export function useSheetSave(onClose) {
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const saveErrorId = useId()

  useEffect(() => {
    if (saveError) document.getElementById(saveErrorId)?.scrollIntoView({ block: 'nearest' })
  }, [saveError, saveErrorId])

  const save = async (write) => {
    setBusy(true)
    try {
      await write()
      onClose()
    } catch (cause) {
      setBusy(false)
      setSaveError(errorMessage(cause, 'form.saveError'))
    }
  }

  return { busy, saveError, saveErrorId, clearError: () => setSaveError(null), save }
}

/**
 * The footer both forms wear. Cancel comes before submit in the DOM as well as on screen. The submit
 * button carries `aria-describedby` for a save failure because IT produced it — ids are
 * document-global, so it can point into a `<form>` this sits outside of.
 *
 * `busy` disables all three, not the submit alone: the leading control writes to the sheet too, and
 * two writes in flight race for one row. `formId` names the `<form>` this submits, since the button
 * sits outside it; `leading` is the `push-end` control, delete or retire.
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
        <BusyLabel busy={busy}>{editing ? t('common.save') : t('common.add')}</BusyLabel>
      </button>
    </>
  )
}
