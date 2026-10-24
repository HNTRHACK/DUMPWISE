import { cookies } from "next/headers";
import { bffError, relay, unavailable } from "@/lib/server/responses";
import { clearTokenCookies, getAccessToken } from "@/lib/server/session";
import { callApi, clientContext } from "@/lib/server/upstream";

const PATH = "/api/auth/session";

/** Current user + memberships (GET /v1/auth/me), refreshing the session if needed. */
export async function GET(request: Request): Promise<Response> {
  const store = await cookies();
  const client = clientContext(request.headers);
  try {
    const access = await getAccessToken(store, client);
    if (access.status !== "ok") return bffError(401, "Authentication required", PATH);
    let res = await callApi({ method: "GET", path: "/v1/auth/me", accessToken: access.accessToken, client });
    if (res.status === 401 && !access.refreshed) {
      const again = await getAccessToken(store, client, { forceRefresh: true });
      if (again.status !== "ok") return bffError(401, "Authentication required", PATH);
      res = await callApi({ method: "GET", path: "/v1/auth/me", accessToken: again.accessToken, client });
    }
    if (res.status === 401) clearTokenCookies(store);
    return relay(res);
  } catch (err) {
    return unavailable(err, PATH);
  }
}
