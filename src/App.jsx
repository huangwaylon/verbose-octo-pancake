import { useCallback, useEffect, useState } from 'react'
import { useConnection } from './state/useConnection.js'
import { useLedger } from './state/useLedger.js'
import { useLedgerView, useInitialMonth } from './state/useLedgerView.js'
import { useToasts } from './state/useToasts.js'
import { ENTRY_TYPE, PERSON } from './schema.js'
import { currentMonthKey, todayIso } from './lib/dates.js'
import { useT, errorMessage } from './i18n/index.js'
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

  // Nothing can tell us who is signed in — the token belongs to the account that
  // owns the sheet, not to either person — so identity is this device's own choice.
  const me = identityChoice
  const config = ledger.config
  const currency = config.currency

  const view = useLedgerView(ledger.entries, currency, monthKey)
  useInitialMonth(ledger.status, view.active, setMonthKey)

  const setMe = useCallback((person) => {
    storeIdentity(person)
    setIdentityChoice(person)
  }, [])

  // A service worker update activates by reloading, so it must never land while
  // an entry is half-typed or a write has not reached the sheet.
  useEffect(() => {
    setSafeToReload(() => !draft && !ledger.entries.some((entry) => entry.pending))
  }, [draft, ledger.entries])

  const openAdd = () =>
    setDraft({
      mode: 'add',
      entry: {
        type: ENTRY_TYPE.EXPENSE,
        date: todayIso(),
        payer: me ?? PERSON.P1,
        amountCents: 0,
        category: '',
        description: '',
        // Left unset: the form derives it from the config tab per payer, and
        // re-derives when the payer control changes. Seeding it here would pin
        // the opening payer's share onto whoever it is switched to.
        payerShare: null,
      },
    })

  const submitDraft = (input) =>
    draft.mode === 'edit' ? ledger.editEntry(input) : ledger.addEntry(input)

  /**
   * The two write paths that report to a toast. `useLedger` has already reverted
   * the optimistic change by the time the catch runs, so there is nothing to undo
   * here — only something to say.
   */
  const report = async (write, okKey, failKey) => {
    try {
      await write()
      toasts.push({ message: t(okKey) })
    } catch (cause) {
      toasts.error(errorMessage(cause, failKey))
    }
  }

  const removeEntry = (entry) => {
    setPendingDelete(null)
    return report(
      () => ledger.removeEntry(entry.id, entry.payer),
      'toast.deleted',
      'toast.deleteFailed',
    )
  }

  const restoreEntry = (entry) =>
    report(
      () => ledger.restoreEntry(entry.id, entry.payer),
      'toast.restored',
      'toast.restoreFailed',
    )

  const forgetKey = () => {
    setShowSettings(false)
    connection.forget()
  }

  const connectionError = connection.error ? errorMessage(connection.error, 'error.offline') : null

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
    return <IdentityGate config={config} onPick={setMe} />
  }

  /**
   * A refresh failed but the cache is still good, the sheet mixes currencies, or a
   * row's amount cannot be read: the screen stays up and says so rather than being
   * replaced by an error, or — for the last of the three — rather than quietly
   * showing a balance that is missing an expense.
   *
   * Translated here rather than mapped from keys below, so the literals stay
   * visible to the catalog scan in `test/i18n.test.js`.
   */
  const notices = [
    ledger.status === 'stale' && ledger.error && t('warning.staleData'),
    view.mixedCurrencies && t('warning.mixedCurrencies'),
    ledger.undecodedRows > 0 && t('warning.undecodedRows', { count: ledger.undecodedRows }),
  ].filter(Boolean)

  return (
    <div className="app">
      <Header
        config={config}
        me={me}
        busy={ledger.status === 'refreshing'}
        onRefresh={ledger.refresh}
        onOpenSettings={() => setShowSettings(true)}
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
          <MonthNav monthKey={monthKey} onChange={setMonthKey} />
          <EntryList
            groups={view.groups}
            config={config}
            me={me}
            currency={currency}
            onEdit={(entry) => setDraft({ mode: 'edit', entry })}
            onDelete={setPendingDelete}
            onAdd={openAdd}
          />
          <DeletedList
            entries={view.deleted}
            config={config}
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
          config={config}
          me={me}
          currency={currency}
          onSubmit={submitDraft}
          onDelete={setPendingDelete}
          onClose={() => setDraft(null)}
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
          config={config}
          me={me}
          spreadsheetId={connection.spreadsheetId}
          tombstoneCount={ledger.tombstoneCount}
          onSetMe={setMe}
          onCompact={ledger.compact}
          onForget={forgetKey}
          onClose={() => setShowSettings(false)}
        />
      )}

      <Toasts toasts={toasts.toasts} />
    </div>
  )
}
