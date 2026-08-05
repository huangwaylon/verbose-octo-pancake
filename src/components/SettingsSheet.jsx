import { useState } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { CONFIG_TAB, PERSON } from '../schema.js'
import { nameOf } from '../lib/identity.js'

export function SettingsSheet({
  config,
  me,
  spreadsheet,
  tombstoneCount,
  email,
  onSetMe,
  onCompact,
  onSwitchSheet,
  onSignOut,
  onClose,
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheet.id}`

  async function handleCompact() {
    setBusy(true)
    setMessage(null)
    try {
      const { removed } = await onCompact()
      setMessage(`Removed ${removed} deleted ${removed === 1 ? 'row' : 'rows'}.`)
    } catch (cause) {
      setMessage(cause.message || 'Could not compact the sheet.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet
      title="Settings"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--ghost btn--block" onClick={onSignOut}>
          Sign out{email ? ` (${email})` : ''}
        </button>
      }
    >
      <div className="stack">
        <div className="field">
          <span className="field__label">You are</span>
          <div className="segmented">
            {[PERSON.P1, PERSON.P2].map((person) => (
              <label className="segmented__option" key={person}>
                <input
                  type="radio"
                  name="identity"
                  value={person}
                  checked={me === person}
                  onChange={() => onSetMe(person)}
                />
                {nameOf(config, person)}
              </label>
            ))}
          </div>
          <p className="field__hint">Only changes how this device labels things.</p>
        </div>

        <div className="field">
          <span className="field__label">Sheet</span>
          <p className="settings__value">{spreadsheet.name}</p>
          <div className="row">
            <a
              className="btn btn--ghost btn--sm"
              href={sheetUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open in Google Sheets
            </a>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onSwitchSheet}>
              Switch sheet
            </button>
          </div>
        </div>

        <div className="field">
          <span className="field__label">Names, currency &amp; categories</span>
          <p className="field__hint">
            These come from the <code>{CONFIG_TAB}</code> tab of the sheet. Edit them there and
            refresh.
          </p>
          <div className="row">
            <span className="pill pill--muted">{config.currency}</span>
            {config.categories.map((name) => (
              <span className="pill pill--muted" key={name}>
                {name}
              </span>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Deleted rows</span>
          <p className="field__hint">
            Deleted entries stay in the sheet as tombstones so nothing shifts position and undo
            keeps working. Clearing them is permanent.
          </p>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={handleCompact}
            disabled={busy || !tombstoneCount}
          >
            {busy ? <span className="spinner" /> : null}
            {tombstoneCount
              ? `Permanently remove ${tombstoneCount} ${tombstoneCount === 1 ? 'row' : 'rows'}`
              : 'Nothing to remove'}
          </button>
          {message && <p className="field__hint">{message}</p>}
        </div>
      </div>
    </BottomSheet>
  )
}
