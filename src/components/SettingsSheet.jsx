import { useState } from 'react'
import { BottomSheet } from './BottomSheet.jsx'
import { CONFIG_TAB, PEOPLE } from '../schema.js'
import { defaultSplitFor } from '../lib/split.js'
import { errorMessage, usePeopleLabels, useT } from '../i18n/index.js'
import { useTNodes } from '../i18n/nodes.jsx'
import { LOCALE_LABELS, SUPPORTED } from '../i18n/catalogs.js'
import { ACCENTS, setAccent, useAccent } from '../lib/theme.js'
import { Field } from './Field.jsx'
import { Segmented } from './Segmented.jsx'

export function SettingsSheet({
  config,
  me,
  spreadsheetId,
  tombstoneCount,
  onSetMe,
  onCompact,
  onForget,
  onClose,
}) {
  const { t, locale, setLocale } = useT()
  const tn = useTNodes()
  const { name } = usePeopleLabels(config, me)
  const accent = useAccent()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`

  async function handleCompact() {
    setBusy(true)
    setMessage(null)
    try {
      const { removed, busy: inFlight } = await onCompact()
      // A refusal is not a removal of zero rows: it has a reason and a remedy.
      setMessage(
        inFlight ? t('settings.compactBusy') : t('settings.removedRows', { count: removed }),
      )
    } catch (cause) {
      setMessage(errorMessage(cause, 'settings.compactError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet
      title={t('settings.title')}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--ghost btn--block" onClick={onForget}>
          {t('settings.forgetKey')}
        </button>
      }
    >
      <div className="stack">
        <Segmented
          name="identity"
          label={t('settings.youAre')}
          value={me}
          options={PEOPLE.map((person) => [person, name(person)])}
          onChange={onSetMe}
          hint={t('settings.youAreHint')}
        />

        {/* Each language named in itself, which is why these two are the
            documented exceptions to the "ja must differ from en" test. */}
        <Segmented
          name="locale"
          label={t('settings.language')}
          value={locale}
          options={SUPPORTED.map((tag) => [tag, LOCALE_LABELS[tag]])}
          onChange={setLocale}
          hint={t('settings.languageHint')}
        />

        <Field label={t('settings.accent')} hint={t('settings.accentHint')}>
          <div className="swatches" role="radiogroup" aria-label={t('settings.accent')}>
            {ACCENTS.map((preset) => (
              <label className="swatch" key={preset}>
                <input
                  type="radio"
                  name="accent"
                  value={preset}
                  checked={accent === preset}
                  onChange={() => setAccent(preset)}
                />
                {/* The disc has to paint the color it selects, and a custom
                    property cannot be indexed by an attribute value, so the
                    preset's own accent is scoped here and read by the disc. */}
                <span className="swatch__disc" data-accent={preset} aria-hidden="true" />
                <span className="visually-hidden">{t(`accent.${preset}`)}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label={t('settings.sheet')}>
          <div className="row">
            <a
              className="btn btn--ghost btn--sm"
              href={sheetUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('settings.openSheet')}
            </a>
          </div>
        </Field>

        <Field
          label={t('settings.configTitle')}
          description={tn('settings.configHint', { tab: <code>{CONFIG_TAB}</code> })}
        >
          <div className="row">
            <span className="pill pill--muted">{config.currency}</span>
            {config.categories.map((category) => (
              <span className="pill pill--muted" key={category}>
                {category}
              </span>
            ))}
          </div>
        </Field>

        <Field label={t('settings.defaultSplit')} hint={t('settings.defaultSplitHint')}>
          {/* One line per person: the whole point of the setting is that the two
              numbers can differ, so a single figure would hide half of it. */}
          {PEOPLE.map((person) => (
            <p className="settings__value" key={person}>
              {t('settings.defaultSplitValue', {
                name: name(person),
                percent: Math.round(defaultSplitFor(config, person) * 100),
              })}
            </p>
          ))}
        </Field>

        <Field label={t('common.notePresets')}>
          {config.notePresets?.length ? (
            <div className="row">
              {config.notePresets.map((note) => (
                <span className="pill pill--muted" key={note}>
                  {note}
                </span>
              ))}
            </div>
          ) : (
            <p className="field__hint">
              {tn('settings.notePresetsEmpty', { key: <code>note_presets</code> })}
            </p>
          )}
        </Field>

        <Field label={t('settings.deletedRows')} description={t('settings.deletedRowsHint')}>
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
          {/* The only irreversible action in the app, and its outcome is a number
              nobody can infer from the screen — so it is spoken, not just shown. */}
          {message && (
            <p className="field__hint" role="status">
              {message}
            </p>
          )}
        </Field>
      </div>
    </BottomSheet>
  )
}
