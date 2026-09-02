import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { DEFAULT_CONFIG } from '../src/config.js'
import { ENTRY_TYPE, PERSON, RECURRING } from '../src/schema.js'
import { expense } from './support/entries.js'
import { entryFromTemplate, rowToTemplate } from '../src/lib/recurring.js'
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
import { RecurringCard } from '../src/components/RecurringCard.jsx'
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

const config = {
  ...DEFAULT_CONFIG,
  person1Name: 'Alex',
  person2Name: 'Sam',
  categories: ['Groceries', 'Dining', 'Household'],
}

const noop = () => {}

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
 * The recurring-cost card. Every figure it shows comes from the app's own decoder, so a
 * page built from a `recurring` row is the same path a real sheet takes.
 */
describe('the expected-this-month card renders', () => {
  const template = (fields) =>
    rowToTemplate(RECURRING.columns.map((column) => ({ payer: 'p1', ...fields })[column] ?? ''))

  const render = (expected) =>
    renderToStaticMarkup(<RecurringCard expected={expected} onPick={noop} />)

  const rent = entryFromTemplate(
    template({ id: 'rent', description: 'Rent', amount: '220000', category: 'Rent' }),
    '2026-08',
  )

  it('names each cost and its amount, as one tappable row', () => {
    const markup = render([rent])
    expect(markup).toContain('Expected this month')
    expect(markup).toContain('Rent')
    expect(markup).toContain('¥220,000')
    expect(markup.match(/<button/g)).toHaveLength(1)
  })

  /**
   * A blank amount is recurring-but-variable, and "¥0" would read as a bill for nothing
   * — so the assertion is the absent symbol, not merely the present word: with the
   * branch lost, the word is gone and `¥0` is what renders.
   */
  it('says the amount varies rather than printing a zero', () => {
    const variable = entryFromTemplate(template({ id: 'gas', description: 'Gas' }), '2026-08')
    const markup = render([variable])
    expect(markup).toContain('Varies')
    expect(markup).not.toContain('¥')
  })

  it('renders nothing at all when the month is not missing anything', () => {
    // The common case by far: the card must not leave an empty heading on the screen.
    expect(render([])).toBe('')
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
    expected: [],
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
      onAddExpected={noop}
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
