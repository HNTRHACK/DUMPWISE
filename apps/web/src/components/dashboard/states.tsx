import { AlertTriangle, Ban, CloudOff, Inbox, Lock, RefreshCw, SearchX, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

// One consistent vocabulary for loading / empty / error / permission states across pages.

export function StatePanel({
  icon: Icon,
  title,
  children,
  action,
  tone = "neutral",
  className,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "neutral" | "danger" | "warning";
  className?: string;
}) {
  return (
    <div
      role={tone === "neutral" ? "status" : "alert"}
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <span
        className={cn(
          "mb-3 grid size-11 place-items-center rounded-full",
          tone === "danger" ? "bg-danger-bg text-danger" : tone === "warning" ? "bg-warning-bg text-warning" : "bg-surface-2 text-muted",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="font-medium text-text">{title}</p>
      {children ? <div className="mt-1 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <StatePanel icon={Inbox} title={title} action={action}>
      {children}
    </StatePanel>
  );
}

const errorCopy: Record<ApiError["kind"], { icon: typeof AlertTriangle; title: string; body: string }> = {
  unauthorized: { icon: Lock, title: "Your session has ended", body: "Sign in again to continue." },
  forbidden: { icon: Ban, title: "You don't have access to this", body: "Your role in this organization does not allow this action. Ask an owner if you need access." },
  not_found: { icon: SearchX, title: "Not found", body: "It may belong to another organization or no longer exist." },
  conflict: { icon: AlertTriangle, title: "This action is blocked", body: "" },
  invalid: { icon: AlertTriangle, title: "The request was rejected", body: "" },
  rate_limited: { icon: Timer, title: "Too many requests", body: "Wait a moment, then try again." },
  timeout: { icon: Timer, title: "The request timed out", body: "The server took too long to answer. Try again." },
  unavailable: { icon: CloudOff, title: "DUMPWISE is unavailable", body: "The API could not be reached. Try again shortly." },
  contract: { icon: AlertTriangle, title: "Unexpected server response", body: "The response did not match the expected format, so it was not displayed." },
  aborted: { icon: RefreshCw, title: "Cancelled", body: "" },
};

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const copy = errorCopy[error.kind];
  const detail = ["conflict", "invalid"].includes(error.kind) ? error.messages.join(" ") : copy.body;
  const retryable = ["timeout", "unavailable", "rate_limited", "contract"].includes(error.kind);
  return (
    <StatePanel
      icon={copy.icon}
      title={copy.title}
      tone={error.kind === "forbidden" ? "warning" : "danger"}
      action={retryable && onRetry ? <Button variant="secondary" onClick={onRetry}><RefreshCw aria-hidden /> Try again</Button> : undefined}
    >
      {detail}
    </StatePanel>
  );
}

export function InlineError({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
      {messages.length === 1 ? messages[0] : (
        <ul className="list-disc pl-4">{messages.map((m) => <li key={m}>{m}</li>)}</ul>
      )}
    </div>
  );
}
