import { labelFor } from '../lib/identity.js'
import { useT } from '../i18n/index.js'
import { RefreshIcon, SettingsIcon } from './icons.jsx'

export function Header({ config, me, status, onRefresh, onOpenSettings }) {
  const { t } = useT()
  const busy = status === 'loading' || status === 'refreshing'
  const you = t('common.you')
  const fallbacks = { p1: t('common.person1'), p2: t('common.person2') }

  return (
    <header className="app__header">
      <div className="brand">
        <h1 className="brand__title">{t('app.name')}</h1>
        <p className="brand__subtitle">
          {labelFor(config, 'p1', me, you, fallbacks)} &amp;{' '}
          {labelFor(config, 'p2', me, you, fallbacks)}
        </p>
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
