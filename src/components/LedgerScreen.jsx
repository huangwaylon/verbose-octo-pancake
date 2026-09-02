import { Header } from './Header.jsx'
import { MonthNav } from './MonthNav.jsx'
import { SummaryCard } from './SummaryCard.jsx'
import { EntryList } from './EntryList.jsx'
import { DeletedList } from './DeletedList.jsx'
import { PlusIcon } from './icons.jsx'
import { useT } from '../i18n/index.js'

/**
 * The whole signed-in surface: the header, the add action, and the two columns.
 *
 * Separate from `App` because THREE things render it — the app, `scripts/preview.jsx`,
 * which is the only check that any of it LOOKS right, and one static render in
 * `test/render.test.jsx`. Written more than once, a layout change would silently leave both
 * checks looking at a tree the app no longer has.
 *
 * Everything arrives as props: no ledger, no connection, no writes.
 */
export function LedgerScreen({
  config,
  me,
  view,
  monthKey,
  notices,
  refreshing,
  onRefresh,
  onOpenSettings,
  onMonthChange,
  onEdit,
  onDelete,
  onRestore,
  onAdd,
}) {
  const { t } = useT()

  return (
    <>
      <Header
        balance={view.balance}
        config={config}
        me={me}
        busy={refreshing}
        onRefresh={onRefresh}
        onOpenSettings={onOpenSettings}
      />

      <main className="layout">
        <aside className="layout__aside">
          {/* The one way into the entry form, and the first thing under the
              balance. Above the notices rather than below them: a primary action
              whose vertical position moves with the connection is a mis-tap. */}
          <button type="button" className="btn btn--primary btn--block add-action" onClick={onAdd}>
            <PlusIcon />
            {t('common.addExpense')}
          </button>

          {notices.map((text) => (
            <p className="notice" role="status" key={text}>
              {text}
            </p>
          ))}

          <SummaryCard
            monthSpend={view.monthSpend}
            byCategory={view.byCategory}
            byPerson={view.byPerson}
            byShare={view.byShare}
            config={config}
            me={me}
          />
        </aside>

        <section className="layout__main">
          <MonthNav monthKey={monthKey} onChange={onMonthChange} />
          <EntryList
            groups={view.groups}
            config={config}
            me={me}
            onEdit={onEdit}
            onDelete={onDelete}
          />
          <DeletedList entries={view.deleted} config={config} me={me} onRestore={onRestore} />
        </section>
      </main>
    </>
  )
}
