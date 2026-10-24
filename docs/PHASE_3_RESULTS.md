# Phase 3 Results — Frontend

Date: 2026-10-23 · Branch: `feat/security-hardening` (HEAD `ef5c6d8`) · **Nothing committed, pushed or merged.**

## Starting state

- Branch `feat/security-hardening`, tracking its remote, with **12 uncommitted backend/doc files** from unfinished Phase 2B work (login-abuse service, auth changes, cleanup script, tests, docs).
- **Preserved untouched**: the same 12 files are modified, with no new backend changes, at the end of this phase.
- `apps/web` did not exist. API reachable at `127.0.0.1:3001` and healthy.
- API surface from source and OpenAPI: 11 operations; Bearer tokens in JSON; **no CORS**; offset pagination; no product, distributor, customer or session-list endpoints.

## What was built (`apps/web`, new)

| Area | Result |
|---|---|
| Stack | Next 16.4.2 (Cache Components), React 19.3, TS strict, Tailwind 4, GSAP 3.15, Three 0.186 + R3F 9.8, Recharts 3.10, Zod 4, Radix, Lucide |
| Auth | Same-origin BFF: HttpOnly SameSite=Lax cookies (`__Host-` and Secure in production), single-flight refresh, CSRF (header + Origin), allowlisted proxy, validated `?next=` |
| Workspace | Overview (KPIs per currency, MoM growth with stated reasons, coverage note, latest imports), Sales (chart + accessible table), Import center (drag & drop, client checks, real results, pagination), Batch detail (reconciliation and issue tables with filter, sort and paging; OWNER publish with confirmation), Settings (profile, memberships, password change, server-revoking sign-out) |
| Gaps | Products, distributors and customers show "Coming next" with proposed DTOs (no numbers). Session list labelled unavailable |
| Marketing | `/`, `/product`, `/security`, `/contact`. 7-section landing: 3D Data Core hero, ritual sheets, process, synthetic interactive demo, insights with availability badges, security claims matched to SECURITY.md, CTA |
| 3D | Procedural instanced scene; static/lite/full tiers; SVG fallback; error and context-loss fallback; DPR caps; render loop paused off-screen, in hidden tabs and in hidden (Activity) routes |
| Backend | **No changes** |

## Verification (actual runs)

| Check | Result |
|---|---|
| `apps/web` `npm run verify` | **exit 0** |
| ESLint (incl. React Compiler rules) | 0 problems (11 errors fixed during development) |
| TypeScript strict | 0 errors |
| Unit tests (Vitest) | **59 / 59** (contract vs. OpenAPI for 13 DTOs, money and range math, CSRF, allowlist, single-flight, client errors and retries) |
| Production build | success; marketing and login static, workspace partial prerender, BFF dynamic |
| Browser tests (Playwright, Chromium, production build + mock API) | **34 / 34** |
| `apps/api` `npm run verify` (regression; disposable DB `dumpwise_verify_c57094e576340bf6_test`) | **exit 0**: 42 / 42 unit, 61 / 61 PostgreSQL integration |
| Dev database before/after | identical: 2,494 transactions, 1 batch, 2 users |
| `npm audit --omit=dev` (web) | 0 vulnerabilities. Dev tooling: 1 high advisory (`braces` via `eslint-config-next`), not in the runtime bundle |

Browser tests cover:
- login, generic errors, HttpOnly cookies and no token in `document.cookie`;
- no browser cookies forwarded to the API;
- the open-redirect guard;
- transparent refresh (exactly 1 refresh, 0 reuse detections) and server-side revocation → redirect;
- logout revoking the session, and password change;
- the completed-month query and currency separation;
- the preset → API query, organization switching, and role-aware UI;
- a direct forbidden publish → 403;
- upload success and client-side rejection with no API call;
- server validation and reconciliation failures;
- confirm and cancel publish, and 409 in the dialog;
- failed-batch filters and the Coming-next pages;
- CSRF and foreign Origin rejection, allowlist 404s, org-header validation, IP and UA forwarding, and security headers;
- all routes and the 404 page;
- the session-aware CTA;
- WebGL render → loop stops when hidden → resumes on Back, with no page errors;
- reduced motion → static tier;
- WebGL unavailable → SVG;
- the keyboard demo and skip link;
- 375 px with no horizontal overflow on 8 routes, plus the mobile nav.

Bugs found by tests and fixed:
- Reveal animations used `visibility: hidden`, which made content **unreachable by keyboard**.
- Two controls on the Sales page had the same accessible name ("Range").
- The 3D render loop kept running on routes Next 16 keeps alive in a hidden `<Activity>`.
- The synthetic demo labelled ₹81,000 as "81.0 lakh" (now "thousand").
- The SVG fallback used `Math.sin`, which risked hydration mismatches across browser engines (now an integer PRNG).

## Performance (lab, measured with `test/perf/measure.mjs`; NOT Lighthouse)

Production build, this machine, cold cache. Mobile = 375 px, 4× CPU throttle, 150 ms RTT, ~1.6 Mbps.

| Profile | URL | LCP | CLS | JS executed (gzip) | Tier |
|---|---|---|---|---|---|
| desktop | `/` | 108 ms | 0 | 480 KB | full (3D) |
| desktop | `/?tier=static` | 132 ms | 0 | 241 KB | static |
| desktop | `/product` | 124 ms | 0 | 241 KB | — |
| desktop | `/login` | 84 ms | 0.001 | 238 KB | — |
| mobile | `/` | 1,056 ms | 0 | 477 KB | lite (3D) |
| mobile | `/?tier=static` | 1,012 ms | 0 | 238 KB | static |
| mobile | `/login` | 872 ms | 0.011 | 238 KB | — |

Bundle facts:
- Three.js chunk: 238 KB gzip, loaded only when the tier is lite or full.
- Recharts: 101 KB, workspace only.
- GSAP: 44 KB; also prefetched on `/login` via the logo link (non-blocking).
- Zod: 32 KB.
- React and Next runtime: about 150 KB.

**No Lighthouse score was measured.**

## Not verified / limitations

> **Update (Phase 3.5, 2026-10-24):** items 1 and 2 are resolved or superseded. A live login and the full import workflow were verified against the real API, and the `TRUST_PROXY=loopback` recommendation was withdrawn as unsafe. See [PHASE_3_5_INTEGRATION.md](PHASE_3_5_INTEGRATION.md).

1. **No live login against the real API** in this phase. A login, even a failed one, writes login-abuse and rate-limit rows to `dumpwise_dev`, which this phase was not allowed to change. Integration was verified through the OpenAPI contract test and a contract-faithful mock. To verify live: set `TRUST_PROXY=loopback` in `apps/api/.env`, run API and web (README), and sign in with a provisioned user.
2. **`TRUST_PROXY` is not configured** on the API. Until it is, the API sees the BFF's IP for every login, so IP-based abuse limits apply to all users together.
3. Production needs a reverse proxy that overwrites `X-Forwarded-For`, plus HTTPS (Secure / `__Host-` cookies).
4. Single-flight refresh is per Next.js process; multiple web instances need sticky sessions or a shared store.
5. CSP allows `'unsafe-inline'` scripts (Next bootstrap without nonces).
6. Login redirect returns to `/app`, not the exact deep link, when the server-side gate redirects.
7. Browser tests ran only on desktop Chromium plus a mobile-emulated viewport. No Firefox/WebKit run, no physical devices, no axe-core audit, no screen-reader test.
8. Optimizations not done: `zod/mini` on the client; disabling logo-link prefetch on `/login`.
9. Pilot enquiry form and self-service password reset are absent (no backend support).
10. The disposable test database created by the backend regression run is retained (backend runner design); remove it manually if desired.

## Suggested next steps

1. Your review; then commit `apps/web` and the docs. Separately, decide on the unfinished Phase 2B backend work.
2. Set `TRUST_PROXY=loopback` and run one live sign-in and import against the API.
3. Backend: session list/revoke endpoints and product/distributor/customer analytics (contracts in API_INTEGRATION_MATRIX.md).
4. Add axe-core and Firefox/WebKit Playwright projects; try `zod/mini`.
