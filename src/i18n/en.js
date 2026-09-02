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
 *
 * The prefix is the SURFACE, not the feature: a string rendered by `SettingsSheet` is
 * `settings.*` wherever it came from. And a control repeated down a column — Restore, Record —
 * gets a `*Name`/`*Entry` variant naming its own row, or a screen reader reads the same word N
 * times with nothing to tell them apart.
 */
export default {
  // --- app chrome -----------------------------------------------------------
  'app.name': 'Shared Finances',
  'app.tagline': 'Groceries and food, split between two people.',

  'common.you': 'You',
  'common.person1': 'Person 1',
  'common.person2': 'Person 2',
  // The two possessive forms `usePeopleLabels` chooses between. English inflects,
  // so "You" cannot simply be dropped into the `{name}’s` one.
  'common.yourPossessive': 'Your',
  'common.namePossessive': '{name}’s',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.add': 'Add',
  // The app's one primary action, on the block button under the balance.
  'common.addExpense': 'Add an expense',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.retry': 'Try again',
  'common.optional': 'optional',
  // Shared by the list row's meta line and the summary's per-person figure:
  // one sentence, so a translator writes it once.
  'common.paid': '{name} paid',
  // Shared by the split control and the summary's per-person figure, and possessive
  // because English inflects: `label` would read "You share".
  'common.share': '{owner} share',
  'common.whoPaid': 'Who paid',
  'common.notePresets': 'Frequent notes',

  'header.refresh': 'Refresh from the sheet',
  'header.settings': 'Settings',

  'month.previous': 'Previous month',
  'month.next': 'Next month',

  // --- balance --------------------------------------------------------------
  // The line under the figure. The figure itself is a visual composition of
  // Intl's parts, so the heading holding it is named by one of the two sentences
  // below instead — a heading that reads "¥12,500" says nothing in a screen
  // reader's heading list. Both readings exist in full because the word order
  // differs per language; the amount cannot be appended by the caller.
  'balance.youOwe': 'You owe {name}',
  'balance.owesYou': '{name} owes you',
  'balance.youOweAmount': 'You owe {name} {amount}',
  'balance.owesYouAmount': '{name} owes you {amount}',
  'balance.settled': 'All settled up',

  // --- month summary --------------------------------------------------------
  'summary.title': 'This month',
  // Covers both figures below it — cash out of pocket, and what that person owes once
  // every split is applied — where "Who paid" would only describe the first.
  'summary.perPerson': 'Per person',
  // A toggle, not a heading: pressed means the paid figures are on screen, and the lines
  // themselves say which of the two they are.
  'summary.paidToggle': 'Paid',
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
  // No button here: the block button above the list is the one add affordance,
  // and two identical accent buttons on one screen read as two different actions.
  'list.emptyText': 'Add a grocery run or a meal you split.',

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
  // Under `settings.` because the surface decides the prefix, not the feature:
  // these three render beside settings.deletedRowsHint and nothing else.
  'settings.recurringHint':
    'Rent, the gym, anything that comes round every month with an amount you already know.',
  'settings.recurringCount': {
    one: 'Manage {count} cost',
    other: 'Manage {count} costs',
  },
  'settings.recurringEmpty': 'Set one up',

  // --- recurring costs: the page --------------------------------------------
  // "Recurring costs" rather than "Subscriptions": rent is the reason this
  // exists and it is nobody's subscription.
  'recurring.title': 'Recurring costs',
  'recurring.hint': 'Showing {month}. Tap a cost to edit it.',
  'recurring.empty': 'Nothing set up yet. Add rent, or anything else that comes round every month.',
  // A cached launch has an empty list for a completely different reason, and
  // "none yet" there invites a second copy of a cost that already exists.
  'recurring.notLoaded': 'Not loaded yet — pull the sheet in and come back.',
  'recurring.add': 'Add a cost',
  'recurring.amountVaries': 'Varies',
  // A row's own state, in words. Never by colour, and never by the absence of
  // the Record button: not-yet-due and already-paid look identical without these.
  // "day {day}" rather than an ordinal, which English cannot form from a number.
  'recurring.schedule': 'on day {day}',
  // 'paid by {name}' rather than '{name} pays': `label` answers "You" for whoever is
  // holding the phone, and English does not inflect that to "You pays".
  'recurring.paidBy': 'paid by {name}',
  'recurring.recorded': 'recorded',
  'recurring.notYetDue': 'due on day {day}',
  'recurring.notThisMonth': 'not this month',
  'recurring.stopped': 'stopped',
  'recurring.record': 'Record',
  'recurring.recordName': 'Record {name}',

  // --- recurring costs: the form --------------------------------------------
  'recurring.addTitle': 'Add a recurring cost',
  'recurring.editTitle': 'Edit recurring cost',
  'recurring.name': 'Name',
  'recurring.namePlaceholder': 'Rent',
  // Blank is a real answer here, and the one a utility bill needs.
  'recurring.amountHint': 'Leave it empty if the amount changes every month.',
  'recurring.day': 'Day of the month',
  'recurring.dayHint':
    'Nothing is recorded before this day. A 31 lands on the last day of short months.',
  // Names the person and the number, because the mode saves a BLANK cell: the
  // figure shown is the config tab's and moves when that does.
  'recurring.splitDefault': 'Default',
  'recurring.splitDefaultHint': 'Follows {owner} default split, {percent}% today.',
  'recurring.sheetOnlyHint':
    'Quarterly and annual schedules live in the recurring tab of your sheet, and this form keeps them.',
  'recurring.editScopeHint': 'Months already recorded keep the figures they were recorded with.',
  'recurring.retire': 'Stop this cost',
  'recurring.restore': 'Start this cost again',
  'recurring.delete': 'Delete for good',
  'recurring.deleteTitle': 'Delete for good',
  // The description is the whole guard. "Delete" does not tell anyone that what is
  // lost is the sheet's record of which months this cost already covered — and that
  // adding it back afterwards can therefore record a month twice.
  'recurring.deleteHint':
    'Removes the row from the recurring tab. The entries it already added stay in your ledger, but the sheet forgets which months it covered — so adding this cost again could record a month twice. Stopping it keeps that memory.',

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
  // The slider's spoken value. A range otherwise announces a bare "70", which
  // says nothing about whose share it is.
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
  // The five presets, named after the traditional dye colours they are taken
  // from. Latin names in English, the kanji names in Japanese.
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
  // Removing rows shifts every row below them, so it cannot run while a write is
  // still resolving its own row number.
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
  // Every failed Sheets request lands here. The API's own English text stays on
  // the error for the console; this is what the person is told.
  'error.sheetRequest': 'The sheet would not answer. Try again in a moment.',
  // 403/404: not a blip. The account can no longer reach the spreadsheet, so
  // retrying forever would just hide it behind "showing saved data".
  'error.sheetUnreachable':
    'This app can no longer reach the sheet. Check that it is still shared with the account that owns it.',
  // `ensureStructure` refusing to adopt a spreadsheet that is somebody else's work.
  'error.notOurSheet':
    'That spreadsheet already has other tabs and none of this app’s, so it is probably not the ledger. Check the SHEET_ID script property.',
  'error.entryGone': 'That entry is no longer in the sheet. Refresh to see the latest data.',
  'error.missingTabs': 'Could not find the expenses tabs in the sheet.',
  // Both paths that report a bad key end here: the reply to a just-typed key,
  // and the notice on a later launch that still holds a rejected one.
  'error.badKey': 'That app key was rejected. Check it, or ask for the current one.',
  'error.keyRequired': 'Enter your app key.',
  'error.offline': 'Could not reach the sheet. Check your connection and try again.',
  'error.scriptUnavailable': 'The sheet service is busy or unavailable. Try again in a moment.',
  // The script's own authorization lapsed — an unpublished consent screen expires
  // after 7 days. Names the fix, because retrying cannot help.
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
  // Template validation. `badPayer` and `badShare` are shared with an entry: the same
  // cell means the same thing, so a second sentence would be a second translation.
  'error.missingDescription': 'Give it a name, like Rent.',
  'error.badTemplateAmount': 'Amount must be a whole number of yen, or empty if it varies.',
  'error.badDay': 'Day of the month must be between 1 and 31.',
  // Two rows carrying one id: writing to either would put one cost's values over the
  // other's, so the fix has to happen in the sheet.
  'error.duplicateTemplate':
    'Two rows in the recurring tab share one id, so this cannot be saved safely. Give one of them a different id in the sheet.',
  'warning.staleData': 'Showing saved data — could not reach the sheet.',
  // The config tab is gone or renamed, so every value falls back to a default —
  // including each person's default split, which decides how every expense divides.
  'warning.configMissing':
    'The config tab is missing, so names, categories and the default split are the defaults. Restore it in the sheet.',
  // These rows are in the balance but belong to no month, so they appear in no
  // list and cannot be found from here.
  'warning.undatedRows': {
    one: '{count} row in the sheet has a date that cannot be read, so it appears in no month.',
    other: '{count} rows in the sheet have dates that cannot be read, so they appear in no month.',
  },
  // A row whose amount cell cannot be read at all is left out of every total, so the
  // balance is short by it. Naming the count is the only way anyone would know.
  'warning.undecodedRows': {
    one: '{count} row in the sheet has an amount that cannot be read, so it is left out of the totals.',
    other:
      '{count} rows in the sheet have amounts that cannot be read, so they are left out of the totals.',
  },
  // Settlements only: an expense takes its payer from the tab it sits in, so the
  // settlements tab holds the one payer cell anybody can get wrong. Names the cell,
  // because that is what has to be fixed and the amount may read perfectly well.
  'warning.unattributedRows': {
    one: '{count} settlement names nobody who paid, so it is left out of the balance.',
    other: '{count} settlements name nobody who paid, so they are left out of the balance.',
  },
  // Nothing on screen is wrong because of one of these — which is why it is the last
  // notice — but a recurring cost that stops being offered is exactly the forgetting the
  // recurring tab exists to prevent, so it cannot be silent either. "Cannot be used" rather
  // than "cannot be read": the count also covers a row whose id another row already has,
  // which reads perfectly well. And it names the page, not "above" — nothing about recurring
  // costs is on the ledger.
  'warning.undecodedTemplates': {
    one: '{count} row in the recurring tab cannot be used, so it is missing from Recurring costs.',
    other:
      '{count} rows in the recurring tab cannot be used, so they are missing from Recurring costs.',
  },
}
