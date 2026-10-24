"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";

export type Resource<T> =
  | { state: "loading"; data: T | null; error: null }
  | { state: "ready"; data: T; error: null }
  | { state: "error"; data: T | null; error: ApiError };

type Settled<T> = { requestKey: string; data: T | null; error: ApiError | null };

/**
 * Loads data and handles races: when `key` changes (another organization, date range or
 * page), the previous request is ABORTED and its late answer can never overwrite newer data.
 * "Loading" is derived (the last settled result belongs to a different request), so no
 * state is set synchronously inside the effect. Pass key = null to skip loading.
 */
export function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): Resource<T> & { reload: () => void } {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const requestKey = key === null ? null : `${key}#${nonce}`;

  useEffect(() => {
    if (requestKey === null) return;
    const controller = new AbortController();
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setSettled({ requestKey, data, error: null });
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        const error = err instanceof ApiError ? err : new ApiError("unavailable", 0, ["Unexpected error"]);
        if (error.kind === "aborted") return;
        setSettled((prev) => ({ requestKey, data: prev?.data ?? null, error }));
      },
    );
    return () => controller.abort();
  }, [requestKey]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const data = settled?.data ?? null;

  if (!settled || settled.requestKey !== requestKey) return { state: "loading", data, error: null, reload };
  if (settled.error) return { state: "error", data, error: settled.error, reload };
  return { state: "ready", data: settled.data as T, error: null, reload };
}
