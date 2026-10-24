// Mock of the DUMPWISE NestJS API for browser tests. SYNTHETIC DATA ONLY.
// It implements the same 11-operation contract as docs/openapi.json (responses are validated
// by the web app's Zod schemas, so any drift fails the tests) and mimics the security
// behaviour that matters to the frontend: opaque tokens, refresh rotation with reuse detection,
// revocation, roles and organization scoping. Test-only endpoints live under /__test/*.
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_API_PORT ?? 3101);
const PASSWORD = "correct horse battery 42";
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const USERS = {
  "owner@demo.invalid": { id: "aaaaaaaa-0000-4000-8000-000000000001", displayName: "Olivia Owner", memberships: [[ORG_A, "OWNER"], [ORG_B, "VIEWER"]] },
  "analyst@demo.invalid": { id: "aaaaaaaa-0000-4000-8000-000000000002", displayName: "Arjun Analyst", memberships: [[ORG_A, "ANALYST"]] },
  "viewer@demo.invalid": { id: "aaaaaaaa-0000-4000-8000-000000000003", displayName: "Vera Viewer", memberships: [[ORG_A, "VIEWER"]] },
};
const ORGS = {
  [ORG_A]: { name: "Synthetic Demo Manufacturing (SYNTHETIC)", slug: "synthetic-demo" },
  [ORG_B]: { name: "Second Synthetic Distributor (SYNTHETIC)", slug: "synthetic-two" },
};

// ---- deterministic synthetic monthly data for the last 18 months ------------------------
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function addMonths(m, n) { const [y, mo] = m.split("-").map(Number); const i = y * 12 + mo - 1 + n; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`; }
const LAST = addMonths(monthKey(new Date()), -1);
const MONTHS = Array.from({ length: 18 }, (_, i) => addMonths(LAST, i - 17));
const SALES = {
  [ORG_A]: MONTHS.flatMap((m, i) => [
    { month: m, currency: "INR", totalNetSales: `${4500000 + i * 125000}.${String((i * 37) % 100).padStart(2, "0")}`, transactionCount: 180 + i, unitsSold: [{ unit: "EA", quantity: `${8000 + i * 10}.000` }, { unit: "KG", quantity: `${7500 + i}.250` }] },
    { month: m, currency: "USD", totalNetSales: `${80000 + i * 1000}.50`, transactionCount: 20 + (i % 5), unitsSold: [{ unit: "EA", quantity: `${900 + i}.000` }] },
  ]),
  [ORG_B]: MONTHS.slice(-6).map((m, i) => ({ month: m, currency: "INR", totalNetSales: `${200000 + i * 5000}.00`, transactionCount: 40 + i, unitsSold: [{ unit: "CAR", quantity: `${300 + i}.000` }] })),
};

// ---- mutable state --------------------------------------------------------------------
let state;
function reset() {
  state = {
    sessions: new Map(), // id -> { userId, access, refresh, prevRefresh, revoked, accessExpired }
    batches: { [ORG_A]: [], [ORG_B]: [] },
    stats: { refreshCalls: 0, reuseDetected: 0, uploads: 0, cookieHeadersSeen: 0, lastForwardedFor: null, lastUserAgent: null, lastMonthlyQuery: null, lastOrgHeader: null },
    publishConflict: false,
  };
  state.batches[ORG_A].push(batch(ORG_A, "SYNTHETIC_sap_billing_ready.csv", "READY_TO_PUBLISH"), batch(ORG_A, "SYNTHETIC_reconciliation_failed.csv", "RECONCILIATION_FAILED"));
}
function stats(over = {}) { return { rowsTotal: 2531, rowsValid: 2494, rowsInvalid: 13, rowsDuplicateInFile: 24, rowsAlreadyImported: 0, rowsInserted: 2494, ...over }; }
function checks(passed) {
  return [
    { metric: "NET_AMOUNT", month: LAST, currency: "INR", unit: null, expected: "4792897.06", actual: passed ? "4792897.06" : "4792896.06", passed },
    { metric: "LINE_COUNT", month: LAST, currency: "INR", unit: null, expected: "161", actual: "161", passed: true },
    { metric: "QUANTITY", month: LAST, currency: null, unit: "EA", expected: "8235.000", actual: "8235.000", passed: true },
  ];
}
function batch(orgId, fileName, status) {
  const failed = status === "RECONCILIATION_FAILED";
  const invalid = status === "FAILED_VALIDATION";
  return {
    id: randomUUID(), fileName, fileSha256: randomBytes(32).toString("hex"), fileSizeBytes: 240_311, isSynthetic: true, status,
    reconciliationStatus: invalid ? "NOT_RUN" : failed ? "FAILED" : "PASSED",
    stats: invalid ? stats({ rowsValid: 0, rowsInvalid: 0, rowsDuplicateInFile: 0, rowsInserted: 0, rowsTotal: 0 }) : stats(failed ? { rowsInserted: 0 } : {}),
    createdAt: new Date(Date.now() - 3600_000).toISOString(), createdByUserId: USERS["analyst@demo.invalid"].id, publishedAt: null, publishedByUserId: null,
    issues: invalid
      ? [{ severity: "error", code: "UNSUPPORTED_FILE_TYPE", message: "File looks like a ZIP/XLSX/XLSM spreadsheet. Only CSV exports are accepted." }]
      : [{ severity: "error", code: "INVALID_DATE", field: "billingDate", line: 1737, message: 'Date "31.02.2026" does not exist in the calendar.' },
         { severity: "warning", code: "UNKNOWN_COLUMN_IGNORED", message: 'Column "Remarks" is not recognized and was ignored.' },
         { severity: "info", code: "DUPLICATE_ROW_IN_FILE", line: 44, message: "Exact duplicate of line 12; skipped." }],
    reconciliation: invalid ? [] : checks(!failed),
  };
}
reset();

// ---- helpers --------------------------------------------------------------------------
const token = (p) => p + randomBytes(32).toString("base64url");
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}
function error(res, status, message, path = "") {
  send(res, status, { statusCode: status, error: { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict" }[status], message, path, timestamp: new Date().toISOString() },
    status === 401 ? { "WWW-Authenticate": 'Bearer realm="dumpwise"' } : {});
}
async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
function newSession(userId) {
  const s = { id: randomUUID(), userId, access: token("dwa_"), refresh: token("dwr_"), prevRefresh: null, revoked: false, accessExpired: false };
  state.sessions.set(s.id, s);
  return s;
}
function pair(s) {
  return { tokenType: "Bearer", accessToken: s.access, accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(), refreshToken: s.refresh, sessionExpiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() };
}
function userById(id) { return Object.entries(USERS).find(([, u]) => u.id === id); }
function authenticate(req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
  if (!m) return null;
  const s = [...state.sessions.values()].find((x) => x.access === m[1]);
  return s && !s.revoked && !s.accessExpired ? s : null;
}
function me(userId) {
  const [email, u] = userById(userId);
  return { id: u.id, email, displayName: u.displayName, memberships: u.memberships.map(([org, role]) => ({ organizationId: org, organizationName: ORGS[org].name, organizationSlug: ORGS[org].slug, dataClassification: "SYNTHETIC", role })) };
}
function access(req, res, session, roles) {
  const org = req.headers["x-organization-id"];
  state.stats.lastOrgHeader = org ?? null;
  const membership = userById(session.userId)[1].memberships.find(([o]) => o === org);
  if (!membership) { error(res, 403, "No access to this organization"); return null; }
  if (roles && !roles.includes(membership[1])) { error(res, 403, `Role ${membership[1]} may not perform this action`); return null; }
  return { org, role: membership[1] };
}
// Summary DTO = batch without the detail-only fields.
function summary(b) {
  const rest = { ...b };
  delete rest.issues;
  delete rest.reconciliation;
  return rest;
}

// ---- server ---------------------------------------------------------------------------
createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (!path.startsWith("/__test")) {
    if (req.headers.cookie) state.stats.cookieHeadersSeen++;
    state.stats.lastForwardedFor = req.headers["x-forwarded-for"] ?? null;
    state.stats.lastUserAgent = req.headers["user-agent"] ?? null;
  }
  try {
    // test controls
    if (path === "/__test/reset") { reset(); return send(res, 204); }
    if (path === "/__test/stats") return send(res, 200, state.stats);
    if (path === "/__test/expire-access") { for (const s of state.sessions.values()) s.accessExpired = true; return send(res, 204); }
    if (path === "/__test/revoke-all") { for (const s of state.sessions.values()) s.revoked = true; return send(res, 204); }
    if (path === "/__test/publish-conflict") { state.publishConflict = true; return send(res, 204); }
    if (path === "/__test/sessions") return send(res, 200, [...state.sessions.values()].map((s) => ({ id: s.id, revoked: s.revoked })));

    if (path === "/health") return send(res, 200, { status: "ok", service: "dumpwise-api-mock", timestamp: new Date().toISOString(), checks: { database: "up" } });

    if (req.method === "POST" && path === "/v1/auth/login") {
      const { email, password } = JSON.parse((await body(req)).toString() || "{}");
      const user = USERS[String(email).toLowerCase()];
      if (!user || password !== PASSWORD) return error(res, 401, "Invalid email or password", path);
      return send(res, 200, pair(newSession(user.id)));
    }
    if (req.method === "POST" && path === "/v1/auth/refresh") {
      state.stats.refreshCalls++;
      const { refreshToken } = JSON.parse((await body(req)).toString() || "{}");
      const all = [...state.sessions.values()];
      const s = all.find((x) => x.refresh === refreshToken);
      if (!s) {
        const reused = all.find((x) => x.prevRefresh === refreshToken);
        if (reused) { reused.revoked = true; state.stats.reuseDetected++; }
        return error(res, 401, "Invalid or expired refresh token", path);
      }
      if (s.revoked) return error(res, 401, "Invalid or expired refresh token", path);
      s.prevRefresh = s.refresh;
      s.refresh = token("dwr_");
      s.access = token("dwa_");
      s.accessExpired = false;
      return send(res, 200, pair(s));
    }

    const session = authenticate(req);
    if (!session) return error(res, 401, "Authentication required", path);

    if (req.method === "POST" && path === "/v1/auth/logout") { session.revoked = true; return send(res, 204); }
    if (req.method === "GET" && path === "/v1/auth/me") return send(res, 200, me(session.userId));
    if (req.method === "POST" && path === "/v1/auth/change-password") {
      const { currentPassword, newPassword } = JSON.parse((await body(req)).toString() || "{}");
      if (currentPassword !== PASSWORD) return error(res, 403, "Current password is incorrect", path);
      if (String(newPassword).length < 12) return error(res, 400, ["Password must be at least 12 characters"], path);
      for (const s of state.sessions.values()) if (s.userId === session.userId && s.id !== session.id) s.revoked = true;
      return send(res, 204);
    }
    if (req.method === "GET" && path === "/v1/sales/monthly") {
      const a = access(req, res, session); if (!a) return;
      const from = url.searchParams.get("from") ?? "2000-01";
      const to = url.searchParams.get("to") ?? "2100-12";
      state.stats.lastMonthlyQuery = { from, to, org: a.org };
      if (from > to) return error(res, 400, "from must not be after to", path);
      return send(res, 200, { organizationId: a.org, dataClassification: "SYNTHETIC", months: SALES[a.org].filter((r) => r.month >= from && r.month <= to) });
    }
    if (req.method === "GET" && path === "/v1/imports") {
      const a = access(req, res, session); if (!a) return;
      const limit = Number(url.searchParams.get("limit") ?? 20), offset = Number(url.searchParams.get("offset") ?? 0);
      const items = [...state.batches[a.org]].reverse();
      return send(res, 200, { items: items.slice(offset, offset + limit).map(summary), total: items.length, limit, offset });
    }
    const one = /^\/v1\/imports\/([0-9a-f-]{36})(\/publish)?$/.exec(path);
    if (one) {
      const a = access(req, res, session, one[2] ? ["OWNER"] : undefined); if (!a) return;
      const b = state.batches[a.org].find((x) => x.id === one[1]);
      if (!b) return error(res, 404, "Import batch not found", path);
      if (!one[2] && req.method === "GET") return send(res, 200, b);
      if (one[2] && req.method === "POST") {
        if (state.publishConflict || b.status !== "READY_TO_PUBLISH") return error(res, 409, `Publication blocked: batch status is ${b.status}, reconciliation is ${b.reconciliationStatus}`, path);
        b.status = "PUBLISHED"; b.publishedAt = new Date().toISOString(); b.publishedByUserId = session.userId;
        return send(res, 200, summary(b));
      }
    }
    if (req.method === "POST" && path === "/v1/imports") {
      const a = access(req, res, session, ["OWNER", "ANALYST"]); if (!a) return;
      state.stats.uploads++;
      const raw = await body(req);
      const form = await new Request("http://mock/", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body: raw }).formData();
      const file = form.get("file"), totals = form.get("controlTotals");
      if (!file || !totals) return error(res, 400, 'Multipart parts "file" and "controlTotals" are both required', path);
      try { JSON.parse(await totals.text()); } catch { return error(res, 400, "controlTotals is not valid JSON", path); }
      const name = file.name;
      const status = /fail-validation/.test(name) ? "FAILED_VALIDATION" : /fail-recon/.test(name) ? "RECONCILIATION_FAILED" : "READY_TO_PUBLISH";
      const b = batch(a.org, name, status);
      state.batches[a.org].push(b);
      const outcome = status === "READY_TO_PUBLISH" ? "IMPORTED" : status;
      return send(res, 201, { outcome, batchId: b.id, status: b.status, stats: b.stats, reconciliation: b.reconciliation, issues: b.issues }, { Location: `/v1/imports/${b.id}` });
    }
    return error(res, 404, "Not found", path);
  } catch (e) {
    console.error(e);
    return error(res, 400, "Bad request", path);
  }
}).listen(PORT, "127.0.0.1", () => console.log(`mock API on http://127.0.0.1:${PORT}`));
