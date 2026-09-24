import { beforeEach, describe, expect, it, vi } from 'vitest'

// The read `main.jsx` starts before the first render. Module state, so each test re-imports.

vi.mock('../src/lib/connection.js', () => ({
  getAccessToken: vi.fn(async () => 'ya29.stub-token'),
  refreshToken: vi.fn(async () => {}),
}))

let launch
beforeEach(async () => {
  vi.resetModules()
  launch = await import('../src/lib/launchRead.js')
})

describe('the launch read', () => {
  it('is taken once, by the first load of the same sheet', async () => {
    const read = vi.fn(async () => ({ entries: [] }))
    launch.startLaunchRead('sheet-a', read)
    const taken = launch.takeLaunchRead('sheet-a')
    expect(await taken).toEqual({ entries: [] })
    // A second read, a focus refresh, must reach the sheet rather than replay the launch.
    expect(launch.takeLaunchRead('sheet-a')).toBe(null)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('is never handed to a load for another sheet, nor kept for a later one', () => {
    launch.startLaunchRead('sheet-a', async () => ({ entries: [] }))
    expect(launch.takeLaunchRead('sheet-b')).toBe(null)
    expect(launch.takeLaunchRead('sheet-a')).toBe(null)
  })

  it('starts once, and not at all with no sheet id', () => {
    const read = vi.fn(async () => ({}))
    launch.startLaunchRead(null, read)
    launch.startLaunchRead('sheet-a', read)
    launch.startLaunchRead('sheet-a', read)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('hands its rejection to the taker, and is not unhandled while nobody has taken it', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const cause = Object.assign(new Error('no tabs'), { status: 400 })
      launch.startLaunchRead('sheet-a', () => Promise.reject(cause))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
      // The taker still sees the cause, so `looksUninitialized` can take the setup path.
      await expect(launch.takeLaunchRead('sheet-a')).rejects.toBe(cause)
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
