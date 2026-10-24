import * as THREE from "three";

/**
 * Procedural layout for the Data Core (original geometry, no external assets).
 *
 * Every shard is a thin box (a "ledger panel"). It has two poses:
 *  - start:  scattered in a wide, shallow cloud with random rotation (raw SAP dumps)
 *  - target: one cell of a cylindrical lattice, panels facing outward (reconciled structure)
 * A deterministic PRNG keeps the composition identical on every visit.
 */
export interface ShardLayout {
  count: number;
  start: Float32Array; // xyz
  startQuat: Float32Array; // xyzw
  target: Float32Array; // xyz
  targetQuat: Float32Array; // xyzw
  scale: Float32Array; // xyz
  delay: Float32Array; // 0..1 stagger
  drift: Float32Array; // idle float phase/speed
  accent: Uint8Array; // 1 = turns ember when validated
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildLayout(count: number): ShardLayout {
  const rand = mulberry32(20261023);
  const L: ShardLayout = {
    count,
    start: new Float32Array(count * 3),
    startQuat: new Float32Array(count * 4),
    target: new Float32Array(count * 3),
    targetQuat: new Float32Array(count * 4),
    scale: new Float32Array(count * 3),
    delay: new Float32Array(count),
    drift: new Float32Array(count * 2),
    accent: new Uint8Array(count),
  };

  // Lattice: rings stacked vertically; ring radius gently bulges in the middle (a "core").
  const rings = Math.max(6, Math.round(Math.sqrt(count / 3.2)));
  const perRing = Math.ceil(count / rings);
  const height = 3.4;
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();

  for (let i = 0; i < count; i++) {
    const ring = Math.floor(i / perRing);
    const k = i % perRing;
    const v = rings === 1 ? 0.5 : ring / (rings - 1);
    const y = (v - 0.5) * height;
    const radius = 1.25 + 0.55 * Math.sin(Math.PI * v);
    const angle = (k / perRing) * Math.PI * 2 + (ring % 2) * (Math.PI / perRing);

    L.target.set([Math.cos(angle) * radius, y, Math.sin(angle) * radius], i * 3);
    e.set(0, -angle + Math.PI / 2, 0);
    q.setFromEuler(e);
    L.targetQuat.set([q.x, q.y, q.z, q.w], i * 4);

    // Scattered start in a wide, shallow cloud, biased away from the headline (left side).
    const sx = (rand() * 2 - 1) * 6.5 + 1.2;
    const sy = (rand() * 2 - 1) * 3.6;
    const sz = (rand() * 2 - 1) * 3 - 1;
    L.start.set([sx, sy, sz], i * 3);
    e.set(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
    q.setFromEuler(e);
    L.startQuat.set([q.x, q.y, q.z, q.w], i * 4);

    // Ledger-panel proportions: wide, short, thin. A few taller "sheet" panels.
    const sheet = rand() < 0.12;
    const width = ((Math.PI * 2 * radius) / perRing) * (0.72 + rand() * 0.18);
    L.scale.set([width, sheet ? 0.22 + rand() * 0.12 : 0.05 + rand() * 0.09, 0.012 + rand() * 0.02], i * 3);

    L.delay[i] = (v * 0.6 + rand() * 0.4);
    L.drift.set([rand() * Math.PI * 2, 0.4 + rand() * 0.6], i * 2);
    L.accent[i] = rand() < 0.16 ? 1 : 0;
  }
  return L;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
