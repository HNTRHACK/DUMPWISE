# Configurable SAP import templates

## Contract and governance

`/v1/import-templates` is organization-scoped. OWNER/ANALYST may create/list/read/preview;
only OWNER may approve. VIEWER summary-report access is unchanged. The API rechecks actual
membership in services; every query also uses transaction-local tenant context and RLS.

POST a name (1–120 characters), description (up to 1000), positive version (up to 1 million)
and strict declarative `mapping`. A name/version is unique within an organization.
Each row is immutable from creation. To correct even a draft, create another version.
Approval is explicit; the review UI shows every column interpretation. The database
allows only DRAFT → APPROVED and forbids changing the mapping, name or version.

Mapping contains **only** these keys:

| Key | Allowed values / rules |
|---|---|
| columns | 1–14 `{ field, header }` entries; unique canonical fields and normalized headers; exact matches only |
| dateFormat | YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY or MM/DD/YYYY, explicitly selected |
| numberFormat | PLAIN or EN_GROUPED; unsigned source values; maximum 2 amount / 3 quantity decimals |
| documentTypes | 1–20 source-code → F2/G2/RE/S1 mappings; source codes uppercase alphanumeric, 1–8 characters |

Required canonical fields: billingDate, billingDocument, billingItem, billingType,
distributorCode (sold-to), sku, customerCode (ship-to), quantity, salesUnit, netAmount,
currency. Optional: distributorName, productDescription, cancelledDocument. S1 still
requires a cancellation reference. Currency/unit are explicit source values, normalized
uppercase; no defaults, FX conversion or unit conversion. Identifiers stay strings;
existing SAP ALPHA padding and source precision rules remain authoritative.

Example selected columns: `{ "field": "netAmount", "header": "SYN Net Revenue" }` and
`{ "field": "currency", "header": "Document Currency" }`. This deliberately resolves
source meaning; it does not prove that a company's `Amount` column is net revenue.
Independent source controls and the owner's financial review are still required.

Known SAP F2/G2/RE/S1 meanings cannot be redefined. A reviewed custom source alias may map
to one of those four existing meanings; unknown source codes are rejected. A genuinely
new canonical document type needs a separately reviewed code/database/rules change.
No JavaScript, SQL, Python, expressions, arbitrary defaults or sign overrides are accepted.

## Preview and import

- `POST /v1/import-templates/:id/preview`: bounded multipart `file` CSV; drafts may be
  previewed. Returns mapping explanation, accepted/rejected/duplicate counts, at most
  10 normalized samples, 500 issues and an explicit truncation flag. No batches, masters,
  facts, files or audit entries are written by preview. Auth/HTTP limit records still
  follow the normal security lifecycle.
- Preview is **NOT reconciliation**. It cannot attest to independent controls or existing
  database duplicates. `reconciliationStatus` is always NOT_RUN.
- Existing `POST /v1/imports` accepts optional `templateVersionId`. It must be approved
  in the caller's organization. Omit `numberFormat` when selecting a template; overrides
  are rejected. The standard fixed-alias mode and operator CLI continue to work unchanged.
- The Imports UI requires a successful preview of the same selected File/version before
  a configurable import. Changing either invalidates the preview. Its creation form
  offers fixed F2/G2/RE/S1 mappings; custom aliases/descriptive optional columns are
  currently available through the authenticated API.

The existing parser/sign/de-duplication/reconciliation/publication pipeline is reused.
G2 remains negative value and zero quantity; RE/S1 remain negative value and quantity.
Controls must reconcile exactly before an OWNER can publish. API imports retain the
existing reconciled partial-acceptance behavior; the new UI takes the stricter path of
requiring a preview without rejected rows.

Batches record `templateVersionId` and `sap-billing-signs-v1`. Legacy batches have a null
template reference and the same historical fixed-rule version. Composite foreign keys
prevent foreign-organization references; batch provenance cannot be reassigned.
Re-uploading an already successful file returns its original batch and mapping identity,
even if a newer template exists. It never reinterprets published facts.

Safe CSV size/encoding/record limits and spreadsheet-signature rejection remain in force.
Unmapped columns do not acquire financial meaning. If a selected source header appears
twice after normalization, the file is rejected rather than choosing a column.

The pilot UI loads the first 100 template versions; lifecycle retirement and large
template-catalog browsing are not implemented. API lists are bounded and paginated.

## Learning milestone: immutable ETL

The browser submits declarative data through the existing CSRF-protected BFF. Nest validates
the DTO/mapping, PostgreSQL stores a tenant-owned immutable version, and the import pipeline
uses that exact version to normalize bytes before reconciliation. This makes column
interpretation reproducible without permitting executable user code.

Exercise: create two synthetic mapping versions with different explicit slash-date orders;
preview `03/05/2026` and explain why neither may silently replace the other historically.

Interview questions: Why does preview not replace reconciliation? Why enforce immutability
with a database trigger as well as omitting an edit endpoint?
