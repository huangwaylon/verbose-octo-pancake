import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_CONFIG, STORAGE_KEYS, readStored, writeStored } from '../config.js'
import { CONFIG_TAB, PEOPLE, expensesTab, makeEntry, validateEntryCodes } from '../schema.js'
import { t } from '../i18n/index.js'
import * as sheets from '../lib/sheets.js'
import { createSpreadsheet, pickSpreadsheet } from '../lib/picker.js'

const NEW_SHEET_NAME = 'Shared Finances'

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

function readStoredSheet() {
  const id = readStored(STORAGE_KEYS.spreadsheetId)
  if (!id) return null
  return { id, name: readStored(STORAGE_KEYS.spreadsheetName) || NEW_SHEET_NAME }
}

function writeStoredSheet(sheet) {
  writeStored(STORAGE_KEYS.spreadsheetId, sheet?.id ?? null)
  writeStored(STORAGE_KEYS.spreadsheetName, sheet ? (sheet.name ?? '') : null)
}

/** A missing tab or range surfaces as a 400 from the values endpoint. */
function looksUninitialized(cause) {
  return cause?.status === 400 || cause?.status === 404
}

/**
 * Owns the spreadsheet connection and the entry list.
 *
 * Every mutation is applied to local state first and reconciled against the
 * sheet afterwards, because each write is a ~400ms round trip on phone data. A
 * failed write reverts the optimistic change and rethrows so the caller can
 * surface it.
 */
export function useLedger(enabled) {
  const [spreadsheet, setSpreadsheet] = useState(readStoredSheet)
  const [entries, setEntries] = useState([])
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [sheetIds, setSheetIds] = useState({})
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)

  const loadedFor = useRef(null)

  const applyLoad = useCallback((data) => {
    setEntries(data.entries ?? [])
    setConfig({ ...DEFAULT_CONFIG, ...(data.config ?? {}) })
    if (data.sheetIds) setSheetIds(data.sheetIds)
    setError(null)
    setStatus('ready')
  }, [])

  const load = useCallback(
    async (id, { quiet = false } = {}) => {
      if (!quiet) setStatus((current) => (current === 'ready' ? 'refreshing' : 'loading'))
      try {
        applyLoad(await sheets.loadAll(id))
      } catch (cause) {
        // A sheet the user just created has no tabs yet; set it up and retry once.
        if (looksUninitialized(cause)) {
          try {
            const { sheetIds: ids } = await sheets.ensureStructure(id)
            setSheetIds(ids ?? {})
            applyLoad(await sheets.loadAll(id))
            return
          } catch (secondCause) {
            setStatus('error')
            setError(secondCause.message || t('error.readSheet'))
            return
          }
        }
        setStatus('error')
        setError(cause.message || t('error.readSheet'))
      }
    },
    [applyLoad],
  )

  useEffect(() => {
    if (!enabled || !spreadsheet?.id) return
    if (loadedFor.current === spreadsheet.id) return
    loadedFor.current = spreadsheet.id
    load(spreadsheet.id)
  }, [enabled, spreadsheet?.id, load])

  const refresh = useCallback(() => {
    if (!enabled || !spreadsheet?.id) return Promise.resolve()
    return load(spreadsheet.id)
  }, [enabled, spreadsheet?.id, load])

  /**
   * Re-read the sheet when the tab regains attention. Two people share one
   * spreadsheet with no push channel, so without this whoever leaves the app
   * open sits on stale data. Throttled, because switching windows is constant
   * and every refresh spends per-user quota.
   */
  const lastRefresh = useRef(0)
  useEffect(() => {
    if (!enabled || !spreadsheet?.id) return

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
  }, [enabled, spreadsheet?.id, refresh])

  const connect = useCallback(
    async (sheet) => {
      setStatus('loading')
      writeStoredSheet(sheet)
      loadedFor.current = sheet.id
      setSpreadsheet(sheet)
      try {
        const { sheetIds: ids } = await sheets.ensureStructure(sheet.id)
        setSheetIds(ids ?? {})
      } catch (cause) {
        setStatus('error')
        setError(cause.message || t('error.prepareSheet'))
        return
      }
      await load(sheet.id, { quiet: true })
    },
    [load],
  )

  /**
   * Adopt a spreadsheet the user picked in the Google Picker.
   *
   * Refuses anything that is not already a ledger. The picker lists every
   * spreadsheet you own and selecting one is a single tap, so `connect` would
   * otherwise have `ensureStructure` add three tabs to an unrelated file —
   * which undo cannot reach. "Create a new sheet" is the path allowed to build
   * structure.
   */
  const chooseSheet = useCallback(async () => {
    const picked = await pickSpreadsheet()
    if (!picked) return null

    const { isLedger } = await sheets.readStructure(picked.id)
    if (!isLedger) {
      throw i18nError('error.notALedger', {
        expensesP1: expensesTab(PEOPLE[0]),
        expensesP2: expensesTab(PEOPLE[1]),
        config: CONFIG_TAB,
      })
    }

    await connect(picked)
    return picked
  }, [connect])

  const createSheet = useCallback(async () => {
    const created = await createSpreadsheet(NEW_SHEET_NAME)
    await connect(created)
    return created
  }, [connect])

  const forgetSheet = useCallback(() => {
    writeStoredSheet(null)
    loadedFor.current = null
    setSpreadsheet(null)
    setEntries([])
    setConfig(DEFAULT_CONFIG)
    setSheetIds({})
    setStatus('idle')
    setError(null)
  }, [])

  const addEntry = useCallback(
    async (input) => {
      const entry = makeEntry(input)
      const problems = validateEntryCodes(entry)
      if (problems.length) throw i18nError(`error.${problems[0]}`)

      setEntries((current) => [...current, { ...entry, pending: true }])
      try {
        const { rowNumber } = await sheets.appendEntry(spreadsheet.id, entry)
        setEntries((current) =>
          current.map((item) => (item.id === entry.id ? { ...entry, rowNumber } : item)),
        )
        return entry
      } catch (cause) {
        setEntries((current) => current.filter((item) => item.id !== entry.id))
        throw cause
      }
    },
    [spreadsheet?.id],
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
        await sheets.updateEntry(spreadsheet.id, entry, previous?.payer)
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
    [spreadsheet?.id],
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
        await sheets.setDeletedAt(spreadsheet.id, payer, id, deletedAt)
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
    [spreadsheet?.id],
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
      const { sheetIds: refreshed } = await sheets.ensureStructure(spreadsheet.id)
      setSheetIds(refreshed ?? {})
      gids = refreshed ?? {}
    }
    if (missingGid()) throw new Error('Could not find the expenses tabs.')

    const result = await sheets.compact(spreadsheet.id, gids)
    await refresh()
    return result
  }, [entries, sheetIds, spreadsheet?.id, refresh])

  return {
    spreadsheet,
    entries,
    config,
    status,
    error,
    tombstoneCount: entries.filter((item) => item.deletedAt).length,
    refresh,
    chooseSheet,
    createSheet,
    forgetSheet,
    addEntry,
    editEntry,
    removeEntry,
    restoreEntry,
    compact,
  }
}
