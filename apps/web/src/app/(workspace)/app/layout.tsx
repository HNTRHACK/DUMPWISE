import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { WorkspaceClient } from "@/components/dashboard/workspace-client";
import { COOKIE } from "@/lib/server/session";

export const metadata: Metadata = { title: "Workspace", robots: { index: false, follow: false } };

/**
 * Server-side gate: without a refresh cookie there is no session, so redirect before any
 * workspace UI renders. With Cache Components, cookies() must be read inside <Suspense>.
 * This is a convenience redirect only: every data request is still authorized by the API.
 */
async function SessionGate({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  if (!store.get(COOKIE.refresh)) redirect("/login?next=/app");
  return <WorkspaceClient>{children}</WorkspaceClient>;
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<WorkspaceBootScreen />}>
      <SessionGate>{children}</SessionGate>
    </Suspense>
  );
}

function WorkspaceBootScreen() {
  return (
    <div className="grid min-h-dvh place-items-center bg-espresso text-warm-400" role="status">
      <span className="text-sm tracking-[0.2em]">LOADING WORKSPACE…</span>
    </div>
  );
}
