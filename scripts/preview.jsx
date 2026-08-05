/**
 * Throwaway visual harness: renders the signed-in app surface to a static HTML
 * file with the real stylesheets, so it can be screenshotted at phone and
 * desktop widths. Not part of the build or the test suite.
 *
 *   npx vite-node scripts/preview.jsx
 */
import { writeFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

import { DEFAULT_CONFIG } from '../src/config.js'
import { setLocale } from '../src/i18n/index.js'
import { ENTRY_TYPE, EVEN_SHARE, PERSON, makeEntry } from '../src/schema.js'
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

function body() {
  const balance = computeBalance(entries)
  const monthEntries = entries
  const noop = () => {}

  return renderToStaticMarkup(
    <div className="app">
      <Header config={config} me={PERSON.P1} status="ready" onRefresh={noop} onOpenSettings={noop} />
      <main className="layout">
        <aside className="layout__aside">
          <BalanceCard
            balance={balance}
            config={config}
            me={PERSON.P1}
            currency="JPY"
            onSettle={noop}
          />
          <SummaryCard
            monthSpend={totalSpend(monthEntries)}
            byCategory={spendByCategory(monthEntries)}
            byPerson={spendByPerson(monthEntries)}
            config={config}
            me={PERSON.P1}
            currency="JPY"
          />
        </aside>
        <section className="layout__main">
          <MonthNav monthKey="2026-08" onChange={noop} />
          <EntryList
            groups={groupByDate(monthEntries)}
            config={config}
            me={PERSON.P1}
            currency="JPY"
            status="ready"
            onEdit={noop}
            onDelete={noop}
            onAdd={noop}
          />
        </section>
      </main>
      <button type="button" className="fab" aria-label="Add">
        <PlusIcon width={24} height={24} />
      </button>
    </div>,
  )
}

function page(markup, lang) {
  return `<!doctype html>
<html lang="${lang}">
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

writeFileSync(new URL('./preview-en.html', import.meta.url), page(body(), 'en'))
setLocale('ja')
writeFileSync(new URL('./preview-ja.html', import.meta.url), page(body(), 'ja'))
console.log('wrote scripts/preview-en.html and scripts/preview-ja.html')
