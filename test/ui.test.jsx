import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach } from 'vitest'

import { DEFAULT_LOCALE } from '../src/i18n/catalogs.js'
import { setLocale } from '../src/i18n/index.js'
import { ENTRY_TYPE, EVEN_SHARE, PERSON } from '../src/schema.js'
import { config, expense, noop, tombstone } from './support/entries.js'
import { newTemplate } from '../src/lib/recurring.js'
import {
  computeBalance,
  groupByDate,
  shareByPerson,
  spendByCategory,
  spendByPerson,
  totalSpend,
} from '../src/lib/balance.js'
import { DonutChart, MAX_SLICES, foldTail } from '../src/components/DonutChart.jsx'
import { Header } from '../src/components/Header.jsx'
import { SummaryCard } from '../src/components/SummaryCard.jsx'
import { EntryList } from '../src/components/EntryList.jsx'
import { EntryFormSheet } from '../src/components/EntryFormSheet.jsx'
import { TemplateFormSheet } from '../src/components/TemplateFormSheet.jsx'
import { ConfirmDeleteSheet } from '../src/components/ConfirmDeleteSheet.jsx'
import { ConfirmSheet } from '../src/components/ConfirmSheet.jsx'
import { DeletedList } from '../src/components/DeletedList.jsx'

/**
 * The DECISIONS a component makes, as opposed to whether it renders at all: field order, which
 * mode a control opens in, which ARIA wiring resolves, what a fallback picks. `render.test.jsx`
 * is the other half — it renders each surface once on a real prop shape and catches a component
 * that throws or silently drops data. A case belongs here if a correct-looking screen could
 * still be wrong; there if the screen would be visibly broken.
 *
 * Both render to static markup: no DOM, no browser. A focus trap, an effect or a
 * `scrollIntoView` cannot be tested this way, which is why logic belongs in `lib/`.
 */

/** The locale is a module singleton, so every test that changes it restores it. */
afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

/**
 * A named dialog, in two steps: the attributes have to sit on the PANEL — as three separate
 * substring checks this passes with them moved onto the backdrop's wrapper — and the name has to
 * RESOLVE, which neither a visual check nor the match alone would show.
 */
function expectNamedDialog(markup) {
  expect(markup).toMatch(
    /class="sheet__panel[^"]*"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="([^"]+)"/,
  )
  const labelledBy = markup.match(/aria-labelledby="([^"]+)"/)[1]
  expect(markup).toContain(`<h2 class="sheet__title" id="${labelledBy}">`)
}

const money = (yen) => `¥${yen}`
const share = (percent) => `${percent}%`

function cat(label, valueYen) {
  return { key: label, label, valueYen }
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
    // The whole list back, identical. A length assertion cannot see the off-by-one it
    // is named after: folding a 6-item list yields 5 kept plus one "Other" bucket,
    // which is still 6 long, so `toHaveLength(MAX_SLICES)` passes either way.
    expect(foldTail(items, 'Other')).toEqual(items)
  })

  it('folds the tail into one bucket past MAX_SLICES', () => {
    const items = Array.from({ length: 10 }, (_, i) => cat(`c${i}`, 10))
    const folded = foldTail(items, 'Other')
    expect(folded).toHaveLength(MAX_SLICES)
    expect(folded[MAX_SLICES - 1].label).toBe('Other')
    // The five folded categories at 10 each.
    expect(folded[MAX_SLICES - 1].valueYen).toBe(50)
  })

  it('conserves the total when folding', () => {
    const items = Array.from({ length: 9 }, (_, i) => cat(`c${i}`, i + 1))
    const before = items.reduce((sum, item) => sum + item.valueYen, 0)
    const after = foldTail(items, 'Other').reduce((sum, item) => sum + item.valueYen, 0)
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

describe('entry form', () => {
  const draft = (entry, mode = 'add') => ({
    mode,
    entry: {
      type: ENTRY_TYPE.EXPENSE,
      date: '2026-08-05',
      payer: PERSON.P1,
      amountYen: 0,
      category: '',
      description: '',
      ...entry,
    },
  })

  const render = (cfg, entry, { mode } = {}) =>
    renderToStaticMarkup(
      <EntryFormSheet
        draft={draft(entry, mode)}
        config={{ ...config, ...cfg }}
        me={PERSON.P1}
        onSubmit={noop}
        onDelete={noop}
        onClose={noop}
      />,
    )

  it('orders the fields by how often each is touched', () => {
    // Amount and note are typed every time; the payer, date and split all default to
    // something usually right, and the category to `categories[0]`, which is a guess.
    // Reading order is the whole design of this form, and nothing else can see it.
    const markup = render({ notePresets: ['OK Mart'] }, { payerShare: EVEN_SHARE })
    const MARKERS = {
      amount: 'id="entry-amount"',
      note: 'id="entry-note"',
      category: 'id="entry-category"',
      payer: 'name="payer"',
      date: 'id="entry-date"',
      split: 'name="split"',
    }
    const expected = Object.keys(MARKERS)
    for (const [field, marker] of Object.entries(MARKERS)) {
      expect(markup, `${field} is missing`).toContain(marker)
    }
    // Sorted by where each actually appears, then compared to the intended order, so a
    // failure names the fields that swapped rather than printing two lists of offsets.
    const rendered = [...expected].sort(
      (a, b) => markup.indexOf(MARKERS[a]) - markup.indexOf(MARKERS[b]),
    )
    expect(rendered).toEqual(expected)
  })

  it('takes the whole screen for an expense but not for a settlement', () => {
    // Full screen is a claim about the CONTENT: a settlement drops the note, category
    // and split controls, leaving three fields that do not fill a phone.
    expect(render({}, { payerShare: EVEN_SHARE })).toContain('sheet__panel--full')
    expect(render({}, { type: ENTRY_TYPE.SETTLEMENT, payerShare: 0 })).not.toContain(
      'sheet__panel--full',
    )
  })

  it('is a modal dialog named by its own title', () => {
    expectNamedDialog(render({}, { payerShare: EVEN_SHARE }))
  })

  it('offers each configured note as a datalist option and as a chip', () => {
    const markup = render({ notePresets: ['OK Mart', 'Ozeki'] })
    expect(markup).toContain('id="note-presets"')
    expect(markup).toContain('list="note-presets"')
    for (const shop of ['OK Mart', 'Ozeki']) {
      // The chip specifically: a bare `toContain(shop)` passes on the datalist
      // `<option>` alone, so deleting the whole chip row — the half that exists
      // because a datalist has no affordance on a phone — would go unnoticed.
      expect(markup).toContain(`>${shop}</button>`)
    }
  })

  it('leaves the note a plain text input when nothing is configured', () => {
    expect(render({ notePresets: [] })).not.toContain('note-presets')
  })

  it('lists the configured categories, with the first preselected', () => {
    const markup = render({ categories: ['Groceries', 'Dining'] })
    expect(markup).toContain('<option value="Groceries" selected="">Groceries</option>')
    expect(markup).toContain('<option value="Dining">Dining</option>')
  })

  it('keeps a stored category the config tab no longer lists, and selects it', () => {
    // A `<select>` whose value matches no option renders blank and then silently saves
    // the invisible old value, so editing a row whose category was renamed elsewhere
    // would quietly rewrite it.
    const markup = render({ categories: ['Groceries'] }, { category: 'Retired' })
    expect(markup).toContain('<option value="Retired" selected="">Retired</option>')
    expect(markup).toContain('<option value="Groceries">Groceries</option>')
  })

  it('opens on the even control when the payer’s configured default is even', () => {
    // The custom slider only renders in custom mode.
    expect(render({ defaultSplitP1: 0.5 }, { payerShare: null })).not.toContain('type="range"')
  })

  it('applies each payer’s own default, so 80/20 does not invert when p2 pays', () => {
    // The whole point of the per-person setting: p1 bears 80% of what p1 paid,
    // p2 bears 20% of what p2 paid. One universal number cannot express that.
    const cfg = { defaultSplitP1: 0.8, defaultSplitP2: 0.2 }
    const asP1 = render(cfg, { payer: PERSON.P1, payerShare: null })
    expect(asP1).toContain('type="range"')
    expect(asP1).toContain('80%')
    expect(render(cfg, { payer: PERSON.P2, payerShare: null })).toContain('20%')
  })

  it('shows a saved entry’s own share rather than the payer’s default', () => {
    // Editing an existing row must not silently re-split it.
    expect(render({ defaultSplitP1: 0.8 }, { payerShare: 0.35 })).toContain('35%')
  })

  /**
   * The breakdown under the split control, which `SplitField` derives from the amount for both
   * forms. Nothing asserted it before, so the two derivations it replaced could have disagreed
   * about who owes what — the one thing in this form that is money rather than a label.
   */
  it('states who owes what, in whole yen that add back up to the amount', () => {
    // 4211 is odd on purpose: the payer's half is rounded half-up and the other person takes
    // what is left, so these must be 2106 and 2105 — never a rounded 2105.5 printed twice,
    // which is the shape that invents or loses a yen on screen.
    expect(render({}, { amountYen: 4211, payerShare: 0.5 })).toContain('You: ¥2,106 · Sam: ¥2,105')
  })

  it('states nothing until there is an amount to divide', () => {
    // The state this form opens in. "¥0 · ¥0" would be a claim about money nobody has typed.
    expect(render({}, { amountYen: 0 })).not.toContain('¥0')
  })

  it('drops the note, the category AND the split from a settlement, and says why', () => {
    // The three controls a settlement sheds now sit either side of the payer and date
    // controls, so the form carries two `!isSettlement` blocks. Leaving a field in the
    // wrong one is invisible unless all three are named — and `type="range"` alone is
    // no test of the split, since an even split renders no slider either.
    const markup = render(
      { notePresets: ['OK Mart'] },
      { type: ENTRY_TYPE.SETTLEMENT, payerShare: 0 },
    )
    expect(markup).not.toContain('entry-note')
    expect(markup).not.toContain('entry-category')
    expect(markup).not.toContain('name="split"')
    // The payer control stays, and its hint is what explains the row. "You" because
    // this device is p1, which is `usePeopleLabels`' whole job.
    expect(markup).toContain('name="payer"')
    expect(markup).toContain('Records that You paid Sam back.')
  })

  it('offers a plain numeric keypad, because the yen has no sub-unit', () => {
    // A decimal point on the pad would invite an amount 100x wrong, and there is no
    // fractional yen to type into it.
    const markup = render()
    expect(markup).toContain('inputMode="numeric"')
    expect(markup).not.toContain('inputMode="decimal"')
    expect(markup).toContain('placeholder="0"')
  })

  it('offers delete only when there is a saved row to delete', () => {
    expect(render({}, {}, { mode: 'edit' })).toContain('Delete this entry')
    expect(render({}, {}, { mode: 'add' })).not.toContain('Delete this entry')
  })

  it('points the footer’s submit button at the form it sits outside of', () => {
    // Save is in the sheet's footer, a sibling of the <form>, so this attribute pair
    // is the whole association. Break it and Save silently does nothing.
    const markup = render({})
    expect(markup).toContain('<form id="entry-form"')
    expect(markup).toContain('type="submit" form="entry-form"')
  })
})

/**
 * The recurring form's field order, which is a DECISION and a different one from the entry
 * form's: a template is filled in once and then read in a list, so the name leads because it
 * is the only thing naming the row on screen, where the entry form leads with the amount
 * because that is what gets typed every single time.
 */
describe('recurring form', () => {
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

  it('orders the fields by what identifies the cost', () => {
    const markup = render()
    const MARKERS = {
      name: 'id="template-name"',
      amount: 'id="template-amount"',
      category: 'id="template-category"',
      payer: 'name="template-payer"',
      day: 'id="template-day"',
      split: 'name="split"',
    }
    const expected = Object.keys(MARKERS)
    for (const [field, marker] of Object.entries(MARKERS)) {
      expect(markup, `${field} is missing`).toContain(marker)
    }
    // Sorted by where each actually appears, so a failure names the fields that swapped.
    const rendered = [...expected].sort(
      (a, b) => markup.indexOf(MARKERS[a]) - markup.indexOf(MARKERS[b]),
    )
    expect(rendered).toEqual(expected)
  })

  it('takes the whole screen, like the entry form', () => {
    expect(render()).toContain('sheet__panel--full')
  })

  it('keeps the day inside the 1-31 a month can name', () => {
    // The validator refuses the rest; a native min/max is what stops it being typed.
    const markup = render()
    expect(markup).toContain('min="1"')
    expect(markup).toContain('max="31"')
  })

  it('is a modal dialog named by its own title', () => {
    expectNamedDialog(render())
  })

  it('states who owes what, from the template’s own amount and share', () => {
    // The same control and the same derivation the entry form uses, which is the point: a
    // second one is how a template's figures and an entry's come to disagree.
    const template = { ...newTemplate(PERSON.P1), amountYen: 220000, payerShare: 0.8 }
    expect(render({ draft: { mode: 'edit', template } })).toContain('You: ¥176,000 · Sam: ¥44,000')
  })

  /**
   * Default mode saves a BLANK share, so there is no share to divide by. Printing the config
   * tab's current split here would read as the figures this cost saves, which is exactly what
   * that mode does not do.
   */
  it('states no figures in Default mode, where the share is deliberately blank', () => {
    const template = { ...newTemplate(PERSON.P1), amountYen: 5000, payerShare: null }
    const markup = render({ draft: { mode: 'edit', template } })
    expect(markup).toContain('name="split" checked="" value="default"')
    expect(markup).not.toContain('¥2,500')
  })

  it('always offers the stored category, even when the config tab dropped it', () => {
    // The same money bug `CategoryField` exists to hold in ONE place: a `<select>` whose
    // value matches no option renders blank and then saves the invisible old value.
    const stale = { ...newTemplate(PERSON.P1), category: 'Renamed' }
    const markup = render({ draft: { mode: 'edit', template: stale } })
    expect(markup).toContain('<option value="Renamed" selected="">Renamed</option>')
  })
})

describe('delete confirmation', () => {
  // ¥1,250 and the note are what the assertions below read, so they stay here; the
  // rest of a valid expense comes from the shared fixture.
  const target = expense({ id: 'x', amountYen: 1250, description: 'Ozeki' })

  const render = (entry) =>
    renderToStaticMarkup(<ConfirmDeleteSheet entry={entry} onConfirm={noop} onClose={noop} />)

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

/**
 * The generic destructive dialog, which both confirmations now go through. Cancel first in the
 * DOM is the rule that matters and the one nothing else can see: `BottomSheet` focuses the
 * first control it finds, so on a destructive dialog that has to be the way out.
 */
describe('confirm dialog', () => {
  const render = (props) =>
    renderToStaticMarkup(
      <ConfirmSheet
        title="Delete this?"
        body="It cannot be undone."
        onConfirm={noop}
        onClose={noop}
        {...props}
      />,
    )

  it('puts Cancel before the destructive button in the DOM', () => {
    const markup = render()
    expect(markup.indexOf('Cancel')).toBeLessThan(markup.indexOf('btn--danger'))
  })

  it('is content-sized, never full screen', () => {
    // `full` is a claim about the CONTENT: one sentence in a full-screen panel is 600px of
    // white asking whether to delete a ¥480 coffee.
    expect(render()).not.toContain('sheet__panel--full')
  })

  it('says what the caller gave it, including a custom confirm label', () => {
    const markup = render({ body: 'Rent goes for good.', confirmLabel: 'Delete for good' })
    expect(markup).toContain('Rent goes for good.')
    expect(markup).toContain('Delete for good')
  })
})

describe('deleted entries list', () => {
  const removed = (id, overrides) => tombstone({ id, amountYen: 1250, ...overrides })

  const render = (entries) =>
    renderToStaticMarkup(
      <DeletedList
        entries={entries}
        config={config}
        me={PERSON.P1}

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
    const markup = render([
      removed('a', { description: 'Ozeki' }),
      removed('b', { description: 'Life' }),
    ])
    expect(markup.match(/Restore/g).length).toBeGreaterThanOrEqual(2)
    expect(markup).toContain('aria-label="Restore Ozeki"')
    expect(markup).toContain('aria-label="Restore Life"')
  })

  it('dims a row whose write has not landed yet', () => {
    expect(render([{ ...removed('a'), pending: true }])).toContain('entry--pending')
  })

  /**
   * A tombstoned settlement is the same fact as a live one, and it used to lose all three of
   * the things that say so — the icon, the `entry--settlement` class and the direction. What it
   * read as instead was an expense the payer had bought something with, which is the one row
   * where dropping the direction reverses the meaning of what the Restore beside it will do.
   */
  it('keeps a settlement recognisable as one after it is deleted', () => {
    const markup = render([
      removed('s', { type: ENTRY_TYPE.SETTLEMENT, payerShare: 0, description: '' }),
    ])

    expect(markup).toContain('entry--settlement')
    // The direction, both names, in order — never just "You paid", which is what an expense
    // row says. `label` is viewer-relative, so p1 reads as "You" for whoever is holding it.
    expect(markup).toContain('You paid Sam')
  })
})

describe('Japanese rendering', () => {
  // Two payers and one deleted row, because the strings under test are one per
  // component: the balance direction needs a debtor, the summary needs both people's
  // spend, and the deleted list needs a tombstone. ¥1,250 is what the yen assertions
  // read, and the 800 is `payerShare: 1` so the two are not mirror images.
  const entries = [
    expense({ id: 'a', amountYen: 1250 }),
    expense({ id: 'b', amountYen: 800, payer: PERSON.P2, category: 'Dining', payerShare: 1 }),
  ]

  const removed = tombstone({ id: 'c', amountYen: 640, payer: PERSON.P2, category: 'Dining' })

  function renderAll() {
    const balance = computeBalance(entries)
    return [
      renderToStaticMarkup(
        <Header
          balance={balance}
          config={config}
          me={PERSON.P1}

          onRefresh={noop}
          onOpenSettings={noop}
        />,
      ),
      renderToStaticMarkup(
        <SummaryCard
          monthSpend={totalSpend(entries)}
          byCategory={spendByCategory(entries)}
          byPerson={spendByPerson(entries)}
          byShare={shareByPerson(entries)}
          config={config}
          me={PERSON.P1}
        />,
      ),
      renderToStaticMarkup(
        <EntryList
          groups={groupByDate(entries)}
          config={config}
          me={PERSON.P1}

          onEdit={noop}
          onDelete={noop}
        />,
      ),
      renderToStaticMarkup(
        <DeletedList
          entries={[removed]}
          config={config}
          me={PERSON.P1}

          onRestore={noop}
        />,
      ),
      renderToStaticMarkup(<ConfirmDeleteSheet entry={removed} onConfirm={noop} onClose={noop} />),
    ].join('')
  }

  it('renders the whole app surface in Japanese, differently from English', () => {
    const english = renderAll()
    setLocale('ja')
    const japanese = renderAll()

    expect(japanese).not.toBe(english)
    // The balance's direction, the month eyebrow and the chart's — one string from
    // each of the three components, so dropping any of them fails here.
    expect(japanese).toContain('から受け取り')
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
