import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-espresso px-6 text-cream">
      <div className="text-center">
        <Logo className="justify-center" />
        <p className="font-display mt-10 text-8xl text-ember">404</p>
        <h1 className="mt-4 text-2xl">This page isn&apos;t in the ledger.</h1>
        <div className="mt-8 flex justify-center gap-4 text-sm">
          <Link href="/" className="rounded-full border border-white/15 px-5 py-2.5 hover:border-ember/60">Home</Link>
          <Link href="/app" className="rounded-full bg-ember px-5 py-2.5 font-medium text-espresso">Workspace</Link>
        </div>
      </div>
    </main>
  );
}
