/**
 * The launch read, started before the first React render so it does not wait for the commit. The
 * first `load` for the same sheet takes it instead of issuing its own; anything else reads afresh.
 */

import { loadAll } from './sheets.js'

let launch = null

export function startLaunchRead(spreadsheetId, read = loadAll) {
  if (launch || !spreadsheetId) return
  const promise = read(spreadsheetId)
  // Handled here so a rejection nobody takes is not unhandled; the taker still sees it.
  promise.catch(() => {})
  launch = { spreadsheetId, promise }
}

/** The launch read's promise, once, for the sheet it read — or null. Any take discards it. */
export function takeLaunchRead(spreadsheetId) {
  const taken = launch
  launch = null
  return taken && taken.spreadsheetId === spreadsheetId ? taken.promise : null
}
