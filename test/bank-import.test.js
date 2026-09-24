import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { EXPENSE_COLUMNS, SETTLEMENT_COLUMNS } from '../src/schema.js'
import { asFields } from './support/entries.js'

/**
 * `scripts/bank_to_ledger.py` — RUN, not read. `test/schema.test.js` parses its column lists out of
 * the source and compares them to the schema's, which is a check on two DECLARATIONS: it cannot see
 * a row emitted in the wrong order, an amount off by 100, or an id that changes between runs. Those
 * are silent in the worst way, because a pasted block looks plausible under the right header.
 *
 * The script takes the bank's own export: a date, the merchant, `JPY`, then money in, money out and
 * the running balance, tab separated.
 */
const row = (date, description, out, balance, note = '') =>
  [date, description, 'JPY', '', String(out), String(balance), note].join('\t')

const STATEMENT = [
  // A rule with a category (Household), so the emitted row carries a real one.
  row('2026年9月1日', 'ダイソー', 1500, 98500),
  // No rule: the documented fallback, a shared "Other".
  row('2026年9月2日', 'ナニカベツノミセ', 2000, 96500),
  // A settlement rule: its own file, its own layout, no category and no share.
  row('2026年9月3日', 'ウメダ アスカ', 40000, 56500),
  // The bank's own decimals, which are never a fraction of a yen.
  row('2026年9月4日', 'IKEA', '1400.000000', 55100),
].join('\n')

const python = (() => {
  for (const candidate of ['python3', 'python']) {
    try {
      const version = execFileSync(candidate, ['--version'], { encoding: 'utf8' })
      const [major, minor] = version
        .replace(/[^\d.]/g, '')
        .split('.')
        .map(Number)
      if (major > 3 || (major === 3 && minor >= 11)) return candidate
    } catch {
      // Not this one.
    }
  }
  return null
})()

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/** Writes `statement` to a fresh temp dir and runs the importer over it. */
function runImporter(statement, args) {
  const dir = mkdtempSync(join(tmpdir(), 'bank-'))
  tempDirs.push(dir)
  const input = join(dir, 'statement.tsv')
  const output = join(dir, 'out.csv')
  writeFileSync(input, `${statement}\n`, 'utf8')
  execFileSync(python, ['scripts/bank_to_ledger.py', input, '-o', output, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return output
}

/** Runs the importer over `STATEMENT` and returns both files as field maps. */
function importStatement(args = []) {
  const output = runImporter(STATEMENT, args)
  const read = (path) => {
    if (!existsSync(path)) return null
    const lines = readFileSync(path, 'utf8').trim().split('\n')
    return { header: lines[0].split(','), rows: lines.slice(1).map((line) => line.split(',')) }
  }
  return { expenses: read(output), settlements: read(output.replace(/\.csv$/, '.settlements.csv')) }
}

// The script pins `requires-python = ">=3.11"`. This is the only thing in the repo that executes
// it, so CI must fail rather than skip; a machine without one says so rather than report a pass.
if (!python && process.env.CI) throw new Error('bank_to_ledger: CI needs python >= 3.11')
const when = python ? describe : describe.skip
if (!python) console.warn('bank_to_ledger: no python >= 3.11 found, skipping')

when('the bank importer', () => {
  // Each distinct import runs once: spawning Python dominates this file's time.
  let imported, reimported, headerless
  beforeAll(() => {
    imported = importStatement()
    reimported = importStatement()
    headerless = runImporter(STATEMENT, ['--no-header'])
  })

  it('emits every value under its own heading, in the schema’s order', () => {
    const { expenses } = imported

    expect(expenses.header).toEqual(EXPENSE_COLUMNS)
    const first = asFields(expenses.rows[0], EXPENSE_COLUMNS)
    expect(first).toMatchObject({
      date: '2026-09-01',
      // Never translated or rewritten, so the row is findable in the statement.
      description: 'ダイソー',
      amount: '1500',
      category: 'Household',
      payer_share: '0.8',
      deleted_at: '',
    })
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('writes whole yen, so the bank’s own decimals are not a 100x error', () => {
    const { expenses } = imported
    const amounts = expenses.rows.map((cells) => asFields(cells, EXPENSE_COLUMNS).amount)

    // '1400.000000' in the statement: ¥1400, not ¥140000 and not '1400.0'.
    expect(amounts).toContain('1400')
    for (const amount of amounts) expect(amount).toMatch(/^\d+$/)
  })

  it('files an unmatched merchant as a shared Other rather than dropping it', () => {
    const { expenses } = imported
    const unmatched = expenses.rows
      .map((cells) => asFields(cells, EXPENSE_COLUMNS))
      .find((fields) => fields.description === 'ナニカベツノミセ')

    expect(unmatched.category).toBe('Other')
  })

  it('sends a settlement to its own file, at its own layout', () => {
    const { expenses, settlements } = imported

    expect(settlements.header).toEqual(SETTLEMENT_COLUMNS)
    expect(settlements.rows).toHaveLength(1)
    expect(asFields(settlements.rows[0], SETTLEMENT_COLUMNS)).toMatchObject({
      date: '2026-09-03',
      amount: '40000',
      payer: 'p1',
      deleted_at: '',
    })
    // And never into the expenses file, where it would count as spending.
    for (const cells of expenses.rows) {
      expect(asFields(cells, EXPENSE_COLUMNS).amount).not.toBe('40000')
    }
  })

  it('mints the same ids for the same statement, so a re-import reconciles', () => {
    // `uuid5` over the row's own values rather than `uuid4`: two people re-paste an overlapping
    // export, and `reconcileById` can only collapse rows that share an id.
    const idsOf = ({ expenses }) =>
      expenses.rows.map((cells) => asFields(cells, EXPENSE_COLUMNS).id)

    expect(idsOf(reimported)).toEqual(idsOf(imported))
  })

  it('leaves out the header row when asked, since the sheet already has one', () => {
    const first = readFileSync(headerless, 'utf8').trim().split('\n')[0].split(',')
    expect(first[0]).toBe('2026-09-01')
  })

  it('refuses a currency that is not yen rather than converting it', () => {
    expect(() => runImporter('2026年9月1日\tSOMETHING\tUSD\t\t100\t900', [])).toThrow()
  })
})
