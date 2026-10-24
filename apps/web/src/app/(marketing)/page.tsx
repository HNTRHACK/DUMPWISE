import { ArrowUpRight, Check, Clock, FileSpreadsheet, Layers, ShieldCheck, Sigma } from "lucide-react";
import Link from "next/link";
import { DataToInsightDemo } from "@/components/marketing/demo";
import { HeroStory } from "@/components/marketing/hero-story";
import { EnterWorkspace } from "@/components/marketing/interactions";
import { Reveal } from "@/components/marketing/reveal";
import { RitualSheets } from "@/components/marketing/ritual-sheets";

const RITUAL = [
  "Export VF05. Then the credit memos. Then the returns.",
  "Paste into the master workbook. Fix dates that turned into text.",
  "VLOOKUP distributor names. Hunt for duplicates by eye.",
  "Reconcile against the ledger. Find the ₹1,234 that is really 1.234.",
  "Email sales_review_v7_FINAL_final.xlsx.",
];

const STEPS = [
  { n: "01", icon: FileSpreadsheet, title: "Ingest", body: "Upload the SAP billing CSV with its control totals. Spreadsheets are rejected unopened; macros can never run. SAP labels and technical field names are recognised deterministically." },
  { n: "02", icon: Layers, title: "Validate", body: "Dates, decimals, currencies and billing types are checked row by row. Ambiguous formats are rejected, duplicates detected by SAP document and item, identifiers keep their leading zeros." },
  { n: "03", icon: Sigma, title: "Reconcile", body: "Imported totals per month, currency and unit must equal the control totals exactly. One paisa off and the whole import rolls back, with the evidence kept." },
  { n: "04", icon: ShieldCheck, title: "Publish & decide", body: "An owner publishes the reconciled batch. Only then does it reach monthly sales reports, per currency, never mixed or converted." },
];

const INSIGHTS = [
  { area: "Sales", status: "Available", body: "Monthly net sales per currency with credit memos, returns and cancellations netted; 3, 6 and 12-month views and month-over-month growth." },
  { area: "Imports & reconciliation", status: "Available", body: "Every batch with row-level issues, duplicate counts and each reconciliation check, expected versus actual." },
  { area: "SKU performance", status: "Coming next", body: "Product-wise sales and units. The data is already captured per material; the analysis API is next." },
  { area: "Distributors & customers", status: "Coming next", body: "Sold-to and ship-to party analysis on the same reconciled data." },
  { area: "Forecasting", status: "Roadmap", body: "30, 60 and 90-day demand forecasts using validated statistical models." },
  { area: "Logistics & finance", status: "Roadmap", body: "Cost per kilogram, piece and shipment; management-ready presentations." },
];

const SECURITY = [
  "Organization data isolated by PostgreSQL row-level security and composite foreign keys",
  "Roles per organization: owner, analyst, viewer; only owners publish",
  "Revocable sessions; tokens stored only as hashes; refresh-token theft detection",
  "Rate limits and source-aware sign-in protection against password guessing",
  "Append-only audit trail for imports, publications and sign-ins",
  "Synthetic and production data are kept apart by design",
];
const UPCOMING = ["Single sign-on (SSO) and multi-factor authentication", "Live SAP extraction", "Independent penetration test"];

export default function HomePage() {
  return (
    <>
      <HeroStory />

      {/* 2 — The problem */}
      <Reveal as="section" className="relative mx-auto grid max-w-[1440px] items-center gap-16 px-5 py-32 sm:px-8 lg:grid-cols-2 lg:py-44">
        <div>
          <p data-reveal className="text-xs uppercase tracking-[0.3em] text-ember">The monthly ritual</p>
          <h2 data-reveal className="font-display mt-6 text-[clamp(2.5rem,5.5vw,5rem)] leading-[0.98] tracking-[-0.03em]">
            Your reports shouldn&apos;t require a <em className="text-ember">ritual.</em>
          </h2>
          <ol className="mt-10 space-y-4 border-l border-white/10 pl-6">
            {RITUAL.map((r, i) => (
              <li key={r} data-reveal className="text-warm-300">
                <span className="mr-3 font-mono text-xs text-warm-500">{String(i + 1).padStart(2, "0")}</span>
                {r}
              </li>
            ))}
          </ol>
        </div>
        <div data-reveal><RitualSheets /></div>
      </Reveal>

      {/* 3 — Process */}
      <Reveal as="section" className="border-y border-white/5 bg-[#140d0a] px-5 py-32 sm:px-8 lg:py-44">
        <div id="process" className="mx-auto max-w-[1440px] scroll-mt-24">
          <p data-reveal className="text-xs uppercase tracking-[0.3em] text-ember">How it works</p>
          <h2 data-reveal className="font-display mt-6 max-w-4xl text-[clamp(2.5rem,6vw,5.5rem)] leading-[0.95] tracking-[-0.035em]">
            From dump <span className="text-warm-500">to</span> decisions.
          </h2>
          <ol className="mt-20 grid gap-px overflow-hidden rounded-[28px] border border-white/10 bg-white/10 md:grid-cols-2 xl:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} data-reveal className="group relative bg-espresso p-8 transition-colors duration-500 hover:bg-[#1b130f]">
                <span className="font-display text-7xl text-white/[0.07] transition-colors duration-500 group-hover:text-ember/30">{s.n}</span>
                <s.icon className="mt-6 size-6 text-ember" aria-hidden />
                <h3 className="mt-4 text-xl font-medium text-cream">{s.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-warm-400">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </Reveal>

      {/* 4 — Interactive demo (synthetic) */}
      <Reveal as="section" className="mx-auto max-w-[1440px] px-5 py-32 sm:px-8 lg:py-44">
        <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p data-reveal className="text-xs uppercase tracking-[0.3em] text-ember">Try it</p>
            <h2 data-reveal className="font-display mt-6 text-[clamp(2.25rem,5vw,4.5rem)] leading-[0.98] tracking-[-0.03em]">Watch a messy export become a number you can trust.</h2>
          </div>
          <p data-reveal className="max-w-sm text-sm text-warm-400">Eight synthetic billing rows, the same rules the product applies. Step through with the tabs or your arrow keys.</p>
        </div>
        <div data-reveal><DataToInsightDemo /></div>
      </Reveal>

      {/* 5 — Insights */}
      <Reveal as="section" className="border-t border-white/5 px-5 py-32 sm:px-8 lg:py-44">
        <div className="mx-auto max-w-[1440px]">
          <h2 data-reveal className="font-display max-w-4xl text-[clamp(2.25rem,5vw,4.5rem)] leading-[0.98] tracking-[-0.03em]">
            One reconciled source. <span className="text-warm-500">Every lens your team needs.</span>
          </h2>
          <ul className="mt-16 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {INSIGHTS.map((it) => (
              <li key={it.area} data-reveal className="flex flex-col rounded-3xl border border-white/10 p-7 transition-colors duration-500 hover:border-ember/40">
                <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] ${it.status === "Available" ? "bg-ember text-espresso" : "border border-white/15 text-warm-400"}`}>
                  {it.status === "Available" ? <Check className="mr-1 inline size-3" aria-hidden /> : <Clock className="mr-1 inline size-3" aria-hidden />}
                  {it.status}
                </span>
                <h3 className="mt-6 text-2xl font-medium text-cream">{it.area}</h3>
                <p className="mt-3 text-sm leading-relaxed text-warm-400">{it.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>

      {/* 6 — Security */}
      <Reveal as="section" className="bg-cream px-5 py-32 text-espresso sm:px-8 lg:py-44">
        <div className="mx-auto grid max-w-[1440px] gap-16 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p data-reveal className="text-xs uppercase tracking-[0.3em] text-ember-700">Trust, by construction</p>
            <h2 data-reveal className="font-display mt-6 text-[clamp(2.5rem,5.5vw,5rem)] leading-[0.96] tracking-[-0.03em]">
              Numbers you can trace back to the row.
            </h2>
            <p data-reveal className="mt-6 max-w-md text-warm-700">Each published figure carries its batch, its reconciliation checks and who published it. Claims below describe what is built today.</p>
            <Link data-reveal href="/security" className="mt-8 inline-flex items-center gap-1.5 font-medium text-ember-700 underline-offset-4 hover:underline">
              Security details <ArrowUpRight className="size-4" aria-hidden />
            </Link>
          </div>
          <div>
            <ul className="divide-y divide-espresso/10 border-y border-espresso/10">
              {SECURITY.map((s) => (
                <li key={s} data-reveal className="flex gap-4 py-5 text-lg">
                  <Check className="mt-1 size-5 shrink-0 text-ember-700" aria-hidden />
                  {s}
                </li>
              ))}
            </ul>
            <p data-reveal className="mt-8 text-xs uppercase tracking-[0.2em] text-warm-600">Upcoming — not yet available</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {UPCOMING.map((u) => (
                <li key={u} data-reveal className="rounded-full border border-espresso/15 px-3 py-1.5 text-sm text-warm-700">{u}</li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>

      {/* 7 — CTA */}
      <Reveal as="section" className="relative overflow-hidden px-5 py-40 sm:px-8 lg:py-56">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[60rem] w-[60rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(240,120,55,0.16),transparent_60%)]" />
        <div className="relative mx-auto max-w-[1440px] text-center">
          <h2 data-reveal className="font-display text-[clamp(3.25rem,11vw,10.5rem)] leading-[0.88] tracking-[-0.045em]">
            Let your data<br /><em className="text-ember">speak.</em>
          </h2>
          <p data-reveal className="mx-auto mt-8 max-w-lg text-warm-300">Sign in to your organization&apos;s workspace, or explore the product first.</p>
          <div data-reveal className="mt-12 flex flex-wrap justify-center gap-4">
            <EnterWorkspace size="lg" label="Enter DUMPWISE" />
            <Link href="/product" className="inline-flex h-14 items-center rounded-full border border-white/15 px-7 text-sm hover:border-ember/60">Explore the product</Link>
          </div>
        </div>
      </Reveal>
    </>
  );
}
