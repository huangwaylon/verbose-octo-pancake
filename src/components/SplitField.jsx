import { useState } from 'react'
import { EVEN_SHARE } from '../schema.js'
import { defaultSplitFor, nextSplit, splitAtPercent, toSplit } from '../lib/split.js'
import { useT } from '../i18n/index.js'
import { Segmented } from './Segmented.jsx'

/**
 * The payer's own share of an entry or of a recurring declaration, as the form holds it.
 *
 * For an ENTRY, `null` means "follow the payer's configured default", which is what a new
 * entry starts as: switching the payer control then re-derives the split, because the
 * default is a property of the person, not of the form.
 *
 * An entry being edited carries an explicit share instead, so it opens on the number
 * actually stored and changing its payer leaves that number alone: a saved row records a
 * decision someone already made. `payerShare` comes from `share` rather than `percent /
 * 100` for the same reason — a stored 0.333 must not be quantized to 0.33 by an edit that
 * never touched it.
 *
 * For a TEMPLATE, `allowDefault` makes null a durable answer rather than an unfilled one: the
 * control opens on its own "Default" mode and keeps saving null, so the cost keeps FOLLOWING
 * `default_split_p*` instead of being pinned to whatever it happened to say on the day.
 *
 * Every transition is in `lib/split.js`; this holds only the one piece of state.
 */
export function useEntrySplit(entry, config, payer, { allowDefault = false } = {}) {
  const stored = Number.isFinite(entry.payerShare) ? entry.payerShare : null
  const [override, setOverride] = useState(() =>
    stored == null && !allowDefault ? null : toSplit(stored, defaultSplitFor(config, payer)),
  )

  const configuredShare = defaultSplitFor(config, payer)
  const { mode, percent, share } = override ?? toSplit(configuredShare)

  return {
    mode,
    percent,
    payerShare: mode === 'even' ? EVEN_SHARE : share,
    /** Dragging or hitting a preset pins the entry, so it survives a payer switch. */
    setPercent: (next) => setOverride(splitAtPercent(next)),
    setMode: (next) => setOverride(nextSplit(next, configuredShare)),
  }
}

/**
 * Who covers how much. The presets are the three answers anyone actually wants;
 * the slider is for the rest.
 *
 * `defaultLabel` opts in the third mode, and it is a LABEL rather than a boolean because
 * the option has to name the person and the percentage it would follow — "Default" alone
 * says nothing about what would be saved.
 */
export function SplitField({
  split,
  payerLabel,
  payerPossessive,
  otherLabel,
  breakdown,
  defaultLabel,
  defaultHint,
}) {
  const { t } = useT()

  return (
    <Segmented
      name="split"
      label={t('form.split')}
      value={split.mode}
      options={[
        ...(defaultLabel ? [['default', defaultLabel]] : []),
        ['even', t('form.splitEven')],
        ['custom', t('form.splitCustom')],
      ]}
      onChange={split.setMode}
    >
      {/* What "Default" actually resolves to today, in words: the mode saves a BLANK cell,
          so the number shown is the config tab's and will move if that does. */}
      {split.mode === 'default' ? (
        /* `role="status"` for the same reason the breakdown below it has one: it appears and
           its percentage changes with the payer control, without a page change. */
        <p className="field__hint" role="status">
          {defaultHint}
        </p>
      ) : null}

      {split.mode === 'custom' && (
        <div className="split-control">
          <div className="split-control__presets">
            {[
              [100, t('form.splitAll', { name: payerLabel })],
              [50, t('form.splitHalf')],
              [0, t('form.splitAll', { name: otherLabel })],
            ].map(([percent, presetLabel]) => (
              <button
                type="button"
                key={percent}
                className="btn btn--sm btn--ghost"
                onClick={() => split.setPercent(percent)}
              >
                {presetLabel}
              </button>
            ))}
          </div>
          <label className="split-control__slider">
            <span className="field__hint">{t('form.splitShare', { owner: payerPossessive })}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={split.percent}
              /* A range announces a bare "70"; say whose share it is. */
              aria-valuetext={t('form.splitValue', {
                owner: payerPossessive,
                percent: split.percent,
              })}
              onChange={(event) => split.setPercent(Number(event.target.value))}
            />
            {/* Hidden from the accessibility tree, not because it says nothing but
                because `aria-valuetext` above already says it: `<output>`'s implicit
                role IS `status`, so leaving it exposed puts three live regions on one
                drag — the valuetext, this, and the breakdown below — and the breakdown
                is the one carrying the figures that cannot be read off the control. */}
            <output aria-hidden="true">{t('summary.share', { percent: split.percent })}</output>
          </label>
        </div>
      )}

      {/* The numbers change on every slider step, so they have to be spoken; the
          region exists from the first keystroke in the amount field, well before
          the split is ever adjusted. */}
      {breakdown && (
        <p className="field__hint" role="status">
          {breakdown}
        </p>
      )}
    </Segmented>
  )
}
