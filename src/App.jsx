import { useCallback, useEffect, useState } from 'react'
import { useConnection } from './state/useConnection.js'
import { useLedger } from './state/useLedger.js'
import { gateFor, hasPendingWrite, newDraftEntry, noticeKeys } from './lib/ledgerState.js'
import { useLedgerView, useInitialMonth } from './state/useLedgerView.js'
import { useToasts } from './state/useToasts.js'
import { currentMonthKey } from './lib/dates.js'
import { useT, errorMessage } from './i18n/index.js'
import { readStoredIdentity, storeIdentity } from './lib/identity.js'
import { reconsiderUpdate, setSafeToReload } from './lib/serviceWorker.js'
import { LedgerScreen } from './components/LedgerScreen.jsx'
import { EntryFormSheet } from './components/EntryFormSheet.jsx'
import { ConfirmDeleteSheet } from './components/ConfirmDeleteSheet.jsx'
import { SettingsSheet } from './components/SettingsSheet.jsx'
import { Toasts } from './components/Toasts.jsx'
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
  // an entry is half-typed or a write has not reached the sheet. Nudging after the
  // predicate changes is the other half: a worker refused while the form was open
  // gets no `focus` event to ask again, because nobody left the app.
  useEffect(() => {
    setSafeToReload(() => !draft && !hasPendingWrite(ledger.entries))
    reconsiderUpdate()
  }, [draft, ledger.entries])

  const openAdd = () => setDraft({ mode: 'add', entry: newDraftEntry(me) })

  /**
   * The four write paths that report to a toast. `useLedger` has already reverted
   * the optimistic change by the time the catch runs, so there is nothing to undo
   * here — only something to say.
   *
   * Saying it is not decoration: the balance in the header deliberately carries no
   * `role="status"`, on the grounds that every write already speaks through a toast.
   * A save that announced nothing would leave a VoiceOver user with a closed sheet
   * and a figure that changed silently.
   */
  const report = async (write, okKey, failKey) => {
    try {
      await write()
      toasts.push({ message: t(okKey) })
    } catch (cause) {
      toasts.error(errorMessage(cause, failKey))
    }
  }

  /**
   * Rethrown, unlike the other three: the form stays open on a failure and shows the
   * reason against its own Save button, so the toast is the SUCCESS half only.
   */
  const submitDraft = async (input) => {
    const edit = draft.mode === 'edit'
    const entry = await (edit ? ledger.editEntry(input) : ledger.addEntry(input))
    toasts.push({ message: t(edit ? 'toast.saved' : 'toast.added') })
    return entry
  }

  const removeEntry = (entry) => {
    setPendingDelete(null)
    return report(() => ledger.removeEntry(entry.id), 'toast.deleted', 'toast.deleteFailed')
  }

  const restoreEntry = (entry) =>
    report(() => ledger.restoreEntry(entry.id), 'toast.restored', 'toast.restoreFailed')

  const forgetKey = () => {
    setShowSettings(false)
    connection.forget()
  }

  const connectionError = connection.error ? errorMessage(connection.error, 'error.offline') : null

  /** Which screen stands in front of the ledger is `gateFor`'s decision, in lib. */
  const gate = gateFor({
    connectionStatus: connection.status,
    spreadsheetId: connection.spreadsheetId,
    connectionFailed: Boolean(connection.error),
    ledgerStatus: ledger.status,
    me,
  })

  if (gate === 'unconfigured') return <UnconfiguredGate />
  if (gate === 'key') {
    return (
      <KeyGate
        onConnect={connection.connect}
        connecting={connection.connecting}
        error={connectionError}
        suspect={connection.suspect}
      />
    )
  }
  if (gate === 'connectionError') {
    return <ErrorGate message={connectionError} onRetry={connection.retry} />
  }
  if (gate === 'readError') {
    return (
      <ErrorGate message={errorMessage(ledger.error, 'error.readSheet')} onRetry={ledger.refresh} />
    )
  }
  if (gate === 'loading') return <LoadingGate label={t('gate.loadingSheet')} />
  if (gate === 'identity') return <IdentityGate config={config} onPick={setMe} />

  /** Which notices apply is `noticeKeys`' decision, in lib, where it is testable. */
  const notices = noticeKeys({
    status: ledger.status,
    error: ledger.error,
    mixedCurrencies: view.mixedCurrencies,
    // The scale amounts are being read at, so the notice can name it.
    currency,
    ...ledger.sheetExtras,
  }).map(({ key, vars }) => t(key, vars))

  return (
    <div className="app">
      <LedgerScreen
        config={config}
        me={me}
        currency={currency}
        view={view}
        monthKey={monthKey}
        notices={notices}
        refreshing={ledger.status === 'refreshing'}
        onRefresh={ledger.refresh}
        onOpenSettings={() => setShowSettings(true)}
        onMonthChange={setMonthKey}
        onEdit={(entry) => setDraft({ mode: 'edit', entry })}
        onDelete={setPendingDelete}
        onRestore={restoreEntry}
        onAdd={openAdd}
      />

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
