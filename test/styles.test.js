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
 * heading never picks up layout properties from the block below it. Only a selector
 * that actually shares a declaration block belongs in the tables below — a
 * standalone rule cannot be mis-merged, so an entry for one tests nothing.
 */

/** Comments stripped first: they contain commas and braces of their own. */
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const FILES = {
  base: strip(readFileSync('src/styles/base.css', 'utf8')),
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

/**
 * The target is one platform: Safari on iOS, installed to the Home Screen, on a
 * phone. Every rule below is invisible on a desktop browser and wrong on a phone,
 * which is exactly the combination no other test in this suite can catch.
 */
describe('the rules an installed iOS web app depends on', () => {
  const all = Object.values(FILES).join('\n')

  it('gates every hover rule behind a hover-capable pointer', () => {
    // iOS applies :hover on tap and holds it until the next tap elsewhere, so an
    // ungated rule leaves a button looking stuck in a selected state.
    const ungated = []
    for (const [, source] of Object.entries(FILES)) {
      // Split on the at-rules so a rule's enclosing media query is knowable.
      for (const match of source.matchAll(/@media([^{]+)\{([\s\S]*?)\n\}/g)) {
        if (/hover\s*:\s*hover|pointer\s*:\s*fine/.test(match[1])) continue
        for (const rule of match[2].matchAll(/([^{}]*:hover[^{}]*)\{/g))
          ungated.push(rule[1].trim())
      }
    }
    // Rules outside any at-rule.
    const topLevel = all.replace(/@media[^{]+\{[\s\S]*?\n\}/g, '')
    for (const rule of topLevel.matchAll(/([^{}]*:hover[^{}]*)\{/g)) ungated.push(rule[1].trim())
    expect(ungated).toEqual([])
  })

  it('gives every hover-styled control an :active state too', () => {
    // The platform tap highlight is cleared in base.css, so :active is the only
    // press feedback a finger gets.
    const hovered = new Set()
    for (const rule of all.matchAll(/([^{}]+):hover(?::not\(\[disabled\]\))?\s*\{/g)) {
      hovered.add(rule[1].trim().split('\n').pop().trim())
    }
    const active = new Set()
    for (const rule of all.matchAll(/([^{}]+):active(?::not\(\[disabled\]\))?\s*\{/g)) {
      active.add(rule[1].trim().split('\n').pop().trim())
    }
    // Links and native scrollbars are the exceptions: neither has a press state.
    const missing = [...hovered].filter(
      (selector) => !active.has(selector) && !['a', '::-webkit-scrollbar-thumb'].includes(selector),
    )
    expect(missing).toEqual([])
  })

  it('stops the standalone pull-to-refresh, which bypasses setSafeToReload', () => {
    expect(declares(FILES.base, 'html', 'overscroll-behavior-y')).toBe(true)
  })

  it('lifts the sheet clear of the software keyboard', () => {
    // `dvh` tracks the LAYOUT viewport, which iOS does not shrink for the keyboard,
    // so without this the footer's Save button sits behind it — and the decimal
    // keypad has no Done key to dismiss with.
    expect(blocksFor(FILES.primitives, '.sheet').join()).toContain('--keyboard-inset')
    expect(blocksFor(FILES.primitives, '.sheet__panel').join()).toContain('--keyboard-inset')
  })

  it('keeps a toast from swallowing the taps of what it covers', () => {
    // The toast stack outranks everything except a sheet, and it now overlays the
    // last rows of the ledger and their delete controls rather than a FAB. Being
    // transparent to pointer events is the whole guarantee; the offset only has to
    // clear the home indicator.
    const stack = blocksFor(FILES.primitives, '.toast-stack').join()
    expect(stack).toContain('pointer-events: none')
    expect(stack).toContain('--safe-bottom')
  })

  it('sizes the band with the token the sticky aside offsets by', () => {
    // The aside reads --header-height from outside the header, so the band's height
    // has to be pinned by min-height rather than left to its content to decide.
    // Asserted as the token, not merely as the property: `min-height: 0` declares it
    // and pins nothing.
    expect(blocksFor(FILES.app, '.app__header').join()).toContain(
      'min-height: var(--header-height)',
    )
    expect(blocksFor(FILES.app, '.layout__aside').join()).toContain('--header-height')
  })

  it('truncates the hero figure but never the sentence that gives it direction', () => {
    // The figure must stay a BLOCK box: text-overflow only paints on a block
    // overflowing with inline content, so as a flex row it clips mid-digit with no
    // ellipsis — a wrong number rather than a visibly incomplete one. And it does
    // nothing at all without `nowrap`, since a figure that wraps never overflows.
    expect(declares(FILES.app, '.balance__amount', 'text-overflow')).toBe(true)
    expect(declares(FILES.app, '.balance__amount', 'white-space')).toBe(true)
    expect(declares(FILES.app, '.balance__amount', 'display')).toBe(false)
    // The exact opposite for the line below it: 「{name}に支払い」 is verb-final, so a
    // tail ellipsis leaves a name with nothing said about which way money runs.
    // `white-space` is the half that does the harm; ellipsis alone cannot truncate.
    expect(declares(FILES.app, '.balance__direction', 'white-space')).toBe(false)
    // Without this the figure pushes the refresh and settings buttons off the
    // trailing edge of the header instead of being truncated at all.
    expect(declares(FILES.app, '.balance', 'min-width')).toBe(true)
  })

  it('spends no tap on a double-tap wait for a control that is not a button', () => {
    // base.css sets touch-action on `button` only, so the label-, summary- and
    // div-based controls need their own.
    for (const [file, selector] of [
      ['primitives', '.segmented__option'],
      ['primitives', '.swatch'],
      ['primitives', '.sheet__backdrop'],
      ['app', '.deleted__summary'],
      // The button form only: the deleted list renders the same class as an inert
      // span, where a press state promises a tap that does nothing.
      ['app', 'button.entry__main'],
    ]) {
      expect(declares(FILES[file], selector, 'touch-action')).toBe(true)
    }
    expect(declares(FILES.app, '.entry__main', 'user-select')).toBe(false)
  })

  it('never lets a control set the width of the sheet it sits in', () => {
    // `.sheet` is a row flex container, so the panel's automatic minimum size is its
    // min-content width; a date input's intrinsic minimum on iOS is enough to push
    // the whole panel — and every field in it — off the right of the screen.
    expect(declares(FILES.primitives, '.sheet__panel', 'min-width')).toBe(true)
    expect(declares(FILES.primitives, '.input[type="date"]', 'min-width')).toBe(true)
    // Dropping the platform appearance is what stops iOS sizing the field from the
    // locale's date format rather than from its container.
    expect(declares(FILES.primitives, '.input[type="date"]', 'appearance')).toBe(true)
  })

  it('never lets a sheet scroll sideways, whatever the config tab holds', () => {
    // With overflow-y set, a `visible` overflow-x computes to `auto`, so one
    // over-wide child turns the panel into a horizontal scroller at 320px.
    expect(declares(FILES.primitives, '.sheet__body', 'overflow-x')).toBe(true)
    for (const selector of ['.segmented__option', '.pill']) {
      expect(declares(FILES.primitives, selector, 'overflow-wrap')).toBe(true)
    }
    expect(declares(FILES.primitives, '.segmented__option', 'min-width')).toBe(true)
    expect(declares(FILES.primitives, '.pill', 'max-width')).toBe(true)
  })
})
