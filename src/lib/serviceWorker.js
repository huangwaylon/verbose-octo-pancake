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

/** Resume happens constantly; an update check every time would be wasteful. */
const UPDATE_CHECK_FLOOR_MS = 60 * 60_000

let safeToReload = () => true
let reloading = false
let lastCheck = 0

/**
 * Set by the app: false while a draft is open or a write has not landed. Reloading
 * through either would silently discard someone's expense.
 */
export function setSafeToReload(predicate) {
  safeToReload = predicate
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
    (registration) => {
      const activateIfSafe = () => {
        if (registration.waiting && safeToReload()) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' })
        }
      }

      const onForeground = () => {
        if (document.visibilityState !== 'visible') return
        activateIfSafe()
        const now = Date.now()
        if (now - lastCheck < UPDATE_CHECK_FLOOR_MS) return
        lastCheck = now
        registration.update().catch(() => {})
      }

      lastCheck = Date.now()
      activateIfSafe()

      registration.addEventListener('updatefound', () => {
        // The new worker installs and then waits; take over when it is safe.
        registration.installing?.addEventListener('statechange', activateIfSafe)
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
