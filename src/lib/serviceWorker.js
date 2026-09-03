/**
 * Service worker registration, and the update policy that makes it deliverable. An installed iOS
 * web app resumed from the app switcher does not navigate, so the browser never rechecks `sw.js`
 * and a worker that reached `waiting` can sit there for weeks. So: look for an update on
 * foreground, and activate as soon as activating cannot lose anything — never while an entry is
 * half-typed or a write is in flight.
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
 * Set by the app: false while a draft is open or a write has not landed. Reloading through either
 * would silently discard someone's expense.
 */
export function setSafeToReload(predicate) {
  safeToReload = predicate
}

/**
 * Take over now if a worker is waiting and nothing would be lost. Exported because a worker
 * refused while a form was open gets no `focus` or `visibilitychange` to ask again, and for an
 * installed web app the next backgrounding can be days away.
 */
export function reconsiderUpdate() {
  if (registration?.waiting && safeToReload()) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' })
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  // One reload, and only once a NEW worker has taken over. `reloading` resets with the page and
  // the fresh load has nothing waiting, so this cannot loop.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then(
    (registered) => {
      registration = registered

      const onForeground = () => {
        if (document.visibilityState !== 'visible') return
        reconsiderUpdate()
        // The same floor as a focus-triggered sheet read: a resumed app fires both events
        // constantly.
        if (!shouldRefresh(Date.now(), lastCheck, UPDATE_CHECK_FLOOR_MS)) return
        lastCheck = Date.now()
        registered.update().catch(() => {})
      }

      lastCheck = Date.now()
      reconsiderUpdate()

      // `register()` runs its own update check, so a new worker can already be INSTALLING before
      // the `updatefound` listener exists. Unhooked, that one gets no `statechange`, and
      // `reconsiderUpdate` only looks at `waiting`, so for somebody who stays in the app nothing
      // ever asks again. Idempotent, since `reconsiderUpdate` re-reads the registration.
      registered.installing?.addEventListener('statechange', reconsiderUpdate)

      registered.addEventListener('updatefound', () => {
        registered.installing?.addEventListener('statechange', reconsiderUpdate)
      })

      document.addEventListener('visibilitychange', onForeground)
      window.addEventListener('focus', onForeground)
    },
    () => {
      // Not worth surfacing: without a worker the app still works, just without the instant
      // launch.
    },
  )
}
