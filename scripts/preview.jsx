/**
 * Visual harness: the signed-in surface rendered to static HTML with the real stylesheets, for
 * screenshotting at phone and desktop widths. A green suite says nothing about whether the page
 * looks right — a chart rendering white-on-white passes every assertion in it. The surface is
 * the app's own `LedgerScreen`, so this cannot drift from what `App` renders.
 *
 *   npx vite-node scripts/preview.jsx
 */
import { writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

import { DEFAULT_CONFIG } from '../src/config.js'
import { setLocale, t } from '../src/i18n/index.js'
import {
  ENTRY_TYPE,
  EVEN_SHARE,
  PERSON,
  RECURRING,
  makeEntry,
  rowToTemplate,
} from '../src/schema.js'
import { ACCENTS } from '../src/lib/theme.js'
import { newTemplate } from '../src/lib/recurring.js'
import {
  computeBalance,
  monthSections,
  shareByPerson,
  spendByCategory,
  spendByPerson,
  totalSpend,
} from '../src/lib/balance.js'
import { LedgerScreen } from '../src/components/LedgerScreen.jsx'
import { ConfirmDeleteSheet } from '../src/components/ConfirmDeleteSheet.jsx'
import { EntryFormSheet } from '../src/components/EntryFormSheet.jsx'
import { SettingsSheet } from '../src/components/SettingsSheet.jsx'
import { summaryView } from '../src/components/SummaryCard.jsx'
import { RecurringSheet } from '../src/components/RecurringSheet.jsx'
import { TemplateFormSheet } from '../src/components/TemplateFormSheet.jsx'

const config = {
  ...DEFAULT_CONFIG,
  person1Name: 'Waylon',
  person2Name: 'Yuki',
  categories: ['食費', '外食', '日用品', '交通費', '娯楽', 'その他'],
}

const raw = [
  // Two recurring instances, at the ids the `templates` below mint — so the fixed-costs section
  // is the app's own reading of an id, and two rows is what puts a hairline between them. Modest
  // figures on purpose: rent's ¥220,000 takes 84% of the ring and leaves the palette slivers.
  ['gas#2026-08', '2026-08-10', PERSON.P2, 7200, '日用品', 'ガス・水道', EVEN_SHARE],
  ['gym#2026-08', '2026-08-01', PERSON.P2, 8000, '娯楽', 'ジムの会費', EVEN_SHARE],
  ['a', '2026-08-05', PERSON.P1, 4820, '食費', 'いつもの買い物', EVEN_SHARE],
  ['b', '2026-08-05', PERSON.P2, 1280, '外食', 'ラーメン', EVEN_SHARE],
  ['c', '2026-08-04', PERSON.P1, 12400, '日用品', '洗剤とティッシュ', EVEN_SHARE],
  ['d', '2026-08-04', PERSON.P2, 680, '交通費', '', 1],
  ['e', '2026-08-02', PERSON.P1, 3150, '娯楽', '映画', 0],
  ['f', '2026-08-01', PERSON.P2, 9800, '食費', '週末のまとめ買い', EVEN_SHARE],
  ['g', '2026-08-01', PERSON.P1, 450, 'その他', '', EVEN_SHARE],
]

const entries = raw.map(([id, date, payer, amountYen, category, description, payerShare]) =>
  makeEntry({
    id,
    type: ENTRY_TYPE.EXPENSE,
    date,
    payer,
    amountYen,
    category,
    description,
    payerShare,
  }),
)

/** Two tombstones, in the month being previewed, since the section is scoped to it. */
const deleted = [
  ['x', '2026-08-03', PERSON.P2, 2200, '外食', 'まちがえて二重に登録'],
  ['y', '2026-08-01', PERSON.P1, 780, '日用品', ''],
].map(([id, date, payer, amountYen, category, description]) =>
  makeEntry({
    id,
    type: ENTRY_TYPE.EXPENSE,
    date,
    payer,
    amountYen,
    category,
    description,
    payerShare: EVEN_SHARE,
    deletedAt: `${date}T12:00:00.000Z`,
  }),
)

const noop = () => {}

/**
 * Four recurring costs, one per row state, built from `recurring` rows through the app's own
 * decoder so the page renders what a real tab produces.
 */
const templates = [
  ['rent', '家賃', '220000', 'Rent', 'p1', '80', '27'],
  ['gas', 'ガス・水道', '', '日用品', 'p2', '', '10'],
  ['gym', 'ジムの会費', '8000', '娯楽', 'p2', '50', '1'],
  ['old', '前のアパートの家賃', '180000', 'Rent', 'p1', '80', '27', '2026-05'],
].map(([id, description, amount, category, payer, payer_share, day_of_month, active_to]) =>
  rowToTemplate(
    RECURRING.columns.map(
      (column) =>
        ({ id, description, amount, category, payer, payer_share, day_of_month, active_to })[
          column
        ] ?? '',
    ),
  ),
)

// The same shape `useLedgerView` hands the screen, built here because the hook needs a renderer.
// The figures come from `balance.js`, so they are the app's own arithmetic; one builder, so a new
// page cannot forget a field.
const viewOf = (list, tombstones = []) => ({
  balance: computeBalance(list),
  monthSpend: totalSpend(list),
  byCategory: spendByCategory(list),
  byPerson: spendByPerson(list),
  byShare: shareByPerson(list),
  ...monthSections(list),
  deleted: tombstones,
})

const baseView = viewOf(entries, deleted)

/** `overlay` puts one of the sheets over the surface, which is how each of them ships. */
function body(overlay, { view = baseView, config: pageConfig = config } = {}) {
  return renderToStaticMarkup(
    <div className="app">
      <LedgerScreen
        config={pageConfig}
        me={PERSON.P1}
        view={view}
        monthKey="2026-08"
        notices={[t('warning.configMissing')]}
        refreshing={false}
        onRefresh={noop}
        onOpenSettings={noop}
        onMonthChange={noop}
        onEdit={noop}
        onDelete={noop}
        onRestore={noop}
        onAdd={noop}
      />
      {overlay}
    </div>,
  )
}

// Settled changes the header's whole shape: one line where there are normally two, and no figure.
// Reached by settling exactly the outstanding balance, so the zero is the app's own arithmetic.
const settledEntries = [
  ...entries,
  makeEntry({
    id: 'z',
    type: ENTRY_TYPE.SETTLEMENT,
    date: '2026-08-06',
    payer: baseView.balance.debtor,
    amountYen: baseView.balance.amountYen,
    category: '',
    payerShare: 0,
  }),
]

const settledView = viewOf(settledEntries, deleted)

// Everything a config tab and a note field can legitimately hold that a 320px phone has no room
// for. The layout has to absorb it without a horizontal scrollbar or a clipped glyph, which is
// the one thing no assertion in the suite can check.
const stressConfig = {
  ...config,
  person1Name: 'Bartholomew',
  person2Name: 'Wolfeschlegelstein',
  categories: ['Groceries and household supplies', '公共料金と光熱費の支払い', 'Other'],
  notePresets: ['Supermarket on the corner', 'コンビニエンスストア', 'Pharmacy'],
}

const stressEntries = [
  makeEntry({
    id: 's1',
    type: ENTRY_TYPE.EXPENSE,
    date: '2026-08-05',
    payer: PERSON.P1,
    amountYen: 123456789,
    category: 'Groceries and household supplies',
    description: 'Weekly shop plus the birthday things we said we would split evenly',
    payerShare: 0.7,
  }),
  makeEntry({
    id: 's2',
    type: ENTRY_TYPE.SETTLEMENT,
    date: '2026-08-04',
    payer: PERSON.P2,
    amountYen: 9876543,
    category: '',
    payerShare: 0,
  }),
  /* The fixed-costs band under the same stress: its title carries an icon, so it has less room
     for a section total than a day label does. */
  makeEntry({
    id: 'monthly-standing-order#2026-08',
    type: ENTRY_TYPE.EXPENSE,
    date: '2026-08-27',
    payer: PERSON.P1,
    amountYen: 98765432,
    category: '公共料金と光熱費の支払い',
    description: 'Rent for the apartment plus the parking space we agreed to split unevenly',
    payerShare: 0.8,
  }),
]

const stressView = viewOf(stressEntries)

/** One builder per sheet, so a stress page cannot drift from the page it stresses. */
const entryForm = (entry, pageConfig) => (
  <EntryFormSheet
    draft={{ mode: 'edit', entry }}
    config={pageConfig}
    me={PERSON.P1}
    onSubmit={noop}
    onDelete={noop}
    onClose={noop}
  />
)

const settingsSheet = (pageConfig) => (
  <SettingsSheet
    config={pageConfig}
    me={PERSON.P1}
    spreadsheetId="preview-sheet-id"
    tombstoneCount={2}
    onSetMe={noop}
    onCompact={noop}
    onForget={noop}
    onClose={noop}
  />
)

const recurringSheet = (pageConfig, props) => (
  <RecurringSheet
    templates={templates}
    /* One month already recorded, so the "recorded" row is the app's own reading of an
       instance id rather than a hand-set flag. */
    entries={[
      makeEntry({
        id: 'gym#2026-08',
        type: ENTRY_TYPE.EXPENSE,
        date: '2026-08-01',
        payer: PERSON.P2,
        amountYen: 8000,
        category: '娯楽',
        payerShare: EVEN_SHARE,
      }),
    ]}
    config={pageConfig}
    me={PERSON.P1}
    monthKey="2026-08"
    loaded
    undecodedTemplates={1}
    spreadsheetId="preview-sheet-id"
    onAdd={noop}
    onEdit={noop}
    onRecord={noop}
    onClose={noop}
    {...props}
  />
)

const templateForm = (template, pageConfig, mode = 'edit') => (
  <TemplateFormSheet
    draft={{ mode, template }}
    config={pageConfig}
    me={PERSON.P1}
    onSubmit={noop}
    onRetire={noop}
    onRestore={noop}
    onDelete={noop}
    onClose={noop}
  />
)

const OVERLAYS = {
  confirm: <ConfirmDeleteSheet entry={entries[0]} onConfirm={noop} onClose={noop} />,
  form: entryForm(
    { ...entries[0], payerShare: 0.7 },
    {
      ...config,
      notePresets: ['オーケー', 'Ozeki', 'Life'],
    },
  ),
  /* The sparsest thing the entry form renders, and the only page where its two
     `!isSettlement` blocks — which sit either side of the payer and date controls — show. */
  settlement: entryForm({ ...entries[0], type: ENTRY_TYPE.SETTLEMENT, payerShare: 0 }, config),
  settings: settingsSheet(config),
  /* The only page where the four recurring row states are visible at once. */
  recurring: recurringSheet(config),
  template: templateForm(templates[0], config),
}

// `OVERLAYS.form` uses the short-named config, and the form holds config text where the settings
// sheet does not: the split slider's label is the payer's own name in the possessive, in a grid
// whose other track is sized to its content, where `overflow-x: hidden` would CLIP the overflow.
const STRESS_FORM = entryForm({ ...stressEntries[0], payerShare: 0.7 }, stressConfig)
const STRESS_SETTINGS = settingsSheet(stressConfig)
// The recurring page holding what a hand-authored tab can: a name with no break opportunity and
// an eight-figure amount, in a row whose name must stay readable in full. `.sheet__body`'s
// `overflow-x: hidden` CLIPS rather than reports, so the harness measures its own scroll width.
const STRESS_RECURRING = recurringSheet(stressConfig, {
  /* A month nobody has reached, so every row is recordable but not yet due — which puts the
     WIDER of the two record labels next to the widest name the tab can hold. */
  monthKey: '2099-08',
  templates: [
    rowToTemplate(
      RECURRING.columns.map(
        (column) =>
          ({
            id: 'stress',
            description: 'Groceries and household supplies for the whole month, split evenly',
            amount: '123456789',
            category: 'Groceries and household supplies',
            payer: 'p1',
            payer_share: '70',
            day_of_month: '1',
          })[column] ?? '',
      ),
    ),
  ],
  entries: [],
})

function page(markup, lang, accent) {
  return `<!doctype html>
<html lang="${lang}"${accent === ACCENTS[0] ? '' : ` data-accent="${accent}"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="../src/styles/tokens.css">
<link rel="stylesheet" href="../src/styles/base.css">
<link rel="stylesheet" href="../src/styles/primitives.css">
<link rel="stylesheet" href="../src/styles/app.css">
<title>preview</title>
</head>
<body>${markup}</body>
</html>`
}

const written = []
for (const [locale, accents] of [
  // Every accent in English, since the palette is what is checked; the Japanese pass is about
  // wrapping and line height, so one accent is enough.
  ['en', ACCENTS],
  ['ja', [ACCENTS[0]]],
]) {
  setLocale(locale)
  for (const accent of accents) {
    const name =
      accent === ACCENTS[0] ? `preview-${locale}.html` : `preview-${locale}-${accent}.html`
    writeFileSync(new URL(`./${name}`, import.meta.url), page(body(), locale, accent))
    written.push(`scripts/${name}`)
  }
  // Each overlay in both languages: they cover the surface and hold the longest sentences.
  for (const [variant, overlay] of Object.entries(OVERLAYS)) {
    const name = `preview-${locale}-${variant}.html`
    writeFileSync(new URL(`./${name}`, import.meta.url), page(body(overlay), locale, ACCENTS[0]))
    written.push(`scripts/${name}`)
  }
}

// The widths nothing else exercises, in English only: what is being read is the geometry.
setLocale('en')
const stress = { view: stressView, config: stressConfig }
for (const [variant, overlay, options] of [
  ['stress', null, stress],
  ['stress-settings', STRESS_SETTINGS, stress],
  ['stress-form', STRESS_FORM, stress],
  ['stress-recurring', STRESS_RECURRING, stress],
  ['recurring-add', templateForm(newTemplate(PERSON.P1), config, 'add'), {}],
  ['settled', null, { view: settledView }],
]) {
  const name = `preview-en-${variant}.html`
  const markup = page(body(overlay, options), 'en', ACCENTS[0])
  writeFileSync(new URL(`./${name}`, import.meta.url), markup)
  written.push(`scripts/${name}`)
}
// A stored preference rather than component state, so the harness can flip the summary's other
// per-person view — which is the whole reason it is one.
summaryView.set('paid')
for (const [variant, options] of [
  ['paid-view', {}],
  ['stress-paid-view', stress],
]) {
  const name = `preview-en-${variant}.html`
  writeFileSync(new URL(`./${name}`, import.meta.url), page(body(null, options), 'en', ACCENTS[0]))
  written.push(`scripts/${name}`)
}
summaryView.set('share')

console.log(`wrote ${written.join(', ')}`)
