/*
 * Independent foreground layer: four small "fish" built from the same visual
 * language as the container graph (small coloured dots + thin light edges) that
 * swim around the current viewport and wiggle their tails.
 *
 * Breathing: each fish slowly swells and thins on its own breath period —
 * the outline rails, fins and caudal fan thicken on the inhale and slim on
 * the exhale (thickness), while the whole body also grows and shrinks a
 * little more slowly (grow). The tail beat and wave amplitude ride the same
 * cycle, so the fish literally breathe.
 *
 * This module has no top-level imports and its own Canvas 2D context + rAF loop.
 * It is deliberately separate from memory-point-cloud.ts: it never touches the
 * container camera, scroll growth or WebGL scene. It is lazily imported by
 * MemoryFishLayer.tsx so the main bundle stays lean.
 *
 * Swim technique: a travelling sine wave runs down the spine. Each spine
 * segment gets an angular offset whose amplitude is concentrated toward the
 * tail (`env(s)` stays near zero until ~15% back, then rises steeply) and whose
 * phase lags along the body (`phase - K*s`). The spine is rebuilt node-by-node
 * by accumulating those segment angles, so the body forms a smooth S-curve.
 * The body outline, dorsal/pectoral fins and the caudal fan ride the local
 * spine frame; the caudal fan also gets an extra swing so it sweeps widest.
 *
 * Body liveliness: a smoothed turn-rate term (`bend`) arcs the spine into
 * sustained turns — the head leads and the tail trails with a short lag — so
 * turning, towing and panic zig-zags all read as body curvature instead of a
 * rigid rotation. Fin nodes flutter on their own phase, and every so often a
 * fish darts spontaneously (a short panic burst) so idle swimming never
 * falls into a fixed pattern.
 *
 * Pointer interaction: the layer never accepts pointer events, but the module
 * listens for pointer events on `window`. A cursor entering a fish's flee
 * radius raises its scare level instantly; the fish then steers away from the
 * cursor with a looser turn cap, a speed burst and a faster tail gait. Scare
 * decays smoothly (~0.7s) so the fish settles back into its calm wander.
 * Pressing the pointer on a fish grabs it: the fish is towed by the cursor
 * until release, then bolts away with a short zig-zag panic. A click that
 * misses a fish still startles every fish inside its scare radius.
 */

export interface MemoryFishHandle {
  setReduced(reduced: boolean): void;
  setPaused(paused: boolean): void;
  dispose(): void;
}

export interface MemoryFishOptions {
  reduced?: boolean;
}

interface Vec {
  x: number;
  y: number;
}

interface NodeDesc {
  /** Spine node this node is attached to. */
  attach: number;
  /** Offset along the spine tangent at the attachment (px). */
  t: number;
  /** Offset along the spine normal at the attachment (px). */
  n: number;
  /** Palette / edge colour index. */
  color: number;
  size: number;
  /** 1 for caudal-fin nodes, so they add the extra tail swing (default 0). */
  swing?: number;
  /** Fin-flutter amplitude: independent normal oscillation on fin nodes. */
  flutter?: number;
}

interface FishSpec {
  length: number;
  height: number;
  speed: number;
  turnRate: number;
  palette: readonly string[];
  edge: string;
  /** Preferred horizontal band centre, 0..1 of the usable width. */
  side: number;
  sidePhase: number;
  /** Vertical band start and signed travel across the full scroll range. */
  vStart: number;
  vSpan: number;
  waveRate: number;
  waveK: number;
  waveAmp: number;
  /** Extra rotation (radians) applied to the caudal fan about the tail node. */
  tailSweep: number;
  gaitFreq: number;
  wanderFreq: number;
  wobble: number;
  turnSign: number;
  alpha: number;
  edgeAlpha: number;
  /** Seconds per full breath: the thickness/grow swelling cycle. */
  breathPeriod: number;
}

interface Fish {
  spec: FishSpec;
  nodes: NodeDesc[];
  edges: readonly (readonly [number, number])[];
  pos: Vec;
  heading: number;
  target: Vec;
  wanderX: number;
  wanderY: number;
  wanderTimer: number;
  wobbleSeed: number;
  gaitPhase: number;
  wavePhase: number;
  amp: number;
  tailSwing: number;
  scale: number;
  /** 0..1 startle level: rises instantly near the pointer, decays smoothly. */
  scare: number;
  /** Seconds of post-release panic left: wild zig-zag while positive. */
  panic: number;
  /** Smoothed signed turn rate (-1..1): the body arcs into sustained turns. */
  bend: number;
  /** Seconds until the next spontaneous dart; resets to a random interval. */
  dartTimer: number;
  /** Breath cycle angle; thickness and grow derive from it. */
  breathPhase: number;
  /** Current body thickness multiplier (inhale swells, exhale slims). */
  thickness: number;
  /** Current whole-body size multiplier, slower than the breath cycle. */
  grow: number;
}

const TAU = Math.PI * 2;
const SPINE_SEGMENTS = 12;
const VIEWPORT_MARGIN = 64;
/** Hard cap of 10° per step on heading change, so a fish never turns sharply. */
const TURN_LIMIT = Math.PI / 18;
/** Pointer startle: flee radius (scaled), and how hard a startled fish reacts. */
const FLEE_RADIUS = 170;
const SCARE_DECAY = 1.4;
const FLEE_STEER = 1.1;
const FLEE_TURN_BOOST = 2;
const FLEE_SPEED_BOOST = 1.35;
const FLEE_GAIT_BOOST = 2;
/** Grabbing: press within this radius of a fish to tow it with the cursor. */
const GRAB_RADIUS = 90;
const GRAB_TURN_BOOST = 6;
const GRAB_SPEED_MAX = 4;
const GRAB_GAIT = 3;
/** Post-release panic: a short wild zig-zag burst away from the cursor. */
const PANIC_TIME = 0.9;
const PANIC_ZIGZAG = 1.4;
const PANIC_ZIGZAG_RATE = 13;
/** Body liveliness: turn arc, fin flutter, and the breathing cycle. */
const BEND_GAIN = 0.55;
const BEND_RATE = 5;
const FLUTTER_AMP = 2.4;
/** Breathing: the body swells locally; overall size drifts by only 4%. */
const BREATH_AMP = 0.22;
const SIZE_AMP = 0.04;
const DART_MIN = 7;
const DART_MAX = 16;
/** Max node distance from the fish origin, as a multiple of its length. */
const FISH_RADIUS = 1.38;
/** Reference viewport edge used to scale the fish down on small screens. */
const REFERENCE_EDGE = 1000;

const clamp = (value: number, lo: number, hi: number): number => (value < lo ? lo : value > hi ? hi : value);

function angleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

const sAt = (index: number): number => index / (SPINE_SEGMENTS - 1);

/** Body half-height envelope (0..1): near-zero at the snout, widest ~35% back,
 * then a smooth taper to a thin caudal peduncle. Beta-like, normalised. */
const BODY_NORM = Math.pow(0.35, 1.4) * Math.pow(0.65, 2.6);
function bodyHalf(s: number): number {
  const k = clamp(s, 0, 1);
  return (Math.pow(k, 1.4) * Math.pow(1 - k, 2.6)) / BODY_NORM;
}

const SPEC_A: FishSpec = {
  length: 150,
  height: 30,
  speed: 64,
  turnRate: 1.15,
  palette: ['#0a84ff', '#3a5ccc', '#2440d0'],
  edge: '#3a5ccc',
  side: 0.24,
  sidePhase: 0.13,
  vStart: 0.24,
  vSpan: 0.52,
  waveRate: 5.2,
  waveK: 3.4,
  waveAmp: 0.34,
  tailSweep: 0.55,
  gaitFreq: 2.6,
  wanderFreq: 0.6,
  wobble: 0.32,
  turnSign: 1,
  alpha: 0.72,
  edgeAlpha: 0.16,
  breathPeriod: 4.2,
};

const SPEC_B: FishSpec = {
  length: 118,
  height: 25,
  speed: 52,
  turnRate: 1.3,
  palette: ['#067a52', '#a97600', '#7a3be0'],
  edge: '#067a52',
  side: 0.78,
  sidePhase: 0.11,
  vStart: 0.76,
  vSpan: -0.52,
  waveRate: 6.1,
  waveK: 3.8,
  waveAmp: 0.37,
  tailSweep: 0.62,
  gaitFreq: 3.0,
  wanderFreq: 0.7,
  wobble: 0.36,
  turnSign: -1,
  alpha: 0.84,
  edgeAlpha: 0.2,
  breathPeriod: 5.1,
};

/** Two more species so the layer schools: mid violet-teal and a small coral. */
const SPEC_C: FishSpec = {
  length: 132,
  height: 27,
  speed: 58,
  turnRate: 1.2,
  palette: ['#5b57d6', '#2f8f6f', '#0a84ff'],
  edge: '#5b57d6',
  side: 0.38,
  sidePhase: 0.17,
  vStart: 0.62,
  vSpan: 0.36,
  waveRate: 5.6,
  waveK: 3.5,
  waveAmp: 0.35,
  tailSweep: 0.58,
  gaitFreq: 2.8,
  wanderFreq: 0.65,
  wobble: 0.34,
  turnSign: -1,
  alpha: 0.78,
  edgeAlpha: 0.18,
  breathPeriod: 4.6,
};

const SPEC_D: FishSpec = {
  length: 102,
  height: 21,
  speed: 70,
  turnRate: 1.45,
  palette: ['#a93021', '#c2760a', '#7a3be0'],
  edge: '#a93021',
  side: 0.64,
  sidePhase: 0.09,
  vStart: 0.28,
  vSpan: -0.4,
  waveRate: 6.6,
  waveK: 4,
  waveAmp: 0.36,
  tailSweep: 0.6,
  gaitFreq: 3.2,
  wanderFreq: 0.75,
  wobble: 0.38,
  turnSign: 1,
  alpha: 0.8,
  edgeAlpha: 0.2,
  breathPeriod: 3.9,
};

/** Static topology: which nodes exist and how they connect. Built once.
 *
 * Layout (head at +x): a central spine node every 1/11 of the body; an upper
 * and lower outline rail at the same stations (sampled from `bodyHalf`, so the
 * rails form an elongated-ellipse silhouette that closes at a near-point nose);
 * a dorsal sail, a pectoral fin; and a forked caudal fan at the tail.
 */
function buildFish(spec: FishSpec): { nodes: NodeDesc[]; edges: Array<[number, number]> } {
  const nodes: NodeDesc[] = [];
  const edges: Array<[number, number]> = [];
  const H = spec.height;
  const seg = spec.length / (SPINE_SEGMENTS - 1);
  const last = SPINE_SEGMENTS - 1;

  const spine: number[] = [];
  for (let i = 0; i < SPINE_SEGMENTS; i++) {
    spine.push(nodes.length);
    nodes.push({ attach: i, t: 0, n: 0, color: i % 2, size: 2.05 });
  }
  for (let i = 0; i < last; i++) edges.push([spine[i], spine[i + 1]]);

  // Body outline rails, station 1..last-1 (station 0 is the nose at spine[0]).
  const up: number[] = [];
  const down: number[] = [];
  for (let i = 1; i <= last - 1; i++) {
    const h = bodyHalf(sAt(i)) * H;
    up[i] = nodes.length;
    nodes.push({ attach: i, t: 0, n: h, color: 0, size: 1.8 });
    down[i] = nodes.length;
    nodes.push({ attach: i, t: 0, n: -h, color: 1, size: 1.8 });
  }
  for (let i = 1; i <= last - 2; i++) {
    edges.push([up[i], up[i + 1]], [down[i], down[i + 1]]);
  }
  edges.push([spine[0], up[1]], [spine[0], down[1]]);
  for (const i of [2, 5, 8]) {
    edges.push([spine[i], up[i]], [spine[i], down[i]]);
  }

  // Mirrored fin pairs (top-down view): pectorals at the front, pelvics mid-body.
  // Both sides are exact mirrors so the silhouette stays left/right symmetric.
  const finPairs: Array<{ station: number; reach: number; back: number; size: number }> = [
    { station: 2, reach: 0.5, back: 0.3, size: 1.7 },
    { station: 5, reach: 0.34, back: 0.26, size: 1.55 },
  ];
  for (const fin of finPairs) {
    for (const sign of [1, -1]) {
      const base = sign > 0 ? up[fin.station] : down[fin.station];
      const color = sign > 0 ? 0 : 1;
      const outer = nodes.length;
      nodes.push({ attach: fin.station, t: -seg * fin.back, n: sign * (bodyHalf(sAt(fin.station)) * H + H * fin.reach), color, size: fin.size, flutter: 1 });
      const inner = nodes.length;
      nodes.push({ attach: fin.station, t: seg * fin.back, n: sign * (bodyHalf(sAt(fin.station)) * H + H * fin.reach * 0.78), color, size: fin.size, flutter: 0.7 });
      edges.push([base, outer], [base, inner], [outer, inner]);
    }
  }

  // Forked caudal fan, wider than the thin stalk, sweeping with the wave.
  const finLen = spec.length * 0.3;
  const finHalf = spec.height;
  const caudal: NodeDesc[] = [
    { attach: last, t: finLen * 0.18, n: finHalf * 0.38, color: 0, size: 1.85, swing: 1 },
    { attach: last, t: finLen * 0.18, n: -finHalf * 0.38, color: 1, size: 1.85, swing: 1 },
    { attach: last, t: finLen, n: finHalf, color: 0, size: 2.1, swing: 1, flutter: 0.5 },
    { attach: last, t: finLen, n: -finHalf, color: 1, size: 2.1, swing: 1, flutter: 0.5 },
    { attach: last, t: finLen * 0.58, n: 0, color: 1, size: 1.95, swing: 1 },
  ];
  const caudalIds = caudal.map((node) => {
    const id = nodes.length;
    nodes.push(node);
    return id;
  });
  edges.push(
    [spine[last], caudalIds[0]], [spine[last], caudalIds[1]],
    [caudalIds[0], caudalIds[2]], [caudalIds[1], caudalIds[3]],
    [caudalIds[0], caudalIds[4]], [caudalIds[1], caudalIds[4]],
    [caudalIds[2], caudalIds[4]], [caudalIds[3], caudalIds[4]],
  );

  return { nodes, edges };
}

/** Accumulate the waved spine in fish-local space: head at (0,0), body toward
 * -x. `bend` (-1..1) adds a sustained arc that grows toward the tail, so the
 * body curves into turns instead of rotating rigidly. */
function buildSpine(spec: FishSpec, phase: number, amp: number, bend: number, breathPhase: number): Vec[] {
  const seg = spec.length / (SPINE_SEGMENTS - 1);
  const points: Vec[] = [{ x: 0, y: 0 }];
  let x = 0;
  let y = 0;
  for (let i = 0; i < SPINE_SEGMENTS - 1; i++) {
    const s = sAt(i);
    const env = Math.pow(clamp((s - 0.1) / 0.9, 0, 1), 1.9);
    const theta = spec.waveAmp * amp * env * Math.sin(phase - spec.waveK * s)
      + bend * BEND_GAIN * Math.pow(s, 1.3);
    const angle = Math.PI + theta;
    // The body shortens slightly as each section expands, keeping the head steady.
    const length = seg * (1 - 0.025 * Math.sin(breathPhase - s * 1.15));
    x += length * Math.cos(angle);
    y += length * Math.sin(angle);
    points.push({ x, y });
  }
  return points;
}

/** Local tangent/normal frame at each spine node. */
function framesOf(spine: Vec[]): Array<{ t: Vec; n: Vec }> {
  const out: Array<{ t: Vec; n: Vec }> = [];
  for (let i = 0; i < SPINE_SEGMENTS; i++) {
    const a = spine[Math.max(0, i - 1)];
    const b = spine[Math.min(SPINE_SEGMENTS - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    out.push({ t: { x: tx, y: ty }, n: { x: -ty, y: tx } });
  }
  return out;
}

function makeFish(spec: FishSpec, options: { x: number; y: number; heading: number }): Fish {
  const { nodes, edges } = buildFish(spec);
  return {
    spec,
    nodes,
    edges,
    pos: { x: options.x, y: options.y },
    heading: options.heading,
    target: { x: options.x, y: options.y },
    wanderX: 0,
    wanderY: 0,
    wanderTimer: 0,
    wobbleSeed: Math.random() * TAU,
    gaitPhase: Math.random() * TAU,
    wavePhase: Math.random() * TAU,
    amp: 1,
    tailSwing: 0,
    scale: 1,
    scare: 0,
    panic: 0,
    bend: 0,
    dartTimer: 4 + Math.random() * 8,
    breathPhase: Math.random() * TAU,
    thickness: 1,
    grow: 1,
  };
}

export function startMemoryFish(host: HTMLElement, options: MemoryFishOptions = {}): MemoryFishHandle {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  const context = canvas.getContext('2d');
  if (!context) {
    return { setReduced() {}, setPaused() {}, dispose() {} };
  }
  host.appendChild(canvas);

  let view = { w: 0, h: 0, dpr: 1 };
  const fish: Fish[] = [];
  let reduced = options.reduced ?? false;
  let paused = false;
  let disposed = false;
  let raf = 0;
  let last = 0;
  let time = 0;

  // Viewport-level pointer tracking: the host layer itself is pointer-events:none,
  // so events are observed on `window` and mapped into canvas coordinates.
  const pointer = { x: 0, y: 0, active: false };
  const grab: { fish: Fish | null } = { fish: null };
  let origin = { x: 0, y: 0 };
  const trackPointer = (e: PointerEvent): void => {
    pointer.x = e.clientX - origin.x;
    pointer.y = e.clientY - origin.y;
    pointer.active = true;
  };
  const onPointerMove = (e: PointerEvent): void => {
    trackPointer(e);
  };
  const onPointerDown = (e: PointerEvent): void => {
    if (reduced) return;
    trackPointer(e);
    // Pressing on a fish grabs it; any fish inside the scare radius bolts.
    let best: Fish | null = null;
    let bestD = Infinity;
    for (const f of fish) {
      const d = Math.hypot(f.pos.x - pointer.x, f.pos.y - pointer.y);
      if (d < GRAB_RADIUS * f.scale && d < bestD) { best = f; bestD = d; }
      if (d < FLEE_RADIUS * 1.25 * f.scale) f.scare = 1;
    }
    grab.fish = best;
  };
  const releaseGrab = (): void => {
    if (grab.fish) {
      grab.fish.scare = 1;
      grab.fish.panic = PANIC_TIME;
      grab.fish = null;
    }
  };
  const onPointerUp = (): void => {
    releaseGrab();
  };
  const onPointerGone = (): void => {
    pointer.active = false;
    releaseGrab();
  };

  const scrollProgress = (): number => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    return max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
  };

  const currentScale = (): number => clamp(Math.min(view.w, view.h) / REFERENCE_EDGE, 0.45, 1);

  const resize = (): void => {
    const w = Math.max(1, host.clientWidth || window.innerWidth);
    const h = Math.max(1, host.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    view = { w, h, dpr };
    const rect = host.getBoundingClientRect();
    origin = { x: rect.left, y: rect.top };
    const scale = currentScale();
    for (const f of fish) {
      f.scale = scale;
      const pad = VIEWPORT_MARGIN + f.spec.length * FISH_RADIUS * scale;
      f.pos.x = clamp(f.pos.x, pad, Math.max(pad, w - pad));
      f.pos.y = clamp(f.pos.y, pad, Math.max(pad, h - pad));
    }
  };

  const seed = (): void => {
    fish.length = 0;
    const spots: Array<[FishSpec, number, number, number]> = [
      [SPEC_A, 0.3, 0.34, 0.5],
      [SPEC_B, 0.68, 0.66, -2.4],
      [SPEC_C, 0.42, 0.62, 2.2],
      [SPEC_D, 0.6, 0.38, -0.9],
    ];
    for (const [spec, fx, fy, heading] of spots) {
      fish.push(makeFish(spec, { x: view.w * fx, y: view.h * fy, heading }));
    }
    const scale = currentScale();
    for (const f of fish) f.scale = scale;
  };

  const stepFish = (f: Fish, dt: number, progress: number): void => {
    const spec = f.spec;
    const pad = VIEWPORT_MARGIN + spec.length * FISH_RADIUS * f.scale;
    const loX = pad;
    const hiX = Math.max(pad + 1, view.w - pad);
    const loY = pad;
    const hiY = Math.max(pad + 1, view.h - pad);
    const usableW = hiX - loX;
    const usableH = hiY - loY;

    const grabbed = grab.fish === f;

    // Breathing: thickness swells on the inhale and slims on the exhale;
    // the whole body also grows and shrinks on a slower sub-cycle.
    f.breathPhase += dt * TAU / spec.breathPeriod;
    const breath = Math.sin(f.breathPhase);
    f.thickness = 1 + BREATH_AMP * breath;
    f.grow = 1 + SIZE_AMP * Math.sin(f.breathPhase * 0.45 + f.wobbleSeed);

    // Startle: cursor inside the flee radius raises scare instantly; it then
    // decays smoothly so the fish keeps darting briefly after the cursor passes.
    // A grabbed fish is calm while towed; it panics only on release.
    const fleeR = FLEE_RADIUS * f.scale;
    if (grabbed) {
      f.scare = 0;
      f.panic = 0;
    } else if (pointer.active) {
      const d = Math.hypot(f.pos.x - pointer.x, f.pos.y - pointer.y);
      f.scare = Math.max(f.scare - dt * SCARE_DECAY, clamp(1 - d / fleeR, 0, 1));
    } else {
      f.scare = Math.max(f.scare - dt * SCARE_DECAY, 0);
    }

    let desired: number;
    if (grabbed) {
      // Towed by the cursor: head straight for it, arriving smoothly.
      desired = Math.atan2(pointer.y - f.pos.y, pointer.x - f.pos.x);
    } else {
      const bandX = loX + usableW * clamp(spec.side + 0.1 * Math.sin(time * spec.sidePhase), 0, 1);
      const bandY = loY + usableH * clamp(spec.vStart + spec.vSpan * progress, 0.04, 0.96);

      f.wanderTimer -= dt;
      if (f.wanderTimer <= 0) {
        f.wanderTimer = 3.5 + Math.random() * 4;
        f.wanderX = (Math.random() * 2 - 1) * usableW * 0.24;
        f.wanderY = (Math.random() * 2 - 1) * usableH * 0.22;
      }
      // Spontaneous dart: idle fish still burst now and then, so calm
      // swimming never settles into a fixed, mechanical pattern.
      f.dartTimer -= dt;
      if (f.dartTimer <= 0) {
        f.dartTimer = DART_MIN + Math.random() * (DART_MAX - DART_MIN);
        f.scare = Math.max(f.scare, 0.85);
        f.panic = Math.max(f.panic, 0.4);
      }
      f.target.x = clamp(bandX + f.wanderX, loX, hiX);
      f.target.y = clamp(bandY + f.wanderY, loY, hiY);

      let dirX = f.target.x - f.pos.x;
      let dirY = f.target.y - f.pos.y;
      const dist = Math.hypot(dirX, dirY);
      desired = Math.atan2(dirY, dirX);
      if (dist < 34) desired += f.spec.turnSign * Math.PI * 0.5;
      desired += spec.wobble * Math.sin(time * spec.wanderFreq + f.wobbleSeed);

      if (pointer.active && f.scare > 0.01) {
        const away = Math.atan2(f.pos.y - pointer.y, f.pos.x - pointer.x);
        desired += angleDelta(desired, away) * f.scare * FLEE_STEER;
      }
      if (f.panic > 0) {
        // Wild left/right zig-zag that fades as the panic wears off.
        const k = clamp(f.panic / PANIC_TIME, 0, 1);
        desired += Math.sin(time * PANIC_ZIGZAG_RATE + f.wobbleSeed * 5) * PANIC_ZIGZAG * k;
        f.panic -= dt;
      }
    }

    const maxTurn = Math.min(spec.turnRate * dt, TURN_LIMIT) *
      (grabbed ? GRAB_TURN_BOOST : 1 + FLEE_TURN_BOOST * f.scare);
    const speed = spec.speed * f.scale *
      (grabbed
        ? clamp(Math.hypot(pointer.x - f.pos.x, pointer.y - f.pos.y) * 0.05, 0.25, GRAB_SPEED_MAX)
        : 1 + FLEE_SPEED_BOOST * f.scare);
    const turn = clamp(angleDelta(f.heading, desired), -maxTurn, maxTurn);
    f.heading += turn;
    // Arc the body into the turn: the head leads, the tail trails with a lag.
    const turnRate = dt > 0 ? clamp(turn / dt / (spec.turnRate * 4), -1, 1) : 0;
    f.bend += (turnRate - f.bend) * Math.min(1, dt * BEND_RATE);
    f.pos.x += Math.cos(f.heading) * speed * dt;
    f.pos.y += Math.sin(f.heading) * speed * dt;

    // Exiting the viewport re-enters from the opposite side; never turn back at
    // an edge. A grabbed fish just stops at the boundary until released.
    const radius = spec.length * FISH_RADIUS * f.scale;
    if (grabbed) {
      f.pos.x = clamp(f.pos.x, -radius * 0.3, view.w + radius * 0.3);
      f.pos.y = clamp(f.pos.y, -radius * 0.3, view.h + radius * 0.3);
    } else {
      if (f.pos.x - radius > view.w) f.pos.x = -radius;
      else if (f.pos.x + radius < 0) f.pos.x = view.w + radius;
      if (f.pos.y - radius > view.h) f.pos.y = -radius;
      else if (f.pos.y + radius < 0) f.pos.y = view.h + radius;
    }

    // Burst/coast gait: the tail beats in gusts, then relaxes into a glide.
    // A startled fish beats much faster, matching its escape burst; a towed
    // fish struggles continuously against the cursor.
    f.gaitPhase += dt * spec.gaitFreq * (grabbed ? GRAB_GAIT : 1 + FLEE_GAIT_BOOST * f.scare) * (1 + 0.22 * breath);
    const beat = Math.pow(0.5 + 0.5 * Math.sin(f.gaitPhase), 1.6);
    f.wavePhase += dt * spec.waveRate * (0.65 + 0.9 * beat);
    f.amp = 0.5 + 0.6 * beat + 0.3 * f.scare + 0.12 * breath;
    f.tailSwing = spec.tailSweep * f.amp * Math.sin(f.wavePhase - spec.waveK);
  };

  const transform = (f: Fish, p: Vec): Vec => {
    const cos = Math.cos(f.heading);
    const sin = Math.sin(f.heading);
    const k = f.scale * f.grow;
    return {
      x: f.pos.x + (p.x * cos - p.y * sin) * k,
      y: f.pos.y + (p.x * sin + p.y * cos) * k,
    };
  };

  const drawFish = (f: Fish): void => {
    const spine = buildSpine(f.spec, f.wavePhase, f.amp, f.bend, f.breathPhase);
    const frames = framesOf(spine);
    const screen: Vec[] = f.nodes.map((node) => {
      const s = spine[node.attach];
      const fr = frames[node.attach];
      const station = sAt(node.attach);
      const breath = Math.sin(f.breathPhase - station * 1.15);
      const fullness = 1 + BREATH_AMP * breath * (0.3 + 0.7 * Math.sin(Math.PI * station));
      let offT = node.t;
      let offN = node.n * fullness;
      if (node.flutter) {
        // Paired fin tips open together, with a short delay behind the body.
        const spread = 1 + 0.12 * Math.sin(f.breathPhase - station * 1.15 - 0.65);
        offN = offN * spread + Math.sign(node.n) * Math.sin(f.wavePhase * 1.45 - station * 3) * FLUTTER_AMP * node.flutter;
      }
      if (node.swing) {
        const a = f.tailSwing * node.swing;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        offT = node.t * ca - offN * sa;
        offN = node.t * sa + offN * ca;
      }
      return transform(f, {
        x: s.x + fr.t.x * offT + fr.n.x * offN,
        y: s.y + fr.t.y * offT + fr.n.y * offN,
      });
    });

    context.globalAlpha = f.spec.edgeAlpha;
    context.strokeStyle = f.spec.edge;
    context.lineWidth = 0.9 * f.scale * f.grow;
    context.beginPath();
    for (const [a, b] of f.edges) {
      context.moveTo(screen[a].x, screen[a].y);
      context.lineTo(screen[b].x, screen[b].y);
    }
    context.stroke();

    context.globalAlpha = f.spec.alpha;
    for (let i = 0; i < f.nodes.length; i++) {
      const node = f.nodes[i];
      context.fillStyle = f.spec.palette[node.color % f.spec.palette.length];
      context.beginPath();
      context.arc(screen[i].x, screen[i].y, node.size * f.scale * f.grow * (0.92 + 0.08 * f.thickness), 0, TAU);
      context.fill();
    }
    context.globalAlpha = 1;
  };

  const render = (): void => {
    context.clearRect(0, 0, view.w, view.h);
    for (const f of fish) drawFish(f);
  };

  const loop = (now: number): void => {
    raf = 0;
    if (disposed || paused) return;
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    if (!reduced) {
      time += dt;
      const progress = scrollProgress();
      for (const f of fish) stepFish(f, dt, progress);
    }
    render();
    if (!reduced) raf = requestAnimationFrame(loop);
  };

  const wake = (): void => {
    if (disposed || paused || raf) return;
    last = 0;
    raf = requestAnimationFrame(loop);
  };

  const onResize = (): void => {
    resize();
    if (reduced) render();
  };

  resize();
  seed();
  render();
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  document.documentElement.addEventListener('pointerleave', onPointerGone);
  window.addEventListener('blur', onPointerGone);
  wake();

  return {
    setReduced(next: boolean): void {
      if (disposed || next === reduced) return;
      reduced = next;
      if (reduced) {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        render();
      } else {
        last = 0;
        wake();
      }
    },
    setPaused(next: boolean): void {
      if (disposed || next === paused) return;
      paused = next;
      if (paused) {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
      } else {
        last = 0;
        wake();
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      document.documentElement.removeEventListener('pointerleave', onPointerGone);
      window.removeEventListener('blur', onPointerGone);
      canvas.remove();
    },
  };
}
