# @dumpwise/web

Next.js 16 frontend for DUMPWISE: the cinematic marketing site and the authenticated workspace.
It talks to the NestJS API (`apps/api`) only through its own same-origin BFF routes (`/api/*`).

```powershell
npm install
npm run dev            # http://localhost:3000 (API expected at http://127.0.0.1:3001)
npm run verify         # lint + typecheck + unit tests + production build + Playwright
```

Docs: [Architecture](../../docs/FRONTEND_ARCHITECTURE.md) · [Design system](../../docs/FRONTEND_DESIGN_SYSTEM.md) ·
[API integration matrix](../../docs/API_INTEGRATION_MATRIX.md) · [Phase 3 results](../../docs/PHASE_3_RESULTS.md)
