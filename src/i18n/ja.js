/**
 * Japanese catalog. Same key set as `en.js` — enforced by `test/i18n.test.js`,
 * which also checks that the `{placeholder}` set matches per key and that no
 * value is left identical to the English one outside a small allowlist.
 *
 * Japanese has a single cardinal plural category, so plural entries carry only
 * `other`. That is correct rather than lazy: `Intl.PluralRules('ja')` reports
 * exactly `['other']`, and the test asserts the catalog matches it, so adding a
 * fake `one` here would fail.
 *
 * Style notes: 、and 。are used rather than commas and full stops; の is used for
 * possessives; the interpunct · already sits inside the English separator keys so
 * it is a translation decision here too.
 */
export default {
  // --- app chrome -----------------------------------------------------------
  'app.name': '家計シェア',
  'app.tagline': '食費と日用品を、ふたりで分けて記録。',

  'common.you': 'あなた',
  'common.person1': 'ひとり目',
  'common.person2': 'ふたり目',
  'common.cancel': 'キャンセル',
  'common.save': '保存',
  'common.add': '追加',
  'common.close': '閉じる',
  'common.retry': 'もう一度試す',
  'common.optional': '任意',

  'header.refresh': 'シートから再読み込み',
  'header.settings': '設定',

  'month.previous': '前の月',
  'month.next': '次の月',

  // --- balance --------------------------------------------------------------
  'balance.title': '貸し借り',
  'balance.youOwe': '{name}に支払い',
  'balance.owesYou': '{name}から受け取り',
  'balance.settled': '精算ずみ',
  'balance.settledCaption': '貸し借りはありません。',
  'balance.settle': '精算する',

  // --- month summary --------------------------------------------------------
  'summary.title': '今月',
  'summary.paid': '{name}の支払い',
  'summary.byCategory': 'カテゴリー別',
  'summary.whoPaid': '支払った人',
  'summary.uncategorized': '未分類',
  'summary.other': 'その他',
  'summary.chartLabel': 'カテゴリー別の支出',
  'summary.share': '{percent}%',

  // --- dates ----------------------------------------------------------------
  'date.today': '今日',
  'date.yesterday': '昨日',
  'date.none': '日付なし',

  // --- entry list -----------------------------------------------------------
  'list.loading': '読み込み中',
  'list.emptyTitle': '今月の記録はまだありません',
  'list.emptyText': '買い物やふたりで食べた食事を追加しましょう。',
  'list.emptyAction': '支出を追加',

  'entry.expense': '支出',
  'entry.settled': '精算',
  'entry.paid': '{name}の支払い',
  'entry.paidCategory': '{name}の支払い・{category}',
  'entry.settlementMeta': '{payer}が{other}に支払い',
  'entry.onlyPerson': '{name}のみ',
  'entry.splitPercent': '{name}が{percent}%',
  'entry.deleteSettlement': '精算を削除',
  'entry.delete': '{description}を削除',
  'entry.metaSeparator': '・',

  // --- add / edit form ------------------------------------------------------
  'form.addTitle': '支出を追加',
  'form.editTitle': '支出を編集',
  'form.settleTitle': '精算する',
  'form.amount': '金額',
  'form.amountPlaceholder': '0',
  'form.amountError': '{example}のように金額を入力してください',
  'form.whoPaid': '支払った人',
  'form.paidBy': '支払った人',
  'form.settlementHint': '{payer}が{other}に返したことを記録します。',
  'form.date': '日付',
  'form.category': 'カテゴリー',
  'form.note': 'メモ',
  'form.notePlaceholder': 'いつもの買い物',
  'form.split': '分担',
  'form.splitEven': '半分ずつ',
  'form.splitCustom': 'カスタム',
  'form.splitAll': '{name}が全額',
  'form.splitHalf': '半分',
  'form.splitShare': '{name}の負担',
  'form.breakdown': '{payer}：{payerAmount}・{other}：{otherAmount}',
  'form.deleteEntry': 'この記録を削除',
  'form.saveError': '保存できませんでした。',

  // --- settings -------------------------------------------------------------
  'settings.title': '設定',
  'settings.youAre': 'あなたは',
  'settings.youAreHint': 'この端末での表示だけが変わります。',
  'settings.language': '言語',
  'settings.languageHint': 'この端末に保存されます。シートには影響しません。',
  'settings.sheet': 'シート',
  'settings.openSheet': 'Google スプレッドシートで開く',
  'settings.switchSheet': 'シートを切り替える',
  'settings.configTitle': '名前・通貨・カテゴリー',
  'settings.configHint':
    'これらはシートの{tab}タブから読み込まれます。変更したらタブを編集して再読み込みしてください。',
  'settings.deletedRows': '削除ずみの行',
  'settings.deletedRowsHint':
    '削除した記録は、行の位置がずれず「元に戻す」が使えるように、シートに印だけ残ります。まとめて消すと元に戻せません。',
  'settings.removeRows': {
    other: '{count}行を完全に削除',
  },
  'settings.nothingToRemove': '削除するものはありません',
  'settings.removedRows': {
    other: '{count}行を削除しました。',
  },
  'settings.compactError': 'シートを整理できませんでした。',
  'settings.signOut': 'ログアウト',
  'settings.signOutAs': 'ログアウト（{email}）',

  // --- gates ----------------------------------------------------------------
  'gate.unconfiguredTitle': '設定が未完了です',
  'gate.unconfiguredBody':
    'このビルドには{clientId}または{apiKey}がありません。どちらもビルド時に設定する公開値です。',
  'gate.unconfiguredFollow':
    '{setup}に従って作成し、ローカル開発では{env}に、GitHub Pages ではリポジトリ変数に設定してください。',
  'gate.signIn': 'Google でログイン',
  'gate.signInFine':
    'このアプリが求めるのは、選んだ 1 つのスプレッドシートへのアクセスだけです。Drive 全体ではありません。',
  'gate.sheetTitle': 'シートを選ぶ',
  'gate.sheetBody':
    '新しいスプレッドシートを作るか、すでにあるものをつなぎます。あとから変更できます。',
  'gate.createSheet': '新しいシートを作る',
  'gate.chooseSheet': 'すでにあるシートを選ぶ',
  'gate.identityTitle': 'あなたはどちらですか？',
  'gate.identityBody':
    '名前ではなく「あなた」と表示するために使います。この端末にのみ保存されます。',
  'gate.identityFine': '表示が違う場合は、シートの{tab}タブで名前を設定してください。',
  'gate.loading': '読み込み中',
  'gate.loadingSheet': 'シートを読み込んでいます',
  'gate.errorTitle': 'シートを読み込めませんでした',
  'gate.pickDifferent': '別のシートを選ぶ',

  // --- toasts and errors ----------------------------------------------------
  'toast.deleted': '削除しました',
  'toast.undo': '元に戻す',
  'toast.deleteFailed': '削除できませんでした。',
  'error.readSheet': 'シートを読み込めませんでした。',
  'error.prepareSheet': 'シートを準備できませんでした。',
  'error.signIn': 'ログインできませんでした。',
  'error.missingId': 'ID がありません。',
  'error.badDate': '日付は YYYY-MM-DD 形式の実在する日を入力してください。',
  'error.badAmount': '金額は 0 より大きい値を入力してください。',
  'error.badPayer': '支払った人はふたりのどちらかを選んでください。',
  'error.badShare': '分担は 0〜100% の範囲で指定してください。',
  'error.missingCategory': 'カテゴリーを選んでください。',
  'warning.mixedCurrencies': '通貨の違う記録があるため、合計が正しくない可能性があります。',
}
