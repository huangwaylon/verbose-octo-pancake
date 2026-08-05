import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_CONFIG, STORAGE_KEYS } from '../config.js'
import { CONFIG_TAB, expensesTab, PERSON, makeEntry, validateEntryCodes } from '../schema.js'
import { t } from '../i18n/index.js'
import * as sheets from '../lib/sheets.js'
import { createSpreadsheet, pickSpreadsheet } from '../lib/picker.js'

/**
 * Turn the first validation failure into a throwable error.
 *
 * The code travels on `i18nKey` so the form can translate it at render time in
 * whatever locale is current, while `message` stays a readable English fallback
 * for anything that only logs the error.
 */
function validationError(codes) {
  const error = new Error(t(`error.${codes[0]}`))
  error.i18nKey = `error.${codes[0]}`
  return error
}

function readStoredSheet() {
  try {
    const id = localStorage.getItem(STORAGE_KEYS.spreadsheetId)
    if (!id) return null
    return { id, name: localStorage.getItem(STORAGE_KEYS.spreadsheetName) || 'Shared Finances' }
  } catch {
    return null
  }
}

function writeStoredSheet(sheet) {
  try {
    if (sheet) {
      localStorage.setItem(STORAGE_KEYS.spreadsheetId, sheet.id)
      localStorage.setItem(STORAGE_KEYS.spreadsheetName, sheet.name ?? '')
    } else {
      localStorage.removeItem(STORAGE_KEYS.spreadsheetId)
      localStorage.removeItem(STORAGE_KEYS.spreadsheetName)
    }
  } catch {
    // Storage blocked; the sheet choice just won't survive a reload.
  }
}

/** A missing tab or range surfaces as a 400 from the values endpoint. */
function looksUninitialized(cause) {
  return cause?.status === 400 || cause?.status === 404
}

/** Floor between focus-triggered refreshes. Window switching is constant. */
const REFRESH_THROTTLE_MS = 30_000

/**
 * Owns the spreadsheet connection and the entry list.
 *
 * Every mutation is applied to local state first and reconciled against the
 * sheet afterwards, because each write is a ~400ms round trip and the app is
 * mostly used on phone data. A failed write reverts the optimistic change and
 * rethrows so the caller can surface it.
 */
export function useLedger({ enabled }) {
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
   * Re-read the sheet when the tab regains attention.
   *
   * Two people share one spreadsheet and there is no push channel, so without
   * this whoever leaves the tab open sits on stale data until they think to hit
   * refresh — the most likely "it's wrong" complaint. Throttled, because
   * switching windows is something people do constantly and each refresh is a
   * real API call against a per-user quota.
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
   * spreadsheet you own and selecting one is a single tap, so picking the wrong
   * file is easy — and `connect` would then have `ensureStructure` add tabs
   * to it. A sheet with none of the expected tabs is almost certainly not meant
   * for this app, and writing to it is not recoverable by undo. "Create a new
   * sheet" is the path that is allowed to build structure.
   */
  const chooseSheet = useCallback(
    async (name) => {
      const picked = await pickSpreadsheet()
      if (!picked) return null

      const structure = await sheets.readStructure(picked.id)
      if (!structure.isLedger) {
        const error = new Error(
          t('error.notALedger', {
            name: picked.name || name || '',
            expensesP1: expensesTab(PERSON.P1),
            expensesP2: expensesTab(PERSON.P2),
            config: CONFIG_TAB,
          }),
        )
        error.i18nKey = 'error.notALedger'
        throw error
      }

      await connect(picked)
      return picked
    },
    [connect],
  )

  const createSheet = useCallback(
    async (name = 'Shared Finances') => {
      const created = await createSpreadsheet(name)
      await connect(created)
      return created
    },
    [connect],
  )

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
      if (problems.length) throw validationError(problems)

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
      if (problems.length) throw validationError(problems)

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
        // CURRENTLY in, which is what updateEntry needs to find it before it
        // can move the row if the payer changed.
        await sheets.updateEntry(spreadsheet.id, entry, previous?.payer)
        setEntries((current) =>
          current.map((item) => (item.id === entry.id ? { ...item, pending: false } : item)),
        )
        return entry
      } catch (cause) {
        if (previous) {
          setEntries((current) =>
            current.map((item) => (item.id === entry.id ? previous : item)),
          )
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
        if (deletedAt) await sheets.softDeleteEntry(spreadsheet.id, payer, id, deletedAt)
        else await sheets.restoreEntry(spreadsheet.id, payer, id)
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

    const p1Tab = expensesTab(PERSON.P1)
    const p2Tab = expensesTab(PERSON.P2)
    let gids = sheetIds
    if (gids[p1Tab] == null || gids[p2Tab] == null) {
      const { sheetIds: refreshed } = await sheets.ensureStructure(spreadsheet.id)
      setSheetIds(refreshed ?? {})
      gids = refreshed ?? {}
    }
    if (gids[p1Tab] == null || gids[p2Tab] == null) {
      throw new Error('Could not find the expenses tabs.')
    }

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
