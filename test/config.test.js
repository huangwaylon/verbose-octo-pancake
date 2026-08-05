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
  it('reads a percentage, which is what people write in a spreadsheet', () => {
    expect(parseConfigRows(rows([['default_split', '60']]))).toEqual({ defaultSplit: 0.6 })
    expect(parseConfigRows(rows([['default_split', '100']]))).toEqual({ defaultSplit: 1 })
  })

  it('reads a fraction too', () => {
    expect(parseConfigRows(rows([['default_split', '0.6']]))).toEqual({ defaultSplit: 0.6 })
    expect(parseConfigRows(rows([['default_split', '0.5']]))).toEqual({ defaultSplit: 0.5 })
  })

  it('treats 1 as all-to-the-payer, not one percent', () => {
    expect(parseConfigRows(rows([['default_split', '1']]))).toEqual({ defaultSplit: 1 })
  })

  it('reads 0 as none-to-the-payer', () => {
    expect(parseConfigRows(rows([['default_split', '0']]))).toEqual({ defaultSplit: 0 })
  })

  it('clamps above 100%', () => {
    expect(parseConfigRows(rows([['default_split', '150']]))).toEqual({ defaultSplit: 1 })
  })

  it('omits junk rather than producing NaN', () => {
    // NaN would reach splitCents and throw, or worse, move money incorrectly.
    for (const junk of ['abc', '', '-20', 'fifty']) {
      expect(parseConfigRows(rows([['default_split', junk]])).defaultSplit).toBeUndefined()
    }
  })

  it('tolerates a percent sign', () => {
    expect(parseConfigRows(rows([['default_split', '60%']]))).toEqual({ defaultSplit: 0.6 })
  })

  it('always yields a finite fraction within [0,1] for any input it accepts', () => {
    for (const value of ['0', '1', '0.001', '50', '99.9', '100', '1000', '0.5%']) {
      const { defaultSplit } = parseConfigRows(rows([['default_split', value]]))
      if (defaultSplit === undefined) continue
      expect(Number.isFinite(defaultSplit)).toBe(true)
      expect(defaultSplit).toBeGreaterThanOrEqual(0)
      expect(defaultSplit).toBeLessThanOrEqual(1)
    }
  })
})
