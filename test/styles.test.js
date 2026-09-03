import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Merging two identical rules into a selector list is a routine tidy-up that can silently attach
 * a selector to the WRONG block: merge `.sheet__title` with `.empty__title` and land it on
 * `.sheet__body`, and the sheet heading becomes a scroll container with every other test passing.
 * So this pins the SHARED rules' declarations only — a standalone rule cannot be mis-merged, so
 * an entry for one in the tables below tests nothing.
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

  // One shared shape rule: land it on the wrong selector and a legend silently loses its dot.
  it.each([['.summary__person-swatch'], ['.chart__swatch']])('%s is still a dot', (selector) => {
    for (const property of ['width', 'height', 'border-radius']) {
      expect(declares(FILES.app, selector, property)).toBe(true)
    }
  })

  // The VALUE, not the property: a merge moving the colour onto the other selector leaves the
  // meter's dot painting nothing. The chart's dot is absent — its colour is inline, per slice.
  it('the meter dot still paints itself, var(--accent)', () => {
    expect(blocksFor(FILES.app, '.summary__person-swatch').at(-1)).toContain('var(--accent)')
  })

  // One shared block: land it on one track and the other stops being a column at all.
  it.each([['.layout__aside'], ['.layout__main']])('%s is still a flex column', (selector) => {
    for (const property of ['display', 'flex-direction', 'gap']) {
      expect(declares(FILES.app, selector, property)).toBe(true)
    }
  })

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
      // `display: none` or `visibility: hidden` takes the radio out of the focus order.
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

// Every rule below is invisible in a desktop browser and wrong on the target — Safari on iOS,
// installed to the Home Screen, on a phone — which is the combination nothing else can catch.
describe('the rules an installed iOS web app depends on', () => {
  const all = Object.values(FILES).join('\n')

  it('gates every hover rule behind a hover-capable pointer', () => {
    // iOS applies :hover on tap and holds it, so an ungated rule leaves a button looking stuck.
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
    // The platform tap highlight is cleared in base.css, so :active is the only press feedback
    // a finger gets. EVERY selector in a list, not merely the last: a check reading the tail
    // alone would quietly stop covering everything above it.
    const styledBy = (pseudo) => {
      const found = new Set()
      const attached = new RegExp(`^(.*):${pseudo}(?::not\\(\\[disabled\\]\\))?$`)
      for (const rule of all.matchAll(/([^{}]+)\{/g)) {
        // An at-rule prelude is not a selector list, and `@media (hover:hover)` reads as one.
        if (rule[1].trim().startsWith('@')) continue
        for (const part of rule[1].split(',')) {
          const match = part.trim().match(attached)
          if (match) found.add(match[1].trim())
        }
      }
      return found
    }
    const hovered = styledBy('hover')
    const active = styledBy('active')
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
    // `dvh` tracks the LAYOUT viewport, which iOS does not shrink for the keyboard, so without
    // this the footer's Save sits behind it with no Done key. Both selectors matter: the
    // container pads by the inset, the footer spends `--safe-bottom` only on what the keyboard
    // is not covering, and neither panel names it — both cap against `100%` of the padded box.
    expect(blocksFor(FILES.primitives, '.sheet').join()).toContain('--keyboard-inset')
    // The home indicator's clearance is worth nothing behind a keyboard.
    expect(blocksFor(FILES.primitives, '.sheet__footer').join()).toContain('--keyboard-inset')
    for (const selector of ['.sheet__panel', '.sheet__panel--full']) {
      expect(blocksFor(FILES.primitives, selector).join()).not.toContain('--keyboard-inset')
    }
  })

  it('lifts the key screen’s Connect button clear of the keyboard too', () => {
    // `.gate` is one viewport tall and centres its content, so nothing scrolls and the keypad
    // simply covers the button. Border-box at `100dvh`, so the inset shrinks what is centred.
    expect(blocksFor(FILES.app, '.gate').join()).toContain('--keyboard-inset')
  })

  it('keeps the sheet clear of the keyboard at DIALOG widths too', () => {
    // PER BLOCK, not against the join: the >=48rem block sets `padding` as a shorthand, so
    // it discards the phone rule's `padding-bottom`, and a joined check cannot see that.
    for (const body of blocksFor(FILES.primitives, '.sheet')) {
      if (!/(^|;|\s)padding(-bottom)?\s*:/.test(body)) continue
      expect(body).toContain('--keyboard-inset')
    }

    // And a cap has to be relative to the box padding just shrank — `100%` is that box, since
    // `.sheet` is `fixed; inset: 0`. Against `dvh` a tall dialog overflows it and pushes its
    // footer back under the keyboard. `max-height: none` is the full-screen phone exception.
    for (const selector of ['.sheet__panel', '.sheet__panel--full']) {
      for (const body of blocksFor(FILES.primitives, selector)) {
        const capped = body.match(/(?:^|;|\s)max-height\s*:([^;]*)/)
        if (!capped || capped[1].trim() === 'none') continue
        expect(capped[1]).toContain('100%')
      }
    }
  })

  it('lets the sheet body shrink, so the footer cannot leave the panel', () => {
    // `.sheet__panel` is a COLUMN flex container, so the body's automatic minimum is its
    // min-content HEIGHT and `flex: 1 1 auto` does not override it: the footer goes out through
    // the rounded corner, and in landscape under the keyboard.
    expect(declares(FILES.primitives, '.sheet__body', 'min-height')).toBe(true)
  })

  it('gives the full-screen panel the whole screen, and undoes it for the dialog', () => {
    // PER BLOCK again: with both in one bucket, hoisting `height: auto` out of the media query
    // and deleting the reset satisfies every string on a panel never full screen.
    const blocks = blocksFor(FILES.primitives, '.sheet__panel--full')
    expect(blocks).toHaveLength(2)
    const [phone, dialog] = blocks

    expect(phone).toContain('height: 100%')
    // `44rem` binds on an iPhone 15, so the cap has to be lifted rather than merely out-asked,
    // or "full screen" is a 704px panel with square corners.
    expect(phone).toContain('max-height: none')
    expect(phone).toContain('border-radius: 0')
    // `position: fixed` puts the panel outside base.css's insets on `body`, so it composes its
    // own or the title renders under the Dynamic Island.
    expect(phone).toContain('--safe-top')

    // A surviving `height` gets capped into a fixed 44rem box: a confirmation 704px tall.
    expect(dialog).toContain('height: auto')
    expect(dialog).toContain('padding: 0')
  })

  it('undoes the full-screen panel’s descendant rules for the dialog too', () => {
    // The hairline exists because a full-bleed header has no edge of its own. Left standing above
    // the breakpoint it gives the entry-form dialog chrome the confirmation beside it lacks.
    for (const selector of [
      '.sheet__panel--full .sheet__header',
      '.sheet__panel--full .sheet__body',
    ])
      expect(blocksFor(FILES.primitives, selector)).toHaveLength(2)
  })

  it('keeps a toast from swallowing the taps of what it covers', () => {
    // The stack overlays the last rows of the ledger and their delete controls, so being
    // transparent to pointer events is the whole guarantee.
    const stack = blocksFor(FILES.primitives, '.toast-stack').join()
    expect(stack).toContain('pointer-events: none')
    expect(stack).toContain('--safe-bottom')
  })

  it('sizes the band with the token the sticky aside offsets by', () => {
    // The aside reads --header-height from outside the header, so the height must be pinned by
    // min-height. The TOKEN, not merely the property: `min-height: 0` declares it and pins none.
    expect(blocksFor(FILES.app, '.app__header').join()).toContain(
      'min-height: var(--header-height)',
    )
    expect(blocksFor(FILES.app, '.layout__aside').join()).toContain('--header-height')
  })

  it('truncates the hero figure but never the sentence that gives it direction', () => {
    // The figure must stay a BLOCK box: text-overflow only paints on a block overflowing with
    // inline content, so as a flex row it clips mid-digit — a wrong number rather than a visibly
    // incomplete one — and it does nothing without `nowrap`.
    expect(declares(FILES.app, '.balance__amount', 'text-overflow')).toBe(true)
    expect(declares(FILES.app, '.balance__amount', 'white-space')).toBe(true)
    expect(declares(FILES.app, '.balance__amount', 'display')).toBe(false)
    // The opposite below it: 「{name}に支払い」 is verb-final, so a tail ellipsis leaves a name
    // with nothing said about which way money runs. `white-space` is the half that does harm.
    expect(declares(FILES.app, '.balance__direction', 'white-space')).toBe(false)
    // Without this the figure pushes the refresh and settings buttons off the trailing edge.
    expect(declares(FILES.app, '.balance', 'min-width')).toBe(true)
  })

  it('spends no tap on a double-tap wait for a control that is not a button', () => {
    // base.css sets touch-action on `button` only, so the rest need their own.
    for (const [file, selector] of [
      ['primitives', '.segmented__option'],
      ['primitives', '.swatch'],
      ['primitives', '.sheet__backdrop'],
      // `.btn` is worn by an `<a>` too — the link to the sheet in Settings got the 300ms wait.
      ['primitives', '.btn'],
      // A `<label htmlFor>` forwards its tap, so it is a tappable `button` never covers.
      ['primitives', '.field__label'],
      ['app', '.deleted__summary'],
      // The button form only: the deleted list renders the same class as an inert span.
      ['app', 'button.entry__main'],
      // The same affordance in a sheet. Only ever a button, so no element qualifier.
      ['app', '.recurring__main'],
      // A wrapping `<label>`: its hint and its output both forward a tap to the range inside.
      ['app', '.split-control__slider'],
    ]) {
      expect(declares(FILES[file], selector, 'touch-action')).toBe(true)
    }
    expect(declares(FILES.app, '.entry__main', 'user-select')).toBe(false)
  })

  it('never lets a control set the width of the sheet it sits in', () => {
    // `.sheet` is a row flex container, so the panel's automatic minimum is its min-content
    // width; a date input's intrinsic minimum on iOS pushes the whole panel off the screen.
    expect(declares(FILES.primitives, '.sheet__panel', 'min-width')).toBe(true)
    expect(declares(FILES.primitives, '.input[type="date"]', 'min-width')).toBe(true)
    // Dropping the platform appearance stops iOS sizing the field from the locale's format.
    expect(declares(FILES.primitives, '.input[type="date"]', 'appearance')).toBe(true)
  })

  it('never lets a sheet scroll sideways, whatever the config tab holds', () => {
    // With overflow-y set, a `visible` overflow-x computes to `auto`, so one over-wide child
    // turns the panel into a horizontal scroller at 320px.
    expect(declares(FILES.primitives, '.sheet__body', 'overflow-x')).toBe(true)
    for (const selector of ['.segmented__option', '.pill']) {
      expect(declares(FILES.primitives, selector, 'overflow-wrap')).toBe(true)
    }
    // The recurring page WRAPS the same hand-authored text rather than truncating — inside a
    // sheet nothing scrolls a truncation into view. These two are flex items on the CROSS axis
    // of a column, which `.recurring__main` already lets shrink, so they need no `min-width`.
    for (const selector of ['.recurring__name', '.recurring__meta']) {
      expect(declares(FILES.app, selector, 'overflow-wrap')).toBe(true)
    }
    // Every other holder carries the PAIR: an item's automatic minimum is its min-content WIDTH,
    // which `overflow-wrap` does not reduce. `.summary__person-name` is the one on the PAGE,
    // where nothing clips and the whole screen scrolls sideways at 320px.
    for (const selector of [
      '.summary__person-name',
      '.chart__name',
      '.split-control__slider .field__hint',
    ]) {
      expect(declares(FILES.app, selector, 'overflow-wrap')).toBe(true)
      expect(declares(FILES.app, selector, 'min-width')).toBe(true)
    }
    expect(declares(FILES.primitives, '.segmented__option', 'min-width')).toBe(true)
    expect(declares(FILES.primitives, '.pill', 'max-width')).toBe(true)
  })

  it('never lets a LEDGER column be sized by its widest unbreakable child', () => {
    // Both tracks: one non-wrapping descendant sizes the whole column and the page scrolls
    // sideways at 320px. Nothing in the aside relies on it today, and only a stress page shows it.
    for (const selector of ['.layout__aside', '.layout__main']) {
      expect(declares(FILES.app, selector, 'min-width')).toBe(true)
    }
  })
})

/**
 * `theme-color`, the manifest and the data-URI favicon are read before any stylesheet exists, so
 * all three restate a token's literal and no CSS fix is possible. Drift shows only as a band of
 * the wrong colour around the installed app, or a tile in last season's accent.
 */
describe('the copies of a token that live outside tokens.css', () => {
  const tokens = strip(readFileSync('src/styles/tokens.css', 'utf8'))
  const html = readFileSync('index.html', 'utf8')
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))

  /** The FIRST definition, which is `:root`'s — `[data-accent]` redefines --accent below. */
  const token = (name) => tokens.match(new RegExp(`${name}:\\s*(#[0-9a-f]{3,8})`))[1]

  it('states the page ground as --bg in all three places that cannot read it', () => {
    const bg = token('--bg')
    expect(html).toContain(`<meta name="theme-color" content="${bg}" />`)
    expect(manifest.background_color).toBe(bg)
    expect(manifest.theme_color).toBe(bg)
  })

  it('draws the favicon in the DEFAULT accent', () => {
    // The tile cannot follow the per-device preset, so it carries the one every install starts on.
    const icon = html.match(/href="(data:image\/svg\+xml,[^"]*)"/)[1]
    expect(decodeURIComponent(icon)).toContain(`fill='${token('--accent')}'`)
  })
})
