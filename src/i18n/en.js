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
  'common.close': 'Close',
  'common.retry': 'Try again',
  'common.optional': 'optional',
  // Joins the two names in the header. A separator, so it is a translation
  // decision: ' & ' in English, a nakaguro in Japanese.
  'common.peopleSeparator': ' & ',

  'header.refresh': 'Refresh from the sheet',
  'header.settings': 'Settings',

  // --- auth -------------------------------------------------------------
  'auth.expiredBanner': 'Your Google session timed out.',
  'auth.reconnect': 'Reconnect',

  'month.previous': 'Previous month',
  'month.next': 'Next month',

  // --- balance --------------------------------------------------------------
  'balance.title': 'Balance',
  'balance.youOwe': 'You owe {name}',
  'balance.owesYou': '{name} owes you',
  'balance.settled': 'All settled up',
  'balance.settledCaption': 'Nothing owed either way.',
  'balance.settle': 'Settle up',

  // --- month summary --------------------------------------------------------
  'summary.title': 'This month',
  'summary.paid': '{name} paid',
  'summary.byCategory': 'By category',
  'summary.whoPaid': 'Who paid',
  'summary.uncategorized': 'Uncategorized',
  'summary.other': 'Other',
  'summary.chartLabel': 'Spending by category',
  'summary.share': '{percent}%',

  // --- dates ----------------------------------------------------------------
  // Passed into dates.dayLabel, which stays pure and receives them as strings.
  // Deliberately not Intl.RelativeTimeFormat: it returns lowercase "today" in
  // English and hands control of user-facing copy to ICU version drift.
  'date.today': 'Today',
  'date.yesterday': 'Yesterday',
  'date.none': 'No date',

  // --- entry list -----------------------------------------------------------
  'list.loading': 'Loading expenses',
  'list.emptyTitle': 'Nothing logged this month',
  'list.emptyText': 'Add a grocery run or a meal you split.',
  'list.emptyAction': 'Add an expense',

  'entry.expense': 'Expense',
  'entry.settled': 'Settled up',
  'entry.paid': '{name} paid',
  'entry.paidCategory': '{name} paid · {category}',
  'entry.settlementMeta': '{payer} paid {other}',
  'entry.onlyPerson': '{name} only',
  'entry.splitPercent': '{percent}% {name}',
  'entry.deleteSettlement': 'Delete settlement',
  'entry.delete': 'Delete {description}',
  'entry.metaSeparator': ' · ',

  // --- add / edit form ------------------------------------------------------
  'form.addTitle': 'Add expense',
  'form.editTitle': 'Edit expense',
  'form.settleTitle': 'Settle up',
  'form.amount': 'Amount',
  'form.amountPlaceholder': '0',
  'form.amountError': 'Enter an amount, like {example}',
  'form.whoPaid': 'Who paid',
  'form.paidBy': 'Paid by',
  'form.settlementHint': 'Records that {payer} paid {other} back.',
  'form.date': 'Date',
  'form.category': 'Category',
  'form.note': 'Note',
  'form.notePlaceholder': 'Weekly shop',
  'form.notePresets': 'Frequent notes',
  'form.split': 'Split',
  'form.splitEven': 'Even',
  'form.splitCustom': 'Custom',
  'form.splitAll': 'All {name}',
  'form.splitHalf': 'Half',
  'form.splitShare': '{name}’s share',
  'form.breakdown': '{payer}: {payerAmount} · {other}: {otherAmount}',
  'form.deleteEntry': 'Delete this entry',
  'form.saveError': 'Could not save that.',

  // --- settings -------------------------------------------------------------
  'settings.title': 'Settings',
  'settings.youAre': 'You are',
  'settings.youAreHint': 'Only changes how this device labels things.',
  'settings.language': 'Language',
  'settings.languageHint': 'Stored on this device. The sheet is unaffected.',
  'settings.sheet': 'Sheet',
  'settings.openSheet': 'Open in Google Sheets',
  'settings.switchSheet': 'Switch sheet',
  'settings.configTitle': 'Names, currency & categories',
  'settings.defaultSplit': 'Default split',
  'settings.defaultSplitValue': '{name} covers {percent}% of what they pay for',
  'settings.defaultSplitHint':
    'Each person’s own share on a new expense. Set default_split_p1 and default_split_p2 in the config tab.',
  'settings.notePresets': 'Frequent notes',
  'settings.notePresetsEmpty': 'None yet — add a {key} row to the config tab.',
  'settings.configHint':
    'These come from the {tab} tab of your sheet. Edit them there and refresh.',
  'settings.deletedRows': 'Deleted rows',
  'settings.deletedRowsHint':
    'Deleted entries stay in the sheet as tombstones so nothing shifts position and undo keeps working. Clearing them is permanent.',
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
  'settings.signOut': 'Sign out',
  'settings.signOutAs': 'Sign out ({email})',

  // --- gates ----------------------------------------------------------------
  'gate.unconfiguredTitle': 'Not configured yet',
  'gate.unconfiguredBody':
    'This build is missing {clientId} or {apiKey}. Both are public values, set at build time.',
  'gate.unconfiguredFollow':
    'Follow {setup} to create them, then put them in {env} for local development or in the repository variables for GitHub Pages.',
  'gate.signIn': 'Sign in with Google',
  'gate.signInFine':
    'The app asks only for access to the single spreadsheet you pick — not your whole Drive.',
  'gate.sheetTitle': 'Pick a sheet',
  'gate.sheetBody':
    'Start a fresh spreadsheet, or connect one you already have. You can change this later.',
  'gate.createSheet': 'Create a new sheet',
  'gate.chooseSheet': 'Choose an existing sheet',
  'gate.identityTitle': 'Which one are you?',
  'gate.identityBody': 'So the app can say “you” instead of a name. Stored on this device only.',
  'gate.identityFine': 'Set both names in the {tab} tab of your sheet if these look wrong.',
  'gate.loadingSheet': 'Loading your sheet',
  'gate.errorTitle': 'Could not read the sheet',
  'gate.pickDifferent': 'Pick a different sheet',

  // --- toasts and errors ----------------------------------------------------
  'toast.deleted': 'Deleted',
  'toast.undo': 'Undo',
  'toast.deleteFailed': 'Could not delete that.',
  'error.readSheet': 'Could not read the sheet.',
  'error.prepareSheet': 'Could not prepare the sheet.',
  'error.signIn': 'Sign-in failed.',
  'error.notALedger':
    'That spreadsheet has no {expensesP1}, {expensesP2}, or {config} tab, so it is not a Shared Finances ledger and this app will not modify it. Pick a different sheet, or use "Create a new sheet".',
  'error.sessionExpired': 'Your Google session ended. Sign in again to pick up where you left off.',
  'error.missingId': 'Missing id.',
  'error.badDate': 'Date must be a real day, as YYYY-MM-DD.',
  'error.badAmount': 'Amount must be greater than zero.',
  'error.badPayer': 'Payer must be one of the two people.',
  'error.badShare': 'Split must be between 0 and 100%.',
  'error.missingCategory': 'Pick a category.',
  'error.missingCurrency': 'This sheet has no currency set in its config tab.',
  'warning.mixedCurrencies':
    'Some entries use a different currency, so totals may be wrong.',
}
