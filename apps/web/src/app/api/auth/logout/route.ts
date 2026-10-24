import { cookies } from "next/headers";
import { csrfViolation } from "@/lib/auth/csrf";
import { bffError, expectedHost } from "@/lib/server/responses";
import { clearTokenCookies, getAccessToken } from "@/lib/server/session";
import { callApi, clientContext, UpstreamUnavailableError } from "@/lib/server/upstream";

const PATH = "/api/auth/logout";

/**
 * Revokes the session ON THE SERVER, then clears the cookies. If the API cannot be reached,
 * cookies are still cleared, but the response says honestly that revocation is unconfirmed.
 */
export async function POST(request: Request): Promise<Response> {
  const csrf = csrfViolation(request.headers, expectedHost(request.headers));
  if (csrf) return bffError(403, csrf, PATH);

  const store = await cookies();
  const client = clientContext(request.headers);
  try {
    const access = await getAccessToken(store, client);
    if (access.status === "ok") {
      const res = await callApi({ method: "POST", path: "/v1/auth/logout", accessToken: access.accessToken, client });
      // 401 = the session was already revoked or expired: the goal is reached either way.
      if (!res.ok && res.status !== 401) {
        clearTokenCookies(store);
        return bffError(502, "Signed out on this device, but the server did not confirm session revocation", PATH);
      }
    }
  } catch (err) {
    clearTokenCookies(store);
    if (err instanceof UpstreamUnavailableError) {
      return bffError(503, "Signed out on this device, but the server could not be reached to revoke the session", PATH);
    }
    throw err;
  }
  clearTokenCookies(store);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
