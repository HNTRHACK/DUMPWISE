# Security — Phase 1

This document separates what is **implemented and tested** from what is **not done yet**.
Phase 1 is a local development foundation. It is **not** production-ready and must not
receive real company data.

## Implemented controls

### Secrets
- `.env` files are git-ignored (verified with `git check-ignore`). Only `.env.example` files containing placeholders are committable.
- Before Phase 1 sign-off, all 62 committable files were scanned for the actual secret values: 0 hits.
- Environment validation prints variable *names* and messages, never values.
- PostgreSQL stores passwords as `scram-sha-256`.

### Network exposure
- PostgreSQL publishes only `127.0.0.1:5433` (verified with `docker port`).
- The API binds to `HOST=127.0.0.1` (verified with `netstat`: `127.0.0.1:3001 LISTENING`).
- CORS is not enabled, so browsers on other origins cannot call the API.

### Database least privilege
- The API connects as `dumpwise_app`: not a superuser; SELECT, INSERT and UPDATE only; no DELETE, TRUNCATE or DDL; no access to migration history.
- `audit_events` is append-only for the runtime role (INSERT and SELECT only).
- The superuser `dumpwise` is used only by migrations and setup scripts.

### Tenant isolation
- Every query in services is filtered by the `organizationId` of a **verified** membership, never by an id taken from the request body. Unknown query parameters are rejected.
- Composite foreign keys make cross-organization links impossible at the database level.
- Non-members get the same 403 whether or not the organization exists.
- Tests prove: a member of A gets 403 for B; each organization sees only its own totals; the database rejects an A-transaction pointing at B's product.

### Authentication and authorization
- Protected endpoints go through `OrganizationAccessGuard`: authenticate (401), validate `X-Organization-Id` (400), check membership (403).
- **No fake authentication is exposed.** The only authenticator in the build (`DisabledAuthenticator`) rejects everyone. The header-based authenticator used by tests lives in `test/` and is excluded from the build.
- Role rules: VIEWER reads; ANALYST imports and reads; only OWNER publishes. Enforced in services, so the CLI obeys them too.

### Input and file handling
- Global `ValidationPipe` with `whitelist` and `forbidNonWhitelisted`. JSON body limit is 100 KB.
- Imports: byte limit checked **before** reading the file into memory, a row limit, and a 64 KB record limit.
- `.xlsx`, `.xlsm` and `.xls` files are detected by signature and **rejected without being opened**. No spreadsheet library is installed, so **macros can never execute**.
- Strict UTF-8 decoding (invalid bytes are an error, not silently replaced); files containing NUL bytes are rejected.
- Parameterized SQL only (Prisma query builder and tagged-template `$queryRaw`). No string-built SQL with user input. The role script escapes its password with `escapeLiteral` and validates the role name.
- Ambiguous amount, currency, quantity and date columns or values are rejected, never guessed.

### Data integrity and audit
- Imports run in one transaction; failed reconciliation rolls back every row.
- Existing data is never overwritten by a later import.
- Audit events: `IMPORT_COMPLETED`, `IMPORT_FAILED_VALIDATION`, `IMPORT_RECONCILIATION_FAILED`, `BATCH_PUBLISHED`, `PUBLISH_BLOCKED`.
- CHECK constraints enforce sign rules, currency format and S1 references.

### Data handling
- Only synthetic data exists in the repository, labelled in file names, content and metadata. Synthetic data can only enter `SYNTHETIC` organizations, and vice versa.
- No external AI services or telemetry. The scaffold's `@nestjs/observe` telemetry module (which would send data to an external service) and the `@nestjs/mau` cloud-deploy tooling were **removed**.
- `npm audit`: 0 known vulnerabilities at the end of Phase 1.

## Known limitations (honest list)

| # | Limitation | Risk | Planned fix |
|---|---|---|---|
| 1 | **No identity provider.** Nobody can authenticate, so the API has no real users yet. | Feature gap, not exposure | Phase 2: OIDC (e.g. Microsoft Entra ID, common at SAP customers) with JWT validation, implemented as a new `Authenticator` |
| 2 | Operator CLI trusts the `--actor` email. Anyone with the `.env` credentials can act as any user. | Medium if a machine is shared | Acceptable for local development only; replace with authenticated HTTP endpoints |
| 3 | No PostgreSQL Row-Level Security. Isolation relies on service code plus composite FKs. | A future query that forgets the filter could leak | Add RLS policies keyed on a per-transaction `app.organization_id` setting |
| 4 | No rate limiting and no security headers (helmet) | Abuse once exposed | Add `@nestjs/throttler` and `helmet` before any non-local deployment |
| 5 | No TLS (plain HTTP on localhost; DB connection without SSL) | Fine on localhost only | TLS termination and `sslmode=require` in any shared environment |
| 6 | No encryption at rest beyond the host disk; no backups of the Docker volume | Data loss or local theft | Managed PostgreSQL with encryption and backups |
| 7 | The migration role is the container superuser | Over-privileged migrations | A dedicated schema-owner role without superuser |
| 8 | Text values are stored as exported. If later exported to Excel or PowerPoint, values starting with `=`, `+`, `-` or `@` could be interpreted as formulas (CSV injection) | Future exports | Escape on export (Phase: presentations) |
| 9 | Issue lists are capped at 500 per batch | Truncated diagnostics | Store issues in a table with paging |
| 10 | Only billing types F2, G2, RE and S1 are supported; others are rejected | Real exports with L2 or S2 will fail validation | Extend the rule table with business sign-off |
| 11 | The Swagger UI is on by default in development | Information disclosure if exposed | Off in production by default (`NODE_ENV=production`) |

## Rules for contributors

1. Never commit `.env`, real SAP exports or customer data. Only `data/synthetic/` holds data.
2. Never send company data to external AI or telemetry services.
3. Every new query on business tables must filter by the verified `organizationId`.
4. Every new table gets `organization_id`, composite FKs, and runtime-role grants (`npm run db:roles`).
