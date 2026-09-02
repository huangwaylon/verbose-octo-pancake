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
import { newTemplate, restoredTemplate, retiredTemplate } from './lib/recurring.js'
import { LedgerScreen } from './components/LedgerScreen.jsx'
import { EntryFormSheet } from './components/EntryFormSheet.jsx'
import { ConfirmDeleteSheet } from './components/ConfirmDeleteSheet.jsx'
import { ConfirmSheet } from './components/ConfirmSheet.jsx'
import { SettingsSheet } from './components/SettingsSheet.jsx'
import { RecurringSheet } from './components/RecurringSheet.jsx'
import { TemplateFormSheet } from './components/TemplateFormSheet.jsx'
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

  // Nothing can detect who is signed in — the token belongs to the account that owns
  // the sheet, not to either person — so identity is this device's own choice.
  const [me, setIdentityChoice] = useState(readStoredIdentity)
  const [monthKey, setMonthKey] = useState(currentMonthKey)
  const [draft, setDraft] = useState(null)
  /** The entry the confirmation dialog is asking about, if it is open. */
  const [pendingDelete, setPendingDelete] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  /**
   * The recurring surface, as ONE value rather than a flag per sheet: `null`, `'list'`, or
   * a `{mode, template}` draft.
   *
   * Exactly one sheet is open at a time and that has to be structural, not arbitrated.
   * `BottomSheet` puts a keydown listener on the document, traps Tab against its own panel
   * and mounts `useKeyboardInset` — so two of them at once means Escape closes both, two
   * traps fight over Tab, and the inner one's cleanup clears `--keyboard-inset` while the
   * outer still has the keyboard up, putting Save back behind a keypad that has no Done
   * key. A single value cannot express "both".
   */
  const [recurring, setRecurring] = useState(null)

  const config = ledger.config
  const view = useLedgerView(ledger.entries, monthKey)
  useInitialMonth(ledger.status, view.active, setMonthKey)

  const setMe = useCallback((person) => {
    storeIdentity(person)
    setIdentityChoice(person)
  }, [])

  // A service worker update activates by reloading, so it must never land while an
  // entry is half-typed or a write has not reached the sheet. Nudging after the
  // predicate changes is the other half: a worker refused while the form was open gets
  // no `focus` event to ask again, because nobody left the app.
  // `recurring` counts as well as `draft`: a half-typed recurring cost is as much a form
  // mid-entry as an expense is, and a template write is invisible to `hasPendingWrite`
  // because templates carry no optimistic flag.
  useEffect(() => {
    setSafeToReload(() => !draft && !recurring && !hasPendingWrite(ledger.entries))
    reconsiderUpdate()
  }, [draft, recurring, ledger.entries])

  const openAdd = () => setDraft({ mode: 'add', entry: newDraftEntry(me) })

  /**
   * Stable so `EntryList`'s memo holds: it is one of the two handlers a row takes, and
   * the other — `setPendingDelete` — is a setter, already stable. A fresh arrow here
   * would defeat the memo on every toast and every refresh, which is exactly when the
   * ledger must not be rebuilt.
   */
  const editDraft = useCallback((entry) => setDraft({ mode: 'edit', entry }), [])

  /**
   * Record tapped on the recurring page: an ordinary ADD, prefilled from the `recurring`
   * tab. The recurring sheet CLOSES first, which is what keeps one sheet on screen — and
   * the draft's deterministic id is the only thing standing between two taps and two rent
   * rows, which is enough because the optimistic row carries that id and `recurringRows`
   * reads it as recorded.
   */
  const recordTemplate = (entry) => {
    setRecurring(null)
    setDraft({ mode: 'add', entry })
  }

  const openRecurring = () => {
    setShowSettings(false)
    setRecurring('list')
  }

  /**
   * The three recurring writes, which are one write with three sentences attached. Each returns
   * to the list because `TemplateFormSheet`'s own `onClose` does that — these only own the
   * toast — and each RETHROWS, unlike the ledger's toast paths: the form stays open on a
   * failure and shows the reason against its own Save button.
   *
   * Retiring is dated from TODAY, never from `monthKey`. The page is scoped to the month on
   * screen so a missed month stays recordable, but "stop this cost" is a decision about now —
   * dated from an August anyone had navigated back to, it would silently retire September
   * through December as well.
   */
  const saveTemplate = async (input, okKey) => {
    await ledger.saveTemplate(input)
    toasts.push(t(okKey))
  }

  const submitTemplate = (input) =>
    saveTemplate(input, recurring?.mode === 'add' ? 'toast.added' : 'toast.saved')

  const retireTemplate = (input) =>
    saveTemplate(retiredTemplate(input, currentMonthKey()), 'toast.retired')

  const restoreTemplate = (input) => saveTemplate(restoredTemplate(input), 'toast.restored')

  /**
   * Deleting a cost's row, which is irreversible and the only recurring path that is. The form
   * closes and the confirmation opens in its place — one sheet at a time — and confirming
   * returns to the list rather than to the form, which no longer has anything to edit.
   *
   * Reported through a toast rather than rethrown, unlike the form's own writes: by the time it
   * runs there is no form left to show a message against.
   */
  const deleteTemplate = (template) => {
    setRecurring('list')
    return report(() => ledger.deleteTemplate(template), 'toast.deleted', 'toast.deleteFailed')
  }

  /**
   * The write paths that report to a toast. `useLedger` has already reverted the
   * optimistic change by the time the catch runs, so there is nothing to undo here.
   *
   * Saying it is not decoration: the balance in the header deliberately carries no
   * `role="status"`, on the grounds that every write already speaks through a toast.
   */
  const report = async (write, okKey, failKey) => {
    try {
      await write()
      toasts.push(t(okKey))
    } catch (cause) {
      toasts.error(errorMessage(cause, failKey))
    }
  }

  /**
   * Rethrown, unlike the other paths: the form stays open on a failure and shows the
   * reason against its own Save button, so the toast is the SUCCESS half only.
   */
  const submitDraft = async (input) => {
    const edit = draft.mode === 'edit'
    const entry = await (edit ? ledger.editEntry(input) : ledger.addEntry(input))
    toasts.push(t(edit ? 'toast.saved' : 'toast.added'))
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
    ...ledger.sheetExtras,
  }).map(({ key, vars }) => t(key, vars))

  return (
    <div className="app">
      <LedgerScreen
        config={config}
        me={me}
        view={view}
        monthKey={monthKey}
        notices={notices}
        refreshing={ledger.status === 'refreshing'}
        onRefresh={ledger.refresh}
        onOpenSettings={() => setShowSettings(true)}
        onMonthChange={setMonthKey}
        onEdit={editDraft}
        onDelete={setPendingDelete}
        onRestore={restoreEntry}
        onAdd={openAdd}
      />

      {draft && (
        <EntryFormSheet
          draft={draft}
          config={config}
          me={me}
          onSubmit={submitDraft}
          onDelete={setPendingDelete}
          onClose={() => setDraft(null)}
        />
      )}

      {/* Opened from the row's trash control or the edit form's, and the only path to a
          delete: nothing calls removeEntry without going through it. */}
      {pendingDelete && (
        <ConfirmDeleteSheet
          entry={pendingDelete}
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
          templateCount={ledger.templates.length}
          onSetMe={setMe}
          onCompact={ledger.compact}
          onOpenRecurring={openRecurring}
          onForget={forgetKey}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* One ternary, not two independent guards: the list and the form are two views of
          one surface and must never both be mounted. See `recurring`'s own comment. */}
      {recurring?.mode === 'delete' ? (
        <ConfirmSheet
          title={t('recurring.deleteTitle')}
          body={t('recurring.deleteBody', { name: recurring.template.description })}
          onConfirm={() => deleteTemplate(recurring.template)}
          onClose={() => setRecurring({ mode: 'edit', template: recurring.template })}
        />
      ) : recurring === 'list' ? (
        <RecurringSheet
          templates={ledger.templates}
          entries={ledger.entries}
          config={config}
          me={me}
          monthKey={monthKey}
          loaded={ledger.status === 'ready' || ledger.status === 'refreshing'}
          undecodedTemplates={ledger.sheetExtras.undecodedTemplates}
          spreadsheetId={connection.spreadsheetId}
          onAdd={() => setRecurring({ mode: 'add', template: newTemplate(me) })}
          onEdit={(template) => setRecurring({ mode: 'edit', template })}
          onRecord={recordTemplate}
          onClose={() => setRecurring(null)}
        />
      ) : recurring ? (
        <TemplateFormSheet
          draft={recurring}
          config={config}
          me={me}
          onSubmit={submitTemplate}
          onRetire={retireTemplate}
          onRestore={restoreTemplate}
          onDelete={(template) => setRecurring({ mode: 'delete', template })}
          onClose={() => setRecurring('list')}
        />
      ) : null}

      <Toasts toasts={toasts.toasts} />
    </div>
  )
}
