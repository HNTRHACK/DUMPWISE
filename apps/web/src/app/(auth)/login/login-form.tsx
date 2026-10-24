"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { ApiError, api } from "@/lib/api/client";
import { safeNext } from "@/lib/auth/safe-next";

const NOTICES: Record<string, string> = {
  expired: "Your session ended. Sign in again to continue.",
  "signed-out": "You have been signed out and the session was revoked.",
  "signed-out-unconfirmed": "You were signed out on this device, but the server could not confirm that the session was revoked.",
};

const fieldCls =
  "h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-[15px] text-cream placeholder:text-warm-500 transition-colors focus:border-ember/60 focus-visible:outline-2 focus-visible:outline-ember";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const notice = NOTICES[params.get("reason") ?? ""];
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return; // no duplicate submissions
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api.login(String(data.get("email") ?? ""), String(data.get("password") ?? ""));
      router.replace(safeNext(params.get("next")));
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setError(
        e?.kind === "unauthorized"
          ? "Invalid email or password."
          : e?.kind === "rate_limited"
            ? (e.messages[0] ?? "Too many attempts. Wait a few minutes and try again.")
            : e?.kind === "unavailable" || e?.kind === "timeout"
              ? "DUMPWISE could not be reached. Try again shortly."
              : (e?.messages[0] ?? "Sign-in failed."),
      );
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate aria-describedby={error ? errorId : undefined}>
      {notice ? <p role="status" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-warm-300">{notice}</p> : null}
      <div className="space-y-2">
        <label htmlFor={emailId} className="text-sm font-medium">Work email</label>
        <input id={emailId} name="email" type="email" autoComplete="username" required maxLength={254} className={fieldCls} />
      </div>
      <div className="space-y-2">
        <label htmlFor={passwordId} className="text-sm font-medium">Password</label>
        <input id={passwordId} name="password" type="password" autoComplete="current-password" required maxLength={128} className={fieldCls} />
      </div>
      {error ? <p id={errorId} role="alert" className="rounded-xl bg-[#2c1210] px-4 py-3 text-sm text-[#f2877f]">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ember font-medium text-espresso transition-colors hover:bg-ember-600 disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? "Signing in…" : "Sign in"}
        {!pending ? <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /> : null}
      </button>
    </form>
  );
}
