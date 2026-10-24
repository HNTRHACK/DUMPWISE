import "server-only";
import { serverConfig } from "./config";
import { UpstreamUnavailableError } from "./upstream";

const NO_STORE = { "Cache-Control": "no-store" };

/** Errors created by the BFF use the same JSON shape as the NestJS API. */
export function bffError(status: number, message: string | string[], path = ""): Response {
  return Response.json(
    { statusCode: status, error: errorName(status), message, path, timestamp: new Date().toISOString() },
    { status, headers: NO_STORE },
  );
}

function errorName(status: number): string {
  return (
    { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 411: "Length Required",
      413: "Payload Too Large", 415: "Unsupported Media Type", 502: "Bad Gateway", 503: "Service Unavailable",
      504: "Gateway Timeout" } as Record<number, string>
  )[status] ?? "Error";
}

export function unavailable(err: unknown, path: string): Response {
  if (err instanceof UpstreamUnavailableError) {
    return bffError(err.reason === "timeout" ? 504 : 503, err.message, path);
  }
  throw err;
}

/** Relays an upstream response, keeping only safe headers. */
export async function relay(res: Response): Promise<Response> {
  const headers = new Headers(NO_STORE);
  const type = res.headers.get("content-type");
  if (type) headers.set("Content-Type", type);
  res.headers.forEach((value, name) => {
    if (/^retry-after/i.test(name)) headers.set(name, value);
  });
  const status = res.status >= 500 ? 502 : res.status;
  return new Response(res.status === 204 ? null : await res.arrayBuffer(), { status, headers });
}

export function expectedHost(headers: Headers): string | null {
  return serverConfig.appHost ?? headers.get("host");
}

/** Reads a request body with a hard byte limit. Requires Content-Length (no unbounded streams). */
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; body: ArrayBuffer } | { ok: false; response: Response }> {
  const length = request.headers.get("content-length");
  if (!length || !/^\d+$/.test(length)) return { ok: false, response: bffError(411, "Content-Length is required") };
  if (Number(length) > maxBytes) return { ok: false, response: bffError(413, `Request body exceeds ${maxBytes} bytes`) };
  const body = await request.arrayBuffer();
  if (body.byteLength > maxBytes) return { ok: false, response: bffError(413, `Request body exceeds ${maxBytes} bytes`) };
  return { ok: true, body };
}
