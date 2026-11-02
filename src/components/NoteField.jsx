import { useT } from '../i18n/index.js'
import { Field, LITERAL_TEXT } from './Field.jsx'
import { ToggleButton } from './ToggleButton.jsx'

/**
 * The free-text note, with the config tab's frequent shops as chips under it. Chips, not a
 * `<datalist>`: on a phone a datalist has no visual affordance, and where iOS does show one it
 * repeats the chips directly below as a second list.
 */
export function NoteField({ value, presets, onChange }) {
  const { t } = useT()

  return (
    <Field htmlFor="entry-note" label={t('form.note')} optional={t('common.optional')}>
      <input
        id="entry-note"
        className="input"
        type="text"
        autoComplete="off"
        {...LITERAL_TEXT}
        enterKeyHint="done"
        placeholder={t('form.notePlaceholder')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {presets.length > 0 && (
        <div className="row" role="group" aria-label={t('common.notePresets')}>
          {presets.map((preset) => (
            <ToggleButton
              key={preset}
              pressed={value === preset}
              onClick={() => onChange(value === preset ? '' : preset)}
            >
              {preset}
            </ToggleButton>
          ))}
        </div>
      )}
    </Field>
  )
}
