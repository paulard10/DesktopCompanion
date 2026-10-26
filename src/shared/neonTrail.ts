/**
 * Neon trail in desktop DIP. No Electron and no drawing.
 * Electron workArea values are already DIP. scaleFactor is checked and never
 * multiplied into a position.
 */

import type { TravelPhase } from './desktopMovement.js';

/** Matches the 160 DIP body circle centered in the avatar window. */
const BODY_RADIUS_DIP = 80;

export const TRAIL_MAX_PARTICLES = 32;
export const TRAIL_SPACING_DIP = 16;
export const TRAIL_MIN_LIFE_MS = 500;
export const TRAIL_MAX_LIFE_MS = 900;
export const TRAIL_MIN_DIAMETER_DIP = 4;
export const TRAIL_MAX_DIAMETER_DIP = 10;
export const TRAIL_HITCH_DIP = 48;
export const TRAIL_MAX_SPAWNS_PER_SAMPLE = 2;
export const TRAIL_EDGE_GAP_DIP = 8;
export const TRAIL_PAD_DIP = 22;

export interface DipPoint {
  x: number;
  y: number;
}

export interface DipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TrailParticle {
  id: number;
  x: number;
  y: number;
  born: number;
  life: number;
  diameter: number;
  driftX: number;
  driftY: number;
}

export interface TrailState {
  reducedMotion: boolean;
  seed: number;
  nextId: number;
  carryDip: number;
  anchorX: number | null;
  anchorY: number | null;
  windowX: number | null;
  windowY: number | null;
  windowW: number | null;
  windowH: number | null;
  workKey: string | null;
  particles: TrailParticle[];
}

export interface TrailSample {
  window: DipRect;
  workArea: DipRect | null;
  travelPhase: TravelPhase;
  asleep: boolean;
  chatOpen: boolean;
  forceClear: boolean;
}

/** Why this sample produced no pearls. Null means at least one pearl was born. */
export type TrailHold =
  | 'clear'
  | 'asleep'
  | 'chat'
  | 'reduced'
  | 'no-work-area'
  | 'display'
  | 'idle'
  | 'baseline'
  | 'still'
  | 'hitch'
  | 'full'
  | 'outside'
  | null;

export interface TrailStep {
  state: TrailState;
  spawned: TrailParticle[];
  clearView: boolean;
  bounds: DipRect | null;
  hold: TrailHold;
}

export interface TrailVisual {
  x: number;
  y: number;
  diameter: number;
  alpha: number;
}

export function createTrailState(seed = 0x5eed): TrailState {
  return {
    reducedMotion: false,
    seed: seed === 0 ? 1 : seed | 0,
    nextId: 1,
    carryDip: 0,
    anchorX: null,
    anchorY: null,
    windowX: null,
    windowY: null,
    windowW: null,
    windowH: null,
    workKey: null,
    particles: [],
  };
}

/** Reject a bad scale. Return the work area unchanged, still in DIP. */
export function trailWorkArea(display: { workArea: DipRect; scaleFactor: number } | null): DipRect | null {
  if (!display || !Number.isFinite(display.scaleFactor) || display.scaleFactor <= 0) {
    return null;
  }
  const area = display.workArea;
  if (!Number.isFinite(area.x) || !Number.isFinite(area.y) || area.width < 1 || area.height < 1) {
    return null;
  }
  return { x: area.x, y: area.y, width: area.width, height: area.height };
}

export function trailLocal(x: number, y: number, originX: number, originY: number): DipPoint {
  return { x: x - originX, y: y - originY };
}

/** Point just outside the visible body, opposite the velocity. */
export function trailingPoint(bounds: DipRect, velocityX: number, velocityY: number): DipPoint | null {
  const length = Math.hypot(velocityX, velocityY);
  if (length < 0.2) {
    return null;
  }
  const ux = velocityX / length;
  const uy = velocityY / length;
  const distance = BODY_RADIUS_DIP + TRAIL_EDGE_GAP_DIP;
  return {
    x: bounds.x + bounds.width / 2 - ux * distance,
    y: bounds.y + bounds.height / 2 - uy * distance,
  };
}

export function trailPointInside(x: number, y: number, work: DipRect): boolean {
  return x >= work.x && y >= work.y && x < work.x + work.width && y < work.y + work.height;
}

export function trailBounds(particles: readonly TrailParticle[], work: DipRect): DipRect | null {
  if (particles.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const particle of particles) {
    const reach = TRAIL_PAD_DIP + particle.diameter * 0.5;
    const xs = [particle.x, particle.x + particle.driftX];
    const ys = [particle.y, particle.y + particle.driftY];
    for (const x of xs) {
      minX = Math.min(minX, x - reach);
      maxX = Math.max(maxX, x + reach);
    }
    for (const y of ys) {
      minY = Math.min(minY, y - reach);
      maxY = Math.max(maxY, y + reach);
    }
  }
  const x = Math.max(work.x, minX);
  const y = Math.max(work.y, minY);
  const right = Math.min(work.x + work.width, maxX);
  const bottom = Math.min(work.y + work.height, maxY);
  if (right - x < 1 || bottom - y < 1) {
    return null;
  }
  return { x, y, width: right - x, height: bottom - y };
}

export function clearTrailState(state: TrailState): TrailStep {
  return {
    state: {
      ...state,
      particles: [],
      carryDip: 0,
      anchorX: null,
      anchorY: null,
      windowX: null,
      windowY: null,
      windowW: null,
      windowH: null,
    },
    spawned: [],
    clearView: state.particles.length > 0,
    bounds: null,
    hold: 'clear',
  };
}

export function setTrailReducedMotion(state: TrailState, reduced: boolean): TrailStep {
  if (!reduced) {
    return { state: { ...state, reducedMotion: false }, spawned: [], clearView: false, bounds: null, hold: null };
  }
  const cleared = clearTrailState(state);
  return {
    ...cleared,
    state: { ...cleared.state, reducedMotion: true },
    clearView: true,
    hold: 'reduced',
  };
}

export function resetTrail(state: TrailState): TrailStep {
  const cleared = clearTrailState(state);
  return { ...cleared, clearView: true };
}

export function stepTrail(state: TrailState, sample: TrailSample, now: number): TrailStep {
  if (sample.forceClear) {
    return { ...clearTrailState(state), clearView: true, hold: 'clear' };
  }
  if (sample.asleep) {
    return { ...clearTrailState(state), clearView: true, hold: 'asleep' };
  }
  if (sample.chatOpen) {
    return { ...clearTrailState(state), clearView: true, hold: 'chat' };
  }
  if (state.reducedMotion) {
    return { ...clearTrailState(state), clearView: true, hold: 'reduced' };
  }
  if (!sample.workArea) {
    const cleared = clearTrailState(state);
    return { ...cleared, state: { ...cleared.state, workKey: null }, clearView: true, hold: 'no-work-area' };
  }
  const key = workKey(sample.workArea);
  if (state.workKey !== null && state.workKey !== key) {
    const cleared = clearTrailState(state);
    return { ...cleared, state: { ...cleared.state, workKey: key }, clearView: true, hold: 'display' };
  }
  const particles = state.particles.filter((particle) => now < particle.born + particle.life);
  if (sample.travelPhase !== 'moving') {
    return {
      state: {
        ...state,
        particles,
        carryDip: 0,
        anchorX: null,
        anchorY: null,
        windowX: sample.window.x,
        windowY: sample.window.y,
        windowW: sample.window.width,
        windowH: sample.window.height,
        workKey: key,
      },
      spawned: [],
      clearView: false,
      bounds: trailBounds(particles, sample.workArea),
      hold: 'idle',
    };
  }
  if (state.windowX === null || state.windowY === null || state.windowW === null || state.windowH === null) {
    return baseline(state, particles, sample, key);
  }
  const dx = sample.window.x - state.windowX;
  const dy = sample.window.y - state.windowY;
  const distance = Math.hypot(dx, dy);
  const previous = { x: state.windowX, y: state.windowY, width: state.windowW, height: state.windowH };
  const nextPoint = trailingPoint(sample.window, dx, dy);
  const previousPoint = trailingPoint(previous, dx, dy);
  if (!nextPoint || !previousPoint || distance < 0.2) {
    return {
      state: placeWindow({ ...state, particles }, sample, key, state.carryDip, state.anchorX, state.anchorY),
      spawned: [],
      clearView: false,
      bounds: trailBounds(particles, sample.workArea),
      hold: 'still',
    };
  }
  if (distance > TRAIL_HITCH_DIP) {
    return {
      state: placeWindow({ ...state, particles }, sample, key, 0, nextPoint.x, nextPoint.y),
      spawned: [],
      clearView: false,
      bounds: trailBounds(particles, sample.workArea),
      hold: 'hitch',
    };
  }
  if (particles.length >= TRAIL_MAX_PARTICLES) {
    return {
      state: placeWindow({ ...state, particles }, sample, key, 0, nextPoint.x, nextPoint.y),
      spawned: [],
      clearView: false,
      bounds: trailBounds(particles, sample.workArea),
      hold: 'full',
    };
  }
  return spawnAlong(state, particles, sample, key, now, dx, dy, distance, nextPoint);
}

export function ageTrail(state: TrailState, now: number, workArea: DipRect | null): TrailStep {
  if (!workArea) {
    const cleared = clearTrailState(state);
    return { ...cleared, clearView: state.particles.length > 0 };
  }
  const particles = state.particles.filter((particle) => now < particle.born + particle.life);
  return {
    state: { ...state, particles },
    spawned: [],
    clearView: particles.length === 0 && state.particles.length > 0,
    bounds: trailBounds(particles, workArea),
    hold: null,
  };
}

export function particleVisual(particle: TrailParticle, now: number): TrailVisual | null {
  const age = (now - particle.born) / particle.life;
  if (!Number.isFinite(age) || age < 0 || age >= 1) {
    return null;
  }
  const appear = smoothstep(0, 0.2, age);
  const fade = 1 - smoothstep(0.35, 1, age);
  return {
    x: particle.x + particle.driftX * age,
    y: particle.y + particle.driftY * age,
    diameter: particle.diameter * (1 - age * 0.62),
    alpha: appear * fade,
  };
}

/**
 * Bitmap pixels for a DIP-sized canvas. devicePixelRatio sharpens the bitmap.
 * It is not applied to desktop positions.
 */
export function canvasBitmapSize(
  widthDip: number,
  heightDip: number,
  devicePixelRatio: number,
): { width: number; height: number } | null {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    return null;
  }
  if (!Number.isFinite(widthDip) || !Number.isFinite(heightDip) || widthDip <= 0 || heightDip <= 0) {
    return null;
  }
  return {
    width: Math.max(1, Math.round(widthDip * devicePixelRatio)),
    height: Math.max(1, Math.round(heightDip * devicePixelRatio)),
  };
}

export interface TrailDrawFrame {
  viewport: DipRect;
  particles: TrailParticle[];
}

/** Accept a real Date.now() birth time. Screen coordinates stay on a tighter bound. */
export function readTrailFrame(value: unknown): TrailDrawFrame | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const viewport = readTrailViewport(record.viewport);
  if (!viewport || !Array.isArray(record.particles)) {
    return null;
  }
  const particles: TrailParticle[] = [];
  for (const entry of record.particles) {
    if (particles.length >= TRAIL_MAX_PARTICLES) {
      break;
    }
    const particle = readTrailParticle(entry);
    if (particle) {
      particles.push(particle);
    }
  }
  return { viewport, particles };
}

export function readTrailViewport(value: unknown): DipRect | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const x = readDip(record.x);
  const y = readDip(record.y);
  const width = readDipSize(record.width);
  const height = readDipSize(record.height);
  if (x === null || y === null || width === null || height === null) {
    return null;
  }
  return { x, y, width, height };
}

export function mixSeed(seed: number): { seed: number; unit: number } {
  let next = (Math.imul(seed | 0, 1664525) + 1013904223) | 0;
  if (next === 0) {
    next = 1;
  }
  return { seed: next, unit: (next >>> 0) / 4294967296 };
}

function spawnAlong(
  state: TrailState,
  existing: TrailParticle[],
  sample: TrailSample,
  key: string,
  now: number,
  dx: number,
  dy: number,
  distance: number,
  nextPoint: DipPoint,
): TrailStep {
  const work = sample.workArea;
  if (!work) {
    return { state, spawned: [], clearView: false, bounds: null, hold: 'no-work-area' };
  }
  const ux = dx / distance;
  const uy = dy / distance;
  let carry = state.carryDip + distance;
  let seed = state.seed;
  let nextId = state.nextId;
  const particles = existing.slice();
  const spawned: TrailParticle[] = [];
  const unit = (): number => {
    const mixed = mixSeed(seed);
    seed = mixed.seed;
    return mixed.unit;
  };
  let guard = 0;
  while (
    carry >= TRAIL_SPACING_DIP &&
    spawned.length < TRAIL_MAX_SPAWNS_PER_SAMPLE &&
    particles.length < TRAIL_MAX_PARTICLES &&
    guard < TRAIL_MAX_SPAWNS_PER_SAMPLE
  ) {
    guard += 1;
    carry -= TRAIL_SPACING_DIP;
    const side = unit() * 6 - 3;
    const x = nextPoint.x - ux * carry - uy * side;
    const y = nextPoint.y - uy * carry + ux * side;
    const diameter = TRAIL_MIN_DIAMETER_DIP + unit() * (TRAIL_MAX_DIAMETER_DIP - TRAIL_MIN_DIAMETER_DIP);
    const life = TRAIL_MIN_LIFE_MS + unit() * (TRAIL_MAX_LIFE_MS - TRAIL_MIN_LIFE_MS);
    const magnitude = 2 + unit() * 6;
    const angle = unit() * Math.PI * 2;
    if (!trailPointInside(x, y, work)) {
      continue;
    }
    const particle: TrailParticle = {
      id: nextId,
      x,
      y,
      born: now,
      life,
      diameter,
      driftX: Math.cos(angle) * magnitude,
      driftY: Math.sin(angle) * magnitude,
    };
    nextId += 1;
    particles.push(particle);
    spawned.push(particle);
  }
  if (particles.length >= TRAIL_MAX_PARTICLES) {
    carry = Math.min(carry, TRAIL_SPACING_DIP);
  }
  return {
    state: {
      ...state,
      seed,
      nextId,
      particles,
      carryDip: carry,
      anchorX: nextPoint.x,
      anchorY: nextPoint.y,
      windowX: sample.window.x,
      windowY: sample.window.y,
      windowW: sample.window.width,
      windowH: sample.window.height,
      workKey: key,
    },
    spawned,
    clearView: false,
    bounds: trailBounds(particles, work),
    hold: spawned.length > 0 ? null : 'outside',
  };
}

function baseline(state: TrailState, particles: TrailParticle[], sample: TrailSample, key: string): TrailStep {
  return {
    state: placeWindow({ ...state, particles }, sample, key, 0, null, null),
    spawned: [],
    clearView: false,
    bounds: sample.workArea ? trailBounds(particles, sample.workArea) : null,
    hold: 'baseline',
  };
}

function placeWindow(
  state: TrailState,
  sample: TrailSample,
  key: string,
  carryDip: number,
  anchorX: number | null,
  anchorY: number | null,
): TrailState {
  return {
    ...state,
    carryDip,
    anchorX,
    anchorY,
    windowX: sample.window.x,
    windowY: sample.window.y,
    windowW: sample.window.width,
    windowH: sample.window.height,
    workKey: key,
  };
}

function readTrailParticle(value: unknown): TrailParticle | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = readDip(record.id);
  const x = readDip(record.x);
  const y = readDip(record.y);
  const born = readBirth(record.born);
  const life = readLife(record.life);
  const diameter = readDiameter(record.diameter);
  const driftX = readDrift(record.driftX);
  const driftY = readDrift(record.driftY);
  if (
    id === null ||
    x === null ||
    y === null ||
    born === null ||
    life === null ||
    diameter === null ||
    driftX === null ||
    driftY === null
  ) {
    return null;
  }
  return { id, x, y, born, life, diameter, driftX, driftY };
}

function readDip(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000 ? value : null;
}

function readDipSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 16_000 ? value : null;
}

function readBirth(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10_000_000_000_000
    ? value
    : null;
}

function readLife(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 400 && value <= 1_200 ? value : null;
}

function readDiameter(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 2 && value <= 16 ? value : null;
}

function readDrift(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 32 ? value : null;
}

function workKey(area: DipRect): string {
  return `${Math.round(area.x)}:${Math.round(area.y)}:${Math.round(area.width)}:${Math.round(area.height)}`;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const span = edge1 - edge0;
  const t = span === 0 ? 0 : Math.min(1, Math.max(0, (value - edge0) / span));
  return t * t * (3 - 2 * t);
}
