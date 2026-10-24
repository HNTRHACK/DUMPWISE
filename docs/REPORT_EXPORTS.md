# Private report snapshots and editable Office exports

## Implemented pilot flow

`/app/reports` is discoverable in workspace navigation. OWNER/ANALYST select one currency,
3/6/12 calendar months and optionally one unit. The report configuration is organization-owned
and frozen with its snapshot; metric/definition versions are code-owned
`published-sap-net-v1` and `dumpwise-management-v1`. This is a generic DUMPWISE management
format, not a claim of compatibility with any company's workbook. No approved company
example has been supplied. Custom layout/definition-version authoring is not implemented.

| API | Behavior |
|---|---|
| POST /v1/reports | Validated configuration plus UUID idempotencyKey; creates both files and snapshot atomically |
| GET /v1/reports | Bounded list, default 20, maximum 100; offset maximum 10000 |
| GET /v1/reports/:id | Frozen preview, metadata and top 8 entity/unit rankings; omits the transaction collection |
| GET /v1/reports/:id/xlsx | Authorized private Excel download |
| GET /v1/reports/:id/pptx | Authorized private PowerPoint download |
| GET/POST /v1/reports/:id/pilot | Assessment history / append an entered measurement and review statement |

VIEWER cannot download source-detail exports. All operations require actual organization
membership, normal sessions and the BFF allowlist. POST requires existing same-origin/CSRF
protections. Foreign/missing/expired IDs return 404 after membership authorization.
Files have fixed UUID-based download names, no-store responses and no public URL.

## Consistency, precision and security

Generation first takes a transaction-scoped advisory lock for organization + idempotency
key, then checks for a prior completed report. The same key/configuration returns that
report; changing configuration under that key returns 409. A fresh key captures new facts.

Facts, organization metadata, contributing batches and reconciliation checks are read in
**one PostgreSQL statement snapshot**. All later aggregation and both file encoders use
those frozen values; no second financial query can see a newer publication. This achieves
the planned consistency gate without a multi-query repeatable-read transaction. SQL values
are bound parameters. Snapshot aggregation uses Decimal with 50-digit precision; quantities
remain separate by unit and amounts are restricted to one currency.

Only PUBLISHED/PASSED batches contribute. Inconsistent stored reconciliation evidence
blocks generation. Credits, returns and cancellations use existing signed facts. Growth
uses the preceding equal-length period, full monthly activity and a positive prior base;
otherwise the export includes a reason instead of a fabricated percentage.

Both encoders must finish before INSERT of a report row. An encoding error, size limit or
transaction failure leaves no published/downloadable report. The runtime role has SELECT
and INSERT only on snapshots and assessments, no UPDATE/DELETE/DDL/BYPASSRLS. New tables
have ENABLE/FORCE RLS; tenant composite keys protect assessment/report relationships.

For this bounded pilot, files are private PostgreSQL bytea values beside JSON evidence.
No filesystem paths or external storage credentials are exposed. Download access expires
after **7 days**. Physical bytes are retained until an authorized operator retention process
removes them; no deletion/scheduler was run or implemented here. Do not describe access
expiry as guaranteed physical deletion. Production needs managed storage/encryption,
scheduled retention, backups and durable background jobs.

Limits: 5,000 facts across current + comparison periods, 100 batches, 5,000 reconciliation
checks, 16 MiB per output, 60-second transaction timeout and 20-second SQL statement timeout.
Over-limit reports are rejected, never truncated into a misleading result. Synchronous
generation is intentional at this pilot ceiling. There is no durable job/progress queue,
cross-instance concurrency budget or production-volume performance claim.

## Excel

ExcelJS 4.4.0 writes editable XLSX with frozen headings, filters, alternating rows and
business-friendly sheets: Report, Monthly sales, Quantities, SKU rankings, Distributors,
Customers, Transactions, Source coverage and Reconciliation. Exact monetary/quantity
values are **text cells**, avoiding Excel's 15-digit numeric precision limit. No financial
values pass through JavaScript Number. Users can edit the workbook, but server evidence
remains immutable. Fixed values are used; there are no formulas, external data connections
or macros. Spreadsheet-like source strings receive a protective apostrophe and remain
text; signed numeric decimal text is preserved exactly.

Metadata includes organization, generated UTC, period/currency/unit, definition/metric
versions, source batches and template/rules identity. Whole-batch reconciliation/row counts
include comparison sources and possibly other currencies from the same source batch;
they are not falsely labelled as counts for only the current filtered facts.

## PowerPoint

PptxGenJS 4.0.1 creates native editable text and tables on a DUMPWISE cream/cocoa master:
cover/synthetic annotation, summary, separated quantities, monthly sales, top-8 SKU,
distributor and customer rankings, reconciliation/coverage. No screenshots, fabricated
recommendations or management claims are generated. Missing activity is explicit.

Monthly trends are editable tables, not native chart objects. The web preview is an exact
data preview, not a rendered slide preview. Full native chart generation and a rendered
PowerPoint review are remaining gates; do not claim visual Office compatibility solely
from ZIP/XML integrity checks. Font availability in the eventual Office environment also
needs validation.

Generated ZIP packages are checked for content types, size, macros, external links and
external relationships. Uploaded spreadsheet archives remain rejected unopened. API
dependencies use scoped patched UUID/image-size overrides; record actual audit results
in PHASE_5_RESULTS.md. Tests load only generated XLSX/PPTX, never untrusted archives.

## Learning milestones: snapshots, Excel and PowerPoint

Companies need one agreed set of facts before presenting a report. A snapshot freezes
evidence; a file is a presentation of it. XLSX and PPTX are ZIP containers of XML, but
valid XML does not prove a readable layout. Native editable tables preserve utility
without introducing approximate financial calculations.

Excel exercise: inspect a generated amount with more than 15 significant digits and
explain why its text-cell type protects it. Interview questions: Why can converting
Decimal to Number lose cents? Why neutralize source text even when output is not CSV?

PowerPoint exercise: edit a native sales-table cell and compare it with the original
snapshot, explaining why edits do not change server evidence. Interview questions:
Why should two export formats share one snapshot? What does an archive-integrity test
fail to prove about a presentation?
