"use client";

import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { buildLayout, smoothstep } from "./layout";
import type { RenderTier } from "./render-tier";

export interface ProgressRef {
  /** 0..1, written by GSAP ScrollTrigger; read every frame (no React re-render). */
  value: number;
}

const CREAM = new THREE.Color("#F4E8D9");
const STONE = new THREE.Color("#B8A898");
const COCOA = new THREE.Color("#6E625A");
const EMBER = new THREE.Color("#F07837");

/**
 * Render loop (useFrame, ~60 fps while visible):
 *   1. ease the displayed progress toward the scroll progress (damping => smooth motion)
 *   2. for every shard: blend start pose -> lattice pose with its own stagger delay
 *      (rotation aligns first = "validation", position follows = "reconciliation")
 *   3. raise the core glow and the warm point light at the end ("insight")
 */
function Shards({ tier, progress }: { tier: Exclude<RenderTier, "static">; progress: ProgressRef }) {
  const count = tier === "full" ? 540 : 200;
  const layout = useMemo(() => buildLayout(count), [count]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const shown = useRef(0);
  const frames = useRef(0);
  const colorStep = useRef(-1);
  const coreMaterial = useRef<THREE.MeshStandardMaterial>(null);
  // Scratch objects reused every frame (no per-frame allocations => no GC stutter).
  const scratch = useRef<ReturnType<typeof makeScratch> | null>(null);
  const pointer = useThree((s) => s.pointer);

  useFrame((state, delta) => {
    const m = mesh.current;
    if (!m) return;
    const tmp = (scratch.current ??= makeScratch());
    // Diagnostic frame counter (written every 30 frames): lets tests prove the loop stops.
    frames.current++;
    if (frames.current % 30 === 0) state.gl.domElement.dataset.frames = String(frames.current);
    const dt = Math.min(delta, 1 / 20);
    shown.current += (progress.value - shown.current) * (1 - Math.exp(-dt * 4));
    const p = shown.current;
    const t = state.clock.elapsedTime;
    const { start, startQuat, target, targetQuat, scale, delay, drift } = layout;

    for (let i = 0; i < count; i++) {
      const d = delay[i] * 0.3;
      const rot = smoothstep(0.08 + d, 0.48 + d, p);
      const pos = smoothstep(0.3 + d, 0.78 + d, p);
      const float = (1 - pos) * 0.18;
      tmp.p.set(start[i * 3], start[i * 3 + 1] + Math.sin(t * drift[i * 2 + 1] + drift[i * 2]) * float, start[i * 3 + 2]);
      tmp.p2.set(target[i * 3], target[i * 3 + 1], target[i * 3 + 2]);
      tmp.p.lerp(tmp.p2, pos);
      tmp.q.set(startQuat[i * 4], startQuat[i * 4 + 1], startQuat[i * 4 + 2], startQuat[i * 4 + 3]);
      tmp.q2.set(targetQuat[i * 4], targetQuat[i * 4 + 1], targetQuat[i * 4 + 2], targetQuat[i * 4 + 3]);
      tmp.q.slerp(tmp.q2, rot);
      tmp.s.set(scale[i * 3], scale[i * 3 + 1], scale[i * 3 + 2]);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      m.setMatrixAt(i, tmp.m);
    }
    m.instanceMatrix.needsUpdate = true;

    // Colours change in 24 steps only (not every frame).
    const step = Math.round(p * 24);
    if (step !== colorStep.current) {
      colorStep.current = step;
      for (let i = 0; i < count; i++) {
        const base = i % 3 === 0 ? CREAM : i % 3 === 1 ? STONE : COCOA;
        const glow = layout.accent[i] ? smoothstep(0.35 + delay[i] * 0.3, 0.7 + delay[i] * 0.3, p) : 0;
        tmp.c.copy(base).lerp(EMBER, glow);
        m.setColorAt(i, tmp.c);
      }
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    const insight = smoothstep(0.7, 1, p);
    if (coreMaterial.current) {
      coreMaterial.current.opacity = insight;
      coreMaterial.current.emissiveIntensity = 0.4 + insight * 2.2;
    }
    core.current?.scale.setScalar(0.5 + insight * 0.6);
    if (light.current) light.current.intensity = insight * 26;

    const g = group.current;
    if (g) {
      g.rotation.y += dt * (0.04 + 0.18 * pos01(p));
      g.rotation.x += (pointer.y * 0.12 - g.rotation.x) * (1 - Math.exp(-dt * 3));
      g.position.x += (pointer.x * 0.25 - g.position.x) * (1 - Math.exp(-dt * 3));
    }
  });

  return (
    // Geometry and materials declared in JSX are created once and disposed by R3F on unmount.
    <group ref={group} position={[0, 0, 0]}>
      <instancedMesh key={count} ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.5} metalness={0.2} />
      </instancedMesh>
      <mesh ref={core}>
        <icosahedronGeometry args={[0.62, 3]} />
        <meshStandardMaterial ref={coreMaterial} color="#2a160c" emissive={EMBER} emissiveIntensity={0} roughness={0.3} transparent opacity={0} />
      </mesh>
      <pointLight ref={light} position={[0, 0, 0]} color="#F07837" intensity={0} distance={7} decay={2} />
    </group>
  );
}

const pos01 = (p: number) => smoothstep(0.55, 1, p);

function makeScratch() {
  return { m: new THREE.Matrix4(), p: new THREE.Vector3(), p2: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), s: new THREE.Vector3(), c: new THREE.Color() };
}

/** Keeps the camera framing sensible on narrow screens. */
function Framing() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const aspect = useThree((s) => s.size.width / s.size.height);
  useEffect(() => {
    camera.position.set(aspect < 1 ? 0 : 0.6, 0.3, aspect < 1 ? 13 : 9.5);
    camera.lookAt(aspect < 1 ? 0 : 0.6, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, aspect]);
  return null;
}

export default function DataCoreCanvas({
  tier,
  progress,
  onReady,
  onFail,
}: {
  tier: Exclude<RenderTier, "static">;
  progress: ProgressRef;
  onReady: () => void;
  onFail: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const r3f = useRef<RootState | null>(null);
  const [created, setCreated] = useState(false);

  // The render loop runs ONLY while the hero is on screen, the tab is visible and the route is
  // shown. The loop is switched imperatively on R3F's store (setFrameloop), not through React
  // state: Next 16 keeps visited routes alive in a hidden <Activity>, where React defers state
  // updates, but effect cleanups still run, so the cleanup below stops the loop immediately.
  useEffect(() => {
    const el = host.current;
    if (!el || !created) return;
    let inView = false;
    const update = () => r3f.current?.setFrameloop(inView && document.visibilityState === "visible" ? "always" : "never");
    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
      r3f.current?.setFrameloop("never");
    };
  }, [created]);

  return (
    <div ref={host} className="absolute inset-0" aria-hidden>
      <Canvas
        frameloop="never"
        dpr={tier === "full" ? [1, 1.75] : [1, 1.25]}
        gl={{ antialias: tier === "full", alpha: true, powerPreference: tier === "full" ? "high-performance" : "low-power" }}
        camera={{ fov: 35, near: 0.1, far: 60, position: [0.6, 0.3, 9.5] }}
        onCreated={(state) => {
          r3f.current = state;
          // If the GPU drops the context (driver reset, memory pressure) fall back to SVG.
          state.gl.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); onFail(); }, { once: true });
          setCreated(true);
          onReady();
        }}
      >
        <fog attach="fog" args={["#110B08", 9, 19]} />
        <ambientLight intensity={0.45} color="#F4E8D9" />
        <directionalLight position={[4, 6, 5]} intensity={2.2} color="#F4E8D9" />
        <directionalLight position={[-5, -2, -6]} intensity={1.1} color="#F07837" />
        <Framing />
        <Shards tier={tier} progress={progress} />
      </Canvas>
    </div>
  );
}
