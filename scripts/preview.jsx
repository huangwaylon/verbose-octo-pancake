/**
 * Visual harness: renders the signed-in app surface to static HTML with the real
 * stylesheets, so it can be screenshotted at phone and desktop widths. A green
 * test suite says nothing about whether the page looks right — the donut chart
 * once shipped white-on-white with every test passing.
 *
 * One file per locale, and each carries every accent preset as a query-free
 * variant so a color change can be eyeballed across all five.
 *
 *   npx vite-node scripts/preview.jsx
 */
import { writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

import { DEFAULT_CONFIG } from '../src/config.js'
import { setLocale, t } from '../src/i18n/index.js'
import { ENTRY_TYPE, EVEN_SHARE, PERSON, makeEntry } from '../src/schema.js'
import { ACCENTS } from '../src/lib/theme.js'
import {
  computeBalance,
  groupByDate,
  spendByCategory,
  spendByPerson,
  totalSpend,
} from '../src/lib/balance.js'
import { Header } from '../src/components/Header.jsx'
import { BalanceCard } from '../src/components/BalanceCard.jsx'
import { SummaryCard } from '../src/components/SummaryCard.jsx'
import { MonthNav } from '../src/components/MonthNav.jsx'
import { EntryList } from '../src/components/EntryList.jsx'
import { DeletedList } from '../src/components/DeletedList.jsx'
import { ConfirmDeleteSheet } from '../src/components/ConfirmDeleteSheet.jsx'
import { PlusIcon } from '../src/components/icons.jsx'

const config = {
  ...DEFAULT_CONFIG,
  person1Name: 'Waylon',
  person2Name: 'Yuki',
  currency: 'JPY',
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

const entries = raw.map(([id, date, payer, amountCents, category, description, payerShare]) =>
  makeEntry(
    {
      id,
      type: ENTRY_TYPE.EXPENSE,
      date,
      payer,
      amountCents,
      currency: 'JPY',
      category,
      description,
      payerShare,
    },
    `${date}T10:00:00.000Z`,
  ),
)

/** Two tombstones, in the month being previewed, since the section is scoped to it. */
const deleted = [
  ['x', '2026-08-03', PERSON.P2, 2200, '外食', 'まちがえて二重に登録'],
  ['y', '2026-08-01', PERSON.P1, 780, '日用品', ''],
].map(([id, date, payer, amountCents, category, description]) =>
  makeEntry(
    {
      id,
      type: ENTRY_TYPE.EXPENSE,
      date,
      payer,
      amountCents,
      currency: 'JPY',
      category,
      description,
      payerShare: EVEN_SHARE,
      deletedAt: `${date}T12:00:00.000Z`,
    },
    `${date}T10:00:00.000Z`,
  ),
)

/** `confirming` renders the delete dialog over the surface, which is how it ships. */
function body(confirming) {
  const balance = computeBalance(entries)
  const noop = () => {}

  return renderToStaticMarkup(
    <div className="app">
      <Header config={config} me={PERSON.P1} onRefresh={noop} onOpenSettings={noop} />
      <main className="layout">
        <aside className="layout__aside">
          <BalanceCard balance={balance} config={config} me={PERSON.P1} currency="JPY" />
          <SummaryCard
            monthSpend={totalSpend(entries)}
            byCategory={spendByCategory(entries)}
            byPerson={spendByPerson(entries)}
            config={config}
            me={PERSON.P1}
            currency="JPY"
          />
        </aside>
        <section className="layout__main">
          <MonthNav monthKey="2026-08" onChange={noop} />
          <EntryList
            groups={groupByDate(entries)}
            config={config}
            me={PERSON.P1}
            currency="JPY"
            onEdit={noop}
            onDelete={noop}
            onAdd={noop}
          />
          <DeletedList
            entries={deleted}
            config={config}
            me={PERSON.P1}
            currency="JPY"
            onRestore={noop}
          />
        </section>
      </main>
      <button type="button" className="fab" aria-label={t('list.emptyAction')}>
        <PlusIcon width={24} height={24} />
      </button>
      {confirming && (
        <ConfirmDeleteSheet
          entry={confirming}
          currency="JPY"
          onConfirm={noop}
          onClose={noop}
        />
      )}
    </div>,
  )
}

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
    const name = accent === ACCENTS[0] ? `preview-${locale}.html` : `preview-${locale}-${accent}.html`
    writeFileSync(new URL(`./${name}`, import.meta.url), page(body(), locale, accent))
    written.push(`scripts/${name}`)
  }
  // Its own page in both languages: the dialog covers the surface it sits on,
  // and its copy is the longest sentence in either catalog.
  const name = `preview-${locale}-confirm.html`
  writeFileSync(
    new URL(`./${name}`, import.meta.url),
    page(body(entries[0]), locale, ACCENTS[0]),
  )
  written.push(`scripts/${name}`)
}
console.log(`wrote ${written.join(', ')}`)
