import { useT } from '../i18n/index.js'
import { Field } from './Field.jsx'

/**
 * The free-text note, with the config tab's frequent shops offered two ways: a datalist keeps the
 * field free text, and the chips exist because a datalist has no visual affordance on a phone.
 */
export function NoteField({ value, presets, onChange }) {
  const { t } = useT()
  const listId = presets.length ? 'note-presets' : undefined

  return (
    <Field
      htmlFor="entry-note"
      label={
        <>
          {t('form.note')} <span className="field__hint">{t('common.optional')}</span>
        </>
      }
    >
      <input
        id="entry-note"
        className="input"
        type="text"
        autoComplete="off"
        /* Shop names are exactly what iOS mangles: "Ozeki" capitalised and autocorrected
           into an English word it recognises. */
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck="false"
        enterKeyHint="done"
        placeholder={t('form.notePlaceholder')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        list={listId}
      />
      {listId && (
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
                /* The chip's selected state is otherwise carried by colour alone —
                   VoiceOver announces both states identically without this. */
                aria-pressed={value === preset}
                className={`btn btn--sm ${value === preset ? 'btn--primary' : 'btn--ghost'}`}
                onClick={() => onChange(value === preset ? '' : preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        </>
      )}
    </Field>
  )
}
