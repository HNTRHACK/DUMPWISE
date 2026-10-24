import type { z } from "zod";
import {
  analyticsSchema,
  productTrendSchema,
  errorBodySchema,
  importBatchDetailSchema,
  importBatchListSchema,
  importResultSchema,
  meSchema,
  monthlySalesSchema,
} from "./schemas";

// Browser-side API client. It ONLY talks to this site's BFF (/api/*), which holds the
// session in HttpOnly cookies. No token ever exists in browser JavaScript.

export type ApiErrorKind =
  | "unauthorized" // 401: not signed in / session ended
  | "forbidden" // 403: signed in, not allowed
  | "not_found" // 404
  | "conflict" // 409: e.g. publication blocked
  | "invalid" // 400/411/413/415/422
  | "rate_limited" // 429
  | "timeout" // client or gateway timeout
  | "unavailable" // network failure or 5xx
  | "contract" // response did not match the expected schema
  | "aborted"; // superseded by a newer request

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number,
    readonly messages: string[],
  ) {
    super(messages[0] ?? kind);
    this.name = "ApiError";
  }
}

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 504 || status === 408) return "timeout";
  if (status >= 500) return "unavailable";
  return "invalid";
}

export const SESSION_EXPIRED_EVENT = "dumpwise:session-expired";

interface RequestOptions<T> {
  method?: "GET" | "POST";
  organizationId?: string | null;
  json?: unknown;
  form?: FormData;
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Extra attempts for transient failures. Forced to 0 for POST: never auto-retry writes. */
  retries?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new ApiError("aborted", 0, ["Request cancelled"]));
    }, { once: true });
  });

export async function apiRequest<T>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const retries = method === "GET" ? (opts.retries ?? 2) : 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptRequest(path, method, opts);
    } catch (err) {
      const transient = err instanceof ApiError && (err.kind === "unavailable" || err.kind === "timeout");
      if (!transient || attempt >= retries) throw err;
      await sleep(300 * 2 ** attempt, opts.signal);
    }
  }
}

async function attemptRequest<T>(path: string, method: "GET" | "POST", opts: RequestOptions<T>): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (opts.organizationId) headers.set("X-Organization-Id", opts.organizationId);
  if (method !== "GET") headers.set("x-dumpwise-csrf", "1");
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form; // the browser sets the multipart boundary
  }

  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, signal, credentials: "same-origin", cache: "no-store" });
  } catch {
    if (opts.signal?.aborted) throw new ApiError("aborted", 0, ["Request cancelled"]);
    if (timeout.aborted) throw new ApiError("timeout", 0, ["The request timed out. Check your connection and try again."]);
    throw new ApiError("unavailable", 0, ["DUMPWISE could not be reached. Check your connection and try again."]);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const parsed = errorBodySchema.safeParse(data);
    const messages = parsed.success
      ? Array.isArray(parsed.data.message) ? parsed.data.message : [parsed.data.message]
      : [`Request failed (${res.status})`];
    const err = new ApiError(kindForStatus(res.status), res.status, messages);
    if (err.kind === "unauthorized" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    }
    throw err;
  }

  if (!opts.schema) return data as T;
  const result = opts.schema.safeParse(data);
  if (!result.success) {
    throw new ApiError("contract", res.status, ["The server response was not in the expected format."]);
  }
  return result.data;
}

// ---- Typed operations (one per allowlisted backend endpoint) ------------------------------

export const api = {
  analytics: (organizationId: string, dimension: "products" | "distributors" | "customers", query: Record<string, string>, signal?: AbortSignal) =>
    apiRequest(`/api/v1/analytics/${dimension}?${new URLSearchParams(query)}`, { organizationId, schema: analyticsSchema, signal }),
  productTrend: (organizationId: string, id: string, query: Record<string, string>, signal?: AbortSignal) =>
    apiRequest(`/api/v1/analytics/products/${encodeURIComponent(id)}/trend?${new URLSearchParams(query)}`, { organizationId, schema: productTrendSchema, signal }),

  session: (signal?: AbortSignal) => apiRequest("/api/auth/session", { schema: meSchema, signal }),

  login: (email: string, password: string) =>
    apiRequest<{ sessionExpiresAt: string }>("/api/auth/login", { method: "POST", json: { email, password } }),

  logout: () => apiRequest<void>("/api/auth/logout", { method: "POST" }),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiRequest<void>("/api/v1/auth/change-password", { method: "POST", json: { currentPassword, newPassword } }),

  monthlySales: (organizationId: string, range: { from?: string; to?: string }, signal?: AbortSignal) => {
    const q = new URLSearchParams();
    if (range.from) q.set("from", range.from);
    if (range.to) q.set("to", range.to);
    const qs = q.toString();
    return apiRequest(`/api/v1/sales/monthly${qs ? `?${qs}` : ""}`, { organizationId, schema: monthlySalesSchema, signal });
  },

  listImports: (organizationId: string, page: { limit: number; offset: number }, signal?: AbortSignal) =>
    apiRequest(`/api/v1/imports?limit=${page.limit}&offset=${page.offset}`, {
      organizationId,
      schema: importBatchListSchema,
      signal,
    }),

  getImport: (organizationId: string, batchId: string, signal?: AbortSignal) =>
    apiRequest(`/api/v1/imports/${encodeURIComponent(batchId)}`, {
      organizationId,
      schema: importBatchDetailSchema,
      signal,
    }),

  uploadImport: (organizationId: string, form: FormData, signal?: AbortSignal) =>
    apiRequest("/api/v1/imports", {
      method: "POST",
      organizationId,
      form,
      schema: importResultSchema,
      signal,
      timeoutMs: 190_000,
    }),

  publishImport: (organizationId: string, batchId: string) =>
    apiRequest(`/api/v1/imports/${encodeURIComponent(batchId)}/publish`, { method: "POST", organizationId }),
};
