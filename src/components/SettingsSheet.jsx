import { useState } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { CONFIG_TAB, PERSON } from '../schema.js'
import { nameOf } from '../lib/identity.js'
import { useT } from '../i18n/index.js'
import { useTNodes } from '../i18n/nodes.jsx'
import { LOCALE_LABELS, SUPPORTED } from '../i18n/catalogs.js'

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
  const { t, locale, setLocale } = useT()
  const tn = useTNodes()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheet.id}`
  const fallbacks = { p1: t('common.person1'), p2: t('common.person2') }

  async function handleCompact() {
    setBusy(true)
    setMessage(null)
    try {
      const { removed } = await onCompact()
      setMessage(t('settings.removedRows', { count: removed }))
    } catch (cause) {
      setMessage(cause.message || t('settings.compactError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet
      title={t('settings.title')}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--ghost btn--block" onClick={onSignOut}>
          {email ? t('settings.signOutAs', { email }) : t('settings.signOut')}
        </button>
      }
    >
      <div className="stack">
        <div className="field">
          <span className="field__label">{t('settings.youAre')}</span>
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
                {nameOf(config, person, fallbacks)}
              </label>
            ))}
          </div>
          <p className="field__hint">{t('settings.youAreHint')}</p>
        </div>

        <div className="field">
          <span className="field__label">{t('settings.language')}</span>
          <div className="segmented">
            {SUPPORTED.map((tag) => (
              <label className="segmented__option" key={tag}>
                <input
                  type="radio"
                  name="locale"
                  value={tag}
                  checked={locale === tag}
                  onChange={() => setLocale(tag)}
                />
                {/* Each language named in itself, which is why these two are the
                    documented exceptions to the "ja must differ from en" test. */}
                {LOCALE_LABELS[tag]}
              </label>
            ))}
          </div>
          <p className="field__hint">{t('settings.languageHint')}</p>
        </div>

        <div className="field">
          <span className="field__label">{t('settings.sheet')}</span>
          <p className="settings__value">{spreadsheet.name}</p>
          <div className="row">
            <a
              className="btn btn--ghost btn--sm"
              href={sheetUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('settings.openSheet')}
            </a>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onSwitchSheet}>
              {t('settings.switchSheet')}
            </button>
          </div>
        </div>

        <div className="field">
          <span className="field__label">{t('settings.configTitle')}</span>
          <p className="field__hint">
            {tn('settings.configHint', { tab: <code>{CONFIG_TAB}</code> })}
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
          <span className="field__label">{t('settings.deletedRows')}</span>
          <p className="field__hint">{t('settings.deletedRowsHint')}</p>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={handleCompact}
            disabled={busy || !tombstoneCount}
          >
            {busy ? <span className="spinner" /> : null}
            {tombstoneCount
              ? t('settings.removeRows', { count: tombstoneCount })
              : t('settings.nothingToRemove')}
          </button>
          {message && <p className="field__hint">{message}</p>}
        </div>
      </div>
    </BottomSheet>
  )
}
