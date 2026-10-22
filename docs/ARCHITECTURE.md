# Architecture — Phase 1

## Overview

```
                 ┌──────────────────────── apps/api (NestJS) ─────────────────────────┐
 HTTP client ──► │ ValidationPipe → OrganizationAccessGuard → Controller → Service    │
 (127.0.0.1)     │        │                    │                                       │
                 │  AllExceptionsFilter   Authenticator (DI token)                     │
                 │                        └ DisabledAuthenticator (Phase 1: always 401)│
 Operator CLI ─► │ NestFactory.createApplicationContext → same services, same rules   │
                 │                                                                     │
                 │ PrismaService (runtime role dumpwise_app) ──────────────┐           │
                 └─────────────────────────────────────────────────────────┼───────────┘
                                                                           ▼
                                                PostgreSQL 17 (Docker, 127.0.0.1:5433)
                                                dumpwise_dev   dumpwise_test
```

| Module | Responsibility |
|---|---|
| `ConfigModule` + `config/env.ts` | Loads `.env`, validates every variable with zod, refuses to start on bad config |
| `PrismaModule` | One shared database client using the restricted runtime role |
| `AuthModule` | `Authenticator` interface (who are you?) and `OrganizationAccessService`/guard (may you act on this organization?) |
| `AuditModule` | Append-only audit events |
| `ImportsModule` | Import pipeline + publication (no HTTP controller in Phase 1) |
| `SalesModule` | `GET /v1/sales/monthly` |
| `HealthController` | `GET /health` |
| `cli/dumpwise.ts` | Operator commands: `seed-synthetic`, `import`, `publish`, `monthly`, `openapi` |

`app.setup.ts#configureApp` applies global behavior (validation pipe, error filter, body
limit, no `X-Powered-By`). Both `main.ts` and the e2e tests call it, so the tests exercise
the production setup.

## Import pipeline

```
CSV bytes
  │ 1. readCsv            size limit · spreadsheet signature rejection · strict UTF-8 · delimiter detection · row limit
  │ 2. mapHeaders         deterministic alias table → canonical fields
  │ 3. normalizeRow       type conversion + validation per row (dates, decimals, codes, billing type)
  │ 4. parseBillingFile   in-file duplicate detection by SAP business key
  │──────────── pure functions above (src/imports/parsing), database below ────────────
  │ 5. import (one DB transaction, per-organization advisory lock)
  │      upsert master data · compare with existing rows · insert new rows
  │ 6. monthly aggregation in SQL over the rows actually stored
  │ 7. reconcile against control totals (exact Decimal equality)
  │      pass → batch READY_TO_PUBLISH, results + audit committed
  │      fail → ROLLBACK all rows; record batch RECONCILIATION_FAILED + results separately
  ▼ 8. publish (OWNER only, only if reconciliation PASSED) → visible to the analytics API
```

### Batch states

```
            file/control-total problems
 (start) ───────────────────────────────► FAILED_VALIDATION
    │
    └─► PROCESSING ──reconciliation fails──► RECONCILIATION_FAILED   (no rows kept, publish blocked)
            │
            └─reconciliation passes──► READY_TO_PUBLISH ──OWNER publishes──► PUBLISHED
```

### Header recognition (deterministic)

Headers are normalized (lower-case; `. _ - / ( )` become spaces; whitespace collapsed) and
must **exactly** match an alias. There is no fuzzy matching and no AI.

| Canonical field | Accepted headers (SAP label / technical field) | Required |
|---|---|---|
| billingDate | Billing Date, Bill. Date, FKDAT | yes |
| billingDocument | Billing Document, Billing Doc., VBELN | yes |
| billingItem | Item, Billing Item, POSNR | yes |
| billingType | Billing Type, FKART | yes |
| distributorCode | Sold-To Party, Sold-To, KUNAG | yes |
| distributorName | Sold-To Name, Name of Sold-To Party | no |
| sku | Material, Material Number, MATNR | yes |
| productDescription | Material Description, ARKTX | no |
| customerCode | Ship-To Party, Ship-To, KUNWE | yes |
| quantity | Billed Quantity, Billed Qty, FKIMG | yes |
| salesUnit | Sales Unit, VRKME | yes |
| netAmount | Net Value, Net Value in Document Currency, NETWR | yes |
| currency | Doc. Currency, Document Currency, WAERK | yes |
| cancelledDocument | Cancelled Bill. Doc., Cancelled Billing Document, SFAKN | for S1 |

**Ambiguous headers are never used.** These include `Amount`, `Value`, `Total`, `Price`,
`Qty`, `Quantity`, `Currency`, `Date`, `Unit` and `UoM`: none of them says whether a value
is net or gross, in document or local currency, or in the sales or base unit. Such a
column is reported (`AMBIGUOUS_COLUMN_IGNORED`). If a required field is then missing, the
file fails validation. Two columns mapping to the same field also fail the file
(`DUPLICATE_COLUMN_MAPPING`).

### Value rules

| Value | Rule |
|---|---|
| Dates | `DD.MM.YYYY` or `YYYY-MM-DD` only. Slash dates are rejected as ambiguous (`03/05/2026`). Impossible dates are rejected (`31.02.2026`). Year must be 2000–2100. |
| Numbers | `PLAIN` (default): digits with an optional `.` decimal part. `EN_GROUPED` (opt-in per import): `1,234,567.89` or Indian `12,34,567.89`. German `1.234,56` is not supported. |
| Signs | Export values must be **unsigned**. A minus sign (leading or SAP-style trailing `5-`) is rejected; the billing type decides the sign. |
| Decimals | Amount at most 2 places; quantity at most 3. |
| Currency | ISO-4217 format (`^[A-Z]{3}$`), required on every row. **No default currency, no FX conversion.** |
| Identifiers | Always strings. Purely numeric document, item and partner numbers are ALPHA-padded (document and partner to 10 digits, item to 6) so `90000908` equals `0090000908`. Material numbers are stored exactly as exported. |

### Sign rules (billing types)

| Type | Meaning | Net amount | Units sold |
|---|---|---|---|
| F2 | Invoice | + value | + quantity |
| G2 | Credit memo (price/value credit) | − value | 0 (no goods movement) |
| RE | Returns credit | − value | − quantity |
| S1 | Cancellation of invoice (must reference the cancelled document) | − value | − quantity |

Any other billing type is rejected (`UNSUPPORTED_BILLING_TYPE`). Each document counts in the
month of **its own** billing date: a September cancellation of an August invoice reduces
September. A database CHECK constraint enforces the same signs, as a second line of
defense.

### Duplicates and idempotency

- **Business key:** `(organization, billing document, billing item)`, which is SAP table VBRP's key within one SAP client.
- **Content hash:** SHA-256 over the business content (document, item, type, date, partners, material, signed quantity, unit, signed amount, currency, cancellation reference). Descriptive names are excluded.
- **Within a file:** an identical repeat is skipped (`DUPLICATE_ROW_IN_FILE`). The same key with different content rejects **all** rows with that key (`CONFLICTING_DUPLICATE_KEY`).
- **Against the database:** an identical row counts as `rowsAlreadyImported`. Changed content is rejected (`CONFLICTS_WITH_EXISTING`). **Existing data is never overwritten.**
- **Whole file:** a file whose SHA-256 matches a batch that is `READY_TO_PUBLISH` or `PUBLISHED` returns `ALREADY_IMPORTED` without touching anything. A file that previously *failed* may be imported again, for example with corrected control totals.
- **Concurrency:** `pg_advisory_xact_lock` serializes imports per organization, and the unique index is the final guarantee.

### Reconciliation

Control totals arrive with every import as a JSON file containing `totals` per (month, currency)
with `netAmount` and `lineCount`, and `quantityTotals` per (month, unit). For real data
they would come from an SAP summary report. For synthetic data, the Python generator
computes them independently. Reconciliation compares them with a SQL aggregate over the
rows actually stored for this file, using exact equality. A (month, currency) that appears
on only one side fails.

> In real use, any rejected row makes reconciliation fail, because SAP's totals include
> it. That is intended: a person must look before data is published. The synthetic control
> totals exclude the injected noise rows by design.

### Publication and visibility

Analytics read only rows whose batch is `PUBLISHED`. Publishing requires the `OWNER` role
and `reconciliation_status = PASSED`, and uses a conditional update to avoid races.
Analysts can import but cannot publish (separation of duties).

## Authentication vs. authorization

- **Authentication** (`Authenticator` interface, DI token `AUTHENTICATOR`) identifies the caller. Phase 1 binds `DisabledAuthenticator`, which identifies nobody, so all protected routes return 401. The e2e tests override the binding with `TestHeaderAuthenticator`, which lives in `test/` and is not part of the build.
- **Authorization** (`OrganizationAccessService`) is real. It reads the `Membership` row for (user, organization) from the database and checks the role. Services receive an `OrganizationAccess` object and use *its* `organizationId` in every query.

## Key decisions

| Decision | Why |
|---|---|
| Imports via CLI, not HTTP | No upload endpoint should exist before real authentication |
| Generator in Python, pipeline in TypeScript | Reconciliation only proves something if expected totals come from an independent implementation |
| Roll back rows on failed reconciliation | Unpublishable rows would otherwise block a corrected re-import (unique key) |
| Money as `DECIMAL(18,2)` and JSON strings | Floating point cannot represent ₹0.10 exactly |
| Units never summed across units | 5 KG + 3 cartons is meaningless |
| Currencies never mixed | No FX rates exist in Phase 1 |
| Composite tenant foreign keys | The database itself prevents cross-organization links |
