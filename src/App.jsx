import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnection } from './state/useConnection.js'
import { useLedger } from './state/useLedger.js'
import { useToasts } from './state/useToasts.js'
import { ENTRY_TYPE, PERSON, isActive } from './schema.js'
import {
  computeBalance,
  deletedEntries,
  filterByMonth,
  groupByDate,
  monthKeysPresent,
  spendByCategory,
  spendByPerson,
  totalSpend,
} from './lib/balance.js'
import { currentMonthKey, todayIso } from './lib/dates.js'
import { useT } from './i18n/index.js'
import { readStoredIdentity, storeIdentity } from './lib/identity.js'
import { setSafeToReload } from './lib/serviceWorker.js'
import { Header } from './components/Header.jsx'
import { MonthNav } from './components/MonthNav.jsx'
import { BalanceCard } from './components/BalanceCard.jsx'
import { SummaryCard } from './components/SummaryCard.jsx'
import { EntryList } from './components/EntryList.jsx'
import { DeletedList } from './components/DeletedList.jsx'
import { EntryFormSheet } from './components/EntryFormSheet.jsx'
import { ConfirmDeleteSheet } from './components/ConfirmDeleteSheet.jsx'
import { SettingsSheet } from './components/SettingsSheet.jsx'
import { Toasts } from './components/Toasts.jsx'
import { PlusIcon } from './components/icons.jsx'
import {
  ErrorGate,
  IdentityGate,
  KeyGate,
  LoadingGate,
  UnconfiguredGate,
} from './components/Gate.jsx'

export default function App() {
  const { t } = useT()
  const connection = useConnection()
  const toasts = useToasts()
  const ledger = useLedger(connection.spreadsheetId)

  const [identityChoice, setIdentityChoice] = useState(readStoredIdentity)
  const [monthKey, setMonthKey] = useState(currentMonthKey)
  const [draft, setDraft] = useState(null)
  /** The entry the confirmation dialog is asking about, if it is open. */
  const [pendingDelete, setPendingDelete] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  // Nothing can tell us who is signed in any more — the token belongs to the
  // account that owns the sheet, not to either person — so identity is purely
  // this device's own choice.
  const me = identityChoice
  const currency = ledger.config.currency

  const active = useMemo(() => ledger.entries.filter(isActive), [ledger.entries])
  // Month-scoped, like the list it sits under. The sheet-wide count that
  // `compact` acts on is `ledger.tombstoneCount`, which is a different number.
  const deleted = useMemo(
    () => deletedEntries(ledger.entries, monthKey),
    [ledger.entries, monthKey],
  )
  const balance = useMemo(() => computeBalance(active), [active])
  const monthEntries = useMemo(() => filterByMonth(active, monthKey), [active, monthKey])
  const groups = useMemo(() => groupByDate(monthEntries), [monthEntries])
  const monthSpend = useMemo(() => totalSpend(monthEntries), [monthEntries])
  const byCategory = useMemo(() => spendByCategory(monthEntries), [monthEntries])
  const byPerson = useMemo(() => spendByPerson(monthEntries), [monthEntries])

  // Aggregates sum integers across currencies with different scales, which is
  // arithmetically meaningless, and there are no FX rates anywhere in this app.
  // Say so rather than presenting a confident wrong total.
  const mixedCurrencies = useMemo(
    () => active.some((entry) => entry.currency && entry.currency !== ledger.config.currency),
    [active, ledger.config.currency],
  )

  // Land on the newest month that actually has data, so a sheet whose last
  // entry was a while ago does not open on an empty screen. Runs on the cached
  // paint too ('stale'), which is the point: waiting for 'ready' would move the
  // month out from under someone who had already started using MonthNav.
  const jumped = useRef(false)
  useEffect(() => {
    if (jumped.current) return
    if (ledger.status !== 'ready' && ledger.status !== 'stale') return
    if (!active.length) return
    jumped.current = true
    const months = monthKeysPresent(active)
    if (months.length && !months.includes(currentMonthKey())) setMonthKey(months[0])
  }, [ledger.status, active])

  const setMe = useCallback((person) => {
    storeIdentity(person)
    setIdentityChoice(person)
  }, [])

  // A service worker update activates by reloading, so it must never land while
  // an entry is half-typed or a write has not reached the sheet.
  useEffect(() => {
    setSafeToReload(() => !draft && !ledger.entries.some((entry) => entry.pending))
  }, [draft, ledger.entries])

  const openAdd = useCallback(() => {
    const payer = me ?? PERSON.P1
    setDraft({
      mode: 'add',
      entry: {
        type: ENTRY_TYPE.EXPENSE,
        date: todayIso(),
        payer,
        amountCents: 0,
        category: '',
        description: '',
        // Left unset: the form derives it from the config tab per payer, and
        // re-derives when the payer control changes. Seeding it here would pin
        // the opening payer's share onto whoever it is switched to.
        payerShare: null,
      },
    })
  }, [me])

  const openEdit = useCallback((entry) => setDraft({ mode: 'edit', entry }), [])
  const closeDraft = useCallback(() => setDraft(null), [])

  const submitDraft = useCallback(
    (input) => (draft.mode === 'edit' ? ledger.editEntry(input) : ledger.addEntry(input)),
    [draft, ledger],
  )

  const removeEntry = useCallback(
    async (entry) => {
      setPendingDelete(null)
      try {
        await ledger.removeEntry(entry.id, entry.payer)
        toasts.push({ message: t('toast.deleted') })
      } catch (cause) {
        toasts.error(cause.message || t('toast.deleteFailed'))
      }
    },
    [ledger, toasts, t],
  )

  const restoreEntry = useCallback(
    async (entry) => {
      try {
        await ledger.restoreEntry(entry.id, entry.payer)
        toasts.push({ message: t('toast.restored') })
      } catch (cause) {
        toasts.error(cause.message || t('toast.restoreFailed'))
      }
    },
    [ledger, toasts, t],
  )

  const switchSheet = useCallback(() => {
    setShowSettings(false)
    connection.forget()
  }, [connection])

  const connectionError = connection.error
    ? connection.error.i18nKey
      ? t(connection.error.i18nKey)
      : connection.error.message
    : null

  if (connection.status === 'unconfigured') return <UnconfiguredGate />
  if (connection.status === 'no-key') {
    return (
      <KeyGate
        onConnect={connection.connect}
        connecting={connection.connecting}
        error={connectionError}
        suspect={connection.suspect}
      />
    )
  }
  // Holding a key but no sheet id yet: the first mint is in flight, or it failed.
  if (!connection.spreadsheetId) {
    return connectionError ? (
      <ErrorGate message={connectionError} onRetry={connection.retry} />
    ) : (
      <LoadingGate label={t('gate.loadingSheet')} />
    )
  }
  if (ledger.status === 'error') {
    return <ErrorGate message={ledger.error} onRetry={ledger.refresh} />
  }
  if (ledger.status === 'idle' || ledger.status === 'loading') {
    return <LoadingGate label={t('gate.loadingSheet')} />
  }
  if (!me) {
    return <IdentityGate config={ledger.config} onPick={setMe} />
  }

  return (
    <div className="app">
      <Header
        config={ledger.config}
        me={me}
        status={ledger.status}
        onRefresh={ledger.refresh}
        onOpenSettings={() => setShowSettings(true)}
      />

      <main className="layout">
        <aside className="layout__aside">
          {/* A refresh failed but the cache is still good — say so rather than
              replacing the whole screen with an error, which is what an offline
              launch used to do. */}
          {ledger.status === 'stale' && ledger.error && (
            <p className="notice" role="status">
              {t('warning.staleData')}
            </p>
          )}
          {mixedCurrencies && (
            <p className="notice" role="status">
              {t('warning.mixedCurrencies')}
            </p>
          )}
          <BalanceCard
            balance={balance}
            config={ledger.config}
            me={me}
            currency={currency}
          />
          <SummaryCard
            monthSpend={monthSpend}
            byCategory={byCategory}
            byPerson={byPerson}
            config={ledger.config}
            me={me}
            currency={currency}
          />
        </aside>

        <section className="layout__main">
          <MonthNav monthKey={monthKey} onChange={setMonthKey} />
          <EntryList
            groups={groups}
            config={ledger.config}
            me={me}
            currency={currency}
            status={ledger.status}
            onEdit={openEdit}
            onDelete={setPendingDelete}
            onAdd={openAdd}
          />
          <DeletedList
            entries={deleted}
            config={ledger.config}
            me={me}
            currency={currency}
            onRestore={restoreEntry}
          />
        </section>
      </main>

      <button type="button" className="fab" onClick={openAdd} aria-label={t('list.emptyAction')}>
        <PlusIcon width={24} height={24} />
      </button>

      {draft && (
        <EntryFormSheet
          draft={draft}
          config={ledger.config}
          me={me}
          currency={currency}
          onSubmit={submitDraft}
          onDelete={setPendingDelete}
          onClose={closeDraft}
        />
      )}

      {/* Opened from the row's trash control or the edit form's, and the only
          path to a delete: nothing calls removeEntry without going through it. */}
      {pendingDelete && (
        <ConfirmDeleteSheet
          entry={pendingDelete}
          currency={currency}
          onConfirm={() => removeEntry(pendingDelete)}
          onClose={() => setPendingDelete(null)}
        />
      )}

      {showSettings && (
        <SettingsSheet
          config={ledger.config}
          me={me}
          spreadsheetId={connection.spreadsheetId}
          tombstoneCount={ledger.tombstoneCount}
          onSetMe={setMe}
          onCompact={ledger.compact}
          onForget={switchSheet}
          onClose={() => setShowSettings(false)}
        />
      )}

      <Toasts toasts={toasts.toasts} />
    </div>
  )
}
