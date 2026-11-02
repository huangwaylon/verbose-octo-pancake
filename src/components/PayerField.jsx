import { PEOPLE } from '../schema.js'
import { PERSON_MARK } from '../lib/identity.js'
import { Segmented } from './Segmented.jsx'
import { useT } from '../i18n/index.js'

/**
 * Who paid, as both forms ask it. `name` is a prop because ids are document-global and
 * `test/ui.test.jsx` reads it to pin the field order; `label` is the people labeller, as `EntryRow`
 * takes it, so a long form resolves the two names once.
 *
 * Each option carries the person's mark because this is where someone picks a payer: the list shows
 * only the animal, and here it sits beside the name it stands for. The name is the option's label,
 * so the mark is hidden from a screen reader.
 */
export function PayerField({ name, value, label, onChange, hint = null }) {
  const { t } = useT()

  return (
    <Segmented
      name={name}
      label={t('common.whoPaid')}
      value={value}
      options={PEOPLE.map((person) => [
        person,
        <>
          <span aria-hidden="true">{PERSON_MARK[person]}</span>
          {label(person)}
        </>,
      ])}
      onChange={onChange}
      hint={hint}
    />
  )
}
