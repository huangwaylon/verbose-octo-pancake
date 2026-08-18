import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { syncDocumentLocale } from './i18n/index.js'
import { syncDocumentAccent } from './lib/theme.js'
import { getAccessToken, hasKey } from './lib/connection.js'
import { registerServiceWorker } from './lib/serviceWorker.js'

import './styles/tokens.css'
import './styles/base.css'
import './styles/primitives.css'
import './styles/app.css'

// Both preferences are detected at module load, but neither may touch the DOM
// there (the same modules load under vitest's `node` environment), so
// reflecting them onto <html> is an explicit step. It happens before the first
// render, so there is no flash of the default accent.
syncDocumentLocale()
syncDocumentAccent()

/**
 * Start the token before React, not from the first effect that wants one.
 *
 * Everything after it is strictly serialized — the token has to exist before the
 * `batchGet`, and the sheet read before fresh data — so every millisecond spent
 * getting here is added to the wait in full. Asking from an effect means waiting for
 * the whole first render to commit, which on a cached launch is a paint of the entire
 * ledger and grows with it: measured at 90ms behind a 120-entry snapshot and 165ms
 * behind 400, on a 4x-throttled CPU.
 *
 * It costs nothing when there is nothing to do: no key, no request. `tokenAtLeast`
 * shares the single in-flight mint, so `useConnection`'s bootstrap and the ledger's
 * first read join THIS one rather than starting a second. The rejection is swallowed
 * because both of those report the failure themselves, with a retry attached.
 *
 * Prod-only for the same reason as the service worker below: nothing imports
 * `main.jsx`, but the rule that these modules must not reach the network at import
 * time under vitest is worth keeping visibly true.
 */
if (import.meta.env.PROD && hasKey()) getAccessToken().catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Production only: `sw.js` is emitted by the build, and in dev the base path
// serves index.html for it, which registers as a confusing MIME-type error rather
// than a clean 404. Caching a dev server is its own debugging trap besides.
if (import.meta.env.PROD) registerServiceWorker()
