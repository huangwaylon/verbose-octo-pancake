import { Header } from './Header.jsx'
import { MonthNav } from './MonthNav.jsx'
import { BalanceCard } from './BalanceCard.jsx'
import { SummaryCard } from './SummaryCard.jsx'
import { EntryList } from './EntryList.jsx'
import { DeletedList } from './DeletedList.jsx'
import { PlusIcon } from './icons.jsx'
import { useT } from '../i18n/index.js'

/**
 * The whole signed-in surface: header, the two columns, and the FAB.
 *
 * Separate from `App` because two things render it — the app, and
 * `scripts/preview.jsx`, which is the only check that any of it LOOKS right. Written
 * twice, a layout change would silently leave the visual harness screenshotting a
 * tree the app no longer has.
 *
 * Everything arrives as props: no ledger, no connection, no writes. `App` keeps the
 * gates, the sheets and the state; this is markup and one map over the notices.
 */
export function LedgerScreen({
  config,
  me,
  currency,
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
        config={config}
        me={me}
        busy={refreshing}
        onRefresh={onRefresh}
        onOpenSettings={onOpenSettings}
      />

      <main className="layout">
        <aside className="layout__aside">
          {notices.map((text) => (
            <p className="notice" role="status" key={text}>
              {text}
            </p>
          ))}
          <BalanceCard balance={view.balance} config={config} me={me} currency={currency} />
          <SummaryCard
            monthSpend={view.monthSpend}
            byCategory={view.byCategory}
            byPerson={view.byPerson}
            config={config}
            me={me}
            currency={currency}
          />
        </aside>

        <section className="layout__main">
          <MonthNav monthKey={monthKey} onChange={onMonthChange} />
          <EntryList
            groups={view.groups}
            config={config}
            me={me}
            currency={currency}
            onEdit={onEdit}
            onDelete={onDelete}
            onAdd={onAdd}
          />
          <DeletedList
            entries={view.deleted}
            config={config}
            me={me}
            currency={currency}
            onRestore={onRestore}
          />
        </section>
      </main>

      <button type="button" className="fab" onClick={onAdd} aria-label={t('list.emptyAction')}>
        <PlusIcon width={24} height={24} />
      </button>
    </>
  )
}
