export interface ClientContext {
  /** Client IP to forward to the API, or null to forward nothing. */
  ip: string | null;
  userAgent: string | null;
}

const IP = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * Decides which client address (if any) the BFF reports to the API.
 *
 * Next.js only fills `x-forwarded-for` from the socket when the header is ABSENT, so when
 * Next.js is the edge (no reverse proxy in front), a browser can put any value there.
 * Forwarding it would let an attacker fake IPs to dodge the API's per-IP login limits or to
 * impersonate a victim's "known network". Therefore:
 *  - trustProxyHeader = false (default): forward NO client IP. The API keys limits on the
 *    BFF's own connection, and API TRUST_PROXY stays "false".
 *  - trustProxyHeader = true: ONLY when a trusted reverse proxy in front of Next.js
 *    OVERWRITES x-forwarded-for with the real peer address. The rightmost entry is the one
 *    written by that proxy. Then (and only then) set API TRUST_PROXY to the BFF's address.
 */
export function resolveClientContext(headers: Headers, trustProxyHeader: boolean): ClientContext {
  const userAgent = headers.get("user-agent")?.slice(0, 300) ?? null;
  if (!trustProxyHeader) return { ip: null, userAgent };
  const last = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean).pop() ?? null;
  return { ip: last && IP.test(last) ? last : null, userAgent };
}
