import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hedge } from '../src/lib/hedge.js'

/**
 * The hedge decides how many copies of a request go out, so every case counts the attempts
 * started and watches their signals; a result alone passes with the hedge removed.
 */

const DELAY = 1_000
const TIMEOUT = 10_000

/** An attempt whose every start is recorded, settled by the test through `settle[i]`. */
function controlled() {
  const signals = []
  const settle = []
  const attempt = vi.fn(
    (signal) =>
      new Promise((resolve, reject) => {
        const started = signals.push(signal)
        settle.push({ resolve, reject })
        signal.addEventListener('abort', () => reject(new Error(`aborted ${started}`)))
      }),
  )
  return { attempt, signals, settle }
}

/** The promise's outcome so far, without awaiting a settlement that may never come. */
function track(promise) {
  const state = { status: 'pending' }
  promise.then(
    (value) => Object.assign(state, { status: 'fulfilled', value }),
    (error) => Object.assign(state, { status: 'rejected', error }),
  )
  return state
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('hedge', () => {
  it('sends one attempt when it answers before the delay', async () => {
    const { attempt, settle } = controlled()
    const outcome = track(hedge(attempt, { timeoutMs: TIMEOUT, delayMs: DELAY }))

    await vi.advanceTimersByTimeAsync(DELAY - 1)
    settle[0].resolve('fast')
    await vi.advanceTimersByTimeAsync(TIMEOUT * 2)

    expect(outcome).toEqual({ status: 'fulfilled', value: 'fast' })
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('starts exactly one second attempt at the delay, takes the first to fulfil, aborts the other', async () => {
    const { attempt, signals, settle } = controlled()
    const outcome = track(hedge(attempt, { timeoutMs: TIMEOUT, delayMs: DELAY }))

    await vi.advanceTimersByTimeAsync(DELAY - 1)
    expect(attempt).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(attempt).toHaveBeenCalledTimes(2)

    settle[1].resolve('second')
    await vi.advanceTimersByTimeAsync(0)

    expect(outcome).toEqual({ status: 'fulfilled', value: 'second' })
    expect(signals[0].aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(TIMEOUT * 2)
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('does not retry: a rejection before the delay is the answer', async () => {
    const { attempt, settle } = controlled()
    const outcome = track(hedge(attempt, { timeoutMs: TIMEOUT, delayMs: DELAY }))

    settle[0].reject(new Error('refused'))
    await vi.advanceTimersByTimeAsync(TIMEOUT * 2)

    expect(outcome.status).toBe('rejected')
    expect(outcome.error.message).toBe('refused')
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('waits for the other attempt when one rejects after the delay', async () => {
    const { attempt, settle } = controlled()
    const outcome = track(hedge(attempt, { timeoutMs: TIMEOUT, delayMs: DELAY }))
    await vi.advanceTimersByTimeAsync(DELAY)

    settle[0].reject(new Error('first'))
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome.status).toBe('pending')

    settle[1].resolve('second')
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toEqual({ status: 'fulfilled', value: 'second' })
  })

  it('rejects with the FIRST attempt’s error when both fail, whichever failed last', async () => {
    const { attempt, settle } = controlled()
    const outcome = track(hedge(attempt, { timeoutMs: TIMEOUT, delayMs: DELAY }))
    await vi.advanceTimersByTimeAsync(DELAY)

    settle[1].reject(new Error('second'))
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome.status).toBe('pending')
    settle[0].reject(new Error('first'))
    await vi.advanceTimersByTimeAsync(0)

    expect(outcome.status).toBe('rejected')
    expect(outcome.error.message).toBe('first')
  })

  it('aborts each attempt on its own timeout, counted from its own start', async () => {
    const { attempt, signals } = controlled()
    const outcome = track(hedge(attempt, { timeoutMs: TIMEOUT, delayMs: DELAY }))

    await vi.advanceTimersByTimeAsync(TIMEOUT)
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false])
    expect(outcome.status).toBe('pending')

    await vi.advanceTimersByTimeAsync(DELAY)
    expect(signals[1].aborted).toBe(true)
    expect(outcome.status).toBe('rejected')
    expect(outcome.error.message).toBe('aborted 1')
  })

  it('never sends a second attempt without a delay, and still times the one', async () => {
    const { attempt, signals } = controlled()
    const outcome = track(hedge(attempt, { timeoutMs: TIMEOUT }))

    await vi.advanceTimersByTimeAsync(TIMEOUT)

    expect(attempt).toHaveBeenCalledTimes(1)
    expect(signals[0].aborted).toBe(true)
    expect(outcome.status).toBe('rejected')
  })
})
