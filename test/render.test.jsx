import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { ENTRY_TYPE, PERSON, rowToTemplate } from '../src/schema.js'
import { config, expense, noop, templateRow } from './support/entries.js'
import { newTemplate } from '../src/lib/recurring.js'
import {
  computeBalance,
  groupByDate,
  spendByCategory,
  spendByPerson,
  totalSpend,
} from '../src/lib/balance.js'
import { currentMonthKey } from '../src/lib/dates.js'
import { LedgerScreen } from '../src/components/LedgerScreen.jsx'
import { SummaryCard } from '../src/components/SummaryCard.jsx'
import { RecurringSheet } from '../src/components/RecurringSheet.jsx'
import { TemplateFormSheet } from '../src/components/TemplateFormSheet.jsx'
import { EntryList } from '../src/components/EntryList.jsx'
import { Header } from '../src/components/Header.jsx'
import { MonthNav } from '../src/components/MonthNav.jsx'
import { SettingsSheet } from '../src/components/SettingsSheet.jsx'
import {
  ErrorGate,
  IdentityGate,
  KeyGate,
  LoadingGate,
  UnconfiguredGate,
} from '../src/components/Gate.jsx'
import { Toasts } from '../src/components/Toasts.jsx'

/**
 * Render smoke tests. These catch the class of bug a build cannot: a component
 * that throws on a real prop shape, or a view that silently drops data. They
 * render to static markup, so no DOM or browser is needed.
 */

/**
 * The shared expense. Amounts stay at the call sites: every figure in the assertions
 * below — ¥4,210, the ¥8,359 month total, the ¥70 balance — is derived from them.
 *
 * `en` renders the halfwidth ¥; `ja` renders fullwidth ￥. These render at the default
 * locale, so halfwidth is what the markup carries.
 */
const entry = (overrides) =>
  expense({ date: '2026-08-04', now: '2026-08-04T10:00:00.000Z', ...overrides })

const entries = [
  entry({ id: 'a', amountYen: 4210, category: 'Groceries', description: "Trader Joe's" }),
  entry({ id: 'b', amountYen: 2350, category: 'Dining', payer: PERSON.P2, date: '2026-08-03' }),
  entry({ id: 'c', amountYen: 1799, category: 'Household', payerShare: 1 }),
  entry({
    id: 'd',
    type: ENTRY_TYPE.SETTLEMENT,
    amountYen: 1000,
    payerShare: 0,
    payer: PERSON.P2,
    category: '',
  }),
]

describe('gates render', () => {
  it('renders every pre-app screen without throwing', () => {
    expect(renderToStaticMarkup(<UnconfiguredGate />)).toContain('VITE_SCRIPT_URL')
    expect(renderToStaticMarkup(<KeyGate onConnect={noop} />)).toContain('App key')
    expect(renderToStaticMarkup(<IdentityGate config={config} onPick={noop} />)).toContain('Alex')
    expect(renderToStaticMarkup(<ErrorGate message="Boom" onRetry={noop} />)).toContain('Boom')
  })

  it('takes the key in a password field, so iOS offers to store it', () => {
    // "Typed once per device" only holds if the Keychain can keep it.
    const markup = renderToStaticMarkup(<KeyGate onConnect={noop} />)
    expect(markup).toContain('type="password"')
    expect(markup).toContain('autoComplete="current-password"')
  })

  it('surfaces a connection error to the person instead of swallowing it', () => {
    const markup = renderToStaticMarkup(<KeyGate onConnect={noop} error="Could not reach it" />)
    expect(markup).toContain('Could not reach it')
  })

  it('explains a rejected key when there is no fresher failure to report', () => {
    // The key is kept on purpose, so the screen has to say why it came back.
    const markup = renderToStaticMarkup(<KeyGate onConnect={noop} suspect />)
    expect(markup).toContain('rejected')
  })

  it('announces the wait with the label the caller supplies', () => {
    // The gate has no string of its own — the caller says what is loading, so
    // the same spinner can speak for the sheet, the config or the rows.
    const markup = renderToStaticMarkup(<LoadingGate label="Loading your sheet" />)
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('Loading your sheet')
  })
})

describe('toasts render', () => {
  it('renders nothing at all when there is nothing to say', () => {
    expect(renderToStaticMarkup(<Toasts toasts={[]} />)).toBe('')
  })

  it('has one tone beyond the default, and it is error', () => {
    // A failure is the only thing worth colouring; a success needs no relief.
    const markup = renderToStaticMarkup(
      <Toasts
        toasts={[
          { id: 'a', message: 'Saved' },
          { id: 'b', message: 'Could not save', tone: 'error' },
        ]}
      />,
    )
    expect(markup).toContain('Saved')
    expect(markup).toContain('Could not save')
    expect(markup.match(/toast--error/g)).toHaveLength(1)
    expect(markup).not.toContain('toast--success')
  })

  it('interrupts for a failure and waits its turn for anything else', () => {
    // A write failure has to be spoken now; a "Deleted" confirmation must not
    // cut across whatever the person is reading.
    const markup = renderToStaticMarkup(
      <Toasts
        toasts={[
          { id: 'a', message: 'Deleted' },
          { id: 'b', message: 'Could not save', tone: 'error' },
        ]}
      />,
    )
    expect(markup).toMatch(
      /role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/,
    )
    expect(markup).toMatch(
      /role="alert"[^>]*aria-live="assertive"|aria-live="assertive"[^>]*role="alert"/,
    )
    // The urgency belongs to the individual toast, not the stack: one shared
    // region cannot be polite and assertive at once.
    expect(markup).toContain('class="toast-stack"')
    expect(markup).not.toMatch(/class="toast-stack"[^>]*aria-live/)
  })
})

describe('the header carries the balance', () => {
  const render = (props) =>
    renderToStaticMarkup(
      <Header
        balance={computeBalance(entries)}
        config={config}
        me={PERSON.P1}
        onRefresh={noop}
        onOpenSettings={noop}
        {...props}
      />,
    )

  it('names the debtor from the viewer’s perspective', () => {
    const balance = computeBalance(entries)
    // Same numbers, opposite wording. p1 is the debtor in this fixture, so it is
    // p1 who must be told they owe — asserted per side, not as a disjunction that
    // a component saying "You owe" to both people would satisfy.
    expect(balance.debtor).toBe(PERSON.P1)
    expect(render({ me: PERSON.P1 })).toContain('You owe')
    expect(render({ me: PERSON.P2 })).not.toContain('You owe')
    expect(render({ me: PERSON.P2 })).toContain('owes you')
  })

  it('speaks the whole fact once: named on the heading, hidden on the line below', () => {
    // The visible composition is digits in spans; a heading that reads "¥70" says
    // nothing in a screen reader's heading list, and read span by span it announces
    // as "yen seven zero". The visible copy of the sentence is then hidden, or it is
    // announced twice over. The span assertion is what stops the whole composition
    // collapsing to a flat string, which every other check here would survive.
    const markup = render()
    expect(markup).toContain('<h1 class="balance__amount" aria-label="You owe Sam ¥70">')
    expect(markup).toContain('<p class="balance__direction" aria-hidden="true">You owe Sam</p>')
    expect(markup).toContain('<span class="balance__symbol">¥</span>')
  })

  it('says settled when nothing is owed, with no figure at all', () => {
    const markup = render({
      balance: { netYen: 0, debtor: null, creditor: null, amountYen: 0 },
    })
    expect(markup).toContain('All settled up')
    // Not `not.toContain('You owe')`: with a null debtor the non-settled branch reads
    // "Alex owes you ¥0", so only the absent symbol catches losing the branch.
    expect(markup).not.toContain('¥')
  })

  // Settling happens by wire transfer outside the app, so the balance carries no
  // action. Named after what it asserts — a count — rather than after the invariant:
  // a settle button replacing one of the two would pass.
  it('carries only the two chrome controls', () => {
    expect(render().match(/<button/g)).toHaveLength(2)
  })

  it('swaps the refresh control for a spinner while a read is in flight', () => {
    expect(render({ busy: true })).toContain('spinner')
    expect(render({ busy: true })).toMatch(/<button[^>]*disabled/)
    expect(render({ busy: false })).not.toContain('spinner')
  })

  // The figure moves on every write, but each of those writes already announces
  // itself through a toast; a second live region here queues behind it.
  it('is not a live region', () => {
    expect(render()).not.toContain('aria-live')
    expect(render()).not.toContain('role="status"')
  })
})

describe('summary card renders', () => {
  it('shows the month total, both payers, and the categories', () => {
    const markup = renderToStaticMarkup(
      <SummaryCard
        monthSpend={totalSpend(entries)}
        byCategory={spendByCategory(entries)}
        byPerson={spendByPerson(entries)}
        config={config}
        me={PERSON.P1}
      />,
    )
    expect(markup).toContain('Groceries')
    expect(markup).toContain('Dining')
    expect(markup).toContain('Sam paid')
    expect(markup).toContain('You paid')
    // The settlement must not be counted as spending. Asserted as the total that
    // is right and the total that would be wrong: the fixture's settlement is
    // ¥1,000, so a "not ¥9,359" check has to name the settlement-inclusive figure.
    expect(markup).toContain('¥8,359')
    expect(markup).not.toContain('¥9,359')
  })

  it('renders nothing at all for a month with no spend', () => {
    const markup = renderToStaticMarkup(
      <SummaryCard
        monthSpend={0}
        byCategory={[]}
        byPerson={{ p1: 0, p2: 0 }}
        config={config}
        me={PERSON.P1}
      />,
    )
    expect(markup).toBe('')
  })
})

describe('entry list renders', () => {
  it('renders every entry, including the settlement', () => {
    const markup = renderToStaticMarkup(
      <EntryList
        groups={groupByDate(entries)}
        config={config}
        me={PERSON.P1}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    expect(markup).toContain('Trader Joe&#x27;s') // React escapes the apostrophe
    expect(markup).toContain('Settled up')
    expect(markup).toContain('¥4,210')
    expect(markup).toContain('¥2,350')
  })

  it('labels a one-person expense rather than implying it was split', () => {
    const solo = [entry({ id: 'solo', amountYen: 900, category: 'Household', payerShare: 1 })]
    const markup = renderToStaticMarkup(
      <EntryList
        groups={groupByDate(solo)}
        config={config}
        me={PERSON.P1}
        onEdit={noop}
        onDelete={noop}
      />,
    )
    expect(markup).toContain('You only')
  })

  it('explains an empty month without a second add button', () => {
    // The block button above the list is the one add affordance: two identically
    // named accent buttons on one screen read as two different actions, and in a
    // screen reader's control list they are indistinguishable.
    const markup = renderToStaticMarkup(
      <EntryList groups={[]} config={config} me={PERSON.P1} onEdit={noop} onDelete={noop} />,
    )
    expect(markup).toContain('Nothing logged this month')
    expect(markup).toContain('Add a grocery run')
    expect(markup).not.toContain('<button')
  })
})

/**
 * The recurring page and its form. Between them these are the app's only write path into
 * the `recurring` tab, and the whole reason the page exists is to say something a list of
 * names cannot: which costs this month is still missing, and which it is not.
 */
describe('the recurring page renders', () => {
  const template = (fields) =>
    rowToTemplate(templateRow({ payer: 'p1', day_of_month: '27', ...fields }))

  const RENT = template({ id: 'rent', description: 'Rent', amount: '220000', category: 'Rent' })
  const GAS = template({ id: 'gas', description: 'Gas', day_of_month: '10' })

  const render = (props) =>
    renderToStaticMarkup(
      <RecurringSheet
        templates={[RENT]}
        entries={[]}
        config={config}
        me={PERSON.P1}
        monthKey="2026-08"
        loaded
        undecodedTemplates={0}
        spreadsheetId="sheet-abc"
        onAdd={noop}
        onEdit={noop}
        onRecord={noop}
        onClose={noop}
        {...props}
      />,
    )

  it('names each cost, its amount and the month being answered', () => {
    const markup = render()
    expect(markup).toContain('Recurring costs')
    expect(markup).toContain('Rent')
    expect(markup).toContain('¥220,000')
    // Which month the page is acting on, because it is not necessarily this one: a month
    // missed while nobody was recording has to stay recordable.
    expect(markup).toContain('August')
  })

  it('says the amount varies rather than printing a zero', () => {
    // "¥0" would read as a bill for nothing. The absent symbol is the assertion rather than
    // the present word, because a blank amount is NULL here — `money(null)` throws in
    // `assertYen` — so losing the branch is a white screen rather than a wrong figure, and
    // only checking for the symbol distinguishes "said Varies" from "said nothing".
    const markup = render({ templates: [GAS] })
    expect(markup).toContain('Varies')
    expect(markup).not.toContain('¥')
  })

  /**
   * The four states are the point of the page. Rendered as two, rent-on-the-27th viewed on
   * the 3rd is indistinguishable from rent already paid — so each says which it is, in
   * words rather than by the absence of a control.
   */
  it('offers Record only for a month it is missing, and explains every other row', () => {
    // August is over, so a 27th is due and Record is offered.
    expect(render()).toContain('Record')

    // Already in the ledger — including as a tombstone, which is what a deliberately
    // removed double charge leaves.
    const recorded = render({ entries: [expense({ id: 'rent#2026-08' })] })
    expect(recorded).toContain('recorded')
    expect(recorded).not.toContain('>Record<')

    // Stopped through `active_to`: still listed, so it can be restarted — and it says STOPPED
    // rather than "not this month", which is what a quarterly cost out of quarter says. Two
    // different facts, and the row is the only place they can be told apart.
    const stopped = render({
      templates: [template({ id: 'rent', description: 'Rent', active_to: '2026-07' })],
    })
    expect(stopped).toContain('Rent')
    expect(stopped).toContain('stopped')
    expect(stopped).not.toContain('>Record<')

    // A quarterly cost, in a month outside its quarter.
    const quarterly = render({
      templates: [template({ id: 'tax', description: 'Tax', months: '1,7' })],
    })
    expect(quarterly).toContain('not this month')
    expect(quarterly).not.toContain('stopped')
  })

  it('distinguishes "not loaded" from "none", so nobody adds a second copy', () => {
    expect(render({ templates: [], loaded: true })).toContain('Nothing set up yet')
    expect(render({ templates: [], loaded: false })).toContain('Not loaded yet')
  })

  it('reports rows the sheet holds that it cannot use, where the person is standing', () => {
    // The ledger carries the same count as a notice; here it comes with the way to fix it.
    const markup = render({ undecodedTemplates: 2 })
    expect(markup).toContain('2 rows in the recurring tab')
    expect(markup).toContain('https://docs.google.com/spreadsheets/d/sheet-abc')
  })

  it('gives each Record button a name that says which cost it records', () => {
    // Several identical "Record" buttons is all VoiceOver would otherwise read out.
    expect(render()).toContain('aria-label="Record Rent"')
  })
})

describe('the recurring form renders', () => {
  const render = (props) =>
    renderToStaticMarkup(
      <TemplateFormSheet
        draft={{ mode: 'add', template: newTemplate(PERSON.P1) }}
        config={config}
        me={PERSON.P1}
        onSubmit={noop}
        onRetire={noop}
        onRestore={noop}
        onDelete={noop}
        onClose={noop}
        {...props}
      />,
    )

  it('renders an add form with neither way to stop a cost', () => {
    // Nothing to stop yet, and a delete control on a row that does not exist is a trap.
    const markup = render()
    expect(markup).toContain('Add a recurring cost')
    expect(markup).toContain('id="template-name"')
    expect(markup).not.toContain('Stop this cost')
    expect(markup).not.toContain('Delete for good')
  })

  /**
   * Two ways to stop a cost, and which one a thumb lands on matters. The safe, reversible one
   * is the footer icon; the irreversible one is last in the body behind prose that says what it
   * costs — the same placement `SettingsSheet` gives "Forget key".
   */
  it('puts the reversible stop in the footer and the irreversible one last, explained', () => {
    const markup = render({
      draft: { mode: 'edit', template: { ...newTemplate(PERSON.P1), description: 'Rent' } },
    })
    expect(markup).toContain('Stop this cost')
    expect(markup).toContain('Delete for good')
    // After the split control, which is the last field — so it is not among the form's inputs.
    expect(markup.indexOf('Delete for good')).toBeGreaterThan(markup.indexOf('name="split"'))
    // And the cost of it is stated, because "delete" does not imply losing the sheet's record
    // of which months this cost covered.
    expect(markup).toContain('the sheet forgets which months it covered')
    expect(markup).toContain('btn--danger')
  })

  /**
   * A blank `payer_share` is a DURABLE declaration — follow the payer's default, forever —
   * and also the marker that makes `postRecurring` leave a row alone. So a new template
   * opens on the Default mode and says what that resolves to; resolving it to a number
   * would detach the cost from the config tab silently.
   */
  it('opens a blank share on Default, and names whose default at what percent', () => {
    const markup = render({ config: { ...config, defaultSplitP1: 0.8 } })
    // The element, not two separate substring checks: `checked` on a different radio in
    // the same group is exactly the failure this is for.
    expect(markup).toContain('name="split" checked="" value="default"')
    // The whole sentence, because the trap is the POSSESSIVE: English inflects, so
    // interpolating the viewer-relative label produces "Follows You’s default split". The
    // fixture's `me` is p1 and p1 is the payer, so that is exactly the case rendered here.
    expect(markup).toContain('Follows Your default split, 80% today.')
    expect(markup).not.toContain('You’s')
  })

  it('opens a stored share on its own number rather than the default', () => {
    const pinned = { ...newTemplate(PERSON.P1), payerShare: 0.3 }
    const markup = render({ draft: { mode: 'edit', template: pinned } })
    expect(markup).toContain('name="split" checked="" value="custom"')
    expect(markup).toContain('value="30"')
  })

  it('offers to stop a live cost and to restart a retired one, from one control', () => {
    const live = { ...newTemplate(PERSON.P1), description: 'Rent' }
    expect(render({ draft: { mode: 'edit', template: live } })).toContain('Stop this cost')
    expect(
      render({ draft: { mode: 'edit', template: { ...live, activeTo: '2026-07' } } }),
    ).toContain('Start this cost again')
  })

  /**
   * The three columns this form does not show have to be MENTIONED, because it writes the
   * whole row: a quarterly cost edited here keeps its schedule, and nothing on screen would
   * otherwise say so.
   */
  it('says where the schedule columns live, and what an edit does not change', () => {
    const markup = render({ draft: { mode: 'edit', template: newTemplate(PERSON.P1) } })
    expect(markup).toContain('recurring tab of your sheet')
    expect(markup).toContain('keep the figures they were recorded with')
  })
})

/**
 * The assembled surface. Nothing else in the suite renders it — only
 * `scripts/preview.jsx` does — so this is the one place the tree the app actually
 * ships can be checked for a control that was meant to be gone or duplicated.
 */
describe('the signed-in surface renders', () => {
  const view = {
    balance: computeBalance(entries),
    monthSpend: totalSpend(entries),
    byCategory: spendByCategory(entries),
    byPerson: spendByPerson(entries),
    groups: groupByDate(entries),
    deleted: [],
  }

  const markup = renderToStaticMarkup(
    <LedgerScreen
      config={config}
      me={PERSON.P1}
      view={view}
      monthKey="2026-08"
      notices={['Showing saved data.']}
      refreshing={false}
      onRefresh={noop}
      onOpenSettings={noop}
      onMonthChange={noop}
      onEdit={noop}
      onDelete={noop}
      onRestore={noop}
      onAdd={noop}
    />,
  )

  it('offers exactly one way into the entry form', () => {
    // The FAB and the empty card's button are both gone; this is the count that says
    // so, and it is what fails if either comes back — the FAB carried this same
    // string as its accessible name.
    expect(markup.match(/Add an expense/g)).toHaveLength(1)
    expect(markup).toContain('class="btn btn--primary btn--block add-action"')
  })

  it('puts the add action above the notices, so it never moves with the connection', () => {
    expect(markup.indexOf('add-action')).toBeLessThan(markup.indexOf('class="notice"'))
  })

  it('has one h1, and it is the balance rather than the app name', () => {
    expect(markup.match(/<h1/g)).toHaveLength(1)
    expect(markup).toContain('balance__amount')
    expect(markup).not.toContain('Shared Finances')
  })
})

describe('chrome renders', () => {
  it('disables forward navigation past the current month', () => {
    const past = renderToStaticMarkup(<MonthNav monthKey="2020-01" onChange={noop} />)
    expect(past).toContain('January')
    expect(past.match(/disabled/g) ?? []).toHaveLength(0)

    // The half that matters: at the current month, forward must be disabled.
    const now = renderToStaticMarkup(<MonthNav monthKey={currentMonthKey()} onChange={noop} />)
    expect(now.match(/disabled/g) ?? []).toHaveLength(1)
  })
})

describe('settings renders', () => {
  const render = (props) =>
    renderToStaticMarkup(
      <SettingsSheet
        config={config}
        me={PERSON.P1}
        spreadsheetId="sheet-abc"
        tombstoneCount={0}
        onSetMe={noop}
        onCompact={noop}
        onForget={noop}
        onClose={noop}
        {...props}
      />,
    )

  it('renders the whole sheet on a real config without throwing', () => {
    const markup = render()
    expect(markup).toContain('Settings')
    expect(markup).toContain('Alex')
    expect(markup).toContain('Sam')
    // The config tab's values, shown so nobody has to open the spreadsheet to
    // check what the app thinks they are.
    expect(markup).toContain('Groceries')
    expect(markup).toContain('Dining')
  })

  it('links to the spreadsheet it is actually connected to', () => {
    expect(render()).toContain('https://docs.google.com/spreadsheets/d/sheet-abc')
  })

  it('disables the destructive action when there is nothing to remove', () => {
    // The only irreversible thing in the app. A live button that does nothing is
    // worse than a disabled one that says so.
    const markup = render({ tombstoneCount: 0 })
    expect(markup).toContain('Nothing to remove')
    expect(markup).toMatch(/<button[^>]*disabled/)
  })

  it('says how many rows compacting would remove, pluralised', () => {
    expect(render({ tombstoneCount: 1 })).toContain('Permanently remove 1 row')
    expect(render({ tombstoneCount: 4 })).toContain('Permanently remove 4 rows')
  })

  it('shows each person’s own default split rather than one figure', () => {
    const markup = render({ config: { ...config, defaultSplitP1: 0.8, defaultSplitP2: 0.2 } })
    expect(markup).toContain('80%')
    expect(markup).toContain('20%')
  })

  it('names the accent presets for a screen reader, not by swatch colour alone', () => {
    const markup = render()
    // The swatch list specifically: a bare `role="radiogroup"` check passes on the
    // two Segmented groups above it, so it would survive deleting both attributes
    // from the swatches entirely.
    expect(markup).toContain('<div class="swatches" role="radiogroup" aria-label="Accent">')
    for (const preset of ['Indigo', 'Pine', 'Teal', 'Plum', 'Sepia']) {
      expect(markup).toContain(preset)
    }
    // Three groups, not two: identity, language, accent.
    expect(markup.match(/role="radiogroup"/g)).toHaveLength(3)
  })

  it('points at the config tab when there are no note presets', () => {
    const markup = render({ config: { ...config, notePresets: [] } })
    expect(markup).toContain('note_presets')
  })
})
