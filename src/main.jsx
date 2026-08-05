import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { syncDocumentLocale } from './i18n/index.js'

import './styles/tokens.css'
import './styles/base.css'
import './styles/primitives.css'
import './styles/app.css'

// Locale detection happens at module load, but it must not touch the DOM there
// (the same module loads under vitest's `node` environment), so reflecting it
// onto <html lang> and the title is an explicit step here.
syncDocumentLocale()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
