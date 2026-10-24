import { cn } from "@/lib/utils";

/**
 * DUMPWISE mark: scattered fragments (left) resolving into an ordered stack (right),
 * the "dump to decisions" idea in a 24px glyph. Original artwork.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden focusable="false">
      <rect x="2" y="6" width="7" height="3" rx="1" fill="currentColor" opacity=".35" transform="rotate(-18 5.5 7.5)" />
      <rect x="4" y="15" width="6" height="3" rx="1" fill="currentColor" opacity=".5" transform="rotate(12 7 16.5)" />
      <rect x="2.5" y="23" width="7" height="3" rx="1" fill="currentColor" opacity=".35" transform="rotate(-8 6 24.5)" />
      <rect x="15" y="7" width="15" height="3.4" rx="1.2" fill="currentColor" />
      <rect x="15" y="14.3" width="15" height="3.4" rx="1.2" fill="#F07837" />
      <rect x="15" y="21.6" width="15" height="3.4" rx="1.2" fill="currentColor" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-[0.18em]">DUMPWISE</span>
    </span>
  );
}
