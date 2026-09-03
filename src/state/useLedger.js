import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mergeConfig } from '../config.js'
import { i18nError } from '../i18n/index.js'
import { DATA_TABS, RECURRING, tabOf } from '../schema.js'
import * as sheets from '../lib/sheets.js'
import {
  acknowledge,
  compactRefusal,
  entryById,
  entryFromInput,
  hasPendingWrite,
  looksUninitialized,
  mergeLoaded,
  missingGid,
  NO_SHEET_EXTRAS,
  sheetExtrasFrom,
  reverted,
  settled,
  shouldRefresh,
  statusOnLoadFailure,
  statusOnLoadStart,
  templateFromInput,
  tombstoneCount,
  withPending,
  withPendingDeletedAt,
  withPendingEdit,
  without,
} from '../lib/ledgerState.js'
import { readSnapshot, writeSnapshot } from '../lib/snapshot.js'
import { sameSheetConfig } from '../lib/sheetConfig.js'

/** Floor between focus-triggered refreshes. Window switching is constant. */
const REFRESH_THROTTLE_MS = 30_000

/**
 * Owns the entry list for one spreadsheet. The id is a parameter rather than state: it arrives
 * from the token endpoint alongside the access token, and there is exactly one ledger.
 *
 * Every mutation is applied to local state first and reconciled against the sheet afterwards,
 * because each write is a ~400ms round trip on phone data. A failed write reverts and rethrows.
 *
 * What is left here is what needs React and a network: state, effects, and the order of the calls.
 * Every list transition and status decision is in `lib/ledgerState.js`.
 *
 * Status is one of `idle | loading | stale | refreshing | ready | error`. `stale` means "showing
 * cached data" — where a seeded launch starts and where a failed refresh lands. Only `idle`,
 * `loading` and `error` gate the UI.
 */
export function useLedger(spreadsheetId) {
  // Read once per mount. Every launch after the first has the id in localStorage already, so the
  // cached ledger paints on the first render with no empty frame in front of it.
  const [seed] = useState(() => readSnapshot(spreadsheetId))
  const [entries, setEntries] = useState(() => seed?.entries ?? [])
  const [config, setConfig] = useState(() => mergeConfig(seed?.config))
  const [status, setStatus] = useState(() => (seed ? 'stale' : 'idle'))
  const [error, setError] = useState(null)
  /**
   * The `recurring` tab as read. Deliberately NOT in the launch snapshot: that is the one input
   * never decoded through a schema reader and it is restored in a `useState` initializer, so one
   * bad cached row white-screens the first render — and a reminder loses nothing by arriving a
   * round trip late.
   */
  const [templates, setTemplates] = useState([])
  /**
   * What the last read found in the sheet and could not put in `entries`. None can be recovered
   * from the entry list, because being absent from it is the point.
   */
  const [sheetExtras, setSheetExtras] = useState(NO_SHEET_EXTRAS)

  const loadedFor = useRef(null)
  /** Whether there has ever been something real to show, cached or loaded. */
  const everLoaded = useRef(Boolean(seed))

  /**
   * How many writes carrying no optimistic flag are in flight — `saveTemplate`, `deleteTemplate`
   * and `compact`. A COUNT, so two overlapping writes cannot have the first to finish declare the
   * second done. It exists for `blocksReload`, since nothing in the entry list can see one of
   * these.
   */
  const [writesInFlight, setWritesInFlight] = useState(0)
  const tracked = useCallback(async (write) => {
    setWritesInFlight((count) => count + 1)
    try {
      return await write()
    } finally {
      setWritesInFlight((count) => count - 1)
    }
  }, [])

  /**
   * `entries` as of the last render, so a write can read the entry it is about to replace WITHOUT
   * side-effecting inside a `setEntries` updater. An updater runs synchronously only while React's
   * eager-state bailout applies, which any other pending update defeats — and `App` sets its own
   * state in the same handler as a delete, so `previous` would be undefined exactly when a revert
   * matters.
   */
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  /**
   * Serialising the whole ledger is the expensive half of the cache, and `applyLoad` runs on every
   * focus refresh — exactly as someone returns and reaches for a button, so defer past the
   * interaction. `requestIdleCallback` would fit better but Safari does not implement it.
   */
  const persistTimer = useRef(null)
  const persist = useCallback((id, nextEntries, sheetConfig) => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null
      writeSnapshot(id, nextEntries, sheetConfig)
    }, 0)
  }, [])

  // The ref is captured into the closure, not read at cleanup time: `useToasts` says why.
  useEffect(() => {
    const timer = persistTimer
    return () => clearTimeout(timer.current)
  }, [])

  /** The sheet's own partial config, which is what the snapshot has to store. */
  const sheetConfigRef = useRef(seed?.config)

  const applyLoad = useCallback((data) => {
    setEntries((current) => mergeLoaded(current, data.entries ?? []))
    // Kept as the SAME object when the tab said the same thing, because the config's identity is
    // what every `memo` keyed on it compares. `mergeConfig` clones, so this cannot alias the
    // previous merge's arrays either.
    const changed = !sameSheetConfig(sheetConfigRef.current, data.sheetConfig)
    sheetConfigRef.current = data.sheetConfig
    if (changed) setConfig(mergeConfig(data.sheetConfig))
    setTemplates(data.templates ?? [])
    setSheetExtras(sheetExtrasFrom(data))
    setError(null)
    setStatus('ready')
    everLoaded.current = true
  }, [])

  /**
   * Persist whatever is on screen, once nothing is in flight.
   *
   * Driven by the list rather than by each write, because a refresh that started before a delete
   * returns the row still live and persisting that read puts a deleted expense back into the next
   * cold launch's balance. Waiting for `pending` to clear is what keeps an unacknowledged row out
   * of the cache.
   *
   * `config` is in the deps although the ref is what gets written, and it has to be: a read where
   * only the CONFIG tab changed leaves `entries` at the same reference, so keyed on the list alone
   * this never runs and the cache keeps a stale name, category list and `default_split_p*` — the
   * one config value that moves money.
   */
  useEffect(() => {
    if (!spreadsheetId || !everLoaded.current) return
    if (hasPendingWrite(entries)) return
    persist(spreadsheetId, entries, sheetConfigRef.current)
  }, [spreadsheetId, entries, config, persist])

  /**
   * Counts every read started, so a reply that is not the newest can be dropped: two taps on a
   * flaky connection can resolve out of order and the older reply would win both `setEntries` and
   * the debounced `persist`. A read in flight when the key is forgotten would likewise repopulate
   * state for a sheet the app has left, so the spreadsheet id is checked as well.
   */
  const loadGeneration = useRef(0)
  /** When the sheet was last read, which is what the focus throttle is about. */
  const lastRefresh = useRef(0)

  const load = useCallback(
    async (id) => {
      const generation = (loadGeneration.current += 1)
      const isCurrent = () => generation === loadGeneration.current
      // Every read counts against the focus floor, this one included, or the launch read is
      // followed by a window switch spending a second read for the same data seconds later.
      lastRefresh.current = Date.now()
      setStatus(statusOnLoadStart)

      const fail = (cause) => {
        if (!isCurrent()) return
        // The cause, never a sentence: this can sit on screen as long as the sheet is unreachable,
        // through a language change in settings. `errorMessage` at the render keeps it live.
        setError(cause)
        setStatus(statusOnLoadFailure(everLoaded.current))
      }
      const apply = (data) => {
        if (isCurrent()) applyLoad(data)
      }

      try {
        apply(await sheets.loadAll(id))
      } catch (cause) {
        // A sheet never used has no tabs yet: set it up and retry once, the only path that builds
        // structure.
        if (looksUninitialized(cause)) {
          try {
            await sheets.ensureStructure(id)
            if (!isCurrent()) return
            apply(await sheets.loadAll(id))
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
    // Nothing to show for this id yet: a disconnect, or a switch to a DIFFERENT sheet — reachable
    // without a `forgetKey`, since a rejected key leaves the old id in storage. It must reset as
    // thoroughly as a disconnect, or sheet B's screen paints sheet A's entries and balance, and if
    // B's own read then fails `everLoaded` is already true so A's ledger sits under a stale
    // notice.
    if (!spreadsheetId || (loadedFor.current && loadedFor.current !== spreadsheetId)) {
      // `loadedFor` is cleared so reconnecting to the same sheet still triggers a read. Bumping
      // the generation stops a read in flight repopulating state, and the snapshot, for the sheet
      // just left.
      loadGeneration.current += 1
      loadedFor.current = null
      everLoaded.current = false
      sheetConfigRef.current = undefined
      setEntries([])
      setConfig(mergeConfig())
      setTemplates([])
      setSheetExtras(NO_SHEET_EXTRAS)
      setStatus('idle')
      setError(null)
      if (!spreadsheetId) return
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
   * Re-read the sheet when the tab regains attention: two people share one spreadsheet with no
   * push channel, so whoever leaves the app open would sit on stale data. Throttled, because every
   * refresh spends per-user quota.
   */
  useEffect(() => {
    if (!spreadsheetId) return

    const maybeRefresh = () => {
      if (document.visibilityState !== 'visible') return
      if (!shouldRefresh(Date.now(), lastRefresh.current, REFRESH_THROTTLE_MS)) return
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
      const entry = entryFromInput(input)

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
      const entry = entryFromInput(input)

      /**
       * `previous.payer` is the row's CURRENT tab, which `updateEntry` needs before it can move
       * the row. Passing `undefined` takes the payer-changed branch: a second row appended and the
       * original looked for in whichever tab it guessed — a duplicate expense, silently.
       *
       * The entry can genuinely be gone: the other person deleted it and a focus refresh dropped
       * it while this form was open.
       */
      const previous = entryById(entriesRef.current, entry.id)
      if (!previous) throw i18nError('error.entryGone')

      setEntries((current) => withPendingEdit(current, entry))
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
    async (id, deletedAt) => {
      // The row's CURRENT tab comes from local state, as `editEntry` takes it, and absent is
      // refused rather than guessed. There is deliberately no payer parameter.
      const previous = entryById(entriesRef.current, id)
      if (!previous) throw i18nError('error.entryGone')

      setEntries((current) => withPendingDeletedAt(current, id, deletedAt))
      try {
        await sheets.setDeletedAt(spreadsheetId, tabOf(previous), id, deletedAt)
        setEntries((current) => settled(current, id))
      } catch (cause) {
        setEntries((current) => reverted(current, id, previous))
        throw cause
      }
    },
    [spreadsheetId],
  )

  const removeEntry = useCallback((id) => setDeleted(id, new Date().toISOString()), [setDeleted])
  const restoreEntry = useCallback((id) => setDeleted(id, null), [setDeleted])

  /**
   * The `recurring` tab's ONE write, and deliberately NOT optimistic: write, then re-read, as
   * `compact` does. A template is written a handful of times a year, and the cost of a spinner on
   * Save buys templates needing no place in the snapshot, no `pending` field and no revert path.
   *
   * Add, edit and retire are all this one call, which is what makes a retried add idempotent.
   */
  const saveTemplate = useCallback(
    async (input) => {
      await tracked(async () => {
        await sheets.saveTemplate(spreadsheetId, templateFromInput(input))
        await refresh()
      })
    },
    [spreadsheetId, refresh, tracked],
  )

  /**
   * Remove a recurring cost's row for good. Reads the gids fresh through `readSheetGids`, never
   * `ensureStructure`, which WRITES and would re-seed a deleted config tab with this build's
   * defaults. Loud rather than a silent no-op when the gid is missing, since there is no guess to
   * make.
   */
  const deleteTemplate = useCallback(
    async (template) => {
      await tracked(async () => {
        const gids = await sheets.readSheetGids(spreadsheetId)
        if (missingGid(gids, [RECURRING])) throw i18nError('error.missingTabs')
        await sheets.deleteTemplate(spreadsheetId, gids[RECURRING.title], template.id)
        await refresh()
      })
    },
    [spreadsheetId, refresh, tracked],
  )

  /** Hard-delete tombstoned rows. Deliberate and manual — never in the hot path. */
  const compact = useCallback(async () => {
    // Both refusals — a write in flight, and nothing to remove — live in `lib`; this owns the
    // order.
    const refusal = compactRefusal(entriesRef.current, sheetExtras.supersededRows)
    if (refusal) return refusal

    return tracked(async () => {
      // Read the gids, never `ensureStructure`, which writes and would re-seed a deleted config
      // tab. `values.batchGet` cannot carry a gid, so this read happens every time.
      const gids = await sheets.readSheetGids(spreadsheetId)
      // Loud rather than a silently half-compacted sheet: `sheets.compact` skips a tab it cannot
      // name, which is right for it and wrong to leave unsaid here.
      if (missingGid(gids, DATA_TABS)) throw i18nError('error.missingTabs')

      const result = await sheets.compact(spreadsheetId, gids)
      await refresh()
      return result
    })
  }, [sheetExtras.supersededRows, spreadsheetId, refresh, tracked])

  /**
   * Every tombstone in the sheet, the ones `reconcileById` hid behind a live row included.
   * Memoised because only the closed settings sheet reads it.
   */
  const tombstones = useMemo(
    () => tombstoneCount(entries) + sheetExtras.supersededRows,
    [entries, sheetExtras.supersededRows],
  )

  return {
    entries,
    config,
    /** The `recurring` tab's declarations. `recurringRows` is what the page reads them with. */
    templates,
    status,
    error,
    tombstoneCount: tombstones,
    /** What the last read could not show, whole: `noticeKeys` reads exactly this. */
    sheetExtras,
    /**
     * Whether a write with no optimistic flag is in flight. The one consumer is `blocksReload`:
     * nothing in `entries` can see a template write or a compact.
     */
    writing: writesInFlight > 0,
    refresh,
    addEntry,
    editEntry,
    removeEntry,
    restoreEntry,
    saveTemplate,
    deleteTemplate,
    compact,
  }
}
