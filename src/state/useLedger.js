import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_CONFIG, STORAGE_KEYS } from '../config.js'
import { EXPENSES_TAB, makeEntry, validateEntryCodes } from '../schema.js'
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

  const chooseSheet = useCallback(async () => {
    const picked = await pickSpreadsheet()
    if (picked) await connect(picked)
    return picked
  }, [connect])

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
        await sheets.updateEntry(spreadsheet.id, entry)
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
    async (id, deletedAt) => {
      let previous
      setEntries((current) =>
        current.map((item) => {
          if (item.id !== id) return item
          previous = item
          return { ...item, deletedAt, pending: true }
        }),
      )
      try {
        if (deletedAt) await sheets.softDeleteEntry(spreadsheet.id, id, deletedAt)
        else await sheets.restoreEntry(spreadsheet.id, id)
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
    (id) => setDeleted(id, new Date().toISOString()),
    [setDeleted],
  )
  const restoreEntry = useCallback((id) => setDeleted(id, null), [setDeleted])

  /** Hard-delete tombstoned rows. Deliberate and manual — never in the hot path. */
  const compact = useCallback(async () => {
    const ids = entries.filter((item) => item.deletedAt).map((item) => item.id)
    if (!ids.length) return { removed: 0 }

    let gid = sheetIds[EXPENSES_TAB]
    if (gid == null) {
      const { sheetIds: ids2 } = await sheets.ensureStructure(spreadsheet.id)
      setSheetIds(ids2 ?? {})
      gid = (ids2 ?? {})[EXPENSES_TAB]
    }
    if (gid == null) throw new Error('Could not find the expenses tab.')

    const result = await sheets.compact(spreadsheet.id, gid, ids)
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
