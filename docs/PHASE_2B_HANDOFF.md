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

- LOGIN_* abuse-protection settings, session caps, user login sources and new session metadata behavior remain unfinished. Existing lockout configuration remains enforced.
- Expired sessions and rate buckets need an operator cleanup policy. Test databases/roles accumulate; removal needs explicit approval.
- Migration administration still uses the local superuser. A dedicated schema-owner migration role remains future hardening.
- CLI --actor is still operator-trusted. Provisioner credentials must stay out of API deployments. The CLI currently needs runtime configuration as well as provisioner configuration for bootstrap operations.
- TRUST_PROXY must match actual deployment topology. Broad true/hop-count trust can allow client-IP spoofing with alternate network paths.
- Tests prove PostgreSQL behavior in disposable databases; they do not establish that existing development grants match the new role setup. Development was inspected read-only and left alone.
- No new dependency audit or production deployment was performed. Phase 2A audit results are historical.

Next safe work: broaden adversarial per-table RLS coverage, then implement the unfinished abuse/session controls with concurrency tests. Run npm run verify; its e2e stage now uses the disposable runner. Do not invoke migrations or grant scripts against development as a side effect of tests.
