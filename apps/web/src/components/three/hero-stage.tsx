"use client";

import dynamic from "next/dynamic";
import { Component, useState } from "react";
import { cn } from "@/lib/utils";
import type { ProgressRef } from "./data-core-canvas";
import { DataCoreFallback } from "./data-core-fallback";
import { useRenderTier } from "./render-tier";

// Three.js + React Three Fiber (~hundreds of KB) are code-split and only downloaded when a
// device qualifies for 3D. The server never renders them (ssr: false).
const DataCoreCanvas = dynamic(() => import("./data-core-canvas"), { ssr: false, loading: () => null });

class CanvasBoundary extends Component<{ onError: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The hero visual: SVG first (instant, accessible), upgraded to WebGL when appropriate. */
export function HeroStage({ progress }: { progress: ProgressRef }) {
  const tier = useRenderTier();
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const use3d = tier !== null && tier !== "static" && !failed;

  return (
    <div className="absolute inset-0" data-render-tier={failed ? "static" : (tier ?? "pending")}>
      <DataCoreFallback
        className={cn(
          "absolute inset-y-0 right-[-10%] h-full w-[120%] transition-opacity duration-700 md:right-0 md:w-full",
          use3d && ready ? "opacity-0" : "opacity-100",
        )}
      />
      {use3d ? (
        <CanvasBoundary onError={() => setFailed(true)}>
          <DataCoreCanvas tier={tier} progress={progress} onReady={() => setReady(true)} onFail={() => setFailed(true)} />
        </CanvasBoundary>
      ) : null}
    </div>
  );
}
