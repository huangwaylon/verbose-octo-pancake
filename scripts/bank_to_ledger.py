#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Turn a bank export into rows you can paste into the ledger.

    uv run scripts/bank_to_ledger.py statement.tsv
    uv run scripts/bank_to_ledger.py statement.tsv -o rows.csv --payer p1

Expenses go to the output file and paste straight into `expenses_p1!A2` (or p2) under
the existing header. Settlements have their own tab and their own columns, so they get
their own `.settlements.csv` beside it — written only when there are any.
`test/schema.test.js` pins this copy of that list against the real one, because
this file cannot import it and a silent disagreement writes every value under the
wrong field. Amounts are whole yen exactly as `entryToRow` writes them, and
nothing is localized.

Everything the script decides is decided by RULES below: first match wins, and
whatever matches nothing becomes a shared "Other" expense AND is listed in the
summary so you can add a rule for it. The summary also reconciles every yen in
the file against every yen out of it — the point is that a row can be dropped
only on purpose.

Conventions that mirror the app:
  * payer_share is the fraction the PAYER covers themselves. 1.0 = paid in
    full by the payer (the other person owes nothing); 0.8 = shared with the
    payer bearing 80%; 0 = a settlement.
  * A settlement carries no category and is never spending.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
import uuid
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------------------
# Rules. First match wins, so put the specific one above the general one
# (ライフドラッグ is a drugstore; ライフ is the supermarket next door).
#
#   (pattern, category, mode, label)
#
# mode: "personal"   -> payer_share 1.0
#       "shared"     -> payer_share --share (default 0.8)
#       "even"       -> payer_share 0.5
#       "settlement" -> a settlement row, no category
#       "skip"       -> not a purchase; dropped and counted
#
# `label` replaces the merchant name in the description when it is set.
#
# Patterns are matched loosely: case, ASCII/full-width, spaces, punctuation and
# small kana are all folded away first, and every kind of dash — including the
# katakana long vowel mark — becomes one character, so a single spelling matches
# every way the bank renders a name (ラクテンカ－ドサ－ビス == ラクテンカードサービス).
#
# The long vowel mark is FOLDED rather than dropped, because dropping it leaves
# オーケー as a two-character pattern that would match half the file by accident.
#
# A rule is tried against the merchant name first and only then against the
# merchant plus your note, so a note that happens to name a different shop
# ("ozeki groceries" written against an OK Mart row) cannot outvote the merchant.
# ---------------------------------------------------------------------------

RULES: list[tuple[str, str | None, str, str | None]] = [
    # -- not purchases -------------------------------------------------------
    ("給与振込", None, "skip", None),
    ("決算利息", None, "skip", None),
    ("利息特典", None, "skip", None),
    ("デビットリョウキャッシュバック", None, "skip", None),
    ("セブンATM", None, "skip", None),
    ("IBショウケン", None, "skip", None),
    ("ラクテンカードサービス", None, "skip", None),
    ("シバゼイムショ", None, "skip", None),
    ("エスケーエナジー", None, "skip", None),
    # Bought for someone who paid it straight back, so both halves of the pair
    # are dropped: the note is what identifies the debit side.
    ("アンドリュー", None, "skip", None),
    ("ANDREW", None, "skip", None),
    # -- settlements ---------------------------------------------------------
    ("ウメダ アスカ", None, "settlement", None),
    ("シノケンコミュニケーションズ", None, "settlement", "Rent"),
    ("カイコーポレーション", None, "settlement", "Rent"),
    # -- paid in full by me --------------------------------------------------
    ("六本木ヒルズ", "Work lunch", "personal", None),
    ("ROPPONGI HILLS", "Work lunch", "personal", None),
    ("ROPPONGIHIRUZU", "Work lunch", "personal", None),
    ("森ビル関連施設", "Work lunch", "personal", None),
    ("CAFF MACS", "Work lunch", "personal", None),
    ("CAFFE MACS", "Work lunch", "personal", None),
    ("海南鶏飯食堂", "Work lunch", "personal", None),
    ("HAINANJIFANSYOKUDO", "Work lunch", "personal", None),
    ("大戸屋 六本木", "Work lunch", "personal", None),
    ("ポンパドウル六本木", "Work lunch", "personal", None),
    ("フリホーレス 六本木", "Work lunch", "personal", None),
    ("モバイルSUICA", "Transport", "personal", "Suica top-up"),
    ("AMAZON.CO.JP", "Shopping", "personal", None),
    ("APPLE COM BILL", "Shopping", "personal", None),
    ("APPLE.COM", "Shopping", "personal", None),
    ("AF大崎", "Health", "personal", "Gym"),
    # -- health / pharmacy (before the supermarkets) -------------------------
    ("ライフドラッグ", "Health", "shared", None),
    ("マツモトキヨシ", "Health", "shared", None),
    ("ツルハドラッグ", "Health", "shared", None),
    ("スギ薬局", "Health", "shared", None),
    ("トモズ", "Health", "shared", None),
    ("ココカラファイン", "Health", "shared", None),
    # -- groceries -----------------------------------------------------------
    ("ライフ", "Groceries", "shared", None),
    ("LIFE CORPORATION", "Groceries", "shared", None),
    ("京急ストア", "Groceries", "shared", None),
    ("KEIKYU STORE", "Groceries", "shared", None),
    ("オオゼキ", "Groceries", "shared", None),
    ("OZEKI", "Groceries", "shared", None),
    ("オーケー", "Groceries", "shared", None),
    ("OK TOGOSHI", "Groceries", "shared", None),
    ("リンコス", "Groceries", "shared", None),
    ("LINCOS", "Groceries", "shared", None),
    ("ピーコックストア", "Groceries", "shared", None),
    ("マルエツ", "Groceries", "shared", None),
    ("サミット", "Groceries", "shared", None),
    ("成城石井", "Groceries", "shared", None),
    ("東急ストア", "Groceries", "shared", None),
    ("TOKYU STORE", "Groceries", "shared", None),
    ("ビッグ・エー", "Groceries", "shared", None),
    ("リブレ京成", "Groceries", "shared", None),
    ("まいばすけっと", "Groceries", "shared", None),
    ("旬八青果店", "Groceries", "shared", None),
    ("韓国広場", "Groceries", "shared", None),
    ("中島水産", "Groceries", "shared", None),
    ("ヒカリ屋", "Groceries", "shared", None),
    ("フードスタイル", "Groceries", "shared", None),
    ("フードワン", "Groceries", "shared", None),
    ("カルディ", "Groceries", "shared", None),
    ("KALDI", "Groceries", "shared", None),
    ("おかしのまちおか", "Groceries", "shared", None),
    ("ほしのベーカリー", "Groceries", "shared", None),
    ("AMBIKA", "Groceries", "shared", None),
    ("セブンイレブン", "Groceries", "shared", None),
    ("ローソン", "Groceries", "shared", None),
    ("LAWSON", "Groceries", "shared", None),
    ("ファミリーマート", "Groceries", "shared", None),
    ("ミニストップ", "Groceries", "shared", None),
    # -- household -----------------------------------------------------------
    ("ダイソー", "Household", "shared", None),
    ("DAISO", "Household", "shared", None),
    ("セリア", "Household", "shared", None),
    ("3COINS", "Household", "shared", None),
    ("コーナン", "Household", "shared", None),
    ("ドン・キホーテ", "Household", "shared", None),
    ("ニトリ", "Household", "shared", None),
    ("クロネコヤマト", "Household", "shared", None),
    ("日本郵便", "Household", "shared", None),
    # -- shopping ------------------------------------------------------------
    ("ユニクロ", "Shopping", "shared", None),
    ("UNIQLO", "Shopping", "shared", None),
    ("ジーユー", "Shopping", "shared", None),
    ("エービーシーマート", "Shopping", "shared", None),
    ("OWNDAYS", "Shopping", "shared", None),
    ("ソフマップ", "Shopping", "shared", None),
    ("BOOKOFF", "Shopping", "shared", None),
    ("ブックスタマ", "Shopping", "shared", None),
    ("NOMA BOOKS", "Shopping", "shared", None),
    ("ホビーオフ", "Shopping", "shared", None),
    ("モンベル", "Shopping", "shared", None),
    ("アンドレザー", "Shopping", "shared", None),
    ("やまよ", "Shopping", "shared", None),
    ("ウィットスポーツ", "Shopping", "shared", None),
    ("イオンモール", "Shopping", "shared", None),
    ("五反田東急スクエア", "Shopping", "shared", None),
    ("スクランブルスクエア", "Shopping", "shared", None),
    ("渋谷ストリーム", "Shopping", "shared", None),
    ("コクミン", "Shopping", "shared", None),
    # -- travel --------------------------------------------------------------
    ("DELTA AIR", "Travel", "shared", None),
    ("成田国際空港", "Travel", "shared", None),
    ("羽田空港", "Travel", "shared", None),
    ("東急ハーヴェストクラブ", "Travel", "shared", None),
    ("ホテル天坊", "Travel", "shared", None),
    ("赤倉観光ホテル", "Travel", "shared", None),
    ("スキージョウ", "Travel", "shared", None),
    ("サービスエリア", "Travel", "shared", None),
    ("パーキングエリア", "Travel", "shared", None),
    ("双葉SA", "Travel", "shared", None),
    ("道の駅", "Travel", "shared", None),
    ("食の駅", "Travel", "shared", None),
    ("国営昭和記念公園", "Travel", "shared", None),
    ("ケンバイキ", "Travel", "shared", None),
    ("新江ノ島水族館", "Travel", "shared", None),
    ("クロスステーション", "Travel", "shared", None),
    # -- dining --------------------------------------------------------------
    ("とんかつ神楽坂さくら", "Dining", "shared", None),
    ("はま寿司", "Dining", "shared", None),
    ("スシロー", "Dining", "shared", None),
    ("くら寿司", "Dining", "shared", None),
    ("KURA戸越", "Dining", "shared", None),
    ("焼肉ライク", "Dining", "shared", None),
    ("リンガーハット", "Dining", "shared", None),
    ("マクドナルド", "Dining", "shared", None),
    ("MCDONALDS", "Dining", "shared", None),
    ("七宝麻辣湯", "Dining", "shared", None),
    ("麻辣先生", "Dining", "shared", None),
    ("大戸屋", "Dining", "shared", None),
    ("味四川", "Dining", "shared", None),
    ("中国料理百番", "Dining", "shared", None),
    ("ダイニー", "Dining", "shared", None),
    ("ヨプトッポッキ", "Dining", "shared", None),
    ("一芳", "Dining", "shared", None),
    ("大久保園", "Dining", "shared", None),
    ("ちゃんこ江戸沢", "Dining", "shared", None),
    ("東京ソラマチ", "Dining", "shared", None),
    ("銀だこ", "Dining", "shared", None),
    ("チェゴヤ", "Dining", "shared", None),
    ("魚がし日本一", "Dining", "shared", None),
    ("KOLLABO", "Dining", "shared", None),
    ("しんぱち食堂", "Dining", "shared", None),
    ("ダンダダン", "Dining", "shared", None),
    ("台湾甜商店", "Dining", "shared", None),
    ("東京豆漿生活", "Dining", "shared", None),
    ("香家", "Dining", "shared", None),
    ("KITADE TACOS", "Dining", "shared", None),
    ("GUZMAN Y GOMEZ", "Dining", "shared", None),
    ("カオマンガイ", "Dining", "shared", None),
    ("SAIGON PAN", "Dining", "shared", None),
    ("ジェラート", "Dining", "shared", None),
    ("五代目花山うどん", "Dining", "shared", None),
    ("さわやか", "Dining", "shared", None),
    ("松の家", "Dining", "shared", None),
    ("らっか家", "Dining", "shared", None),
    ("大澤屋", "Dining", "shared", None),
    ("ぷるりん", "Dining", "shared", None),
    ("THE DEN", "Dining", "shared", None),
    ("SUPER RAW", "Dining", "shared", None),
    ("HEY'S DINER", "Dining", "shared", None),
    ("GRASS HOUSE", "Dining", "shared", None),
    ("SEA BIRDS CAFE", "Dining", "shared", None),
    ("回転寿司", "Dining", "shared", None),
    ("燻製工房", "Dining", "shared", None),
    ("ナマステ", "Dining", "shared", None),
    ("PIKE PLACE CHOWDER", "Dining", "shared", None),
    ("BREADANDCOFFEE", "Dining", "shared", None),
    ("サンマルクカフェ", "Dining", "shared", None),
    ("サンマルクカフェ", "Dining", "shared", None),
    ("SANMARUKUKAFUE", "Dining", "shared", None),
    ("コージーコーナー", "Dining", "shared", None),
    ("カツマタ", "Dining", "shared", None),
    ("MAHALO", "Dining", "shared", None),
    ("スイーツバンク", "Dining", "shared", None),
    ("麦の家", "Dining", "shared", None),
    ("サニーヒルズ", "Dining", "shared", None),
    ("SQUARE", "Dining", "shared", None),
    ("花エリカ", "Other", "shared", None),
    ("GEIHINKAN", "Wedding", "shared", None),
    ("SQ*PASO", "Other", "shared", None),
    ("株式会社トムス", "Other", "shared", None),
    ("クロスステーショ", "Groceries", "shared", None),
    ("チイキセンタ", "Other", "shared", None),
    # -- last resort: shape of the name, not the name ------------------------
    ("薬局", "Health", "shared", None),
    ("ドラッグ", "Health", "shared", None),
    ("スーパー", "Groceries", "shared", None),
    ("青果", "Groceries", "shared", None),
    ("ストア", "Groceries", "shared", None),
    ("マート", "Groceries", "shared", None),
    ("寿司", "Dining", "shared", None),
    ("ラーメン", "Dining", "shared", None),
    ("うどん", "Dining", "shared", None),
    ("食堂", "Dining", "shared", None),
    ("居酒屋", "Dining", "shared", None),
    ("レストラン", "Dining", "shared", None),
    ("カフェ", "Dining", "shared", None),
    ("CAFE", "Dining", "shared", None),
    ("ベーカリー", "Dining", "shared", None),
    ("ホテル", "Travel", "shared", None),
]

# Whatever matched nothing at all.
FALLBACK = ("Other", "shared", None)


# Fixed so re-running the script produces the same ids: a second import of the
# same statement then reconciles against the first instead of duplicating it.
ID_NAMESPACE = uuid.UUID("6f9d1a2e-4b3c-5d6e-8f70-112233445566")

EXPENSE_COLUMNS = [
    "date",
    "description",
    "amount",
    "category",
    "payer_share",
    "deleted_at",
    "id",
]

# Settlements go in their own tab, which cannot say who paid the way an expenses tab
# does — hence the `payer` column, and no `category` or `payer_share`. Both lists are
# pinned against src/schema.js by test/schema.test.js.
SETTLEMENT_COLUMNS = [
    "date",
    "description",
    "amount",
    "payer",
    "deleted_at",
    "id",
]

DATE_RE = re.compile(r"^(\d{4})年(\d{1,2})月(\d{1,2})日$")
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
VISA_PREFIX_RE = re.compile(r"^Visa\s*デビット\s*\d+\s*\d*\s*")
AMOUNT_RE = re.compile(r"^\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^\d+(?:\.\d+)?$")

_SMALL_KANA = str.maketrans("ァィゥェォャュョッヮヵヶ", "アイウエオヤユヨツワカケ")
# Every dash-like character the bank uses, including the katakana long vowel
# mark, collapsed onto one. Folding rather than dropping: without the mark
# オーケー becomes the two-character オケ and matches names it has nothing to do with.
_DASHES = str.maketrans("‐‑–—−ー－-", "--------")
_DROP = set(" 　・･/,、。()＊*'’\"`&＆")


def loose(text: str) -> str:
    """Fold every way the bank might spell a name down to one comparable key."""
    folded = unicodedata.normalize("NFKC", text).upper()
    folded = folded.translate(_SMALL_KANA).translate(_DASHES)
    return "".join(ch for ch in folded if ch not in _DROP)


LOOSE_RULES = [(loose(pattern), *rest) for pattern, *rest in RULES]


@dataclass
class Txn:
    line_no: int
    raw: str
    date: str  # ISO
    description: str  # NFKC-normalized, Visa prefix stripped
    credit: int  # whole yen in
    debit: int  # whole yen out
    balance: int | None
    note: str


def split_columns(line: str) -> list[str]:
    """
    Columns, whether the export kept its tabs or had them expanded to spaces.

    Empty cells are load-bearing here: which of the money-in / money-out
    columns is filled is the only thing that says which direction a row went,
    so a splitter that collapses runs of blanks would silently turn a refund
    into a purchase.
    """
    if "\t" in line:
        return [cell.strip() for cell in line.split("\t")]
    # Tab stops rendered as four spaces: eight spaces is an empty cell, not a
    # wide gap. Merchant names use full-width spaces, so this never splits one.
    return [cell.strip() for cell in re.split(r" {4}", line)]


def parse_line(line: str, line_no: int) -> Txn | None:
    cols = split_columns(line)
    if not cols:
        return None

    match = DATE_RE.match(cols[0].strip())
    if not match:
        return None
    year, month, day = (int(part) for part in match.groups())
    date = f"{year:04d}-{month:02d}-{day:02d}"

    currency_at = next(
        (i for i, cell in enumerate(cols) if CURRENCY_RE.match(cell)),
        None,
    )
    if currency_at is None or currency_at + 3 >= len(cols):
        raise ValueError(f"line {line_no}: no currency column found")

    description = unicodedata.normalize(
        "NFKC", " ".join(cell for cell in cols[1:currency_at] if cell)
    )
    description = VISA_PREFIX_RE.sub("", description).strip()

    # The ledger is yen only, so a row in anything else cannot be written at all.
    # Refused loudly here rather than converted or rounded: this is an offline
    # script, so stopping costs a re-run, while guessing puts a 100x-wrong amount
    # into a real ledger.
    currency = cols[currency_at].upper()
    if currency != "JPY":
        raise ValueError(f"line {line_no}: {currency} is not JPY; this ledger is yen only")

    def money(cell: str) -> int:
        """
        A statement amount as whole yen.

        The yen has no sub-unit, so a decimal point here carries no value —
        "1480" and "1480.000000" are both ¥1480, and the bank's own export writes
        the second. A non-zero fraction means the column was misidentified, so it
        is refused rather than rounded away.
        """
        if not cell:
            return 0
        if not AMOUNT_RE.match(cell):
            raise ValueError(f"line {line_no}: {cell!r} is not an amount")
        whole, _, frac = cell.replace(",", "").partition(".")
        if frac.strip("0"):
            raise ValueError(f"line {line_no}: {cell!r} is not a whole number of yen")
        return int(whole)

    credit = money(cols[currency_at + 1])
    debit = money(cols[currency_at + 2])
    balance_cell = cols[currency_at + 3]
    balance = money(balance_cell) if balance_cell else None
    note = " ".join(cell for cell in cols[currency_at + 4 :] if cell).strip()

    if credit and debit:
        raise ValueError(f"line {line_no}: money in and money out on one row")
    if not credit and not debit:
        raise ValueError(f"line {line_no}: no amount")

    return Txn(line_no, line, date, description, credit, debit, balance, note)


def classify(txn: Txn) -> tuple[str | None, str, str | None, bool]:
    """
    (category, mode, label, matched) for a transaction. Never guesses silently.

    Three passes, in this order:

      1. `skip` rules against the merchant AND your note, because an exclusion
         is always deliberate and is sometimes only identifiable from the note
         (the laptop bought for someone who transferred the money straight back
         is an APPLE.COM row like any other).
      2. every rule against the merchant name alone.
      3. every rule against the merchant plus the note.

    The merchant gets a pass of its own before the note is consulted at all:
    notes are written loosely, and an OK Mart row noted "ozeki groceries" would
    otherwise be classified by a shop it was not bought at.

    `matched` is returned rather than inferred from the values, because a rule
    is allowed to answer exactly what the fallback answers — and "no rule
    matched" is the line in the summary that tells you to write a new one.
    """
    with_note = loose(txn.description + " " + txn.note)
    for pattern, category, mode, label in LOOSE_RULES:
        if mode == "skip" and pattern in with_note:
            return category, mode, label, True

    for key in (loose(txn.description), with_note):
        for pattern, category, mode, label in LOOSE_RULES:
            if pattern in key:
                return category, mode, label, True

    return (*FALLBACK, False)


def yen_text(yen: int) -> str:
    """Whole yen as a readable figure, for the summary only."""
    return f"{yen:,}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bank export -> rows for one person's expenses tab.",
    )
    parser.add_argument("input", type=Path, help="the bank export (tab- or space-aligned)")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="output CSV (default: <input>.ledger.csv; '-' for stdout)",
    )
    parser.add_argument(
        "--payer",
        choices=("p1", "p2"),
        default="p1",
        help="which tab these rows are for; it is only a reminder, the tab IS the payer",
    )
    parser.add_argument(
        "--share",
        type=float,
        default=0.8,
        help="payer_share for a shared expense (default 0.8: I bear 80%%)",
    )
    parser.add_argument(
        "--review-over",
        type=int,
        default=20000,
        help="list emitted rows above this amount so you can eyeball them (0 = off)",
    )
    parser.add_argument("--no-header", action="store_true", help="omit the header row")
    args = parser.parse_args()

    if not 0 <= args.share <= 1:
        parser.error("--share must be between 0 and 1")

    # Refused rather than repaired. A byte that is not UTF-8 means the export
    # is in some other encoding, and `errors="replace"` would quietly turn a
    # merchant name into question marks that then match no rule at all — which
    # reads as "no rule yet" rather than "this file was never decoded".
    try:
        text = args.input.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as error:
        print(f"error: {args.input} is not UTF-8 ({error}).", file=sys.stderr)
        print("       Re-export as UTF-8, or convert with `iconv -f cp932 -t utf-8`.", file=sys.stderr)
        return 1
    lines = text.splitlines()

    txns: list[Txn] = []
    non_transaction = 0
    problems: list[str] = []
    for line_no, line in enumerate(lines, start=1):
        if not line.strip():
            non_transaction += 1
            continue
        try:
            txn = parse_line(line, line_no)
        except ValueError as error:
            problems.append(str(error))
            continue
        if txn is None:
            non_transaction += 1
            continue
        txns.append(txn)

    if problems:
        for problem in problems:
            print(f"error: {problem}", file=sys.stderr)
        print(
            f"error: {len(problems)} row(s) could not be parsed; nothing written.",
            file=sys.stderr,
        )
        return 1

    # Soft cross-check. The statement is not always in balance order (reversals
    # get inserted where they were posted, not where they belong), so a break
    # here is reported and never acted on.
    chain_breaks = 0
    for previous, current in zip(txns, txns[1:]):
        if previous.balance is None or current.balance is None:
            continue
        if previous.balance + current.credit - current.debit != current.balance:
            chain_breaks += 1

    # The cells to be written, one list per tab. Named apart from the summary's
    # `expense_rows`/`settlement_rows` further down, which hold Txn tuples rather than
    # sheet rows — one name for two shapes in one function is how a count starts lying.
    expense_out: list[list[str]] = []
    settlement_out: list[list[str]] = []
    seen_ids: dict[str, int] = defaultdict(int)

    credits = [txn for txn in txns if txn.credit]
    debits = [txn for txn in txns if txn.debit]

    skipped: dict[str, list[Txn]] = defaultdict(list)
    unmatched: dict[str, list[Txn]] = defaultdict(list)
    by_category: dict[str, list[Txn]] = defaultdict(list)
    emitted: list[tuple[Txn, str, int, float, str]] = []  # txn, type, amount, share, category

    for txn in debits:
        category, mode, label, matched = classify(txn)
        if mode == "skip":
            skipped[txn.description].append(txn)
            continue

        if not matched:
            unmatched[txn.description].append(txn)

        if mode == "settlement":
            entry_type, share, category_out = "settlement", 0.0, ""
        else:
            entry_type = "expense"
            share = {"personal": 1.0, "even": 0.5}.get(mode, args.share)
            category_out = category or "Other"

        description = label or txn.description
        if txn.note and loose(txn.note) not in loose(description):
            description = f"{description} · {txn.note}"

        # Deterministic, and unique even for two identical purchases on one day:
        # the running balance differs, and the occurrence counter covers the
        # case where the statement repeats a row verbatim.
        seed = f"{txn.date}|{txn.description}|{txn.debit}|{txn.balance}"
        seen_ids[seed] += 1
        entry_id = str(uuid.uuid5(ID_NAMESPACE, f"{seed}|{seen_ids[seed]}"))

        # One list per tab, because the two layouts differ: a settlement carries the
        # payer it cannot get from its tab, and carries no category or share.
        if entry_type == "settlement":
            settlement_out.append(
                [txn.date, description, str(txn.debit), args.payer, "", entry_id]
            )
        else:
            expense_out.append(
                [
                    txn.date,
                    description,
                    str(txn.debit),
                    category_out,
                    str(share),
                    "",
                    entry_id,
                ]
            )
        emitted.append((txn, entry_type, txn.debit, share, category_out))
        if entry_type == "expense":
            by_category[category_out].append(txn)

    destination = args.output or args.input.with_suffix(args.input.suffix + ".ledger.csv")

    def write(path, columns, body):
        """One file per tab. Two layouts cannot share one paste."""
        if str(path) == "-":
            handle, closing = sys.stdout, False
        else:
            handle, closing = path.open("w", encoding="utf-8", newline=""), True
        try:
            writer = csv.writer(handle, lineterminator="\n")
            if not args.no_header:
                writer.writerow(columns)
            writer.writerows(body)
        finally:
            if closing:
                handle.close()

    write(destination, EXPENSE_COLUMNS, expense_out)
    # Only when there are any: an empty file is one more thing to notice and discard,
    # and a settlement is rare enough that most runs produce none.
    settlements_at = None
    if settlement_out and str(destination) != "-":
        settlements_at = destination.with_suffix(".settlements.csv")
        write(settlements_at, SETTLEMENT_COLUMNS, settlement_out)

    # ---------------------------------------------------------------- summary
    #
    # The reconciliation is the whole point of this section: a row may leave the
    # file only on purpose, so excluded + settlements + expenses has to equal every
    # debit in it. One integer per figure, because the ledger is yen only.
    out = sys.stderr

    def totals(items) -> int:
        return sum(item.debit or item.credit for item in items)

    debit_total = totals(debits)
    credit_total = totals(credits)
    skipped_all = [txn for group in skipped.values() for txn in group]
    skipped_total = totals(skipped_all)

    expense_rows = [row for row in emitted if row[1] == "expense"]
    settlement_rows = [row for row in emitted if row[1] == "settlement"]
    expense_total = totals(txn for txn, *_ in expense_rows)
    settlement_total = totals(txn for txn, *_ in settlement_rows)

    accounted = skipped_total + settlement_total + expense_total

    print(f"\nInput  {args.input}", file=out)
    print(f"  lines read                    {len(lines):>6}", file=out)
    print(f"  blank / not a transaction     {non_transaction:>6}", file=out)
    print(f"  transactions parsed           {len(txns):>6}", file=out)
    print(
        f"  running-balance check         {len(txns) - 1 - chain_breaks:>6} ok, "
        f"{chain_breaks} break(s)",
        file=out,
    )

    print("\nMoney in (credits) — ignored", file=out)
    print(f"  {len(credits):>6} rows  {yen_text(credit_total):>18}", file=out)

    print("\nMoney out (debits)", file=out)
    print(f"  {len(debits):>6} rows  {yen_text(debit_total):>18}", file=out)
    print(
        f"    excluded, not a purchase  {len(skipped_all):>6} rows  {yen_text(skipped_total):>18}",
        file=out,
    )
    print(
        f"    settlements               {len(settlement_rows):>6} rows  {yen_text(settlement_total):>18}",
        file=out,
    )
    print(
        f"    expenses                  {len(expense_rows):>6} rows  {yen_text(expense_total):>18}",
        file=out,
    )

    balanced = accounted == debit_total
    counted = len(skipped_all) + len(emitted) == len(debits)
    print(
        f"\n  check  {'OK  ' if balanced and counted else 'FAILED'} "
        f"excluded + settlements + expenses = {yen_text(accounted)}"
        f"  vs debits {yen_text(debit_total)}",
        file=out,
    )
    print(
        f"         {'OK  ' if counted else 'FAILED'} "
        f"{len(skipped_all)} excluded + {len(emitted)} written = {len(debits)} debit rows",
        file=out,
    )

    print(f"\nWritten  {destination}", file=out)
    print(f"  {len(expense_out)} data row(s) for expenses_{args.payer}", file=out)
    if settlements_at:
        print(f"         {settlements_at}", file=out)
        print(f"  {len(settlement_out)} data row(s) for settlements", file=out)
    elif settlement_out:
        print(f"  {len(settlement_out)} settlement row(s) NOT written (stdout is one tab)", file=out)

    def by_size(groups):
        return sorted(groups.items(), key=lambda kv: -sum(t.debit for t in kv[1]))

    if skipped:
        print("\nExcluded as not a purchase", file=out)
        for description, group in by_size(skipped):
            print(f"  {len(group):>4} × {yen_text(totals(group)):>14}  {description}", file=out)

    if by_category:
        print("\nExpense categories written (add any missing ones to the config tab)", file=out)
        ranked = sorted(by_category.items(), key=lambda kv: -sum(t.debit for t in kv[1]))
        for category, group in ranked:
            print(f"  {len(group):>4} × {yen_text(totals(group)):>14}  {category}", file=out)

    if settlement_rows:
        print("\nSettlements written", file=out)
        for txn, *_ in settlement_rows:
            amount = yen_text(txn.debit)
            print(f"  {txn.date}  {amount:>14}  {txn.description}", file=out)

    if unmatched:
        print("\nNo rule matched — written as a shared 'Other' expense", file=out)
        for description, group in by_size(unmatched):
            print(f"  {len(group):>4} × {yen_text(totals(group)):>14}  {description}", file=out)

    if args.review_over:
        big = sorted(
            (row for row in emitted if row[0].debit >= args.review_over),
            key=lambda row: -row[0].debit,
        )
        if big:
            print(f"\nWorth a look — over ¥{args.review_over:,}", file=out)
            for txn, entry_type, _, share, category in big:
                kind = "settlement" if entry_type == "settlement" else f"{category} @ {share}"
                amount = yen_text(txn.debit)
                print(f"  {txn.date}  {amount:>14}  {kind:<18}  {txn.description}", file=out)

    print("", file=out)
    return 0 if balanced and counted else 1


if __name__ == "__main__":
    raise SystemExit(main())
