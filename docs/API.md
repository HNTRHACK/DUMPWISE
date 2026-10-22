# API

Base URL (development): `http://127.0.0.1:3001`
Machine-readable spec: [openapi.json](openapi.json). Swagger UI is at `/docs` when
`NODE_ENV` is not `production` (or when `ENABLE_API_DOCS=true`).

## Conventions

- JSON responses. Money and quantities are **decimal strings** (`"899.79"`), never floats.
- Months are `YYYY-MM`. Timestamps are ISO-8601 UTC.
- Inputs are validated. Unknown body or query properties are rejected with 400.
- Every error has the same shape. `401` responses also carry `WWW-Authenticate: Bearer realm="dumpwise"`.

```json
{ "statusCode": 403, "error": "Forbidden", "message": "No access to this organization",
  "path": "/v1/sales/monthly", "timestamp": "2026-10-22T19:53:26.244Z" }
```

## Authentication

1. `POST /v1/auth/login` with e-mail and password → token pair.
2. Send `Authorization: Bearer <accessToken>` on every protected request.
3. The access token lives **15 minutes**. Before it expires, call `POST /v1/auth/refresh`. You get a **new** access token *and* a **new** refresh token, and the old ones stop working.
4. A session ends after **7 days** at the latest (`sessionExpiresAt`). Refreshing does not extend it, so log in again after that.

Tokens are opaque random strings (`dwa_…` access, `dwr_…` refresh). Treat them like
passwords: never log them, and never put them in URLs.

## Authorization

Organization-scoped endpoints need the header `X-Organization-Id: <uuid>`. The caller must
be a member of that organization:

| Role | Read data and batches | Upload imports | Publish batches |
|---|---|---|---|
| VIEWER | ✓ | | |
| ANALYST | ✓ | ✓ | |
| OWNER | ✓ | ✓ | ✓ |

Not a member, or the organization does not exist → **403** (the same answer for both). A
batch id belonging to another organization → **404**.

## Endpoints

### `GET /health` — public
`200 {"status":"ok","service":"dumpwise-api","timestamp":"…","checks":{"database":"up"}}`, or
`503` with `"database":"down"`.

### `POST /v1/auth/login` — public, rate-limited (10/min per IP)
Body `{"email": "...", "password": "..."}` → `200`:
```json
{ "tokenType": "Bearer", "accessToken": "dwa_…", "accessTokenExpiresAt": "…",
  "refreshToken": "dwr_…", "sessionExpiresAt": "…" }
```
Response carries `Cache-Control: no-store`. Any failure (unknown e-mail, wrong password,
locked or disabled account) → `401 "Invalid email or password"`. After 5 consecutive
failures the account is locked for 15 minutes. Too many requests → `429`.

### `POST /v1/auth/refresh` — public, rate-limited
Body `{"refreshToken": "dwr_…"}` → `200` with a new token pair. `401` if the token is unknown,
expired or revoked. **Reusing an already-rotated refresh token revokes the whole session**:
this is treated as token theft.

### `POST /v1/auth/logout` — bearer
`204`. The session is revoked immediately; its access and refresh tokens stop working.

### `POST /v1/auth/change-password` — bearer, rate-limited
Body `{"currentPassword": "...", "newPassword": "..."}` → `204`. The new password must be
12–128 characters, contain at least 5 different characters, and not contain the e-mail
name or common words. Every **other** session of the user is revoked. Wrong current
password → `403` (counts toward lockout).

### `GET /v1/auth/me` — bearer
`200 {"id","email","displayName","memberships":[{"organizationId","organizationName","organizationSlug","dataClassification","role"}]}`

### `POST /v1/imports` — bearer + org header, OWNER/ANALYST
`multipart/form-data` with parts:

| Part | Required | Content |
|---|---|---|
| `file` | yes | SAP billing CSV, UTF-8, at most `IMPORT_MAX_BYTES` (20 MiB) |
| `controlTotals` | yes | Control totals JSON, at most 1 MiB |
| `numberFormat` | no | `PLAIN` (default) or `EN_GROUPED` |

Runs the full pipeline (see ARCHITECTURE.md). Responses:
- `201` with header `Location: /v1/imports/<batchId>`: a new batch record exists. **Check `outcome`**: `IMPORTED`, `FAILED_VALIDATION` or `RECONCILIATION_FAILED`.
- `200` with `outcome: "ALREADY_IMPORTED"`: this exact file was imported before; nothing changed.
- `400`: missing parts, unexpected parts or fields, oversized upload, or invalid JSON.

Body: `{ outcome, batchId, status, stats{rowsTotal,rowsValid,rowsInvalid,rowsDuplicateInFile,rowsAlreadyImported,rowsInserted}, reconciliation[{metric,month,currency,unit,expected,actual,passed}], issues[{severity,code,message,line?,field?}] }`

### `GET /v1/imports?limit=20&offset=0` — bearer + org header, any role
`200 { items: [batch summary], total, limit, offset }`, newest first. `limit` ≤ 100.

### `GET /v1/imports/{batchId}` — bearer + org header, any role
`200`: the batch summary plus `issues` (≤ 500) and all `reconciliation` checks. `404` if the
batch is not in this organization.

### `POST /v1/imports/{batchId}/publish` — bearer + org header, OWNER
`200`: batch summary with `status: "PUBLISHED"`. `409 "Publication blocked: …"` unless
reconciliation passed. `404` if the batch is not in this organization.

### `GET /v1/sales/monthly?from=YYYY-MM&to=YYYY-MM` — bearer + org header, any role
Monthly net sales from **published** batches only:
```json
{ "organizationId": "…", "dataClassification": "SYNTHETIC",
  "months": [ { "month": "2026-09", "currency": "INR", "totalNetSales": "899.79",
                "transactionCount": 5, "unitsSold": [{ "unit": "EA", "quantity": "9.000" }] } ] }
```
- Invoices add; credit memos, returns and cancellations subtract.
- `transactionCount` counts billing line items.
- Units are reported per sales unit and never added across units. Currencies are never mixed or converted.
- `from ≤ to`; at most 36 months when both are given.
