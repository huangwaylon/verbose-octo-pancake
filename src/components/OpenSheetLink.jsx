import { sheetUrl } from '../config.js'
import { useT } from '../i18n/index.js'

/**
 * The way out to the spreadsheet, from the two places that offer one.
 *
 * A `.btn` rather than a bare `<a>`: it is a 36px tap target with `touch-action: manipulation`,
 * and on the recurring page it is the control someone reaches for when a row they typed is
 * missing — a 13px inline link would wait 300ms for a double-tap.
 */
export function OpenSheetLink({ spreadsheetId }) {
  const { t } = useT()

  return (
    <a
      className="btn btn--ghost btn--sm"
      href={sheetUrl(spreadsheetId)}
      target="_blank"
      rel="noreferrer noopener"
    >
      {t('settings.openSheet')}
    </a>
  )
}
