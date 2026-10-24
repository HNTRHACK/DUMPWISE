# Phase 2B handoff ? 2026-10-23

Branch: feat/security-hardening. Baseline commit: 1d0b92a (Phase 2A), preceded by d668dca (Phase 1). All inherited uncommitted work is preserved. No commit, push, merge, reset, truncation, file deletion or development database mutation was performed.

## Starting state and read-only findings

The previous continuation restored the two AuthService lockout settings and added eight unit tests. Baseline this turn: 42 unit tests passed. Inspection covered the current diff, Prisma 7 adapter/config, migrations, schema, grants, tenant context, auth/audit/import/publication/sales paths, CLI and tests. A read-only query found all three migrations, including 20261022203242_security_hardening, already recorded in dumpwise_dev. No migration SQL or permissions were applied to that database this turn. Two oddly named root files contain saved less help output and remain untouched.

## Work completed

- Retained existing RLS migration and TenantDb implementation. Proved actual enforcement using real PostgreSQL runtime credentials in a newly created database.
- Wired PostgresThrottlerStorage into AppModule. Applied TRUST_PROXY configuration, default false. The rate-limit test uses a distinct client address through a trusted loopback proxy to avoid colliding with other tests' persistent counters.
- Replaced truncating e2e global setup with a disposable-runner guard. npm run test:e2e builds the CLI, creates a fresh database and unique randomly credentialed roles, deploys all migrations and applies grants only there. It never resets/reuses a database and retains artifacts for inspection.
- Separated fixture/admin assertions from the runtime application client. The app is never injected with an admin client. Direct RLS tests also use restricted credentials.
- Made role setup atomic, rejected identical admin/runtime/provisioner names, and replaced broad future-table grants with an explicit allowlist.
- CLI provisioning commands use a lazy separate provisioner connection, disconnected on exit. Financial CLI commands resolve organizations under user tenant context and continue through runtime services. Provisioner credentials cannot read financial tables.
- Preserved parsing, reconciliation rules, amounts, synthetic data and publication semantics.

## Exact final verification

- npm run lint: passed.
- npm run typecheck: passed.
- npm run build: passed (also built by the final disposable test runner).
- npm test: 42/42 passed in four files.
- npm run test:e2e: 53/53 passed in seven files, 30.76 seconds.
- Final database: dumpwise_verify_7edf6bce10f6daf0_test. Test roles dw_app_7edf6bce10f6daf0 and dw_prov_7edf6bce10f6daf0.
- Earlier retained diagnostic databases: dumpwise_verify_f08311c727c6a3d7_test (fixture casts and shared-IP test collisions found), dumpwise_verify_b9ef83be1e1a76a1_test (52/52 passed), dumpwise_verify_d86c2690828ced36_test (53/53 passed). All used isolated roles. No cleanup was performed.

Real enforcement tests prove runtime non-superuser/non-bypass flags; all nine tenant-table ENABLE/FORCE flags; missing-context denial; cross-tenant SELECT/UPDATE filtering; cross-tenant INSERT and tenant reassignment rejection; DELETE denied by privileges; Prisma max-one-connection context cleanup after commit/rollback and concurrent tenant requests; forbidden runtime identity grants; provisioner financial denial; shared/concurrent PostgreSQL rate counters and independent clients; HTTP rate enforcement; and built CLI provisioning. Product is the representative adversarial CRUD table. This is not a per-table exhaustive CRUD matrix. Existing financial pipeline/API tests run through actual RLS and cover synthetic reconciliation, rollback, idempotency, publication and monthly totals.

## Security architecture and mentoring

PrismaPg pools connections. TenantDb starts an interactive transaction, binds organization/user settings with set_config(..., true), then runs all work on that transaction client. The true flag is essential: context ends at commit/rollback rather than persisting on a reused connection. SQL grants decide permitted operations; RLS USING filters existing rows and WITH CHECK rejects unacceptable new row values. Runtime DELETE is intentionally never granted. Composite foreign keys still reject cross-organization links.

Service authorization supplies trusted context. These GUC settings can be set by a caller holding arbitrary runtime SQL access, so RLS is defense against forgotten filters, not containment of stolen SQL credentials or arbitrary SQL injection. Authentication tables remain global. The provisioner has BYPASSRLS only for operator identity management; grants deny financial access. Integration tests do not grant the runtime role bypass privileges.

## Remaining limitations / next work

- LOGIN_* abuse protection, session caps, successful source fingerprints and session metadata are now implemented; see the session-controls continuation below.
- Operator auth cleanup is implemented, but external scheduling is still required. Test databases/roles accumulate; removing those artifacts remains separate from auth cleanup.
- Migration administration still uses the local superuser. A dedicated schema-owner migration role remains future hardening.
- CLI --actor is still operator-trusted. Provisioner credentials must stay out of API deployments. The CLI currently needs runtime configuration as well as provisioner configuration for bootstrap operations.
- TRUST_PROXY must match actual deployment topology. Broad true/hop-count trust can allow client-IP spoofing with alternate network paths.
- Tests prove PostgreSQL behavior in disposable databases; they do not establish that existing development grants match the new role setup. Development was inspected read-only and left alone.
- No new dependency audit or production deployment was performed. Phase 2A audit results are historical.

Next safe work: broaden adversarial per-table RLS coverage and review deployment scheduling/proxy configuration. Run npm run verify; its e2e stage now uses the disposable runner. Do not invoke migrations or grant scripts against development as a side effect of tests.

## Session-controls continuation (2026-10-23)

Started from clean feat/security-hardening at ef5c6d8. Changes remain uncommitted. No development database changes, resets, grant changes, unrelated deletions, pushes or merges were made. Financial code, RLS migrations and runtime permissions were left unchanged.

Implemented LoginAbuseService using the existing atomic PostgreSQL bucket helper. Failed credentials (including unknown accounts) count against account/IP, IP-wide and distributed-account buckets. At threshold, pair/IP blocks reject all credentials from that source; account-wide protection admits only previously successful source fingerprints, still requiring the correct password and unblocked pair/IP counters. Success does not erase failure counters. Login no longer globally locks a user after failures from one source; the legacy AUTH_MAX_FAILED_LOGINS/AUTH_LOCKOUT_SECONDS settings now apply only to password-change current-password verification.

AuthController passes Express's resolved client IP and bounded user-agent metadata to AuthService; trusted-proxy handling remains unchanged. Successful login records a hashed source. Session creation locks the user row, rechecks verified credentials and disabled status, and evicts oldest live sessions to enforce AUTH_MAX_SESSIONS_PER_USER (default 10) even under concurrency. Access/refresh tokens of evicted sessions stop working immediately. Last-seen writes are conditional, roughly once per minute.

Added npm run auth:cleanup, an operator-only command using the existing provisioner SELECT/DELETE permissions. It rejects superuser or mismatched-role connections. Per invocation it deletes at most 1000 rows from each auth table, configurable with AUTH_CLEANUP_BATCH_SIZE (1..10000). Sessions are retained for 7 days after expiry or revocation, configurable with AUTH_CLEANUP_RETENTION_DAYS (1..365). Expired buckets with active blocks are preserved. Bucket DELETE predicates recheck eligibility to protect renewed counters without requiring additional UPDATE privileges. The transaction rolls back on failure and uses a 30-second statement timeout. Audit and financial tables are never cleanup targets.

Operational use: schedule npm run auth:cleanup daily under the operator identity, repeating bounded batches for a backlog. Nothing is scheduled automatically. Do not deploy provisioner credentials to the API. No cleanup command was run against development during this work.

### Final validation

- npm run verify: exit 0 (lint, typecheck, build, unit and disposable integration suites).
- Unit tests: 42/42 in four files.
- Integration/API tests: 61/61 in eight files, 48.26 seconds.
- Successful database: dumpwise_verify_0bed0bff2aa24366_test.
- Diagnostic databases retained: dumpwise_verify_ba44af9dfe2ce9e0_test and dumpwise_verify_6c1537e37aa00863_test. Earlier failures exposed an invalid expiry fixture, an operator FOR UPDATE privilege assumption, and a test that assumed no other blocked pairs existed. These were corrected without widening runtime/operator grants.
- git diff --check: passed.

New tests cover concurrent persistent failure counters, unknown-account attempts, IP-wide spraying, distributed attacks with known-source access, block expiry, concurrent session caps, evicted refresh rejection, bounded metadata and last-seen updates, bounded cleanup, active sessions/blocks, recent revocation retention, old revocation deletion, invalid cleanup options and runtime cleanup denial. The existing RLS, tenant authorization, API and SAP financial suites all pass.

Remaining limits: source fingerprints have no automatic expiry and represent networks rather than devices; shared/NAT IPs share limits. Already in-flight attempts may complete after a block starts. No MFA, new migration-owner role, automatic host scheduler or test database/role cleanup was added. See SECURITY.md for the exact defaults, retention policy and operator instructions.
