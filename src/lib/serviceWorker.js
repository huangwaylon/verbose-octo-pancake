/**
 * Service worker registration, and the update policy that makes it deliverable. An installed iOS
 * web app resumed from the app switcher does not navigate, so the browser never rechecks `sw.js`
 * and a worker that reached `waiting` can sit there for weeks. So: look for an update on
 * foreground, and take it over only where the reload goes unseen and loses nothing — never while
 * an entry is half-typed or a write is in flight.
 */

import { shouldRefresh } from './ledgerState.js'

/** Resume happens constantly; an update check every time would be wasteful. */
const UPDATE_CHECK_FLOOR_MS = 60 * 60_000

let safeToReload = () => true
let reloading = false
/** A new worker controls this page, so it is running an old build until it reloads. */
let reloadDue = false
let lastCheck = 0
/** Held at module scope so `reconsiderUpdate` can reach it from outside the `.then`. */
let registration = null

/**
 * Set by the app: false while a draft is open or a write has not landed. Reloading through either
 * would silently discard someone's expense.
 */
export function setSafeToReload(predicate) {
  safeToReload = predicate
}

/**
 * The next step of an update, or null. Both steps end in a reload, so both wait for the page to be
 * out of sight as well as safe: a worker installed mid-session would otherwise reload a ledger
 * someone is reading. The reload waits on its own, because iOS can suspend a hidden page before
 * the worker takes over and deliver `controllerchange` on the next resume, in full view.
 */
export function updateStep({ hidden, safe, reloadDue, waiting }) {
  if (!hidden || !safe) return null
  if (reloadDue) return 'reload'
  return waiting ? 'activate' : null
}

/**
 * Take the next step if `updateStep` allows it. Exported because a refusal while a form was open
 * or a write in flight must be asked again once that settles; backgrounding asks too.
 */
export function reconsiderUpdate() {
  const step = updateStep({
    hidden: document.visibilityState === 'hidden',
    safe: safeToReload(),
    reloadDue,
    waiting: Boolean(registration?.waiting),
  })
  if (step === 'activate') registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  if (step === 'reload' && !reloading) {
    // Once: the fresh load has nothing waiting and no new controller, so this cannot loop.
    reloading = true
    window.location.reload()
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    reloadDue = true
    reconsiderUpdate()
  })

  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(
    (registered) => {
      registration = registered

      const onVisibility = () => {
        reconsiderUpdate()
        if (document.visibilityState !== 'visible') return
        // The same floor as a focus-triggered sheet read: a resumed app fires both events
        // constantly.
        if (!shouldRefresh(Date.now(), lastCheck, UPDATE_CHECK_FLOOR_MS)) return
        lastCheck = Date.now()
        registered.update().catch(() => {})
      }

      lastCheck = Date.now()
      reconsiderUpdate()

      // `register()` runs its own update check, so a new worker can already be INSTALLING before
      // the `updatefound` listener exists. Unhooked, one that finishes installing after the page
      // was hidden is not asked until the next backgrounding. Idempotent, since
      // `reconsiderUpdate` re-reads the registration.
      registered.installing?.addEventListener('statechange', reconsiderUpdate)

      registered.addEventListener('updatefound', () => {
        registered.installing?.addEventListener('statechange', reconsiderUpdate)
      })

      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('focus', onVisibility)
    },
    () => {
      // Not worth surfacing: without a worker the app still works, just without the instant
      // launch.
    },
  )
}
