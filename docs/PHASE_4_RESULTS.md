# Phase 4 — Business Intelligence

Date: 2026-10-25. Branch: `feat/security-hardening`. Starting HEAD: `5664bb6`. The working tree was clean at inspection. All Phase 4 work remains uncommitted and unstaged.

## Inspection and implementation plan

Reviewed Phase 3/3.5 and frontend architecture documentation, API controllers/DTOs, Prisma schema, sales aggregation, SAP billing rules, tenant context, RLS policies, runtime grants, BFF allowlist, client validation, dashboard components and existing tests.

Plan followed: validate the source fields and baseline; implement one shared read-only analytics service with four routes; verify real PostgreSQL behavior; integrate three views and product trends through the BFF; update contracts, tests and documentation. No migration, permission change or new dependency was needed.

### What the actual transactions contain

| Fields | Storage / meaning |
|---|---|
| id, organization_id, import_batch_id | UUIDs and tenant/batch provenance |
| billing_document, billing_item | String business identifiers, preserving leading zeros |
| billing_type | F2 invoice, G2 value credit, RE return, S1 cancellation |
| billing_date | PostgreSQL date; reporting periods use inclusive calendar months |
| cancelled_billing_document | Optional cancellation reference |
| product_id | SKU/description in tenant product master |
| distributor_id | Sold-to code/name in tenant distributor master |
| customer_id | Ship-to code/name in tenant customer master |
| net_amount, currency | Signed DECIMAL(18,2) and three-character currency |
| quantity, sales_unit | Signed DECIMAL(18,3) and unit code |
| content_hash, source_row_number, created_at | Integrity/source metadata |

No product cost, profit, margin, freight, stock position, customer acquisition/retention/cohort behavior or FX rates are present. None of those metrics is implemented or inferred. Customer revenue means billing attributed to a ship-to partner, not an invented behavioral measure. Transaction counts mean billing line items, not unique invoices or orders.

## Implemented backend

- `GET /v1/analytics/products`
- `GET /v1/analytics/distributors`
- `GET /v1/analytics/customers`
- `GET /v1/analytics/products/:id/trend`

All routes use the existing authentication and organization membership guard; services recheck membership. Every financial query uses transaction-local tenant context, RLS, explicit organization filters and tenant-safe joins. Every read requires a PUBLISHED batch with PASSED reconciliation. No ingestion/sign rules, runtime grants, RLS policies or financial data files changed.

List queries require `from`, `to` and one `currency`. They accept a unit, literal code/name search, validated sort/direction and bounded pagination. The range is 1–36 months; comparison is the immediately preceding equally long period. Rows are ranked **per entity and unit**, so the same SKU can appear more than once. Quantity sorting requires a selected unit. Ties use id/unit for stable paging.

PostgreSQL CTEs aggregate by entity/month/unit and return a bounded page, full-filter count and KPI totals in one statement snapshot. SQL numeric SUM and Decimal.js with 50-digit arithmetic preserve amounts; JSON monetary fields are strings. Credits (G2), returns (RE) and cancellations (S1) are positive magnitudes already included as reductions in net revenue. Quantities retain the pipeline signs: G2 contributes zero physical quantity; RE/S1 subtract quantity.

Growth requires activity in every month of both periods and a positive prior net-revenue denominator. Missing/zero/negative bases produce null plus a reason. A negative current period can produce meaningful negative growth. Activity coverage is not a claim of complete SAP source coverage.

Product trends report exact monthly amounts and separate units. Missing months are omitted by the API and filled as null gaps by the chart transformation. Foreign product ids return 404 after membership verification. Unknown query fields are rejected; trend queries reject list-only parameters. SQL identifiers are code-owned; request values are bound parameters.

## Implemented frontend

Products, Distributors and Customers now have authenticated analytics views, replacing their placeholders and removing navigation “Soon” badges. Shared components provide currency selection, unit selection, 3/6/12 completed-month ranges, search, sorting, pagination, full-filter KPI totals, exact ranked tables and loading/error/empty states.

Product-code selection opens a monthly chart with an exact supporting table. Only chart geometry uses JavaScript numbers; money display remains decimal-string based. Different currencies are never added, nor are incompatible quantities. Request keys include organization/range/currency/filter/page and abort superseded work; changed report context remounts local state. Stale data is hidden during reload/error rather than labelled as another report.

Four BFF GET routes are explicitly allowlisted, including UUID validation on product trend paths. Four new Zod response schemas are checked against generated OpenAPI. Fixtures with synthetic analytics numbers exist only in browser tests; no fixture is embedded in application views.

## Actual verification

| Check | Baseline | Phase 4 |
|---|---|---|
| Backend lint, typecheck, build | Passed | Passed |
| Backend unit tests | 42/42 | **44/44**, five files |
| Backend disposable DB/API tests | 61/61 | **80/80**, nine files, 84.54 seconds |
| Frontend lint, typecheck, build | Passed | Passed |
| Frontend unit tests | 92/92 | **102/102**, five files |
| Frontend production-browser tests | 36/36 | **37/37** |
| OpenAPI export | Existing contract inspected | Regenerated successfully |
| `git diff --check` | Clean | Passed |

Baseline database: `dumpwise_verify_061b3758a83b66b3_test`. Phase 4 databases: `dumpwise_verify_eec4277fcffe6630_test` and final `dumpwise_verify_b578ded08d3efb2a_test`. Unique restricted roles were provisioned only for disposable databases. Databases/roles are retained by the existing runner design.

Backend integration tests import synthetic CSVs through the real pipeline, reconcile exact control totals, publish as an OWNER, and query as a VIEWER. They cover all dimensions; G2/RE/S1 reductions; mixed currencies/units; negative returns-only periods; zero/missing comparison bases; invalid ranges/filters/sorts/pagination; literal SQL-like search; publication plus reconciliation requirements; paging/full totals; anonymous/cross-tenant access; foreign product lookup; forged service access; no-context reads and A/B/A reuse of a single-connection Prisma pool. Existing reconciliation and security tests remain green.

Browser tests cover all three views through the BFF, 20-row/5-row pagination, unit/quantity-sort compatibility, search/empty states, currency changes, product chart/table selection, 375px overflow checks and explicit permission failures/recovery. The browser API is a synthetic mock; the backend suite tests the actual database. A real-browser → BFF → real-API → disposable-PostgreSQL all-in-one run was **not** performed in this phase. No live development tests were run.

One initial browser assertion failed because its test heading contained an encoding-corrupted separator; the product table/chart had loaded correctly. The assertion now matches the semantic heading. Windows Playwright test-server teardown stalled after assertions; only the verified mock/web test process trees were stopped, allowing the runner to exit successfully. The final run reported 37 passed in 3.4 minutes including teardown delay. Vite config-loader and terminal-color warnings remain non-failing tooling warnings.

## Limits and learning

- No production-volume query-plan or latency benchmark. SQL pagination limits response size, not aggregation cost. Existing tenant/date/entity indexes are reused; no speculative indexes were added. Large offsets remain costlier than keyset paging.
- Growth deliberately omits incomplete comparisons. No-data is not zero. Unit-level ranking can produce multiple rows per entity; the UI and API state this explicitly.
- Product trends are implemented; distributor/customer monthly drilldowns are not part of the four-route contract. No cost/profit/retention/freight metrics were fabricated.
- Currency/unit choices use the existing current-range monthly report. No FX conversion, master-data editing or export was added.
- Chromium desktop plus mobile viewport emulation only; no physical-device, screen-reader, WebKit or Firefox verification.

See API.md for query/response definitions, ARCHITECTURE.md for SQL/index discussion, FRONTEND_ARCHITECTURE.md for BFF integration, and LEARNING_GUIDE.md for short exercises and interview questions on GROUP BY, DTOs, indexes, pagination, growth and chart precision.

No development database reset/mutation, live demo-account change, file deletion, branch switch, commit, push or merge was performed. Stop point: Phase 4 implementation ready for review, with the above measured boundaries.
