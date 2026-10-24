import { cookies } from "next/headers";
import { isUuid, matchProxyRoute } from "@/lib/api/allowlist";
import { csrfViolation } from "@/lib/auth/csrf";
import { serverConfig } from "@/lib/server/config";
import { bffError, expectedHost, readBoundedBody, relay, unavailable } from "@/lib/server/responses";
import { clearTokenCookies, getAccessToken } from "@/lib/server/session";
import { callApi, clientContext } from "@/lib/server/upstream";

type Context = { params: Promise<{ path: string[] }> };

/**
 * Authenticated, allowlisted pass-through from the browser to the NestJS API.
 * The browser sends cookies; this handler turns them into "Authorization: Bearer" for the API.
 * Authorization decisions (roles, tenants) remain entirely on the API.
 */
async function handle(request: Request, { params }: Context): Promise<Response> {
  const { path } = await params;
  const method = request.method as "GET" | "POST";
  const route = matchProxyRoute(method, path);
  const publicPath = `/api/v1/${path.join("/")}`;
  if (!route) return bffError(404, "Not found", publicPath);

  if (method === "POST") {
    const csrf = csrfViolation(request.headers, expectedHost(request.headers));
    if (csrf) return bffError(403, csrf, publicPath);
  }

  const organizationId = request.headers.get("x-organization-id");
  if (route.orgScoped && !isUuid(organizationId)) {
    return bffError(400, "Header X-Organization-Id must be a valid UUID", publicPath);
  }

  // Bodies are buffered (with a hard limit) so a request rejected with 401 can be replayed
  // exactly once after a token refresh. A 401 is produced by the API's auth guard BEFORE any
  // handler runs, so the replay cannot double-apply an import or a publish.
  let body: ArrayBuffer | null = null;
  let contentType: string | null = null;
  if (method === "POST") {
    contentType = request.headers.get("content-type");
    if (route.body === "multipart" && !contentType?.startsWith("multipart/form-data")) {
      return bffError(415, "Expected multipart/form-data", publicPath);
    }
    if (route.body === "json" && !contentType?.startsWith("application/json")) {
      return bffError(415, "Expected application/json", publicPath);
    }
    if (route.body) {
      const read = await readBoundedBody(request, route.body === "multipart" ? serverConfig.maxUploadBytes : serverConfig.maxJsonBytes);
      if (!read.ok) return read.response;
      body = read.body;
    } else {
      contentType = null;
    }
  }

  const store = await cookies();
  const client = clientContext(request.headers);
  const url = new URL(request.url);
  const send = (accessToken: string) =>
    callApi({
      method,
      path: `/v1/${path.join("/")}`,
      search: url.search,
      accessToken,
      organizationId: route.orgScoped ? organizationId : null,
      contentType,
      body,
      client,
      timeoutMs: route.slow ? serverConfig.uploadTimeoutMs : serverConfig.timeoutMs,
      signal: request.signal,
    });

  try {
    let access = await getAccessToken(store, client);
    if (access.status !== "ok") return bffError(401, "Authentication required", publicPath);
    let res = await send(access.accessToken);
    if (res.status === 401 && !access.refreshed) {
      access = await getAccessToken(store, client, { forceRefresh: true });
      if (access.status !== "ok") return bffError(401, "Authentication required", publicPath);
      res = await send(access.accessToken);
    }
    if (res.status === 401) clearTokenCookies(store); // session revoked or expired server-side
    return relay(res);
  } catch (err) {
    return unavailable(err, publicPath);
  }
}

export const GET = handle;
export const POST = handle;
