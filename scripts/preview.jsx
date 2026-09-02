/**
 * Visual harness: renders the signed-in app surface to static HTML with the real
 * stylesheets, so it can be screenshotted at phone and desktop widths. A green
 * test suite says nothing about whether the page looks right: a chart rendering
 * white-on-white passes every assertion in the suite.
 *
 * One file per locale, each accent as its own variant so a colour change can be
 * eyeballed across all five, and one page per overlay — the delete dialog, the entry
 * form, the settlement form and the settings sheet — because those are what a small
 * phone has least room for.
 *
 * The surface is the app's own `LedgerScreen`, so this harness cannot drift from what
 * `App` renders.
 *
 *   npx vite-node scripts/preview.jsx
 */
import { writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

import { DEFAULT_CONFIG } from '../src/config.js'
import { setLocale, t } from '../src/i18n/index.js'
import { ENTRY_TYPE, EVEN_SHARE, PERSON, RECURRING, makeEntry } from '../src/schema.js'
import { ACCENTS } from '../src/lib/theme.js'
import { newTemplate, rowToTemplate } from '../src/lib/recurring.js'
import {
  computeBalance,
  groupByDate,
  spendByCategory,
  spendByPerson,
  totalSpend,
} from '../src/lib/balance.js'
import { LedgerScreen } from '../src/components/LedgerScreen.jsx'
import { ConfirmDeleteSheet } from '../src/components/ConfirmDeleteSheet.jsx'
import { EntryFormSheet } from '../src/components/EntryFormSheet.jsx'
import { SettingsSheet } from '../src/components/SettingsSheet.jsx'
import { RecurringSheet } from '../src/components/RecurringSheet.jsx'
import { TemplateFormSheet } from '../src/components/TemplateFormSheet.jsx'

const config = {
  ...DEFAULT_CONFIG,
  person1Name: 'Waylon',
  person2Name: 'Yuki',
  categories: ['食費', '外食', '日用品', '交通費', '娯楽', 'その他'],
}

const raw = [
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
 * Four recurring costs covering every state the page's rows can be in: due now, already
 * recorded, not yet due, and retired. Built from `recurring` rows through the app's own
 * decoder, so the page is rendering what a real tab produces — including the ¥220,000 that
 * makes rent the widest thing on the row.
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

/**
 * The same shape `useLedgerView` hands the screen. Built here rather than by calling
 * the hook, which needs a renderer — the figures still come from `balance.js`, so
 * they are the app's own arithmetic and not a fixture pretending to be it. One
 * builder, so a new page cannot forget a field.
 */
const viewOf = (list, tombstones = []) => ({
  balance: computeBalance(list),
  monthSpend: totalSpend(list),
  byCategory: spendByCategory(list),
  byPerson: spendByPerson(list),
  groups: groupByDate(list),
  deleted: tombstones,
})

const baseView = viewOf(entries, deleted)

/**
 * `overlay` puts one of the sheets over the surface, which is how each of them
 * ships. The surface itself is the real `LedgerScreen`, so this cannot drift from
 * what `App` renders.
 */
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

/**
 * Settled changes the header's whole shape: one line where there are normally two,
 * and no figure at all. Reached by settling exactly the outstanding balance, so the
 * zero is the app's own arithmetic rather than a hand-written fixture.
 */
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

/**
 * Everything a config tab and a note field can legitimately hold that a 320px phone
 * has no room for: names with no break opportunity, a category longer than the
 * control it sits in, an amount big enough that the header has to truncate the hero
 * figure, and a note that wraps three times. The layout has to absorb all of it
 * without a horizontal scrollbar or a clipped glyph, which is the one thing no
 * assertion in the suite can check.
 */
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
]

const stressView = viewOf(stressEntries)

/**
 * One builder per sheet, so a stress page cannot drift from the page it stresses:
 * the props are written once and only the entry and the config vary.
 */
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

/**
 * The overlays, each the densest thing on a phone screen in its own way — plus the
 * settlement form, which is the sparsest: it drops the note, category and split
 * controls, which sit either side of the payer and date controls, so it is the one page
 * where getting the form's two conditional blocks wrong is visible.
 */
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
  settlement: entryForm({ ...entries[0], type: ENTRY_TYPE.SETTLEMENT, payerShare: 0 }, config),
  settings: settingsSheet(config),
  /* The page that manages the recurring tab, and its form — the two densest new surfaces,
     and the only place the four row states are visible at once. */
  recurring: recurringSheet(config),
  template: templateForm(templates[0], config),
}

/**
 * The two sheets under the same stress. The form is not covered by `OVERLAYS.form`,
 * which uses the short-named config — and the form holds config text in a place the
 * settings sheet does not: the split slider's label is the payer's own name in the
 * possessive, in a grid whose other track is sized to its content, where
 * `.sheet__body`'s `overflow-x: hidden` would CLIP an overflow rather than report it.
 * The settings sheet is where the config tab's own text has least room to fit.
 */
const STRESS_FORM = entryForm({ ...stressEntries[0], payerShare: 0.7 }, stressConfig)
const STRESS_SETTINGS = settingsSheet(stressConfig)
/**
 * The recurring page holding what a hand-authored tab can: a name with no break
 * opportunity and an eight-figure amount, in a row whose name is the one thing that must
 * stay readable in full. `.sheet__body`'s `overflow-x: hidden` CLIPS rather than reports,
 * so the harness measures that element's own scroll width.
 */
const STRESS_RECURRING = recurringSheet(stressConfig, {
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
  // Every accent in English, since the palette is what is being checked; the
  // Japanese pass is about wrapping and line height, so one accent is enough.
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
  // Each overlay gets its own page in both languages: they cover the surface they
  // sit on, they hold the longest sentences in either catalog, and the form and the
  // settings sheet are the two screens most likely to overflow a small phone.
  for (const [variant, overlay] of Object.entries(OVERLAYS)) {
    const name = `preview-${locale}-${variant}.html`
    writeFileSync(new URL(`./${name}`, import.meta.url), page(body(overlay), locale, ACCENTS[0]))
    written.push(`scripts/${name}`)
  }
}

// The widths nothing else exercises, in English only: what is being read here is the
// geometry, not the copy.
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
console.log(`wrote ${written.join(', ')}`)
