/** Conversational presence, separate from sleep and wake. Blink stays on the blink clock. */

export const PRESENCE_NAMES = ['ATTENTIVE', 'THINKING', 'RESPONDING', 'SPEAKING', 'HAPPY', 'ERROR', 'IDLE'] as const;

export type PresenceName = (typeof PRESENCE_NAMES)[number];

export function isPresenceName(value: string): value is PresenceName {
  return (PRESENCE_NAMES as readonly string[]).includes(value);
}

export interface PresencePose {
  glow: number;
  antenna: number;
  hover: number;
  blink: number;
  tiltX?: number;
  wakeScale?: number;
  /** 1 is the normal arch. Below 1 concentrates the eyes. Above 1 cheers them. */
  eyeScale?: number;
}

/** Awake poses only. Sleep, and the start of a wake, keep the physical pose. */
export function applyPresence<T extends PresencePose>(
  pose: T,
  presence: PresenceName | null,
  alertness: number,
  now: number,
  reducedMotion: boolean,
): T {
  if (!presence || alertness < 0.9) {
    return pose;
  }
  const pulse = reducedMotion ? 0 : Math.sin(now / 280);
  if (presence === 'THINKING') {
    return {
      ...pose,
      glow: clamp(pose.glow * 1.12, 0, 1.25),
      antenna: pose.antenna - 0.16,
      eyeScale: 0.87,
      tiltX: (pose.tiltX ?? 0) + 0.05,
    };
  }
  if (presence === 'RESPONDING') {
    return {
      ...pose,
      glow: clamp(pose.glow * 1.06, 0, 1.2),
      hover: pose.hover + (reducedMotion ? 0 : pulse * 0.008),
    };
  }
  if (presence === 'SPEAKING') {
    return {
      ...pose,
      glow: clamp(pose.glow * 1.08, 0, 1.18),
      antenna: pose.antenna - 0.05,
      hover: pose.hover + (reducedMotion ? 0 : pulse * 0.006),
      eyeScale: 1.05,
    };
  }
  if (presence === 'ERROR') {
    return {
      ...pose,
      glow: pose.glow * 0.72,
      antenna: pose.antenna + 0.16,
    };
  }
  if (presence === 'HAPPY') {
    return {
      ...pose,
      glow: clamp(pose.glow * 1.32, 0, 1.45),
      antenna: pose.antenna - 0.24,
      hover: pose.hover + (reducedMotion ? 0.012 : 0.018),
      tiltX: (pose.tiltX ?? 0) - (reducedMotion ? 0.05 : 0.08),
      wakeScale: pose.wakeScale ?? 1,
      eyeScale: 1.08,
    };
  }
  if (presence === 'IDLE') {
    return pose;
  }
  return {
    ...pose,
    glow: clamp(pose.glow * 1.05, 0, 1.15),
    antenna: pose.antenna - 0.04,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
