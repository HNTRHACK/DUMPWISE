"use client";

import { useRef, useState } from "react";
import type { ProgressRef } from "@/components/three/data-core-canvas";
import { HeroStage } from "@/components/three/hero-stage";
import { cn } from "@/lib/utils";
import { gsap, ScrollTrigger, useGSAP } from "./gsap";
import { EnterWorkspace, Magnetic } from "./interactions";

const PHASES = [
  { label: "Raw data", text: "SAP exports arrive fragmented: different headers, formats and duplicates." },
  { label: "Validation", text: "Every row is typed and checked. Ambiguous values are rejected, never guessed." },
  { label: "Reconciliation", text: "Totals must match independent control totals to the paisa, or nothing is kept." },
  { label: "Insight", text: "Only reconciled, published data reaches the numbers your team decides on." },
];

export function HeroStory() {
  const root = useRef<HTMLElement>(null);
  // A stable mutable object shared with the render loop (written by GSAP, read per frame).
  const [progress] = useState<ProgressRef>(() => ({ value: 0 }));
  const [phase, setPhase] = useState(0);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        // Intro: headline lines rise into place once.
        gsap.from("[data-hero-line]", { yPercent: 110, duration: 1.3, ease: "expo.out", stagger: 0.09, delay: 0.15 });
        gsap.from("[data-hero-fade]", { autoAlpha: 0, y: 16, duration: 1, ease: "power3.out", delay: 0.6, stagger: 0.08 });

        // Scroll -> shared progress value read by the WebGL render loop (no React re-render).
        ScrollTrigger.create({
          trigger: root.current,
          start: "top top",
          end: "bottom bottom",
          onUpdate: (self) => {
            progress.value = self.progress;
            const next = Math.min(PHASES.length - 1, Math.floor(self.progress * PHASES.length * 0.999 + 0.0001));
            setPhase((p) => (p === next ? p : next));
          },
        });

        // Headline steps aside as the structure assembles.
        gsap.to("[data-hero-copy]", {
          yPercent: -14,
          autoAlpha: 0,
          ease: "none",
          scrollTrigger: { trigger: root.current, start: "top top", end: "30% top", scrub: true },
        });
        gsap.fromTo(
          "[data-hero-phases]",
          { autoAlpha: 0.0, y: 24 },
          { autoAlpha: 1, y: 0, ease: "none", scrollTrigger: { trigger: root.current, start: "8% top", end: "26% top", scrub: true } },
        );
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="hero-title" className="relative motion-safe:h-[360vh]">
      <div className="sticky top-0 h-dvh min-h-[620px] overflow-hidden motion-reduce:relative motion-reduce:h-auto motion-reduce:min-h-dvh">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_45%,#302019_0%,#110B08_62%)]" />
        <HeroStage progress={progress} />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-espresso to-transparent" />

        <div className="relative mx-auto flex h-full max-w-[1440px] flex-col justify-center px-5 sm:px-8 motion-reduce:h-auto motion-reduce:py-32">
          <div data-hero-copy className="max-w-[46rem] pt-16">
            <p data-hero-fade className="mb-6 text-xs uppercase tracking-[0.32em] text-ember">SAP exports → reconciled intelligence</p>
            <h1 id="hero-title" className="font-display text-[clamp(3rem,8.4vw,8.25rem)] leading-[0.92] tracking-[-0.035em]">
              <span className="block overflow-hidden pb-[0.06em]"><span data-hero-line className="block">Your data</span></span>
              <span className="block overflow-hidden pb-[0.06em]"><span data-hero-line className="block">has a story.</span></span>
              <span className="block overflow-hidden pb-[0.08em]"><span data-hero-line className="block italic text-ember">We make it speak.</span></span>
            </h1>
            <p data-hero-fade className="mt-8 max-w-xl text-lg leading-relaxed text-warm-300 sm:text-xl">
              Turn fragmented SAP exports into reconciled intelligence, meaningful forecasts and confident decisions.
            </p>
            <div data-hero-fade className="mt-10 flex flex-wrap items-center gap-4">
              <EnterWorkspace size="lg" />
              <Magnetic strength={6}>
                <a href="#process" className="inline-flex h-14 items-center rounded-full border border-white/15 px-7 text-sm text-cream transition-colors hover:border-ember/60 hover:text-white">
                  See how it works
                </a>
              </Magnetic>
            </div>
          </div>

          <ol data-hero-phases aria-label="How DUMPWISE transforms data" className="absolute bottom-8 left-5 right-5 grid grid-cols-2 gap-3 sm:left-8 sm:right-8 md:bottom-10 md:grid-cols-4 motion-reduce:static motion-reduce:mt-14">
            {PHASES.map((p, i) => (
              <li key={p.label} aria-current={phase === i ? "step" : undefined} className={cn("border-t pt-3 transition-colors duration-500", phase >= i ? "border-ember" : "border-white/15")}>
                <p className={cn("text-[11px] uppercase tracking-[0.24em] transition-colors duration-500", phase === i ? "text-ember" : "text-warm-500")}>
                  {String(i + 1).padStart(2, "0")} · {p.label}
                </p>
                <p className={cn("mt-1.5 hidden text-sm leading-snug transition-opacity duration-500 md:block", phase === i ? "text-cream opacity-100" : "text-warm-400 opacity-60")}>{p.text}</p>
              </li>
            ))}
          </ol>

          <div aria-hidden className="absolute bottom-32 right-8 hidden flex-col items-center gap-3 text-[10px] uppercase tracking-[0.3em] text-warm-500 md:flex motion-reduce:hidden">
            <span className="[writing-mode:vertical-rl]">Scroll</span>
            <span className="relative h-14 w-px overflow-hidden bg-white/10">
              <span className="absolute inset-x-0 top-0 h-1/2 animate-[scrollcue_2.2s_cubic-bezier(0.76,0,0.24,1)_infinite] bg-ember" />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
