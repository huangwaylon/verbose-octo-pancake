import { useT } from '../i18n/index.js'

/**
 * The free-text note, with the config tab's frequent shops offered two ways.
 *
 * A datalist keeps the field free text while giving a native dropdown, and the
 * chips exist because a datalist has no visual affordance at all on a phone —
 * where the whole point of the presets is to be faster than typing "OK Mart"
 * again. A browser without datalist support degrades to a plain input.
 */
export function NoteField({ value, presets, onChange }) {
  const { t } = useT()
  const listId = presets.length ? 'note-presets' : undefined

  return (
    <div className="field">
      <label className="field__label" htmlFor="entry-note">
        {t('form.note')} <span className="field__hint">{t('common.optional')}</span>
      </label>
      <input
        id="entry-note"
        className="input"
        type="text"
        autoComplete="off"
        /* Shop names are exactly what iOS mangles: "Ozeki" capitalised and
           autocorrected into an English word it recognises. */
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck="false"
        enterKeyHint="done"
        placeholder={t('form.notePlaceholder')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        list={listId}
      />
      {presets.length > 0 && (
        <>
          <datalist id={listId}>
            {presets.map((preset) => (
              <option key={preset} value={preset} />
            ))}
          </datalist>
          <div className="row" role="group" aria-label={t('common.notePresets')}>
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`btn btn--sm ${value === preset ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => onChange(value === preset ? '' : preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
