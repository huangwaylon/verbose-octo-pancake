#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Turn a bank export into rows you can paste into the ledger.

    uv run scripts/bank_to_ledger.py statement.tsv
    uv run scripts/bank_to_ledger.py statement.tsv -o rows.csv --payer p1

Expenses paste into `expenses_p1!A2` (or p2) under the existing header; settlements
have their own tab and columns, so they get a `.settlements.csv` beside it, written
only when there are any. `test/schema.test.js` pins both column lists against the real
ones, because this file cannot import them and a silent disagreement writes every value
under the wrong field. Amounts are whole yen exactly as `entryToRow` writes them.

NOTHING IS EVER TRANSLATED. A description is the bank's own text plus your note when
the note adds something, so a ledger row can always be found in the statement by
searching for what it says. A rule only chooses a category, a share, and whether the
row is a purchase at all.

RULES below decides everything: first match wins, and whatever matches nothing becomes
a shared "Other" expense AND is listed in the summary so you can add a rule. The
summary reconciles every yen in against every yen out — a row can be dropped only on
purpose.

Conventions that mirror the app: CATEGORIES is the whole vocabulary (a category the
config tab does not list renders as an empty picker); payer_share is the fraction the
PAYER covers themselves, 1.0 = paid in full by the payer, 0 = a settlement; and a
settlement carries no category and is never spending.
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

# Pinned to the app's own default list by test/schema.test.js. Short deliberately: a
# category earns its place only if a month's spending reads differently for having it.
CATEGORIES = (
    "Groceries",
    "Dining",
    "Household",
    "Travel",
    "Rent",
    "Gym",
    "Wedding",
    "Other",
)

# ---------------------------------------------------------------------------
# Rules. First match wins, so the specific one goes above the general one
# (ライフドラッグ is a drugstore; ライフ is the supermarket next door).
#
#   (pattern, category, mode)
#
# mode: "personal"   -> payer_share 1.0
#       "shared"     -> payer_share --share (default 0.8)
#       "settlement" -> a settlement row, no category
#       "skip"       -> not a purchase; dropped and counted
#
# Prefer a pattern naming a KIND of place over one naming a shop (薬局 and ドラッグ
# classify every drugstore in the country), so the list stays readable in one screen. A
# shop earns a line only when its name says nothing about what it sells or disagrees
# with the general rule below it; a one-off is not worth a rule, since Other is honest
# and the summary lists it anyway. Both spellings appear where the bank prints both
# (ライフ and LIFE CORPORATION) — matching, not translating.
#
# Patterns match loosely: case, ASCII/full-width, hiragana/katakana, spaces,
# punctuation and small kana are folded away, and every dash — the katakana long vowel
# mark included — becomes one character (ラクテンカ－ドサ－ビス == ラクテンカードサービス). The
# long vowel mark is FOLDED rather than dropped: dropping it leaves オーケー as a
# two-character pattern that would match half the file.
#
# A skip is tried against the merchant AND your note, because an exclusion is
# deliberate and sometimes only identifiable from the note. Every other rule sees the
# merchant ALONE: a note reading "ozeki groceries" must not classify an OK Mart row.
# ---------------------------------------------------------------------------

# prettier-ignore
RULES: list[tuple[str, str | None, str]] = [
    # -- not a purchase ------------------------------------------------------
    ("セブンATM", None, "skip"),               # cash out of the account, not spent yet
    ("ラクテンカードサービス", None, "skip"),      # a card bill; its rows are not in this file
    ("IBショウケン", None, "skip"),             # money moved to the brokerage
    ("アンドリュー", None, "skip"),              # bought for someone who paid it straight
    ("ANDREW", None, "skip"),                 # back, so both halves of the pair go
    # -- settlements ---------------------------------------------------------
    ("ウメダ アスカ", None, "settlement"),
    # -- rent ----------------------------------------------------------------
    ("シノケンコミュニケーションズ", "Rent", "shared"),
    ("カイコーポレーション", "Rent", "shared"),
    # -- wedding -------------------------------------------------------------
    ("GEIHINKAN", "Wedding", "shared"),
    # -- gym -----------------------------------------------------------------
    ("AF大崎", "Gym", "personal"),
    ("AF OSAKI", "Gym", "personal"),
    # -- mine alone: the commute, the office lunch, my own things ------------
    ("モバイルSUICA", "Travel", "personal"),
    ("MOBILE SUICA", "Travel", "personal"),
    ("六本木ヒルズ", "Dining", "personal"),
    ("ROPPONGI", "Dining", "personal"),
    ("森ビル関連施設", "Dining", "personal"),
    ("MACS", "Dining", "personal"),           # CAFF / CAFFE MACS, the canteen
    ("AMAZON", "Other", "personal"),
    ("APPLE", "Other", "personal"),
    # -- drugstores, above the supermarket they share a name with ------------
    ("薬局", "Household", "shared"),
    ("ドラッグ", "Household", "shared"),
    ("マツモトキヨシ", "Household", "shared"),
    ("トモズ", "Household", "shared"),
    ("ココカラファイン", "Household", "shared"),
    # -- household -----------------------------------------------------------
    ("ダイソー", "Household", "shared"),
    ("DAISO", "Household", "shared"),
    ("セリア", "Household", "shared"),
    ("3COINS", "Household", "shared"),
    ("ドン・キホーテ", "Household", "shared"),
    ("コーナン", "Household", "shared"),
    ("IKEA", "Household", "shared"),
    ("ロフト", "Household", "shared"),
    ("郵便", "Household", "shared"),
    ("ヤマト運輸", "Household", "shared"),
    # -- travel --------------------------------------------------------------
    ("空港", "Travel", "shared"),
    ("ホテル", "Travel", "shared"),
    ("ハーヴェストクラブ", "Travel", "shared"),
    ("スキージョウ", "Travel", "shared"),
    ("サービスエリア", "Travel", "shared"),
    ("パーキングエリア", "Travel", "shared"),
    ("SA上り", "Travel", "shared"),
    ("SA下り", "Travel", "shared"),
    ("道の駅", "Travel", "shared"),
    ("食の駅", "Travel", "shared"),
    ("DELTA AIR", "Travel", "shared"),
    ("EXPEDIA", "Travel", "shared"),
    ("AGODA", "Travel", "shared"),
    ("水族館", "Travel", "shared"),
    ("記念公園", "Travel", "shared"),
    ("富士山", "Travel", "shared"),
    ("HAKONE", "Travel", "shared"),
    # -- groceries -----------------------------------------------------------
    ("ライフ", "Groceries", "shared"),
    ("LIFE CORPORATION", "Groceries", "shared"),
    ("オオゼキ", "Groceries", "shared"),
    ("OZEKI", "Groceries", "shared"),
    ("オーケー", "Groceries", "shared"),
    ("OK TOGOSHI", "Groceries", "shared"),
    ("リンコス", "Groceries", "shared"),
    ("LINCOS", "Groceries", "shared"),
    ("マルエツ", "Groceries", "shared"),
    ("サミット", "Groceries", "shared"),
    ("成城石井", "Groceries", "shared"),
    ("ビッグ・エー", "Groceries", "shared"),
    ("リブレ京成", "Groceries", "shared"),
    ("マイバスケット", "Groceries", "shared"),
    ("カルディ", "Groceries", "shared"),
    ("KALDI", "Groceries", "shared"),
    ("おかしのまちおか", "Groceries", "shared"),
    ("韓国広場", "Groceries", "shared"),
    ("水産", "Groceries", "shared"),
    ("青果", "Groceries", "shared"),
    ("フード", "Groceries", "shared"),
    ("ストア", "Groceries", "shared"),
    ("KEIKYU STORE", "Groceries", "shared"),
    ("TOKYU STORE", "Groceries", "shared"),
    ("スーパー", "Groceries", "shared"),
    ("セブンイレブン", "Groceries", "shared"),
    ("SEVEN", "Groceries", "shared"),
    ("ローソン", "Groceries", "shared"),
    ("LAWSON", "Groceries", "shared"),
    ("ファミリーマート", "Groceries", "shared"),
    ("FAMILYMART", "Groceries", "shared"),
    ("ミニストップ", "Groceries", "shared"),
    # -- dining: the shape of the name, not the name -------------------------
    ("寿司", "Dining", "shared"),
    ("ZUSHI", "Dining", "shared"),
    ("ラーメン", "Dining", "shared"),
    ("うどん", "Dining", "shared"),
    ("食堂", "Dining", "shared"),
    ("居酒屋", "Dining", "shared"),
    ("レストラン", "Dining", "shared"),
    ("RESTAURAN", "Dining", "shared"),
    ("カフェ", "Dining", "shared"),
    ("CAFE", "Dining", "shared"),
    ("KAFUE", "Dining", "shared"),
    ("珈琲", "Dining", "shared"),
    ("COFFEE", "Dining", "shared"),
    ("DINER", "Dining", "shared"),
    ("ベーカリー", "Dining", "shared"),
    ("ジェラート", "Dining", "shared"),
    ("焼肉", "Dining", "shared"),
    ("餃子", "Dining", "shared"),
    ("とんかつ", "Dining", "shared"),
    ("うなぎ", "Dining", "shared"),
    ("麻辣", "Dining", "shared"),
    ("中国料理", "Dining", "shared"),
    ("大戸屋", "Dining", "shared"),
    ("マクドナルド", "Dining", "shared"),
    ("MCDONALDS", "Dining", "shared"),
    ("銀だこ", "Dining", "shared"),
    ("スシロー", "Dining", "shared"),
    ("リンガーハット", "Dining", "shared"),
    ("チェゴヤ", "Dining", "shared"),
    ("KOLLABO", "Dining", "shared"),
    ("ナマステ", "Dining", "shared"),
    ("HAINANJIFAN", "Dining", "shared"),
]

# Whatever matched nothing at all.
FALLBACK = ("Other", "shared")

# A category the config tab does not list renders as a blank picker, so a typo in a
# rule is caught here rather than in somebody's spreadsheet.
assert all(
    category in CATEGORIES
    for _, category, mode in RULES
    if mode not in ("skip", "settlement")
)
assert FALLBACK[0] in CATEGORIES

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

# Its own tab, which cannot say who paid the way an expenses tab does — hence `payer`,
# and no `category` or `payer_share`.
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

# Hiragana onto katakana, so まいばすけっと and マイバスケット are one pattern rather than two.
_KANA = {code: code + 0x60 for code in range(0x3041, 0x3097)}
_FOLD = {
    # Small kana onto their full-size form: the bank writes both ッ and ツ.
    **{ord(small): big for small, big in zip("ァィゥェォャュョッヮヵヶ", "アイウエオヤユヨツワカケ")},
    # Every dash-like character onto one, the katakana long vowel mark included. Folded
    # rather than dropped: without it オーケー becomes オケ and matches unrelated names.
    **{ord(dash): "-" for dash in "‐‑–—−ー－-"},
    **{ord(drop): None for drop in " 　・･/,、。()＊*'’\"`&＆"},
}


def loose(text: str) -> str:
    """Fold every way the bank might spell a name down to one comparable key."""
    return unicodedata.normalize("NFKC", text).upper().translate(_KANA).translate(_FOLD)


LOOSE_RULES = [(loose(pattern), category, mode) for pattern, category, mode in RULES]


@dataclass
class Txn:
    line_no: int
    date: str  # ISO
    description: str  # NFKC-normalized, Visa prefix stripped
    credit: int  # whole yen in
    debit: int  # whole yen out
    balance: int | None
    note: str


def split_columns(line: str) -> list[str]:
    """
    Columns, whether the export kept its tabs or had them expanded to spaces.

    Empty cells are load-bearing: which of the money-in / money-out columns is filled
    is the only thing saying which direction a row went, so a splitter that collapsed
    runs of blanks would silently turn a refund into a purchase.
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

    # Refused loudly rather than converted or rounded: this is an offline script, so
    # stopping costs a re-run, while guessing puts a 100x-wrong amount into a real ledger.
    currency = cols[currency_at].upper()
    if currency != "JPY":
        raise ValueError(f"line {line_no}: {currency} is not JPY; this ledger is yen only")

    def money(cell: str) -> int:
        """
        A statement amount as whole yen.

        The yen has no sub-unit, so a decimal point carries no value — the bank's own
        export writes "1480.000000". A non-zero fraction means the column was
        misidentified, so it is refused rather than rounded away.
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

    return Txn(line_no, date, description, credit, debit, balance, note)


def classify(txn: Txn) -> tuple[str | None, str, bool]:
    """
    (category, mode, matched) for a transaction. Never guesses silently.

    `matched` is returned rather than inferred from the values, because a rule may
    answer exactly what the fallback answers — and "no rule matched" is the line in the
    summary telling you to write one.
    """
    merchant = loose(txn.description)
    with_note = loose(txn.description + " " + txn.note)
    for pattern, category, mode in LOOSE_RULES:
        if pattern in (with_note if mode == "skip" else merchant):
            return category, mode, True
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

    # Refused rather than repaired. A byte that is not UTF-8 means some other encoding,
    # and `errors="replace"` would quietly turn a merchant name into question marks that
    # match no rule — which reads as "no rule yet" rather than "never decoded".
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

    # Soft cross-check. The statement is not always in balance order (a reversal is
    # inserted where it was posted), so a break here is reported and never acted on.
    chain_breaks = 0
    for previous, current in zip(txns, txns[1:]):
        if previous.balance is None or current.balance is None:
            continue
        if previous.balance + current.credit - current.debit != current.balance:
            chain_breaks += 1

    # The cells to be written, one list per tab. Named apart from the summary's
    # `expense_rows`/`settlement_rows`, which hold Txn tuples rather than sheet rows —
    # one name for two shapes in one function is how a count starts lying.
    expense_out: list[list[str]] = []
    settlement_out: list[list[str]] = []
    seen_ids: dict[str, int] = defaultdict(int)

    credits = [txn for txn in txns if txn.credit]
    debits = [txn for txn in txns if txn.debit]

    skipped: dict[str, list[Txn]] = defaultdict(list)
    unmatched: dict[str, list[Txn]] = defaultdict(list)
    by_category: dict[str, list[Txn]] = defaultdict(list)
    emitted: list[tuple[Txn, str, float, str]] = []  # txn, mode, share, category

    for txn in debits:
        category, mode, matched = classify(txn)
        if mode == "skip":
            skipped[txn.description].append(txn)
            continue

        if not matched:
            unmatched[txn.description].append(txn)

        if mode == "settlement":
            share, category_out = 0.0, ""
        else:
            share = 1.0 if mode == "personal" else args.share
            category_out = category or FALLBACK[0]

        # The bank's own text, and the note only when it adds something the name does
        # not already say. Neither is ever rewritten or translated.
        description = txn.description
        if txn.note and loose(txn.note) not in loose(description):
            description = f"{description} · {txn.note}"

        # Deterministic, and unique even for two identical purchases on one day: the
        # running balance differs, and the counter covers a row the statement repeats.
        seed = f"{txn.date}|{txn.description}|{txn.debit}|{txn.balance}"
        seen_ids[seed] += 1
        entry_id = str(uuid.uuid5(ID_NAMESPACE, f"{seed}|{seen_ids[seed]}"))

        # One list per tab: the two layouts differ.
        if mode == "settlement":
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
            by_category[category_out].append(txn)
        emitted.append((txn, mode, share, category_out))

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
    # Only when there are any: an empty file is one more thing to notice and discard.
    settlements_at = None
    if settlement_out and str(destination) != "-":
        settlements_at = destination.with_suffix(".settlements.csv")
        write(settlements_at, SETTLEMENT_COLUMNS, settlement_out)

    # ---------------------------------------------------------------- summary
    #
    # The reconciliation is the point of this section: a row may leave the file only on
    # purpose, so excluded + settlements + expenses has to equal every debit in it.
    out = sys.stderr

    def totals(items) -> int:
        return sum(item.debit or item.credit for item in items)

    debit_total = totals(debits)
    credit_total = totals(credits)
    skipped_all = [txn for group in skipped.values() for txn in group]
    skipped_total = totals(skipped_all)

    expense_rows = [row for row in emitted if row[1] != "settlement"]
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
        return sorted(groups.items(), key=lambda kv: -sum(txn.debit for txn in kv[1]))

    if skipped:
        print("\nExcluded as not a purchase", file=out)
        for description, group in by_size(skipped):
            print(f"  {len(group):>4} × {yen_text(totals(group)):>14}  {description}", file=out)

    if by_category:
        print("\nExpense categories written", file=out)
        for category, group in by_size(by_category):
            print(f"  {len(group):>4} × {yen_text(totals(group)):>14}  {category}", file=out)

    if settlement_rows:
        print("\nSettlements written", file=out)
        for txn, *_ in settlement_rows:
            print(f"  {txn.date}  {yen_text(txn.debit):>14}  {txn.description}", file=out)

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
            for txn, mode, share, category in big:
                kind = "settlement" if mode == "settlement" else f"{category} @ {share}"
                print(
                    f"  {txn.date}  {yen_text(txn.debit):>14}  {kind:<18}  {txn.description}",
                    file=out,
                )

    print("", file=out)
    return 0 if balanced and counted else 1


if __name__ == "__main__":
    raise SystemExit(main())
