# ⚠ SYNTHETIC DEMO DATA — NOT REAL BUSINESS DATA

Every file in this folder is **fictional** and was produced by
`tools/synthetic-data/generate_sap_billing.py` (seed `20261023`). No value is derived from
any real company, SAP system, distributor, customer or person.

| File | Purpose |
|---|---|
| `SYNTHETIC_sap_billing_2025-10_to_2026-09.csv` | SAP SD billing-style export, 12 completed months (Oct 2025 – Sep 2026) |
| `SYNTHETIC_sap_billing_2025-10_to_2026-09.control_totals.json` | Independently computed expected totals (Python `Decimal`), used for reconciliation |

The CSV deliberately contains test noise the pipeline must handle:

- 24 exact duplicate rows (must be de-duplicated)
- 1 business key appearing twice with different values (both rows must be rejected)
- 11 invalid rows (impossible dates, ambiguous date formats, bad quantities, missing currency, unsupported billing type, etc.)
- Credit memos (`G2`), returns (`RE`) and invoice cancellations (`S1`)
- A distributor billing in USD (currencies are never mixed)

Rules for this folder:

- Only synthetic data may be stored here. **Never put real SAP exports in the repository.**
- Synthetic files may only be imported into organizations whose `data_classification` is `SYNTHETIC`
  (the pipeline enforces this).

Regenerate (from the repository root):

```powershell
python tools/synthetic-data/generate_sap_billing.py --end-month 2026-09
```
