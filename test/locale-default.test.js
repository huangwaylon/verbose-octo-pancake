import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Intl reads an `undefined` locale as the device's, so these tests run the formatters on a
 * simulated French device: a formatter that forgets the English default renders "5 079 JPY".
 */
function onFrenchDevice(Constructor) {
  return class extends Constructor {
    constructor(locale, options) {
      super(locale ?? 'fr-FR', options)
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function freshOnFrenchDevice() {
  vi.stubGlobal('Intl', {
    ...Intl,
    NumberFormat: onFrenchDevice(Intl.NumberFormat),
    DateTimeFormat: onFrenchDevice(Intl.DateTimeFormat),
  })
  vi.resetModules()
  return {
    money: await import('../src/lib/money.js'),
    dates: await import('../src/lib/dates.js'),
  }
}

describe('formatters default to English, never the device locale', () => {
  it('formats yen in English with no locale given', async () => {
    const { money } = await freshOnFrenchDevice()
    expect(money.formatYen(5079)).toBe('¥5,079')
    expect(
      money
        .formatYenParts(5079)
        .map((part) => part.value)
        .join(''),
    ).toBe('¥5,079')
  })

  it('labels months and days in English with no locale given', async () => {
    const { dates } = await freshOnFrenchDevice()
    expect(dates.monthLabel('2026-08', { now: new Date(2026, 7, 5) })).toBe('August')
    expect(dates.dayLabel('2026-08-03', { today: '2026-08-05' })).toMatch(/^Mon/)
  })
})
