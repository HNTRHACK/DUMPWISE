"use client";

import { Building2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { ErrorState, StatePanel } from "./states";
import { WorkspaceShell } from "./shell";
import { WorkspaceProvider } from "./workspace-provider";

export function WorkspaceClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <WorkspaceProvider
      loading={
        <div className="grid min-h-dvh place-items-center bg-bg text-muted" role="status">
          <span className="inline-flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" aria-hidden /> Checking your session…</span>
        </div>
      }
      failed={(error, retry) => (
        <div className="grid min-h-dvh place-items-center bg-bg p-6">
          <div className="w-full max-w-lg"><ErrorState error={error} onRetry={retry} /></div>
        </div>
      )}
      noOrganizations={
        <div className="grid min-h-dvh place-items-center bg-bg p-6">
          <StatePanel
            icon={Building2}
            title="You are not a member of any organization yet"
            action={<Button variant="secondary" onClick={() => api.logout().finally(() => router.replace("/login?reason=signed-out"))}>Sign out</Button>}
          >
            An organization owner must add you before you can see data.
          </StatePanel>
        </div>
      }
    >
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceProvider>
  );
}
