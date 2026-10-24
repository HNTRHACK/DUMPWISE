import { cookies } from "next/headers";
import { loginRequestSchema, tokenPairSchema } from "@/lib/api/schemas";
import { csrfViolation } from "@/lib/auth/csrf";
import { serverConfig } from "@/lib/server/config";
import { bffError, expectedHost, readBoundedBody, relay, unavailable } from "@/lib/server/responses";
import { clearTokenCookies, writeTokenCookies } from "@/lib/server/session";
import { callApi, clientContext } from "@/lib/server/upstream";

const PATH = "/api/auth/login";

/**
 * Exchanges e-mail + password for a backend session. Tokens are written to HttpOnly cookies;
 * the JSON response contains NO token, only when the session ends.
 */
export async function POST(request: Request): Promise<Response> {
  const csrf = csrfViolation(request.headers, expectedHost(request.headers));
  if (csrf) return bffError(403, csrf, PATH);

  const read = await readBoundedBody(request, 4096);
  if (!read.ok) return read.response;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(read.body));
  } catch {
    return bffError(400, "Body must be JSON", PATH);
  }
  const parsed = loginRequestSchema.safeParse(json);
  if (!parsed.success) return bffError(400, "Enter a valid e-mail address and password", PATH);

  let res: Response;
  try {
    res = await callApi({
      method: "POST",
      path: "/v1/auth/login",
      contentType: "application/json",
      body: JSON.stringify(parsed.data),
      client: clientContext(request.headers),
      timeoutMs: serverConfig.timeoutMs,
    });
  } catch (err) {
    return unavailable(err, PATH);
  }
  if (!res.ok) return relay(res); // 401 generic message, 429 rate limit, 400 validation

  const pair = tokenPairSchema.safeParse(await res.json());
  if (!pair.success) return bffError(502, "Unexpected response from the authentication service", PATH);

  const store = await cookies();
  clearTokenCookies(store); // never mix a new session with leftovers of an old one
  writeTokenCookies(store, pair.data);
  return Response.json({ sessionExpiresAt: pair.data.sessionExpiresAt }, { headers: { "Cache-Control": "no-store" } });
}
