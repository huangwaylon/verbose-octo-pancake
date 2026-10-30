/**
 * One timed attempt, plus a second started alongside it if the first is still out after
 * `delayMs` — the slow tail of a round trip, not a failure, is what makes a refresh take "many
 * seconds". The first attempt to FULFIL wins and the other is aborted. It is not a retry: a
 * rejection before the delay is the answer, and with both out the call rejects only once both
 * have, with the first attempt's error so the outcome does not depend on which failed last.
 *
 * Only for a request that is harmless to send twice. Without `delayMs` it is one timed attempt.
 *
 * `attempt(signal)` returns a promise, and must do ALL of its waiting — headers and body — before
 * it settles: `signal` aborts on the attempt's own `timeoutMs`, whose timer stops when it settles,
 * and on losing.
 */
export function hedge(attempt, { timeoutMs, delayMs = null }) {
  return new Promise((resolve, reject) => {
    const controllers = []
    let firstError
    let failures = 0
    let settled = false
    let hedgeTimer = null

    const finish = (settle, value) => {
      settled = true
      clearTimeout(hedgeTimer)
      for (const controller of controllers) controller.abort()
      settle(value)
    }

    const launch = () => {
      const index = controllers.length
      const controller = new AbortController()
      controllers.push(controller)
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      attempt(controller.signal)
        .finally(() => clearTimeout(timer))
        .then(
          (value) => {
            if (!settled) finish(resolve, value)
          },
          (error) => {
            if (settled) return
            if (index === 0) firstError = error
            failures += 1
            if (failures === controllers.length) finish(reject, firstError)
          },
        )
    }

    launch()
    if (delayMs !== null) hedgeTimer = setTimeout(launch, delayMs)
  })
}
