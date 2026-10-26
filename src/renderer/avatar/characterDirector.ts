import { ambientPose, blinkAmount, type AvatarPose } from '../../shared/ambientMotion';

declare global {
  interface ImportMeta {
    readonly env: { readonly DEV: boolean };
  }
}
import {
  alertness,
  initialBehavior,
  reduceBehavior,
  shouldRenderFrame,
  stepBehavior,
  wakeBounce,
  type BehaviorState,
  type Phase,
} from '../../shared/behavior';
import { SAMPLE_STALE_MS } from '../../shared/clickThrough';
import { REST_GAZE, gazeTarget, stepGaze, type Gaze } from '../../shared/gaze';
import { gestureOffset, type RobotGesture } from '../../shared/gesturePose';
import { type BehaviorPhaseName, type CursorSample } from '../../shared/ipc';
import { presentCharacter } from '../../shared/presentation';
import { applyPresence, type PresenceName } from '../../shared/presence';
import { applyTravelPose } from '../../shared/desktopMovement';
import {
  applyAlertness,
  eyeCueFromState,
  meanOpenness,
  restEyes,
  stepEyePairInto,
  writeEyeTarget,
  type EyeCue,
  type EyePreviewCue,
} from '../../shared/faceExpression';
import {
  gestureDuration,
  noteSecondaryCue,
  restClock,
  restSecondary,
  secondaryPoseId,
  secondarySampleInto,
  stepSecondaryInto,
  WAKE_PREVIEW_MS,
} from '../../shared/secondaryMotion';
import { RIG_PROBE_MS, type RigProbeName } from '../../shared/rigProbe';

export interface CharacterFrame {
  pose: AvatarPose;
  phase: Phase;
  render: boolean;
}

export interface CharacterDirector {
  wake(now: number): void;
  sleep(now: number): void;
  setExplore(durationMs: number | null, now: number): void;
  noteCursor(sample: CursorSample): void;
  playGesture(name: RobotGesture, now: number): void;
  setPresence(presence: PresenceName | null): void;
  setEyePreview(cue: EyePreviewCue, now: number): void;
  setTravel(moving: boolean): void;
  isAwake(): boolean;
  onPhase(listener: (phase: Phase) => void): void;
  step(now: number): CharacterFrame;
}

export function createCharacterDirector(): CharacterDirector {
  let behavior: BehaviorState = initialBehavior(0);
  let started = false;
  let announced = false;
  let gaze: Gaze = { ...REST_GAZE };
  let sample: CursorSample | null = null;
  let sampleSeenAt = Number.NEGATIVE_INFINITY;
  let lastRenderAt = Number.NEGATIVE_INFINITY;
  let gesture: { name: RobotGesture; started: number } | null = null;
  let presence: PresenceName | null = null;
  let preview: EyeCue | null = null;
  let blinkFastUntil = Number.NEGATIVE_INFINITY;
  let wakePreviewUntil = Number.NEGATIVE_INFINITY;
  const eyes = restEyes();
  const eyeGoal = restEyes();
  const secondary = restSecondary();
  const secondaryGoal = restSecondary();
  const secondaryClock = restClock();
  let poseTrace = '';
  let rigProbe: { name: RigProbeName; startedAt: number } | null = null;
  let traveling = false;
  let phaseListener: ((phase: Phase) => void) | null = null;
  let exploreDeferLogged = false;

  const ensure = (now: number): void => {
    if (!started) {
      behavior = initialBehavior(now);
      started = true;
    }
  };

  const freshCursor = (now: number): boolean => sample !== null && now - sampleSeenAt <= SAMPLE_STALE_MS;

  const commit = (next: BehaviorState): void => {
    if (!announced || next.phase !== behavior.phase) {
      if (typeof window !== 'undefined') {
      window.companion?.notifyPhase(next.phase as BehaviorPhaseName);
    }
      phaseListener?.(next.phase);
    }
    announced = true;
    behavior = next;
  };

  return {
    wake(now: number): void {
      ensure(now);
      commit(reduceBehavior(behavior, { type: 'WAKE' }, now));
    },
    sleep(now: number): void {
      ensure(now);
      commit(reduceBehavior(behavior, { type: 'USER_SLEEP' }, now));
    },
    setExplore(durationMs: number | null, now: number): void {
      ensure(now);
      if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
        commit(reduceBehavior(behavior, { type: 'EXPLORE', until: null }, now));
        return;
      }
      commit(reduceBehavior(behavior, { type: 'EXPLORE', until: now + durationMs }, now));
    },
    noteCursor(next: CursorSample): void {
      sample = next;
      sampleSeenAt = performance.now();
    },
    playGesture(name: RobotGesture, now: number): void {
      gesture = { name, started: now };
    },
    setPresence(next: PresenceName | null): void {
      if (presence === next) {
        return;
      }
      presence = next;
      preview = null;
      wakePreviewUntil = Number.NEGATIVE_INFINITY;
      trace(`desktop-companion: presence ${next ?? 'none'}`);
    },
    setEyePreview(cue: EyePreviewCue, now: number): void {
      trace(`desktop-companion: preview ${cue === 'CLEAR' ? 'clear' : cue}`);
      const probed = probeFromPreview(cue);
      if (probed) {
        if (behavior.phase === 'SLEEPING' || behavior.phase === 'RETURNING_TO_SLEEP') {
          rigProbe = null;
          trace('desktop-companion: probe cancel=sleep');
          return;
        }
        if (probed === 'reset') {
          rigProbe = null;
          trace('desktop-companion: probe reset');
          return;
        }
        rigProbe = { name: probed, startedAt: now };
        trace(`desktop-companion: probe start actuator=${probed} presence=${presence ?? 'none'} preview=${preview ?? 'none'}`);
        return;
      }
      if (cue === 'WAKING') {
        if (behavior.phase === 'SLEEPING' || behavior.phase === 'RETURNING_TO_SLEEP') {
          return;
        }
        wakePreviewUntil = now + WAKE_PREVIEW_MS;
        return;
      }
      if (cue === 'BLINK') {
        blinkFastUntil = now + 3_600;
        return;
      }
      wakePreviewUntil = Number.NEGATIVE_INFINITY;
      if (cue === 'CLEAR') {
        preview = null;
        return;
      }
      if (cue === 'CURIOUS' || cue === 'SLEEPING') {
        preview = cue;
      }
    },
    setTravel(moving: boolean): void {
      traveling = moving;
    },
    isAwake(): boolean {
      return behavior.phase === 'WAKING' || behavior.phase === 'IDLE' || behavior.phase === 'TRACKING';
    },
    onPhase(listener: (phase: Phase) => void): void {
      phaseListener = listener;
      listener(behavior.phase);
    },
    step(now: number): CharacterFrame {
      ensure(now);
      const previousTick = behavior.lastTick;
      const next = stepBehavior(behavior, now, freshCursor(now));
      commit(next);
      if (
        !exploreDeferLogged &&
        behavior.exploreUntil !== null &&
        behavior.sleepDeadline !== null &&
        now >= behavior.sleepDeadline &&
        now < behavior.exploreUntil
      ) {
        exploreDeferLogged = true;
        console.log('desktop-companion: explore deferring sleep');
      }
      if (exploreDeferLogged && behavior.phase === 'RETURNING_TO_SLEEP') {
        exploreDeferLogged = false;
        console.log('desktop-companion: explore released sleep');
      }
      const eyesOpen = behavior.phase === 'WAKING' || behavior.phase === 'IDLE' || behavior.phase === 'TRACKING';
      const target =
        eyesOpen && sample && freshCursor(now)
          ? gazeTarget({
              cursorX: sample.x,
              cursorY: sample.y,
              originX: sample.originX,
              originY: sample.originY,
              width: sample.width,
              height: sample.height,
            })
          : REST_GAZE;
      gaze = stepGaze(gaze, target, now - previousTick);
      const level = alertness(behavior, now);
      const reducedMotion = prefersReducedMotion();
      if (behavior.phase === 'SLEEPING' || behavior.phase === 'RETURNING_TO_SLEEP') {
        preview = null;
        blinkFastUntil = Number.NEGATIVE_INFINITY;
        wakePreviewUntil = Number.NEGATIVE_INFINITY;
      }
      const cue = eyeCueFromState({
        presence,
        phase: behavior.phase,
        tracking: behavior.phase === 'TRACKING',
        preview,
      });
      writeEyeTarget(cue, now, reducedMotion, eyeGoal);
      applyAlertness(eyeGoal, level, cue === 'SLEEPING');
      stepEyePairInto(eyes, eyes, eyeGoal, now - previousTick);
      const sleeping = cue === 'SLEEPING' || behavior.phase === 'SLEEPING' || behavior.phase === 'RETURNING_TO_SLEEP';
      if (sleeping) {
        if (rigProbe) {
          trace('desktop-companion: probe cancel=sleep');
        }
        rigProbe = null;
      } else if (rigProbe && now - rigProbe.startedAt >= RIG_PROBE_MS) {
        trace(`desktop-companion: probe done actuator=${rigProbe.name}`);
        rigProbe = null;
      }
      noteSecondaryCue(secondaryClock, cue, now, sleeping);
      if (secondaryClock.gesture !== 'none' && now - secondaryClock.startedAt >= gestureDuration(secondaryClock.gesture)) {
        secondaryClock.gesture = 'none';
      }
      const wakeAge = !sleeping && now < wakePreviewUntil ? now - (wakePreviewUntil - WAKE_PREVIEW_MS) : -1;
      secondarySampleInto(
        secondaryGoal,
        cue,
        now,
        secondaryClock.gesture,
        secondaryClock.gesture === 'none' ? -1 : now - secondaryClock.startedAt,
        level,
        reducedMotion,
        wakeAge,
      );
      stepSecondaryInto(secondary, secondary, secondaryGoal, now - previousTick);
      const poseId = secondaryPoseId(
        cue,
        secondaryClock.gesture,
        secondaryClock.gesture === 'none' ? -1 : now - secondaryClock.startedAt,
        sleeping,
        wakeAge,
      );
      const poseLine = `desktop-companion: pose presence=${presence ?? 'none'} cue=${cue} gesture=${secondaryClock.gesture} pose=${poseId}`;
      if (poseLine !== poseTrace) {
        poseTrace = poseLine;
        trace(poseLine);
      }
      const ambient = ambientPose(now);
      const mix = secondary.ambientMix;
      if (mix < 1) {
        ambient.hover *= mix;
        ambient.tiltX *= mix;
        ambient.tiltZ *= mix;
        ambient.antenna *= mix;
      }
      const pose = applyTravelPose(
        withGesture(
          applyPresence(
            presentCharacter({
              ambient,
              alertness: level,
              wakeBounce: wakeBounce(behavior, now),
              gazeYaw: gaze.yaw,
              gazePitch: gaze.pitch,
            }),
            presence,
            level,
            now,
            reducedMotion,
          ),
          gesture,
          now,
        ),
        { traveling, alertness: level, presence, reducedMotion, now },
      );
      if (gesture && gestureOffset(gesture.name, now - gesture.started) === null) {
        gesture = null;
      }
      const blink = now < blinkFastUntil && level > 0.92 && cue !== 'SLEEPING' ? blinkAmount(now, 900) : pose.blink;
      const render = shouldRenderFrame(behavior.phase, now, lastRenderAt) || gesture !== null;
      if (render) {
        lastRenderAt = now;
      }
      return {
        pose: { ...pose, blink, eyes, eyeScale: meanOpenness(eyes), secondary, rigProbe },
        phase: behavior.phase,
        render,
      };
    },
  };
}

function probeFromPreview(cue: EyePreviewCue): RigProbeName | 'reset' | null {
  if (cue === 'PROBE_LEFT') {
    return 'left-arm';
  }
  if (cue === 'PROBE_RIGHT') {
    return 'right-arm';
  }
  if (cue === 'PROBE_ANTENNA') {
    return 'antenna';
  }
  if (cue === 'PROBE_BODY') {
    return 'body';
  }
  if (cue === 'PROBE_RESET') {
    return 'reset';
  }
  return null;
}

function trace(line: string): void {
  if (import.meta.env.DEV) {
    console.log(line);
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function withGesture(
  pose: AvatarPose,
  active: { name: RobotGesture; started: number } | null,
  now: number,
): AvatarPose {
  if (!active || prefersReducedMotion()) {
    return pose;
  }
  const offset = gestureOffset(active.name, now - active.started);
  if (!offset) {
    return pose;
  }
  return {
    ...pose,
    tiltX: pose.tiltX + offset.tiltX,
    tiltZ: pose.tiltZ + offset.tiltZ,
    antenna: pose.antenna + offset.antenna,
    wakeScale: pose.wakeScale * offset.wakeScale,
  };
}
