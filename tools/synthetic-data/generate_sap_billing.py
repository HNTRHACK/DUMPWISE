"""Generate a SYNTHETIC SAP SD billing export (CSV) plus independent control totals.

Every value produced here is fictional. Nothing is derived from real company data.

The control totals are computed from the generator's own ground-truth rows, in Python,
independently of the TypeScript import pipeline. The pipeline must reproduce them exactly
for an import to pass reconciliation.

Usage (from the repository root):
    python tools/synthetic-data/generate_sap_billing.py --end-month 2026-09

Only the Python standard library is used.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

SEED = 20261023
HEADERS = [
    "Billing Date",
    "Billing Document",
    "Item",
    "Billing Type",
    "Sold-To Party",
    "Sold-To Name",
    "Material",
    "Material Description",
    "Ship-To Party",
    "Billed Quantity",
    "Sales Unit",
    "Net Value",
    "Doc. Currency",
    "Cancelled Bill. Doc.",
]

# Documented sign rules (mirrors docs/ARCHITECTURE.md, implemented independently).
AMOUNT_SIGN = {"F2": 1, "G2": -1, "RE": -1, "S1": -1}
QUANTITY_SIGN = {"F2": 1, "G2": 0, "RE": -1, "S1": -1}

CENT = Decimal("0.01")
MILLI = Decimal("0.001")


@dataclass(frozen=True)
class Row:
    billing_date: date
    doc: str
    item: str
    btype: str
    distributor: str
    distributor_name: str
    material: str
    material_desc: str
    ship_to: str
    quantity: Decimal  # unsigned, as exported by SAP
    unit: str
    net_value: Decimal  # unsigned, as exported by SAP
    currency: str
    cancelled_doc: str = ""

    def to_csv(self) -> list[str]:
        return [
            self.billing_date.strftime("%d.%m.%Y"),
            self.doc,
            self.item,
            self.btype,
            self.distributor,
            self.distributor_name,
            self.material,
            self.material_desc,
            self.ship_to,
            fmt_qty(self.quantity),
            self.unit,
            f"{self.net_value:.2f}",
            self.currency,
            self.cancelled_doc,
        ]


def fmt_qty(q: Decimal) -> str:
    return f"{q:.3f}".rstrip("0").rstrip(".") if q != q.to_integral() else str(int(q))


def month_range(end_month: str, count: int) -> list[tuple[int, int]]:
    y, m = (int(p) for p in end_month.split("-"))
    months = []
    for _ in range(count):
        months.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(months))


def days_in_month(y: int, m: int) -> int:
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - date(y, m, 1)).days


def build(end_month: str) -> tuple[list[list[str]], dict]:
    rng = random.Random(SEED)
    months = month_range(end_month, 12)

    distributors = [
        (f"{100000 + i:010d}", f"SYNTHETIC Distributor {i:02d} {city}")
        for i, city in enumerate(
            ["Pune", "Nagpur", "Indore", "Surat", "Coimbatore", "Ludhiana", "Vizag", "Export Hub"], start=1
        )
    ]
    export_distributor = distributors[-1][0]  # bills in USD
    # Mix of numeric 18-digit SAP material numbers (leading zeros!) and alphanumeric SKUs.
    products = []
    for i in range(1, 21):
        sku = f"{10000 + i:018d}" if i % 2 else f"SYN-MAT-{i:04d}"
        unit = ["EA", "KG", "CAR"][i % 3]
        price = Decimal(rng.randint(40, 4000)) + Decimal(rng.randint(0, 99)) / 100
        products.append((sku, f"SYNTHETIC Product {i:02d}", unit, price))
    customers = [f"{200000 + i:010d}" for i in range(1, 41)]

    valid: list[Row] = []
    invoice_items: list[Row] = []
    seq = {"F2": 90000000, "G2": 70000000, "RE": 60000000, "S1": 80000000}

    def next_doc(btype: str) -> str:
        seq[btype] += 1
        return f"{seq[btype]:010d}"

    def rand_qty(unit: str) -> Decimal:
        if unit == "KG":
            return (Decimal(rng.randint(1000, 250000)) / 1000).quantize(MILLI)
        return Decimal(rng.randint(1, 300))

    for y, m in months:
        dim = days_in_month(y, m)
        # Invoices
        for _ in range(rng.randint(70, 95)):
            dist, dist_name = rng.choice(distributors)
            currency = "USD" if dist == export_distributor else "INR"
            ship_to = rng.choice(customers)
            d = date(y, m, rng.randint(1, dim))
            doc = next_doc("F2")
            for n in range(rng.randint(1, 4)):
                sku, desc, unit, price = rng.choice(products)
                qty = rand_qty(unit)
                unit_price = (price / 80).quantize(CENT) if currency == "USD" else price
                amount = (qty * unit_price).quantize(CENT, ROUND_HALF_UP)
                row = Row(d, doc, f"{(n + 1) * 10:06d}", "F2", dist, dist_name, sku, desc, ship_to, qty, unit, amount, currency)
                valid.append(row)
                invoice_items.append(row)
        # Credit memos (value-only price credits)
        for _ in range(rng.randint(3, 6)):
            base = rng.choice([r for r in invoice_items if r.currency == "INR"])
            credit = (base.net_value * Decimal(rng.choice(["0.02", "0.05", "0.10"]))).quantize(CENT, ROUND_HALF_UP)
            d = date(y, m, rng.randint(1, dim))
            valid.append(Row(d, next_doc("G2"), "000010", "G2", base.distributor, base.distributor_name, base.material,
                             base.material_desc, base.ship_to, base.quantity, base.unit, credit, base.currency))
        # Returns (partial quantity returned)
        for _ in range(rng.randint(2, 4)):
            base = rng.choice(invoice_items)
            ret_qty = max(Decimal(1), (base.quantity / 4).quantize(Decimal(1))) if base.unit != "KG" else (base.quantity / 4).quantize(MILLI)
            unit_price = base.net_value / base.quantity
            amount = (ret_qty * unit_price).quantize(CENT, ROUND_HALF_UP)
            d = date(y, m, rng.randint(1, dim))
            valid.append(Row(d, next_doc("RE"), "000010", "RE", base.distributor, base.distributor_name, base.material,
                             base.material_desc, base.ship_to, ret_qty, base.unit, amount, base.currency))
        # Cancellations of an earlier invoice item (full reversal, dated this month)
        for _ in range(rng.randint(1, 3)):
            base = rng.choice(invoice_items)
            d = max(base.billing_date, date(y, m, rng.randint(1, dim)))
            valid.append(Row(d, next_doc("S1"), base.item, "S1", base.distributor, base.distributor_name, base.material,
                             base.material_desc, base.ship_to, base.quantity, base.unit, base.net_value, base.currency,
                             cancelled_doc=base.doc))

    # Ensure business keys are unique in ground truth.
    keys = [(r.doc, r.item) for r in valid]
    assert len(keys) == len(set(keys)), "generator produced duplicate business keys"

    # ---- Noise that the pipeline must reject or de-duplicate -------------------------
    lines: list[list[str]] = [r.to_csv() for r in valid]

    exact_dupes = rng.sample(lines, k=max(1, len(lines) // 100))
    lines.extend(list(l) for l in exact_dupes)

    # Conflicting duplicate key: same document/item, different value -> both rows rejected.
    conflict_src = valid[5]
    valid.remove(conflict_src)
    conflict_b = conflict_src.to_csv()
    conflict_b[11] = f"{conflict_src.net_value + Decimal('1.00'):.2f}"
    lines.append(conflict_b)

    last_y, last_m = months[-1]
    bad = Row(date(last_y, last_m, 10), "0099000001", "000010", "F2", distributors[0][0], distributors[0][1],
              products[0][0], products[0][1], customers[0], Decimal(5), products[0][2], Decimal("100.00"), "INR")
    invalid_rows = []

    def invalid(doc_suffix: int, col: int, value: str, reason: str) -> None:
        r = bad.to_csv()
        r[1] = f"{99000000 + doc_suffix:010d}"
        r[col] = value
        invalid_rows.append({"billingDocument": r[1], "reason": reason})
        lines.append(r)

    invalid(1, 0, "31.02.2026", "impossible calendar date")
    invalid(2, 0, "03/05/2026", "ambiguous slash date format")
    invalid(3, 9, "12a", "non-numeric quantity")
    invalid(4, 9, "-5", "negative quantity (sign comes from billing type)")
    invalid(5, 12, "", "missing currency")
    invalid(6, 3, "ZF2", "unsupported billing type")
    invalid(7, 11, "100.123", "amount with more than 2 decimals")
    invalid(8, 12, "Rupees", "invalid ISO currency code")
    invalid(9, 11, "1,234.00", "grouped number in PLAIN number format")
    r = bad.to_csv()
    r[1] = ""
    invalid_rows.append({"billingDocument": "", "reason": "missing billing document"})
    lines.append(r)
    r = bad.to_csv()
    r[1], r[3], r[13] = f"{99000010:010d}", "S1", ""
    invalid_rows.append({"billingDocument": r[1], "reason": "cancellation without cancelled document reference"})
    lines.append(r)

    rng.shuffle(lines)

    # ---- Independent expected totals from ground truth ------------------------------
    net = defaultdict(Decimal)
    count = defaultdict(int)
    qty = defaultdict(Decimal)
    for r in valid:
        mk = f"{r.billing_date.year:04d}-{r.billing_date.month:02d}"
        net[(mk, r.currency)] += r.net_value * AMOUNT_SIGN[r.btype]
        count[(mk, r.currency)] += 1
        qty[(mk, r.unit)] += r.quantity * QUANTITY_SIGN[r.btype]

    control = {
        "schemaVersion": 1,
        "synthetic": True,
        "notice": "SYNTHETIC DEMO DATA - fictional values generated by tools/synthetic-data/generate_sap_billing.py. Not real business data.",
        "generator": {"seed": SEED, "endMonth": end_month, "months": 12},
        "source": "independent ground truth (Python Decimal)",
        "totals": [
            {"month": k[0], "currency": k[1], "netAmount": f"{v:.2f}", "lineCount": count[k]}
            for k, v in sorted(net.items())
        ],
        "quantityTotals": [
            {"month": k[0], "unit": k[1], "quantity": f"{v:.3f}"} for k, v in sorted(qty.items())
        ],
        "expectedIssues": {
            "validUniqueRows": len(valid),
            "exactDuplicateRows": sum(1 for l in exact_dupes if (l[1], l[2]) != (conflict_src.doc, conflict_src.item)),
            "conflictingKeyRows": sum(1 for l in lines if (l[1], l[2]) == (conflict_src.doc, conflict_src.item)),
            "invalidRows": len(invalid_rows),
            "invalidRowDetails": invalid_rows,
        },
    }
    return lines, control


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--end-month", required=True, help="last completed month, YYYY-MM")
    parser.add_argument("--out-dir", default="data/synthetic")
    args = parser.parse_args()

    lines, control = build(args.end_month)
    months = month_range(args.end_month, 12)
    stem = f"SYNTHETIC_sap_billing_{months[0][0]:04d}-{months[0][1]:02d}_to_{args.end_month}"
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    with (out / f"{stem}.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(HEADERS)
        w.writerows(lines)
    (out / f"{stem}.control_totals.json").write_text(json.dumps(control, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out / (stem + '.csv')} ({len(lines)} data rows)")
    print(f"wrote {out / (stem + '.control_totals.json')}")


if __name__ == "__main__":
    main()
