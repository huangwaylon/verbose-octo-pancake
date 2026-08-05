import { describe, expect, it } from 'vitest'

import { parseConfigRows } from '../src/lib/sheets.js'
import { DEFAULT_CONFIG } from '../src/config.js'

/**
 * The config tab is hand-edited by two non-programmers in a spreadsheet, so the
 * parser has to be forgiving about shape without ever producing a value that
 * would corrupt an entry — a NaN split silently moves money.
 */

const rows = (pairs) => pairs.map(([k, v]) => [k, v])

describe('text and list keys', () => {
  it('reads names, currency and categories', () => {
    const parsed = parseConfigRows(
      rows([
        ['person1_name', 'Waylon'],
        ['person2_name', 'Yuki'],
        ['currency', 'JPY'],
        ['categories', '食費, 外食 , 日用品'],
      ]),
    )
    expect(parsed).toEqual({
      person1Name: 'Waylon',
      person2Name: 'Yuki',
      currency: 'JPY',
      categories: ['食費', '外食', '日用品'],
    })
  })

  it('is case-insensitive on the key', () => {
    expect(parseConfigRows(rows([['CURRENCY', 'USD']]))).toEqual({ currency: 'USD' })
  })

  it('omits blank values so the defaults win', () => {
    expect(parseConfigRows(rows([['currency', '   ']]))).toEqual({})
  })

  it('omits a list that is only separators, rather than returning an empty list', () => {
    // An empty array here would shadow the default categories and leave the
    // category picker with nothing in it.
    expect(parseConfigRows(rows([['categories', ' , , ']]))).toEqual({})
  })

  it('ignores keys it does not know', () => {
    expect(parseConfigRows(rows([['favourite_colour', 'blue']]))).toEqual({})
  })
})

describe('note presets', () => {
  it('reads a comma-separated list', () => {
    expect(parseConfigRows(rows([['note_presets', 'OK Mart, Ozeki, Life']]))).toEqual({
      notePresets: ['OK Mart', 'Ozeki', 'Life'],
    })
  })

  it('keeps names containing spaces intact', () => {
    expect(parseConfigRows(rows([['note_presets', 'OK Mart,  My Basket ']]))).toEqual({
      notePresets: ['OK Mart', 'My Basket'],
    })
  })

  it('defaults to empty, so the field is a plain text input until configured', () => {
    expect(DEFAULT_CONFIG.notePresets).toEqual([])
  })
})

describe('default split', () => {
  // The parser reads each person's key independently, so the shared
  // percentage-vs-fraction rules are pinned once against p1.
  const p1 = (value) => parseConfigRows(rows([['default_split_p1', value]])).defaultSplitP1

  it('reads a percentage, which is what people write in a spreadsheet', () => {
    expect(p1('60')).toBe(0.6)
    expect(p1('100')).toBe(1)
  })

  it('reads a fraction too', () => {
    expect(p1('0.6')).toBe(0.6)
    expect(p1('0.5')).toBe(0.5)
  })

  it('treats 1 as all-to-the-payer, not one percent', () => {
    expect(p1('1')).toBe(1)
  })

  it('reads 0 as none-to-the-payer', () => {
    expect(p1('0')).toBe(0)
  })

  it('clamps above 100%', () => {
    expect(p1('150')).toBe(1)
  })

  it('omits junk rather than producing NaN', () => {
    // NaN would reach splitCents and throw, or worse, move money incorrectly.
    for (const junk of ['abc', '', '-20', 'fifty']) {
      expect(p1(junk)).toBeUndefined()
    }
  })

  it('tolerates a percent sign', () => {
    expect(p1('60%')).toBe(0.6)
  })

  it('always yields a finite fraction within [0,1] for any input it accepts', () => {
    for (const value of ['0', '1', '0.001', '50', '99.9', '100', '1000', '0.5%']) {
      const share = p1(value)
      if (share === undefined) continue
      expect(Number.isFinite(share)).toBe(true)
      expect(share).toBeGreaterThanOrEqual(0)
      expect(share).toBeLessThanOrEqual(1)
    }
  })

  it('keeps the two people independent', () => {
    expect(
      parseConfigRows(
        rows([
          ['default_split_p1', '80'],
          ['default_split_p2', '20'],
        ]),
      ),
    ).toEqual({ defaultSplitP1: 0.8, defaultSplitP2: 0.2 })
  })

  it('leaves the other person to the default when only one key is set', () => {
    // Not mirrored to 1 - x: the two are independent settings, and inventing
    // the other half would silently commit someone to a split they never wrote.
    expect(parseConfigRows(rows([['default_split_p1', '80']]))).toEqual({ defaultSplitP1: 0.8 })
  })

  it('defaults to an even split for both people', () => {
    expect(DEFAULT_CONFIG.defaultSplitP1).toBe(0.5)
    expect(DEFAULT_CONFIG.defaultSplitP2).toBe(0.5)
  })

  describe('sheets written before the split became per-person', () => {
    it('applies the universal default_split to both people', () => {
      // It always meant "the payer's share", so the same number for each person
      // reproduces exactly the old behaviour on an untouched sheet.
      expect(parseConfigRows(rows([['default_split', '70']]))).toEqual({
        defaultSplitP1: 0.7,
        defaultSplitP2: 0.7,
      })
    })

    it('lets an explicit per-person key win, whichever order the rows are in', () => {
      expect(
        parseConfigRows(
          rows([
            ['default_split', '50'],
            ['default_split_p1', '80'],
          ]),
        ),
      ).toEqual({ defaultSplitP1: 0.8, defaultSplitP2: 0.5 })

      expect(
        parseConfigRows(
          rows([
            ['default_split_p1', '80'],
            ['default_split', '50'],
          ]),
        ),
      ).toEqual({ defaultSplitP1: 0.8, defaultSplitP2: 0.5 })
    })

    it('ignores a junk legacy value rather than pinning both people to NaN', () => {
      expect(parseConfigRows(rows([['default_split', 'fifty']]))).toEqual({})
    })
  })
})
