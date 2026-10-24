import type { Metadata } from "next";
import { PageIntro } from "@/components/marketing/page-intro";
import { Reveal } from "@/components/marketing/reveal";

export const metadata: Metadata = { title: "Security", description: "How DUMPWISE protects organization data: what is implemented today and what is coming." };

// Every item below corresponds to implemented and tested behaviour (docs/SECURITY.md).
const GROUPS = [
  {
    title: "Tenant isolation",
    items: [
      "Every business row belongs to one organization; composite foreign keys stop cross-organization links in the database itself.",
      "PostgreSQL row-level security on tenant tables: the API's database role sees only the organization of the current request, and nothing when no organization is set.",
      "Organization membership is checked on every request; a batch id from another organization is simply not found.",
    ],
  },
  {
    title: "Identity & sessions",
    items: [
      "Passwords hashed with scrypt; no plain-text passwords stored.",
      "Opaque, revocable session tokens stored only as hashes. Sign-out takes effect immediately.",
      "Refresh tokens rotate on every use; replaying an old one revokes the session.",
      "In this web app, tokens live in HttpOnly cookies that page scripts cannot read; state-changing requests carry CSRF protection.",
      "Per-network and per-account sign-in protection that slows password guessing without letting strangers lock you out.",
    ],
  },
  {
    title: "Data integrity",
    items: [
      "Every import is reconciled against control totals before it can be published; failed imports keep no rows.",
      "Only owners publish. Analysts import; viewers read.",
      "Existing records are never silently overwritten by a later import.",
      "Append-only audit events for imports, publications and sign-ins.",
    ],
  },
  {
    title: "Files & data handling",
    items: [
      "CSV only. Excel workbooks are detected and rejected without being opened, so macros can never run.",
      "Strict size, row and encoding limits.",
      "No company data is sent to external AI services.",
      "Synthetic demo data and production data are kept in separately classified organizations.",
    ],
  },
];

const UPCOMING = [
  "Single sign-on (e.g. Microsoft Entra ID) and multi-factor authentication",
  "Self-service password reset by e-mail",
  "Listing and revoking your other active sessions from the workspace",
  "Dedicated migration role and broader per-table security test coverage",
  "Independent penetration test",
];

export default function SecurityPage() {
  return (
    <>
      <PageIntro eyebrow="Security" title={<>Trust is a property of the <em className="text-ember">system</em>, not the slide deck.</>}>
        Below is what DUMPWISE does today. Where something is still on the way, we say so.
      </PageIntro>
      <Reveal as="section" className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8">
        <div className="grid gap-x-16 gap-y-14 lg:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title} data-reveal>
              <h2 className="border-b border-white/10 pb-4 text-xl font-medium text-cream">{g.title}</h2>
              <ul className="mt-5 space-y-4 text-warm-300">
                {g.items.map((i) => <li key={i} className="flex gap-3 leading-relaxed"><span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ember" />{i}</li>)}
              </ul>
            </div>
          ))}
        </div>
        <div data-reveal className="mt-24 rounded-3xl border border-dashed border-white/15 p-8">
          <h2 className="text-sm uppercase tracking-[0.24em] text-warm-400">Upcoming — not yet available</h2>
          <ul className="mt-5 grid gap-3 text-warm-300 md:grid-cols-2">
            {UPCOMING.map((u) => <li key={u}>— {u}</li>)}
          </ul>
        </div>
      </Reveal>
    </>
  );
}
