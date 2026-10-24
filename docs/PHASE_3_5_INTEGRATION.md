# Phase 3.5 — Live End-to-End Integration

Date: 2026-10-24 · Branch `feat/security-hardening` (HEAD `ef5c6d8`) · Nothing committed or pushed.

**Goal:** prove the web app works against the **real** NestJS API and PostgreSQL (no mocks),
fix real integration bugs, and close dependency findings.

## 1. Starting state (inspected)

- Uncommitted work preserved: the Phase 2B backend set (9 modified + 3 new backend/doc files) and all of `apps/web` plus Phase 3 docs.
- Docker Desktop was stopped and was started. `dumpwise-postgres` became healthy, published on `127.0.0.1:5433` only.
- **Database separation:**
  - `dumpwise_dev` holds development data.
  - `dumpwise_test` is the legacy test database.
  - `dumpwise_verify_*_test` are disposable databases created by the backend test runner; 9 exist after this phase.
  - Live tests used only `dumpwise_dev`; automated backend tests used only a new disposable database.
- **`dumpwise_dev` is consistent with the code:**
  - All 3 migrations are applied.
  - RLS is ENABLED and FORCED on tenant tables.
  - `dumpwise_app` can only SELECT memberships and organizations.
  - `dumpwise_provisioner` has BYPASSRLS but no financial grants.
- Ports 3000 and 3001 were free (no unrelated processes). Both servers were started bound to `127.0.0.1`.

## 2. TRUST_PROXY review: recommendation withdrawn

Phase 3 recommended `TRUST_PROXY=loopback` on the API. Verified in Next.js 16 source
(`next/dist/server/base-server.js`):

```js
req.headers['x-forwarded-for'] ??= originalRequest.socket.remoteAddress   // only if ABSENT
```

When Next.js is the edge, the browser controls `X-Forwarded-For`, and Next.js by default
listens on **all interfaces**. With `TRUST_PROXY=loopback`, the API would believe whatever IP
the BFF relays, so an attacker could:
- rotate fake IPs to escape per-IP and per-account+IP login limits;
- claim a victim's previously seen IP to pass "known network" checks while the account is under distributed-attack protection.

Locally it brings no benefit either, because every client is `127.0.0.1`.

**Implemented instead (web only, no backend change):**
- The BFF forwards **no client IP by default** (`src/lib/auth/client-context.ts`). Forwarding is opt-in via `DUMPWISE_TRUST_PROXY_HEADER=true`, only behind a reverse proxy that *overwrites* the header.
- `npm run dev` / `npm start` bind Next.js to `127.0.0.1` (verified with `netstat`).
- API `TRUST_PROXY` stays unset (`false`).
- Tests: 3 unit tests, plus a browser test proving a spoofed header sent by the browser never reaches the API.

Trade-off, documented in FRONTEND_ARCHITECTURE.md: behind the BFF, all web users share the
API's IP-based counters. Per-account protections still apply. Production needs the
reverse-proxy topology described there.

## 3. Approved database writes and their effect on `dumpwise_dev`

Approved by you before any API request ("Full live plan"). All data is synthetic. Nothing was
deleted, reset or migrated.

| Table | Before | After | Why |
|---|---|---|---|
| organizations | 1 | 2 | `synthetic-isolation` created as `dumpwise_provisioner` (no CLI create-org exists), with an `ORGANIZATION_CREATED` audit event |
| users / memberships | 2 / 2 | 3 / 3 | `isolation.owner@example.invalid` as OWNER of `synthetic-isolation` (CLI) |
| import_batches | 1 | 3 | isolation org: 1 `RECONCILIATION_FAILED` (0 rows kept), 1 `PUBLISHED` |
| sales_transactions | 2,494 | 4,988 | +2,494 in the **isolation org only** |
| demo org transactions | 2,494 | **2,494** | unchanged |
| reconciliation_results | 84 | 252 | 84 checks per new batch (failed batch: exactly 1 failed check) |
| audit_events | 13 | 30 | 8 logins, 2 failed logins, 3 logouts, import, failed reconciliation, publish, org creation |
| auth_sessions | 1 | 9 | **all revoked afterwards** (3 by logout, 5 as `phase-3.5-cleanup` via the provisioner role); 0 active sessions remain |
| user_login_sources | 0 | 3 | known-network hashes from successful logins |
| rate_limit_buckets | 1 | 15 | shared rate-limit counters (every API request) |

Passwords: `demo.owner`, `demo.analyst` and `isolation.owner` received random passwords via
`reset-password`. They were held only in scratch files outside the repository and **deleted
after the run**; they never appeared in output. Run `reset-password` again to log in yourself.

## 4. Live browser tests (real API, no mocks)

`apps/web/test/live/live.spec.ts`, config `playwright.live.config.ts`. API started with
`AUTH_ACCESS_TOKEN_TTL_SECONDS=60` so that refresh could be observed in seconds.
**Result: 7 / 7 passed (58 s)** on the second run. The first run stopped at test 2 on an
ambiguous test locator, after its real-data assertions had already passed. Tests are serial,
so no later test ran twice.

| # | Test | Verified |
|---|---|---|
| 1 | Wrong password | Generic "Invalid email or password." from the real API; no session cookie |
| 2 | Analyst login and dashboard | HttpOnly SameSite=Lax cookies; no token in `document.cookie`. Sales footer **INR and USD totals equal the independent Python control totals**. Session survives reload and a new tab; Settings shows the ANALYST role |
| 3 | Refresh rotation | After the access cookie expired, a concurrent page load refreshed once; the refresh cookie changed; the session stayed valid. **DB: `last_refreshed_at` set, 0 `TOKEN_REUSE_DETECTED` events** |
| 4 | Role-sensitive views | Analyst sees "84 of 84 checks passed" and no Publish button. Re-uploading the demo file gives **ALREADY_IMPORTED** (no change). A direct publish via the BFF gets **403 from the API** |
| 5 | Organization isolation | `isolation.owner` sees only `synthetic-isolation`. Demo org sales → **403**; demo batch with demo header → **403**; demo batch id under own org → **404** |
| 6 | Full workflow (isolation org) | Upload with control totals off by ₹0.01 → **RECONCILIATION_FAILED, 83/84, rows rolled back**. Correct upload → **IMPORTED, 84/84**. Dashboard empty before publishing. Confirm publish → PUBLISHED. Sales total **equals the control totals** |
| 7 | Logout | Server session revoked; replaying the old cookies → **401** |

Independent cross-check (Python `Decimal` on the control totals) of the values the Overview
shows: INR 12-month net ₹57,41,32,689.75; Sep vs Aug 2026 −5.61% (UI −5.6%); 2,181 line items.
All match.

### Screenshots (`docs/screenshots/phase-3-5/`, synthetic data)

| File | Shows |
|---|---|
| `01-overview-analyst.png` | Overview, analyst, demo org: KPIs, monthly chart, coverage note |
| `02-sales-usd.png` | Sales, USD selected: chart + monthly table |
| `03-isolation-overview.png` | isolation org before import: empty state |
| `04-reconciliation-failed.png` | Upload result: reconciliation failed, 83 of 84 checks |
| `05-batch-ready.png` | Batch detail, 84/84 passed, Publish available (owner) |
| `06-isolation-dashboard-published.png` | isolation org dashboard after publishing |

Screenshots 01 and 04 were taken **before** the two UI fixes below. The fixes are covered by
the mock browser suite, not by new live screenshots, because those would need another live
login and more database writes.

## 5. Bugs found and fixed

| Finding | Where found | Fix |
|---|---|---|
| A client-supplied `X-Forwarded-For` was relayed to the API (harmless only while API `TRUST_PROXY=false`); Next.js listened on all interfaces | Source review | BFF forwards no IP by default; opt-in for trusted proxies; bind to 127.0.0.1 |
| Upload result showed the same failure twice ("reconciliation failed" + "Reconciliation failed") | Live screenshot 04 | Status badge shown only when it adds information |
| Overview "Net units: 3 units" read as a quantity but counted units of measure | Live screenshot 01 | Label: "3 units of measure" (single unit: "1,234 EA") |
| Runtime **high** advisory: `multer` <2.5.0 DoS (GHSA-q7qp-rjg7-q26m) via `@nestjs/platform-express` (pins 2.4.0) | `npm audit --omit=dev` (api) | `overrides: { multer: "2.5.0" }` in `apps/api/package.json`, after reviewing the 2.5.0 diff (1 code file, 52 lines, same maintainers, no new imports/network/eval). Backend upload tests pass. Note: our upload config uses no `fileFilter`, the advisory's trigger |

Not changed: financial reconciliation, parsing rules, RLS, migrations, and backend auth logic.

Operator note: the Phase 2B CLI reads `PROVISIONER_DATABASE_URL` from the process
environment, not from `.env`. Use `node --env-file=.env dist/cli/dumpwise.js …`. This is
recorded rather than changed, because it belongs to the unfinished Phase 2B work.

## 6. Dependency security

| App | Runtime (`--omit=dev`) | All (incl. dev) |
|---|---|---|
| api | **0** (was 4 high → 1 root cause, fixed by the override) | 0 |
| web | 0 | 0 (the Phase 3 `braces` dev-tooling advisory no longer reports) |

## 7. Automated verification (actual runs, after all changes)

| Suite | Result |
|---|---|
| web `npm run verify`: lint, typecheck, unit, build, Playwright (mock API) | **exit 0**: 62/62 unit, 34/34 browser |
| api `npm run verify`: lint, typecheck, build, unit, disposable-DB e2e (`dumpwise_verify_593cc823b7c983e5_test`) | **exit 0**: 42/42 unit, 61/61 integration |
| live Playwright (real API, `dumpwise_dev`) | **7/7** (run before the two cosmetic UI fixes; not re-run to avoid more writes) |

## 8. Verified vs. still needs work

**Verified live:**
- real login, generic failure, and HttpOnly cookies;
- session persistence, refresh rotation without reuse detection, and logout revocation;
- organization isolation (403/404);
- role-sensitive UI plus API-enforced 403;
- upload → validation → reconciliation (fail and pass) → owner publish → dashboard totals equal to independent control totals;
- localhost-only binding;
- spoofed-IP non-forwarding.

**Still needs work:**
1. Production topology (reverse proxy overwriting `X-Forwarded-For`, HTTPS, `DUMPWISE_TRUST_PROXY_HEADER=true`, API `TRUST_PROXY` = BFF address) is designed but untested.
2. Live tests cover Chromium desktop only; no Firefox/WebKit, mobile device, screen reader or axe audit.
3. Single-flight refresh is per Next.js process.
4. A CLI `create-org` command does not exist (operator SQL was used).
5. The CLI does not load `.env` for provisioner settings (Phase 2B scope).
6. 9 disposable `dumpwise_verify_*_test` databases and roles have accumulated; removal is an operator decision.
7. The isolation organization and its synthetic data remain in `dumpwise_dev` for future live tests. Removing them would require deletes, which were not approved.

## 9. How it works (learning notes)

**Authentication across three tiers.** The browser posts e-mail and password to
`/api/auth/login` on the *same origin*. The Next.js route handler calls `POST /v1/auth/login`
server-to-server and receives opaque tokens. It stores them in **HttpOnly** cookies, so page
scripts and any XSS can never read them, and returns only the session end time. Every later
browser call goes to `/api/v1/...`. The BFF reads the cookie, adds `Authorization: Bearer`,
and forwards **only allowlisted** operations. When the 60-second (in this test) access token
expires, the BFF exchanges the refresh token **once** for all concurrent requests. The API
rotates it, and replaying an old one would be treated as theft, which is why the single-flight
matters, and why test 3 checks for 0 reuse detections.

**Browser → server APIs.**
- Mutations carry `x-dumpwise-csrf: 1` and are same-origin checked. Cross-site pages can neither add that header nor read responses, because there is no CORS.
- Errors keep the API's JSON shape. 401 sends you to login; 403 and 404 are shown as "no access" or "not found". Imports and publishes are never retried automatically.

**PostgreSQL access.** The API connects as `dumpwise_app`. Every organization-scoped query
runs in a transaction that first sets `app.organization_id` / `app.user_id` with
`set_config(..., true)`, so RLS policies filter rows to that tenant and the setting dies at
commit. That's why `isolation.owner` gets 403 for the demo org (no membership row is visible)
and 404 for a demo batch inside their own org (the row is invisible under RLS). Operator tasks
use `dumpwise_provisioner`, which bypasses RLS but has no grants on financial tables.

**Dashboard data fetching.**
- The workspace loads `/api/auth/session` once: the user and memberships.
- Each page fetches through a typed client: Zod validates every response against the OpenAPI-derived schema.
- `useResource` aborts the previous request when the organization or range changes.
- Monthly sales arrive as decimal strings; totals are summed with BigInt and never across currencies. That's how the dashboard can match the Python control totals to the paisa.
