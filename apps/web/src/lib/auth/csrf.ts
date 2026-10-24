// CSRF protection for cookie-authenticated BFF requests that change state.
//
// Three independent layers:
//  1. Session cookies are SameSite=Lax: browsers do not attach them to cross-site POSTs.
//  2. A custom header (x-dumpwise-csrf) is required. Cross-origin JavaScript cannot add a
//     custom header without a CORS preflight, and the BFF never answers preflights.
//  3. If the browser says where the request came from (Sec-Fetch-Site / Origin), it must be
//     this same origin.

export const CSRF_HEADER = "x-dumpwise-csrf";

export function csrfViolation(headers: Headers, expectedHost: string | null): string | null {
  if (headers.get(CSRF_HEADER) !== "1") return "Missing CSRF header";
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return "Cross-site request rejected";
  const origin = headers.get("origin");
  if (origin) {
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      return "Invalid Origin header";
    }
    if (!expectedHost || host !== expectedHost) return "Origin mismatch";
  }
  return null;
}
