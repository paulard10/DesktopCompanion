import {
  ACESFilmicToneMapping,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { ORB_DIAMETER_DIP } from '../../shared/clickThrough';
import type { RobotGesture } from '../../shared/gesturePose';
import type { CursorSample } from '../../shared/ipc';
import {
  BODY_RADIUS_WORLD,
  CAMERA_FOV_DEGREES,
  cameraDistanceForBody,
} from '../../shared/robotFrame';
import type { AvatarAdapter } from './avatarAdapter';
import { createCharacterDirector } from './characterDirector';
import { createProceduralRobot } from './proceduralRobot';
import { isPresenceName } from '../../shared/presence';

const MAX_PIXEL_RATIO = 2;

export interface CompanionScene {
  pulse(nowMs: number): void;
  wake(nowMs: number): void;
  sleep(nowMs: number): void;
  noteCursor(sample: CursorSample): void;
  playGesture(name: RobotGesture, nowMs: number): void;
  isAwake(): boolean;
  onPhase(listener: (phase: string) => void): void;
  dispose(): void;
}

export function createCompanionScene(canvas: HTMLCanvasElement, onFirstFrame: () => void): CompanionScene {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
  } catch (error) {
    console.error('desktop-companion: webgl-unavailable', errorName(error));
    onFirstFrame();
    return {
      pulse() {},
      wake() {},
      sleep() {},
      noteCursor() {},
      playGesture() {},
      isAwake: () => false,
      onPhase() {},
      dispose() {},
    };
  }

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA_FOV_DEGREES, 1, 0.1, 50);
  camera.position.z = 10;

  const sky = new HemisphereLight(0xfff8ee, 0xb7c3d6, 0.72);
  const key = new DirectionalLight(0xfff4e4, 1.45);
  key.position.set(2.4, 3.6, 4.8);
  const fill = new DirectionalLight(0xd5e4ff, 0.38);
  fill.position.set(-3.2, 0.6, 2.4);
  scene.add(sky, key, fill);

  const avatar: AvatarAdapter = createProceduralRobot();
  const director = createCharacterDirector();
  scene.add(avatar.object);

  const resize = (): void => {
    const width = Math.max(window.innerWidth, 1);
    const height = Math.max(window.innerHeight, 1);
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.position.z = cameraDistanceForBody({
      viewportHeightPx: height,
      bodyDiameterPx: ORB_DIAMETER_DIP,
      fovDegrees: CAMERA_FOV_DEGREES,
      bodyRadiusWorld: BODY_RADIUS_WORLD,
    });
    camera.updateProjectionMatrix();
  };

  let loopAttached = false;
  let disposed = false;

  const frame = (): void => {
    if (disposed || document.hidden) {
      return;
    }
    const now = performance.now();
    const next = director.step(now);
    if (!next.render) {
      return;
    }
    avatar.apply(next.pose, now);
    renderer.render(scene, camera);
  };

  const attachLoop = (): void => {
    if (disposed || loopAttached || document.hidden) {
      return;
    }
    loopAttached = true;
    renderer.setAnimationLoop(frame);
  };

  const detachLoop = (): void => {
    if (!loopAttached) {
      return;
    }
    loopAttached = false;
    renderer.setAnimationLoop(null);
  };

  resize();
  const stopCursor =
    window.companion?.onCursorSample((sample) => {
      director.noteCursor(sample);
    }) ?? (() => {});
  const stopGesture =
    window.companion?.onGesture((gesture) => {
      director.playGesture(gesture, performance.now());
    }) ?? (() => {});
  const stopBehavior =
    window.companion?.onBehavior((command) => {
      const now = performance.now();
      if (command === 'wake') {
        director.wake(now);
        return;
      }
      director.sleep(now);
    }) ?? (() => {});
  const stopExplore =
    window.companion?.onExplore((durationMs) => {
      director.setExplore(durationMs, performance.now());
    }) ?? (() => {});
  const stopPresence =
    window.companion?.onPresence((presence) => {
      director.setPresence(isPresenceName(presence) ? presence : null);
    }) ?? (() => {});
  const stopEyePreview =
    window.companion?.onEyePreview((cue) => {
      director.setEyePreview(cue, performance.now());
    }) ?? (() => {});
  const stopTravel =
    window.companion?.onTravel((moving) => {
      director.setTravel(moving);
    }) ?? (() => {});
  try {
    const now = performance.now();
    const opening = director.step(now);
    avatar.apply(opening.pose, now);
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unavailable';
    const info = renderer.info.render;
    console.log(
      `desktop-companion: webgl ready calls=${info.calls} triangles=${info.triangles} dpr=${renderer.getPixelRatio()} gpu=${gpu}`,
    );
  } catch (error) {
    console.error('desktop-companion: webgl-render-failed', errorName(error));
  }
  onFirstFrame();
  attachLoop();

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      detachLoop();
      return;
    }
    resize();
    attachLoop();
  });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    console.error('desktop-companion: webgl-context-lost');
    detachLoop();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    console.log('desktop-companion: webgl-context-restored');
    resize();
    attachLoop();
  });

  return {
    pulse(nowMs: number): void {
      avatar.pulse(nowMs);
    },
    wake(nowMs: number): void {
      director.wake(nowMs);
    },
    sleep(nowMs: number): void {
      director.sleep(nowMs);
    },
    noteCursor(sample: CursorSample): void {
      director.noteCursor(sample);
    },
    playGesture(name: RobotGesture, nowMs: number): void {
      director.playGesture(name, nowMs);
    },
    isAwake(): boolean {
      return director.isAwake();
    },
    onPhase(listener: (phase: string) => void): void {
      director.onPhase(listener);
    },
    dispose(): void {
      disposed = true;
      stopCursor();
      stopGesture();
      stopBehavior();
      stopPresence();
      stopEyePreview();
      stopTravel();
      detachLoop();
      window.removeEventListener('resize', resize);
      avatar.dispose();
      renderer.dispose();
    },
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
