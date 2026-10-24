import "server-only";
import { resolveClientContext, type ClientContext } from "@/lib/auth/client-context";
import { serverConfig } from "./config";

export type { ClientContext };

/** Client IP is forwarded only behind a trusted, header-overwriting proxy (see client-context.ts). */
export function clientContext(headers: Headers): ClientContext {
  return resolveClientContext(headers, serverConfig.trustProxyHeader);
}

export interface UpstreamInit {
  method: "GET" | "POST";
  /** Path below the API root, e.g. "/v1/imports". */
  path: string;
  search?: string;
  accessToken?: string | null;
  organizationId?: string | null;
  contentType?: string | null;
  body?: ArrayBuffer | string | null;
  client: ClientContext;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class UpstreamUnavailableError extends Error {
  constructor(readonly reason: "timeout" | "network") {
    super(reason === "timeout" ? "The DUMPWISE API did not respond in time" : "The DUMPWISE API is unreachable");
  }
}

/** Server-to-server call to the NestJS API. Browser cookies are NEVER forwarded upstream. */
export async function callApi(init: UpstreamInit): Promise<Response> {
  const headers = new Headers({ Accept: "application/json" });
  if (init.accessToken) headers.set("Authorization", `Bearer ${init.accessToken}`);
  if (init.organizationId) headers.set("X-Organization-Id", init.organizationId);
  if (init.contentType) headers.set("Content-Type", init.contentType);
  if (init.client.userAgent) headers.set("User-Agent", init.client.userAgent);
  if (init.client.ip) headers.set("X-Forwarded-For", init.client.ip);

  const timeout = AbortSignal.timeout(init.timeoutMs ?? serverConfig.timeoutMs);
  const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout;
  try {
    return await fetch(`${serverConfig.apiBaseUrl}${init.path}${init.search ?? ""}`, {
      method: init.method,
      headers,
      body: init.body ?? undefined,
      signal,
      cache: "no-store",
      redirect: "manual",
    });
  } catch (err) {
    if (timeout.aborted) throw new UpstreamUnavailableError("timeout");
    if (init.signal?.aborted) throw err;
    throw new UpstreamUnavailableError("network");
  }
}
