/**
 * A fake `SpreadsheetApp` for `apps-script/Code.gs`. The poster runs unattended and its
 * failures are WRITES, so the assertions are about what landed in which tab. Nothing else in
 * the repo can see this code — `Code.gs` is pasted into the Apps Script editor rather than
 * built — so loading it through `new Function` also proves it PARSES.
 */
import { readFileSync } from 'node:fs'

/**
 * One sheet as a real GRID, header included: the poster reads the expenses and recurring tabs
 * from row 2 but the CONFIG tab from row 1, and a harness modelling "the data below the
 * header" would silently shift one of them by a row.
 */
function fakeSheet(grid) {
  return {
    grid,
    /** What was appended, so a test can assert the row rather than re-read the grid. */
    appended: [],
    /** Which ranges were set to plain text, and when. See the format-before-write trap. */
    formats: [],

    getLastRow() {
      return grid.length
    },

    getRange(startRow, startColumn, numRows, numColumns) {
      const first = startRow - 1
      return {
        getValues() {
          return Array.from({ length: numRows }, (_, offset) => {
            const source = grid[first + offset] ?? []
            return Array.from({ length: numColumns }, (_, at) => source[startColumn - 1 + at] ?? '')
          })
        },
        setNumberFormat: (format) => {
          this.formats.push({ row: startRow, format })
        },
        setValues: (written) => {
          // Recorded per row rather than as a flag: "was it formatted FIRST" is the whole
          // assertion, and a later format would satisfy a flag just as well.
          const already = this.formats.some((entry) => entry.row === startRow)
          written.forEach((value, offset) => {
            this.appended.push({ row: startRow + offset, values: value, textFormatted: already })
            grid[first + offset] = value
          })
        },
      }
    },
  }
}

// Evaluate `Code.gs` against fake Google globals. Each tab gets its HEADER as well as its
// rows, because a real one has one and the poster skips it — for two of the three tabs.
export function loadPoster({ tabs, sheetId = 'sheet-under-test' }) {
  const sheets = {}
  for (const [title, { header, rows }] of Object.entries(tabs)) {
    sheets[title] = fakeSheet([[...header], ...rows.map((row) => [...row])])
  }

  /** Every tab the poster asked for, in order. Asserting on `sheets` would read the fixture. */
  const asked = []

  const globals = {
    SpreadsheetApp: {
      openById: (id) => {
        if (id !== sheetId) throw new Error(`openById got ${id}`)
        return {
          getSheetByName: (title) => {
            asked.push(title)
            return sheets[title] ?? null
          },
        }
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
      // Deliberately not a real formatter: a stub answering something else would make
      // trap 3 untestable.
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
    asked,
    ...api,
    /** What `postRecurring` will read the clock as, for the timezone-free path. */
    setToday: (iso) => {
      globals.__today = iso
    },
  }
}
