import { PEOPLE } from '../schema.js'
import { usePeopleLabels, useT } from '../i18n/index.js'
import { RefreshIcon, SettingsIcon } from './icons.jsx'

/**
 * `busy` rather than the ledger's status: the only state this cares about is
 * "a refresh is in flight", and by the time the header renders at all the gates
 * have already handled `idle` and `loading`.
 */
export function Header({ config, me, busy, onRefresh, onOpenSettings }) {
  const { t } = useT()
  const { label } = usePeopleLabels(config, me)

  return (
    <header className="app__header">
      <div className="brand">
        <h1 className="brand__title">{t('app.name')}</h1>
        <p className="brand__subtitle">{PEOPLE.map(label).join(t('common.peopleSeparator'))}</p>
      </div>
      <div className="header-actions">
        <button
          type="button"
          className="btn btn--icon"
          onClick={onRefresh}
          disabled={busy}
          aria-label={t('header.refresh')}
        >
          {busy ? <span className="spinner" /> : <RefreshIcon />}
        </button>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onOpenSettings}
          aria-label={t('header.settings')}
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  )
}
