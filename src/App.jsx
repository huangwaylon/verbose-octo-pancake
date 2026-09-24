import { useCallback, useEffect, useState } from 'react'
import { useConnection } from './state/useConnection.js'
import { useLedger } from './state/useLedger.js'
import {
  blocksReload,
  gateFor,
  hasLoaded,
  isRefreshing,
  newDraftEntry,
  noticeKeys,
} from './lib/ledgerState.js'
import { useLedgerView, useInitialMonth } from './state/useLedgerView.js'
import { useToasts } from './state/useToasts.js'
import { currentMonthKey } from './lib/dates.js'
import { useT, errorMessage } from './i18n/index.js'
import { readStoredIdentity, storeIdentity } from './lib/identity.js'
import { reconsiderUpdate, setSafeToReload } from './lib/serviceWorker.js'
import {
  newTemplate,
  recordableEntry,
  restoredTemplate,
  retiredTemplate,
  templateTitle,
} from './lib/recurring.js'
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
  const { config, entries, templates, sheetExtras } = ledger

  // Nothing detects who is signed in — the token belongs to the account that owns the sheet — so
  // identity is this device's own choice.
  const [me, setIdentityChoice] = useState(readStoredIdentity)
  const [monthKey, setMonthKey] = useState(currentMonthKey)
  /**
   * Every sheet the app can put over the ledger, as ONE value, so "exactly one `BottomSheet` is
   * mounted" is structural. Two at once means two Escape handlers, two focus traps fighting over Tab,
   * and the inner one's cleanup clearing `--keyboard-inset` with the outer's keyboard still up.
   */
  const [overlay, setOverlay] = useState(null)
  const closeOverlay = () => setOverlay(null)

  const view = useLedgerView(entries, templates, monthKey)
  useInitialMonth(ledger.status, view.active, setMonthKey)

  const setMe = (person) => {
    storeIdentity(person)
    setIdentityChoice(person)
  }

  /**
   * An update activates by RELOADING, so never through anything it would interrupt (`blocksReload`'s
   * decision, in lib). The nudge is the other half: a worker refused while a sheet was open gets no
   * `focus` event to ask again.
   */
  useEffect(() => {
    setSafeToReload(
      () => !blocksReload({ overlay, entries, writing: ledger.writing, status: ledger.status }),
    )
    reconsiderUpdate()
  }, [overlay, entries, ledger.writing, ledger.status])

  /** Both stable, or `EntryList`'s memo dies on every toast. */
  const openEntry = useCallback((entry) => setOverlay({ kind: 'entry', mode: 'edit', entry }), [])
  /**
   * A confirmation opened from a form carries `returnTo`, that form's overlay with what was typed,
   * so Cancel goes back to it; from a row's trash control there is none, and Cancel closes. One
   * mechanism for entries and templates, and still one `overlay`.
   */
  const confirmDeleteEntry = useCallback(
    (entry, returnTo = null) => setOverlay({ kind: 'confirmEntry', entry, returnTo }),
    [],
  )

  /**
   * `useLedger` has already reverted the optimistic change, so there is nothing to undo here. Stable,
   * with `toasts.push`/`toasts.error` as deps rather than the object they hang off, which is fresh
   * on every render — `recordDraft` below takes it into `EntryList`'s memo.
   */
  const report = useCallback(
    async (write, okKey, failKey) => {
      try {
        await write()
        toasts.push(t(okKey))
      } catch (cause) {
        toasts.error(errorMessage(cause, failKey))
      }
    },
    [toasts.push, toasts.error, t],
  )

  /**
   * Record a recurring cost the month is missing: one tap for a cost that needs nothing typed, the
   * prefilled ADD form for one that does — a variable bill, or a template with no category. The
   * decision is `recordableEntry`'s, so the tap refuses exactly what a submit would.
   */
  const recordDraft = useCallback(
    (draft) => {
      const entry = recordableEntry(draft, config)
      if (!entry) {
        setOverlay({ kind: 'entry', mode: 'add', entry: draft })
        return
      }
      return report(() => ledger.addEntry(entry), 'toast.added', 'toast.addFailed')
    },
    [config, ledger.addEntry, report],
  )

  const openAdd = () => setOverlay({ kind: 'entry', mode: 'add', entry: newDraftEntry(me) })
  const openSettings = () => setOverlay({ kind: 'settings' })
  const openRecurring = () => setOverlay({ kind: 'recurring' })
  const openTemplate = (mode, template) => setOverlay({ kind: 'template', mode, template })

  /** The form paths RETHROW: the form stays open and shows the reason against its own Save. */
  const submitEntry = async (input) => {
    const editing = overlay.mode === 'edit'
    const entry = await (editing ? ledger.editEntry(input) : ledger.addEntry(input))
    toasts.push(t(editing ? 'toast.saved' : 'toast.added'))
    return entry
  }

  const writeTemplate = async (input, okKey) => {
    await ledger.saveTemplate(input)
    toasts.push(t(okKey))
  }

  /**
   * Retiring is dated from TODAY, never from `monthKey`: the page is scoped to the month on screen
   * so a missed month stays recordable, but dated from a month navigated back to this would retire
   * every month since.
   */
  const retire = (input) =>
    writeTemplate(retiredTemplate(input, currentMonthKey()), 'toast.retired')
  const restore = (input) => writeTemplate(restoredTemplate(input), 'toast.restored')

  const deleteEntry = (entry) => {
    closeOverlay()
    return report(() => ledger.removeEntry(entry.id), 'toast.deleted', 'toast.deleteFailed')
  }

  const undeleteEntry = (entry) =>
    report(() => ledger.restoreEntry(entry.id), 'toast.restored', 'toast.restoreFailed')

  /**
   * Irreversible, and reported by toast because no form is left. The confirmation stays up until the
   * delete and its re-read land: back on the recurring page early, the template is still listed, and
   * saving it would append it again.
   */
  const deleteTemplate = async (template) => {
    await report(() => ledger.deleteTemplate(template), 'toast.deleted', 'toast.deleteFailed')
    openRecurring()
  }

  const forgetKey = () => {
    closeOverlay()
    connection.forget()
  }

  const connectionError = connection.error ? errorMessage(connection.error, 'error.offline') : null

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

  const notices = noticeKeys({
    status: ledger.status,
    error: ledger.error,
    ...sheetExtras,
  }).map(({ key, vars }) => t(key, vars))

  return (
    <div className="app">
      <LedgerScreen
        config={config}
        me={me}
        view={view}
        monthKey={monthKey}
        notices={notices}
        refreshing={isRefreshing(ledger.status)}
        onRefresh={ledger.refresh}
        onOpenSettings={openSettings}
        onMonthChange={setMonthKey}
        onEdit={openEntry}
        onDelete={confirmDeleteEntry}
        onRestore={undeleteEntry}
        onRecord={recordDraft}
        onAdd={openAdd}
      />

      {/* Every handler SETS the overlay, so this can only ever produce a single sheet. */}
      {overlay?.kind === 'entry' && (
        <EntryFormSheet
          draft={overlay}
          config={config}
          me={me}
          onSubmit={submitEntry}
          onDelete={confirmDeleteEntry}
          onClose={closeOverlay}
        />
      )}

      {/* The only path to an entry delete, from a row's trash control or the edit form's. */}
      {overlay?.kind === 'confirmEntry' && (
        <ConfirmDeleteSheet
          entry={overlay.entry}
          onConfirm={() => deleteEntry(overlay.entry)}
          onClose={() => setOverlay(overlay.returnTo)}
        />
      )}

      {overlay?.kind === 'settings' && (
        <SettingsSheet
          config={config}
          me={me}
          spreadsheetId={connection.spreadsheetId}
          tombstoneCount={ledger.tombstoneCount}
          templateCount={templates.length}
          onSetMe={setMe}
          onCompact={ledger.compact}
          onOpenRecurring={openRecurring}
          onForget={forgetKey}
          onClose={closeOverlay}
        />
      )}

      {overlay?.kind === 'recurring' && (
        <RecurringSheet
          templates={templates}
          entries={entries}
          config={config}
          me={me}
          monthKey={monthKey}
          loaded={hasLoaded(ledger.status)}
          undecodedTemplates={sheetExtras.undecodedTemplates}
          spreadsheetId={connection.spreadsheetId}
          onAdd={() => openTemplate('add', newTemplate(me))}
          onEdit={(template) => openTemplate('edit', template)}
          onClose={closeOverlay}
        />
      )}

      {overlay?.kind === 'template' && (
        <TemplateFormSheet
          draft={overlay}
          config={config}
          me={me}
          onSubmit={(input) =>
            writeTemplate(input, overlay.mode === 'add' ? 'toast.added' : 'toast.saved')
          }
          onRetire={retire}
          onRestore={restore}
          onDelete={(template, returnTo) =>
            setOverlay({ kind: 'confirmTemplate', template, returnTo })
          }
          onClose={openRecurring}
        />
      )}

      {overlay?.kind === 'confirmTemplate' && (
        <ConfirmSheet
          title={t('confirm.deleteTemplateTitle')}
          body={t('confirm.deleteTemplateBody', {
            /* The name can be whatever is in the field — cleared, the guard names nothing. */
            name: templateTitle(overlay.template, t('entry.expense')),
          })}
          confirmLabel={t('recurring.delete')}
          onConfirm={() => deleteTemplate(overlay.template)}
          onClose={() => setOverlay(overlay.returnTo)}
        />
      )}

      <Toasts toasts={toasts.toasts} />
    </div>
  )
}
