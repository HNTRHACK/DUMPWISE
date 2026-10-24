import type { Metadata } from "next";
import { EnterWorkspace } from "@/components/marketing/interactions";
import { PageIntro } from "@/components/marketing/page-intro";
import { Reveal } from "@/components/marketing/reveal";

export const metadata: Metadata = { title: "Product", description: "How DUMPWISE turns SAP billing exports into reconciled sales intelligence." };

const MODULES: { name: string; status: "Available" | "Coming next" | "Roadmap"; points: string[] }[] = [
  {
    name: "Import center",
    status: "Available",
    points: [
      "SAP billing CSV with control totals; UTF-8; up to 20 MB and 200,000 rows",
      "Deterministic header recognition (SAP labels and technical names such as FKDAT, VBELN, NETWR)",
      "Row-level validation with line numbers; ambiguous dates, numbers and columns rejected",
      "Duplicate detection by SAP billing document and item; repeat imports are idempotent",
    ],
  },
  {
    name: "Reconciliation & publication",
    status: "Available",
    points: [
      "Net amount, line count and quantity reconciled per month, currency and unit",
      "Exact decimal comparison; any mismatch rolls the whole import back",
      "Owner-only publication; failed batches can never be published",
      "Every check stored as evidence, expected versus actual",
    ],
  },
  {
    name: "Sales intelligence",
    status: "Available",
    points: [
      "Monthly net sales with credit memos, returns and cancellations netted",
      "Per-currency reporting: no hidden conversion, no mixed totals",
      "3, 6 and 12 completed-month views; month-over-month growth when data supports it",
      "Units reported per unit of measure",
    ],
  },
  { name: "SKU, distributor & customer analysis", status: "Coming next", points: ["Built on the same reconciled, published data", "Data is already captured per material, sold-to and ship-to party"] },
  { name: "Demand forecasting", status: "Roadmap", points: ["30, 60 and 90-day forecasts with validated statistical models"] },
  { name: "Logistics cost & presentations", status: "Roadmap", points: ["Cost per kilogram, piece and shipment", "Editable management presentations"] },
];

export default function ProductPage() {
  return (
    <>
      <PageIntro eyebrow="Product" title={<>Built for the people who <em className="text-ember">close the month.</em></>}>
        DUMPWISE takes the SAP exports your team already produces and turns them into numbers that reconcile, so review meetings start with decisions instead of debates about whose spreadsheet is right.
      </PageIntro>
      <Reveal as="section" className="mx-auto max-w-[1440px] px-5 pb-32 sm:px-8">
        <ul className="grid gap-4 lg:grid-cols-2">
          {MODULES.map((m) => (
            <li key={m.name} data-reveal className="rounded-3xl border border-white/10 p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-medium text-cream">{m.name}</h2>
                <span className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] ${m.status === "Available" ? "bg-ember text-espresso" : "border border-white/15 text-warm-400"}`}>{m.status}</span>
              </div>
              <ul className="mt-6 space-y-2.5 text-sm text-warm-300">
                {m.points.map((p) => <li key={p} className="flex gap-3"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-ember" />{p}</li>)}
              </ul>
            </li>
          ))}
        </ul>
        <div data-reveal className="mt-20 flex flex-wrap items-center justify-between gap-6 rounded-3xl border border-white/10 p-10">
          <p className="font-display max-w-xl text-3xl tracking-tight">Already have an account? Your workspace is one click away.</p>
          <EnterWorkspace size="lg" />
        </div>
      </Reveal>
    </>
  );
}
