"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Accessible tab-like switcher (radiogroup semantics: arrow keys move the selection).
 * Currencies are shown one at a time because they are never converted or summed.
 */
export function CurrencyTabs({ currencies, value, onChange }: { currencies: string[]; value: string | null; onChange: (c: string) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (currencies.length < 2) return null;
  const move = (index: number) => {
    const next = (index + currencies.length) % currencies.length;
    onChange(currencies[next]);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Currency" className="inline-flex rounded-full border border-border bg-surface p-1">
      {currencies.map((c, i) => {
        const checked = c === value;
        return (
          <button
            key={c}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(c)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(i + 1); }
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(i - 1); }
            }}
            className={cn("rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition-colors", checked ? "bg-cocoa text-cream dark:bg-cream dark:text-espresso" : "text-muted hover:text-text")}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
