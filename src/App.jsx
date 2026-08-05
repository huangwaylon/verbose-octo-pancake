import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './state/useAuth.js'
import { useLedger } from './state/useLedger.js'
import { useToasts } from './state/useToasts.js'
import { ENTRY_TYPE, PERSON, isActive } from './schema.js'
import {
  computeBalance,
  filterByMonth,
  groupByDate,
  monthKeysPresent,
  spendByCategory,
  spendByPerson,
  totalSpend,
} from './lib/balance.js'
import { currentMonthKey, todayIso } from './lib/dates.js'
import { useT } from './i18n/index.js'
import { readStoredIdentity, resolveIdentity, storeIdentity } from './lib/identity.js'
import { Header } from './components/Header.jsx'
import { MonthNav } from './components/MonthNav.jsx'
import { BalanceCard } from './components/BalanceCard.jsx'
import { SummaryCard } from './components/SummaryCard.jsx'
import { EntryList } from './components/EntryList.jsx'
import { EntryFormSheet } from './components/EntryFormSheet.jsx'
import { SettingsSheet } from './components/SettingsSheet.jsx'
import { Toasts } from './components/Toasts.jsx'
import { PlusIcon } from './components/icons.jsx'
import {
  ErrorGate,
  IdentityGate,
  LoadingGate,
  SheetGate,
  SignInGate,
  UnconfiguredGate,
} from './components/Gate.jsx'

export default function App() {
  const { t } = useT()
  const auth = useAuth()
  const toasts = useToasts()
  // 'expired' keeps every gate and the app shell rendering as if still
  // signed in — see useAuth for why — so the ledger stays enabled and the
  // banner below is the only thing that changes.
  const authed = auth.status === 'signed-in' || auth.status === 'expired'
  const ledger = useLedger({ enabled: authed })
  const [reconnecting, setReconnecting] = useState(false)

  const reconnect = useCallback(async () => {
    setReconnecting(true)
    try {
      await auth.reconnect()
    } finally {
      setReconnecting(false)
    }
  }, [auth])

  const [identityChoice, setIdentityChoice] = useState(readStoredIdentity)
  const [monthKey, setMonthKey] = useState(currentMonthKey)
  const [draft, setDraft] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  const me = resolveIdentity(ledger.config, auth.email, identityChoice)
  const currency = ledger.config.currency

  const active = useMemo(() => ledger.entries.filter(isActive), [ledger.entries])
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
  // entry was a while ago does not open on an empty screen.
  const jumped = useRef(false)
  useEffect(() => {
    if (jumped.current || ledger.status !== 'ready' || !active.length) return
    jumped.current = true
    const months = monthKeysPresent(active)
    if (months.length && !months.includes(currentMonthKey())) setMonthKey(months[0])
  }, [ledger.status, active])

  const setMe = useCallback((person) => {
    storeIdentity(person)
    setIdentityChoice(person)
  }, [])

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

  const openSettle = useCallback(() => {
    setDraft({
      mode: 'add',
      entry: {
        type: ENTRY_TYPE.SETTLEMENT,
        date: todayIso(),
        // Pre-fill the person who owes, paying off exactly what is outstanding.
        payer: balance.debtor ?? me ?? PERSON.P1,
        amountCents: balance.amountCents,
        category: '',
        description: '',
        payerShare: 0,
      },
    })
  }, [balance, me])

  const openEdit = useCallback((entry) => setDraft({ mode: 'edit', entry }), [])
  const closeDraft = useCallback(() => setDraft(null), [])

  const submitDraft = useCallback(
    (input) => (draft.mode === 'edit' ? ledger.editEntry(input) : ledger.addEntry(input)),
    [draft, ledger],
  )

  const removeEntry = useCallback(
    async (entry) => {
      try {
        await ledger.removeEntry(entry.id, entry.payer)
        toasts.push({
          message: t('toast.deleted'),
          action: {
            label: t('toast.undo'),
            onClick: () => {
              ledger.restoreEntry(entry.id, entry.payer).catch((cause) => toasts.error(cause.message))
            },
          },
        })
      } catch (cause) {
        toasts.error(cause.message || t('toast.deleteFailed'))
      }
    },
    [ledger, toasts, t],
  )

  const switchSheet = useCallback(async () => {
    setShowSettings(false)
    ledger.forgetSheet()
  }, [ledger])

  // Persistent, not a toast: it must stay up until the tap resolves it, and it
  // has to render above every gate too, since 'expired' can arrive while any
  // of them is showing — not just the main app screen below.
  const reconnectBanner = auth.status === 'expired' && (
    <div className="reconnect-banner" role="alert">
      <span>{t('auth.expiredBanner')}</span>
      <button
        type="button"
        className="btn btn--sm btn--primary"
        onClick={reconnect}
        disabled={reconnecting}
      >
        {reconnecting ? <span className="spinner" /> : t('auth.reconnect')}
      </button>
    </div>
  )

  if (auth.status === 'unconfigured') return <UnconfiguredGate />
  if (!authed) {
    return <SignInGate onSignIn={auth.signIn} status={auth.status} error={auth.error} />
  }
  if (!ledger.spreadsheet) {
    return (
      <>
        {reconnectBanner}
        <SheetGate
          onCreate={ledger.createSheet}
          onChoose={ledger.chooseSheet}
          error={ledger.error}
        />
      </>
    )
  }
  if (ledger.status === 'error') {
    return (
      <>
        {reconnectBanner}
        <ErrorGate message={ledger.error} onRetry={ledger.refresh} onSwitchSheet={switchSheet} />
      </>
    )
  }
  if (ledger.status === 'idle' || ledger.status === 'loading') {
    return (
      <>
        {reconnectBanner}
        <LoadingGate label={t('gate.loadingSheet')} />
      </>
    )
  }
  if (!me) {
    return (
      <>
        {reconnectBanner}
        <IdentityGate config={ledger.config} onPick={setMe} />
      </>
    )
  }

  return (
    <div className="app">
      {reconnectBanner}
      <Header
        config={ledger.config}
        me={me}
        status={ledger.status}
        onRefresh={ledger.refresh}
        onOpenSettings={() => setShowSettings(true)}
      />

      <main className="layout">
        <aside className="layout__aside">
          {mixedCurrencies && (
            <p className="settings__warning" role="status">
              {t('warning.mixedCurrencies')}
            </p>
          )}
          <BalanceCard
            balance={balance}
            config={ledger.config}
            me={me}
            currency={currency}
            onSettle={openSettle}
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
            onDelete={removeEntry}
            onAdd={openAdd}
          />
        </section>
      </main>

      <button type="button" className="fab" onClick={openAdd} aria-label="Add an expense">
        <PlusIcon width={24} height={24} />
      </button>

      {draft && (
        <EntryFormSheet
          draft={draft}
          config={ledger.config}
          me={me}
          currency={currency}
          onSubmit={submitDraft}
          onDelete={removeEntry}
          onClose={closeDraft}
        />
      )}

      {showSettings && (
        <SettingsSheet
          config={ledger.config}
          me={me}
          spreadsheet={ledger.spreadsheet}
          tombstoneCount={ledger.tombstoneCount}
          email={auth.email}
          onSetMe={setMe}
          onCompact={ledger.compact}
          onSwitchSheet={switchSheet}
          onSignOut={auth.signOut}
          onClose={() => setShowSettings(false)}
        />
      )}

      <Toasts toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </div>
  )
}
