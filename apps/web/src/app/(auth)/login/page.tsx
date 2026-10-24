import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/brand/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh bg-espresso text-cream lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden border-r border-white/5 p-12 lg:flex lg:flex-col">
        <Link href="/" aria-label="DUMPWISE home" className="w-fit"><Logo /></Link>
        <div className="mt-auto max-w-lg">
          <p className="text-xs uppercase tracking-[0.3em] text-ember">Workspace</p>
          <h1 className="font-display mt-4 text-5xl leading-[1.02] tracking-tight xl:text-6xl">
            Reconciled numbers,<br />
            <em className="text-ember">nothing invented.</em>
          </h1>
          <p className="mt-6 text-warm-400">
            Every figure in DUMPWISE comes from an import that passed reconciliation against its control totals
            and was published by an owner of your organization.
          </p>
        </div>
        <div aria-hidden className="pointer-events-none absolute -right-24 top-1/4 h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(240,120,55,0.22),transparent_65%)]" />
      </section>
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" aria-label="DUMPWISE home" className="mb-10 inline-flex lg:hidden"><Logo /></Link>
          <h2 className="font-display text-3xl tracking-tight">Sign in</h2>
          <p className="mt-2 text-sm text-warm-400">Use the account your organization owner created for you.</p>
          <Suspense fallback={<div className="mt-8 h-64" />}>
            <LoginForm />
          </Suspense>
          <p className="mt-10 text-xs text-warm-500">
            No public sign-up: accounts are provisioned by an operator. Forgot your password? Ask your DUMPWISE administrator
            for a reset (self-service reset is not available yet).
          </p>
        </div>
      </section>
    </div>
  );
}
