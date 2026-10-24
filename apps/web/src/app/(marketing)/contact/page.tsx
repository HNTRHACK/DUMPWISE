import type { Metadata } from "next";
import { EnterWorkspace } from "@/components/marketing/interactions";
import { PageIntro } from "@/components/marketing/page-intro";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <>
      <PageIntro eyebrow="Contact" title={<>Let&apos;s talk about your <em className="text-ember">month-end.</em></>}>
        DUMPWISE is in an early pilot with manufacturing and distribution teams running SAP.
      </PageIntro>
      <section className="mx-auto grid max-w-[1440px] gap-6 px-5 pb-32 sm:px-8 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/10 p-8">
          <h2 className="text-xl font-medium text-cream">Existing customers</h2>
          <p className="mt-3 text-warm-300">Sign in to your workspace. For account access or password resets, contact the administrator who created your account.</p>
          <div className="mt-6"><EnterWorkspace /></div>
        </div>
        <div className="rounded-3xl border border-dashed border-white/15 p-8">
          <h2 className="text-xl font-medium text-cream">Pilot enquiries</h2>
          <p className="mt-3 text-warm-300">
            An online enquiry form is not connected yet, so this page does not collect your details. Reach the DUMPWISE team through the contact who shared this site with you.
          </p>
          <p className="mt-6 inline-flex rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-[0.2em] text-warm-400">Enquiry form — coming soon</p>
        </div>
      </section>
    </>
  );
}
