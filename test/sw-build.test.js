import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildFromDist, precachePaths } from '../scripts/build-sw.js'
import { DEFAULT_BASE, resolveBase } from '../base.js'

/**
 * The worker's failure modes are completely silent. An incomplete precache list makes `install`
 * reject, so no worker ever activates and nothing looks wrong — it is just never fast. A build
 * id that misses a change leaves `sw.js` byte-identical, so the new `index.html` never lands.
 */

const BASE = DEFAULT_BASE

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
    // The exact case that ships a broken update: index.html is not in the JS module graph,
    // so a one-character edit leaves every hashed filename alone.
    const dir = fixture()
    const before = buildFromDist(dir, BASE).source
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Shared Finance</title>')
    const after = buildFromDist(dir, BASE).source

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
    // Scope governs which clients are controlled, not which requests are seen, so the token
    // endpoint and the Sheets API both reach this handler.
    const bailOut = source.search(/origin !== self\.location\.origin\)\s*return/)
    const fetchHandler = source.indexOf("addEventListener('fetch'")
    const firstRespondWith = source.indexOf('respondWith', fetchHandler)
    expect(bailOut).toBeGreaterThan(fetchHandler)
    expect(bailOut).toBeLessThan(firstRespondWith)
  })

  it('serves a navigation from the index key rather than the request', () => {
    // A start_url launch asks for BASE; the precached key is BASE + index.html, so matching
    // the request itself would miss and fall through to the network.
    expect(source).toMatch(/mode === 'navigate' \? INDEX :/)
  })

  it('ignores Vary, or the cache silently only works online', () => {
    // caches.match honours Vary by default, and Pages sends 'Vary: Accept-Encoding' while
    // vite preview sends 'Vary: Origin' — so a header difference misses and hits the network.
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

  // RUN rather than grepped: the interesting half is which keys SURVIVE. `caches.keys()` is
  // scoped to the ORIGIN and every project Pages site under one account shares
  // `<user>.github.io`, so a sweep of "not this build" wipes every other app's precache.
  it('deletes only its own superseded caches, not everything on the origin', async () => {
    const deleted = []
    const listeners = {}
    const self = {
      addEventListener: (type, handler) => {
        listeners[type] = handler
      },
      location: { origin: 'https://example.github.io' },
    }
    const caches = {
      keys: () => Promise.resolve(['sf-oldbuild', 'sf-older', 'other-app-v3', 'workbox-precache']),
      delete: (key) => {
        deleted.push(key)
        return Promise.resolve(true)
      },
    }

    let waited
    new Function('self', 'caches', source)(self, caches)
    listeners.activate({ waitUntil: (promise) => (waited = promise) })
    await waited

    expect(deleted.sort()).toEqual(['sf-oldbuild', 'sf-older'])
  })
})

describe('the build wiring', () => {
  it('runs the generator as part of npm run build', () => {
    // Without this the whole file above tests something that never executes.
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.scripts.build).toContain('build-sw.js')
  })

  it('emits a worker that is valid JavaScript', () => {
    // Every other assertion here is a substring check, which a typo inside the template
    // literal satisfies while producing an invalid sw.js: green suite, no worker activates.
    const { source } = buildFromDist(fixture(), BASE)
    expect(() => new Function(source)).not.toThrow()
  })

  it('builds the bundle and the worker against the same base path', () => {
    // Vite writes asset URLs under its `base` and the worker precaches BASE + path: two
    // prefixes means every precached URL 404s and no worker ever activates.
    const viteConfig = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')
    expect(viteConfig).toContain('resolveBase')
    const builder = readFileSync(new URL('../scripts/build-sw.js', import.meta.url), 'utf8')
    expect(builder).toContain('resolveBase')
    expect(resolveBase({ VITE_BASE: '/' })).toBe('/')
    expect(resolveBase({})).toBe(DEFAULT_BASE)
  })
})
