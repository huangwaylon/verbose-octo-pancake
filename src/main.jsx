import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { syncDocumentLocale } from './i18n/index.js'
import { syncDocumentAccent } from './lib/theme.js'

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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
