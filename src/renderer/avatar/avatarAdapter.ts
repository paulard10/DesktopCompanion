import type { Object3D } from 'three';
import type { AvatarPose } from '../../shared/ambientMotion';

/**
 * The procedural robot and a future GLB rig both implement this.
 * Animation code talks to the adapter, not to mesh names inside one asset.
 */
export interface AvatarAdapter {
  readonly object: Object3D;
  apply(pose: AvatarPose, nowMs: number): void;
  pulse(nowMs: number): void;
  dispose(): void;
}
