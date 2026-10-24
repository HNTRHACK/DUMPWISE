# Phase 6 resume checkpoint

Saved 2026-10-25. This is a handoff, not the start of Phase 6 implementation.
No tests, services, database connections, migrations, commits or network review requests
were run while preparing this checkpoint. Only this document was added.

## Repository state

- Repository: `C:\Users\HARDIK\Documents\Projects\DUMPWISE`
- Branch: `feat/security-hardening`; HEAD: `76913e03cb265042f90633a2d3673cbe607e93aa`.
- Working tree was clean before this document. Local status showed no ahead/behind marker
  against the locally cached origin reference. No fetch or remote-state verification occurred.
- Phase 5 commits: `2111ce7` templates/versioning/lineage; `e2720ec` private XLSX/PPTX
  snapshots; `9d37eb6` frontend/pilot/Storybook; `76913e0` tests/docs/evidence.
- Preserve all Phase 1-5 financial reconciliation, SAP signs, Decimal arithmetic,
  currency/unit separation, membership/role checks and transaction-local RLS context.

Read [PHASE_5_RESULTS.md](PHASE_5_RESULTS.md), [SECURITY.md](SECURITY.md),
[REPORT_EXPORTS.md](REPORT_EXPORTS.md), [PILOT_READINESS_PLAN.md](PILOT_READINESS_PLAN.md)
and `apps/web/AGENTS.md` before further work. Do not implement a new phase without scope.

## Existing tooling: verified facts and unknowns

### Storybook

- Installed in `apps/web`: Storybook `^10.6.3`, Next.js/Vite integration, Vitest,
  accessibility, docs, MCP and Chromatic addons. Package locks are committed; some
  manifest dependencies use `latest`, so avoid unsolicited dependency upgrades.
- Configuration: `.storybook/main.ts` and `.storybook/preview.tsx`;
  examples: `src/stories` (Button, Header, Page and stock tutorial assets).
  These are starter examples, not a complete DUMPWISE component/state catalogue.
- `vitest.config.ts` runs node unit tests plus the named `storybook` project using
  headless Chromium through Playwright. ESLint includes Storybook recommended rules.
- Accessibility is `test: 'todo'`: findings do not fail the suite. No blocking a11y
  gate, visual-baseline approval or Chromatic publishing was established by this review.
  Installing an addon does not prove its external service/account is configured.
- Scripts: `npm.cmd run storybook` (port 6006), `npm.cmd run build-storybook`.
  `storybook-static` and Storybook logs are ignored. Do not commit generated output.

### Lighthouse and performance

- A global Windows `lighthouse.cmd`/`lighthouse.ps1` executable exists on PATH under
  the user's npm directory. It was discovered, not executed; its runtime compatibility
  and Chrome availability were not checked in this checkpoint.
- No repository Lighthouse/LHCI configuration, npm script, CI budget or report was found.
- `apps/web/test/perf/measure.mjs` is an existing Playwright lab measurement script,
  explicitly **not Lighthouse**. Historical Phase 3 LCP/CLS results are not a current
  release score. See [PHASE_3_RESULTS.md](PHASE_3_RESULTS.md).
- Lighthouse scores and current performance budgets remain pending. Audit public pages
  against a production build and synthetic mock first; never use development login as
  a convenient audit target because authentication/rate limiting writes database rows.

### CodeRabbit

- No `.coderabbit` configuration, repository CI workflow, package script or `coderabbit`
  command on PATH was found. No `.github` directory exists in this checkout.
- GitHub App installation, IDE extension/account setup and remote PR reviews were not
  inspected. Treat their state as unknown, not enabled or verified.
- Before any future external review, establish the actual integration, review scope and
  authorization to transmit code. Do not fabricate CLI commands or infer a completed
  review from an installed editor tool. Do not push/open a PR merely to trigger a review.

## Verification baseline (historical; not rerun now)

The finalization section of PHASE_5_RESULTS is the latest recorded run; its later table
also preserves earlier run timings/database names.

- Backend: lint, typecheck, build; 49/49 unit and 93/93 disposable integration tests
  (13 integration files, 95.04 seconds).
- Frontend: lint, typecheck, production build; 136/136 unit/Storybook tests
  (128 node + 8 Storybook), 37/37 browser tests (54.5 seconds).
- Separate Storybook production build passed. Recorded real synthetic pilot passed nine
  groups through browser/BFF/Nest/restricted PostgreSQL; SQL/snapshot/XLSX/PPTX agreed
  on INR 65.00 across four lines, with USD 7.00 separate.
- Non-blocking warnings: Vite ESM/config-loader notices, redundant tsconfig-paths advice,
  color environment notices and Storybook dependency `use client` bundling notices.
- Prior API audit reported zero vulnerabilities; this is historical, not a fresh audit.

## Migration and data status

Six SQL migrations are source-controlled. The three Phase 5 additions are:

1. `20261025010000_import_templates`: immutable mapping versions and batch provenance.
2. `20261025020000_report_snapshots`: private immutable report evidence and file bytes.
3. `20261025030000_pilot_assessments`: append-only pilot review/measurement records.

All three new tables ENABLE/FORCE RLS. Runtime grants restrict template updates to approval
columns and reports/assessments to SELECT/INSERT. Provisioning identities cannot read them.
The migration connection uses `MIGRATION_DATABASE_URL`; API runtime uses restricted
`DATABASE_URL`. Never substitute the migration role for runtime to bypass RLS.

Last documented development status: **Phase 5 migrations NOT applied to dumpwise_dev**.
No database was contacted to recheck that status here. Existing development use of the new
code needs a separately authorized migration/grants rollout; do not start it automatically.
Do not run `db:migrate`, `db:migrate:dev`, `db:roles`, auth cleanup, seeds or import/publish
commands against development. Do not reset, truncate, drop or change passwords/accounts.

Retained evidence databases include `dumpwise_verify_2a91a8ed0be27af7_test` and
`dumpwise_pilot_f241f957eba111bb_test`; these are historical names, not reuse targets.
Disposable runners generate new database names and random restricted roles each time.
They connect to PostgreSQL maintenance database `postgres` to create only their fresh
test databases, then migrate/provision those. Their credentials come from the existing
local environment; never print or copy `.env` values into a report.

The legacy Phase 4 copy harness assumes matching source/target table shapes. Do not run
it after additive schema changes; use the fresh Phase 5 harness for real-flow verification.

## Exact safe resume commands (PowerShell; run later, selectively)

Start with inexpensive inspection, preserving any new edits:

```powershell
Set-Location 'C:\Users\HARDIK\Documents\Projects\DUMPWISE'
git status --short --branch
git log -6 --oneline
git diff --stat
git diff --cached --stat
Get-Content docs/PHASE_6_HANDOFF.md
Get-Content docs/PHASE_5_RESULTS.md
```

After scope is agreed and testing is appropriate, full suites use the installed locked
dependencies. Do not reinstall/upgrade tools just to resume. The API runner requires the
existing local migration credentials and PostgreSQL service; inspect its script first,
without exposing secrets. If unavailable, stop rather than redirecting tests to development.
Run sequentially; avoid building while another test server is using the same output.

```powershell
Set-Location 'C:\Users\HARDIK\Documents\Projects\DUMPWISE\apps\api'
npm.cmd run verify
# Creates a fresh dumpwise_verify_*_test; retained, never development reset.

Set-Location 'C:\Users\HARDIK\Documents\Projects\DUMPWISE\apps\web'
$env:STORYBOOK_DISABLE_TELEMETRY = '1'
npm.cmd run verify
npm.cmd run build-storybook
# Web browser tests start mock API 3101 and Next 3100; no PostgreSQL.
# If ports are occupied, investigate; never terminate unrelated processes.

# Optional focused Storybook tests or interactive review:
npm.cmd test -- --project storybook
npm.cmd run storybook -- --host 127.0.0.1 --no-open
# Stop only this interactive server with Ctrl+C when finished.
```

Optional expensive real synthetic-flow verification (not needed simply to resume reading):

```powershell
Set-Location 'C:\Users\HARDIK\Documents\Projects\DUMPWISE\apps\api'
node scripts/verify-phase5-live.mjs
```

This creates `dumpwise_pilot_*_test`, builds both applications and starts its own dynamic-port
services. It writes new sanitized results to `docs/phase5-live-evidence.json`; inspect that
diff afterward. Never point a live test configuration at development for convenience.

Optional future Lighthouse baseline, using three separate terminals and free ports:

```powershell
# First build once, before starting these services, from apps/web:
npm.cmd run build
# Terminal A, apps/web:
node test/e2e/mock-api.mjs
# Terminal B, apps/web:
$env:DUMPWISE_API_URL = 'http://127.0.0.1:3101'
.\node_modules\.bin\next.cmd start -H 127.0.0.1 -p 3100
# Terminal C, apps/web; output stays outside the repository:
lighthouse.cmd http://127.0.0.1:3100/ --chrome-flags="--headless" --output=html --output-path="$env:TEMP\dumpwise-lighthouse-home.html" --only-categories=performance,accessibility,best-practices,seo
# Existing separate lab measurement (does not produce a Lighthouse score):
$env:PERF_BASE = 'http://127.0.0.1:3100'
node test/perf/measure.mjs
```

These Lighthouse commands are a proposed manual audit, not executed/validated results or
a configured release gate. Audit `/product` and `/login` separately as needed without
submitting credentials. Stop only the two servers you started. Do not run the browser suite
simultaneously on the same ports. No supported CodeRabbit resume command is known yet.

## Pending release checks and limitations

- Establish release scope, current Lighthouse measurements/budgets, CodeRabbit integration
  and review outcomes; resolve meaningful findings without starting unrelated features.
- Review actual DUMPWISE component states in Storybook; decide on blocking accessibility
  and visual regression gates. Manual keyboard/screen-reader/device review remains pending.
- Open synthetic exports in actual Excel/PowerPoint for visual/compatibility review.
  Exact XLSX amounts are text cells; PPTX has editable tables/text, not native charts.
- Obtain authorized format/business review; generic exports are not company-approved SAP
  deliverables. Keep real company data, credentials and exports out of source control.
- Production volume/concurrency/query plans, recovery/jobs, storage encryption/physical
  retention cleanup, backup/restore, TLS, deployment and SSO/MFA decisions remain gates.
  Seven-day download expiry does not delete stored files. Pilot durations are user-entered,
  not proven ROI. Original CSV retention and complete SAP coverage are not established.
- Plan migration/grants rollout separately with approval and backup/rollback planning.
  Preserve financial controls and restricted runtime permissions; never relax RLS for tests.

Checkpoint stop condition: leave this handoff uncommitted; no new implementation, expensive
verification, database modification, commit, push, merge or branch switch in this session.
