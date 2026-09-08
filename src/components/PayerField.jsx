import { PEOPLE } from '../schema.js'
import { Segmented } from './Segmented.jsx'
import { useT } from '../i18n/index.js'

/**
 * Who paid, as both forms ask it. `name` is a prop because ids are document-global and
 * `test/ui.test.jsx` reads it to pin the field order; `label` is the people labeller, as `EntryRow`
 * takes it, so a long form resolves the two names once.
 */
export function PayerField({ name, value, label, onChange, hint = null }) {
  const { t } = useT()

  return (
    <Segmented
      name={name}
      label={t('common.whoPaid')}
      value={value}
      options={PEOPLE.map((person) => [person, label(person)])}
      onChange={onChange}
      hint={hint}
    />
  )
}
