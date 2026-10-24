# Architecture — Phase 1

## Overview

```
                 ┌──────────────────────── apps/api (NestJS) ─────────────────────────┐
 HTTP client ──► │ ValidationPipe → OrganizationAccessGuard → Controller → Service    │
 (127.0.0.1)     │        │                    │                                       │
                 │  AllExceptionsFilter   Authenticator (DI token)                     │
                 │                        └ BearerSessionAuthenticator (auth_sessions) │
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
| `AuthModule` | Login/sessions (`AuthService`, `/v1/auth/*`), `Authenticator` (who are you?), `OrganizationAccessService` + guards (may you act on this organization?) |
| `ThrottlerModule` | Per-IP rate limits (global + strict limit on credential routes) |
| `AuditModule` | Append-only audit events |
| `ImportsModule` | Import pipeline + publication, HTTP controller `/v1/imports` |
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

```
Request ─► ThrottlerGuard (global; strict "auth" limit on @AuthRateLimited routes)
        ─► AuthenticatedGuard / OrganizationAccessGuard
              1. Authenticator (DI token AUTHENTICATOR → BearerSessionAuthenticator)
                   "Authorization: Bearer dwa_…" → SHA-256 → auth_sessions row
                   live = not revoked, access not expired, session not expired, user not disabled
                   → 401 otherwise
              2. X-Organization-Id (UUID)                       → 400 otherwise
              3. Membership(user, org) + @RequireRoles(...)       → 403 otherwise
        ─► Controller → Service (re-checks roles; queries filtered by verified organizationId)
```

- **Authentication** (`src/auth/auth.service.ts`): login, refresh rotation with reuse detection, logout, change password and operator reset. The `Authenticator` interface stays, so an OIDC/JWT authenticator can be bound later without touching authorization.
- **Authorization** (`OrganizationAccessService`) reads the `Membership` row for (user, organization) and checks the role. Services receive an `OrganizationAccess` object and use *its* `organizationId` in every query.

### Session model

| Item | Lifetime | Stored as |
|---|---|---|
| Access token `dwa_…` | 15 min (`AUTH_ACCESS_TOKEN_TTL_SECONDS`) | SHA-256 in `auth_sessions.access_token_hash` |
| Refresh token `dwr_…` | Single use; valid until the session ends | SHA-256 in `refresh_token_hash`; the previous one is kept in `previous_refresh_token_hash` for reuse detection |
| Session | 7 days absolute (`AUTH_SESSION_TTL_SECONDS`); refresh never extends it | `auth_sessions.expires_at`; ended early by `revoked_at` |

Why opaque tokens instead of JWTs: a single API both issues and checks the tokens, and it
needs **instant revocation** (logout, password change, disabled user). Opaque tokens
need no signing key to manage or leak, and cannot suffer JWT algorithm-confusion bugs. The
cost is one indexed lookup per request.

## HTTP API surface (Phase 2a)

| Route | Guard | Roles |
|---|---|---|
| `GET /health` | — | public |
| `POST /v1/auth/login`, `/refresh` | rate limit | public |
| `POST /v1/auth/logout`, `/change-password`, `GET /v1/auth/me` | AuthenticatedGuard | any user |
| `POST /v1/imports` | OrganizationAccessGuard | OWNER, ANALYST |
| `GET /v1/imports`, `GET /v1/imports/:id`, `GET /v1/sales/monthly` | OrganizationAccessGuard | any member |
| `POST /v1/imports/:id/publish` | OrganizationAccessGuard | OWNER |

The import controller is a thin HTTP adapter: it validates the multipart request and calls
the **unchanged** `ImportPipelineService` and `PublicationService`.

## Key decisions

| Decision | Why |
|---|---|
| Imports via CLI in Phase 1; HTTP since Phase 2a | No upload endpoint existed before real authentication |
| Generator in Python, pipeline in TypeScript | Reconciliation only proves something if expected totals come from an independent implementation |
| Roll back rows on failed reconciliation | Unpublishable rows would otherwise block a corrected re-import (unique key) |
| Money as `DECIMAL(18,2)` and JSON strings | Floating point cannot represent ₹0.10 exactly |
| Units never summed across units | 5 KG + 3 cartons is meaningless |
| Currencies never mixed | No FX rates exist in Phase 1 |
| Composite tenant foreign keys | The database itself prevents cross-organization links |

## Phase 4 reporting architecture

AnalyticsModule adds a read-only AnalyticsController, validated range/list DTOs and AnalyticsService. Both controller and service enforce membership. Every financial query uses TenantDb with transaction-local organization/user context, explicit organization predicates and composite tenant joins; RLS, grants and financial ingestion logic are unchanged.

The list query uses CTEs: monthly groups facts by entity/month/unit, current selects the requested period, ranked aggregates current and equal-length preceding-period statistics, and page applies validated ordering plus LIMIT/OFFSET. The final SQL statement returns the page, count and full-filter summary from one statement snapshot. Monetary SUM uses PostgreSQL numeric; JSON casts sums to text before transport. Decimal.js (50-digit arithmetic context) formats amounts and calculates growth. Prisma.sql binds request values; Prisma.raw is used only for code-owned dimension identifiers and sort tokens verified against an allowlist.

Existing indexes on sales_transactions (organization_id,billing_date), (organization_id,product_id), (organization_id,distributor_id), (organization_id,customer_id) and (organization_id,import_batch_id), plus composite master keys, support the tenant/date scan and joins. The upper bound is 72 months read (36 current plus 36 preceding). SQL pagination bounds transfer, not aggregation work: all matching groups still have to be aggregated and sorted. No production-scale query-plan benchmark was performed. Inspect EXPLAIN (ANALYZE, BUFFERS) on representative synthetic volumes before adding indexes/materialized rollups; high offsets remain more expensive than keyset pagination.

The three Next.js pages share AnalyticsPage. Existing workspace state supplies organization and 3/6/12 completed-month ranges; existing monthly sales discovers available currencies and units. Typed BFF operations validate response schemas against OpenAPI. Each report is keyed by organization/range/currency, aborts superseded requests and shows loading/error states instead of relabelling stale results. Filter changes reset pagination. Product selection loads a trend through the BFF; seriesFor fills absent months with null and MonthlyChart converts to numbers only for geometry. Exact tables support the chart and preserve separate quantity units. No frontend analytics fixture is shipped in the application; browser-only synthetic mocks live under test/e2e.

## Phase 5 pilot reporting workflow

ImportsModule now includes immutable ImportTemplateVersion governance and read-only previews.
Optional approved template context extends the original parser/normalizer; it does not replace
sign rules, content hashing, SAP keys, SQL reconciliation, transaction rollback or OWNER publication.
ImportBatch stores a tenant-composite template reference and stable rules version. Additive
migrations enforce template/batch provenance immutability and FORCE RLS on new tables.

Sales transactions expose source lineage with inherited analytics predicates, deterministic
business ordering, bounded paging and full-subset totals in one SQL statement. Detailed source
identifiers require OWNER/ANALYST. Normal reporting still supports VIEWER and unchanged Phase 4
semantics. See DATA_LINEAGE.md for source-record and evidence limitations.

ReportsModule reads bounded facts, source metadata and checks in a single SQL snapshot, then
uses Decimal-safe in-memory grouping to encode XLSX/PPTX from one immutable value object.
Organization/key advisory locking prevents duplicate generation for retried idempotent requests.
Both formats and evidence are INSERTed atomically only after successful generation. Private
bytea storage, download authorization/expiry, explicit grants and tenant composite keys maintain
the existing role separation. Stable report-definition and metric versions are code-owned;
configuration is frozen per organization snapshot. The browser receives an aggregate preview,
not the full transaction collection. See REPORT_EXPORTS.md for ceilings and deferred jobs/storage.

PilotAssessment is append-only, linked to a report by organization/id. Entered labor durations,
review statements and bounded discrepancy notes remain distinguishable from machine timings
and independently validated business outcomes. There is no forecasting or invented cost/margin.
