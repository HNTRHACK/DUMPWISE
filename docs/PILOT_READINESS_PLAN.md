# Pilot readiness implementation plan

Date: 2026-10-25. Branch: `feat/security-hardening`; starting commit `9db1f68`.

## Audit and preserved baseline

Phase 1-4 already implement authenticated imports, fixed SAP header aliases, strict
unsigned value parsing, immutable financial facts, duplicate detection, reconciliation,
OWNER publication, monthly reports and SKU/sold-to/ship-to analytics. Money is decimal
text; currencies and physical units remain separate. All tenant queries use transaction-local
context, restricted runtime credentials, RLS and explicit organization filters.

Preserve the six existing uncommitted Phase 4 verification files, including the empty-pager
fix. Do not use the development database for migrations, fixtures or authentication.
The current README contains obsolete Phase 3 counts; Phase 4 results/live verification
are the more recent evidence. Baseline results and final results belong in PHASE_5_RESULTS.md.

## Available evidence and unsupported claims

Facts contain document/item strings, billing date/type, cancellation reference, SKU,
sold-to/ship-to references, signed net amount/currency, signed quantity/unit, batch UUID,
content hash and source row. Batches contain file name/hash/size, status, publication,
row counts and reconciliation checks. Original source files are **not retained**.
No cost, margin, freight, retention, FX, inventory or complete SAP source-coverage evidence
exists. Activity coverage must not be described as extract completeness.

## Implementation order and acceptance gates

1. **Templates and preview:** additive org-owned immutable versions, explicit exact header
   mapping, selected date/number formats, fixed billing rules version, OWNER approval.
   Preview is read-only and reports accepted/rejected/duplicate rows and interpretation.
2. **Configurable import:** optional approved template UUID on the existing upload route;
   same parser, signs, controls, atomic reconcile/publication and upload idempotence.
   Batches record mapping identity; old batches retain an explicit legacy rules version.
3. **Lineage:** published/PASSED transaction endpoint with inherited month/currency/unit
   and entity filters, stable bounded paging, full-subset decimal totals and explicit
   missing source-file evidence; role-gated detailed source identifiers.
4. **Excel:** generic DUMPWISE report definitions and private immutable snapshots;
   aggregate and detail sheets, metadata and reconciliation. XLSX exact amounts remain
   decimal text when Excel's numeric precision cannot represent them. Formula-like
   source strings must remain text. An approved company workbook is required before
   claiming company-template compatibility.
5. **PowerPoint:** same snapshot, editable native text/tables/charts, synthetic annotations,
   insufficient-data states; integrity and visual checks before claiming export quality.
6. **Dashboard/pilot:** report center, lineage links, freshness/coverage and business
   definitions; explicitly entered manual/automated durations, review and discrepancy
   records. Compare labor minutes, never invent money savings or ROI.
7. **Verification:** full regression plus real restricted-role queries in newly created
   disposable databases; synthetic-only browser flows and measured performance at
   several sizes. Record actual outcomes and any incomplete gates.

## Database and API design

Template version rows carry organization UUID, name/description, SAP_BILLING_CSV source,
version, DRAFT/APPROVED status, declarative JSON mapping, rules version, creator/approver
and timestamps. Create a new version to change meaning; never update approved mappings.
Composite org/template foreign keys bind batches to the correct organization. Database
triggers enforce immutability in addition to service authorization. RLS is ENABLED/FORCED,
missing context denies access; runtime grants are explicit, without DELETE/DDL/BYPASSRLS.
Migration/provisioning roles retain their current separation. Apply migrations only to
fresh disposable databases during development verification.

Planned routes: `/v1/import-templates` create/list; `/:id/approve`; `/:id/preview` CSV;
existing `/v1/imports` accepts `templateVersionId`. `/v1/sales/transactions` provides
lineage. Every service verifies real membership, not a role supplied by a caller.
Unknown fields, unbounded paging, arbitrary executable transforms and unknown document
types are rejected. Source header ambiguity is resolved only by an explicit reviewed
mapping; duplicate normalized source headers are never guessed.

Report definitions/snapshots/jobs will also require org RLS, composite references,
idempotency and private authorized downloads with explicit retention. A snapshot must
read facts, aggregates and reconciliation under one repeatable-read transaction or one SQL statement snapshot; a
   timestamp alone is not a consistent snapshot. Bounded synchronous generation is acceptable
only with a documented small-data ceiling; larger exports require durable jobs and progress.

## Security and release limits

No real company data, SAP credentials, direct extraction, production deployment, database
reset/truncation, account changes, commit or push. A stored mapping is data, never code.
Do not log CSV content. Preserve leading zeros and decimal strings. VIEWER can use
existing summary reports, cannot approve/publish, and should not gain detailed source
identifiers by guessing routes. No production-readiness claim without deployment,
backup/restore, TLS, storage, operational and security evaluation.

Each milestone must leave runnable tests: two-tenant isolation with identical external
IDs; repeated mapping determinism; ambiguous dates/amounts and unknown types rejected;
idempotence; credits; currency/unit separation; exact detail/summary/export parity;
role denial; safe formula text; generation failure leaves no downloadable report.
Missing gates are limitations, not assumed successes.

## Mentoring: audit and schema mapping

ETL means extracting source bytes, transforming into a canonical business model and
loading validated facts. Mapping changes column interpretation; reconciliation independently
checks the resulting values. Versioning lets an auditor reproduce which interpretation
produced a historical batch without silently reprocessing it.

Exercise: explain why `Amount` might mean gross, net or local-currency value, then write
an explicit mapping and the control total needed to verify the choice.

Interview questions: Why is a header mapping insufficient to prove financial correctness?
Why should an approved mapping version be immutable even after a new version is approved?
