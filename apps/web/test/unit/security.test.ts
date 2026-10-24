import { describe, expect, it, vi } from "vitest";
import { matchProxyRoute } from "@/lib/api/allowlist";
import { csrfViolation } from "@/lib/auth/csrf";
import { createSingleFlight } from "@/lib/auth/single-flight";

const UUID = "87239ee7-47eb-4cbe-ab63-7b13eebe549a";

describe("BFF allowlist (no open proxy)", () => {
  it.each([
    ["GET", ["sales", "monthly"]],
    ["GET", ["imports"]],
    ["POST", ["imports"]],
    ["GET", ["imports", UUID]],
    ["POST", ["imports", UUID, "publish"]],
    ["GET", ["auth", "me"]],
    ["POST", ["auth", "change-password"]],
  ])("allows %s %s", (method, segments) => {
    expect(matchProxyRoute(method, segments as string[])).not.toBeNull();
  });

  it.each([
    ["GET", ["auth", "login"]], // login goes through /api/auth/login only
    ["POST", ["auth", "refresh"]], // refresh tokens never pass through the generic proxy
    ["DELETE", ["imports", UUID]],
    ["GET", ["imports", "../admin"]],
    ["GET", ["imports", "not-a-uuid"]],
    ["POST", ["sales", "monthly"]],
    ["GET", ["health"]],
  ])("rejects %s %s", (method, segments) => {
    expect(matchProxyRoute(method, segments as string[])).toBeNull();
  });
});

describe("CSRF checks for state-changing requests", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it("accepts a same-origin request with the custom header", () => {
    expect(csrfViolation(h({ "x-dumpwise-csrf": "1", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }), "localhost:3000")).toBeNull();
  });
  it("rejects a request without the custom header", () => {
    expect(csrfViolation(h({ origin: "http://localhost:3000" }), "localhost:3000")).toBe("Missing CSRF header");
  });
  it("rejects cross-site and foreign-origin requests", () => {
    expect(csrfViolation(h({ "x-dumpwise-csrf": "1", "sec-fetch-site": "cross-site" }), "localhost:3000")).toBe("Cross-site request rejected");
    expect(csrfViolation(h({ "x-dumpwise-csrf": "1", origin: "https://evil.example" }), "localhost:3000")).toBe("Origin mismatch");
  });
});

describe("refresh single-flight (protects against refresh-token reuse detection)", () => {
  it("shares one exchange between concurrent callers", async () => {
    let resolve!: (v: string) => void;
    const exchange = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const refresh = createSingleFlight<string, string>(exchange);
    const a = refresh("rt-old", "ip-a");
    const b = refresh("rt-old", "ip-b");
    resolve("new-pair");
    expect(await Promise.all([a, b])).toEqual(["new-pair", "new-pair"]);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange).toHaveBeenCalledWith("rt-old", "ip-a");
  });

  it("gives late callers with the old token the rotated result during the grace period", async () => {
    let t = 0;
    const exchange = vi.fn(async () => "pair-1");
    const refresh = createSingleFlight<string>(exchange, { graceMs: 15_000, now: () => t });
    await refresh("rt-old");
    t = 10_000;
    expect(await refresh("rt-old")).toBe("pair-1");
    expect(exchange).toHaveBeenCalledTimes(1);
    t = 16_000; // after the grace period the old token is exchanged again (and the API rejects it)
    await refresh("rt-old");
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it("does not cache across different refresh tokens", async () => {
    const exchange = vi.fn(async (rt: string) => `pair-for-${rt}`);
    const refresh = createSingleFlight<string>(exchange);
    expect(await refresh("a")).toBe("pair-for-a");
    expect(await refresh("b")).toBe("pair-for-b");
  });
});

describe("client IP forwarding (anti-spoofing)", async () => {
  const { resolveClientContext } = await import("@/lib/auth/client-context");
  const spoofed = new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "UA" });

  it("never forwards a browser-supplied X-Forwarded-For by default", () => {
    expect(resolveClientContext(spoofed, false)).toEqual({ ip: null, userAgent: "UA" });
  });
  it("behind a trusted overwriting proxy, forwards the rightmost (proxy-written) entry", () => {
    const viaProxy = new Headers({ "x-forwarded-for": "198.51.100.7, 192.0.2.10" });
    expect(resolveClientContext(viaProxy, true).ip).toBe("192.0.2.10");
  });
  it("rejects malformed values even when trusted", () => {
    expect(resolveClientContext(new Headers({ "x-forwarded-for": "evil<script>" }), true).ip).toBeNull();
  });
});
