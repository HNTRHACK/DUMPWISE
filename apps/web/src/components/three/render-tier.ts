"use client";

import { useSyncExternalStore } from "react";

export type RenderTier = "full" | "lite" | "static";

let webglCache: boolean | undefined;
function webglAvailable(): boolean {
  // Probing creates (and immediately releases) a context, so do it once per page load.
  if (webglCache !== undefined) return webglCache;
  webglCache = probeWebgl();
  return webglCache;
}

function probeWebgl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    const ok = !!gl;
    (gl as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Chooses how much 3D a device should get. Decided on the client after mount; the server
 * render (and first paint) always uses the static composition, so text/CTA never wait for 3D.
 *  - static: reduced motion requested, no WebGL, or data saver on
 *  - lite:   small screens, coarse pointers, few cores or little memory
 *  - full:   everything else
 * Append ?tier=static|lite|full to the URL to force a tier (used by tests and for debugging).
 */
export function detectRenderTier(): RenderTier {
  const forced = new URLSearchParams(window.location.search).get("tier");
  if (forced === "static" || forced === "lite" || forced === "full") return forced;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "static";
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return "static";
  if (!webglAvailable()) return "static";
  const small = window.matchMedia("(max-width: 768px)").matches || window.matchMedia("(pointer: coarse)").matches;
  const weak = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
  return small || weak ? "lite" : "full";
}

/** null on the server and during hydration; the detected tier afterwards. Re-evaluates on
 *  reduced-motion, viewport-size and pointer changes. */
export function useRenderTier(): RenderTier | null {
  return useSyncExternalStore<RenderTier | null>(
    (onChange) => {
      const queries = ["(prefers-reduced-motion: reduce)", "(max-width: 768px)", "(pointer: coarse)"].map((q) => window.matchMedia(q));
      queries.forEach((mq) => mq.addEventListener("change", onChange));
      return () => queries.forEach((mq) => mq.removeEventListener("change", onChange));
    },
    detectRenderTier,
    () => null,
  );
}
