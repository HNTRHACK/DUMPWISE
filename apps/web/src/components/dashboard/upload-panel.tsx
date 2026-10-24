"use client";

import { FileJson, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, CardTitle, Label, Select } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api/client";
import type { ImportResult, TemplatePreview } from "@/lib/api/schemas";
import { useResource } from "@/lib/use-resource";
import { ImportTemplates } from './import-templates';
import { formatBytes, formatInteger } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InlineError } from "./states";
import { ImportStatusBadge } from "./import-status";

// Client-side checks are a USER CONVENIENCE only. The API re-validates everything: size,
// encoding, spreadsheet signatures (xlsx/xlsm are rejected unopened), headers and values.
const CSV_MAX = 20 * 1024 * 1024;
const TOTALS_MAX = 1024 * 1024;

export function checkCsv(file: File): string | null {
  if (!/\.csv$/i.test(file.name)) return "The SAP export must be a .csv file (spreadsheets are not accepted).";
  if (file.size === 0) return "The CSV file is empty.";
  if (file.size > CSV_MAX) return `The CSV file is ${formatBytes(file.size)}; the limit is 20 MB.`;
  return null;
}
export function checkTotals(file: File): string | null {
  if (!/\.json$/i.test(file.name)) return "Control totals must be a .json file.";
  if (file.size > TOTALS_MAX) return "Control totals must be at most 1 MB.";
  return null;
}

function DropZone({
  label,
  hint,
  accept,
  file,
  onFile,
  icon: Icon,
  disabled,
}: {
  label: string;
  hint: string;
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  icon: typeof FileSpreadsheet;
  disabled?: boolean;
}) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled && e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
      }}
      className={cn(
        "relative flex min-h-28 items-center gap-4 rounded-2xl border border-dashed p-4 transition-colors",
        over ? "border-ember bg-ember/5" : "border-border bg-surface-2/40",
        disabled && "opacity-60",
      )}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface text-accent-text"><Icon className="size-5" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="cursor-pointer text-sm font-medium text-text">
          {label} <span className="text-accent-text underline underline-offset-2">choose file</span>
        </label>
        <p className="text-xs text-muted">{file ? `${file.name} · ${formatBytes(file.size)}` : hint}</p>
        <input id={inputId} type="file" accept={accept} disabled={disabled} className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      </div>
      {file ? (
        <button type="button" onClick={() => onFile(null)} className="rounded-full p-1.5 text-muted hover:bg-surface hover:text-text" aria-label={`Remove ${file.name}`}>
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export function UploadPanel({ organizationId, onImported }: { organizationId: string; onImported: () => void }) {
  const [csv, setCsv] = useState<File | null>(null);
  const [totals, setTotals] = useState<File | null>(null);
  const [numberFormat, setNumberFormat] = useState<"PLAIN" | "EN_GROUPED">("PLAIN");
  const templates = useResource(`approved-templates|${organizationId}`, signal => api.templates(organizationId, signal));
  const [templateId, setTemplateId] = useState('');
  const [preview, setPreview] = useState<{ file: File; id: string; data: TemplatePreview } | null>(null);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const controller = useRef<AbortController | null>(null);

  async function submit() {
    if (pending) return; // prevent duplicate imports while one is running
    const problems = [csv ? checkCsv(csv) : "Choose the SAP billing CSV.", totals ? checkTotals(totals) : "Choose the control totals JSON."].filter(Boolean) as string[];
    setErrors(problems);
    if (problems.length || !csv || !totals) return;
    const form = new FormData();
    form.append("file", csv, csv.name);
    form.append("controlTotals", totals, totals.name);
    if (templateId) {
      if (!preview?.data.ok || preview.file !== csv || preview.id !== templateId) { setErrors(['Preview this file with the selected template first.']); return; }
      form.append('templateVersionId', templateId);
    } else form.append("numberFormat", numberFormat);
    controller.current = new AbortController();
    setPending(true);
    setResult(null);
    try {
      const r = await api.uploadImport(organizationId, form, controller.current.signal);
      setResult(r);
      onImported();
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError("unavailable", 0, ["Upload failed"]);
      setErrors(
        e.kind === "forbidden" ? ["Your role cannot upload imports. Only owners and analysts can."]
          : e.kind === "timeout" ? ["The upload timed out. It may still have been processed: check the import list before retrying."]
            : e.kind === "aborted" ? ["Upload cancelled. If the server already received it, it will appear in the list."]
              : e.messages,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <><ImportTemplates onChanged={templates.reload} /><Card>
      <CardHeader>
        <div>
          <CardTitle>Upload an SAP billing export</CardTitle>
          <p className="mt-1 text-xs text-muted">CSV (UTF-8) plus its control totals JSON. Files are parsed as text only; spreadsheets and macros are never opened.</p>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <DropZone label="SAP billing CSV" hint=".csv · up to 20 MB" accept=".csv,text/csv" file={csv} onFile={setCsv} icon={FileSpreadsheet} disabled={pending} />
          <DropZone label="Control totals" hint=".json · up to 1 MB" accept=".json,application/json" file={totals} onFile={setTotals} icon={FileJson} disabled={pending} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Mapping version<Select aria-label="Mapping version" value={templateId} disabled={pending} onChange={e => { setTemplateId(e.target.value); setPreview(null); }}>
            <option value="">Standard SAP aliases (legacy)</option>
            {templates.data?.items.filter(t => t.status === 'APPROVED').map(t => <option key={t.id} value={t.id}>{t.name} v{t.version}</option>)}
          </Select></label>
          <div className="space-y-1.5">
            <Label htmlFor="number-format">Number format</Label>
            <Select id="number-format" value={numberFormat} disabled={pending || !!templateId} onChange={(e) => setNumberFormat(e.target.value as "PLAIN" | "EN_GROUPED")} className="w-auto">
              <option value="PLAIN">Plain (1234.56)</option>
              <option value="EN_GROUPED">Grouped (1,234.56 or 12,34,567.89)</option>
            </Select>
          </div>
          {templateId ? <Button variant="secondary" disabled={pending || !csv} onClick={async () => {
            if (!csv) return;
            const problem = checkCsv(csv); if (problem) { setErrors([problem]); return; }
            setPending(true); setErrors([]); setPreview(null);
            try { setPreview({ file: csv, id: templateId, data: await api.previewTemplate(organizationId, templateId, csv) }); }
            catch (e) { setErrors(e instanceof ApiError ? e.messages : ['Preview failed']); }
            finally { setPending(false); }
          }}>Preview mapping and rows</Button> : null}
          <Button onClick={submit} disabled={pending} className="ml-auto">
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            {pending ? "Importing…" : "Import"}
          </Button>
          {pending ? <Button variant="ghost" onClick={() => controller.current?.abort()}>Cancel</Button> : null}
        </div>
        <InlineError messages={errors} />
        {templates.state === 'error' ? <p className="text-sm text-danger">Custom mappings could not be loaded. <button className="underline" onClick={templates.reload}>Retry templates</button></p> : null}
        {preview && preview.file === csv && preview.id === templateId ? <div role="status" className="rounded-xl border border-border p-4 text-sm">
          <p>File preview: {preview.data.stats.rowsValid} accepted; {preview.data.stats.rowsInvalid} rejected; {preview.data.stats.rowsDuplicateInFile} duplicates. Reconciliation has not run.</p>
          <details><summary className="cursor-pointer">Column interpretation and issues</summary><ul>{preview.data.mapping.map(m => <li key={m.field}>{m.header} → {m.field}: {m.interpretation}</li>)}</ul>
            <ul>{preview.data.issues.map((i, n) => <li key={n}>Line {i.line ?? '—'}: {i.message}</li>)}</ul>
            {preview.data.issuesTruncated ? <p>Only the first 500 issues are shown.</p> : null}
          </details>
        </div> : null}
        {result ? <ImportResultView result={result} /> : null}
      </CardBody>
    </Card></>
  );
}

const OUTCOME: Record<ImportResult["outcome"], { text: string; tone: "success" | "info" | "danger" }> = {
  IMPORTED: { text: "Imported and reconciled. An owner can now publish it.", tone: "success" },
  ALREADY_IMPORTED: { text: "This exact file was imported before. Nothing changed.", tone: "info" },
  FAILED_VALIDATION: { text: "The file failed validation. Nothing was imported.", tone: "danger" },
  RECONCILIATION_FAILED: { text: "Totals did not reconcile. All rows were rolled back; publication is blocked.", tone: "danger" },
};

function ImportResultView({ result }: { result: ImportResult }) {
  const failed = result.reconciliation.filter((c) => !c.passed);
  const outcome = OUTCOME[result.outcome];
  const s = result.stats;
  return (
    <div role="status" className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={outcome.tone}>{result.outcome.replaceAll("_", " ").toLowerCase()}</Badge>
        {/* For failures the batch status repeats the outcome; show it only when it adds information. */}
        {result.outcome === "IMPORTED" || result.outcome === "ALREADY_IMPORTED" ? <ImportStatusBadge status={result.status} /> : null}
        <Link href={`/app/imports/${result.batchId}`} className={cn(buttonVariants({ variant: "link", size: "sm" }), "ml-auto")}>Open batch</Link>
      </div>
      <p className="mt-2 text-sm text-text">{outcome.text}</p>
      <dl className="tabular mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        {([["Rows in file", s.rowsTotal], ["Valid", s.rowsValid], ["Invalid", s.rowsInvalid], ["Duplicates in file", s.rowsDuplicateInFile], ["Already imported", s.rowsAlreadyImported], ["Inserted", s.rowsInserted]] as const).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-border/60 py-1"><dt className="text-muted">{k}</dt><dd className="text-text">{formatInteger(v)}</dd></div>
        ))}
      </dl>
      {result.reconciliation.length ? (
        <p className="mt-3 text-sm text-muted">Reconciliation: {result.reconciliation.length - failed.length} of {result.reconciliation.length} checks passed.</p>
      ) : null}
      {result.issues.filter((i) => i.severity === "error").length ? (
        <p className="mt-1 text-sm text-muted">{result.issues.filter((i) => i.severity === "error").length} row/file errors reported. Open the batch for details.</p>
      ) : null}
    </div>
  );
}
