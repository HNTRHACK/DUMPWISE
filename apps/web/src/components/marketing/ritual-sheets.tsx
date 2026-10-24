"use client";

import { useRef } from "react";
import { gsap, useGSAP } from "./gsap";

// Fragmented, clearly SYNTHETIC "SAP export" sheets that drift apart as you scroll:
// the visual problem statement of section 2.
const SHEETS = [
  { title: "VF05_billing_oct.csv", rows: [["17.09.2026", "0090000908", "F2", "818783.64"], ["30.04.2026", "90000562", "F2", "1589.08"], ["31.02.2026", "0099000001", "F2", "100.00"]] },
  { title: "credit_memos_FINAL_v7.csv", rows: [["12.08.2026", "0070000044", "G2", "2410.15"], ["12.08.2026", "0070000044", "G2", "2410.15"], ["03/05/2026", "0070000051", "G2", "1,234.00"]] },
  { title: "returns (2).csv", rows: [["21.07.2026", "0060000017", "RE", "-5"], ["22.07.2026", "0060000018", "RE", "640.00"], ["23.07.2026", "", "RE", "88.10"]] },
  { title: "dist_master_copy.xlsx", rows: [["0000100001", "Pune", "INR", "✓"], ["100002", "Nagpur", "Rupees", "?"], ["0000100008", "Export Hub", "USD", "✓"]] },
];

export function RitualSheets() {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.utils.toArray<HTMLElement>("[data-sheet]").forEach((el, i) => {
          gsap.fromTo(
            el,
            { y: 40 + i * 30, rotate: (i % 2 ? 1 : -1) * (2 + i), x: 0 },
            {
              y: -30 - i * 25,
              x: (i % 2 ? 1 : -1) * (18 + i * 10),
              rotate: (i % 2 ? -1 : 1) * (4 + i * 2.5),
              ease: "none",
              scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: 0.6 },
            },
          );
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} className="relative mx-auto h-[460px] w-full max-w-[520px]" role="img" aria-label="Several messy, synthetic SAP export files with conflicting formats, duplicates and invalid values">
      {SHEETS.map((s, i) => (
        <div
          key={s.title}
          data-sheet
          className="absolute w-[88%] rounded-xl border border-white/10 bg-[#1b130f]/95 p-4 font-mono text-[11px] text-warm-300 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)]"
          style={{ top: `${i * 22}%`, left: `${(i % 2) * 12}%`, transform: `rotate(${(i % 2 ? 1 : -1) * (2 + i)}deg)` }}
        >
          <div className="mb-3 flex items-center justify-between text-[10px] uppercase tracking-wider text-warm-500">
            <span>{s.title}</span>
            <span className="rounded bg-ember/15 px-1.5 py-0.5 text-ember">synthetic</span>
          </div>
          {s.rows.map((r, j) => (
            <div key={j} className="grid grid-cols-4 gap-2 border-t border-white/5 py-1.5">
              {r.map((c, k) => (
                <span key={k} className={/31\.02|03\/05|-5|Rupees|1,234|^$|^100002$|^90000562$/.test(c) || (i === 1 && j === 1) ? "text-[#f2877f]" : ""}>
                  {c || "—"}
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
