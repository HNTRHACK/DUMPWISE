# Security

This document separates what is **implemented and tested** from what is **not done yet**.
The system is a local development build (Phase 2B security hardening in progress). It is
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
- **Brute-force protection**: persistent failure buckets block an account/IP pair after 5 failures for 15 minutes, and an IP after 30 failures across accounts for 1 hour. After 20 failures across sources in 1 hour, the account accepts only previously successful sources. Known sources still need the correct password and are subject to pair/IP blocks. Defaults are configurable with LOGIN_* settings. HTTP request throttles remain in place. Password-change current-password failures retain a separate 5-attempt, 15-minute lockout.
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
- Uploaded `.xlsx`, `.xlsm` and `.xls` files are detected by signature and **rejected without being opened**. Phase 5 libraries generate Office files only; the application never parses uploaded spreadsheet archives or executes macros.
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
| 3 | RLS tenant context is set by trusted application code | Stolen runtime SQL credentials can set a different tenant context | RLS supplements service authorization; it does not protect against arbitrary SQL execution |
| 4 | Persistent rate buckets require operator cleanup scheduling | Growth if cleanup is not run; database round trips per limit | Run auth:cleanup regularly; configure TRUST_PROXY only for known proxy paths |
| 4b | Distributed attacks restrict login to known sources; shared/NAT IPs share limits | New legitimate devices can be temporarily denied, and known-source networks are not device identity | Tune LOGIN_* limits; use correct trusted-proxy configuration |
| 4c | No password blocklist beyond a few words; no breached-password check | Weak passwords possible within the policy | Add a larger blocklist; an offline k-anonymity breach check needs approval (external service) |
| 4d | Session cleanup is an operator command; no scheduler is installed | Growth if operators do not schedule cleanup | Run npm run auth:cleanup daily, repeating bounded batches as needed |
| 4e | No self-service password reset by e-mail | Operators must reset passwords via CLI | Needs an e-mail provider (external account) |
| 5 | No TLS (plain HTTP on localhost; DB connection without SSL) | Fine on localhost only | TLS termination and `sslmode=require` in any shared environment |
| 6 | No encryption at rest beyond the host disk; no backups of the Docker volume | Data loss or local theft | Managed PostgreSQL with encryption and backups |
| 7 | The migration role is the container superuser | Over-privileged migrations | A dedicated schema-owner role without superuser |
| 8 | Raw source text remains stored as exported; any future export format must maintain injection protection | New formats could reintroduce spreadsheet injection | Phase 5 XLSX uses explicit text cells and protective escaping; generated archives reject formulas/external connections/macros. No CSV export exists. |
| 9 | Issue lists are capped at 500 per batch | Truncated diagnostics | Store issues in a table with paging |
| 10 | Only billing types F2, G2, RE and S1 are supported; others are rejected | Real exports with L2 or S2 will fail validation | Extend the rule table with business sign-off |
| 11 | The Swagger UI is on by default in development | Information disclosure if exposed | Off in production by default (`NODE_ENV=production`) |

## Rules for contributors

1. Never commit `.env`, real SAP exports or customer data. Only `data/synthetic/` holds data.
2. Never send company data to external AI or telemetry services.
3. Every new query on business tables must filter by the verified `organizationId`.
4. Every new table gets `organization_id`, composite FKs, and runtime-role grants (`npm run db:roles`).

## Phase 2B database architecture and verification

Prisma 7 runtime connections use PrismaPg and DATABASE_URL. Migrations use MIGRATION_DATABASE_URL separately. TenantDb uses an interactive transaction and parameterized set_config(..., true), so context is local to that transaction. Service filters and composite foreign keys remain in place.

RLS is ENABLED and FORCED on six financial/master tables plus organizations, memberships and audit_events. Missing context hides business rows and rejects inserts. UPDATE has both visibility and new-row checks. DELETE is denied altogether by runtime grants; tests do not grant DELETE just to exercise a policy. Organizations/memberships are read-only for the API; audit events are append-only. Global authentication and rate-limit tables are intentionally outside tenant RLS.

The setup script uses an explicit table allowlist, distinct role names and an atomic permissions transaction. The runtime role is NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE. The operator provisioner has BYPASSRLS for identity administration but no financial-table privileges. The CLI opens that connection only for provisioning commands; financial commands still use runtime services and verified membership. The migration connection still uses the local superuser (limitation 7 remains).

AppModule now uses PostgreSQL throttler storage. TRUST_PROXY defaults to false; configuring true trusts every proxy and is unsuitable when untrusted clients can directly reach the API. Use a trusted address list appropriate to the deployment. Database failures fail requests rather than silently disabling throttling.

Tests run via npm run test:e2e, which builds the CLI, creates a new dumpwise_verify_<random>_test database and unique roles, deploys migrations there, and runs the real app with restricted credentials. No existing database is reset, truncated or reused. Databases and roles are retained for inspection; cleanup requires separate authorization. Fixture creation and independent stored-data assertions use a separately guarded test admin client, never injected into the app. Actual RLS queries and pooling tests use the restricted role.

Coverage includes missing-context SELECT/INSERT/UPDATE, cross-tenant SELECT/INSERT/UPDATE and tenant reassignment, DELETE permission denial, commit/rollback context cleanup through a one-connection Prisma pool, concurrent tenant calls, runtime role flags, all nine RLS table flags, forbidden runtime identity writes, provisioner financial denial, shared concurrent rate counters, HTTP 429 and CLI provisioning. CRUD adversarial tests use products as a representative business table; all financial workflows are exercised by the existing pipeline/API suite. This is not an exhaustive adversarial CRUD matrix for every table.

Login abuse settings, session caps and session metadata are now enforced; details follow. CLI --actor remains operator-trusted. No production deployment or development grants were changed during this verification. Exact run results are in PHASE_2B_HANDOFF.md.

## Session lifecycle and authentication abuse controls

Session issuance locks the user row in a transaction, rechecks disabled status and the verified password hash, then revokes the oldest live sessions before inserting a new one (default cap 10). Password resets update that same user row and revoke sessions transactionally. This prevents a concurrent reset from leaving a stale verified login session alive. Cap eviction immediately invalidates access and refresh tokens. Session user-agent values are stripped of control characters and capped at 200 characters; last_seen_at writes are conditional and limited to roughly once per minute.

Login failure counters use atomic PostgreSQL UPSERTs in one transaction for account/IP, IP and account buckets. Counters include unknown accounts and are not erased by a successful login. Requests check blocks before password verification; failures still return the same 401 message and blocked/unknown paths run dummy password verification. Blocked requests do not extend the block. Already in-flight password checks may finish after a block starts; this is not a strict bound on simultaneously admitted attempts. Hashing concurrency and distributed denial of service remain deployment concerns.

Known login sources are SHA-256(user ID, IP) fingerprints recorded only after a successful credential check. Counter keys also contain hashes rather than raw input. Hashes are pseudonymous, not anonymization or a substitute for network privacy. Known sources currently have no automatic expiry; IP reassignment and shared networks limit their identity value. Login source fingerprints are not authentication factors. Database failures propagate instead of silently disabling these controls.

Operator cleanup: run npm run auth:cleanup with PROVISIONER_DATABASE_URL and PROVISIONER_DB_USER set to the non-superuser provisioner. It deletes at most AUTH_CLEANUP_BATCH_SIZE rows from each of auth_sessions and rate_limit_buckets (default 1000, allowed 1..10000). Sessions must have expired or been revoked more than AUTH_CLEANUP_RETENTION_DAYS ago (default 7, allowed 1..365). Recent revocations remain for diagnostics/reuse evidence. Rate buckets are eligible only once both their window and any block have expired; DELETE rechecks bucket expiry to preserve concurrent renewed activity. The command is transactional and has a 30-second statement timeout. API DELETE permissions, tenant policies, financial tables and audit history are unchanged.

Schedule the operator command daily outside the API process and repeat bounded batches to clear a backlog. No host scheduler or development cleanup was run in this continuation. It prints counts only. Test databases/roles are still retained; auth cleanup does not delete them. Exact final test counts are in PHASE_2B_HANDOFF.md.

## Phase 5 import governance, source access and private exports

Import template versions carry organization context and immutable mapping JSON. Only a
small allowlisted language is accepted: exact columns, explicit date/number formats and
reviewed mappings to existing billing signs. Known SAP types cannot be redefined. OWNER
approval is enforced by guard and membership service; no executable mappings or overrides.
Database triggers protect version meaning and batch template/rules provenance. The runtime
role can INSERT template versions and UPDATE approval columns only. It cannot rewrite mappings.

Lineage and source-detail reports require OWNER/ANALYST; VIEWER summary access is unchanged.
Queries bind inputs, use explicit tenant predicates/composite joins and require PUBLISHED/PASSED
batches. Source files are not retained: record positions/checksums are not claimed as original
file evidence. Preview does not write business records and does not claim reconciliation.

New import_template_versions, report_snapshots and pilot_assessments tables all ENABLE/FORCE
RLS. Snapshot/assessment runtime grants are SELECT/INSERT only. The provisioner has no access
to these tables. Real PostgreSQL tests exercise missing context, cross-tenant operations and
A/B/A commit/rollback through a single-connection pool. Existing tenant policies/grants are
not weakened; there are now 12 RLS-protected tables.

Reports read all evidence in one SQL statement snapshot, use Decimal aggregation and publish
both formats atomically. Generation is bounded to 5000 current/comparison facts, 100 batches,
5000 checks and 16 MiB per output. Same-key requests serialize with a transaction advisory lock.
The runtime cannot UPDATE/DELETE completed snapshots. Downloads recheck membership/role and
seven-day access expiry; they use no-store and private authenticated routes, never public links.

Files are private database bytea values. Access expiry is implemented; physical retention cleanup,
storage encryption, durable background jobs and operational scheduling are NOT implemented.
No production storage/deployment readiness is asserted. Pilot measurements/review statements
are entered by users and remain append-only; they do not prove ROI or financial savings.

Generated XLSX/PPTX archives are checked for macros, external connections/links and external
relationships. Financial decimal text and leading-zero IDs are preserved. Source text is
neutralized against spreadsheet formula injection. ExcelJS/PptxGenJS are used for generation;
only internally generated workbooks are read by tests. Scoped patched transitive overrides
and actual npm audit results are recorded in PHASE_5_RESULTS.md.

All new migrations and permissions were applied only to fresh disposable databases. Existing
development accounts/passwords/data were not changed. Disposable databases/roles remain for
inspection; no reset, truncation or cleanup was run.
