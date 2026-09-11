/**
 * Fake Google globals for `apps-script/Code.gs`, which holds one entry point: the token
 * endpoint. Nothing else in the repo can see that file — it is pasted into the Apps Script
 * editor rather than built — so loading it through `new Function` also proves it PARSES.
 */
import { readFileSync } from 'node:fs'

/**
 * Evaluate `Code.gs` against fake globals. `appKey` and `tokenThrows` are the two ways `doPost` can
 * be made to fail — no key configured, and an authorization that has lapsed — which is what a
 * function that must be incapable of throwing has to be tested against.
 */
export function loadScript({ sheetId = 'sheet-under-test', appKey = null, tokenThrows = false }) {
  const globals = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (key === 'SHEET_ID' ? sheetId : key === 'APP_KEY' ? appKey : null),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ setMimeType: () => ({ text }) }),
    },
    ScriptApp: {
      getOAuthToken: () => {
        if (tokenThrows) throw new Error('authorization lapsed')
        return 'ya29.stub'
      },
    },
  }

  const source = readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8')
  const names = Object.keys(globals)
  const factory = new Function(
    ...names,
    `${source}
    return { doPost: doPost }`,
  )
  return factory(...names.map((name) => globals[name]))
}
