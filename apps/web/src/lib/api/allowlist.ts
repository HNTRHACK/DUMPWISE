// The BFF is NOT an open proxy: only these backend operations can be reached through
// /api/v1/*, and only with these methods. Anything else is answered with 404 by the BFF
// before a request is sent upstream.

export type ProxyMethod = "GET" | "POST";

export interface ProxyRoute {
  method: ProxyMethod;
  /** Segment pattern; ":uuid" matches one UUID segment. */
  pattern: string[];
  /** Organization-scoped routes require the X-Organization-Id header. */
  orgScoped: boolean;
  /** Request body kind accepted for POST. */
  body?: "json" | "multipart";
  /** Long-running request (CSV import). */
  slow?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PROXY_ROUTES: ProxyRoute[] = [
  { method: "GET", pattern: ["auth", "me"], orgScoped: false },
  { method: "POST", pattern: ["auth", "change-password"], orgScoped: false, body: "json" },
  { method: "GET", pattern: ["imports"], orgScoped: true },
  { method: "POST", pattern: ["imports"], orgScoped: true, body: "multipart", slow: true },
  { method: "GET", pattern: ["imports", ":uuid"], orgScoped: true },
  { method: "POST", pattern: ["imports", ":uuid", "publish"], orgScoped: true },
  { method: "GET", pattern: ["sales", "monthly"], orgScoped: true },
];

export function matchProxyRoute(method: string, segments: string[]): ProxyRoute | null {
  for (const route of PROXY_ROUTES) {
    if (route.method !== method || route.pattern.length !== segments.length) continue;
    const ok = route.pattern.every((p, i) => (p === ":uuid" ? UUID.test(segments[i]) : p === segments[i]));
    if (ok) return route;
  }
  return null;
}

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}
