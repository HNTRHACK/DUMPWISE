"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const canAnimate = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(pointer: fine)").matches &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Wraps a control so it leans a few pixels toward the pointer. Purely decorative:
 * the element stays a normal link/button, fully usable by keyboard and touch.
 */
export function Magnetic({ children, strength = 10, className }: { children: React.ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !canAnimate()) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * strength * 2;
      const y = ((e.clientY - r.top) / r.height - 0.5) * strength * 2;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => (el.style.transform = `translate3d(${x}px, ${y}px, 0)`));
    };
    const leave = () => {
      cancelAnimationFrame(frame);
      el.style.transform = "translate3d(0,0,0)";
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [strength]);
  return (
    <span ref={ref} className={cn("inline-block transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform", className)}>
      {children}
    </span>
  );
}

/**
 * "Enter Workspace": links to /app when the non-secret session hint cookie is present,
 * otherwise to /login. Server-rendered as /login; upgraded after mount. The workspace
 * itself verifies the real session, so a stale hint only costs one redirect.
 */
const hasSessionHint = () => document.cookie.split("; ").includes("dw_session=1");

export function EnterWorkspace({ className, size = "md", label = "Enter Workspace" }: { className?: string; size?: "md" | "lg"; label?: string }) {
  // Cookies have no change event; reading on render/hydration is enough for a link target.
  const href = useSyncExternalStore(
    () => () => {},
    () => (hasSessionHint() ? "/app" : "/login"),
    () => "/login",
  );
  return (
    <Magnetic>
      <Link
        href={href}
        className={cn(
          "group inline-flex items-center gap-2 rounded-full bg-ember font-medium text-espresso transition-colors duration-300 hover:bg-[#ff8a4c]",
          size === "lg" ? "h-14 px-8 text-base" : "h-11 px-5 text-sm",
          className,
        )}
      >
        {label}
        <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </Magnetic>
  );
}

/** Thin page-scroll progress bar (transform-only updates, one rAF per scroll burst). */
export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (bar.current) bar.current.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return <div ref={bar} aria-hidden className="fixed inset-x-0 top-0 z-[70] h-[2px] origin-left scale-x-0 bg-ember" />;
}

/**
 * Soft ring that trails the pointer and grows over interactive elements. Only for fine
 * pointers without reduced motion; the native cursor stays visible (never replaced).
 */
export function CursorFollower() {
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ring.current;
    if (!el || !canAnimate()) return;
    el.style.opacity = "1";
    let x = -100, y = -100, tx = -100, ty = -100, frame = 0, hot = false;
    const tick = () => {
      x += (tx - x) * 0.18;
      y += (ty - y) * 0.18;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${hot ? 1.8 : 1})`;
      frame = Math.abs(tx - x) + Math.abs(ty - y) > 0.1 ? requestAnimationFrame(tick) : 0;
    };
    const move = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      hot = !!(e.target as Element | null)?.closest?.("a,button,[role=radio],[role=tab]");
      if (!frame) frame = requestAnimationFrame(tick); // loop only runs while the ring moves
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
    };
  }, []);
  return (
    <div
      ref={ring}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[80] size-7 rounded-full border border-ember/70 opacity-0 mix-blend-difference transition-[opacity,scale] duration-300"
    />
  );
}
