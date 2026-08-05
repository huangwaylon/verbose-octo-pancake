import { PEOPLE } from '../schema.js'
import { usePeopleLabels, useT } from '../i18n/index.js'
import { RefreshIcon, SettingsIcon } from './icons.jsx'

export function Header({ config, me, status, onRefresh, onOpenSettings }) {
  const { t } = useT()
  const { label } = usePeopleLabels(config, me)
  const busy = status === 'loading' || status === 'refreshing'

  return (
    <header className="app__header">
      <div>
        <h1 className="brand__title">{t('app.name')}</h1>
        <p className="brand__subtitle">{PEOPLE.map(label).join(t('common.peopleSeparator'))}</p>
      </div>
      <div className="header-actions">
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          onClick={onRefresh}
          disabled={busy}
          aria-label={t('header.refresh')}
        >
          {busy ? <span className="spinner" /> : <RefreshIcon />}
        </button>
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          onClick={onOpenSettings}
          aria-label={t('header.settings')}
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  )
}
