import {
  CapsuleGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PointLight,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { clickPulseScale, type AvatarPose } from '../../shared/ambientMotion';
import { rigProbeOffset } from '../../shared/rigProbe';
import { EYE_CLOSED, revealEyeInto, type EyePair, type EyeShape, type RevealedEye } from '../../shared/faceExpression';
import {
  ANTENNA_ROOT_Y,
  ANTENNA_STEM_LENGTH,
  ANTENNA_TIP_RADIUS,
  BODY_RADIUS_WORLD,
  BODY_REST_SCALE,
  FOREARM_LENGTH,
  HAND_RADIUS,
  SHOULDER_X,
  SHOULDER_Y,
  UPPER_ARM_LENGTH,
} from '../../shared/robotFrame';
import type { AvatarAdapter } from './avatarAdapter';

const SHELL = 0xf3f0ea;
const probePoint = new Vector3();
let probeLogged = '';
const drawnEye: RevealedEye = { scaleX: 1, scaleY: 1, lift: 0, tilt: 0, gazeYaw: 0, gazePitch: 0 };
const FACE = 0x07080c;
const EYE = 0xb6ff3a;
const CHEEK = 0x93e85a;
const TIP = 0xc6ff55;

/**
 * Code-built stand-in for a later Blender GLB.
 * Node names are the contract a skinned asset should keep.
 */
export function createProceduralRobot(): AvatarAdapter {
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];

  const shell = physical(SHELL, 0.38, 0.45, 0.35);
  const faceMaterial = physical(FACE, 0.07, 1, 0.06);
  faceMaterial.metalness = 0.08;
  const leftEyeMaterial = flat(EYE);
  const rightEyeMaterial = flat(EYE);
  const cheekMaterial = flat(CHEEK);
  const tipMaterial = flat(TIP);
  const ringMaterial = flat(EYE);
  const leftCatchMaterial = catchlight();
  const rightCatchMaterial = catchlight();
  materials.push(
    shell,
    faceMaterial,
    leftEyeMaterial,
    rightEyeMaterial,
    cheekMaterial,
    tipMaterial,
    ringMaterial,
    leftCatchMaterial,
    rightCatchMaterial,
  );

  const root = new Group();
  root.name = 'Root';
  const hover = new Group();
  hover.name = 'Hover';
  const pivot = new Group();
  pivot.name = 'Body pivot';
  root.add(hover);
  hover.add(pivot);

  const body = new Mesh(track(new SphereGeometry(BODY_RADIUS_WORLD, 64, 48), geometries), shell);
  body.name = 'Main body';
  body.scale.set(BODY_REST_SCALE.x, BODY_REST_SCALE.y, BODY_REST_SCALE.z);
  const bodyRest = { x: body.scale.x, y: body.scale.y, z: body.scale.z };
  pivot.add(body);

  const face = new Group();
  face.name = 'Face display';
  face.position.set(0, 0.04, 0.56);
  pivot.add(face);

  const lens = new Mesh(track(new SphereGeometry(0.72, 48, 36), geometries), faceMaterial);
  lens.scale.set(1.22, 0.96, 0.66);
  face.add(lens);

  const leftEye = createEye(leftEyeMaterial, leftCatchMaterial, geometries, 1);
  leftEye.name = 'Left eye';
  leftEye.position.set(-0.26, 0.08, 0.46);
  const rightEye = createEye(rightEyeMaterial, rightCatchMaterial, geometries, -1);
  rightEye.name = 'Right eye';
  rightEye.position.set(0.26, 0.08, 0.46);
  const leftBaseY = leftEye.position.y;
  const rightBaseY = rightEye.position.y;
  face.add(leftEye, rightEye);

  const cheeks = new Group();
  cheeks.name = 'Cheek lights';
  cheeks.add(createCheek(cheekMaterial, geometries, -0.4));
  cheeks.add(createCheek(cheekMaterial, geometries, 0.4));
  cheeks.position.z = 0.42;
  face.add(cheeks);

  const antenna = new Group();
  antenna.name = 'Antenna base';
  antenna.position.y = ANTENNA_ROOT_Y;
  antenna.rotation.z = 0.12;
  const stem = new Mesh(
    track(new CylinderGeometry(0.035, 0.055, ANTENNA_STEM_LENGTH, 12), geometries),
    shell,
  );
  stem.position.y = ANTENNA_STEM_LENGTH / 2;
  const tip = new Mesh(track(new SphereGeometry(ANTENNA_TIP_RADIUS, 24, 18), geometries), tipMaterial);
  tip.name = 'Antenna tip';
  tip.position.y = ANTENNA_STEM_LENGTH + ANTENNA_TIP_RADIUS * 0.82;
  const tipLight = new PointLight(TIP, 0.16, 1.8, 2);
  tipLight.position.y = tip.position.y;
  antenna.add(stem, tip, tipLight);
  pivot.add(antenna);

  const leftArm = createArm(shell, ringMaterial, geometries, 1);
  leftArm.name = 'Left arm';
  const rightArm = createArm(shell, ringMaterial, geometries, -1);
  rightArm.name = 'Right arm';
  pivot.add(leftArm, rightArm);
  const leftElbow = elbowOf(leftArm);
  const rightElbow = elbowOf(rightArm);
  const leftRest = { x: leftArm.rotation.x, z: leftArm.rotation.z, elbow: leftElbow.rotation.z };
  const rightRest = { x: rightArm.rotation.x, z: rightArm.rotation.z, elbow: rightElbow.rotation.z };
  const leftCatchlight = leftEye.children[1];
  const rightCatchlight = rightEye.children[1];

  let pulseStartedAt: number | null = null;

  return {
    object: root,
    apply(pose: AvatarPose, nowMs: number): void {
      const motion = pose.secondary;
      const breath = 1 + (motion?.breathingScale ?? 0);
      hover.position.y = pose.hover + (motion?.bodyBob ?? 0);
      const bodyRoll = pose.tiltZ + (motion?.bodyTilt ?? 0);
      pivot.rotation.x = pose.tiltX + (motion?.headTilt ?? 0);
      pivot.rotation.y = -pose.bodyYaw;
      pivot.rotation.z = bodyRoll;
      pivot.scale.setScalar(clickPulseScale(pulseStartedAt, nowMs) * pose.wakeScale);
      body.scale.set(bodyRest.x * breath, bodyRest.y * breath, bodyRest.z * breath);
      const lookYaw = -(pose.eyeYaw - pose.bodyYaw);
      const pair = eyesFromPose(pose);
      applyEye(leftEye, pair.left, leftBaseY, lookYaw, pose.eyePitch, pose.blink, pose.glow, leftEyeMaterial, leftCatchMaterial, leftCatchlight);
      applyEye(rightEye, pair.right, rightBaseY, lookYaw, pose.eyePitch, pose.blink, pose.glow, rightEyeMaterial, rightCatchMaterial, rightCatchlight);
      paint(cheekMaterial, CHEEK, pose.glow);
      paint(tipMaterial, TIP, pose.glow);
      paint(ringMaterial, EYE, pose.glow);
      leftCatchMaterial.color.setScalar(pose.glow);
      rightCatchMaterial.color.setScalar(pose.glow);
      tipLight.intensity = 0.16 * pose.glow;
      antenna.rotation.z = 0.12 + pose.antenna + (motion?.antennaSway ?? 0);
      antenna.rotation.x = pose.armRelax * 0.32;
      const relax = pose.armRelax;
      const leftLift = motion?.leftArmLift ?? 0;
      const rightLift = motion?.rightArmLift ?? 0;
      leftArm.rotation.x = leftRest.x + relax * 0.28;
      leftArm.rotation.z = leftRest.z * (1 - relax * 0.45) + leftLift;
      leftElbow.rotation.z = leftRest.elbow - relax * 0.22;
      rightArm.rotation.x = rightRest.x + relax * 0.28;
      rightArm.rotation.z = rightRest.z * (1 - relax * 0.45) - rightLift;
      rightElbow.rotation.z = rightRest.elbow + relax * 0.22;
      const probe = pose.rigProbe;
      const probeAge = probe ? nowMs - probe.startedAt : -1;
      const probePose = probe ? rigProbeOffset(probe.name, probeAge) : null;
      if (probePose?.leftArmZ) {
        leftArm.rotation.z = leftRest.z + probePose.leftArmZ;
      }
      if (probePose?.rightArmZ) {
        rightArm.rotation.z = rightRest.z + probePose.rightArmZ;
      }
      if (probePose?.antennaZ) {
        antenna.rotation.z = 0.12 + probePose.antennaZ;
      }
      if (probePose?.bodyZ) {
        pivot.rotation.z = bodyRoll + probePose.bodyZ;
      }
      face.rotation.set(0, 0, 0);
      const probeName = probePose && probe ? probe.name : '';
      if (probeName !== probeLogged) {
        const previous = probeLogged;
        probeLogged = probeName;
        if (import.meta.env.DEV) {
          const activeName = probeName || previous;
          const node = activeName === 'left-arm' ? leftArm : activeName === 'right-arm' ? rightArm : activeName === 'antenna' ? antenna : pivot;
          const marker = activeName === 'left-arm'
            ? leftElbow.children[leftElbow.children.length - 1] ?? leftArm
            : activeName === 'right-arm'
              ? rightElbow.children[rightElbow.children.length - 1] ?? rightArm
              : tip;
          marker.updateWorldMatrix(true, false);
          marker.getWorldPosition(probePoint);
          const applied = activeName === 'left-arm'
            ? leftArm.rotation.z
            : activeName === 'right-arm'
              ? rightArm.rotation.z
              : activeName === 'antenna'
                ? antenna.rotation.z
                : pivot.rotation.z;
          const rest = activeName === 'left-arm' ? leftRest.z : activeName === 'right-arm' ? rightRest.z : activeName === 'antenna' ? 0.12 : bodyRoll;
          console.log(
            `desktop-companion: probe actuator=${probeName || 'reset'} node=${node.name} rest=${rest.toFixed(3)} applied=${applied.toFixed(3)} world=${probePoint.x.toFixed(2)},${probePoint.y.toFixed(2)},${probePoint.z.toFixed(2)}`,
          );
        }
      }
    },
    pulse(nowMs: number): void {
      pulseStartedAt = nowMs;
    },
    dispose(): void {
      root.removeFromParent();
      for (const geometry of geometries) {
        geometry.dispose();
      }
      for (const material of materials) {
        material.dispose();
      }
    },
  };
}

function applyEye(
  eye: Group,
  shape: EyeShape,
  baseY: number,
  lookYaw: number,
  lookPitch: number,
  blink: number,
  bodyGlow: number,
  material: MeshBasicMaterial,
  catchMaterial: MeshBasicMaterial,
  catchlightMesh: { visible: boolean } | undefined,
): void {
  const drawn = revealEyeInto(drawnEye, shape, blink);
  const glow = Number.isFinite(shape.glow) ? shape.glow : 1;
  const body = Number.isFinite(bodyGlow) ? bodyGlow : 1;
  eye.scale.set(drawn.scaleX, drawn.scaleY, 1);
  eye.position.y = baseY + drawn.lift;
  eye.rotation.set(lookPitch + drawn.gazePitch, lookYaw + drawn.gazeYaw, drawn.tilt);
  paint(material, EYE, body * glow);
  const highlight = drawn.scaleY <= EYE_CLOSED + 0.02 ? 0 : Math.min(1, (drawn.scaleY - EYE_CLOSED) / 0.35) * body;
  catchMaterial.opacity = highlight;
  if (catchlightMesh) {
    catchlightMesh.visible = highlight > 0.05;
  }
}

function eyesFromPose(pose: AvatarPose): EyePair {
  if (pose.eyes) {
    return pose.eyes;
  }
  const open = Number.isFinite(pose.eyeScale) ? pose.eyeScale : 1;
  const tilt = (open - 1) * 0.45;
  return {
    left: { openness: open, curvature: 1, lift: 0, tilt, gazeYaw: 0, gazePitch: 0, glow: 1 },
    right: { openness: open, curvature: 1, lift: 0, tilt: -tilt, gazeYaw: 0, gazePitch: 0, glow: 1 },
  };
}

function createEye(
  eyeMaterial: MeshBasicMaterial,
  catchlightMaterial: MeshBasicMaterial,
  geometries: BufferGeometry[],
  facing: 1 | -1,
): Group {
  const eye = new Group();
  const arcSpan = Math.PI * 1.22;
  const arc = new Mesh(
    track(new TorusGeometry(0.15, 0.06, 14, 28, arcSpan), geometries),
    eyeMaterial,
  );
  arc.rotation.z = Math.PI / 2 - arcSpan / 2;
  const catchlight = new Mesh(track(new SphereGeometry(0.026, 12, 10), geometries), catchlightMaterial);
  catchlight.position.set(0.045 * facing, -0.055, 0.05);
  eye.add(arc, catchlight);
  return eye;
}

function createCheek(
  material: MeshBasicMaterial,
  geometries: BufferGeometry[],
  x: number,
): Mesh {
  const cheek = new Mesh(track(new SphereGeometry(0.07, 16, 12), geometries), material);
  cheek.position.set(x, -0.24, 0);
  cheek.scale.set(1.45, 0.72, 0.45);
  return cheek;
}

function createArm(
  material: MeshPhysicalMaterial,
  ringMaterial: MeshBasicMaterial,
  geometries: BufferGeometry[],
  side: 1 | -1,
): Group {
  const arm = new Group();
  arm.position.set(SHOULDER_X * side, SHOULDER_Y, 0.28);
  arm.rotation.x = 0.2;
  arm.rotation.z = 0.42 * side;

  const disc = new Mesh(track(new CylinderGeometry(0.16, 0.16, 0.05, 24), geometries), material);
  disc.rotation.z = Math.PI / 2;
  const ring = new Mesh(track(new TorusGeometry(0.145, 0.014, 8, 24), geometries), ringMaterial);
  ring.rotation.y = Math.PI / 2;
  const cap = new Mesh(track(new CircleGeometry(0.1, 20), geometries), material);
  cap.position.x = 0.03 * side;
  cap.rotation.y = side === 1 ? Math.PI / 2 : -Math.PI / 2;
  arm.add(disc, ring, cap);

  const upper = new Mesh(
    track(new CapsuleGeometry(0.085, Math.max(UPPER_ARM_LENGTH - 0.17, 0.08), 4, 10), geometries),
    material,
  );
  upper.position.y = -UPPER_ARM_LENGTH / 2;
  const elbow = new Group();
  elbow.position.y = -UPPER_ARM_LENGTH;
  elbow.rotation.z = -0.35 * side;
  const forearm = new Mesh(
    track(new CapsuleGeometry(0.072, Math.max(FOREARM_LENGTH - 0.14, 0.08), 4, 10), geometries),
    material,
  );
  forearm.position.y = -FOREARM_LENGTH / 2;
  const hand = new Mesh(track(new SphereGeometry(HAND_RADIUS, 16, 12), geometries), material);
  hand.position.y = -FOREARM_LENGTH;
  elbow.add(forearm, hand);
  arm.add(upper, elbow);
  return arm;
}

function elbowOf(arm: Group): Group {
  const elbow = arm.children.find((child): child is Group => child instanceof Group);
  if (!elbow) {
    throw new Error('desktop-companion: arm is missing an elbow');
  }
  return elbow;
}

function paint(material: MeshBasicMaterial, color: number, glow: number): void {
  material.color.setHex(color);
  material.color.multiplyScalar(glow);
}

function physical(color: number, roughness: number, clearcoat: number, clearcoatRoughness: number): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0.02,
    clearcoat,
    clearcoatRoughness,
  });
}

function flat(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color });
}

function catchlight(): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false });
}

function track<T extends BufferGeometry>(geometry: T, geometries: BufferGeometry[]): T {
  geometries.push(geometry);
  return geometry;
}
