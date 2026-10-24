# DUMPWISE

Enterprise sales and logistics intelligence for Indian manufacturing and distribution
companies that run SAP.

> **Status: Phase 3 (web frontend) on branch `feat/security-hardening`, uncommitted.**
> `apps/api`: NestJS API with revocable sessions, organization roles, PostgreSQL row-level
> security, CSV import with reconciliation, and monthly sales. `apps/web`: Next.js 16 marketing
> site with a 3D hero, and an authenticated workspace (overview, sales, imports, settings)
> connected to the real API through a secure same-origin BFF. All data in the repository is
> **synthetic**. No live SAP integration and no forecasting yet.

## What exists today

| Area | Phase 1 implementation |
|---|---|
| API | NestJS 12 + TypeScript on `http://127.0.0.1:3001` |
| Auth | E-mail + password (scrypt), opaque bearer tokens, refresh rotation with reuse detection, lockout, rate limits |
| Endpoints | `/health`, `/v1/auth/*` (login, refresh, logout, me, change-password), `/v1/imports` (upload, list, detail, publish), `/v1/sales/monthly` |
| Authorization | Membership per organization with roles OWNER / ANALYST / VIEWER |
| Database | PostgreSQL 17 in Docker (localhost only), Prisma 7 ORM, 2 migrations |
| Import | CSV → header recognition → type conversion → validation → duplicate detection → DB import → monthly aggregation → reconciliation → publication |
| Data | 12 months of synthetic SAP billing data (`data/synthetic/`) with independent control totals |
| Tests | 34 unit tests + 46 database-backed end-to-end tests |

## Prerequisites

- Windows 11 with Docker Desktop (WSL2 backend)
- Node.js 22.18+ (developed on 24.13), npm 11
- Python 3.12 (only needed to regenerate synthetic data)

## First-time setup (Windows PowerShell)

```powershell
# 1. Go to the repository
Set-Location C:\Users\HARDIK\Documents\Projects\DUMPWISE

# 2. Database password for Docker (skip if .env already exists)
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"   # paste as POSTGRES_PASSWORD in .env
notepad .env

# 3. Start PostgreSQL (bound to 127.0.0.1:5433 only) and wait for "healthy"
docker compose up -d
docker compose ps

# 4. Install API dependencies (also generates the Prisma client)
Set-Location apps\api
npm install

# 5. API environment: fill every <...> placeholder
#    APP_DB_PASSWORD: a NEW random value (same command as step 2)
#    POSTGRES_PASSWORD: the value from the root .env
Copy-Item .env.example .env
notepad .env

# 6. Apply migrations and create the restricted runtime role
npm run db:migrate

# 7. Build, then load the synthetic demo data
npm run build
npm run cli -- seed-synthetic
npm run cli -- import --org synthetic-demo --actor demo.analyst@example.invalid `
  --file ..\..\data\synthetic\SYNTHETIC_sap_billing_2025-10_to_2026-09.csv `
  --control-totals ..\..\data\synthetic\SYNTHETIC_sap_billing_2025-10_to_2026-09.control_totals.json
# copy "batchId" from the output, then publish it as the OWNER:
npm run cli -- publish --org synthetic-demo --actor demo.owner@example.invalid --batch <batchId>

# 8. Look at the published monthly figures (operator CLI, same authorization rules as the API)
npm run cli -- monthly --org synthetic-demo --actor demo.analyst@example.invalid --from 2026-01 --to 2026-09
```

## Using the HTTP API (Windows PowerShell)

Users have no password until an operator sets one. There is no public sign-up.

```powershell
# In apps\api: give the demo owner a temporary password (printed ONCE)
npm run cli -- reset-password --email demo.owner@example.invalid

# Start the API in another terminal: npm run start:dev
$base = 'http://127.0.0.1:3001'
$login = Invoke-RestMethod -Method Post "$base/v1/auth/login" -ContentType 'application/json' `
  -Body (@{ email = 'demo.owner@example.invalid'; password = Read-Host 'Password' } | ConvertTo-Json)
$h = @{ Authorization = "Bearer $($login.accessToken)" }

# Who am I, and which organizations can I use?
$me = Invoke-RestMethod "$base/v1/auth/me" -Headers $h
$h['X-Organization-Id'] = $me.memberships[0].organizationId

# Upload an import (curl.exe ships with Windows; use it for multipart uploads)
curl.exe -s -X POST "$base/v1/imports" -H "Authorization: Bearer $($login.accessToken)" `
  -H "X-Organization-Id: $($h['X-Organization-Id'])" `
  -F "file=@..\..\data\synthetic\SYNTHETIC_sap_billing_2025-10_to_2026-09.csv;type=text/csv" `
  -F "controlTotals=@..\..\data\synthetic\SYNTHETIC_sap_billing_2025-10_to_2026-09.control_totals.json;type=application/json"

Invoke-RestMethod "$base/v1/imports" -Headers $h                                   # list batches
Invoke-RestMethod -Method Post "$base/v1/imports/<batchId>/publish" -Headers $h    # OWNER only
Invoke-RestMethod "$base/v1/sales/monthly?from=2026-01&to=2026-09" -Headers $h

# Change the temporary password, then log out
Invoke-RestMethod -Method Post "$base/v1/auth/change-password" -Headers $h -ContentType 'application/json' `
  -Body (@{ currentPassword = Read-Host 'Current'; newPassword = Read-Host 'New (12+ chars)' } | ConvertTo-Json)
Invoke-RestMethod -Method Post "$base/v1/auth/logout" -Headers $h
```

Other operator commands: `create-user --email --name`, `add-member --org --email --role OWNER|ANALYST|VIEWER`.

## Web app: install and run API + web together (Windows PowerShell)

Requires the API setup above (database migrated, a user with a password via
`npm run cli -- reset-password --email demo.owner@example.invalid`).

```powershell
# One-time: install the web app
Set-Location C:\Users\HARDIK\Documents\Projects\DUMPWISE\apps\web
npm install

# Leave TRUST_PROXY unset (= false) on the API for local development. Enabling it while
# Next.js is the edge would let browsers fake their IP (docs/PHASE_3_5_INTEGRATION.md).

# Terminal 1: PostgreSQL + API on http://127.0.0.1:3001
Set-Location C:\Users\HARDIK\Documents\Projects\DUMPWISE
docker compose up -d
Set-Location apps\api
npm run start:dev

# Terminal 2: web app on http://localhost:3000 (bound to 127.0.0.1)
Set-Location C:\Users\HARDIK\Documents\Projects\DUMPWISE\apps\web
npm run dev          # optional: $env:DUMPWISE_API_URL="http://127.0.0.1:3001" (the default)
```

| URL | What |
|---|---|
| http://localhost:3000 | Marketing site (3D hero; `?tier=static` forces the SVG version) |
| http://localhost:3000/login | Sign in |
| http://localhost:3000/app | Workspace (overview, sales, imports, settings) |
| http://127.0.0.1:3001/docs | API Swagger UI (development) |

Web checks (run in `apps\web`; Playwright uses a mock API with synthetic data, never PostgreSQL):

```powershell
npx playwright install chromium   # one-time browser download
npm run verify                    # lint, typecheck, 62 unit tests, production build, 34 browser tests
```

## Daily commands (run in `apps\api`)

```powershell
docker compose -f ..\..\compose.yaml up -d    # make sure PostgreSQL is running
npm run start:dev                             # API with auto-reload on http://127.0.0.1:3001
Invoke-RestMethod http://127.0.0.1:3001/health
Start-Process http://127.0.0.1:3001/docs      # Swagger UI (development only)

npm run verify          # lint + typecheck + build + unit tests + e2e tests
npm test                # unit tests only (no database)
npm run test:e2e        # database tests (creates a new disposable database and roles; no resets)
npm run db:migrate:dev  # after editing prisma/schema.prisma: create + apply a migration
npm run openapi:export  # regenerate docs/openapi.json (after npm run build)
```

All `/v1/*` endpoints except login and refresh require `Authorization: Bearer <accessToken>`.
Organization-scoped endpoints also need `X-Organization-Id`. See [docs/API.md](docs/API.md).

## Repository layout

```
compose.yaml                 PostgreSQL 17 (127.0.0.1:5433)
apps/api/                    NestJS API
  prisma/schema.prisma       data model  ·  prisma/migrations/  SQL migrations
  scripts/setup-db-roles.ts  creates the least-privilege runtime DB role
  src/imports/               import pipeline (parsing/ = pure functions)
  src/sales/                 GET /v1/sales/monthly
  src/auth/                  authentication interface + organization authorization
  src/cli/dumpwise.ts        operator CLI (seed, import, publish, monthly, openapi)
  test/                      e2e tests + test-only authenticator
apps/web/                    Next.js 16 frontend
  src/app/(marketing)/       /, /product, /security, /contact
  src/app/(auth)/login/      sign-in
  src/app/(workspace)/app/   authenticated workspace pages
  src/app/api/               BFF: login/logout/session + allowlisted /api/v1/* proxy
  src/lib/                   api client + schemas, auth (CSRF, single-flight), analytics
  src/components/            ui, dashboard, charts, marketing, three (3D Data Core)
  test/unit/ test/e2e/       Vitest + Playwright (mock API with synthetic data)
data/synthetic/              SYNTHETIC demo data only
tools/synthetic-data/        Python generator for the synthetic data
docs/                        architecture, schema, security, API, results, learning guide
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, pipeline stages and business rules
- [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) — tables, keys, constraints, DB roles
- [docs/SECURITY.md](docs/SECURITY.md) — controls and honest limitations
- [docs/API.md](docs/API.md) — endpoints ([docs/openapi.json](docs/openapi.json))
- [docs/PHASE_1_RESULTS.md](docs/PHASE_1_RESULTS.md) — what was built and verified
- [docs/PHASE_2A_AUTH_RESULTS.md](docs/PHASE_2A_AUTH_RESULTS.md) — authentication + protected APIs, verified results
- [docs/FRONTEND_ARCHITECTURE.md](docs/FRONTEND_ARCHITECTURE.md) — web app routes, BFF auth, data layer, 3D
- [docs/FRONTEND_DESIGN_SYSTEM.md](docs/FRONTEND_DESIGN_SYSTEM.md) — tokens, measured contrast, typography, motion
- [docs/API_INTEGRATION_MATRIX.md](docs/API_INTEGRATION_MATRIX.md) — endpoint ↔ UI mapping and backend gaps
- [docs/PHASE_3_RESULTS.md](docs/PHASE_3_RESULTS.md) — frontend phase results
- [docs/LEARNING_GUIDE.md](docs/LEARNING_GUIDE.md) — concepts, exercises and interview questions per step
