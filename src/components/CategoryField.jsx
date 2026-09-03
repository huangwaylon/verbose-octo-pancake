import { Field } from './Field.jsx'
import { useT } from '../i18n/index.js'

/**
 * The category picker, and the one home of a money bug that looks like nothing: the stored category
 * is offered FIRST even when the config tab no longer lists it, because a `<select>` whose value
 * matches no option renders BLANK and then silently saves the invisible old value.
 *
 * `id` is explicit rather than generated: each form names its own control, and the field-order tests
 * read those ids.
 */
export function CategoryField({ id, value, categories, onChange }) {
  const { t } = useT()
  const options = categories.includes(value) ? categories : [value, ...categories].filter(Boolean)

  return (
    <Field htmlFor={id} label={t('form.category')}>
      <select
        id={id}
        className="select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </Field>
  )
}
