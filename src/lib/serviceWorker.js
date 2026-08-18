/**
 * Service worker registration, and the update policy that makes it deliverable.
 *
 * Caching is the easy half. Delivery is the hard half: an installed iOS web app
 * resumed from the app switcher does not navigate, so the browser never rechecks
 * `sw.js`, and a worker that installed and went to `waiting` can sit there
 * unactivated for weeks. An app resumed daily could check for updates zero times.
 *
 * So: look for an update when the app comes back to the foreground, and activate
 * as soon as activating cannot lose anything. The reload that follows is
 * indistinguishable from a cold launch, which is what returning to the app looks
 * like anyway — but not while an entry is half-typed or a write is in flight.
 */

import { shouldRefresh } from './ledgerState.js'

/** Resume happens constantly; an update check every time would be wasteful. */
const UPDATE_CHECK_FLOOR_MS = 60 * 60_000

let safeToReload = () => true
let reloading = false
let lastCheck = 0
/** Held at module scope so `reconsiderUpdate` can reach it from outside the `.then`. */
let registration = null

/**
 * Set by the app: false while a draft is open or a write has not landed. Reloading
 * through either would silently discard someone's expense.
 */
export function setSafeToReload(predicate) {
  safeToReload = predicate
}

/**
 * Take over now if a worker is waiting and nothing would be lost.
 *
 * Exported because the answer changes for a reason this module cannot see: a worker
 * that reaches `waiting` while a form is open is refused, and the person is IN the
 * app, so no `focus` or `visibilitychange` follows to ask again. Without a nudge
 * when the draft closes, that update waits for the next time the app is backgrounded
 * — which for an installed web app can be days.
 */
export function reconsiderUpdate() {
  if (registration?.waiting && safeToReload()) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  // One reload, and only once a NEW worker has taken over. `reloading` resets with
  // the page and the fresh load has nothing waiting, so this cannot loop. It does
  // not fire on a first install, because a page that loaded uncontrolled stays
  // uncontrolled.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(
    (active) => {
      registration = active

      const onForeground = () => {
        if (document.visibilityState !== 'visible') return
        reconsiderUpdate()
        // The same floor decision as a focus-triggered sheet read, from the same
        // helper: a resumed app fires both of these events constantly.
        if (!shouldRefresh(Date.now(), lastCheck, UPDATE_CHECK_FLOOR_MS)) return
        lastCheck = Date.now()
        active.update().catch(() => {})
      }

      lastCheck = Date.now()
      reconsiderUpdate()

      active.addEventListener('updatefound', () => {
        // The new worker installs and then waits; take over when it is safe.
        active.installing?.addEventListener('statechange', reconsiderUpdate)
      })

      document.addEventListener('visibilitychange', onForeground)
      window.addEventListener('focus', onForeground)
    },
    () => {
      // Not worth surfacing: without a worker the app still works, just without
      // the instant launch.
    },
  )
}
