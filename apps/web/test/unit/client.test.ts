import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, apiRequest, kindForStatus } from "@/lib/api/client";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("API client error handling", () => {
  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [400, "invalid"],
    [413, "invalid"],
    [429, "rate_limited"],
    [502, "unavailable"],
    [504, "timeout"],
  ] as const)("maps %i to %s", (status, kind) => {
    expect(kindForStatus(status)).toBe(kind);
  });

  it("keeps validation messages from the API", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(400, { statusCode: 400, message: ["from must be YYYY-MM"] })));
    await expect(apiRequest("/api/v1/sales/monthly")).rejects.toMatchObject({ kind: "invalid", messages: ["from must be YYYY-MM"] });
  });

  it("retries GET on transient failures, but never retries POST", async () => {
    const fetchMock = vi.fn(async () => json(503, { statusCode: 503, message: "down" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest("/x", { retries: 1 })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockClear();
    await expect(api.publishImport("87239ee7-47eb-4cbe-ab63-7b13eebe549a", "87239ee7-47eb-4cbe-ab63-7b13eebe549a")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the CSRF header and organization header on writes", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.changePassword("old", "new passphrase here");
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get("x-dumpwise-csrf")).toBe("1");
  });

  it("rejects responses that do not match the contract", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { organizationId: "x", months: "nope" })));
    await expect(api.monthlySales("87239ee7-47eb-4cbe-ab63-7b13eebe549a", {})).rejects.toMatchObject({ kind: "contract" });
  });

  it("reports cancellation separately from failure", async () => {
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const controller = new AbortController();
    const p = apiRequest("/x", { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toMatchObject({ kind: "aborted" });
  });
});
