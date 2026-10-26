import {
  canvasBitmapSize,
  particleVisual,
  readTrailFrame,
  readTrailViewport,
  trailLocal,
  type DipRect,
  type TrailParticle,
} from '../shared/neonTrail';

interface TrailDrawReport {
  count: number;
  ageMs: number;
  expired: number;
  clipped: number;
  canvasW: number;
  canvasH: number;
  dipW: number;
  dipH: number;
}

declare global {
  interface Window {
    trail?: {
      notifyHello(reduced: boolean): void;
      notifyMotion(reduced: boolean): void;
      notifyIdle(): void;
      notifyFault(): void;
      notifyDrew(report: TrailDrawReport): void;
      onSpawn(listener: (payload: unknown) => void): () => void;
      onViewport(listener: (payload: unknown) => void): () => void;
      onClear(listener: () => void): () => void;
      onMarker(listener: (payload: unknown) => void): () => void;
    };
  }
}

const MARKER_MS = 4_000;
const MARKER_DIAMETER = 28;

const found = document.querySelector('#pearls');
const canvas = found instanceof HTMLCanvasElement ? found : null;
const context = canvas?.getContext('2d', { alpha: true }) ?? null;
if (!canvas || !context) {
  window.trail?.notifyFault();
} else {
  boot(canvas, context);
}

function boot(canvas: HTMLCanvasElement, pen: CanvasRenderingContext2D): void {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  canvas.style.background = 'transparent';

  const particles: TrailParticle[] = [];
  let originX = 0;
  let originY = 0;
  let viewW = 0;
  let viewH = 0;
  let frame = 0;
  let maxFrameMs = 0;
  let reported = false;
  let markerUntil = 0;
  let pendingAge = 0;
  let pendingExpired = 0;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  window.trail?.notifyHello(reduced.matches);
  reduced.addEventListener('change', () => {
    window.trail?.notifyMotion(reduced.matches);
  });

  window.trail?.onSpawn((payload) => {
    const spawn = readTrailFrame(payload);
    if (!spawn || spawn.particles.length === 0) {
      reportDraw(0, 0, spawn ? spawn.particles.length : 0, 0);
      return;
    }
    const now = Date.now();
    let expired = 0;
    let youngest = Number.POSITIVE_INFINITY;
    applyViewport(spawn.viewport);
    for (const particle of spawn.particles) {
      const age = now - particle.born;
      if (age < youngest) {
        youngest = age;
      }
      if (age >= particle.life) {
        expired += 1;
      }
      particles.push(particle);
    }
    pendingAge = Number.isFinite(youngest) ? Math.max(0, Math.round(youngest)) : 0;
    pendingExpired = expired;
    reported = false;
    start();
  });

  window.trail?.onViewport((payload) => {
    const viewport = readTrailViewport(payload);
    if (viewport) {
      applyViewport(viewport);
    }
  });

  window.trail?.onMarker((payload) => {
    const viewport = readTrailViewport(payload);
    if (!viewport) {
      return;
    }
    applyViewport(viewport);
    markerUntil = performance.now() + MARKER_MS;
    pendingAge = 0;
    pendingExpired = 0;
    reported = false;
    start();
  });

  window.trail?.onClear(() => {
    particles.length = 0;
    markerUntil = 0;
    reported = false;
    stop();
    clearTransparent();
  });

  function markerActive(): boolean {
    return performance.now() < markerUntil;
  }

  function start(): void {
    if (frame !== 0 || (particles.length === 0 && !markerActive())) {
      return;
    }
    frame = window.requestAnimationFrame(draw);
  }

  function stop(): void {
    if (frame !== 0) {
      window.cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  function draw(): void {
    frame = 0;
    const started = performance.now();
    const now = Date.now();
    let write = 0;
    let clipped = 0;
    clearTransparent();
    const ratio = window.devicePixelRatio || 1;
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      if (!particle) {
        continue;
      }
      const visual = particleVisual(particle, now);
      if (!visual) {
        continue;
      }
      particles[write] = particle;
      write += 1;
      if (visual.alpha <= 0.004) {
        continue;
      }
      const local = trailLocal(visual.x, visual.y, originX, originY);
      const halo = Math.max(visual.diameter, 1) * 1.2;
      if (local.x < -halo || local.y < -halo || local.x > viewW + halo || local.y > viewH + halo) {
        clipped += 1;
        continue;
      }
      paintPearl(local.x, local.y, visual.diameter, visual.alpha);
    }
    particles.length = write;
    const showMarker = markerActive();
    if (showMarker) {
      paintPearl(viewW * 0.5, viewH * 0.5, MARKER_DIAMETER, 1);
    }
    const elapsed = performance.now() - started;
    if (elapsed > maxFrameMs) {
      maxFrameMs = elapsed;
    }
    const visible = write + (showMarker ? 1 : 0);
    if (!reported) {
      reported = true;
      reportDraw(visible, pendingAge, pendingExpired, clipped);
    }
    if (visible === 0) {
      reported = false;
      console.log(`desktop-companion: trail canvas=2d maxFrameMs=${maxFrameMs.toFixed(2)}`);
      maxFrameMs = 0;
      window.trail?.notifyIdle();
      return;
    }
    frame = window.requestAnimationFrame(draw);
  }

  function reportDraw(count: number, ageMs: number, expired: number, clipped: number): void {
    window.trail?.notifyDrew({
      count,
      ageMs,
      expired,
      clipped,
      canvasW: canvas.width,
      canvasH: canvas.height,
      dipW: viewW,
      dipH: viewH,
    });
  }

  function clearTransparent(): void {
    pen.setTransform(1, 0, 0, 1, 0, 0);
    pen.globalCompositeOperation = 'copy';
    pen.fillStyle = 'rgba(0, 0, 0, 0)';
    pen.fillRect(0, 0, canvas.width, canvas.height);
    pen.globalCompositeOperation = 'source-over';
  }

  function rgba(red: number, green: number, blue: number, alpha: number): string {
    return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
  }

  function paintPearl(x: number, y: number, diameter: number, alpha: number): void {
    const radius = Math.max(diameter * 0.5, 0.5);
    const halo = radius * 2.35;
    const glow = pen.createRadialGradient(x, y, radius * 0.15, x, y, halo);
    glow.addColorStop(0, rgba(236, 255, 214, alpha));
    glow.addColorStop(0.28, rgba(178, 255, 74, alpha * 0.95));
    glow.addColorStop(0.55, rgba(57, 255, 46, alpha * 0.42));
    glow.addColorStop(1, rgba(57, 255, 46, 0));
    pen.fillStyle = glow;
    pen.beginPath();
    pen.arc(x, y, halo, 0, Math.PI * 2);
    pen.fill();

    const core = pen.createRadialGradient(x - radius * 0.28, y - radius * 0.32, radius * 0.05, x, y, radius);
    core.addColorStop(0, rgba(255, 255, 246, alpha));
    core.addColorStop(0.42, rgba(186, 255, 92, alpha));
    core.addColorStop(1, rgba(36, 196, 28, alpha * 0.12));
    pen.fillStyle = core;
    pen.beginPath();
    pen.arc(x, y, radius, 0, Math.PI * 2);
    pen.fill();
  }

  function applyViewport(viewport: DipRect): void {
    originX = viewport.x;
    originY = viewport.y;
    viewW = viewport.width;
    viewH = viewport.height;
    const bitmap = canvasBitmapSize(viewport.width, viewport.height, window.devicePixelRatio || 1);
    if (!bitmap) {
      return;
    }
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    clearTransparent();
  }

  window.addEventListener('pagehide', stop);
}
