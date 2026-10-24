# Phase 4 live verification

Date: 2026-10-25. Branch: `feat/security-hardening`. Starting commit: `9db1f68`. The working tree was clean before verification. Work below remains uncommitted.

## Safety and environment

Live authentication and even authenticated GET requests write session/audit/limiter state. To obey the no-development-writes constraint, verification used a **fresh disposable database containing an exact copy of the existing published synthetic facts**, rather than logging into the development API.

- The development connection had PostgreSQL `default_transaction_read_only=on` and an explicit repeatable-read, read-only snapshot. `SHOW transaction_read_only` was checked.
- Only SYNTHETIC organizations, their masters, PUBLISHED/PASSED batches, associated facts and reconciliation results were copied. Existing users, passwords, memberships, sessions and audit records were **not** copied.
- Copy counts and database-side row fingerprints matched the source for all seven copied tables before tests began. SQL DATE values remained calendar strings, avoiding local-midnight/UTC conversion.
- Two new disposable VIEWER users, one per synthetic organization, received random passwords held only in process memory. No existing password was changed.
- Fresh runtime roles were `NOSUPERUSER` and `NOBYPASSRLS`; an unscoped runtime fact query returned zero rows. Existing migrations and restricted grants were used without changes.
- Only a new loopback NestJS service and production Next.js service were started, on dynamically allocated ports. The production BFF pointed at the disposable NestJS instance. Only those spawned processes were stopped afterward. No unrelated process was terminated.
- No development API authentication, database reset, truncation, destructive cleanup, commit, push or merge occurred.

Final live database: `dumpwise_live_d4c077ab1efa3124_test`. Earlier harness attempts and the first successful pre-fix run remain as `dumpwise_live_*_test` databases with unique test roles; no cleanup was performed. Backend regression used a separate `dumpwise_verify_73756133f692cc7b_test` database.

The copied snapshot contained 2 synthetic organizations, 40 products, 16 distributors, 80 customers, 2 published batches, 4,988 billing lines and 168 reconciliation results. The primary `synthetic-demo` dataset contributes 2,494 lines; the isolation dataset remains a separate organization.

## Real end-to-end flows

The verification harness launched Chromium against the production Next.js build. Login went through the actual login form, HttpOnly BFF cookies, NestJS authentication and restricted PostgreSQL connections. The browser's authenticated request context then queried each report through the BFF; it never bypassed authentication or tenant policies.

Verified all three list endpoints and the product trend endpoint. For each of the 3/6/12-month ranges and INR/USD independently:

1. Independent SQL read the original read-only snapshot, using direct SUM/COUNT/GROUP BY queries, separate prior-period queries and no production analytics helper.
2. Every entity/unit row was compared, including names/IDs, net revenue, G2 credits, RE returns, S1 cancellations, signed quantity, line count, previous revenue and growth reason/percentage. Percentage expectations used independent integer arithmetic.
3. All 7-row pages were collected and compared with the entire independent result set. Full-filter KPI totals stayed unchanged across pages.
4. Code and line-count sorting were checked in both directions; numeric revenue ranking and quantity ranking within a selected unit matched the oracle.
5. Unit and literal code-search filters matched separately filtered SQL results.
6. Net totals matched the existing monthly sales API running on the exact copied facts, and the committed **Python-generated control totals**. Python was not rerun in this verification; its existing control JSON was independently summed using integer cents.

### Exact totals — each dimension reconciled to the same amount

| Inclusive range | INR net revenue | USD net revenue |
|---|---:|---:|
| 2026-07 through 2026-09 | 148,787,290.80 | 360,337.08 |
| 2026-04 through 2026-09 | 289,877,205.72 | 563,443.61 |
| 2025-10 through 2026-09 | 574,132,689.75 | 1,062,439.58 |

These are separate currency totals, never a combined value.

Independent full-period source SQL for `synthetic-demo` confirmed:

| Billing type | INR signed amount / lines | USD signed amount / lines |
|---|---:|---:|
| F2 invoice | 583,607,166.67 / 2,077 | 1,075,245.57 / 307 |
| G2 value credit | -763,648.80 / 51 | No rows |
| RE return | -1,857,180.22 / 29 | -5,141.00 / 4 |
| S1 cancellation | -6,853,647.90 / 24 | -7,664.99 / 2 |

Credit/return/cancellation columns are positive reduction magnitudes in the analytics response; they are already subtracted from net revenue. Each sales unit was independently filtered and checked. No KG/EA/CAR quantities were added together. Product trends in both currencies and each available unit matched independent monthly SQL; absent activity was not converted into invented zero sales.

## Browser states and isolation

- Products, Distributors and Customers rendered exact KPI totals and real ranked tables. Selecting a product rendered the accessible chart and supporting exact monthly table.
- Search with no match showed an explicit empty state. Unit, quantity-sort, currency and completed-month range controls worked. Each view fit a 375px viewport without document-level horizontal overflow.
- Loading was observed by briefly holding a real request and then continuing it to NestJS. No API response was fabricated.
- VIEWER A querying organization B was denied with 403 on all three list routes. VIEWER B could query its own reports but received 404 for A's product trend ID. Anonymous BFF and direct Nest requests returned 401.
- The browser permission/error state was exercised by continuing a real request with B's organization header, producing an actual NestJS 403; the report table was absent. An authorized reload recovered normally.
- Invalid sort, pagination, date and currency values returned 400. Quantity sorting without a unit was rejected. SQL-like search remained a literal search; a future empty date range returned zero results.
- No uncaught browser page errors occurred in the successful run.

## Discrepancies and fixes

**No application financial, currency, quantity, sorting, pagination-data, trend or isolation discrepancy was found.**

One real presentation bug was fixed: an empty report's pager displayed `1–0`. It now displays `0–0`. The count and financial metrics are unchanged. Both the real-stack verifier and the existing mock-browser regression test assert the corrected label.

Initial harness-only failures were corrected before accepting results: a required disposable-user timestamp, inherited non-production build environment, SQL DATE serialization, a wrong skeleton selector, and a request-interception teardown race. The date-copy problem initially produced a totals mismatch; it was a copy defect, not a production reporting defect. Database-side copy fingerprints now guard against that class of false result. No source date or production query was changed.

## Regression results

| Check | Actual result |
|---|---|
| Real browser → BFF → NestJS → copied PostgreSQL | **18 verification groups passed**, exit 0 after the pager fix |
| Backend lint / typecheck / build | Passed |
| Backend unit suite | **44/44** |
| Backend disposable integration/API suite | **80/80**, 9 files, 68.32 seconds |
| Frontend lint / typecheck / production build | Passed |
| Frontend unit suite | **102/102** |
| Targeted analytics browser regression | **2/2**, 12.8 seconds |
| `git diff --check` | Passed |
| Development before/after checks | **All 13 table counts and row fingerprints unchanged** |

The 13 source tables checked were organizations, users, memberships, auth_sessions, user_login_sources, rate_limit_buckets, audit_events, import_batches, products, distributors, customers, sales_transactions and reconciliation_results. In particular, development retained 3 users, 9 sessions, 15 limiter buckets, 3 batches and 4,988 facts; no live-login side effects occurred there.

Reproduce from `apps/api` with `node scripts/verify-phase4-live.mjs`. It requires the existing migration/admin connection for read-only source inspection and creating a fresh disposable database. It builds both applications, uses random local ports and accounts, retains the disposable DB, and writes only sanitized counts/fingerprints/financial outcomes to `docs/phase4-live-evidence.json`. It does not print or persist passwords, tokens or cookies. Frontend verification logic lives in `apps/web/test/live/phase4-verify.mjs`.

## Remaining limitations

- This proves behavior on an exact disposable copy of the existing published synthetic data; it does not claim a direct authenticated run against the development database.
- The oracle is independent SQL plus existing Python-generated controls, not a newly executed Python recomputation or real SAP company extract.
- Product trend SQL was checked on a selected product across both currencies and units; the list comparisons covered every returned entity/unit row. Not every product chart was opened individually.
- No production-volume performance benchmark, physical device, screen-reader, Firefox or WebKit verification was performed. Chromium and a 375px viewport were used.
- Development data and credentials remain untouched. Disposable databases/roles are retained and require separately authorized cleanup if desired.

Stop point: verification completed. No new phase was begun, and no changes were committed or published.
