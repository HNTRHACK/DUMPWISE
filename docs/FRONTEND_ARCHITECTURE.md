# Frontend Architecture — Phase 3 (`apps/web`)

Next.js 16.4 (App Router, Turbopack, Cache Components) · React 19.3 · TypeScript strict ·
Tailwind CSS 4 · GSAP 3.15 + ScrollTrigger · Three.js 0.186 via React Three Fiber 9 ·
Recharts 3 · Zod 4 · Radix primitives (shadcn/ui pattern) · Lucide icons.

The backend (`apps/api`) was **not modified** in this phase.

## Route map

| Route | Kind | Rendering |
|---|---|---|
| `/` `/product` `/security` `/contact` | Marketing (route group `(marketing)`) | Static (prerendered) + client islands |
| `/login` | Auth (`(auth)`) | Static shell; form is a client component |
| `/app` `/app/sales` `/app/imports` `/app/imports/[id]` `/app/settings` | Workspace (`(workspace)`) | Partial prerender: static shell + streamed session gate; pages are client components |
| `/app/products` `/app/distributors` `/app/customers` | Workspace | "Coming next" (no backend API yet) |
| `/api/auth/login` `/api/auth/logout` `/api/auth/session` | BFF route handlers | Dynamic |
| `/api/v1/[...path]` | BFF allowlisted proxy | Dynamic |

## Authentication: same-origin BFF

```
Browser ──(HttpOnly cookies, same origin)──► Next.js BFF (/api/*) ──(Authorization: Bearer)──► NestJS API
          never sees a token                    holds tokens server-side                     unchanged
```

The backend issues **opaque access/refresh tokens in JSON** and expects `Authorization: Bearer`.
It has no CORS and no cookie support. Rather than lowering security (tokens in
`localStorage`), the web app keeps them **server-side in HttpOnly cookies**:

| Cookie | Content | Flags | Lifetime |
|---|---|---|---|
| `dw_at` (`__Host-dw_at` on HTTPS) | access token | HttpOnly, SameSite=Lax, Secure in prod | until 30 s before access expiry |
| `dw_rt` (`__Host-dw_rt`) | refresh token | HttpOnly, SameSite=Lax, Secure in prod | until absolute session end |
| `dw_session` | `1` (not a secret) | readable by JS | same as refresh; only picks the "Enter Workspace" link target |

**Refresh.** When the access cookie has expired, or the API answers 401, the BFF exchanges
the refresh token once and retries the original request once. A 401 comes from the API's
auth guard *before* any handler runs, so a replayed import or publish cannot be applied twice.

**Single-flight refresh** (`src/lib/auth/single-flight.ts`). The API rotates refresh tokens
and revokes the whole session if an old one is reused. Concurrent requests after expiry
therefore share one exchange, and requests arriving up to 15 s later with the old cookie get
the rotated result. Test: 2 concurrent upstream 401s → exactly 1 refresh, 0 reuse detections.
**Limitation:** this is per Next.js process. Several web instances need sticky sessions or
a shared store.

**CSRF** (`src/lib/auth/csrf.ts`), for every state-changing BFF request:
1. Cookies are SameSite=Lax.
2. The custom header `x-dumpwise-csrf: 1` is required; cross-origin JavaScript cannot send it without a preflight, which the BFF never answers.
3. `Sec-Fetch-Site` / `Origin` must be same-origin. Set `DUMPWISE_APP_ORIGIN` when a proxy rewrites `Host`.

**Allowlist, not an open proxy** (`src/lib/api/allowlist.ts`). Only the 7 browser-facing
backend operations are reachable, with exact methods and UUID-validated path segments.
`/v1/auth/refresh` and `/v1/auth/login` are never proxied generically.

**Server-side gate.** `app/(workspace)/app/layout.tsx` reads cookies inside `<Suspense>`
(required with Cache Components) and redirects to `/login?next=/app` when there is no refresh
cookie. This is a convenience only; **the API authorizes every request**. `?next=` is validated
to `/app…` paths (`src/lib/auth/safe-next.ts`) to prevent open redirects.

**Why not `proxy.ts` (formerly middleware)?** In Next 16, `proxy.ts` buffers request bodies
only up to 10 MB by default, and anything beyond is truncated. CSV imports can be 20 MB, so
auth gating is done in the layout and route handlers instead.

### Client IP (important for deployment)

*Revised in Phase 3.5 (see docs/PHASE_3_5_INTEGRATION.md).*

Next.js fills `x-forwarded-for` from the socket **only when the header is absent** (`??=` in
`next/dist/server/base-server.js`). When Next.js is the edge, a browser can therefore put any
value in that header. Trusting it would let an attacker fake IPs to dodge per-IP login limits,
or claim a victim's "known network".

| Topology | Web (`DUMPWISE_TRUST_PROXY_HEADER`) | API (`TRUST_PROXY`) | Effect |
|---|---|---|---|
| **Local dev / Next.js is the edge** (current) | `false` (default): no client IP forwarded | `false` (default) | API keys limits on the BFF connection. Safe against spoofing; all web users share IP-based counters |
| **Production behind a trusted reverse proxy** that *overwrites* `X-Forwarded-For` with the peer address | `true` (BFF forwards the rightmost, proxy-written entry) | the BFF's address (e.g. `loopback` if co-located) | Per-client IP limits with no spoofing, provided the API is reachable **only** from the BFF |

Never set the API's `TRUST_PROXY` while Next.js accepts direct client connections.
`npm run dev` and `npm start` bind to `127.0.0.1`, like the API and PostgreSQL.

## Data layer

- `src/lib/api/schemas.ts`: Zod schemas for every response DTO, mirroring `docs/openapi.json`. Unit test `test/unit/contract.test.ts` compares all 13 against OpenAPI (property names and required fields).
- `src/lib/api/client.ts`: one typed function per operation. It handles timeouts, cancellation (`AbortSignal`), uniform `ApiError` kinds (unauthorized, forbidden, not_found, conflict, invalid, rate_limited, timeout, unavailable, contract, aborted), and response validation. **GET retries** up to 2× on transient failures; **POST never retries**.
- `src/lib/use-resource.ts`: load-on-key hook. A changed key (organization, range, page) aborts the previous request, and late answers are discarded. Loading is derived, not set.
- `src/lib/analytics/monthly.ts`: pure, tested calculations. Money is summed in `BigInt` minor units; currencies are never added; months without data are `null` (gaps), not zero; growth is computed only when both months exist and the base is non-zero.
- Any 401 dispatches `dumpwise:session-expired`, and the workspace redirects to `/login?reason=expired`.

## Workspace state

`WorkspaceProvider` (client) loads `/api/auth/session` (the user and memberships), then holds:
- the active organization (remembered in `localStorage` as a non-sensitive id; always re-validated against current memberships);
- the 3/6/12 completed-month preset;
- the theme.

`can("import" | "publish")` is a **UI convenience**; the API returns 403 regardless, which a test proves.

## 3D and motion

- `render-tier.ts` picks `static`, `lite`, or `full` on the client:
  - **static:** reduced motion, no WebGL, or data saver.
  - **lite:** small screens, coarse pointer, ≤4 cores or ≤4 GB memory.
  - **full:** everything else.

  The server and first paint always render the SVG composition, so the 3D never blocks text, navigation, login, or CTAs. `?tier=` forces a tier for testing.
- `hero-stage.tsx` lazy-loads the canvas with `next/dynamic({ ssr: false })` and wraps it in an error boundary. A lost WebGL context falls back to SVG.
- `data-core-canvas.tsx`: one `<Canvas>`, DPR capped at 1.75 (full) or 1.25 (lite), 540 or 200 instanced shards, procedural geometry, JSX-declared geometry and materials (auto-disposed).
- **Render-loop control:** the loop runs only while the hero is in view, the tab is visible, and the route is shown. With Cache Components, Next 16 keeps up to 3 visited routes alive in a hidden `<Activity>`, where React defers state updates. The loop is therefore switched **imperatively** on R3F's store (`setFrameloop`) from an IntersectionObserver and from effect cleanup. A test proves the frame counter stops on a hidden page and resumes on Back.
- Scroll writes a mutable `progress.value` (GSAP ScrollTrigger); the render loop eases toward it each frame. Scrolling triggers no React re-renders.
- GSAP: `useGSAP` scopes and reverts every tween and ScrollTrigger on unmount. `gsap.matchMedia("(prefers-reduced-motion: no-preference)")` gates all motion. Reveals animate opacity only (never `visibility`), so content stays keyboard-focusable.

## Environment variables (`apps/web`)

| Variable | Default | Purpose |
|---|---|---|
| `DUMPWISE_API_URL` | `http://127.0.0.1:3001` | NestJS API base URL (server-only) |
| `DUMPWISE_COOKIE_SECURE` | `true` in production | Secure cookies and `__Host-` prefix |
| `DUMPWISE_APP_ORIGIN` | — | Public origin for the CSRF Origin check behind proxies |
| `DUMPWISE_TRUST_PROXY_HEADER` | `false` | `true` ONLY behind a reverse proxy that overwrites `X-Forwarded-For` |

No `NEXT_PUBLIC_*` variables exist: nothing configurable is exposed to the browser.
`src/lib/server/*` imports `server-only`, so the build fails if client code imports it.

## Security headers (`next.config.ts`)

CSP (`default-src 'self'`; `connect-src 'self'`; `frame-ancestors 'none'`; `object-src 'none'`),
`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and `Cache-Control:
no-store` on `/api/*` and `/app/*`. **Trade-off:** `script-src` includes `'unsafe-inline'`,
because Next's inline bootstrap scripts would otherwise need per-request nonces, which would
make every page dynamic.
