import { describe, expect, it } from 'vitest'
import { shouldActivate } from '../src/lib/serviceWorker.js'

/** Activating reloads the page, so each refusal below is a reload someone would have watched. */
describe('shouldActivate', () => {
  const due = { waiting: true, safe: true, hidden: true, registering: false }

  it('activates a waiting worker once the page is hidden', () => {
    expect(shouldActivate(due)).toBe(true)
  })

  it('never reloads a page someone is looking at, mid-session', () => {
    expect(shouldActivate({ ...due, hidden: false })).toBe(false)
  })

  it('activates at registration, before the page has been used', () => {
    expect(shouldActivate({ ...due, hidden: false, registering: true })).toBe(true)
  })

  it('never reloads through something a reload would destroy, hidden or not', () => {
    expect(shouldActivate({ ...due, safe: false })).toBe(false)
    expect(shouldActivate({ ...due, safe: false, registering: true })).toBe(false)
  })

  it('has nothing to activate without a waiting worker', () => {
    expect(shouldActivate({ ...due, waiting: false, registering: true })).toBe(false)
  })
})
