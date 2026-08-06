import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildFromDist, precachePaths } from '../scripts/build-sw.js'

/**
 * The service worker's failure modes are completely silent, which is why this file
 * exists. An incomplete precache list makes `install` reject, so no worker ever
 * activates and nothing about the app looks wrong — it is just never fast. A build
 * id that misses a change leaves `sw.js` byte-identical, so the browser sees no
 * update and the new `index.html` never reaches the device.
 */

const BASE = '/verbose-octo-pancake/'

/** The shape a real `dist` has: a hashed bundle plus verbatim `public/` files. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sf-dist-'))
  mkdirSync(join(dir, 'assets'))
  mkdirSync(join(dir, 'icons'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Shared Finances</title>')
  writeFileSync(join(dir, 'assets', 'index-AAAA1111.js'), 'console.log(1)')
  writeFileSync(join(dir, 'assets', 'index-BBBB2222.css'), ':root{}')
  writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"Shared Finances"}')
  writeFileSync(join(dir, 'icons', 'icon-180.png'), 'png')
  return dir
}

describe('the precache list', () => {
  it('covers every file in the tree, not just the ones a Vite manifest names', () => {
    const dir = fixture()
    const paths = precachePaths(dir)
    // index.html and the public/ files are exactly what .vite/manifest.json omits.
    expect(paths).toEqual([
      'assets/index-AAAA1111.js',
      'assets/index-BBBB2222.css',
      'icons/icon-180.png',
      'index.html',
      'manifest.webmanifest',
    ])
  })

  it('never precaches the worker itself', () => {
    const dir = fixture()
    writeFileSync(join(dir, 'sw.js'), '/* previous build */')
    expect(precachePaths(dir)).not.toContain('sw.js')
  })

  it('prefixes every entry with the Pages base path', () => {
    const dir = fixture()
    const { source } = buildFromDist(dir, BASE)
    expect(source).toContain(`"${BASE}index.html"`)
    expect(source).toContain(`"${BASE}assets/index-AAAA1111.js"`)
  })
})

describe('the build id', () => {
  it('changes when index.html changes, even though no asset name does', () => {
    // The exact case that would ship a broken update: index.html is not in the JS
    // module graph, so a one-character edit leaves every hashed filename alone.
    const dir = fixture()
    const before = buildFromDist(dir, BASE).source
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Shared Finance</title>')
    const after = buildFromDist(dir, BASE).source

    expect(precachePaths(dir)).toEqual(precachePaths(dir))
    expect(after).not.toBe(before)
  })

  it('is stable for an unchanged tree, so an unchanged deploy is a no-op', () => {
    const dir = fixture()
    expect(buildFromDist(dir, BASE).source).toBe(buildFromDist(dir, BASE).source)
  })
})

describe('the generated worker', () => {
  const { source } = buildFromDist(fixture(), BASE)

  it('bails out of cross-origin requests before responding to anything', () => {
    // Scope governs which clients are controlled, not which requests are seen, so
    // the token endpoint and the Sheets API both reach this handler.
    expect(source).toContain('if (new URL(event.request.url).origin !== self.location.origin) return')
  })

  it('serves a navigation from the index key rather than the request', () => {
    // A start_url launch asks for BASE; the precached key is BASE + index.html.
    expect(source).toContain('caches.match(INDEX')
  })

  it('ignores Vary, or the cache silently only works online', () => {
    // Pages sends 'Vary: Accept-Encoding' and vite preview sends 'Vary: Origin'.
    // caches.match honours Vary by default, so a header difference between the
    // precache fetch and the page's request misses and falls through to network.
    expect(source).toContain('ignoreVary: true')
  })

  it('precaches past the CDN, so a stale edge copy cannot be paired with a fresh one', () => {
    expect(source).toContain("{ cache: 'reload' }")
  })

  it('does not claim control on its own', () => {
    // Only src/lib/serviceWorker.js decides when a swap is safe.
    expect(source).not.toContain('clients.claim')
    expect(source).toContain("event.data.type === 'SKIP_WAITING'")
  })
})

describe('the build wiring', () => {
  it('runs the generator as part of npm run build', () => {
    // Without this the whole file above tests something that never executes.
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.scripts.build).toContain('build-sw.js')
  })
})
