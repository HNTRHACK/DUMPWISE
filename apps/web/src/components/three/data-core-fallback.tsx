/**
 * Static SVG version of the Data Core: fragments on the left resolving into an ordered,
 * glowing lattice on the right. Shown for reduced motion, missing WebGL, low-power devices,
 * on first paint before 3D loads, and if WebGL fails at runtime.
 */
// Integer-only PRNG + rounding: identical output on the server (Node) and in every browser
// engine, so React hydration never sees different attribute values.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const round = (n: number) => Math.round(n * 10) / 10;

const SHARDS = (() => {
  const r = seeded(20261023);
  return Array.from({ length: 26 }, () => ({
    x: round(40 + r() * 300), y: round(60 + r() * 480), w: round(30 + r() * 60), h: round(5 + r() * 10), a: round(r() * 70 - 35), o: round(0.18 + r() * 0.35),
  }));
})();

export function DataCoreFallback({ className }: { className?: string }) {
  const shards = SHARDS;
  // Precomputed bulge (70 + 40·sin(πv)), rounded, so no floating-point trig runs at render.
  const rings = [70, 85.3, 98.3, 107, 110, 107, 98.3, 85.3, 70].map((rx, i) => ({ y: 120 + i * 45, rx }));
  return (
    <svg viewBox="0 0 900 640" className={className} role="img" aria-label="Fragmented data panels converging into an ordered, glowing data core">
      <defs>
        <radialGradient id="dw-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F07837" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#F07837" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#F07837" stopOpacity="0" />
        </radialGradient>
      </defs>
      {shards.map((s, i) => (
        <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx="1.5" fill="#F4E8D9" opacity={s.o} transform={`rotate(${s.a} ${s.x + s.w / 2} ${s.y + s.h / 2})`} />
      ))}
      <circle cx="640" cy="320" r="230" fill="url(#dw-core)" />
      {rings.map((r, i) => (
        <g key={i}>
          <ellipse cx="640" cy={r.y} rx={r.rx} ry={r.rx * 0.18} fill="none" stroke={i === 4 ? "#F07837" : "#F4E8D9"} strokeOpacity={i === 4 ? 0.9 : 0.35} strokeWidth={i === 4 ? 3 : 1.5} strokeDasharray="14 6" />
        </g>
      ))}
      <circle cx="640" cy="300" r="30" fill="#F07837" opacity="0.85" />
    </svg>
  );
}
