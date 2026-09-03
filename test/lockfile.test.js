import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guards package-lock.json against private-registry URLs. `npm install` bakes whatever
 * registry it used into every `resolved` URL, and this machine's env points at an internal
 * mirror — producing a lockfile that works locally and fails everywhere else with
 * `getaddrinfo ENOTFOUND`, which npm surfaces as the useless "Exit handler never called!".
 * A repo .npmrc cannot prevent it (env vars rank higher); the fix is in the messages below.
 */

const PUBLIC_REGISTRY = 'https://registry.npmjs.org/'

const lock = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package-lock.json', import.meta.url)), 'utf8'),
)

const entries = Object.entries(lock.packages).filter(([name]) => name !== '')

describe('package-lock.json', () => {
  it('resolves every dependency from the public npm registry', () => {
    const offenders = entries
      .filter(([, meta]) => meta.resolved && !meta.resolved.startsWith(PUBLIC_REGISTRY))
      .map(([name, meta]) => `${name} -> ${meta.resolved}`)

    expect(
      offenders,
      'These packages resolve from a non-public registry, so `npm ci` will fail ' +
        'anywhere that registry is unreachable (CI included). Regenerate with:\n' +
        '  rm -rf node_modules package-lock.json\n' +
        '  npm install --registry=https://registry.npmjs.org\n',
    ).toEqual([])
  })

  it('records a resolved URL for every package', () => {
    const missing = entries.filter(([, meta]) => !meta.link && !meta.resolved).map(([name]) => name)

    expect(
      missing,
      'These entries have no `resolved` URL, which usually means the lockfile was ' +
        'built with `--package-lock-only` against a warm cache. Do a real install ' +
        'from a clean slate so every entry is populated.\n',
    ).toEqual([])
  })

  it('is lockfileVersion 3', () => {
    expect(lock.lockfileVersion).toBe(3)
  })
})
