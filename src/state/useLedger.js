import { useCallback, useEffect, useRef, useState } from 'react'
import { mergeConfig } from '../config.js'
import { PEOPLE, expensesTab, makeEntry, validateEntryCodes } from '../schema.js'
import { t } from '../i18n/index.js'
import * as sheets from '../lib/sheets.js'
import { readSnapshot, writeSnapshot } from '../lib/snapshot.js'

/** Floor between focus-triggered refreshes. Window switching is constant. */
const REFRESH_THROTTLE_MS = 30_000

/**
 * An error the UI can translate at render time, in whatever locale is current,
 * while `message` stays a readable English fallback for anything that only logs.
 */
function i18nError(key, vars) {
  const error = new Error(t(key, vars))
  error.i18nKey = key
  return error
}

/** A missing tab or range surfaces as a 400 from the values endpoint. */
function looksUninitialized(cause) {
  return cause?.status === 400 || cause?.status === 404
}

/**
 * Owns the entry list for one spreadsheet.
 *
 * The id is a parameter rather than state: it arrives from the token endpoint
 * alongside the access token, so this hook no longer chooses or stores a
 * spreadsheet. There is no picker and no "switch sheet" — there is exactly one
 * ledger, named by the script's SHEET_ID property.
 *
 * Every mutation is applied to local state first and reconciled against the
 * sheet afterwards, because each write is a ~400ms round trip on phone data. A
 * failed write reverts the optimistic change and rethrows so the caller can
 * surface it.
 *
 * Status is one of `idle | loading | stale | refreshing | ready | error`.
 * `stale` means "showing cached data": it is where a seeded launch starts, and
 * where a failed refresh lands. Only `idle`, `loading` and `error` gate the UI.
 */
export function useLedger(spreadsheetId) {
  // Read once per mount. Every launch after the first already has the id in
  // localStorage, so it is available on the very first render and the cached
  // ledger paints with no empty frame in front of it.
  const [seed] = useState(() => readSnapshot(spreadsheetId))
  const [entries, setEntries] = useState(() => seed?.entries ?? [])
  const [config, setConfig] = useState(() => mergeConfig(seed?.config))
  const [sheetIds, setSheetIds] = useState({})
  const [status, setStatus] = useState(() => (seed ? 'stale' : 'idle'))
  const [error, setError] = useState(null)

  const loadedFor = useRef(null)
  /** Whether there has ever been something real to show, cached or loaded. */
  const everLoaded = useRef(Boolean(seed))

  /**
   * Serialising the whole ledger is the expensive half of the cache, and
   * `applyLoad` runs on every focus refresh — exactly as someone returns to the
   * app and reaches for a button. Defer past the interaction.
   * `requestIdleCallback` would fit better but Safari does not implement it.
   */
  const persistTimer = useRef(null)
  const persist = useCallback((id, nextEntries, sheetConfig) => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null
      writeSnapshot(id, nextEntries, sheetConfig)
    }, 0)
  }, [])

  useEffect(() => () => clearTimeout(persistTimer.current), [])

  const applyLoad = useCallback(
    (id, data) => {
      const loaded = data.entries ?? []
      setEntries((current) => {
        // Keep optimistic rows the server has not acknowledged yet. A refresh
        // that started before an append would otherwise drop the new row, and
        // persisting that truncated list makes the loss survive a relaunch.
        const seen = new Set(loaded.map((entry) => entry.id))
        const inFlight = current.filter((entry) => entry.pending && !seen.has(entry.id))
        return inFlight.length ? [...loaded, ...inFlight] : loaded
      })
      // Config before amounts, always: the balance and the month totals format
      // at `config.currency`, so entries seeded against a stale currency render
      // at the wrong scale. Same ordering rule as `loadAll`.
      setConfig(mergeConfig(data.sheetConfig))
      if (data.sheetIds) setSheetIds(data.sheetIds)
      setError(null)
      setStatus('ready')
      everLoaded.current = true
      persist(id, loaded, data.sheetConfig)
    },
    [persist],
  )

  const load = useCallback(
    async (id, { quiet = false } = {}) => {
      if (!quiet) setStatus((current) => (current === 'idle' ? 'loading' : 'refreshing'))

      /** Cached data beats an error screen — the sheet has not changed just
          because we cannot reach it. This is the offline launch. */
      const fail = (cause) => {
        setError(cause.message || t('error.readSheet'))
        setStatus(everLoaded.current ? 'stale' : 'error')
      }

      try {
        applyLoad(id, await sheets.loadAll(id))
      } catch (cause) {
        // A sheet that has never been used has no tabs yet; set it up and retry
        // once. This is the only path that builds structure, and it refuses a
        // spreadsheet that already looks like somebody else's work.
        if (looksUninitialized(cause)) {
          try {
            const { sheetIds: ids } = await sheets.ensureStructure(id)
            setSheetIds(ids ?? {})
            applyLoad(id, await sheets.loadAll(id))
          } catch (secondCause) {
            fail(secondCause)
          }
          return
        }
        fail(cause)
      }
    },
    [applyLoad],
  )

  useEffect(() => {
    if (!spreadsheetId) {
      // Disconnected: drop everything, and clear `loadedFor` so reconnecting to
      // the same sheet still triggers a read rather than short-circuiting.
      loadedFor.current = null
      everLoaded.current = false
      setEntries([])
      setConfig(mergeConfig())
      setSheetIds({})
      setStatus('idle')
      setError(null)
      return
    }
    if (loadedFor.current === spreadsheetId) return
    loadedFor.current = spreadsheetId
    load(spreadsheetId)
  }, [spreadsheetId, load])

  const refresh = useCallback(() => {
    if (!spreadsheetId) return Promise.resolve()
    return load(spreadsheetId)
  }, [spreadsheetId, load])

  /**
   * Re-read the sheet when the tab regains attention. Two people share one
   * spreadsheet with no push channel, so without this whoever leaves the app
   * open sits on stale data. Throttled, because switching windows is constant
   * and every refresh spends per-user quota.
   */
  const lastRefresh = useRef(0)
  useEffect(() => {
    if (!spreadsheetId) return

    const maybeRefresh = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastRefresh.current < REFRESH_THROTTLE_MS) return
      lastRefresh.current = now
      refresh()
    }

    window.addEventListener('focus', maybeRefresh)
    document.addEventListener('visibilitychange', maybeRefresh)
    return () => {
      window.removeEventListener('focus', maybeRefresh)
      document.removeEventListener('visibilitychange', maybeRefresh)
    }
  }, [spreadsheetId, refresh])

  const addEntry = useCallback(
    async (input) => {
      const entry = makeEntry(input)
      const problems = validateEntryCodes(entry)
      if (problems.length) throw i18nError(`error.${problems[0]}`)

      setEntries((current) => [...current, { ...entry, pending: true }])
      try {
        const { rowNumber } = await sheets.appendEntry(spreadsheetId, entry)
        setEntries((current) =>
          current.map((item) => (item.id === entry.id ? { ...entry, rowNumber } : item)),
        )
        return entry
      } catch (cause) {
        setEntries((current) => current.filter((item) => item.id !== entry.id))
        throw cause
      }
    },
    [spreadsheetId],
  )

  const editEntry = useCallback(
    async (input) => {
      const entry = makeEntry(input)
      const problems = validateEntryCodes(entry)
      if (problems.length) throw i18nError(`error.${problems[0]}`)

      let previous
      setEntries((current) =>
        current.map((item) => {
          if (item.id !== entry.id) return item
          previous = item
          return { ...entry, rowNumber: item.rowNumber, pending: true }
        }),
      )
      try {
        // previous.payer, not entry.payer: it says which tab the row is
        // CURRENTLY in, which is what updateEntry needs to find it before it can
        // move the row if the payer changed.
        await sheets.updateEntry(spreadsheetId, entry, previous?.payer)
        setEntries((current) =>
          current.map((item) => (item.id === entry.id ? { ...item, pending: false } : item)),
        )
        return entry
      } catch (cause) {
        if (previous) {
          setEntries((current) => current.map((item) => (item.id === entry.id ? previous : item)))
        }
        throw cause
      }
    },
    [spreadsheetId],
  )

  const setDeleted = useCallback(
    async (id, payer, deletedAt) => {
      let previous
      setEntries((current) =>
        current.map((item) => {
          if (item.id !== id) return item
          previous = item
          return { ...item, deletedAt, pending: true }
        }),
      )
      try {
        await sheets.setDeletedAt(spreadsheetId, payer, id, deletedAt)
        setEntries((current) =>
          current.map((item) => (item.id === id ? { ...item, pending: false } : item)),
        )
      } catch (cause) {
        if (previous) {
          setEntries((current) => current.map((item) => (item.id === id ? previous : item)))
        }
        throw cause
      }
    },
    [spreadsheetId],
  )

  const removeEntry = useCallback(
    (id, payer) => setDeleted(id, payer, new Date().toISOString()),
    [setDeleted],
  )
  const restoreEntry = useCallback((id, payer) => setDeleted(id, payer, null), [setDeleted])

  /** Hard-delete tombstoned rows. Deliberate and manual — never in the hot path. */
  const compact = useCallback(async () => {
    if (!entries.some((item) => item.deletedAt)) return { removed: 0 }

    // `values.batchGet` cannot report sheet gids, so a session that only ever
    // read the sheet has none cached and has to ask for them here.
    let gids = sheetIds
    const missingGid = () => PEOPLE.some((person) => gids[expensesTab(person)] == null)
    if (missingGid()) {
      const { sheetIds: refreshed } = await sheets.ensureStructure(spreadsheetId)
      setSheetIds(refreshed ?? {})
      gids = refreshed ?? {}
    }
    if (missingGid()) throw new Error('Could not find the expenses tabs.')

    const result = await sheets.compact(spreadsheetId, gids)
    await refresh()
    return result
  }, [entries, sheetIds, spreadsheetId, refresh])

  return {
    entries,
    config,
    status,
    error,
    tombstoneCount: entries.filter((item) => item.deletedAt).length,
    refresh,
    addEntry,
    editEntry,
    removeEntry,
    restoreEntry,
    compact,
  }
}
