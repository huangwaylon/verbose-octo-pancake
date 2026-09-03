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
import { OpenSheetLink } from './OpenSheetLink.jsx'

export function SettingsSheet({
  config,
  me,
  spreadsheetId,
  tombstoneCount,
  templateCount,
  onSetMe,
  onCompact,
  onOpenRecurring,
  onForget,
  onClose,
}) {
  const { t, locale, setLocale } = useT()
  const tn = useTNodes()
  const { name } = usePeopleLabels(config, me)
  const accent = useAccent()
  const [busy, setBusy] = useState(false)
  /** The outcome, not a sentence: this panel is where the language is chosen. */
  const [outcome, setOutcome] = useState(null)

  async function handleCompact() {
    setBusy(true)
    setOutcome(null)
    try {
      setOutcome(await onCompact())
    } catch (cause) {
      setOutcome({ cause })
    } finally {
      setBusy(false)
    }
  }

  // A refusal is not a removal of zero rows: "Removed 0 rows" would be a plain lie.
  const message = !outcome
    ? null
    : outcome.cause
      ? errorMessage(outcome.cause, 'settings.compactError')
      : outcome.busy
        ? t('settings.compactBusy')
        : t('settings.removedRows', { count: outcome.removed })

  return (
    <BottomSheet
      title={t('settings.title')}
      onClose={onClose}
      footer={
        /**
         * A close button, not the destructive one: the footer is the only control reliably in
         * reach, so "Forget key" there is the easiest target to hit by accident.
         */
        <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
          {t('common.close')}
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

        {/* Each language named in itself: the documented exceptions to the drift test. */}
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
                {/* A custom property cannot be indexed by an attribute value, so the preset's
                    own accent is scoped here and read by the disc it paints. */}
                <span className="swatch__disc" data-accent={preset} aria-hidden="true" />
                <span className="visually-hidden">{t(`accent.${preset}`)}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field label={t('settings.sheet')}>
          <div className="row">
            <OpenSheetLink spreadsheetId={spreadsheetId} />
          </div>
        </Field>

        {/* A count rather than a reminder: a reminder is what the balance must not carry. */}
        <Field label={t('recurring.title')} description={t('settings.recurringHint')}>
          <div className="row">
            <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenRecurring}>
              {templateCount
                ? t('settings.recurringCount', { count: templateCount })
                : t('settings.recurringEmpty')}
            </button>
          </div>
        </Field>

        <Field
          label={t('settings.configTitle')}
          description={tn('settings.configHint', { tab: <code>{CONFIG_TAB}</code> })}
        >
          <div className="row">
            {config.categories.map((category) => (
              <span className="pill pill--muted" key={category}>
                {category}
              </span>
            ))}
          </div>
        </Field>

        <Field label={t('settings.defaultSplit')} hint={t('settings.defaultSplitHint')}>
          {/* One line per person: the two numbers can differ, so one figure hides half. */}
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
          {/* Its outcome is a number nobody can infer, so it is spoken, not just shown. */}
          {message && (
            <p className="field__hint" role="status">
              {message}
            </p>
          )}
        </Field>

        {/* Last in the body: reachable, explained, not where a thumb lands by default. */}
        <Field label={t('settings.forgetKeyTitle')} description={t('settings.forgetKeyHint')}>
          <div className="row">
            <button type="button" className="btn btn--danger btn--sm" onClick={onForget}>
              {t('settings.forgetKey')}
            </button>
          </div>
        </Field>
      </div>
    </BottomSheet>
  )
}
