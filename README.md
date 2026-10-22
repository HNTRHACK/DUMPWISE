# DUMPWISE

Enterprise sales and logistics intelligence for Indian manufacturing and distribution
companies that run SAP.

> **Status: Phase 1 (backend foundation).** This repository currently contains a secured
> NestJS API, a PostgreSQL schema, a deterministic SAP billing CSV import pipeline with
> reconciliation, and one protected analytics endpoint. All data in the repository is
> **synthetic**. There is no frontend, no live SAP integration and no forecasting yet.

## What exists today

| Area | Phase 1 implementation |
|---|---|
| API | NestJS 12 + TypeScript on `http://127.0.0.1:3001` |
| Endpoints | `GET /health`, `GET /v1/sales/monthly` (protected) |
| Database | PostgreSQL 17 in Docker (localhost only), Prisma 7 ORM, 1 migration |
| Import | CSV → header recognition → type conversion → validation → duplicate detection → DB import → monthly aggregation → reconciliation → publication |
| Data | 12 months of synthetic SAP billing data (`data/synthetic/`) with independent control totals |
| Tests | 23 unit tests + 21 database-backed end-to-end tests |

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

## Daily commands (run in `apps\api`)

```powershell
docker compose -f ..\..\compose.yaml up -d    # make sure PostgreSQL is running
npm run start:dev                             # API with auto-reload on http://127.0.0.1:3001
Invoke-RestMethod http://127.0.0.1:3001/health
Start-Process http://127.0.0.1:3001/docs      # Swagger UI (development only)

npm run verify          # lint + typecheck + build + unit tests + e2e tests
npm test                # unit tests only (no database)
npm run test:e2e        # database tests (uses the separate dumpwise_test database)
npm run db:migrate:dev  # after editing prisma/schema.prisma: create + apply a migration
npm run openapi:export  # regenerate docs/openapi.json (after npm run build)
```

`GET /v1/sales/monthly` answers **401 to every caller** in Phase 1 because no identity
provider is integrated yet. This is intentional; see [docs/SECURITY.md](docs/SECURITY.md).

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
- [docs/LEARNING_GUIDE.md](docs/LEARNING_GUIDE.md) — concepts, exercises and interview questions per step
