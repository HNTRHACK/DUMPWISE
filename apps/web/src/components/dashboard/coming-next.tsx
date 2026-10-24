import { Construction } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui/primitives";

/**
 * Honest placeholder for analytics the backend cannot serve yet. No numbers are shown:
 * inventing results for these views would look like real business data.
 */
export function ComingNext({
  title,
  purpose,
  endpoint,
  dto,
}: {
  title: string;
  purpose: string;
  endpoint: string;
  dto: string;
}) {
  return (
    <>
      <PageHeader title={title} description={purpose} />
      <Card>
        <CardBody className="flex flex-col items-start gap-4 sm:flex-row">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-warning-bg text-warning"><Construction className="size-5" aria-hidden /></span>
          <div>
            <p className="font-medium text-text">Coming next — not available yet</p>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              The data is already stored per product, distributor and customer, but the API does not expose an analysis endpoint for this view yet.
              Nothing is shown here rather than estimated figures.
            </p>
          </div>
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader><CardTitle>Proposed API contract (not implemented)</CardTitle></CardHeader>
        <CardBody>
          <p className="font-mono text-sm text-accent-text">{endpoint}</p>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-surface-2 p-4 text-xs leading-relaxed text-text"><code>{dto}</code></pre>
          <p className="mt-3 text-xs text-muted">Documented in docs/API_INTEGRATION_MATRIX.md. Same rules as monthly sales: published batches only, organization-scoped, per currency, decimal strings.</p>
        </CardBody>
      </Card>
    </>
  );
}
