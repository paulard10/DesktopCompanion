/** Short, validated expressions. The renderer cannot invent a gesture name. */

export const ROBOT_GESTURES = ['greet', 'nod', 'explain'] as const;

export type RobotGesture = (typeof ROBOT_GESTURES)[number];

export interface GestureOffset {
  tiltX: number;
  tiltZ: number;
  antenna: number;
  wakeScale: number;
}

const DURATION_MS: Record<RobotGesture, number> = {
  greet: 700,
  nod: 560,
  explain: 640,
};

export function readGesture(value: unknown): RobotGesture | null {
  if (value === 'greet' || value === 'nod' || value === 'explain') {
    return value;
  }
  return null;
}

/** Null once the gesture has finished. Offsets stay small enough to fit the frame. */
export function gestureOffset(name: RobotGesture, elapsedMs: number): GestureOffset | null {
  const duration = DURATION_MS[name];
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= duration) {
    return null;
  }
  const envelope = Math.sin((elapsedMs / duration) * Math.PI);
  if (name === 'greet') {
    return { tiltX: -0.08 * envelope, tiltZ: 0, antenna: -0.18 * envelope, wakeScale: 1 + 0.03 * envelope };
  }
  if (name === 'nod') {
    return { tiltX: 0.14 * envelope, tiltZ: 0, antenna: 0, wakeScale: 1 };
  }
  return { tiltX: 0, tiltZ: 0.07 * envelope, antenna: 0.08 * envelope, wakeScale: 1 };
}
