# Security

This document separates what is **implemented and tested** from what is **not done yet**.
The system is a local development build (Phase 2a: authentication + protected APIs). It is
**not** production-ready and must not receive real company data.

## Implemented controls

### Secrets
- `.env` files are git-ignored (verified with `git check-ignore`). Only `.env.example` files containing placeholders are committable.
- Secret scans of all committable files found 0 secret values (Phase 1: 62 files; Phase 2a: 83 files, also checked for token-like strings).
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

### Authentication (Phase 2a)
- **Passwords** are hashed with scrypt (N=2¹⁶, r=8, p=2, 16-byte random salt, NFKC normalization, constant-time comparison). Parameters are stored with the hash, and outdated hashes are upgraded on the next login. Tampered parameters are refused, which prevents memory bombs.
- **Password policy** (NIST SP 800-63B style): 12–128 characters, at least 5 distinct characters, no common words, no e-mail name. No composition rules.
- **Tokens** are opaque 256-bit random values (`dwa_` access, `dwr_` refresh). Only their SHA-256 hashes are stored, so a database leak yields no usable tokens. Access tokens live 15 minutes; sessions end after at most 7 days.
- **Refresh rotation with reuse detection**: each refresh issues a new pair. Replaying a rotated refresh token revokes the whole session and writes `TOKEN_REUSE_DETECTED` to the audit log.
- **Revocation is immediate**: every request checks the session in the database. Logout, a password change (revokes other sessions), an operator reset (revokes all) and disabling a user all take effect on the next request.
- **No account enumeration**: every login failure returns the same message, and unknown e-mails spend the same hashing time (dummy verify).
- **Brute-force protection**: per-account lockout (5 consecutive failures → 15 minutes) plus per-IP rate limits (10/min on login, refresh and change-password; 300/min elsewhere; `429` when exceeded). Wrong current passwords on change-password count toward the lockout.
- Token responses carry `Cache-Control: no-store`. Tokens travel in the `Authorization` header (not cookies), so classic CSRF does not apply. `401` responses carry `WWW-Authenticate: Bearer`.
- Security events (`LOGIN_SUCCEEDED`, `LOGIN_FAILED`, `ACCOUNT_LOCKED`, `LOGOUT`, `PASSWORD_CHANGED`, `TOKEN_REUSE_DETECTED`) are audited with `organization_id = NULL`. Failed logins store only a truncated SHA-256 of the attempted e-mail, never the raw input, which might be a mistyped password.
- No test-only authentication shortcut exists anymore: the e2e tests log in through the real `/v1/auth/login`.

### Authorization
- Protected organization endpoints go through `OrganizationAccessGuard`: authenticate (401), validate `X-Organization-Id` (400), check membership and `@RequireRoles` (403).
- Role rules: VIEWER reads; ANALYST imports and reads; only OWNER publishes. They are enforced in the guard **and** again in the services, so the CLI obeys them too.
- Batch reads filter by id **and** organization: another organization's batch id gives 404.

### HTTP hardening
- `helmet` security headers: CSP `default-src 'self'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, a strict referrer policy and more. HSTS and `upgrade-insecure-requests` are enabled only when `NODE_ENV=production`, because they would break plain-HTTP localhost.
- Upload limits are enforced while the request streams in (multer): file size ≤ `IMPORT_MAX_BYTES`, at most 2 files, 2 fields and 4 parts. Unexpected parts are rejected. Control totals ≤ 1 MiB.

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
- Audit events: `IMPORT_COMPLETED`, `IMPORT_FAILED_VALIDATION`, `IMPORT_RECONCILIATION_FAILED`, `BATCH_PUBLISHED`, `PUBLISH_BLOCKED`, plus the security events listed under Authentication.
- CHECK constraints enforce sign rules, currency format and S1 references.

### Data handling
- Only synthetic data exists in the repository, labelled in file names, content and metadata. Synthetic data can only enter `SYNTHETIC` organizations, and vice versa.
- No external AI services or telemetry. The scaffold's `@nestjs/observe` telemetry module (which would send data to an external service) and the `@nestjs/mau` cloud-deploy tooling were **removed**.
- `npm audit`: 0 known vulnerabilities (Phase 1 and Phase 2a).

## Known limitations (honest list)

| # | Limitation | Risk | Planned fix |
|---|---|---|---|
| 1 | Local accounts only: no SSO/OIDC and no multi-factor authentication | Weaker than enterprise SSO; no MFA | Add an OIDC `Authenticator` (e.g. Microsoft Entra ID) and/or TOTP MFA (needs an external account/approval) |
| 2 | Operator CLI trusts the `--actor` email. Anyone with the `.env` credentials can act as any user. All operations are now also available over authenticated HTTP. | Medium if a machine is shared | Restrict CLI to bootstrap tasks (create-user, reset-password) |
| 3 | No PostgreSQL Row-Level Security. Isolation relies on service code plus composite FKs (both tested). | A future query that forgets the filter could leak | Add RLS policies keyed on a per-transaction `app.organization_id` setting |
| 4 | Rate limits are in memory and per IP: they reset on restart, are not shared across instances, and need `trust proxy` behind a reverse proxy (otherwise every client looks like the proxy) | Weaker limits in a multi-instance deployment | Redis-backed throttler storage; configure trusted proxies |
| 4b | Account lockout can be triggered by anyone who knows an e-mail address (denial of service for that user) | Annoyance, not data exposure | Consider progressive delays or CAPTCHA instead of hard lockout |
| 4c | No password blocklist beyond a few words; no breached-password check | Weak passwords possible within the policy | Add a larger blocklist; an offline k-anonymity breach check needs approval (external service) |
| 4d | Expired and revoked sessions are never purged (the runtime role cannot DELETE) | Table growth | Scheduled cleanup job using the admin role |
| 4e | No self-service password reset by e-mail | Operators must reset passwords via CLI | Needs an e-mail provider (external account) |
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
