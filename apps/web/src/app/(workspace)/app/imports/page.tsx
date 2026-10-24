"use client";

import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ImportStatusBadge } from "@/components/dashboard/import-status";
import { EmptyState, ErrorState } from "@/components/dashboard/states";
import { UploadPanel } from "@/components/dashboard/upload-panel";
import { useWorkspace } from "@/components/dashboard/workspace-provider";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { formatBytes, formatDateTime, formatInteger } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

const PAGE = 20;

export default function ImportsPage() {
  const { organization, can } = useWorkspace();
  const orgId = organization.organizationId;
  const [offset, setOffset] = useState(0);
  const list = useResource(`imports|${orgId}|${offset}`, (signal) => api.listImports(orgId, { limit: PAGE, offset }, signal));
  const total = list.data?.total ?? 0;

  return (
    <>
      <PageHeader title="Imports" description="Upload SAP billing exports, review validation and reconciliation, and publish reconciled batches." />

      {can("import") ? (
        <UploadPanel organizationId={orgId} onImported={() => { setOffset(0); list.reload(); }} />
      ) : (
        <Card className="flex items-start gap-3 p-5 text-sm text-muted">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>Your role (<strong className="text-text">{organization.role}</strong>) can view imports but not upload them. Owners and analysts can upload.</p>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Import batches</CardTitle>
          {total ? <span className="tabular text-xs text-muted">{formatInteger(total)} total</span> : null}
        </CardHeader>
        <CardBody className="px-0">
          {list.state === "error" && !list.data ? (
            <div className="px-5"><ErrorState error={list.error} onRetry={list.reload} /></div>
          ) : !list.data ? (
            <div className="space-y-2 px-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : list.data.items.length === 0 ? (
            <div className="px-5"><EmptyState title="No imports yet">Upload an SAP billing CSV with its control totals to begin.</EmptyState></div>
          ) : (
            <div className="overflow-x-auto" aria-busy={list.state === "loading"}>
              <table className="w-full min-w-[760px] text-sm">
                <caption className="sr-only">Import batches, newest first</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted">
                    <th scope="col" className="px-5 py-2.5 font-medium">File</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Status</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Rows inserted</th>
                    <th scope="col" className="px-5 py-2.5 text-right font-medium">Invalid</th>
                    <th scope="col" className="px-5 py-2.5 font-medium">Uploaded</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {list.data.items.map((b) => (
                    <tr key={b.id} className="border-b border-border/70 last:border-0 hover:bg-surface-2/50">
                      <td className="max-w-[22rem] px-5 py-3">
                        <Link href={`/app/imports/${b.id}`} className="block truncate font-medium text-text hover:text-accent-text">{b.fileName}</Link>
                        <span className="text-xs text-muted">{formatBytes(b.fileSizeBytes)} · {b.id.slice(0, 8)}{b.isSynthetic ? " · " : ""}</span>
                        {b.isSynthetic ? <Badge tone="accent" className="ml-0.5 py-0 text-[10px]">synthetic</Badge> : null}
                      </td>
                      <td className="px-5 py-3"><ImportStatusBadge status={b.status} /></td>
                      <td className="px-5 py-3 text-right">{formatInteger(b.stats.rowsInserted)}</td>
                      <td className={`px-5 py-3 text-right ${b.stats.rowsInvalid ? "text-danger" : ""}`}>{formatInteger(b.stats.rowsInvalid)}</td>
                      <td className="px-5 py-3 text-muted">{formatDateTime(b.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > PAGE ? (
            <nav aria-label="Pagination" className="flex items-center justify-between px-5 pt-4 text-sm">
              <span className="tabular text-muted">{offset + 1}–{Math.min(offset + PAGE, total)} of {formatInteger(total)}</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={offset === 0 || list.state === "loading"} onClick={() => setOffset(Math.max(0, offset - PAGE))}><ChevronLeft aria-hidden /> Previous</Button>
                <Button variant="secondary" size="sm" disabled={offset + PAGE >= total || list.state === "loading"} onClick={() => setOffset(offset + PAGE)}>Next <ChevronRight aria-hidden /></Button>
              </div>
            </nav>
          ) : null}
        </CardBody>
      </Card>
    </>
  );
}
