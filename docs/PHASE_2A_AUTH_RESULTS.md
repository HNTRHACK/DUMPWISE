# Phase 2a Results — Authentication, Authorization, Protected APIs

Branch `feat/auth-secure-apis`, created from `origin/main` (`d668dca`). Date: 2026-10-23.
Every result below comes from an actual run.

## Starting state (inspected before any change)

- The working tree was identical to `origin/main` (`d668dca`, 69 files, 0 secret values found).
- Local `main` had one **unpushed** commit, `ac2454d`. It contains a single accidental file, `h -u origin main`: a saved `less` help screen, not code and not a secret. It is deleted in the working tree. **Local `main` was not modified.** The feature branch starts from `origin/main`, so the commit is not included.
- Phase 1 verification on the clean tree: lint/typecheck/build OK, 23/23 unit, 21/21 e2e.

## What was built

| Area | Implementation |
|---|---|
| Passwords | scrypt N=2¹⁶ r=8 p=2 (~217 ms per hash measured), salted, NFKC, constant-time compare, re-hash on login when parameters change |
| Sessions | Opaque `dwa_`/`dwr_` tokens, SHA-256 stored; 15-min access, 7-day absolute session; refresh rotation + reuse detection; immediate revocation |
| Abuse controls | Lockout after 5 failures (15 min); per-IP rate limit 10/min on credential routes, 300/min elsewhere |
| Authorization | `OrganizationAccessGuard` + `@RequireRoles`; roles re-checked in services |
| HTTP APIs | `/v1/auth/{login,refresh,logout,change-password,me}`, `/v1/imports` (upload, list, detail, publish), `/v1/sales/monthly` |
| Hardening | helmet headers (HSTS only in production), streaming upload limits, `Cache-Control: no-store` on tokens, `WWW-Authenticate` on 401 |
| Operator CLI | `create-user`, `add-member`, `reset-password` (random password shown once) |
| Database | Migration `20261022200843_auth_sessions`: purely additive (new table, new nullable user columns, `audit_events.organization_id` made nullable) |
| Removed | `DisabledAuthenticator` and the test-only header authenticator: tests now use real login |

**SAP reconciliation logic is preserved:** `git diff origin/main` is empty for
`src/imports/parsing/`, `reconciliation.ts`, `import-pipeline.service.ts`,
`publication.service.ts`, `sales.service.ts`, the synthetic data and the generator.

## Verification

| Check | Result |
|---|---|
| `npm run verify` | exit 0 — lint 0 warnings, typecheck 0 errors, build OK |
| Unit tests | **34 / 34** (23 Phase 1 + 11 password/token/policy) |
| E2E tests | **46 / 46** in 6 files (health 3, auth 13, imports API 10, sales API 10, pipeline 9, rate limit 1) |
| `npm audit` | 0 vulnerabilities |
| Secret scan | 83 committable files, 0 secret values, 0 token-like strings |

**Mutation checks** (bug introduced on purpose, then restored):
1. Batch detail query without the organization filter → 1 test failed ("never reveals another organization's batch").
2. Revoked sessions accepted → 4 tests failed (logout, reuse detection, password change, operator reset).

**Live check against the running dev server.** Port 3001 was already served by a
`nest start --watch` process (presumably your `npm run start:dev`) running this branch's
build. It was left running.
- `reset-password` (CLI) → login over HTTP → token `dwa_…` (47 chars), `Cache-Control: no-store`.
- `/v1/auth/me` returned the OWNER membership of `synthetic-demo`.
- `/v1/imports` listed the published Phase 1 batch (2,494 rows).
- `/v1/sales/monthly` for 2026-09: INR 44,792,897.06 over 161 lines; USD 124,094.33 over 29 lines.
- Re-uploading the synthetic CSV over HTTP returned `ALREADY_IMPORTED` (idempotent).
- No token → 401. Logout → 204, then the same token → 401.
- Login rate limit: the 10th request within a minute → 429.
- Swagger UI and its init script → 200, with no inline scripts (compatible with the CSP).
- Found and fixed live: helmet's HSTS and `upgrade-insecure-requests` were being sent on plain-HTTP localhost. They are now production-only, with a test added.

## Required items → tests

| Requirement | Test(s) |
|---|---|
| Login works and tokens are stored hashed | auth › returns an opaque token pair…; stores only hashes of tokens and passwords |
| No account enumeration | auth › gives the same answer for a wrong password and an unknown e-mail |
| Brute-force protection | auth › locks the account after 5 failed attempts; rate-limit › returns 429 after 3 login attempts |
| Session revocation and expiry | auth › logout revokes…; expired access tokens are rejected; sessions past their absolute expiry…; refuses disabled users |
| Refresh rotation + theft detection | auth › detects refresh-token reuse and revokes the whole session |
| Password change / reset | auth › requires the current password…; operator reset (CLI path) revokes all sessions |
| Unauthorized access | sales-api › 401 without a token; 401 for malformed/random/wrong-type token; imports-api › rejects anonymous callers and VIEWERs |
| Role authorization | imports-api › only an OWNER may publish; pipeline › VIEWER cannot import, ANALYST cannot publish |
| Cross-tenant isolation | sales-api › a member of A cannot read B (even an OWNER of A); imports-api › never reveals another organization's batch; database composite-FK test |
| Protected import over HTTP = same reconciliation | imports-api › ANALYST uploads the synthetic file (84/84 checks); re-upload idempotent; failed reconciliation → 409 on publish |

## Open items

1. **Not committed and not pushed.** All changes are uncommitted on `feat/auth-secure-apis`, waiting for your review.
2. Local `main` still has the accidental commit `ac2454d`. Suggested fix, with your approval: `git switch main; git reset --hard origin/main`. It discards only that commit and the deleted junk file.
3. The demo owner's password was reset during the live check. It was never printed in the chat and its temporary file was deleted. Run `npm run cli -- reset-password --email demo.owner@example.invalid` to get a new one.
4. Limitations (MFA/SSO, in-memory rate limits, lockout DoS, no session purge, no RLS): see SECURITY.md.

## Suggested next steps

1. PostgreSQL Row-Level Security as a second tenant-isolation layer.
2. Organization administration API (invite users, change roles) for OWNERs.
3. Analytics endpoints: distributor-, SKU- and customer-wise; 3/6/12-month windows.
4. CI pipeline running `npm run verify` on every push.
