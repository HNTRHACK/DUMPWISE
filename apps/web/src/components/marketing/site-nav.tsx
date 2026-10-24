"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { EnterWorkspace } from "./interactions";

const LINKS = [
  { href: "/product", label: "Product" },
  { href: "/security", label: "Security" },
  { href: "/contact", label: "Contact" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Scroll position is external state: subscribe with useSyncExternalStore (boolean snapshot,
  // so React only re-renders when the header crosses the 24px threshold).
  const scrolled = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("scroll", onChange, { passive: true });
      return () => window.removeEventListener("scroll", onChange);
    },
    () => window.scrollY > 24,
    () => false,
  );

  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 transition-colors duration-500", scrolled || open ? "bg-espresso/85 backdrop-blur-md" : "bg-transparent")}>
      <div className="mx-auto flex h-18 max-w-[1440px] items-center gap-6 px-5 py-4 sm:px-8">
        <Link href="/" aria-label="DUMPWISE home" className="text-cream"><Logo /></Link>
        <nav aria-label="Main" className="ml-auto hidden items-center gap-8 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={pathname === l.href ? "page" : undefined}
              className="group relative text-sm text-warm-300 transition-colors hover:text-cream aria-[current=page]:text-cream"
            >
              {l.label}
              <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-ember transition-transform duration-300 group-hover:scale-x-100 group-aria-[current=page]:scale-x-100" />
            </Link>
          ))}
          <EnterWorkspace />
        </nav>
        <button
          type="button"
          className="ml-auto rounded-full p-2 text-cream md:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </button>
      </div>
      {open ? (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-white/5 px-5 pb-6 md:hidden">
          <ul className="space-y-1 py-3">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)} className="block py-3 font-display text-3xl text-cream">{l.label}</Link>
              </li>
            ))}
          </ul>
          <EnterWorkspace className="w-full justify-center" />
        </nav>
      ) : null}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-white/5 bg-espresso px-5 py-14 text-sm text-warm-400 sm:px-8">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-10 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href="/" aria-label="DUMPWISE home" className="text-cream"><Logo /></Link>
          <p className="mt-4 max-w-sm">Enterprise intelligence from fragmented operational data. Built for Indian manufacturers and distributors running SAP.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3">
          <Link className="hover:text-cream" href="/product">Product</Link>
          <Link className="hover:text-cream" href="/security">Security</Link>
          <Link className="hover:text-cream" href="/contact">Contact</Link>
          <Link className="hover:text-cream" href="/login">Sign in</Link>
        </nav>
      </div>
      <p className="mx-auto mt-10 max-w-[1440px] text-xs text-warm-500">
        All figures shown on this website are synthetic demonstration data. DUMPWISE is not affiliated with SAP SE.
      </p>
    </footer>
  );
}
