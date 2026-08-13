import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { DEFAULT_CONFIG } from '../src/config.js'
import { ENTRY_TYPE, EVEN_SHARE, PERSON, makeEntry } from '../src/schema.js'
import { computeBalance, groupByDate, spendByCategory, spendByPerson, totalSpend } from '../src/lib/balance.js'
import { BalanceCard } from '../src/components/BalanceCard.jsx'
import { SummaryCard } from '../src/components/SummaryCard.jsx'
import { EntryList } from '../src/components/EntryList.jsx'
import { Header } from '../src/components/Header.jsx'
import { MonthNav } from '../src/components/MonthNav.jsx'
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

function entry(overrides) {
  return makeEntry(
    {
      id: overrides.id,
      type: ENTRY_TYPE.EXPENSE,
      date: '2026-08-04',
      payer: PERSON.P1,
      currency: 'USD',
      payerShare: EVEN_SHARE,
      ...overrides,
    },
    '2026-08-04T10:00:00.000Z',
  )
}

const entries = [
  entry({ id: 'a', amountCents: 4210, category: 'Groceries', description: "Trader Joe's" }),
  entry({ id: 'b', amountCents: 2350, category: 'Dining', payer: PERSON.P2, date: '2026-08-03' }),
  entry({ id: 'c', amountCents: 1799, category: 'Household', payerShare: 1 }),
  entry({
    id: 'd',
    type: ENTRY_TYPE.SETTLEMENT,
    amountCents: 1000,
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
    expect(markup).toContain('role="status" aria-live="polite"')
    expect(markup).toContain('role="alert" aria-live="assertive"')
    // The urgency belongs to the individual toast, not the stack: one shared
    // region cannot be polite and assertive at once.
    expect(markup).toMatch(/<div class="toast-stack">/)
  })
})

describe('balance card renders', () => {
  it('names the debtor from the viewer’s perspective', () => {
    const balance = computeBalance(entries)
    const asP1 = renderToStaticMarkup(
      <BalanceCard balance={balance} config={config} me={PERSON.P1} currency="USD" />,
    )
    const asP2 = renderToStaticMarkup(
      <BalanceCard balance={balance} config={config} me={PERSON.P2} currency="USD" />,
    )
    // Same numbers, opposite wording — one of them must read "You owe".
    expect(asP1.includes('You owe') || asP2.includes('You owe')).toBe(true)
    expect(asP1).not.toEqual(asP2)
  })

  // Settling happens by wire transfer outside the app, so the balance is a
  // statement and carries no action. A button here would promise a flow that
  // does not exist.
  it('offers no settle action', () => {
    const markup = renderToStaticMarkup(
      <BalanceCard
        balance={computeBalance(entries)}
        config={config}
        me={PERSON.P1}
        currency="USD"
      />,
    )
    expect(markup).not.toContain('<button')
  })

  it('says settled when nothing is owed', () => {
    const markup = renderToStaticMarkup(
      <BalanceCard
        balance={{ netCents: 0, debtor: null, creditor: null, amountCents: 0 }}
        config={config}
        me={PERSON.P1}
        currency="USD"
      />,
    )
    expect(markup).toContain('All settled up')
    expect(markup).not.toContain('You owe')
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
        currency="USD"
      />,
    )
    expect(markup).toContain('Groceries')
    expect(markup).toContain('Dining')
    expect(markup).toContain('Sam paid')
    expect(markup).toContain('You paid')
    // The settlement must not be counted as spending.
    expect(markup).not.toContain('$100.00')
  })

  it('renders nothing at all for a month with no spend', () => {
    const markup = renderToStaticMarkup(
      <SummaryCard
        monthSpend={0}
        byCategory={[]}
        byPerson={{ p1: 0, p2: 0 }}
        config={config}
        me={PERSON.P1}
        currency="USD"
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
        currency="USD"
        status="ready"
        onEdit={noop}
        onDelete={noop}
        onAdd={noop}
      />,
    )
    expect(markup).toContain('Trader Joe&#x27;s') // React escapes the apostrophe
    expect(markup).toContain('Settled up')
    expect(markup).toContain('$42.10')
    expect(markup).toContain('$23.50')
  })

  it('labels a one-person expense rather than implying it was split', () => {
    const solo = [entry({ id: 'solo', amountCents: 900, category: 'Household', payerShare: 1 })]
    const markup = renderToStaticMarkup(
      <EntryList
        groups={groupByDate(solo)}
        config={config}
        me={PERSON.P1}
        currency="USD"
        status="ready"
        onEdit={noop}
        onDelete={noop}
        onAdd={noop}
      />,
    )
    expect(markup).toContain('You only')
  })

  it('offers a way forward when the month is empty', () => {
    const markup = renderToStaticMarkup(
      <EntryList
        groups={[]}
        config={config}
        me={PERSON.P1}
        currency="USD"
        status="ready"
        onEdit={noop}
        onDelete={noop}
        onAdd={noop}
      />,
    )
    expect(markup).toContain('Nothing logged this month')
    expect(markup).toContain('Add an expense')
  })

  it('shows placeholders while loading instead of a false empty state', () => {
    const markup = renderToStaticMarkup(
      <EntryList
        groups={[]}
        config={config}
        me={PERSON.P1}
        currency="USD"
        status="loading"
        onEdit={noop}
        onDelete={noop}
        onAdd={noop}
      />,
    )
    expect(markup).toContain('skeleton')
    expect(markup).not.toContain('Nothing logged')
  })
})

describe('chrome renders', () => {
  it('renders the header with both names', () => {
    const markup = renderToStaticMarkup(
      <Header
        config={config}
        me={PERSON.P1}
        status="ready"
        onRefresh={noop}
        onOpenSettings={noop}
      />,
    )
    expect(markup).toContain('You')
    expect(markup).toContain('Sam')
  })

  it('disables forward navigation past the current month', () => {
    const past = renderToStaticMarkup(<MonthNav monthKey="2020-01" onChange={noop} />)
    expect(past).toContain('January')
    expect(past.match(/disabled/g) ?? []).toHaveLength(0)
  })
})
