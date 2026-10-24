import { createHash } from "node:crypto";

/**
 * Deduplicates refresh-token exchanges.
 *
 * The backend ROTATES refresh tokens and treats a second use of an old refresh token as
 * theft (it revokes the whole session). When a page fires several requests right after the
 * access token expires, each would otherwise try to refresh with the same old token, and the
 * second attempt would log the user out. So:
 *   - concurrent callers with the same refresh token share ONE in-flight exchange;
 *   - for a short grace period afterwards, late callers still holding the old cookie receive
 *     the already-rotated result instead of replaying the old token.
 * Keys are SHA-256 hashes, so raw refresh tokens are never kept as map keys.
 *
 * Limitation: this is per Next.js process. Multiple web instances need sticky sessions or a
 * shared store (documented in docs/FRONTEND_ARCHITECTURE.md).
 */
export function createSingleFlight<T, C = void>(
  exchange: (refreshToken: string, context: C) => Promise<T | null>,
  opts: { graceMs?: number; now?: () => number } = {},
) {
  const graceMs = opts.graceMs ?? 15_000;
  const now = opts.now ?? Date.now;
  const inflight = new Map<string, Promise<T | null>>();
  const recent = new Map<string, { value: T | null; until: number }>();

  const key = (token: string) => createHash("sha256").update(token).digest("hex");

  // `context` (e.g. the client IP) comes from the caller that starts the exchange.
  return async function refresh(refreshToken: string, context: C): Promise<T | null> {
    const k = key(refreshToken);
    const t = now();
    for (const [rk, entry] of recent) if (entry.until <= t) recent.delete(rk);

    const cached = recent.get(k);
    if (cached) return cached.value;
    const running = inflight.get(k);
    if (running) return running;

    const promise = exchange(refreshToken, context)
      .then((value) => {
        recent.set(k, { value, until: now() + graceMs });
        return value;
      })
      .finally(() => inflight.delete(k));
    inflight.set(k, promise);
    return promise;
  };
}
