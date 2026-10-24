import "server-only";
import { tokenPairSchema, type TokenPair } from "@/lib/api/schemas";
import { createSingleFlight } from "@/lib/auth/single-flight";
import { serverConfig } from "./config";
import { callApi, type ClientContext } from "./upstream";

// Token storage: HttpOnly cookies set by the BFF. Browser JavaScript can never read them.
//  - access cookie:  lives until ~30 s before the access token expires
//  - refresh cookie: lives until the absolute session end
//  - "dw_session=1": NOT a secret, readable by JS, only tells the marketing site whether to
//    link "Enter Workspace" to /app or /login.
// In production (HTTPS) the __Host- prefix pins cookies to this exact host, Secure, path "/".
const prefix = serverConfig.cookieSecure ? "__Host-" : "";
export const COOKIE = {
  access: `${prefix}dw_at`,
  refresh: `${prefix}dw_rt`,
  hint: "dw_session",
} as const;

const SKEW_MS = 30_000;

type CookieStore = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: Record<string, unknown>): unknown;
  delete(name: string): unknown;
};

const base = () => ({ path: "/", sameSite: "lax" as const, secure: serverConfig.cookieSecure });

export function writeTokenCookies(store: CookieStore, pair: TokenPair, now = Date.now()): void {
  const accessMs = Date.parse(pair.accessTokenExpiresAt) - now - SKEW_MS;
  const sessionMs = Date.parse(pair.sessionExpiresAt) - now;
  if (accessMs > 0) store.set(COOKIE.access, pair.accessToken, { ...base(), httpOnly: true, maxAge: Math.floor(accessMs / 1000) });
  else store.delete(COOKIE.access);
  store.set(COOKIE.refresh, pair.refreshToken, { ...base(), httpOnly: true, maxAge: Math.max(1, Math.floor(sessionMs / 1000)) });
  store.set(COOKIE.hint, "1", { ...base(), httpOnly: false, maxAge: Math.max(1, Math.floor(sessionMs / 1000)) });
}

export function clearTokenCookies(store: CookieStore): void {
  for (const name of [COOKIE.access, COOKIE.refresh, COOKIE.hint]) {
    store.set(name, "", { ...base(), httpOnly: name !== COOKIE.hint, maxAge: 0 });
  }
}

// One refresher per server process (module scope), shared by all requests.
const refreshOnce = createSingleFlight<TokenPair, ClientContext>(async (refreshToken, client) => {
  const res = await callApi({
    method: "POST",
    path: "/v1/auth/refresh",
    contentType: "application/json",
    body: JSON.stringify({ refreshToken }),
    client,
  });
  if (!res.ok) return null;
  const parsed = tokenPairSchema.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
});

export type AccessResult =
  | { status: "ok"; accessToken: string; refreshed: boolean }
  | { status: "signed-out" };

/**
 * Returns a usable access token, refreshing (once, deduplicated) when the access cookie has
 * expired. On any refresh failure the cookies are cleared: the session is over.
 */
export async function getAccessToken(
  store: CookieStore,
  client: ClientContext,
  opts: { forceRefresh?: boolean } = {},
): Promise<AccessResult> {
  const access = store.get(COOKIE.access)?.value;
  if (access && !opts.forceRefresh) return { status: "ok", accessToken: access, refreshed: false };

  const refresh = store.get(COOKIE.refresh)?.value;
  if (!refresh) return { status: "signed-out" };

  const pair = await refreshOnce(refresh, client);
  if (!pair) {
    clearTokenCookies(store);
    return { status: "signed-out" };
  }
  writeTokenCookies(store, pair);
  return { status: "ok", accessToken: pair.accessToken, refreshed: true };
}
