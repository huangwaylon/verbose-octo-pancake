/**
 * Service worker registration, and the update policy that makes it deliverable. An installed iOS
 * web app resumed from the app switcher does not navigate, so the browser never rechecks `sw.js`
 * and a worker that reached `waiting` can sit there for weeks. So: look for an update on
 * foreground, and activate once activating cannot lose anything — never while an entry is
 * half-typed or a write is in flight — and only where the reload it causes goes unseen.
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
 * Activating reloads the page, so it waits for the page to be out of sight: a worker installed
 * during a session would otherwise reload a ledger someone is reading, seconds after launch. The
 * one visible exception is registration, before anyone has touched the page — a worker left
 * waiting by a session killed while hidden.
 */
export function shouldActivate({ waiting, safe, hidden, registering }) {
  return waiting && safe && (hidden || registering)
}

function activateIfDue(registering = false) {
  const due = shouldActivate({
    waiting: Boolean(registration?.waiting),
    safe: safeToReload(),
    hidden: document.visibilityState === 'hidden',
    registering,
  })
  if (due) registration.waiting.postMessage({ type: 'SKIP_WAITING' })
}

/**
 * Take over if `shouldActivate` allows it. Exported because a worker refused while a form was
 * open must be asked again once it closes, and the next backgrounding re-asks too.
 */
export function reconsiderUpdate() {
  activateIfDue()
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
      activateIfDue(true)

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
