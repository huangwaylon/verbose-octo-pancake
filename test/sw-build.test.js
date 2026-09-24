import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { buildFromDist, precachePaths } from '../scripts/build-sw.js'
import { DEFAULT_BASE, resolveBase } from '../base.js'

/**
 * The worker's failure modes are completely silent. An incomplete precache list makes `install`
 * reject, so no worker ever activates and nothing looks wrong — it is just never fast. A build
 * id that misses a change leaves `sw.js` byte-identical, so the new `index.html` never lands.
 */

const BASE = DEFAULT_BASE
const ORIGIN = 'https://example.github.io'

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/** The shape a real `dist` has: a hashed bundle plus verbatim `public/` files. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sf-dist-'))
  tempDirs.push(dir)
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

/**
 * Evaluates a generated worker against fakes of the three globals it touches, recording every
 * call. `Request` is faked too: Node's refuses the relative URLs a worker legitimately uses.
 */
function runWorker(source, { hit = null } = {}) {
  const listeners = {}
  const calls = { open: [], addAll: [], match: [], deleted: [], fetched: [] }
  const self = {
    addEventListener: (type, handler) => {
      listeners[type] = handler
    },
    location: { origin: ORIGIN },
  }
  const caches = {
    open: (name) => {
      calls.open.push(name)
      return Promise.resolve({
        addAll: (requests) => {
          calls.addAll.push(...requests)
          return Promise.resolve()
        },
      })
    },
    match: (key, options) => {
      calls.match.push({ key, options })
      return Promise.resolve(hit)
    },
    keys: () => Promise.resolve(['sf-oldbuild', 'sf-older', 'other-app-v3', 'workbox-precache']),
    delete: (key) => {
      calls.deleted.push(key)
      return Promise.resolve(true)
    },
  }
  class Request {
    constructor(url, init = {}) {
      this.url = url
      this.cache = init.cache
    }
  }
  const fetch = (request) => {
    calls.fetched.push(request)
    return Promise.resolve('network')
  }
  new Function('self', 'caches', 'Request', 'fetch', source)(self, caches, Request, fetch)
  return { listeners, calls }
}

/** Dispatches a fetch event and resolves to whatever was passed to `respondWith`, or `undefined`. */
async function dispatchFetch(listeners, request) {
  let responded
  listeners.fetch({ request, respondWith: (promise) => (responded = promise) })
  return responded === undefined ? undefined : { response: await responded }
}

describe('the generated worker', () => {
  const { source } = buildFromDist(fixture(), BASE)

  it('precaches every asset under a prefixed cache name, past the CDN', async () => {
    // cache:'reload' bypasses the HTTP cache, so a stale edge copy of index.html cannot be paired
    // with a fresh sw.js.
    const { listeners, calls } = runWorker(source)
    let waited
    listeners.install({ waitUntil: (promise) => (waited = promise) })
    await waited

    expect(calls.open).toHaveLength(1)
    expect(calls.open[0]).toMatch(/^sf-[0-9a-f]{12}$/)
    expect(calls.addAll.map((request) => request.url)).toContain(`${BASE}index.html`)
    expect(calls.addAll).toHaveLength(5)
    for (const request of calls.addAll) expect(request.cache).toBe('reload')
  })

  it('never responds to a cross-origin request', async () => {
    // Scope governs which clients are controlled, not which requests are seen, so the token
    // endpoint and the Sheets API both reach this handler.
    const { listeners, calls } = runWorker(source)
    const request = { url: 'https://sheets.googleapis.com/v4/x', method: 'GET', mode: 'cors' }

    expect(await dispatchFetch(listeners, request)).toBeUndefined()
    expect(calls.match).toEqual([])
  })

  it('lets a non-GET request fall through to the network untouched', async () => {
    const { listeners, calls } = runWorker(source)
    const request = { url: `${ORIGIN}${BASE}x`, method: 'POST', mode: 'cors' }

    expect(await dispatchFetch(listeners, request)).toBeUndefined()
    expect(calls.match).toEqual([])
  })

  it('serves a navigation from the index key, ignoring Vary', async () => {
    // A start_url launch asks for BASE; the precached key is BASE + index.html. And caches.match
    // honours Vary by default, which Pages and vite preview both send, so without ignoreVary the
    // cache silently only works online.
    const { listeners, calls } = runWorker(source, { hit: 'cached' })
    const request = { url: `${ORIGIN}${BASE}`, method: 'GET', mode: 'navigate' }

    expect(await dispatchFetch(listeners, request)).toEqual({ response: 'cached' })
    expect(calls.match).toEqual([{ key: `${BASE}index.html`, options: { ignoreVary: true } }])
    expect(calls.fetched).toEqual([])
  })

  it('matches any other request by itself, and falls back to the network on a miss', async () => {
    const { listeners, calls } = runWorker(source)
    const request = {
      url: `${ORIGIN}${BASE}assets/index-AAAA1111.js`,
      method: 'GET',
      mode: 'no-cors',
    }

    expect(await dispatchFetch(listeners, request)).toEqual({ response: 'network' })
    expect(calls.match).toEqual([{ key: request, options: { ignoreVary: true } }])
    expect(calls.fetched).toEqual([request])
  })

  it('does not claim control on its own', () => {
    // Only src/lib/serviceWorker.js decides when a swap is safe.
    expect(source).not.toContain('clients.claim')
    expect(source).toContain("event.data.type === 'SKIP_WAITING'")
  })

  // The interesting half is which keys SURVIVE. `caches.keys()` is scoped to the ORIGIN and every
  // project Pages site under one account shares `<user>.github.io`, so a sweep of "not this
  // build" wipes every other app's precache.
  it('deletes only its own superseded caches, not everything on the origin', async () => {
    const { listeners, calls } = runWorker(source)
    let waited
    listeners.activate({ waitUntil: (promise) => (waited = promise) })
    await waited

    expect(calls.deleted.sort()).toEqual(['sf-oldbuild', 'sf-older'])
  })
})

describe('the build wiring', () => {
  it('runs the generator as part of npm run build', () => {
    // Without this the whole file above tests something that never executes.
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.scripts.build).toContain('build-sw.js')
  })

  it('emits a worker that is valid JavaScript', () => {
    // Compiled on its own, so a typo inside the template literal is named as a syntax error
    // rather than as a listener that never ran.
    const { source } = buildFromDist(fixture(), BASE)
    expect(() => new Function(source)).not.toThrow()
  })

  it('builds the bundle and the worker against the same base path', async () => {
    // Vite writes asset URLs under its `base` and the worker precaches BASE + path: two prefixes
    // means every precached URL 404s and no worker ever activates. A base other than the default
    // proves each side reads the environment rather than a constant of its own.
    const base = '/sf-test-base/'
    vi.stubEnv('VITE_BASE', base)
    vi.resetModules()
    try {
      const { default: viteConfig } = await import('../vite.config.js')
      expect(viteConfig.base).toBe(resolveBase())
      expect(viteConfig.base).toBe(base)

      // Run the builder as `npm run build` does, from a cwd holding `dist/`.
      const root = mkdtempSync(join(tmpdir(), 'sf-build-'))
      tempDirs.push(root)
      const dist = join(root, 'dist')
      mkdirSync(dist)
      writeFileSync(join(dist, 'index.html'), '<!doctype html>')
      const script = fileURLToPath(new URL('../scripts/build-sw.js', import.meta.url))
      execFileSync(process.execPath, [script], { cwd: root, env: process.env, stdio: 'pipe' })

      const { listeners, calls } = runWorker(readFileSync(join(dist, 'sw.js'), 'utf8'))
      let waited
      listeners.install({ waitUntil: (promise) => (waited = promise) })
      await waited
      expect(calls.addAll.map((request) => request.url)).toEqual([`${viteConfig.base}index.html`])
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
