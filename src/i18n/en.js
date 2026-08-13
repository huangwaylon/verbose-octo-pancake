/**
 * English catalog. The reference locale: `lookup` falls back here for a key a
 * translation is missing, and `test/i18n.test.js` compares every other catalog
 * against this key set.
 *
 * Flat dotted keys, not nested objects, because the drift test then reduces to a
 * key-set comparison, lookup is one property access, and the key literal appears
 * verbatim at the call site so a static scan can prove coverage and find dead
 * keys.
 *
 * A value is a string, except for a pluralised key, where it is an object keyed
 * by CLDR plural category. That is the only exception, which is what makes
 * `typeof value === 'object'` a safe discriminator in the engine.
 *
 * Separators and symbols (`·`, `%`) live in the text rather than in JSX, so
 * their placement is a translation decision at zero code cost.
 */
export default {
  // --- app chrome -----------------------------------------------------------
  'app.name': 'Shared Finances',
  'app.tagline': 'Groceries and food, split between two people.',

  'common.you': 'You',
  'common.person1': 'Person 1',
  'common.person2': 'Person 2',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.add': 'Add',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.retry': 'Try again',
  'common.optional': 'optional',
  // Shared by the list row's meta line and the summary's per-person figure:
  // one sentence, so a translator writes it once.
  'common.paid': '{name} paid',
  'common.whoPaid': 'Who paid',
  'common.notePresets': 'Frequent notes',
  // Joins the two names in the header. A separator, so it is a translation
  // decision: ' & ' in English, a nakaguro in Japanese.
  'common.peopleSeparator': ' & ',

  'header.refresh': 'Refresh from the sheet',
  'header.settings': 'Settings',

  'month.previous': 'Previous month',
  'month.next': 'Next month',

  // --- balance --------------------------------------------------------------
  'balance.title': 'Balance',
  'balance.youOwe': 'You owe {name}',
  'balance.owesYou': '{name} owes you',
  'balance.settled': 'All settled up',

  // --- month summary --------------------------------------------------------
  'summary.title': 'This month',
  'summary.byCategory': 'By category',
  'summary.uncategorized': 'Uncategorized',
  'summary.other': 'Other',
  'summary.chartLabel': 'Spending by category',
  // The meter is a role="img", so this sentence IS the chart for a screen reader.
  'summary.meterLabel': '{name1} {amount1} / {name2} {amount2}',
  'summary.share': '{percent}%',

  // --- dates ----------------------------------------------------------------
  // Passed into dates.dayLabel, which stays pure and receives them as strings.
  // Deliberately not Intl.RelativeTimeFormat: it returns lowercase "today" in
  // English and hands control of user-facing copy to ICU version drift.
  'date.today': 'Today',
  'date.yesterday': 'Yesterday',
  'date.none': 'No date',

  // --- entry list -----------------------------------------------------------
  'list.emptyTitle': 'Nothing logged this month',
  'list.emptyText': 'Add a grocery run or a meal you split.',
  'list.emptyAction': 'Add an expense',

  'entry.expense': 'Expense',
  'entry.settled': 'Settled up',
  'entry.paidCategory': '{name} paid · {category}',
  'entry.settlementMeta': '{payer} paid {other}',
  'entry.onlyPerson': '{name} only',
  'entry.splitPercent': '{percent}% {name}',
  'entry.deleteSettlement': 'Delete settlement',
  'entry.delete': 'Delete {description}',
  'entry.metaSeparator': ' · ',

  // --- deleted entries ------------------------------------------------------
  // The count is in the summary line because the section is collapsed: closed,
  // it is the only thing that says whether opening it is worth it.
  'deleted.title': {
    one: 'Deleted · {count} entry',
    other: 'Deleted · {count} entries',
  },
  'deleted.hint':
    'Deleted from this month. Restore one here, or clear every deleted row for good in settings.',
  'deleted.meta': '{date} · {name} paid',
  'deleted.restore': 'Restore',
  // Several identical "Restore" buttons in a column say nothing about which
  // entry each one belongs to.
  'deleted.restoreEntry': 'Restore {description}',

  // --- delete confirmation --------------------------------------------------
  'confirm.deleteTitle': 'Delete this entry?',
  'confirm.deleteBody':
    '{description} · {amount} moves to Deleted at the bottom of the list, where you can restore it.',

  // --- add / edit form ------------------------------------------------------
  'form.addTitle': 'Add expense',
  'form.editTitle': 'Edit expense',
  'form.amount': 'Amount',
  'form.amountError': 'Enter an amount, like {example}',
  'form.settlementHint': 'Records that {payer} paid {other} back.',
  'form.date': 'Date',
  'form.category': 'Category',
  'form.note': 'Note',
  'form.notePlaceholder': 'Weekly shop',
  'form.split': 'Split',
  'form.splitEven': 'Even',
  'form.splitCustom': 'Custom',
  'form.splitAll': 'All {name}',
  'form.splitHalf': 'Half',
  'form.splitShare': '{name}’s share',
  // The slider's spoken value. A range otherwise announces a bare "70", which
  // says nothing about whose share it is.
  'form.splitValue': '{name}’s share, {percent}%',
  'form.breakdown': '{payer}: {payerAmount} · {other}: {otherAmount}',
  'form.deleteEntry': 'Delete this entry',
  'form.saveError': 'Could not save that.',

  // --- settings -------------------------------------------------------------
  'settings.title': 'Settings',
  'settings.youAre': 'You are',
  'settings.youAreHint': 'Only changes how this device labels things.',
  'settings.language': 'Language',
  'settings.languageHint': 'Stored on this device. The sheet is unaffected.',
  'settings.accent': 'Accent',
  'settings.accentHint': 'Stored on this device, like the language.',
  // The five presets, named after the traditional dye colours they are taken
  // from. Latin names in English, the kanji names in Japanese.
  'accent.indigo': 'Indigo',
  'accent.pine': 'Pine',
  'accent.teal': 'Teal',
  'accent.plum': 'Plum',
  'accent.sepia': 'Sepia',
  'settings.sheet': 'Sheet',
  'settings.openSheet': 'Open in Google Sheets',
  'settings.configTitle': 'Names, currency & categories',
  'settings.defaultSplit': 'Default split',
  'settings.defaultSplitValue': '{name} covers {percent}% of what they pay for',
  'settings.defaultSplitHint':
    'Each person’s own share on a new expense. Set default_split_p1 and default_split_p2 in the config tab.',
  'settings.notePresetsEmpty': 'None yet — add a {key} row to the config tab.',
  'settings.configHint':
    'These come from the {tab} tab of your sheet. Edit them there and refresh.',
  'settings.deletedRows': 'Deleted rows',
  'settings.deletedRowsHint':
    'Deleted entries stay in the sheet as tombstones so nothing shifts position and they can still be restored from the deleted list. Clearing them is permanent.',
  'settings.removeRows': {
    one: 'Permanently remove {count} row',
    other: 'Permanently remove {count} rows',
  },
  'settings.nothingToRemove': 'Nothing to remove',
  'settings.removedRows': {
    one: 'Removed {count} deleted row.',
    other: 'Removed {count} deleted rows.',
  },
  'settings.compactError': 'Could not compact the sheet.',
  'settings.forgetKey': 'Forget key on this device',

  // --- gates ----------------------------------------------------------------
  'gate.unconfiguredTitle': 'Not configured yet',
  'gate.unconfiguredBody':
    'This build is missing {scriptUrl}. It is a public value, set at build time.',
  'gate.unconfiguredFollow':
    'Follow {setup} to deploy the token endpoint, then put its URL in {env} for local development or in the repository variables for GitHub Pages.',
  'gate.keyLabel': 'App key',
  'gate.keyPlaceholder': 'Paste your app key',
  'gate.connect': 'Connect',
  'gate.keyFine':
    'Stored on this device only, and you will not be asked again. The same key goes on both phones. There is no Google sign-in, and nothing expires.',
  'gate.identityTitle': 'Which one are you?',
  'gate.identityBody': 'So the app can say “you” instead of a name. Stored on this device only.',
  'gate.identityFine': 'Set both names in the {tab} tab of your sheet if these look wrong.',
  'gate.loadingSheet': 'Loading your sheet',
  'gate.errorTitle': 'Could not read the sheet',

  // --- toasts and errors ----------------------------------------------------
  'toast.deleted': 'Deleted',
  'toast.deleteFailed': 'Could not delete that.',
  'toast.restored': 'Restored',
  'toast.restoreFailed': 'Could not restore that.',
  'error.readSheet': 'Could not read the sheet.',
  'error.entryGone': 'That entry is no longer in the sheet. Refresh to see the latest data.',
  'error.missingTabs': 'Could not find the expenses tabs in the sheet.',
  // Both paths that report a bad key end here: the reply to a just-typed key,
  // and the notice on a later launch that still holds a rejected one.
  'error.badKey': 'That app key was rejected. Check it, or ask for the current one.',
  'error.keyRequired': 'Enter your app key.',
  'error.offline': 'Could not reach the sheet. Check your connection and try again.',
  'error.scriptUnavailable': 'The sheet service is busy or unavailable. Try again in a moment.',
  'error.scriptMisconfigured':
    'The token endpoint returned no sheet id. Check its SHEET_ID script property.',
  'error.missingId': 'Missing id.',
  'error.badDate': 'Date must be a real day, as YYYY-MM-DD.',
  'error.badAmount': 'Amount must be greater than zero.',
  'error.badPayer': 'Payer must be one of the two people.',
  'error.badShare': 'Split must be between 0 and 100%.',
  'error.missingCategory': 'Pick a category.',
  'error.missingCurrency': 'This sheet has no currency set in its config tab.',
  'warning.staleData': 'Showing saved data — could not reach the sheet.',
  'warning.mixedCurrencies': 'Some entries use a different currency, so totals may be wrong.',
}
