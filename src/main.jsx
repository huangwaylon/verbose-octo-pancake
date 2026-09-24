import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { syncDocumentLocale } from './i18n/index.js'
import { syncDocumentAccent } from './lib/theme.js'
import { getAccessToken, getSpreadsheetId, hasKey } from './lib/connection.js'
import { startLaunchRead } from './lib/launchRead.js'
import { registerServiceWorker } from './lib/serviceWorker.js'

import './styles/tokens.css'
import './styles/base.css'
import './styles/primitives.css'
import './styles/app.css'

// Detected at module load, but neither may touch the DOM there (these modules load under vitest's
// `node` environment), so reflecting them is an explicit step — before the first render, so there
// is no flash of the default accent.
syncDocumentLocale()
syncDocumentAccent()

/**
 * Start the launch read — or, with no sheet id yet, the token — before React. Everything after it
 * is serialized, so from an effect it would wait for the whole first render to commit: 90ms behind
 * a 120-entry snapshot, 165ms behind 400, on a 4x-throttled CPU.
 *
 * The first `load` for the same sheet takes the read; the read mints through the single in-flight
 * mint. A rejected mint is swallowed because every other caller reports it with a retry. Prod-only:
 * these modules must not reach the network under vitest.
 */
if (import.meta.env.PROD && hasKey()) {
  const spreadsheetId = getSpreadsheetId()
  if (spreadsheetId) startLaunchRead(spreadsheetId)
  else getAccessToken().catch(() => {})
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Prod only: in dev the base path serves index.html for `sw.js`, which registers as a confusing
// MIME-type error rather than a clean 404.
if (import.meta.env.PROD) registerServiceWorker()
