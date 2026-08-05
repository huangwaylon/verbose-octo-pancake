/**
 * Google Picker integration.
 *
 * The picker is what keeps the OAuth grant narrow: with the `drive.file` scope
 * the app can only touch files the user explicitly picks here, plus files it
 * creates itself. There is no "list all my spreadsheets" access.
 */

import { GOOGLE_API_KEY, GOOGLE_CLIENT_ID } from '../config.js'
import { getAccessToken } from './googleAuth.js'

const GAPI_SRC = 'https://apis.google.com/js/api.js'
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets'

/**
 * The Cloud project number, which is the numeric prefix of the OAuth client ID
 * ("726967089583-abc....apps.googleusercontent.com" -> "726967089583").
 *
 * The Picker needs it via setAppId so the file the user picks is granted to
 * *this* app under `drive.file`. Derived rather than hardcoded as a second
 * config value, because the two must never disagree.
 */
function projectNumber() {
  const [prefix] = String(GOOGLE_CLIENT_ID).split('-')
  return /^\d+$/.test(prefix) ? prefix : ''
}

let pickerPromise = null

/** Injects api.js and loads the picker module at most once. */
function loadPicker() {
  if (pickerPromise) return pickerPromise

  pickerPromise = new Promise((resolve, reject) => {
    const onScriptReady = () => {
      window.gapi.load('picker', {
        callback: () => {
          if (window.google?.picker) resolve(window.google.picker)
          else reject(new Error('Google Picker loaded but is unavailable.'))
        },
        onerror: () => {
          pickerPromise = null
          reject(new Error('Could not load the Google Picker module.'))
        },
      })
    }

    if (window.gapi?.load) {
      onScriptReady()
      return
    }

    const existing = document.querySelector(`script[src="${GAPI_SRC}"]`)
    const script = existing ?? document.createElement('script')

    script.addEventListener('load', onScriptReady, { once: true })
    script.addEventListener(
      'error',
      () => {
        pickerPromise = null
        reject(new Error('Could not load the Google Picker. Check your network connection.'))
      },
      { once: true },
    )

    if (!existing) {
      script.src = GAPI_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  })

  return pickerPromise
}

/**
 * Show the picker so the user chooses the shared spreadsheet.
 *
 * @returns {Promise<{id: string, name: string}|null>} null when cancelled
 */
export async function pickSpreadsheet() {
  const [picker, token] = await Promise.all([loadPicker(), getAccessToken()])
  if (!GOOGLE_API_KEY) {
    throw new Error('Missing VITE_GOOGLE_API_KEY. See SETUP.md.')
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    try {
      const appId = projectNumber()
      const builder = new picker.PickerBuilder()
        .addView(new picker.View(picker.ViewId.SPREADSHEETS))
        .setOAuthToken(token)
        .setDeveloperKey(GOOGLE_API_KEY)
        // Without an origin the Picker infers one from the frame it renders in,
        // which breaks when the page is served under a sub-path (GitHub Pages
        // serves this app from /verbose-octo-pancake/). Pass the bare origin —
        // scheme + host + port, never a path.
        .setOrigin(`${window.location.protocol}//${window.location.host}`)
        .setTitle('Choose your shared finances sheet')
        // NAV_HIDDEN drops the side navigation pane, without which the picker
        // is unusable on a phone-width screen.
        .enableFeature(picker.Feature.NAV_HIDDEN)
        .setCallback((data) => {
          if (data.action === picker.Action.PICKED) {
            const doc = data.docs?.[0]
            finish(doc ? { id: doc.id, name: doc.name ?? '' } : null)
          } else if (data.action === picker.Action.CANCEL) {
            finish(null)
          }
        })

      // Required for `drive.file`: it is what tells Drive to grant the picked
      // file to this app. Skipped only if the client ID is malformed, since
      // setAppId('') is worse than not calling it.
      if (appId) builder.setAppId(appId)

      const dialog = builder.build()
      dialog.setVisible(true)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

/**
 * Create a fresh spreadsheet for first-run users.
 *
 * A file the app creates is covered by `drive.file` without any picker step,
 * so this is a one-tap alternative to picking an existing sheet. The new file
 * has only Google's default empty tab — call `ensureStructure` next.
 *
 * @returns {Promise<{id: string, name: string}>}
 */
export async function createSpreadsheet(name) {
  const token = await getAccessToken()
  const response = await fetch(SHEETS_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties: { title: name } }),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const message = data?.error?.message ?? response.statusText
    const error = new Error(`Could not create the spreadsheet: ${message} (HTTP ${response.status})`)
    error.status = response.status
    throw error
  }

  return { id: data.spreadsheetId, name: data.properties?.title ?? name }
}
