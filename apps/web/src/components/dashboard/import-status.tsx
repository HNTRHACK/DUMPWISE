import { Badge } from "@/components/ui/primitives";
import type { ImportStatus } from "@/lib/api/schemas";

const MAP: Record<ImportStatus, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  PUBLISHED: { label: "Published", tone: "success" },
  READY_TO_PUBLISH: { label: "Ready to publish", tone: "info" },
  RECONCILIATION_FAILED: { label: "Reconciliation failed", tone: "danger" },
  FAILED_VALIDATION: { label: "Failed validation", tone: "danger" },
  PROCESSING: { label: "Processing", tone: "neutral" },
};

export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  const s = MAP[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
