import { useState } from 'react'
import { EVEN_SHARE } from '../schema.js'
import { defaultSplitFor, nextSplit, splitAtPercent, toSplit } from '../lib/split.js'
import { useT } from '../i18n/index.js'
import { Segmented } from './Segmented.jsx'

/**
 * The payer's own share of an entry, as the form holds it.
 *
 * `null` means "follow the payer's configured default", which is what a new entry
 * starts as: switching the payer control then re-derives the split, because the
 * default is a property of the person, not of the form — with 80/20, p1 owes 80%
 * of what they paid and p2 owes 20% of what *they* paid.
 *
 * An entry being edited carries an explicit share instead, so it opens on the
 * number actually stored and changing its payer leaves that number alone: a saved
 * row records a decision someone already made. `payerShare` comes from `share`
 * rather than `percent / 100` for the same reason — the slider is whole percents,
 * and a stored 0.333 must not be quantized to 0.33 by an edit that never touched it.
 *
 * Every transition is in `lib/split.js`; this holds only the one piece of state.
 */
export function useEntrySplit(entry, config, payer) {
  const stored = Number.isFinite(entry.payerShare) ? entry.payerShare : null
  const [override, setOverride] = useState(stored == null ? null : toSplit(stored))

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
 */
export function SplitField({ split, payerLabel, otherLabel, breakdown }) {
  const { t } = useT()

  return (
    <Segmented
      name="split"
      label={t('form.split')}
      value={split.mode}
      options={[
        ['even', t('form.splitEven')],
        ['custom', t('form.splitCustom')],
      ]}
      onChange={split.setMode}
    >
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
            <span className="field__hint">{t('form.splitShare', { name: payerLabel })}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={split.percent}
              /* A range announces a bare "70"; say whose share it is. */
              aria-valuetext={t('form.splitValue', {
                name: payerLabel,
                percent: split.percent,
              })}
              onChange={(event) => split.setPercent(Number(event.target.value))}
            />
            <output>{t('summary.share', { percent: split.percent })}</output>
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
