# API Integration Matrix

Source of truth: `apps/api` source and `docs/openapi.json` (v0.2.0, 11 operations) on branch
`feat/security-hardening` at `ef5c6d8`, plus the uncommitted Phase 2B work present on
2026-10-23. Frontend schemas are checked against OpenAPI by `apps/web/test/unit/contract.test.ts`.

## Implemented and used

| Backend operation | BFF route (browser calls) | UI | Roles (enforced by API) | Errors handled |
|---|---|---|---|---|
| `POST /v1/auth/login` | `POST /api/auth/login` (sets HttpOnly cookies; returns no token) | Login | public | 400, 401 generic, 429, 503/504 |
| `POST /v1/auth/refresh` | internal only (single-flight) | transparent | public | 401 → signed out |
| `POST /v1/auth/logout` | `POST /api/auth/logout` | User menu, Settings | any | 401 (already revoked = success), 502/503 "unconfirmed" |
| `GET /v1/auth/me` | `GET /api/auth/session`, `GET /api/v1/auth/me` | Workspace boot, Settings | any | 401 |
| `POST /v1/auth/change-password` | `POST /api/v1/auth/change-password` | Settings | any | 400 policy, 403 wrong current, 429 |
| `GET /v1/sales/monthly?from&to` | `GET /api/v1/sales/monthly` | Overview, Sales | member | 400, 403 |
| `GET /v1/imports?limit&offset` | `GET /api/v1/imports` | Imports, Overview | member | 403 |
| `POST /v1/imports` (multipart) | `POST /api/v1/imports` | Import center | OWNER, ANALYST | 400, 403, 413 (BFF), timeout |
| `GET /v1/imports/{id}` | `GET /api/v1/imports/{id}` | Batch detail | member | 403, 404 |
| `POST /v1/imports/{id}/publish` | `POST /api/v1/imports/{id}/publish` | Batch detail (confirm dialog) | OWNER | 403, 404, 409 blocked |
| `GET /health` | not exposed | — | — | — |

Contract notes:
- Organization scoping uses the `X-Organization-Id` header. The BFF validates it as a UUID before going upstream; the API checks membership.
- Pagination is offset-based (`limit` ≤ 100, `offset` ≤ 10000; response has `total`). The UI uses 20 per page.
- Money and quantities are decimal strings and are never converted to floats for display.
- Imports: `201` new batch (check `outcome`), `200` `ALREADY_IMPORTED`. Never retried automatically.

## Gaps (no backend endpoint; UI shows "Coming next", no numbers)

Proposed contracts (not implemented; for backend planning only). Same rules as monthly
sales: published batches only, organization-scoped, one currency per request, decimal strings.

| Need | Proposed endpoint | Response |
|---|---|---|
| SKU analysis | `GET /v1/sales/by-product?from&to&currency&limit&offset` | `{ organizationId, currency, from, to, total, limit, offset, items: [{ sku, description, netSales, transactionCount, unitsSold[] }] }` |
| Distributor analysis | `GET /v1/sales/by-distributor?…` | same shape, `code`, `name` |
| Customer analysis | `GET /v1/sales/by-customer?…` | same shape, `code`, `name` |
| Session management | `GET /v1/auth/sessions`, `DELETE /v1/auth/sessions/{id}`, `POST /v1/auth/sessions/revoke-others` | `[{ id, createdAt, lastSeenAt, expiresAt, userAgent, current }]`. The backend already stores this metadata (Phase 2B) |
| Contact/pilot enquiry | e.g. `POST /v1/enquiries` | not designed; Contact page collects nothing until it exists |
| Self-service password reset | e-mail flow | needs an e-mail provider (external account) |

## Configuration required for correct integration

| Setting | Where | Why |
|---|---|---|
| `DUMPWISE_API_URL` | web | API base URL (default `http://127.0.0.1:3001`) |
| `TRUST_PROXY` | **API** | Keep unset (`false`) while Next.js is the edge. Only behind a header-overwriting reverse proxy, together with web `DUMPWISE_TRUST_PROXY_HEADER=true` (see PHASE_3_5_INTEGRATION.md) |

## Phase 4 implemented contract (supersedes earlier proposals)

Products, distributors and customers now call GET /v1/analytics/products, /v1/analytics/distributors and /v1/analytics/customers via allowlisted BFF routes. Product drilldown calls GET /v1/analytics/products/:id/trend. Exact query/response fields are in API.md and generated openapi.json. Cost/profit/freight/retention metrics remain unsupported and are not shown. Earlier placeholder DTO proposals are historical, not the current contract.

## Phase 5 pilot additions

Import templates/approval/preview, scoped transaction lineage, report generation/preview/private downloads and entered pilot assessment/history are connected through the existing BFF. Source-detail operations require OWNER/ANALYST; template approval requires OWNER. The generic report center uses real APIs; no production fixture results are embedded. See REPORT_TEMPLATE_SPEC.md, DATA_LINEAGE.md, REPORT_EXPORTS.md and PHASE_5_RESULTS.md for boundaries and actual verification. Native slide preview/charts, custom company report layouts, durable large jobs and physical retention cleanup remain gaps.
