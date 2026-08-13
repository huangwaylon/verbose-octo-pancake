import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * The CSS has no test that renders it, and it does not need one — but merging two
 * identical rules into a selector list is a routine tidy-up that can silently
 * attach a selector to the WRONG block. Merge `.sheet__title` with `.empty__title`
 * and land it on `.sheet__body`, and the sheet heading becomes a scroll container
 * while every other test in the suite still passes.
 *
 * So this file pins the declarations of the shared rules only, and asserts that a
 * heading never picks up layout properties from the block below it.
 */

/** Comments stripped first: they contain commas and braces of their own. */
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const FILES = {
  primitives: strip(readFileSync('src/styles/primitives.css', 'utf8')),
  app: strip(readFileSync('src/styles/app.css', 'utf8')),
}

/** Every declaration block whose selector list contains `selector`, verbatim. */
function blocksFor(css, selector) {
  const blocks = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((part) => part.trim())
    if (selectors.includes(selector)) blocks.push(match[2])
  }
  return blocks
}

function declares(css, selector, property) {
  return blocksFor(css, selector).some((body) => new RegExp(`(^|;|\\s)${property}\\s*:`).test(body))
}

describe('shared rules keep the declarations of the rules they replaced', () => {
  const headings = [
    ['primitives', '.sheet__title'],
    ['primitives', '.empty__title'],
    ['app', '.brand__title'],
    ['app', '.month-nav__label'],
  ]

  it.each(headings)('%s %s is still a heading', (file, selector) => {
    const css = FILES[file]
    expect(declares(css, selector, 'font-size')).toBe(true)
    expect(declares(css, selector, 'font-weight')).toBe(true)
    expect(declares(css, selector, 'line-height')).toBe(true)
  })

  // The bug: a heading selector attached to a scrolling container's block.
  it.each(headings)('%s %s carries no layout properties', (file, selector) => {
    const css = FILES[file]
    for (const property of ['overflow', 'overflow-y', 'padding', 'flex', 'display']) {
      expect(declares(css, selector, property)).toBe(false)
    }
  })

  const prose = ['.settings__value', '.confirm__text', '.gate__text']

  it.each(prose)('%s is still body-sized prose', (selector) => {
    expect(declares(FILES.app, selector, 'font-size')).toBe(true)
    expect(declares(FILES.app, selector, 'line-height')).toBe(true)
    expect(declares(FILES.app, selector, 'color')).toBe(true)
  })

  it.each(['.segmented__option input', '.swatch input'])(
    '%s stays hidden but focusable',
    (selector) => {
      const css = FILES.primitives
      expect(declares(css, selector, 'position')).toBe(true)
      expect(declares(css, selector, 'opacity')).toBe(true)
      // `display: none` or `visibility: hidden` would take the radio out of the
      // focus order, and the label's focus ring with it.
      expect(declares(css, selector, 'display')).toBe(false)
      expect(declares(css, selector, 'visibility')).toBe(false)
    },
  )
})

describe('rules the docs promise', () => {
  const all = Object.values(FILES).join('\n')

  // `box-shadow` is transitioned only where a focus ring is drawn with one.
  it('transitions box-shadow only on a text control', () => {
    const transitioning = [...all.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /transition[^;]*box-shadow/.test(body))
      .flatMap(([, selectors]) => selectors.split(',').map((part) => part.trim()))
    expect(transitioning.sort()).toEqual(['.input', '.select'])
  })

  it('has no rule left with an empty declaration block', () => {
    const empty = [...all.matchAll(/([^{}]+)\{(\s*)\}/g)].map(([, selectors]) => selectors.trim())
    expect(empty).toEqual([])
  })
})
