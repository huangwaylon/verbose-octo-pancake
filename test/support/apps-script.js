/**
 * A fake `SpreadsheetApp` for `apps-script/Code.gs`.
 *
 * The poster runs unattended and its failures are WRITES, so the assertions are about what
 * landed in which tab — the same reason `sheets-api.js` exists for the client. Nothing else
 * in this repo can see this code at all: `Code.gs` is pasted into the Apps Script editor
 * rather than deployed from a build, so a typo in it is invisible everywhere except in a
 * 3am execution log.
 *
 * The source is loaded through `new Function`, which also proves it PARSES. It is ES5-shaped
 * `var` code by convention, so evaluating it in one scope and pulling the declared functions
 * back out is enough — no module system to stub.
 */
import { readFileSync } from 'node:fs'

/** A sheet holding rows below a header, recording every write it is given. */
function fakeSheet(rows) {
  return {
    rows,
    /** What was appended, so a test can assert the row rather than re-read the grid. */
    appended: [],
    /** Which ranges were set to plain text, and when. See the format-before-write trap. */
    formats: [],

    getLastRow() {
      return rows.length + 1
    },

    getRange(startRow, startColumn, numRows, numColumns) {
      const index = startRow - 2
      return {
        getValues() {
          const out = []
          for (let offset = 0; offset < numRows; offset += 1) {
            const source = rows[index + offset] ?? []
            out.push(
              Array.from({ length: numColumns }, (_, at) => source[startColumn - 1 + at] ?? ''),
            )
          }
          return out
        },
        setNumberFormat: (format) => {
          this.formats.push({ row: startRow, format })
        },
        setValues: (written) => {
          // Recorded per row rather than as a flag, because "was it formatted first" is
          // the whole assertion and a later format would satisfy a flag just as well.
          const already = this.formats.some((entry) => entry.row === startRow)
          for (const value of written) {
            this.appended.push({ row: startRow, values: value, textFormatted: already })
            rows[startRow - 2] = value
          }
        },
      }
    },
  }
}

/**
 * Evaluate `Code.gs` against fake Google globals and return its functions plus the sheets.
 *
 * @param {{tabs: Record<string, {rows: any[][]}>, sheetId?: string}} setup
 */
export function loadPoster({ tabs, sheetId = 'sheet-under-test' }) {
  const sheets = {}
  for (const [title, { rows }] of Object.entries(tabs)) {
    sheets[title] = fakeSheet(rows.map((row) => [...row]))
  }

  const globals = {
    SpreadsheetApp: {
      openById: (id) => {
        if (id !== sheetId) throw new Error(`openById got ${id}`)
        return { getSheetByName: (title) => sheets[title] ?? null }
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (key === 'SHEET_ID' ? sheetId : null),
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
    },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: {
      // Only the one format the poster asks for. Deliberately not a real formatter: a
      // stub that quietly answered something else would make trap 3 untestable.
      formatDate: (date, zone, pattern) => {
        if (pattern !== 'yyyy-MM-dd') throw new Error(`unexpected pattern ${pattern}`)
        return globals.__today
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ setMimeType: () => ({ text }) }),
    },
    ScriptApp: { getOAuthToken: () => 'ya29.stub' },
  }

  const source = readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8')
  const names = Object.keys(globals).filter((name) => !name.startsWith('__'))
  const factory = new Function(
    ...names,
    `${source}
    return { postRecurring: postRecurring, postRecurringFor: postRecurringFor }`,
  )
  const api = factory(...names.map((name) => globals[name]))

  return {
    sheets,
    ...api,
    /** What `postRecurring` will read the clock as, for the timezone-free path. */
    setToday: (iso) => {
      globals.__today = iso
    },
  }
}
