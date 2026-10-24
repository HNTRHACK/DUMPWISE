"use client";

import { useRef } from "react";
import { gsap, ScrollTrigger, useGSAP } from "./gsap";

/**
 * Reveals descendants marked [data-reveal] as they enter the viewport (once).
 * Content is fully visible without JavaScript and with reduced motion: the hidden start
 * state is only applied by GSAP when motion is allowed.
 */
export function Reveal({ children, className, as: Tag = "div" }: { children: React.ReactNode; className?: string; as?: "div" | "section" }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const items = gsap.utils.toArray<HTMLElement>("[data-reveal]");
        // Opacity only, never visibility:hidden: hidden content must stay keyboard-focusable.
        gsap.set(items, { opacity: 0, y: 36 });
        ScrollTrigger.batch(items, {
          start: "top 88%",
          once: true,
          onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 1.1, ease: "expo.out", stagger: 0.08, overwrite: true }),
        });
        // Keyboard users may tab into a section before it scrolls into the trigger zone.
        const onFocus = (e: FocusEvent) => {
          const item = (e.target as Element | null)?.closest<HTMLElement>("[data-reveal]");
          if (item) gsap.to(item, { opacity: 1, y: 0, duration: 0.3, overwrite: true });
        };
        root.current?.addEventListener("focusin", onFocus);
        return () => root.current?.removeEventListener("focusin", onFocus);
      });
      return () => mm.revert();
    },
    { scope: root },
  );
  return (
    <Tag ref={root as React.RefObject<HTMLDivElement>} className={className}>
      {children}
    </Tag>
  );
}
