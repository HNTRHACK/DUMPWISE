"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  BarChart3,
  Boxes,
  ChevronDown,
  FileUp,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Moon,
  Settings,
  Store,
  Sun,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { Badge, Select } from "@/components/ui/primitives";
import { formatMonth } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useWorkspace } from "./workspace-provider";

const NAV = [
  { href: "/app", label: "Overview", icon: LayoutDashboard },
  { href: "/app/sales", label: "Sales", icon: BarChart3 },
  { href: "/app/imports", label: "Imports", icon: FileUp },
  { href: "/app/products", label: "Products", icon: Boxes },
  { href: "/app/distributors", label: "Distributors", icon: Store },
  { href: "/app/customers", label: "Customers", icon: Users },
  { href: "/app/reports", label: "Report center", icon: BarChart3 },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace">
      <ul className="space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                  active ? "bg-cocoa text-cream" : "text-warm-400 hover:bg-white/5 hover:text-cream",
                )}
              >
                <Icon className={cn("size-4", active ? "text-ember" : "")} aria-hidden />
                <span className="flex-1">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { organization } = useWorkspace();
  return (
    <div className="flex h-full flex-col gap-8 p-4 text-cream">
      <Link href="/" className="px-2 pt-2" aria-label="DUMPWISE home">
        <Logo />
      </Link>
      <Nav onNavigate={onNavigate} />
      <div className="mt-auto rounded-xl border border-white/10 p-3 text-xs text-warm-400">
        <p className="font-medium text-cream">{organization.organizationName}</p>
        <p className="mt-0.5">
          Role: <span className="text-cream">{organization.role}</span>
        </p>
        {organization.dataClassification === "SYNTHETIC" ? (
          <p className="mt-2 inline-flex rounded-full bg-ember/15 px-2 py-0.5 text-[11px] text-ember">Synthetic data</p>
        ) : null}
      </div>
    </div>
  );
}

function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  const { me, organization, setOrganizationId, preset, setPreset, range, theme, toggleTheme, signOut } = useWorkspace();
  const orgFieldId = useId();
  const rangeFieldId = useId();
  const [signOutError, setSignOutError] = useState<string | null>(null);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/75">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={onOpenNav}
          className="rounded-lg p-2 text-text hover:bg-surface-2 lg:hidden"
          aria-label="Open navigation"
        >
          <MenuIcon className="size-5" aria-hidden />
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor={orgFieldId} className="sr-only">Active organization</label>
          {me.memberships.length > 1 ? (
            <Select
              id={orgFieldId}
              value={organization.organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              className="h-9 max-w-[16rem] truncate"
            >
              {me.memberships.map((m) => (
                <option key={m.organizationId} value={m.organizationId}>
                  {m.organizationName}
                </option>
              ))}
            </Select>
          ) : (
            <span id={orgFieldId} className="truncate text-sm font-medium text-text">{organization.organizationName}</span>
          )}
          {organization.dataClassification === "SYNTHETIC" ? <Badge tone="accent" className="hidden sm:inline-flex">Synthetic</Badge> : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <label htmlFor={rangeFieldId} className="text-xs text-muted">Range</label>
            <Select
              id={rangeFieldId}
              value={preset}
              onChange={(e) => setPreset(Number(e.target.value) as 3 | 6 | 12)}
              className="h-9 w-auto"
              aria-describedby={`${rangeFieldId}-hint`}
            >
              <option value={3}>Last 3 completed months</option>
              <option value={6}>Last 6 completed months</option>
              <option value={12}>Last 12 completed months</option>
            </Select>
            <span id={`${rangeFieldId}-hint`} className="hidden text-xs text-muted xl:inline">
              {formatMonth(range.from)} – {formatMonth(range.to)}
            </span>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text"
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
          </button>

          <Menu.Root>
            <Menu.Trigger className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-2.5 text-sm hover:bg-surface-2">
              <span className="grid size-7 place-items-center rounded-full bg-cocoa text-xs font-semibold text-cream" aria-hidden>
                {me.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden max-w-[10rem] truncate sm:inline">{me.displayName}</span>
              <ChevronDown className="size-3.5 text-muted" aria-hidden />
              <span className="sr-only">Account menu</span>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content align="end" sideOffset={8} className="z-50 min-w-56 rounded-xl border border-border bg-surface p-1.5 text-sm text-text shadow-xl">
                <div className="px-2.5 py-2">
                  <p className="font-medium">{me.displayName}</p>
                  <p className="truncate text-xs text-muted">{me.email}</p>
                </div>
                <Menu.Separator className="my-1 h-px bg-border" />
                <Menu.Item asChild>
                  <Link href="/app/settings" className="flex items-center gap-2 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-surface-2">
                    <Settings className="size-4" aria-hidden /> Settings
                  </Link>
                </Menu.Item>
                <Menu.Item
                  onSelect={async () => {
                    const r = await signOut();
                    if (!r.ok) setSignOutError(r.message ?? "Sign-out could not be confirmed");
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 outline-none data-[highlighted]:bg-surface-2"
                >
                  <LogOut className="size-4" aria-hidden /> Sign out
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
      {signOutError ? <p role="alert" className="px-6 pb-2 text-xs text-danger">{signOutError}</p> : null}
    </header>
  );
}

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className="min-h-dvh bg-bg text-text">
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 hidden w-64 bg-espresso lg:block">
        <SidebarContent />
      </aside>
      {navOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" className="absolute inset-0 bg-espresso/60" aria-label="Close navigation" onClick={() => setNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-espresso">
            <button type="button" onClick={() => setNavOpen(false)} className="absolute right-3 top-3 rounded-lg p-2 text-warm-400 hover:text-cream" aria-label="Close navigation">
              <X className="size-5" aria-hidden />
            </button>
            <SidebarContent onNavigate={() => setNavOpen(false)} />
          </aside>
        </div>
      ) : null}
      <div className="lg:pl-64">
        <Topbar onOpenNav={() => setNavOpen(true)} />
        <main id="main" className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
