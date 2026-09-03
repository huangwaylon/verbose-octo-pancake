import { describe, expect, it } from 'vitest'

import { parseConfigRows, sameSheetConfig } from '../src/lib/sheetConfig.js'
import { DEFAULT_CONFIG, mergeConfig } from '../src/config.js'
import { nameOf } from '../src/lib/identity.js'
import { PERSON } from '../src/schema.js'

// The config tab is hand-edited in a spreadsheet, so the parser is forgiving about shape — but
// must never produce a value that corrupts an entry: a NaN split silently moves money.

describe('text and list keys', () => {
  it('reads names and categories', () => {
    const parsed = parseConfigRows([
      ['person1_name', 'Waylon'],
      ['person2_name', 'Yuki'],
      ['categories', '食費, 外食 , 日用品'],
    ])
    expect(parsed).toEqual({
      person1Name: 'Waylon',
      person2Name: 'Yuki',
      categories: ['食費', '外食', '日用品'],
    })
  })

  it('is case-insensitive on the key', () => {
    expect(parseConfigRows([['PERSON1_NAME', 'Waylon']])).toEqual({ person1Name: 'Waylon' })
  })

  it('omits blank values so the defaults win', () => {
    expect(parseConfigRows([['person1_name', '   ']])).toEqual({})
  })

  it('omits a list that is only separators, rather than returning an empty list', () => {
    // An empty array would shadow the default categories and leave the picker empty.
    expect(parseConfigRows([['categories', ' , , ']])).toEqual({})
  })

  it('ignores keys it does not know', () => {
    expect(parseConfigRows([['favourite_colour', 'blue']])).toEqual({})
  })
})

describe('mergeConfig', () => {
  it('layers the sheet over the defaults, keeping unspecified keys', () => {
    // A key the defaults actually HOLD, so this tests the override rather than a spread.
    const merged = mergeConfig({ defaultSplitP1: 0.8 })
    expect(merged.defaultSplitP1).toBe(0.8)
    expect(merged.defaultSplitP2).toBe(DEFAULT_CONFIG.defaultSplitP2)
    expect(merged.categories).toEqual(DEFAULT_CONFIG.categories)
  })

  it('hands out array copies, so a caller cannot corrupt the shared defaults', () => {
    // DEFAULT_CONFIG is a module singleton, so a mutation survives the whole session.
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
    expect(parseConfigRows([['note_presets', 'OK Mart, Ozeki, Life']])).toEqual({
      notePresets: ['OK Mart', 'Ozeki', 'Life'],
    })
  })

  it('keeps names containing spaces intact', () => {
    expect(parseConfigRows([['note_presets', 'OK Mart,  My Basket ']])).toEqual({
      notePresets: ['OK Mart', 'My Basket'],
    })
  })

  it('defaults to empty, so the field is a plain text input until configured', () => {
    expect(DEFAULT_CONFIG.notePresets).toEqual([])
  })
})

describe('default split', () => {
  // Both keys are read independently, so the percentage-vs-fraction rules are pinned on p1.
  const p1 = (value) => parseConfigRows([['default_split_p1', value]]).defaultSplitP1

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
    // An exact value: a property test asserting only "within [0,1]" cannot fail here.
    expect(p1('150')).toBe(1)
  })

  it('omits junk rather than producing NaN', () => {
    // NaN would reach splitYen and throw, or worse, move money incorrectly.
    for (const junk of ['abc', '', '-20', 'fifty']) {
      expect(p1(junk)).toBeUndefined()
    }
  })

  it('tolerates a percent sign', () => {
    expect(p1('60%')).toBe(0.6)
  })

  it('keeps the two people independent', () => {
    expect(
      parseConfigRows([
        ['default_split_p1', '80'],
        ['default_split_p2', '20'],
      ]),
    ).toEqual({ defaultSplitP1: 0.8, defaultSplitP2: 0.2 })
  })

  it('leaves the other person to the default when only one key is set', () => {
    // Not mirrored to 1 - x: inventing the other half commits someone to a split they
    // never wrote.
    expect(parseConfigRows([['default_split_p1', '80']])).toEqual({ defaultSplitP1: 0.8 })
  })

  it('defaults to an even split for both people', () => {
    expect(DEFAULT_CONFIG.defaultSplitP1).toBe(0.5)
    expect(DEFAULT_CONFIG.defaultSplitP2).toBe(0.5)
  })

  it('is frozen, arrays included, because every reader holds the shared object', () => {
    // `mergeConfig`'s clone only covers a key the sheet left out; every other read is of
    // these values directly, so one mutation changes every later default.
    expect(() => {
      DEFAULT_CONFIG.defaultSplitP1 = 0.9
    }).toThrow(TypeError)
    expect(() => DEFAULT_CONFIG.categories.push('Nope')).toThrow(TypeError)
    expect(() => DEFAULT_CONFIG.notePresets.push('Nope')).toThrow(TypeError)
  })
})

describe('the two people’s names', () => {
  // A default name here shadows `nameOf`'s localized fallback, so a Japanese device reading
  // an unnamed config tab would say "Person 1" — and nothing else in the suite would notice.
  it('is absent from the defaults, so the localized fallback stays reachable', () => {
    expect('person1Name' in DEFAULT_CONFIG).toBe(false)
    expect('person2Name' in DEFAULT_CONFIG).toBe(false)
    expect(mergeConfig().person1Name).toBeUndefined()
    expect(nameOf(mergeConfig(), PERSON.P1, { p1: 'ひとり目', p2: 'ふたり目' })).toBe('ひとり目')
  })

  it('refuses to name anybody with no fallbacks, rather than defaulting to English', () => {
    expect(() => nameOf(mergeConfig(), PERSON.P1)).toThrow(TypeError)
  })

  it('wins over the fallback as soon as the sheet says one', () => {
    const config = mergeConfig(parseConfigRows([['person1_name', 'Waylon']]))
    expect(nameOf(config, PERSON.P1, { p1: 'ひとり目', p2: 'ふたり目' })).toBe('Waylon')
    expect(nameOf(config, PERSON.P2, { p1: 'ひとり目', p2: 'ふたり目' })).toBe('ふたり目')
  })
})

describe('comparing two reads of the tab', () => {
  // `useLedger` keeps the SAME merged config object when this answers true, because a fresh
  // but equal one re-renders the whole ledger — so a false positive hides a config change.
  it('answers true for two reads of an identical tab', () => {
    const pairs = [
      ['person1_name', 'Waylon'],
      ['categories', 'Groceries, Dining'],
      ['default_split_p1', '80'],
      ['note_presets', 'Ozeki'],
    ]
    expect(sameSheetConfig(parseConfigRows(pairs), parseConfigRows(pairs))).toBe(true)
  })

  it('answers true for two empty tabs, however they are spelled', () => {
    // Disconnect leaves the remembered config `undefined`, the next read parses `{}`.
    expect(sameSheetConfig(undefined, {})).toBe(true)
    expect(sameSheetConfig({}, undefined)).toBe(true)
  })

  it('answers false when a value changed', () => {
    expect(
      sameSheetConfig(
        parseConfigRows([['person1_name', 'Waylon']]),
        parseConfigRows([['person1_name', 'Yuki']]),
      ),
    ).toBe(false)
    expect(
      sameSheetConfig(
        parseConfigRows([['default_split_p1', '80']]),
        parseConfigRows([['default_split_p1', '20']]),
      ),
    ).toBe(false)
  })

  it('answers false when a key was added or removed', () => {
    const one = parseConfigRows([['person1_name', 'Waylon']])
    const two = parseConfigRows([
      ['person1_name', 'Waylon'],
      ['person2_name', 'Yuki'],
    ])
    expect(sameSheetConfig(one, two)).toBe(false)
    expect(sameSheetConfig(two, one)).toBe(false)
  })

  it('compares lists by contents, not by reference', () => {
    // Two parses of one tab are different array objects, so a reference comparison would
    // report every refresh as a change.
    const a = parseConfigRows([['categories', 'Groceries, Dining']])
    const b = parseConfigRows([['categories', 'Groceries, Dining']])
    expect(a.categories).not.toBe(b.categories)
    expect(sameSheetConfig(a, b)).toBe(true)

    expect(sameSheetConfig(a, parseConfigRows([['categories', 'Dining, Groceries']]))).toBe(false)
    expect(sameSheetConfig(a, parseConfigRows([['categories', 'Groceries']]))).toBe(false)
  })
})
