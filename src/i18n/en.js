/**
 * English catalog, and the reference locale `lookup` and `test/i18n.test.js` measure against.
 *
 * Flat dotted keys, so the literal appears verbatim at the call site and a static scan can prove
 * coverage. A pluralised value is an object keyed by CLDR category — the only non-string. Separators
 * (`·`, `%`) live in the text, so their placement is a translation decision. The prefix is the
 * SURFACE, not the feature, and a control repeated down a column gets a `*Name`/`*Entry` variant.
 */
export default {
  // --- app chrome -----------------------------------------------------------
  'app.name': 'Shared Finances',
  'app.tagline': 'Groceries and food, split between two people.',

  'common.you': 'You',
  'common.person1': 'Person 1',
  'common.person2': 'Person 2',
  // English inflects, so "You" cannot be dropped into the `{name}’s` form.
  'common.yourPossessive': 'Your',
  'common.namePossessive': '{name}’s',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.add': 'Add',
  'common.addExpense': 'Add an expense',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.retry': 'Try again',
  'common.optional': 'optional',
  'common.paid': '{name} paid',
  // Possessive because English inflects: `label` would read "You share".
  'common.share': '{owner} share',
  'common.whoPaid': 'Who paid',
  'common.notePresets': 'Frequent notes',

  'header.refresh': 'Refresh from the sheet',
  'header.settings': 'Settings',

  'month.previous': 'Previous month',
  'month.next': 'Next month',

  // --- balance --------------------------------------------------------------
  // Both readings in full: word order differs per language, so the caller cannot append the amount.
  'balance.youOwe': 'You owe {name}',
  'balance.owesYou': '{name} owes you',
  'balance.youOweAmount': 'You owe {name} {amount}',
  'balance.owesYouAmount': '{name} owes you {amount}',
  'balance.settled': 'All settled up',

  // --- month summary --------------------------------------------------------
  'summary.title': 'This month',
  'summary.perPerson': 'Per person',
  'summary.paidToggle': 'Paid',
  'summary.byCategory': 'By category',
  'summary.uncategorized': 'Uncategorized',
  'summary.other': 'Other',
  'summary.chartLabel': 'Spending by category',
  // The meter is a role="img", so this sentence IS the chart for a screen reader.
  'summary.meterLabel': '{name1} {amount1} / {name2} {amount2}',
  'summary.share': '{percent}%',

  // --- dates ----------------------------------------------------------------
  // Not Intl.RelativeTimeFormat: lowercase "today" in English, and ICU version drift.
  'date.today': 'Today',
  'date.yesterday': 'Yesterday',
  'date.none': 'No date',

  // --- entry list -----------------------------------------------------------
  'list.emptyTitle': 'Nothing logged this month',
  'list.emptyText': 'Add a grocery run or a meal you split.',
  'list.recurring': 'Recurring costs',

  'entry.expense': 'Expense',
  'entry.settled': 'Settled up',
  'entry.paidCategory': '{name} paid · {category}',
  'entry.settlementMeta': '{payer} paid {other}',
  'entry.onlyPerson': '{name} only',
  'entry.splitPercent': '{percent}% {name}',
  'entry.deleteSettlement': 'Delete settlement',
  'entry.delete': 'Delete {description}',
  'entry.metaSeparator': ' · ',

  // --- recurring costs: the settings row -----------------------------------
  'settings.recurringHint':
    'Rent, the gym, anything that comes round every month with an amount you already know.',
  'settings.recurringCount': {
    one: 'Manage {count} cost',
    other: 'Manage {count} costs',
  },
  'settings.recurringEmpty': 'Set one up',

  // --- recurring costs: the page --------------------------------------------
  // Not "Subscriptions": rent is the reason this exists, and it is nobody's subscription.
  'recurring.title': 'Recurring costs',
  'recurring.hint': 'Showing {month}. Tap a cost to edit it.',
  'recurring.empty': 'Nothing set up yet. Add rent, or anything else that comes round every month.',
  'recurring.notLoaded': 'Not loaded yet — pull the sheet in and come back.',
  'recurring.add': 'Add a cost',
  'recurring.amountVaries': 'Varies',
  // "day {day}" rather than an ordinal, which English cannot form from a number.
  'recurring.schedule': 'on day {day}',
  // Not '{name} pays': `label` answers "You", and English does not inflect that to "You pays".
  'recurring.paidBy': 'paid by {name}',
  'recurring.recorded': 'recorded',
  'recurring.notYetDue': 'due on day {day}',
  'recurring.notThisMonth': 'not this month',
  'recurring.stopped': 'stopped',
  'recurring.record': 'Record',
  'recurring.recordName': 'Record {name}',
  'recurring.recordNow': 'Record now',
  'recurring.recordNowName': 'Record {name} now',

  // --- recurring costs: the form --------------------------------------------
  'recurring.addTitle': 'Add a recurring cost',
  'recurring.editTitle': 'Edit recurring cost',
  'recurring.name': 'Name',
  'recurring.namePlaceholder': 'Rent',
  'recurring.amountHint': 'Leave it empty if the amount changes every month.',
  'recurring.day': 'Day of the month',
  // "on its own", not "never": the page offers Record now earlier. This governs the poster.
  'recurring.dayHint':
    'Nothing is recorded on its own before this day. A 31 lands on the last day of short months.',
  // Names the person and the number: the mode saves a BLANK cell, so the figure can move.
  'recurring.splitDefault': 'Default',
  'recurring.splitDefaultHint': 'Follows {owner} default split, {percent}% today.',
  'recurring.sheetOnlyHint':
    'Quarterly and annual schedules live in the recurring tab of your sheet, and this form keeps them.',
  'recurring.editScopeHint': 'Months already recorded keep the figures they were recorded with.',
  'recurring.retire': 'Stop this cost',
  'recurring.restore': 'Start this cost again',
  'recurring.delete': 'Delete for good',
  // Names the DECISION, not the button under it, or the block prints "Delete for good" twice.
  'recurring.deleteTitle': 'Delete instead of stopping',
  // The whole guard: what is lost is the record of which months this cost already covered.
  'recurring.deleteHint':
    'Removes the row from the recurring tab. The entries it already added stay in your ledger, but the sheet forgets which months it covered — so adding this cost again could record a month twice. Stopping it keeps that memory.',

  // --- deleted entries ------------------------------------------------------
  'deleted.title': {
    one: 'Deleted · {count} entry',
    other: 'Deleted · {count} entries',
  },
  'deleted.hint':
    'Deleted from this month. Restore one here, or clear every deleted row for good in settings.',
  'deleted.meta': '{date} · {name} paid',
  // A payback read as an expense loses its direction — the one row where that reverses meaning.
  'deleted.settlementMeta': '{date} · {payer} paid {other}',
  'deleted.restore': 'Restore',
  'deleted.restoreEntry': 'Restore {description}',

  // --- delete confirmation --------------------------------------------------
  'confirm.deleteTitle': 'Delete this entry?',
  'confirm.deleteBody':
    '{description} · {amount} moves to Deleted at the bottom of the list, where you can restore it.',
  'confirm.deleteTemplateTitle': 'Delete this recurring cost?',
  'confirm.deleteTemplateBody':
    '{name} is removed from the recurring tab for good. The entries it already added stay in your ledger. If you add it again later, check this month has not already been recorded.',

  // --- add / edit form ------------------------------------------------------
  'form.addTitle': 'Add expense',
  'form.editTitle': 'Edit expense',
  'form.editSettlementTitle': 'Edit settlement',
  'form.amount': 'Amount',
  'form.amountError': 'Enter an amount, like {example}',
  'form.amountPlaceholder': '0',
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
  // The slider's spoken value: a range otherwise announces a bare "70".
  'form.splitValue': '{owner} share, {percent}%',
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
  // Traditional dye colours: Latin names in English, kanji in Japanese.
  'accent.indigo': 'Indigo',
  'accent.pine': 'Pine',
  'accent.teal': 'Teal',
  'accent.plum': 'Plum',
  'accent.sepia': 'Sepia',
  'settings.sheet': 'Sheet',
  'settings.openSheet': 'Open in Google Sheets',
  'settings.configTitle': 'Names & categories',
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
  'settings.compactBusy': 'A change is still saving. Try again in a moment.',
  'settings.forgetKey': 'Forget key on this device',
  'settings.forgetKeyTitle': 'App key',
  'settings.forgetKeyHint':
    'Removes the key and the cached ledger from this phone. The spreadsheet is untouched, and you will need the key again to get back in.',

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
  'toast.added': 'Added',
  'toast.saved': 'Saved',
  'toast.deleted': 'Deleted',
  'toast.deleteFailed': 'Could not delete that.',
  'toast.restored': 'Restored',
  'toast.retired': 'Stopped',
  'toast.restoreFailed': 'Could not restore that.',
  'error.readSheet': 'Could not read the sheet.',
  'error.sheetRequest': 'The sheet would not answer. Try again in a moment.',
  // 403/404: not a blip, so retrying would hide it behind "showing saved data".
  'error.sheetUnreachable':
    'This app can no longer reach the sheet. Check that it is still shared with the account that owns it.',
  'error.notOurSheet':
    'That spreadsheet already has other tabs and none of this app’s, so it is probably not the ledger. Check the SHEET_ID script property.',
  'error.entryGone': 'That entry is no longer in the sheet. Refresh to see the latest data.',
  'error.missingTabs': 'Could not find the expenses tabs in the sheet.',
  'error.badKey': 'That app key was rejected. Check it, or ask for the current one.',
  'error.keyRequired': 'Enter your app key.',
  'error.offline': 'Could not reach the sheet. Check your connection and try again.',
  'error.scriptUnavailable': 'The sheet service is busy or unavailable. Try again in a moment.',
  // An unpublished consent screen expires after 7 days. Names the fix: retrying cannot help.
  'error.scriptUnauthorized':
    'The sheet service needs re-authorizing. Open the Apps Script project and run it once, then publish its consent screen.',
  'error.scriptMisconfigured':
    'The token endpoint returned no sheet id. Check its SHEET_ID script property.',
  'error.missingId': 'Missing id.',
  'error.badDate': 'Date must be a real day, as YYYY-MM-DD.',
  'error.badAmount': 'Amount must be greater than zero.',
  'error.badPayer': 'Payer must be one of the two people.',
  'error.badShare': 'Split must be between 0 and 100%.',
  'error.missingCategory': 'Pick a category.',
  // Template validation; `badPayer` and `badShare` are shared with an entry.
  'error.missingDescription': 'Give it a name, like Rent.',
  'error.badTemplateAmount': 'Amount must be a whole number of yen, or empty if it varies.',
  'error.badDay': 'Day of the month must be between 1 and 31.',
  'error.duplicateTemplate':
    'Two rows in the recurring tab share one id, so this cannot be saved safely. Give one of them a different id in the sheet.',
  'warning.staleData': 'Showing saved data — could not reach the sheet.',
  'warning.configMissing':
    'The config tab is missing, so names, categories and the default split are the defaults. Restore it in the sheet.',
  'warning.undatedRows': {
    one: '{count} row in the sheet has a date that cannot be read, so it appears in no month.',
    other: '{count} rows in the sheet have dates that cannot be read, so they appear in no month.',
  },
  'warning.undecodedRows': {
    one: '{count} row in the sheet has an amount that cannot be read, so it is left out of the totals.',
    other:
      '{count} rows in the sheet have amounts that cannot be read, so they are left out of the totals.',
  },
  'warning.unattributedRows': {
    one: '{count} settlement names nobody who paid, so it is left out of the balance.',
    other: '{count} settlements name nobody who paid, so they are left out of the balance.',
  },
  // Last, because nothing on screen is wrong. "Cannot be used", not "cannot be read": it covers a
  // row whose id another row already has, which reads fine.
  'warning.undecodedTemplates': {
    one: '{count} row in the recurring tab cannot be used, so it is missing from Recurring costs.',
    other:
      '{count} rows in the recurring tab cannot be used, so they are missing from Recurring costs.',
  },
}
