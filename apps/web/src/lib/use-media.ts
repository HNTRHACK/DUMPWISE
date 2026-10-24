"use client";

import { useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query. useSyncExternalStore is React's API for reading external,
 * changing sources (here: the browser's media query state) without effects or tearing.
 * The server snapshot is `serverValue`, so SSR output is deterministic.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");
