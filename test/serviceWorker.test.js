import { describe, expect, it } from 'vitest'
import { updateStep } from '../src/lib/serviceWorker.js'

/** Both steps end in a reload, so each refusal below is a reload someone would have watched. */
describe('updateStep', () => {
  const quiet = { hidden: true, safe: true, reloadDue: false, waiting: true }

  it('activates a waiting worker once the page is hidden', () => {
    expect(updateStep(quiet)).toBe('activate')
  })

  it('reloads a page a new worker already controls, once it is hidden', () => {
    expect(updateStep({ ...quiet, reloadDue: true, waiting: false })).toBe('reload')
  })

  it('does nothing in view, even with a new worker already in control', () => {
    expect(updateStep({ ...quiet, hidden: false })).toBe(null)
    expect(updateStep({ ...quiet, hidden: false, reloadDue: true })).toBe(null)
  })

  it('does nothing through something a reload would destroy, hidden or not', () => {
    expect(updateStep({ ...quiet, safe: false })).toBe(null)
    expect(updateStep({ ...quiet, safe: false, reloadDue: true })).toBe(null)
  })

  it('has nothing to do with no worker waiting and none in control', () => {
    expect(updateStep({ ...quiet, waiting: false })).toBe(null)
  })
})
