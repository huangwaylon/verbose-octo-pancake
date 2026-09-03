import { useState } from 'react'
import { EVEN_SHARE } from '../schema.js'
import { splitYen } from '../lib/money.js'
import { defaultSplitFor, nextSplit, splitAtPercent, toSplit } from '../lib/split.js'
import { useMoney, useT } from '../i18n/index.js'
import { Segmented } from './Segmented.jsx'

/**
 * The payer's own share, as the form holds it. Every transition is in `lib/split.js`.
 *
 * For a new ENTRY, `null` means "follow the payer's configured default", so switching payer
 * re-derives the split. An entry being edited carries an explicit share and keeps it — and
 * `payerShare` comes from `share`, not `percent / 100`, so a stored 0.333 is not quantized to 0.33
 * by an edit that never touched it.
 *
 * For a TEMPLATE, `allowDefault` makes null a durable answer rather than an unfilled one: the cost
 * keeps FOLLOWING `default_split_p*` instead of being pinned to whatever it said on the day.
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
    /** One derivation: what the label promises and what the mode saves must be one figure. */
    configuredPercent: Math.round(configuredShare * 100),
    /** Dragging or hitting a preset pins the entry, so it survives a payer switch. */
    setPercent: (next) => setOverride(splitAtPercent(next)),
    setMode: (next) => setOverride(nextSplit(next, configuredShare)),
  }
}

/**
 * Who covers how much. `defaultLabel` opts in the third mode, and is a LABEL rather than a boolean
 * because the option has to name the person and the percentage it would follow. The breakdown is
 * derived HERE: two derivations of "who owes what" lets a template's and an entry's drift apart.
 */
export function SplitField({
  split,
  payerLabel,
  payerPossessive,
  otherLabel,
  amountYen,
  defaultLabel,
  defaultHint,
}) {
  const { t } = useT()
  const money = useMoney()

  const shares =
    amountYen == null || split.payerShare == null ? null : splitYen(amountYen, split.payerShare)
  const breakdown =
    shares &&
    t('form.breakdown', {
      payer: payerLabel,
      payerAmount: money(shares.payerYen),
      other: otherLabel,
      otherAmount: money(shares.otherYen),
    })

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
      {/* What "Default" resolves to today: the mode saves a BLANK cell, so the number shown is
          the config tab's and moves if that does. `role="status"` because it appears and its
          percentage changes with the payer control, without a page change. */}
      {split.mode === 'default' ? (
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
            <span className="field__hint">{t('common.share', { owner: payerPossessive })}</span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={split.percent}
              aria-valuetext={t('form.splitValue', {
                owner: payerPossessive,
                percent: split.percent,
              })}
              onChange={(event) => split.setPercent(Number(event.target.value))}
            />
            {/* Hidden because `aria-valuetext` already says it, and `<output>`'s implicit role
                IS `status` — exposed, it makes three live regions on one drag. */}
            <output aria-hidden="true">{t('summary.share', { percent: split.percent })}</output>
          </label>
        </div>
      )}

      {/* The numbers change on every slider step, so they have to be spoken. */}
      {breakdown && (
        <p className="field__hint" role="status">
          {breakdown}
        </p>
      )}
    </Segmented>
  )
}
