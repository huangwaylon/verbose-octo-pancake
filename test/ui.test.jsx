import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach } from 'vitest'

import { DEFAULT_CONFIG } from '../src/config.js'
import { DEFAULT_LOCALE } from '../src/i18n/catalogs.js'
import { setLocale } from '../src/i18n/index.js'
import { ENTRY_TYPE, EVEN_SHARE, PERSON, makeEntry } from '../src/schema.js'
import { computeBalance, groupByDate, spendByCategory, spendByPerson, totalSpend } from '../src/lib/balance.js'
import { DonutChart, MAX_SLICES, foldTail } from '../src/components/DonutChart.jsx'
import { BalanceCard } from '../src/components/BalanceCard.jsx'
import { SummaryCard } from '../src/components/SummaryCard.jsx'
import { EntryList } from '../src/components/EntryList.jsx'
import { EntryFormSheet } from '../src/components/EntryFormSheet.jsx'
import { ConfirmDeleteSheet } from '../src/components/ConfirmDeleteSheet.jsx'
import { DeletedList } from '../src/components/DeletedList.jsx'

/** The locale is a module singleton, so every test that changes it restores it. */
afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

const config = {
  ...DEFAULT_CONFIG,
  person1Name: 'Alex',
  person2Name: 'Sam',
  currency: 'JPY',
  categories: ['Groceries', 'Dining', 'Household'],
}

const noop = () => {}
const money = (cents) => `¥${cents}`
const share = (percent) => `${percent}%`

function cat(label, valueCents) {
  return { key: label, label, valueCents }
}

describe('foldTail', () => {
  it('leaves a short list alone', () => {
    const items = [cat('a', 3), cat('b', 2)]
    expect(foldTail(items, 'Other')).toEqual(items)
  })

  it('drops zero and negative values, which would draw an invisible slice', () => {
    expect(foldTail([cat('a', 5), cat('b', 0)], 'Other')).toEqual([cat('a', 5)])
  })

  it('keeps exactly MAX_SLICES without folding', () => {
    const items = Array.from({ length: MAX_SLICES }, (_, i) => cat(`c${i}`, 10 - i))
    expect(foldTail(items, 'Other')).toHaveLength(MAX_SLICES)
  })

  it('folds the tail into one bucket past MAX_SLICES', () => {
    const items = Array.from({ length: 10 }, (_, i) => cat(`c${i}`, 10))
    const folded = foldTail(items, 'Other')
    expect(folded).toHaveLength(MAX_SLICES)
    expect(folded[MAX_SLICES - 1].label).toBe('Other')
    // The five folded categories at 10 each.
    expect(folded[MAX_SLICES - 1].valueCents).toBe(50)
  })

  it('conserves the total when folding', () => {
    const items = Array.from({ length: 9 }, (_, i) => cat(`c${i}`, i + 1))
    const before = items.reduce((sum, item) => sum + item.valueCents, 0)
    const after = foldTail(items, 'Other').reduce((sum, item) => sum + item.valueCents, 0)
    expect(after).toBe(before)
  })
})

describe('DonutChart', () => {
  const render = (items) =>
    renderToStaticMarkup(
      <DonutChart
        items={items}
        formatMoney={money}
        formatShare={share}
        label="Spending by category"
        otherLabel="Other"
      />,
    )

  it('renders nothing rather than an empty ring for no data', () => {
    expect(render([])).toBe('')
    expect(render([cat('a', 0)])).toBe('')
  })

  it('draws one arc per slice', () => {
    const markup = render([cat('a', 50), cat('b', 30), cat('c', 20)])
    expect(markup.match(/<circle/g)).toHaveLength(3)
  })

  it('assigns the validated series slots in fixed order, never cycling', () => {
    const markup = render([cat('a', 3), cat('b', 2), cat('c', 1)])
    // Must be an inline STYLE, not a stroke attribute: var() is invalid in an
    // SVG presentation attribute, and a CSS rule on .chart__slice would
    // override the attribute and paint every slice one color. This regressed
    // once and rendered an invisible chart.
    expect(markup).toContain('stroke:var(--series-1)')
    expect(markup).toContain('stroke:var(--series-2)')
    expect(markup).toContain('stroke:var(--series-3)')
    expect(markup).not.toContain('var(--series-4)')
  })

  it('sets the stroke width inline too, so CSS cannot flatten the ring', () => {
    expect(render([cat('a', 1)])).toMatch(/stroke-width:\s*5/)
  })

  it('never reaches past the last validated slot', () => {
    const markup = render(Array.from({ length: 12 }, (_, i) => cat(`c${i}`, 12 - i)))
    expect(markup).toContain(`var(--series-${MAX_SLICES})`)
    expect(markup).not.toContain(`var(--series-${MAX_SLICES + 1})`)
  })

  it('sums the drawn arcs to the full ring, allowing for the inter-slice gaps', () => {
    const markup = render([cat('a', 50), cat('b', 30), cat('c', 20)])
    const dashes = [...markup.matchAll(/stroke-dasharray="([\d.]+)/g)].map((m) => Number(m[1]))
    const total = dashes.reduce((sum, value) => sum + value, 0)
    // 100 units of circumference minus one 0.6 gap per slice.
    expect(total).toBeCloseTo(100 - 3 * 0.6, 5)
  })

  it('omits the gap for a lone slice, which would otherwise be a notch in a full ring', () => {
    const markup = render([cat('a', 42)])
    expect(markup).toContain('stroke-dasharray="100 0"')
  })

  it('carries an accessible name and a per-slice title', () => {
    const markup = render([cat('Groceries', 50), cat('Dining', 50)])
    expect(markup).toContain('role="img"')
    expect(markup).toContain('aria-label="Spending by category"')
    expect(markup).toContain('<title>Groceries ¥50</title>')
  })

  it('states name, value and share in text, so colour is never the only channel', () => {
    const markup = render([cat('Groceries', 75), cat('Dining', 25)])
    expect(markup).toContain('Groceries')
    expect(markup).toContain('¥75')
    expect(markup).toContain('75%')
  })
})

describe('entry form: presets and default split', () => {
  const draft = (entry) => ({ mode: 'add', entry: { type: ENTRY_TYPE.EXPENSE, date: '2026-08-05', payer: PERSON.P1, amountCents: 0, category: '', description: '', ...entry } })

  const render = (cfg, entry) =>
    renderToStaticMarkup(
      <EntryFormSheet
        draft={draft(entry)}
        config={{ ...config, ...cfg }}
        me={PERSON.P1}
        currency="JPY"
        onSubmit={noop}
        onDelete={noop}
        onClose={noop}
      />,
    )

  it('offers each configured note as a datalist option and a chip', () => {
    const markup = render({ notePresets: ['OK Mart', 'Ozeki', 'Life'] })
    expect(markup).toContain('id="note-presets"')
    expect(markup).toContain('list="note-presets"')
    for (const shop of ['OK Mart', 'Ozeki', 'Life']) {
      expect(markup).toContain(shop)
    }
  })

  it('leaves the note a plain text input when nothing is configured', () => {
    const markup = render({ notePresets: [] })
    expect(markup).not.toContain('note-presets')
  })

  it('opens on the even control when the payer’s configured default is even', () => {
    const markup = render({ defaultSplitP1: 0.5 }, { payerShare: null })
    // The custom slider only renders in custom mode.
    expect(markup).not.toContain('type="range"')
  })

  it('opens on the custom control showing the payer’s non-even default', () => {
    const markup = render({ defaultSplitP1: 0.7 }, { payerShare: null })
    expect(markup).toContain('type="range"')
    expect(markup).toContain('70%')
  })

  it('applies each payer’s own default, so 80/20 does not invert when p2 pays', () => {
    // The whole point of the per-person setting: p1 bears 80% of what p1 paid,
    // p2 bears 20% of what p2 paid. One universal number cannot express that.
    const cfg = { defaultSplitP1: 0.8, defaultSplitP2: 0.2 }
    expect(render(cfg, { payer: PERSON.P1, payerShare: null })).toContain('80%')
    expect(render(cfg, { payer: PERSON.P2, payerShare: null })).toContain('20%')
  })

  it('shows a saved entry’s own share rather than the payer’s default', () => {
    // Editing an existing row must not silently re-split it.
    const markup = render({ defaultSplitP1: 0.8 }, { payerShare: 0.35 })
    expect(markup).toContain('35%')
  })

  it('falls back to an even split when the payer has no configured default', () => {
    const markup = render({ defaultSplitP1: undefined }, { payerShare: null })
    expect(markup).not.toContain('type="range"')
  })

  it('renders a settlement without any split or note controls', () => {
    const markup = render(
      { notePresets: ['OK Mart'] },
      { type: ENTRY_TYPE.SETTLEMENT, payerShare: 0, amountCents: 625 },
    )
    expect(markup).not.toContain('note-presets')
    expect(markup).not.toContain('type="range"')
  })
})

describe('delete confirmation', () => {
  const target = makeEntry(
    {
      id: 'x',
      type: ENTRY_TYPE.EXPENSE,
      date: '2026-08-04',
      payer: PERSON.P1,
      amountCents: 1250,
      currency: 'JPY',
      category: 'Groceries',
      description: 'Ozeki',
      payerShare: EVEN_SHARE,
    },
    '2026-08-04T10:00:00.000Z',
  )

  const render = (entry) =>
    renderToStaticMarkup(
      <ConfirmDeleteSheet entry={entry} currency="JPY" onConfirm={noop} onClose={noop} />,
    )

  it('names and prices the entry, so the question is answerable', () => {
    const markup = render(target)
    expect(markup).toContain('Ozeki')
    expect(markup).toContain('1,250')
  })

  it('offers a way out alongside the destructive action, and marks which is which', () => {
    const markup = render(target)
    expect(markup).toContain('btn--danger')
    expect(markup).toContain('Cancel')
    // Cancel must come first in the DOM: BottomSheet focuses the first control.
    expect(markup.indexOf('Cancel')).toBeLessThan(markup.indexOf('btn--danger'))
  })

  it('says where the entry goes, since that is what makes it a recoverable delete', () => {
    expect(render(target)).toContain('restore')
  })

  it('names a settlement as a settlement rather than as an expense', () => {
    const markup = render({ ...target, type: ENTRY_TYPE.SETTLEMENT, category: '', description: '' })
    expect(markup).toContain('Settled up')
    expect(markup).not.toContain('Expense')
  })
})

describe('deleted entries list', () => {
  const removed = (id, overrides) =>
    makeEntry(
      {
        id,
        type: ENTRY_TYPE.EXPENSE,
        date: '2026-08-04',
        payer: PERSON.P1,
        amountCents: 1250,
        currency: 'JPY',
        category: 'Groceries',
        payerShare: EVEN_SHARE,
        deletedAt: '2026-08-04T12:00:00.000Z',
        ...overrides,
      },
      '2026-08-04T10:00:00.000Z',
    )

  const render = (entries) =>
    renderToStaticMarkup(
      <DeletedList
        entries={entries}
        config={config}
        me={PERSON.P1}
        currency="JPY"
        onRestore={noop}
      />,
    )

  it('renders nothing at all when nothing has been deleted', () => {
    expect(render([])).toBe('')
  })

  it('starts collapsed: opening it has to be someone’s decision', () => {
    const markup = render([removed('a')])
    expect(markup).toContain('<details')
    expect(markup).not.toContain('open')
  })

  it('says how many there are while it is still closed', () => {
    expect(render([removed('a')])).toContain('1 entry')
    expect(render([removed('a'), removed('b')])).toContain('2 entries')
  })

  it('offers a restore control per entry, each naming its own entry', () => {
    const markup = render([removed('a', { description: 'Ozeki' }), removed('b', { description: 'Life' })])
    expect(markup.match(/Restore/g).length).toBeGreaterThanOrEqual(2)
    expect(markup).toContain('aria-label="Restore Ozeki"')
    expect(markup).toContain('aria-label="Restore Life"')
  })

  it('renders the entries it is handed — the month scoping is the caller’s job', () => {
    // App passes deletedEntries(entries, monthKey); the component filters
    // nothing, exactly like EntryList and its pre-grouped days.
    const markup = render([
      removed('a', { description: 'Ozeki' }),
      removed('b', { description: 'OK Mart' }),
    ])
    expect(markup).toContain('Ozeki')
    expect(markup).toContain('OK Mart')
  })

  it('prices each row at its own currency, not the sheet’s', () => {
    // The same integer at two scales: ¥1250 must not render as $1,250.
    const markup = render([removed('a', { currency: 'USD', amountCents: 1250 })])
    expect(markup).toContain('$12.50')
  })

  it('dims a row whose write has not landed yet', () => {
    expect(render([{ ...removed('a'), pending: true }])).toContain('entry--pending')
  })
})

describe('Japanese rendering', () => {
  const entries = [
    makeEntry(
      {
        id: 'a',
        type: ENTRY_TYPE.EXPENSE,
        date: '2026-08-04',
        payer: PERSON.P1,
        amountCents: 1250,
        currency: 'JPY',
        category: 'Groceries',
        payerShare: EVEN_SHARE,
      },
      '2026-08-04T10:00:00.000Z',
    ),
    makeEntry(
      {
        id: 'b',
        type: ENTRY_TYPE.EXPENSE,
        date: '2026-08-03',
        payer: PERSON.P2,
        amountCents: 800,
        currency: 'JPY',
        category: 'Dining',
        payerShare: 1,
      },
      '2026-08-03T10:00:00.000Z',
    ),
  ]

  const removed = makeEntry(
    {
      id: 'c',
      type: ENTRY_TYPE.EXPENSE,
      date: '2026-08-02',
      payer: PERSON.P2,
      amountCents: 640,
      currency: 'JPY',
      category: 'Dining',
      payerShare: EVEN_SHARE,
      deletedAt: '2026-08-02T12:00:00.000Z',
    },
    '2026-08-02T10:00:00.000Z',
  )

  function renderAll() {
    const balance = computeBalance(entries)
    return [
      renderToStaticMarkup(
        <BalanceCard
          balance={balance}
          config={config}
          me={PERSON.P1}
          currency="JPY"
          onSettle={noop}
        />,
      ),
      renderToStaticMarkup(
        <SummaryCard
          monthSpend={totalSpend(entries)}
          byCategory={spendByCategory(entries)}
          byPerson={spendByPerson(entries)}
          config={config}
          me={PERSON.P1}
          currency="JPY"
        />,
      ),
      renderToStaticMarkup(
        <EntryList
          groups={groupByDate(entries)}
          config={config}
          me={PERSON.P1}
          currency="JPY"
          status="ready"
          onEdit={noop}
          onDelete={noop}
          onAdd={noop}
        />,
      ),
      renderToStaticMarkup(
        <DeletedList
          entries={[removed]}
          config={config}
          me={PERSON.P1}
          currency="JPY"
          onRestore={noop}
        />,
      ),
      renderToStaticMarkup(
        <ConfirmDeleteSheet entry={removed} currency="JPY" onConfirm={noop} onClose={noop} />,
      ),
    ].join('')
  }

  it('renders the whole app surface in Japanese, differently from English', () => {
    const english = renderAll()
    setLocale('ja')
    const japanese = renderAll()

    expect(japanese).not.toBe(english)
    expect(japanese).toContain('貸し借り')
    expect(japanese).toContain('今月')
    expect(japanese).toContain('カテゴリー別')
  })

  it('leaks no unsubstituted placeholder in either locale', () => {
    expect(renderAll()).not.toContain('{')
    setLocale('ja')
    expect(renderAll()).not.toContain('{')
  })

  it('renders yen with no decimal places', () => {
    const markup = renderAll()
    expect(markup).toContain('1,250')
    expect(markup).not.toContain('1,250.00')
    expect(markup).not.toContain('12.50')
  })
})
