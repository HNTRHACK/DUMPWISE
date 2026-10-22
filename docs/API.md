# API — Phase 1

Base URL (development): `http://127.0.0.1:3001`
Machine-readable spec: [openapi.json](openapi.json). Swagger UI is at `/docs` when
`NODE_ENV` is not `production`, or when `ENABLE_API_DOCS=true`.

Only implemented endpoints are listed. Imports and publication have no HTTP endpoints in
Phase 1; they run through the operator CLI (see README).

## Conventions

- JSON responses. Money and quantities are **decimal strings** (`"899.79"`), never floats.
- Months are `YYYY-MM`. Timestamps are ISO-8601 UTC.
- Query parameters are validated. Unknown parameters are rejected with 400.
- Every error has the same shape:

```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "message": "No access to this organization",
  "path": "/v1/sales/monthly",
  "timestamp": "2026-10-22T19:53:26.244Z"
}
```

Unexpected server errors return `500` with a generic message. Details are logged on the
server only.

## `GET /health`

Public. Reports service and database status.

```powershell
Invoke-RestMethod http://127.0.0.1:3001/health
```

`200 OK`
```json
{ "status": "ok", "service": "dumpwise-api", "timestamp": "2026-10-22T19:53:26.194Z", "checks": { "database": "up" } }
```

`503 Service Unavailable` with `"status": "error"` and `"database": "down"` when PostgreSQL is unreachable.

## `GET /v1/sales/monthly`

Protected and organization-scoped. Returns monthly net sales from **published** batches only.

| Input | Where | Rules |
|---|---|---|
| Credentials | (identity provider) | **Not available in Phase 1: every call returns 401** |
| `X-Organization-Id` | header | Required UUID; the caller must be a member (any role) |
| `from` | query | Optional `YYYY-MM`, inclusive |
| `to` | query | Optional `YYYY-MM`, inclusive; `from ≤ to`; at most 36 months when both are given |

`200 OK` (as produced in the e2e harness)
```json
{
  "organizationId": "4f5c…",
  "dataClassification": "SYNTHETIC",
  "months": [
    {
      "month": "2026-09",
      "currency": "INR",
      "totalNetSales": "899.79",
      "transactionCount": 5,
      "unitsSold": [{ "unit": "EA", "quantity": "9.000" }]
    }
  ]
}
```

Field meanings:
- `totalNetSales`: sum of signed net values. Invoices are added; credit memos, returns and cancellations are subtracted.
- `transactionCount`: number of billing **line items** (all billing types).
- `unitsSold`: signed quantity **per sales unit**. Different units are never added together.
- One entry per (month, currency). Currencies are never mixed or converted.
- `dataClassification`: `SYNTHETIC` means fictional demo data.

| Status | When |
|---|---|
| 400 | Missing or invalid `X-Organization-Id`, invalid month, `from > to`, unknown query parameter |
| 401 | Caller not authenticated (currently: always) |
| 403 | Caller is not a member of the organization, or the organization does not exist (same answer, so existence is not revealed) |
