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

  // The two legend dots share one shape rule and differ only in colour, so a merge
  // here is exactly the kind this file exists to catch: land the shared block on the
  // wrong selector and one legend loses its dot entirely, silently.
  it.each([['.summary__person-swatch'], ['.chart__swatch']])('%s is still a dot', (selector) => {
    for (const property of ['width', 'height', 'border-radius']) {
      expect(declares(FILES.app, selector, property)).toBe(true)
    }
  })

  // The VALUE, not the property: the meter's dot takes its colour from the shared block, so a
  // merge that moved the colour onto the other selector would leave it painting nothing.
  // The chart's dot is deliberately absent — its colour is set inline, per slice.
  it('the meter dot still paints itself, var(--accent)', () => {
    expect(blocksFor(FILES.app, '.summary__person-swatch').at(-1)).toContain('var(--accent)')
  })

  // The two ledger tracks share one block now, so they are mis-mergeable in the way this
  // file exists to catch: land it on one and the other stops being a column at all.
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
    // keypad has no Done key to dismiss with. Two selectors inside the sheet name the
    // inset and each matters: the container pads by it, and the footer spends
    // `--safe-bottom` only on what the keyboard is not already covering. Neither panel
    // names it — both cap themselves against `100%` of the container's already-padded
    // box instead, so the inset has one source of truth rather than a copy per panel.
    expect(blocksFor(FILES.primitives, '.sheet').join()).toContain('--keyboard-inset')
    // The home indicator's clearance is worth nothing behind a keyboard, and that is
    // the one moment the panel has no height to spare.
    expect(blocksFor(FILES.primitives, '.sheet__footer').join()).toContain('--keyboard-inset')
    for (const selector of ['.sheet__panel', '.sheet__panel--full']) {
      expect(blocksFor(FILES.primitives, selector).join()).not.toContain('--keyboard-inset')
    }
  })

  it('lifts the key screen’s Connect button clear of the keyboard too', () => {
    // The app key is the one text field outside a sheet, and `.gate` is one viewport
    // tall and centres its content — so there is nothing for iOS to scroll and the
    // keypad simply covers the button while the field above it stays visible. The box
    // is border-box at `100dvh`, so spending the inset as bottom padding shrinks the
    // content box being centred in. `KeyGate` mounts the same publisher the sheet uses.
    expect(blocksFor(FILES.app, '.gate').join()).toContain('--keyboard-inset')
  })

  it('keeps the sheet clear of the keyboard at DIALOG widths too', () => {
    // PER BLOCK, not against the join: the >=48rem block sets `padding` as a shorthand, so
    // it discards the phone rule's `padding-bottom`, and a joined check cannot see that.
    for (const body of blocksFor(FILES.primitives, '.sheet')) {
      if (!/(^|;|\s)padding(-bottom)?\s*:/.test(body)) continue
      expect(body).toContain('--keyboard-inset')
    }

    // And a cap has to be relative to the box that padding just shrank, not to the
    // whole viewport — `100%` is that box, since `.sheet` is `fixed; inset: 0`. A cap
    // written against `dvh` alone lets a tall dialog overflow the padded box and pushes
    // its footer straight back under the keyboard. `max-height: none` is the deliberate
    // exception: the full-screen phone panel takes 100% of the container directly.
    for (const selector of ['.sheet__panel', '.sheet__panel--full']) {
      for (const body of blocksFor(FILES.primitives, selector)) {
        const capped = body.match(/(?:^|;|\s)max-height\s*:([^;]*)/)
        if (!capped || capped[1].trim() === 'none') continue
        expect(capped[1]).toContain('100%')
      }
    }
  })

  it('lets the sheet body shrink, so the footer cannot leave the panel', () => {
    // `.sheet__panel` is a COLUMN flex container, so the body's automatic minimum size
    // is its min-content HEIGHT and `flex: 1 1 auto` does not override it. Without this
    // the body refuses to shrink and pushes the footer out through the rounded corner —
    // and in landscape, back under the keyboard.
    expect(declares(FILES.primitives, '.sheet__body', 'min-height')).toBe(true)
  })

  it('gives the full-screen panel the whole screen, and undoes it for the dialog', () => {
    // PER BLOCK again: with both in one bucket, hoisting `height: auto` out of the media
    // query and deleting the reset satisfies every string on a panel never full screen.
    const blocks = blocksFor(FILES.primitives, '.sheet__panel--full')
    expect(blocks).toHaveLength(2)
    const [phone, dialog] = blocks

    expect(phone).toContain('height: 100%')
    // `44rem` is the term that binds on an iPhone 15, so the cap has to be lifted and
    // not merely out-asked, or "full screen" is a 704px panel with square corners.
    expect(phone).toContain('max-height: none')
    expect(phone).toContain('border-radius: 0')
    // The panel is the top of the screen now, and `position: fixed` puts it outside
    // base.css's insets on `body`, so it composes its own or the title renders under
    // the Dynamic Island.
    expect(phone).toContain('--safe-top')

    // Full screen is a phone treatment: a surviving `height` gets capped by max-height
    // into a fixed 44rem box, so a two-button confirmation renders 704px tall.
    expect(dialog).toContain('height: auto')
    expect(dialog).toContain('padding: 0')
  })

  it('undoes the full-screen panel’s descendant rules for the dialog too', () => {
    // The hairline exists because a full-bleed header has no edge of its own. Left
    // standing above the breakpoint it gives the entry-form dialog chrome that the
    // delete confirmation beside it at the same width does not have.
    for (const selector of [
      '.sheet__panel--full .sheet__header',
      '.sheet__panel--full .sheet__body',
    ])
      expect(blocksFor(FILES.primitives, selector)).toHaveLength(2)
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
      // `.btn` is worn by an `<a>` as well as a `<button>` — the link to the sheet in
      // Settings is the only route to it and got the 300ms wait.
      ['primitives', '.btn'],
      // A `<label htmlFor>` forwards its tap to the control it names, so it is a
      // tappable that `button` never covers.
      ['primitives', '.field__label'],
      ['app', '.deleted__summary'],
      // The button form only: the deleted list renders the same class as an inert
      // span, where a press state promises a tap that does nothing.
      ['app', 'button.entry__main'],
      // The same affordance in a sheet. Only ever a button, so no element qualifier.
      ['app', '.recurring__main'],
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
    // The recurring page holds the same hand-authored text, and WRAPS it rather than
    // truncating — inside a sheet there is nothing to scroll a truncation into view.
    for (const selector of ['.recurring__name', '.recurring__meta']) {
      expect(declares(FILES.app, selector, 'overflow-wrap')).toBe(true)
    }
    expect(declares(FILES.primitives, '.segmented__option', 'min-width')).toBe(true)
    expect(declares(FILES.primitives, '.pill', 'max-width')).toBe(true)
  })

  it('never lets a LEDGER column be sized by its widest unbreakable child', () => {
    // Both grid tracks, because a grid item's automatic minimum is its min-content WIDTH:
    // one non-wrapping descendant sizes the whole column and the page scrolls sideways at
    // 320px. Nothing in the aside relies on it today, which is exactly why it has to stay
    // stated — and only the stress pages' SIDEWAYS readout would show it going.
    for (const selector of ['.layout__aside', '.layout__main']) {
      expect(declares(FILES.app, selector, 'min-width')).toBe(true)
    }
  })
})
