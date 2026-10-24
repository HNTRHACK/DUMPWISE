# Phase 5 pilot workflow results

Date: 2026-10-25. Branch: `feat/security-hardening`. Starting HEAD: `9db1f68`.
Status: **a verified bounded synthetic reporting workflow, with the remaining gates below**.
Implementation was initially left uncommitted. Local finalization commits were subsequently
authorized; no push, merge, rebase or branch switch was performed.

## Finalization verification

The final unchanged implementation passed both complete `npm.cmd run verify` chains:
backend lint, typecheck, build, 49 unit tests and 93 integration tests (13 files,
95.04 seconds); frontend lint, typecheck, build, 136 unit/Storybook tests and 37 browser
tests (54.5 seconds). A separate production Storybook build also passed.
The backend run used fresh `dumpwise_verify_2a91a8ed0be27af7_test`; development was not
migrated or changed. Existing live synthetic evidence below remains applicable.

Non-blocking tooling warnings remain: Vite configuration loading/ESM notices, redundant
tsconfig-paths plugin advice, color environment notices and Storybook bundler notices
about dependency `use client` directives. Storybook accessibility findings are configured
as `todo`, not a release gate. Its included starter examples are not a completed DUMPWISE
component catalogue. Staged source, stock Storybook assets, locks and synthetic evidence
were reviewed for secrets, personal/company data and generated artifacts before commits.

## Inspection and preserved work

Read repository/history/diffs, README, security/Phase 4/live/architecture/API documentation,
Prisma schema, migrations/grants/RLS, parser/sign/reconciliation/publication code, DTOs,
BFF allowlists/runtime validation and dashboard components before implementation. Wrote
PILOT_READINESS_PLAN.md before code changes.

Preserved the six pre-existing Phase 4 verification files and empty-pager improvement.
Concurrent Storybook setup/dependency/configuration files appeared during development;
these were preserved. The user separately authorized fixing its two sample JSX quote
lint errors. No Storybook dependency/configuration rewrite was made by this implementation.

Baseline: backend 44 unit + 80 disposable integration tests; frontend 102 unit + 37 browser
tests. The first browser run passed assertions but Windows test-server teardown stalled;
only the verified mock/Next test-server process trees were stopped. Unrelated development
processes remained running. Later browser runs used normal process permissions and exited.

## Implemented vertical workflow

1. **Reviewed mappings:** tenant-owned immutable template versions, strict declarative
   columns/date/number/document-type mappings, OWNER approval, human-readable explanation
   and bounded read-only preview. Known SAP signs cannot be redefined or overridden.
2. **Configurable import:** optional approved template on the original CSV upload; existing
   validation, duplicates, signed values, atomic reconciliation/rollback and publication
   retained. Batches record immutable template/rules provenance. Legacy imports/CLI still work.
3. **Lineage:** authorized published transaction list/detail, exact full-filter totals,
   bounded stable paging and source batch/record/checksum/rules evidence. Overview, Sales,
   Products, Distributors, Customers and selected entity drilldowns are connected through
   the BFF. Original CSV files explicitly remain NOT_RETAINED.
4. **Shared report evidence:** one SQL statement freezes facts, source metadata and checks;
   Decimal aggregation supplies both formats. Same-key generation serializes before file
   work. Both files and the snapshot are stored atomically; failures publish nothing.
5. **Editable exports:** professional generic DUMPWISE XLSX with source/reconciliation
   sheets and exact text amounts; native editable PPTX text/tables on a branded master.
   No public links, macros, executable mappings, external connections or invented metrics.
6. **Report/pilot UI:** private report center, currency/unit/3/6/12-month controls, frozen
   data preview/downloads, freshness/source/check evidence, access/empty/loading states,
   entered labor durations, review statements and append-only discrepancy assessment history.

Three **additive** migrations create import_template_versions, report_snapshots and
pilot_assessments plus nullable legacy-compatible batch provenance. All new tables use
ENABLE/FORCE RLS. The runtime cannot rewrite template meaning or UPDATE/DELETE reports/
assessments; the identity provisioner cannot access them. Existing financial permissions,
sign CHECKs, roles, reconciliation rules and tenant context were not weakened.

## Actual verification

| Check | Result |
|---|---|
| Backend lint / typecheck / build | Passed |
| Backend unit tests | **49/49**, 7 files |
| Backend disposable database/API suite | **93/93**, 13 files, 79.17 seconds |
| Frontend lint / typecheck / production build | Passed in the final combined `npm.cmd run verify` chain, exit 0 |
| Frontend unit + concurrently added Storybook tests | **136/136**, 8 files (128 node tests + 8 Storybook tests) |
| Existing frontend production-browser suite | **37/37**, final run **53.8 seconds** |
| Real browser → BFF → Nest → restricted PostgreSQL pilot | **9 verification groups passed**, exit 0 |
| OpenAPI export | Regenerated successfully, new routes and DTOs included |
| API npm audit | **0 reported vulnerabilities** after scoped patched transitive overrides |
| Diff whitespace check | Passed |
| Changed/untracked file credential/log scan | 109 files at scan time, no private keys, embedded DB credential URLs or debug/dump filenames found; no files staged |

Integration database: `dumpwise_verify_b71870e9a1acb0fd_test`. Earlier disposable verification
databases are retained. No reset/truncation or cleanup was performed.

The 93 tests include the original financial/security/analytics regressions, approved-template
imports, read-only previews, immutable provenance, exact credit behavior, upload idempotence,
literal filters, currency/unit separation, lineage total/page parity, safe Office strings,
dashboard/XLSX/PPTX parity, same-key concurrent requests, generation-failure rollback,
expired/private downloads, entered negative labor differences and a real 5,001-line
reconciled/published import rejected by the export ceiling.

Actual PostgreSQL tests check all 12 RLS table flags, restricted-role attributes, missing
context, foreign rows/inserts/updates, forbidden DELETE and restricted template columns.
The three new tables are explicitly queried A/B/A through a one-connection pool, including
commit/rollback cleanup. The provisioner is denied their SELECT privileges. Policy-only
byte/JSON fixtures in phase5-rls.e2e-spec.ts are not treated as real reports; actual generated
files are separately tested through the full application and restricted runtime role.

## Real pilot run and independent financial oracle

Final disposable live database: `dumpwise_pilot_f241f957eba111bb_test`.
`phase5-live-evidence.json` contains sanitized outcomes only. The harness creates a fresh
database, unique restricted runtime/provisioning roles and new synthetic OWNER/VIEWER
accounts. It **never opens a development database connection**. Passwords remain in memory;
no existing identity or password is changed. Only its own dynamic-port loopback services
are started/stopped.

Chromium creates a draft mapping with a custom net-value header, approves it, demonstrates
slash-date rejection and blocked unpreviewed import, previews the corrected file, imports
against independent controls and publishes through the actual UI. It opens all three
analytics/lineage views, generates both formats, downloads through authenticated BFF routes,
records an entered pilot review, and checks a second organization containing identical SAP
document/item identifiers. Foreign report/template/transaction IDs are denied; VIEWER is
denied source endpoints and receives the report-center permission state. Loading and empty
states are exercised without fabricated responses. The report/pilot view fits 375px and
the successful owner flow emits no uncaught page errors.

Independent SQL over the disposable published facts agrees with stored report JSON, the
exact XLSX total cell and the editable PPTX sales table: **INR 65.00, 4 billing lines**.
The source also contains **USD 7.00**, which remains separate. INR comprises F2 +100.00,
G2 -10.00, RE -20.00 and S1 -5.00; G2 contributes zero quantity. INR EA revenue is 85.00;
KG returns contribute -20.00. No real SAP/company results or financial savings are claimed.
The entered 90/30-minute pilot comparison is explicitly synthetic user test input.

The successful run followed corrected test-only assertions (Published capitalization,
Next route-announcer matching) and a real responsive defect: download/pagination button
groups needed wrapping. A first mock-browser launch also overlapped a production build
and found no BUILD_ID; builds and browser-server runs were then sequenced. Earlier test
assumptions about random UUID/document ordering and the number of reconciliation checks
were corrected; business-order paging is now explicit. These failed attempts are not
counted as successful verification.

## Measured synthetic performance

`node scripts/benchmark-phase5.mjs` records all samples in `phase5-performance.json`.
Node v24.13.1, three samples per size, one process, 200 SKU / 30 distributor / 100 customer
codes across 12 months. This measures in-memory Decimal aggregation and both file encoders/
archive integrity checks, **not SQL, HTTP, concurrent load or employee time savings**.

| Facts | Aggregation range | Both encoders + integrity range | XLSX size / PPTX size |
|---|---:|---:|---:|
| 100 | 2.21–7.97 ms | 45.98–97.49 ms | about 32 KB / 336 KB |
| 1,000 | 8.56–11.46 ms | 138.37–153.78 ms | about 99 KB / 336 KB |
| 5,000 | 30.45–37.76 ms | 462.83–580.33 ms | about 377 KB / 337 KB |

A bounded synchronous pilot path is justified by these observations, not by an assumed
production SLA. SQL statement timeout is 20 seconds, transaction timeout 60 seconds;
over-limit requests fail rather than silently truncating facts or evidence.

## Remaining gates and honest limits

- Native PowerPoint chart objects and a rendered slide preview are not implemented;
  trends are editable tables and the browser offers a data preview. ZIP/XML checks prove
  structure/editability and exact values, not visual Office compatibility. No actual
  PowerPoint/Excel application rendering or screen-reader/physical-device review occurred.
- No approved company workbook/deck has been supplied. Exports use a generic DUMPWISE
  definition; no company-specific format compatibility is asserted. Custom layout/definition
  authoring is deferred; stable code-owned versions and per-org frozen configurations exist.
- No durable background queue or progress/recovery scheduler. Limits are 5,000 current+
  comparison facts, 100 batches, 5,000 checks and 16 MiB per file. Production SQL-volume,
  concurrency, query-plan and long-running import/export stress tests remain to be done.
- Seven-day download-access expiry exists; physical storage retention cleanup/encryption,
  managed object storage, backup/restore and operational scheduling remain unimplemented.
- Original CSV retention/chain of custody, large template-catalog navigation and template
  retirement are absent. The pilot UI shows the first 100 versions. API lists are paginated.
- Exact Excel amounts are text cells, not floating-point numeric cells or live formulas.
  Converting them in Office requires an explicitly reviewed precision policy.
- Pilot durations/reviews are human statements. There is no automatic full-workflow timer,
  per-file signed review, ticket/SLA workflow or supported financial ROI estimate.
- Activity months and contributing-batch checks do not prove complete SAP extract coverage
  or the pass rate of all attempted imports. Published facts contain no cost/profit/freight/
  retention inputs; those metrics were not invented.
- Development remains **unmigrated**. The new app/schema requires the three reviewed
  migrations before use with an existing development database. No development migration
  or grant/account/data change was performed. The preserved Phase 4 copy harness assumes
  matching source/target table shapes; after additive schema changes, use the fresh Phase 5
  harness until that legacy copy workflow is explicitly adapted.

Production readiness additionally needs TLS, SSO/MFA decisions, security/operations review,
deployment, backup/restore and real authorized pilot evidence. This local synthetic run
does not establish enterprise production readiness.

## Safe reproduction and learning

From apps/api: `npm.cmd run verify` uses fresh `dumpwise_verify_*_test` databases;
`node scripts/verify-phase5-live.mjs` creates a fresh `dumpwise_pilot_*_test` and runs the
real browser workflow. Neither resets/truncates development. `node scripts/benchmark-phase5.mjs`
uses synthetic in-memory data only, after build. From apps/web: `npm.cmd run verify` runs
unit/Storybook and production-browser tests against a synthetic mock, not PostgreSQL.
Do not run playwright.live.config.ts or development role/migration scripts for these checks.

Mentoring exercises and interview questions are in PILOT_READINESS_PLAN.md,
REPORT_TEMPLATE_SPEC.md, DATA_LINEAGE.md, REPORT_EXPORTS.md and PILOT_VALIDATION.md.
The core lesson is to preserve meaning before automating presentation: immutable mapping,
independent reconciliation, authorized lineage and one shared snapshot make an editable
report explainable. A visually convincing file alone cannot prove its financial correctness.
