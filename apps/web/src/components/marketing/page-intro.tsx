export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden px-5 pb-20 pt-40 sm:px-8 lg:pb-28 lg:pt-52">
      <div aria-hidden className="pointer-events-none absolute -right-40 top-10 h-[40rem] w-[40rem] rounded-full bg-[radial-gradient(circle,rgba(240,120,55,0.14),transparent_62%)]" />
      <div className="relative mx-auto max-w-[1440px]">
        <p className="text-xs uppercase tracking-[0.3em] text-ember">{eyebrow}</p>
        <h1 className="font-display mt-6 max-w-5xl text-[clamp(2.75rem,7vw,6.5rem)] leading-[0.94] tracking-[-0.035em]">{title}</h1>
        {children ? <div className="mt-8 max-w-2xl text-lg leading-relaxed text-warm-300">{children}</div> : null}
      </div>
    </section>
  );
}
