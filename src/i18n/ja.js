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
  // 助詞は同じなので、英語と違って形は一つで足りる。
  'common.yourPossessive': 'あなたの',
  'common.namePossessive': '{name}の',
  'common.cancel': 'キャンセル',
  'common.save': '保存',
  'common.add': '追加',
  'common.addExpense': '支出を追加',
  'common.delete': '削除',
  'common.close': '閉じる',
  'common.retry': 'もう一度試す',
  'common.optional': '任意',
  'common.paid': '{name}の支払い',
  'common.whoPaid': '支払った人',
  'common.notePresets': 'よく使うメモ',

  'header.refresh': 'シートから再読み込み',
  'header.settings': '設定',

  'month.previous': '前の月',
  'month.next': '次の月',

  // --- balance --------------------------------------------------------------
  'balance.youOwe': '{name}に支払い',
  'balance.owesYou': '{name}から受け取り',
  'balance.youOweAmount': '{name}に{amount}の支払い',
  'balance.owesYouAmount': '{name}から{amount}の受け取り',
  'balance.settled': '精算ずみ',

  // --- month summary --------------------------------------------------------
  'summary.title': '今月',
  'summary.byCategory': 'カテゴリー別',
  'summary.uncategorized': '未分類',
  'summary.other': 'その他',
  'summary.chartLabel': 'カテゴリー別の支出',
  'summary.meterLabel': '{name1}{amount1}、{name2}{amount2}',
  'summary.share': '{percent}%',

  // --- dates ----------------------------------------------------------------
  'date.today': '今日',
  'date.yesterday': '昨日',
  'date.none': '日付なし',

  // --- entry list -----------------------------------------------------------
  'list.emptyTitle': '今月の記録はまだありません',
  'list.emptyText': '買い物やふたりで食べた食事を追加しましょう。',

  'entry.expense': '支出',
  'entry.settled': '精算',
  'entry.paidCategory': '{name}の支払い・{category}',
  'entry.settlementMeta': '{payer}が{other}に支払い',
  'entry.onlyPerson': '{name}のみ',
  'entry.splitPercent': '{name}が{percent}%',
  'entry.deleteSettlement': '精算を削除',
  'entry.delete': '{description}を削除',
  'entry.metaSeparator': '・',

  // --- recurring costs ------------------------------------------------------
  'recurring.title': '定期の支出',
  'recurring.settingsHint': '家賃やジムなど、毎月かかって金額が分かっているもの。',
  'recurring.manageCount': {
    other: '{count}件を管理',
  },
  'recurring.manageEmpty': '設定する',
  'recurring.hint': '{month}を表示しています。タップすると編集できます。',
  'recurring.empty': 'まだありません。家賃など、毎月かかるものを追加しましょう。',
  'recurring.notLoaded': 'まだ読み込めていません。シートを読み込んでからお試しください。',
  'recurring.add': '定期の支出を追加',
  'recurring.amountVaries': '金額は変動',
  'recurring.schedule': '{day}日',
  'recurring.recorded': '記録ずみ',
  'recurring.notYetDue': '{day}日に予定',
  'recurring.notThisMonth': '今月は対象外',
  'recurring.record': '記録',
  'recurring.recordName': '{name}を記録',

  'recurring.addTitle': '定期の支出を追加',
  'recurring.editTitle': '定期の支出を編集',
  'recurring.name': '名前',
  'recurring.namePlaceholder': '家賃',
  'recurring.nameError': '見分けられるように名前を入力してください。',
  'recurring.amountHint': '毎月変わる場合は空のままにしてください。',
  'recurring.day': '毎月の日付',
  'recurring.dayHint': 'この日より前には記録されません。31日は短い月の末日になります。',
  'recurring.splitDefault': '既定',
  'recurring.splitDefaultHint': '{owner}既定の分担に従います。現在は{percent}%です。',
  'recurring.sheetOnlyHint':
    '四半期ごと・年ごとの設定はシートの recurring タブにあり、この画面では変更されません。',
  'recurring.editScopeHint': 'すでに記録した月は、記録した時点の金額のままです。',
  'recurring.retire': 'この支出を止める',
  'recurring.restore': 'この支出を再開する',
  'recurring.saveError': '保存できませんでした。',

  // --- deleted entries ------------------------------------------------------
  'deleted.title': {
    other: '削除ずみ・{count}件',
  },
  'deleted.hint':
    'この月に削除した記録です。ここで元に戻すか、設定ですべての削除ずみを完全に削除できます。',
  'deleted.meta': '{date}・{name}の支払い',
  'deleted.restore': '元に戻す',
  'deleted.restoreEntry': '{description}を元に戻す',

  // --- delete confirmation --------------------------------------------------
  'confirm.deleteTitle': 'この記録を削除しますか？',
  'confirm.deleteBody':
    '{description}・{amount}は下の「削除ずみ」に移ります。そこから元に戻せます。',

  // --- add / edit form ------------------------------------------------------
  'form.addTitle': '支出を追加',
  'form.editTitle': '支出を編集',
  'form.editSettlementTitle': '精算を編集',
  'form.amount': '金額',
  'form.amountError': '{example}のように金額を入力してください',
  'form.amountPlaceholder': '0',
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
  'form.splitShare': '{owner}負担',
  'form.splitValue': '{owner}負担、{percent}%',
  'form.breakdown': '{payer}：{payerAmount}・{other}：{otherAmount}',
  'form.deleteEntry': 'この記録を削除',
  'form.saveError': '保存できませんでした。',

  // --- settings -------------------------------------------------------------
  'settings.title': '設定',
  'settings.youAre': 'あなたは',
  'settings.youAreHint': 'この端末での表示だけが変わります。',
  'settings.language': '言語',
  'settings.languageHint': 'この端末に保存されます。シートには影響しません。',
  'settings.accent': 'アクセントカラー',
  'settings.accentHint': '言語と同じく、この端末だけの設定です。',
  'accent.indigo': '藍',
  'accent.pine': '松葉',
  'accent.teal': '青緑',
  'accent.plum': '紫根',
  'accent.sepia': '焦茶',
  'settings.sheet': 'シート',
  'settings.openSheet': 'Google スプレッドシートで開く',
  'settings.configTitle': '名前・カテゴリー',
  'settings.defaultSplit': '既定の分担',
  'settings.defaultSplitValue': '{name}が支払ったとき、{name}の負担は{percent}%',
  'settings.defaultSplitHint':
    '新しい記録での、その人自身の負担です。configタブのdefault_split_p1とdefault_split_p2で設定します。',
  'settings.notePresetsEmpty': 'まだありません。configタブに{key}の行を追加してください。',
  'settings.configHint':
    'これらはシートの{tab}タブから読み込まれます。変更したらタブを編集して再読み込みしてください。',
  'settings.deletedRows': '削除ずみの行',
  'settings.deletedRowsHint':
    '削除した記録は、行の位置がずれず「削除ずみ」から元に戻せるように、シートに印だけ残ります。まとめて消すと元に戻せません。',
  'settings.removeRows': {
    other: '{count}行を完全に削除',
  },
  'settings.nothingToRemove': '削除するものはありません',
  'settings.removedRows': {
    other: '{count}行を削除しました。',
  },
  'settings.compactError': 'シートを整理できませんでした。',
  'settings.compactBusy': '保存中の変更があります。少し待ってからもう一度お試しください。',
  'settings.forgetKey': 'この端末からキーを削除',
  'settings.forgetKeyTitle': 'アプリキー',
  'settings.forgetKeyHint':
    'この端末からキーとキャッシュを削除します。スプレッドシートはそのままですが、再度開くにはキーが必要です。',

  // --- gates ----------------------------------------------------------------
  'gate.unconfiguredTitle': '設定が未完了です',
  'gate.unconfiguredBody': 'このビルドには{scriptUrl}がありません。ビルド時に設定する公開値です。',
  'gate.unconfiguredFollow':
    '{setup}に従ってトークン用のエンドポイントを配置し、その URL をローカル開発では{env}に、GitHub Pages ではリポジトリ変数に設定してください。',
  'gate.keyLabel': 'アプリキー',
  'gate.keyPlaceholder': 'アプリキーを貼り付け',
  'gate.connect': 'つなぐ',
  'gate.keyFine':
    'この端末にのみ保存され、次回から聞かれることはありません。同じキーをふたりの端末に入れます。Google のログインはなく、期限切れもありません。',
  'gate.identityTitle': 'あなたはどちらですか？',
  'gate.identityBody':
    '名前ではなく「あなた」と表示するために使います。この端末にのみ保存されます。',
  'gate.identityFine': '表示が違う場合は、シートの{tab}タブで名前を設定してください。',
  'gate.loadingSheet': 'シートを読み込んでいます',
  'gate.errorTitle': 'シートを読み込めませんでした',

  // --- toasts and errors ----------------------------------------------------
  'toast.added': '追加しました',
  'toast.saved': '保存しました',
  'toast.deleted': '削除しました',
  'toast.deleteFailed': '削除できませんでした。',
  'toast.restored': '元に戻しました',
  'toast.retired': '止めました',
  'toast.restoreFailed': '元に戻せませんでした。',
  'error.readSheet': 'シートを読み込めませんでした。',
  'error.sheetRequest': 'シートが応答しませんでした。少し待ってからもう一度お試しください。',
  'error.sheetUnreachable':
    'このアプリからシートにアクセスできなくなりました。シートの所有アカウントと共有されているか確認してください。',
  'error.notOurSheet':
    'このスプレッドシートには他のタブがあり、このアプリのタブがありません。台帳ではない可能性があります。SHEET_ID プロパティを確認してください。',
  'error.entryGone': 'この項目はもうシートにありません。更新して最新の状態を確認してください。',
  'error.missingTabs': 'シートに支出タブが見つかりませんでした。',
  'error.badKey':
    'このアプリキーは受け付けられませんでした。確認するか、今のキーを聞いてください。',
  'error.keyRequired': 'アプリキーを入力してください。',
  'error.offline': 'シートにつながりませんでした。通信を確認してもう一度お試しください。',
  'error.scriptUnavailable':
    'シートのサービスが混み合っているか、利用できません。少し待ってからお試しください。',
  'error.scriptUnauthorized':
    'シートのサービスを再承認する必要があります。Apps Script プロジェクトを開いて一度実行し、同意画面を公開してください。',
  'error.scriptMisconfigured':
    'トークン用のエンドポイントがシート ID を返しませんでした。SHEET_ID プロパティを確認してください。',
  'error.missingId': 'ID がありません。',
  'error.badDate': '日付は YYYY-MM-DD 形式の実在する日を入力してください。',
  'error.badAmount': '金額は 0 より大きい値を入力してください。',
  'error.badPayer': '支払った人はふたりのどちらかを選んでください。',
  'error.badShare': '分担は 0〜100% の範囲で指定してください。',
  'error.missingCategory': 'カテゴリーを選んでください。',
  'error.missingDescription': '「家賃」のように名前を入力してください。',
  'error.badTemplateAmount': '金額は円単位の整数、または変動する場合は空にしてください。',
  'error.badDay': '毎月の日付は 1〜31 で指定してください。',
  'error.duplicateTemplate':
    'recurring タブの2行が同じ ID を使っているため、安全に保存できません。シートでどちらかの ID を変更してください。',
  'warning.staleData': '保存したデータを表示しています。シートにつながりませんでした。',
  // `Intl.PluralRules('ja')` reports only `other`, so a single branch is correct.
  'warning.configMissing':
    'config タブが見つからないため、名前・カテゴリー・既定の分担は既定値です。シートで復元してください。',
  'warning.undatedRows': {
    other: 'シートに日付を読み取れない行が {count} 行あるため、どの月にも表示されません。',
  },
  'warning.undecodedRows': {
    other: 'シートに金額を読み取れない行が {count} 行あるため、合計に含まれていません。',
  },
  'warning.unattributedRows': {
    other: '支払った人を読み取れない精算が {count} 件あるため、残高に含まれていません。',
  },
  'warning.undecodedTemplates': {
    other: 'recurring タブの{count}行が使えないため、「定期の支出」に表示されません。',
  },
}
