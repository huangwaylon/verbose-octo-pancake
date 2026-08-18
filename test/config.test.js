import { describe, expect, it } from 'vitest'

import { parseConfigRows } from '../src/lib/sheetConfig.js'
import { DEFAULT_CONFIG, mergeConfig } from '../src/config.js'
import { nameOf } from '../src/lib/identity.js'
import { PERSON } from '../src/schema.js'

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

describe('the currency code', () => {
  it('normalises case and padding to one spelling', () => {
    // Everything downstream compares codes with `!==`: an entry carries whatever
    // its cell said, so a lowercase config cell latches the mixed-currency warning
    // on over totals that are perfectly homogeneous.
    expect(parseConfigRows(rows([['currency', ' jpy ']]))).toEqual({ currency: 'JPY' })
    expect(parseConfigRows(rows([['currency', 'Usd']]))).toEqual({ currency: 'USD' })
  })

  it('omits anything that is not a three-letter code, so the default wins', () => {
    // A code decides the minor-unit scale, and an unrecognised one silently
    // answers 2 digits — a 100x error on a yen sheet.
    for (const value of ['JP', 'YENS', '¥', '123', 'JP¥']) {
      expect(parseConfigRows(rows([['currency', value]]))).toEqual({})
    }
  })
})

describe('mergeConfig', () => {
  it('layers the sheet over the defaults, keeping unspecified keys', () => {
    const merged = mergeConfig({ currency: 'USD' })
    expect(merged.currency).toBe('USD')
    expect(merged.categories).toEqual(DEFAULT_CONFIG.categories)
  })

  it('hands out array copies, so a caller cannot corrupt the shared defaults', () => {
    // DEFAULT_CONFIG is a module singleton reused by every later merge, including
    // the reset on disconnect. Mutation there would survive the rest of the session.
    const merged = mergeConfig()
    merged.categories.push('Poisoned')
    merged.notePresets.push('Poisoned')
    expect(DEFAULT_CONFIG.categories).not.toContain('Poisoned')
    expect(DEFAULT_CONFIG.notePresets).not.toContain('Poisoned')
    expect(mergeConfig().categories).not.toContain('Poisoned')
    expect(mergeConfig().notePresets).not.toContain('Poisoned')
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
    // The clamp itself, at an exact value. A property test over a range of inputs
    // asserting only "within [0,1]" cannot fail for any input this one accepts.
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
})

describe('the two people’s names', () => {
  // The sheet is the only source of a name. A default here would shadow the
  // localized fallback in `nameOf`, so a Japanese device reading a sheet with no
  // names in its config tab would say "Person 1" rather than 「ひとり目」 — and
  // nothing else in the suite would notice.
  it('is absent from the defaults, so the localized fallback stays reachable', () => {
    expect('person1Name' in DEFAULT_CONFIG).toBe(false)
    expect('person2Name' in DEFAULT_CONFIG).toBe(false)
    expect(mergeConfig().person1Name).toBeUndefined()
    expect(nameOf(mergeConfig(), PERSON.P1, { p1: 'ひとり目', p2: 'ふたり目' })).toBe('ひとり目')
  })

  it('wins over the fallback as soon as the sheet says one', () => {
    const config = mergeConfig(parseConfigRows(rows([['person1_name', 'Waylon']])))
    expect(nameOf(config, PERSON.P1, { p1: 'ひとり目', p2: 'ふたり目' })).toBe('Waylon')
    expect(nameOf(config, PERSON.P2, { p1: 'ひとり目', p2: 'ふたり目' })).toBe('ふたり目')
  })
})
