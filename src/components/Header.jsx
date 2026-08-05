import { labelFor } from '../lib/identity.js'
import { RefreshIcon, SettingsIcon } from './icons.jsx'

export function Header({ config, me, status, onRefresh, onOpenSettings }) {
  const busy = status === 'loading' || status === 'refreshing'

  return (
    <header className="app__header">
      <div className="brand">
        <h1 className="brand__title">Shared Finances</h1>
        <p className="brand__subtitle">
          {labelFor(config, 'p1', me)} &amp; {labelFor(config, 'p2', me)}
        </p>
      </div>
      <div className="header-actions">
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          onClick={onRefresh}
          disabled={busy}
          aria-label="Refresh from the sheet"
        >
          {busy ? <span className="spinner" /> : <RefreshIcon />}
        </button>
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  )
}
