import { useCallback, useEffect, useRef, useState } from 'react'
import { mergeConfig } from '../config.js'
import { makeEntry, validateEntryCodes } from '../schema.js'
import { i18nError, t } from '../i18n/index.js'
import * as sheets from '../lib/sheets.js'
import {
  acknowledge,
  entryById,
  hasTombstones,
  mergeLoaded,
  missingExpenseGid,
  reverted,
  settled,
  shouldRefresh,
  statusOnLoadFailure,
  statusOnLoadStart,
  tombstoneCount,
  withPending,
  withPendingDeletedAt,
  withPendingEdit,
  without,
} from '../lib/ledgerState.js'
import { readSnapshot, writeSnapshot } from '../lib/snapshot.js'

/** Floor between focus-triggered refreshes. Window switching is constant. */
const REFRESH_THROTTLE_MS = 30_000

/** A missing tab or range surfaces as a 400 from the values endpoint. */
function looksUninitialized(cause) {
  return cause?.status === 400 || cause?.status === 404
}

/**
 * Owns the entry list for one spreadsheet.
 *
 * The id is a parameter rather than state: it arrives from the token endpoint
 * alongside the access token. There is exactly one ledger, named by the script's
 * SHEET_ID property, so nothing here chooses or stores a spreadsheet.
 *
 * Every mutation is applied to local state first and reconciled against the
 * sheet afterwards, because each write is a ~400ms round trip on phone data. A
 * failed write reverts the optimistic change and rethrows so the caller can
 * surface it.
 *
 * What is left here is the part that needs React and a network: state, effects,
 * and the order of the calls. Which list follows from which — and every status
 * decision — is in `lib/ledgerState.js`, where it can be tested without a DOM.
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
      setEntries((current) => mergeLoaded(current, loaded))
      // Config before amounts, always: the balance and the month totals format
      // at `config.currency`, so entries seeded against a stale currency render
      // at the wrong scale. Same ordering rule as `loadAll`.
      setConfig(mergeConfig(data.sheetConfig))
      setError(null)
      setStatus('ready')
      everLoaded.current = true
      // The loaded list, never the merged one: a pending row persisted here comes
      // back next launch looking saved.
      persist(id, loaded, data.sheetConfig)
    },
    [persist],
  )

  const load = useCallback(
    async (id) => {
      setStatus(statusOnLoadStart)

      const fail = (cause) => {
        setError(cause.message || t('error.readSheet'))
        setStatus(statusOnLoadFailure(everLoaded.current))
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
      if (!shouldRefresh(now, lastRefresh.current, REFRESH_THROTTLE_MS)) return
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

  /** Both write paths validate the same way: codes, never English sentences. */
  const validated = (input) => {
    const entry = makeEntry(input)
    const problems = validateEntryCodes(entry)
    if (problems.length) throw i18nError(`error.${problems[0]}`)
    return entry
  }

  const addEntry = useCallback(
    async (input) => {
      const entry = validated(input)

      setEntries((current) => withPending(current, entry))
      try {
        await sheets.appendEntry(spreadsheetId, entry)
        setEntries((current) => acknowledge(current, entry))
        return entry
      } catch (cause) {
        setEntries((current) => without(current, entry.id))
        throw cause
      }
    },
    [spreadsheetId],
  )

  const editEntry = useCallback(
    async (input) => {
      const entry = validated(input)

      let previous
      setEntries((current) => {
        previous = entryById(current, entry.id)
        return withPendingEdit(current, entry)
      })

      /**
       * Refuse rather than guess which tab the row is in.
       *
       * `previous.payer` is the row's CURRENT tab, which is what `updateEntry`
       * needs before it can move the row. If the entry is not in local state —
       * the other person deleted it and a focus refresh dropped it while this
       * form was open — then passing `undefined` made `previousPayer !==
       * entry.payer` true, so the write took the payer-changed branch: it
       * appended a second row and then looked for the original in whichever tab
       * `expensesTab` defaulted to. A duplicate expense, silently.
       */
      if (!previous) throw i18nError('error.entryGone')

      try {
        await sheets.updateEntry(spreadsheetId, entry, previous.payer)
        setEntries((current) => settled(current, entry.id))
        return entry
      } catch (cause) {
        setEntries((current) => reverted(current, entry.id, previous))
        throw cause
      }
    },
    [spreadsheetId],
  )

  const setDeleted = useCallback(
    async (id, payer, deletedAt) => {
      let previous
      setEntries((current) => {
        previous = entryById(current, id)
        return withPendingDeletedAt(current, id, deletedAt)
      })
      try {
        await sheets.setDeletedAt(spreadsheetId, payer, id, deletedAt)
        setEntries((current) => settled(current, id))
      } catch (cause) {
        setEntries((current) => reverted(current, id, previous))
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
    if (!hasTombstones(entries)) return { removed: 0 }

    let gids = sheetIds
    if (missingExpenseGid(gids)) {
      const { sheetIds: refreshed } = await sheets.ensureStructure(spreadsheetId)
      setSheetIds(refreshed ?? {})
      gids = refreshed ?? {}
    }
    // Not redundant with the skip inside `sheets.compact`: this is what makes a
    // missing gid loud instead of a silently half-compacted sheet.
    if (missingExpenseGid(gids)) throw i18nError('error.missingTabs')

    const result = await sheets.compact(spreadsheetId, gids)
    await refresh()
    return result
  }, [entries, sheetIds, spreadsheetId, refresh])

  return {
    entries,
    config,
    status,
    error,
    tombstoneCount: tombstoneCount(entries),
    refresh,
    addEntry,
    editEntry,
    removeEntry,
    restoreEntry,
    compact,
  }
}
