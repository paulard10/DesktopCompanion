import { ambientPose, blinkAmount, variedBlinkAmount, type AvatarPose } from '../../shared/ambientMotion';

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
  BOUNCE_MS,
  gestureDuration,
  noteSecondaryCue,
  restClock,
  restSecondary,
  secondaryPoseId,
  secondarySampleInto,
  stepSecondaryInto,
  WAKE_PREVIEW_MS,
  WAVE_MS,
} from '../../shared/secondaryMotion';
import { RIG_PROBE_MS, type RigProbeName } from '../../shared/rigProbe';
import { applyIdleEyes, idleBeat } from '../../shared/idlePersonality';
import { LIFE_STILL_MS } from '../../shared/life';

export interface CharacterFrame {
  pose: AvatarPose;
  phase: Phase;
  render: boolean;
}

export interface CharacterDirector {
  wake(now: number): void;
  sleep(now: number): void;
  engage(now: number): void;
  linger(now: number): void;
  holdActivity(now: number): void;
  releaseActivity(now: number): void;
  setExplore(durationMs: number | null, now: number): void;
  noteCursor(sample: CursorSample): void;
  playGesture(name: RobotGesture, now: number): void;
  react(now: number): void;
  setPresence(presence: PresenceName | null): void;
  setEyePreview(cue: EyePreviewCue, now: number): void;
  setTravel(moving: boolean): void;
  isAwake(): boolean;
  isSleeping(): boolean;
  prefersCalm(): boolean;
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
  let stillX = 0;
  let stillY = 0;
  let stillSince = 0;
  let userCalm = false;
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
  let travelBegan = Number.NEGATIVE_INFINITY;
  let idleMarked = -1;
  let dozing = false;
  let waveUntil = Number.NEGATIVE_INFINITY;
  let cheerUntil = Number.NEGATIVE_INFINITY;
  let cursorWasNear = false;
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
      const opening = !started;
      ensure(now);
      const fromSleep = opening || behavior.phase === 'SLEEPING' || behavior.phase === 'RETURNING_TO_SLEEP';
      dozing = false;
      blinkFastUntil = now + 900;
      if (fromSleep) {
        wakePreviewUntil = now + WAKE_PREVIEW_MS;
        waveUntil = now + WAVE_MS;
      }
      commit(reduceBehavior(behavior, { type: 'WAKE' }, now));
    },
    sleep(now: number): void {
      ensure(now);
      dozing = false;
      commit(reduceBehavior(behavior, { type: 'USER_SLEEP' }, now));
    },
    engage(now: number): void {
      ensure(now);
      commit(reduceBehavior(behavior, { type: 'ENGAGE' }, now));
    },
    linger(now: number): void {
      ensure(now);
      dozing = behavior.phase === 'WAKING' || behavior.phase === 'IDLE' || behavior.phase === 'TRACKING';
      commit(reduceBehavior(behavior, { type: 'LINGER' }, now));
    },
    holdActivity(now: number): void {
      ensure(now);
      commit(reduceBehavior(behavior, { type: 'HOLD' }, now));
    },
    releaseActivity(now: number): void {
      ensure(now);
      dozing = false;
      commit(reduceBehavior(behavior, { type: 'RELEASE' }, now));
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
      const now = performance.now();
      if (next.calm === true || next.calm === false) {
        userCalm = next.calm;
      }
      if (sample && (next.x - stillX) ** 2 + (next.y - stillY) ** 2 >= 36) {
        stillX = next.x;
        stillY = next.y;
        stillSince = now;
      } else if (stillSince === 0) {
        stillX = next.x;
        stillY = next.y;
        stillSince = now;
      }
      sample = next;
      sampleSeenAt = now;
    },
    playGesture(name: RobotGesture, now: number): void {
      gesture = { name, started: now };
      if (name === 'greet' && !importantPresence(presence)) {
        waveUntil = now + WAVE_MS;
        blinkFastUntil = Math.max(blinkFastUntil, now + 800);
      }
    },
    react(now: number): void {
      ensure(now);
      if (behavior.phase === 'SLEEPING' || behavior.phase === 'RETURNING_TO_SLEEP' || behavior.phase === 'WAKING') {
        return;
      }
      if (importantPresence(presence) || now < waveUntil) {
        return;
      }
      cheerUntil = now + BOUNCE_MS;
      blinkFastUntil = Math.max(blinkFastUntil, now + 700);
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
      if (cue === 'CURIOUS' || cue === 'SURPRISED' || cue === 'SLEEPING') {
        preview = cue;
      }
    },
    setTravel(moving: boolean): void {
      if (moving && !traveling) travelBegan = performance.now();
      if (!moving) travelBegan = Number.NEGATIVE_INFINITY;
      traveling = moving;
    },
    isAwake(): boolean {
      return behavior.phase === 'WAKING' || behavior.phase === 'IDLE' || behavior.phase === 'TRACKING';
    },
    isSleeping(): boolean {
      return behavior.phase === 'SLEEPING';
    },
    prefersCalm(): boolean {
      return userCalm || prefersReducedMotion();
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
      const reducedMotion = userCalm || prefersReducedMotion();
      const cursorStill = freshCursor(now) && now - stillSince >= LIFE_STILL_MS;
      if (behavior.phase === 'SLEEPING' || behavior.phase === 'RETURNING_TO_SLEEP') {
        preview = null;
        dozing = false;
        blinkFastUntil = Number.NEGATIVE_INFINITY;
        wakePreviewUntil = Number.NEGATIVE_INFINITY;
      }
      const cue = eyeCueFromState({
        presence,
        phase: behavior.phase,
        tracking: traveling,
        preview,
      });
      writeEyeTarget(cue, now, reducedMotion, eyeGoal);
      const canIdle =
        cue === 'IDLE' &&
        (behavior.phase === 'IDLE' || (cursorStill && behavior.phase === 'TRACKING')) &&
        presence === null &&
        !traveling &&
        !reducedMotion &&
        !dozing;
      const beat = canIdle ? idleBeat(now) : null;
      const nearCursor = cursorIsNear(sample, freshCursor(now));
      if (beat?.active) {
        applyIdleEyes(eyeGoal, beat.act);
      } else if (nearCursor && cue === 'IDLE' && !reducedMotion && !dozing) {
        eyeGoal.left.openness = 1.14;
        eyeGoal.right.openness = 1.14;
        eyeGoal.left.lift = 0.012;
        eyeGoal.right.lift = 0.012;
        eyeGoal.left.tilt = 0.08;
        eyeGoal.right.tilt = -0.08;
        eyeGoal.left.glow = 1.06;
        eyeGoal.right.glow = 1.06;
      }
      if (nearCursor && !cursorWasNear && cue !== 'SLEEPING' && !reducedMotion && !dozing) {
        blinkFastUntil = Math.max(blinkFastUntil, now + 800);
      }
      cursorWasNear = nearCursor;
      if (dozing && (cue === 'IDLE' || cue === 'CURIOUS')) {
        eyeGoal.left.openness = 0.72;
        eyeGoal.right.openness = 0.72;
        eyeGoal.left.gazePitch = 0.04;
        eyeGoal.right.gazePitch = 0.04;
      }
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
      if (beat?.active && beat.slot !== idleMarked && secondaryClock.gesture === 'none' && !importantPresence(presence)) {
        idleMarked = beat.slot;
        if (beat.act === 'wave') {
          secondaryClock.gesture = 'wave';
          secondaryClock.startedAt = now;
        } else if (beat.act === 'stretch' || beat.act === 'tilt') {
          secondaryClock.gesture = 'nod';
          secondaryClock.startedAt = now;
        } else if (beat.act === 'happy' || beat.act === 'surprise') {
          secondaryClock.gesture = 'bounce';
          secondaryClock.startedAt = now;
        }
      }
      if (!sleeping && !importantPresence(presence) && now < waveUntil && (secondaryClock.gesture === 'none' || secondaryClock.gesture === 'bounce')) {
        secondaryClock.gesture = 'wave';
        secondaryClock.startedAt = waveUntil - WAVE_MS;
      } else if (!sleeping && !importantPresence(presence) && now < cheerUntil && secondaryClock.gesture === 'none') {
        secondaryClock.gesture = 'bounce';
        secondaryClock.startedAt = cheerUntil - BOUNCE_MS;
      }
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
      if (!sleeping && !reducedMotion && sample && freshCursor(now)) {
        const dx = sample.x - (sample.originX + sample.width / 2);
        const lean = Math.max(-0.045, Math.min(0.045, dx / 900));
        secondaryGoal.bodyTilt = Math.max(-0.08, Math.min(0.08, secondaryGoal.bodyTilt + lean));
        secondaryGoal.headTilt = Math.max(-0.08, Math.min(0.08, secondaryGoal.headTilt + lean * 0.65));
        if (nearCursor && cue === 'IDLE') {
          secondaryGoal.antennaSway = Math.max(-0.28, Math.min(0.28, secondaryGoal.antennaSway + 0.1));
        }
      }
      if (beat?.active && secondaryClock.gesture === 'none' && !reducedMotion) {
        if (beat.act === 'antenna') {
          secondaryGoal.antennaSway = Math.max(-0.28, Math.min(0.28, 0.16 + Math.sin(now / 320) * 0.08));
        } else if (beat.act === 'turn') {
          secondaryGoal.bodyTilt = beat.slot % 2 === 0 ? 0.06 : -0.06;
        }
      }
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
        { traveling, alertness: level, presence, reducedMotion, now, travelAgeMs: traveling ? now - travelBegan : undefined },
      );
      if (gesture && gestureOffset(gesture.name, now - gesture.started) === null) {
        gesture = null;
      }
      const blink = cue === 'SLEEPING'
        ? pose.blink
        : now < blinkFastUntil && level > 0.92
          ? blinkAmount(now, 900)
          : level > 0.92
            ? variedBlinkAmount(now)
            : pose.blink;
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

function importantPresence(presence: PresenceName | null): boolean {
  return presence === 'THINKING' || presence === 'RESPONDING' || presence === 'SPEAKING' || presence === 'ERROR' || presence === 'HAPPY';
}

function cursorIsNear(sample: CursorSample | null, fresh: boolean): boolean {
  if (!fresh || sample === null) {
    return false;
  }
  const dx = sample.x - (sample.originX + sample.width / 2);
  const dy = sample.y - (sample.originY + sample.height / 2);
  return dx * dx + dy * dy < 280 * 280;
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
