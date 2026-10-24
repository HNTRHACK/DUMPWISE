import { CursorFollower, ScrollProgress } from "@/components/marketing/interactions";
import { SiteFooter, SiteNav } from "@/components/marketing/site-nav";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grain min-h-dvh bg-espresso text-cream selection:bg-ember selection:text-espresso">
      <a href="#main" className="skip-link">Skip to content</a>
      <ScrollProgress />
      <CursorFollower />
      <SiteNav />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}
