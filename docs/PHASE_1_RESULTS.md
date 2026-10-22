# Phase 1 Results

Date: 2026-10-23 · Environment: Windows 11, Node 24.13.1, npm 11.8.0, Python 3.12.10,
Docker 29.9.2, Compose 5.6.1, PostgreSQL 17 (container `dumpwise-postgres`, healthy).

Every number below was produced by an actual run. Nothing is assumed.

## Starting point

- `compose.yaml` (PostgreSQL 17 on `127.0.0.1:5433`) and a root `.env` already existed. Both were kept unchanged.
- `apps/api` already contained a NestJS 12 "Hello World" scaffold (ESM, Vitest, oxlint). Its build passed and 1 of 1 tests passed. It was **extended, not regenerated**.
- No Git repository and an empty database (0 tables).

## What changed in the existing scaffold

| Change | Reason |
|---|---|
| Removed `@nestjs/observe` (and its module in `app.module.ts`) | Sends telemetry to an external service; placeholder credentials |
| Removed `@nestjs/mau` and the `deploy` script | External cloud account action |
| Removed `app.controller/service` and the Hello World tests | Replaced by `/health` and real tests |
| Port 3000 → 3001, bound to 127.0.0.1 | Requirement and security |
| `vitest.config.ts` restricted to `src/**/*.spec.ts`; e2e config gained the test-DB setup | Separate unit and database tests |

## Pipeline run on the development database (synthetic data)

| Step | Result |
|---|---|
| Import `SYNTHETIC_sap_billing_2025-10_to_2026-09.csv` (2,531 data rows) | `IMPORTED` in about 2.4 s |
| Rows valid / inserted | 2,494 / 2,494 |
| Exact duplicates skipped | 24 |
| Rows rejected | 13 = 11 invalid + 2 conflicting-key rows, each with a line number and reason |
| Reconciliation | 84 checks (net amount + line count for 24 month-currency pairs, quantity for 36 month-unit pairs): **84 passed** |
| Re-import of the same file | `ALREADY_IMPORTED`, same batch id, no new rows |
| Publish as ANALYST | Refused: "Role ANALYST may not perform this action" |
| Publish as OWNER | `PUBLISHED` |
| Monthly output, Oct 2025 INR | ₹49,445,993.81 over 192 lines: identical to the Python control total |

## Verification (`npm run verify`, exit code 0)

| Check | Result |
|---|---|
| Lint (oxlint) | 0 warnings, 0 errors |
| Typecheck (`tsc --noEmit`) | 0 errors |
| Build (`nest build`) | Success |
| Unit tests | **23 / 23 passed** |
| E2E tests (database `dumpwise_test`) | **21 / 21 passed** |
| `npm audit` | 0 vulnerabilities |
| Live server | `/health` returned 200; `/v1/sales/monthly` returned 401; listening only on `127.0.0.1:3001`; OpenAPI lists exactly 2 paths |

**Mutation check.** The G2 credit-memo sign was deliberately flipped and the suites re-run:
2 unit tests and 4 e2e tests failed, including reconciliation against the Python totals.
The rule was then restored. This shows the tests detect real calculation errors.

## Required test scenarios → tests

| # | Scenario | Test(s) |
|---|---|---|
| 1 | Health endpoint | `health.e2e-spec` › reports service status, database status and a timestamp |
| 2 | Valid synthetic import | `import-pipeline.e2e-spec` › imports the valid synthetic file and passes reconciliation; unit › produces exactly the issue counts the independent generator expects |
| 3 | Invalid date and quantity | unit › rejects date ×4, rejects quantity ×4, rejects the row and keeps the line number |
| 4 | Duplicate detection | unit › skips exact duplicates and rejects conflicting duplicates; e2e › skips rows already imported, rejects changed rows, never overwrites |
| 5 | Repeat import idempotency | e2e › is idempotent: re-importing the same file changes nothing; allows a corrected re-import after a failed one |
| 6 | Credit note calculations | unit › applies documented sign rules; nets an invoice, credit memo, return and cancellation exactly; e2e › stores signed values and nets them in the monthly aggregate |
| 7 | Monthly aggregation accuracy | e2e › aggregates months exactly to the independently generated totals (all 24 month-currency pairs and 36 month-unit pairs) |
| 8 | Reconciliation mismatch blocks publication | e2e › rolls back the rows, records the evidence and blocks publication (off by ₹0.01) |
| 9 | Unauthorized API access | e2e › rejects every caller with 401 (as deployed); 401 without credentials; 400 invalid org header; 403 unknown user or org; 400 invalid or unexpected query |
| 10 | Cross-tenant isolation | e2e › a member of A cannot read B; each organization sees only its own totals; a user in both sees each separately; the database refuses a cross-organization product link |

## Unresolved issues and limitations

1. **No real authentication.** The protected endpoint is unreachable by design until an identity provider is integrated. See SECURITY.md #1.
2. Imports and publication are CLI-only, and the CLI trusts `--actor`.
3. No PostgreSQL Row-Level Security yet.
4. Only billing types F2, G2, RE and S1 are supported; German number format is not supported.
5. Visibility follows the batch that *first* inserted a row. If a row was first inserted by a batch that is never published, a later published batch containing the identical row does not make it visible. This cannot happen today, because only passed batches keep rows, but it needs a rule once batches can be withdrawn.
6. `vite-tsconfig-paths` prints a deprecation notice under Vitest 4. It is harmless and left as scaffolded.
7. Git was initialized locally to verify ignore rules. **Nothing has been committed.**

## Next milestone (Phase 2 proposal)

1. Authentication: OIDC/JWT `Authenticator` (for example Microsoft Entra ID), then HTTP endpoints for upload, batch status and publish.
2. PostgreSQL Row-Level Security as a second isolation layer.
3. Distributor-, SKU- and customer-wise analytics plus 3-, 6- and 12-month windows on the same published data.
4. Logistics cost import (per kg, per piece, per shipment) using the same pipeline pattern.
5. Rate limiting, security headers, CI pipeline running `npm run verify`.
