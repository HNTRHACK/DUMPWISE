"use client";

import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/use-media";
import { cn } from "@/lib/utils";

// Interactive "data to insight" walkthrough. EVERY value here is synthetic demo data,
// hard-coded below and labelled as such in the UI. It never calls the API.

type Row = { line: number; date: string; doc: string; type: string; qty: string; net: string; cur: string; issue?: string; dup?: boolean };

const ROWS: Row[] = [
  { line: 2, date: "04.09.2026", doc: "0090001101", type: "F2", qty: "120", net: "48000.00", cur: "INR" },
  { line: 3, date: "07.09.2026", doc: "0090001102", type: "F2", qty: "80", net: "36500.00", cur: "INR" },
  { line: 4, date: "07.09.2026", doc: "0090001102", type: "F2", qty: "80", net: "36500.00", cur: "INR", dup: true },
  { line: 5, date: "31.02.2026", doc: "0090001103", type: "F2", qty: "10", net: "4100.00", cur: "INR", issue: "Date does not exist" },
  { line: 6, date: "12.09.2026", doc: "0070000210", type: "G2", qty: "0", net: "1500.00", cur: "INR" },
  { line: 7, date: "15.09.2026", doc: "0060000088", type: "RE", qty: "5", net: "2000.00", cur: "INR" },
  { line: 8, date: "18.09.2026", doc: "0090001104", type: "F2", qty: "-5", net: "900.00", cur: "INR", issue: "Negative quantity; sign comes from billing type" },
  { line: 9, date: "21.09.2026", doc: "0090001105", type: "ZF2", qty: "12", net: "5200.00", cur: "INR", issue: "Unsupported billing type" },
];
// Net = 48000 + 36500 - 1500 (G2) - 2000 (RE) = 81000.00 · 4 valid rows · units 120 + 80 - 5 = 195
const EXPECTED = { net: 81000, lines: 4, units: 195 };
const MONTHS = [
  { m: "Jun", v: 62.4 },
  { m: "Jul", v: 70.1 },
  { m: "Aug", v: 74.8 },
  { m: "Sep", v: 81.0 },
];

const STEPS = ["Raw export", "Validated", "Reconciled", "Insight"] as const;

/** Counts up to `target` once `run` becomes true. Reduced motion: shows the final value. */
function useCountUp(target: number, run: boolean, ms = 900) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!run || reduced) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setValue(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, run, ms, reduced]);
  return run && !reduced ? value : target;
}

const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

export function DataToInsightDemo() {
  const [step, setStep] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const net = useCountUp(EXPECTED.net, step >= 2);

  const select = (i: number) => {
    const next = (i + STEPS.length) % STEPS.length;
    setStep(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[#170f0b]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div role="tablist" aria-label="Demo stage" className="flex flex-wrap gap-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              role="tab"
              id={`demo-tab-${i}`}
              aria-selected={step === i}
              aria-controls="demo-panel"
              tabIndex={step === i ? 0 : -1}
              onClick={() => setStep(i)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight") select(step + 1);
                if (e.key === "ArrowLeft") select(step - 1);
              }}
              className={cn("rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors", step === i ? "bg-ember text-espresso" : "text-warm-400 hover:text-cream")}
            >
              {String(i + 1).padStart(2, "0")} {s}
            </button>
          ))}
        </div>
        <span className="rounded-full border border-ember/40 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-ember">Synthetic demo data</span>
      </div>

      <div id="demo-panel" role="tabpanel" aria-labelledby={`demo-tab-${step}`} className="grid gap-0 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[560px] font-mono text-[12px]">
            <caption className="sr-only">Synthetic SAP billing rows at stage: {STEPS[step]}</caption>
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-warm-500">
                <th scope="col" className="py-2 pr-3 font-normal">Line</th>
                <th scope="col" className="py-2 pr-3 font-normal">Billing date</th>
                <th scope="col" className="py-2 pr-3 font-normal">Document</th>
                <th scope="col" className="py-2 pr-3 font-normal">Type</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Qty</th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">Net value</th>
                <th scope="col" className="py-2 font-normal"><span className="sr-only">Status</span></th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const rejected = step >= 1 && (r.issue || r.dup);
                return (
                  <tr key={r.line} className={cn("border-t border-white/5 transition-opacity duration-500", rejected && step >= 2 ? "opacity-25" : "opacity-100")}>
                    <td className="py-2 pr-3 text-warm-500">{r.line}</td>
                    <td className={cn("py-2 pr-3", step >= 1 && r.issue?.startsWith("Date") ? "text-[#f2877f]" : "text-warm-300")}>{r.date}</td>
                    <td className="py-2 pr-3 text-warm-300">{r.doc}</td>
                    <td className={cn("py-2 pr-3", step >= 1 && r.issue?.startsWith("Unsupported") ? "text-[#f2877f]" : r.type === "F2" ? "text-cream" : "text-ember")}>{r.type}</td>
                    <td className={cn("py-2 pr-3 text-right", step >= 1 && r.issue?.startsWith("Negative") ? "text-[#f2877f]" : "text-warm-300")}>{r.qty}</td>
                    <td className="py-2 pr-3 text-right text-cream">{step >= 1 && (r.type === "G2" || r.type === "RE") && !r.issue ? `−${r.net}` : r.net}</td>
                    <td className="py-2 text-[11px]">
                      {step === 0 ? null : rejected ? (
                        <span className="inline-flex items-center gap-1 text-[#f2877f]"><X className="size-3" aria-hidden />{r.dup ? "Duplicate of line 3" : r.issue}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[#6cc08c]"><Check className="size-3" aria-hidden />Valid</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="border-t border-white/10 p-6 lg:border-l lg:border-t-0">
          {step === 0 ? (
            <StageText title="A typical export" body="Mixed date formats, a duplicated document, an impossible date, a negative quantity and an unknown billing type. Most tools would import all of it." />
          ) : step === 1 ? (
            <StageText title="Validated, row by row" body="4 rows rejected with a line number and reason. Credit memos (G2) and returns (RE) become negative by documented rules; nothing ambiguous is guessed." />
          ) : step === 2 ? (
            <div>
              <StageText title="Reconciled to control totals" body="The imported totals are compared with independently produced control totals. Any mismatch rolls the whole import back." />
              <dl className="mt-6 space-y-3 font-mono text-sm">
                {[["Net value", inr(net), inr(EXPECTED.net)], ["Line items", String(EXPECTED.lines), String(EXPECTED.lines)], ["Net units", String(EXPECTED.units), String(EXPECTED.units)]].map(([k, a, e]) => (
                  <div key={k} className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                    <dt className="text-warm-400">{k}</dt>
                    <dd className="tabular flex items-center gap-2 text-cream">{a}<span className="text-warm-500">= {e}</span><Check className="size-4 text-[#6cc08c]" aria-label="matches" /></dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <div>
              <StageText title="Published insight" body="Only after an owner publishes does the month appear in sales reports: here, four months of synthetic net sales (₹ thousand)." />
              <div className="mt-6 flex h-40 items-end gap-3" role="img" aria-label="Synthetic net sales June to September: 62.4, 70.1, 74.8 and 81.0 thousand rupees">
                {MONTHS.map((m, i) => (
                  <div key={m.m} className="flex flex-1 flex-col items-center gap-2">
                    <span className="tabular text-[11px] text-warm-400">{m.v.toFixed(1)}</span>
                    <div className="w-full origin-bottom rounded-t-md bg-ember transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ height: `${(m.v / 81) * 100}px`, transitionDelay: `${i * 80}ms`, opacity: i === MONTHS.length - 1 ? 1 : 0.45 }} />
                    <span className="text-[11px] text-warm-500">{m.m}</span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-sm text-warm-300">Sep vs Aug: <span className="text-ember">+8.3%</span> month over month.</p>
            </div>
          )}
          <button type="button" onClick={() => setStep((s) => (s + 1) % STEPS.length)} className="mt-8 text-sm text-ember underline-offset-4 hover:underline">
            {step === STEPS.length - 1 ? "Start again" : `Next: ${STEPS[step + 1]} →`}
          </button>
        </div>
      </div>
    </div>
  );
}

function StageText({ title, body }: { title: string; body: string }) {
  return (
    <>
      <p className="font-display text-2xl tracking-tight text-cream">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-warm-300">{body}</p>
    </>
  );
}
