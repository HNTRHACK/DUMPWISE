# Transaction lineage

OWNER/ANALYST may call `GET /v1/sales/transactions` or
`GET /v1/sales/transactions/:id`. VIEWER retains existing aggregate analytics access but
does not gain detailed source identifiers. Service membership checks supplement the guard;
RLS and explicit tenant joins supplement both. Foreign transaction IDs are not disclosed.

Required filters: `from`, `to` (inclusive YYYY-MM, 1–36 months) and one uppercase currency.
Optional: unit, productId, distributorId, customerId, batchId, transactionId. Literal search
accepts an explicit `dimension=products|distributors|customers`, matching the corresponding
analytics code/name filter. Unknown keys and invalid UUIDs are rejected. No raw user SQL
or user-provided identifiers are interpolated.

Pagination: limit 1–100 (default 20), offset 0–100000; direction asc/desc. Ordering is
billing date, document, item and UUID, all in the selected direction. This is deterministic
for a fixed fact set; concurrent publication can move offset pages. A generated report
snapshot provides a frozen set when reproducible pagination/export is required.

The response provides exact signed amount/quantity, currency/unit, document/item/date/type,
cancellation reference, SKU, sold-to and ship-to codes/UUIDs, batch UUID, source record
number, file name/SHA-256, immutable template UUID and financial rules version. Leading
zeros remain strings. Only PUBLISHED/PASSED batches contribute.

`summary` describes the **entire filtered subset**, independently of the returned page.
Money is summed as PostgreSQL numeric and returned as decimal text. Quantities are grouped
by sales unit. One SQL statement computes page, count and totals under one MVCC snapshot,
so another batch cannot appear between those parts of one response.

Drilldowns exist in Overview, Sales, all three intelligence pages and selected product
trends. Entity code selection also exposes a scoped distributor/customer drilldown.
Filters carry range, currency, unit and literal entity search; selected-entity drilldowns
carry its UUID. The UI shows full-subset totals and bounded source paging.

## Evidence boundaries

1. **Transaction lineage** identifies which normalized billing items contributed to a metric.
2. **Reconciliation** records comparisons against submitted independent controls; it is
   available through the linked batch and included in exports.
3. **Original file evidence** is unavailable. `sourceFileStatus=NOT_RETAINED` is explicit;
   a checksum is an identifier, not an original CSV or proof of chain of custody.

The inherited parser stores a logical CSV record ordinal (header is record 1), not a byte
offset or guaranteed physical text-line position when CSV cells contain line breaks.
Template/rules identity is available for new imports; old batches explicitly use legacy
aliases. No original mapping JSON or source file is fabricated for those older imports.
No new personal attributes, source files or external telemetry were added.

## Learning milestone: GROUP BY and pagination

Aggregation collapses rows into groups; lineage applies the same WHERE predicates before
returning individual rows. Keeping numeric SUM in PostgreSQL avoids binary floating-point
drift. A tie-breaker makes pagination deterministic. Tenant/date and entity indexes narrow
the relevant facts, but counting and summing the full subset still costs work even when
the response contains only 20 rows. Large offsets remain a known performance ceiling.

Exercise: page through a synthetic INR subset, sum all amounts with integer cents and
compare with `summary.netRevenue`; repeat separately for each unit's quantity.

Interview questions: Why is summing only the visible page an incorrect KPI? Why does stable
ordering alone not make multiple HTTP requests a single consistent database snapshot?
