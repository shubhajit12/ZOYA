/**
 * Node.js build-time script to extract compact animation deltas from
 * Breathing_Idle_keyframes.json.
 *
 * Run once:
 *   node extract-idle-data.js
 *
 * Outputs: src/mint/idleMotionData.ts
 * This file is then imported by animationController.ts at runtime.
 *
 * The JSON is NOT loaded at runtime — only this generated file is.
 */
const fs = require('fs');
const path = require('path');

const JSON_PATH = 'A:\\whitehat-jr\\Downloads\\json-for-animation-of-zoya\\Breathing_Idle_keyframes.json';
const OUT_PATH = path.join(__dirname, 'src', 'mint', 'idleMotionData.ts');

const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));

console.log(`Loaded: ${data.name}`);
console.log(`Duration: ${data.duration_seconds}s (${data.duration_ticks} ticks @ ${data.ticks_per_second} FPS)`);
console.log(`Channels: ${data.num_channels}`);

// Mixamo bone name → conceptual body part mapping
const MIXAMO_MAP = {
  'mixamorig:Hips': 'Hips',
  'mixamorig:Spine': 'Spine',
  'mixamorig:Spine1': 'Spine1',
  'mixamorig:Spine2': 'Spine2',
  'mixamorig:Neck': 'Neck',
  'mixamorig:Head': 'Head',
  'mixamorig:LeftShoulder': 'L-Clavicle',
  'mixamorig:LeftArm': 'L-UpperArm',
  'mixamorig:LeftForeArm': 'L-ForeArm',
  'mixamorig:LeftHand': 'L-Hand',
  'mixamorig:LeftHandThumb1': 'L-Thumb1',
  'mixamorig:LeftHandThumb2': 'L-Thumb2',
  'mixamorig:LeftHandThumb3': 'L-Thumb3',
  'mixamorig:LeftHandIndex1': 'L-Index1',
  'mixamorig:LeftHandIndex2': 'L-Index2',
  'mixamorig:LeftHandIndex3': 'L-Index3',
  'mixamorig:LeftHandMiddle1': 'L-Middle1',
  'mixamorig:LeftHandMiddle2': 'L-Middle2',
  'mixamorig:LeftHandMiddle3': 'L-Middle3',
  'mixamorig:LeftHandRing1': 'L-Ring1',
  'mixamorig:LeftHandRing2': 'L-Ring2',
  'mixamorig:LeftHandRing3': 'L-Ring3',
  'mixamorig:LeftHandPinky1': 'L-Pinky1',
  'mixamorig:LeftHandPinky2': 'L-Pinky2',
  'mixamorig:LeftHandPinky3': 'L-Pinky3',
  'mixamorig:RightShoulder': 'R-Clavicle',
  'mixamorig:RightArm': 'R-UpperArm',
  'mixamorig:RightForeArm': 'R-ForeArm',
  'mixamorig:RightHand': 'R-Hand',
  'mixamorig:RightHandThumb1': 'R-Thumb1',
  'mixamorig:RightHandThumb2': 'R-Thumb2',
  'mixamorig:RightHandThumb3': 'R-Thumb3',
  'mixamorig:RightHandIndex1': 'R-Index1',
  'mixamorig:RightHandIndex2': 'R-Index2',
  'mixamorig:RightHandIndex3': 'R-Index3',
  'mixamorig:RightHandMiddle1': 'R-Middle1',
  'mixamorig:RightHandMiddle2': 'R-Middle2',
  'mixamorig:RightHandMiddle3': 'R-Middle3',
  'mixamorig:RightHandRing1': 'R-Ring1',
  'mixamorig:RightHandRing2': 'R-Ring2',
  'mixamorig:RightHandRing3': 'R-Ring3',
  'mixamorig:RightHandPinky1': 'R-Pinky1',
  'mixamorig:RightHandPinky2': 'R-Pinky2',
  'mixamorig:RightHandPinky3': 'R-Pinky3',
  'mixamorig:LeftUpLeg': 'L-UpLeg',
  'mixamorig:LeftLeg': 'L-Leg',
  'mixamorig:LeftFoot': 'L-Foot',
  'mixamorig:LeftToeBase': 'L-Toe',
  'mixamorig:RightUpLeg': 'R-UpLeg',
  'mixamorig:RightLeg': 'R-Leg',
  'mixamorig:RightFoot': 'R-Foot',
  'mixamorig:RightToeBase': 'R-Toe',
};

// Sample every N ticks for compact representation
const SAMPLE_STEP = 3; // Every 3 ticks = every 0.1s ≈ 100 samples over 10s
const totalTicks = Math.round(data.duration_ticks);

// Process each channel
const boneResults = {};

for (const ch of data.channels) {
  const boneName = ch.bone;
  const part = MIXAMO_MAP[boneName];
  if (!part) {
    console.log(`  ⚠️  ${boneName} → no mapping`);
    continue;
  }

  const rotKeys = ch.rotation_keys || [];
  if (rotKeys.length === 0) continue;

  // Find the rest pose (first keyframe)
  const rest = rotKeys[0];

  // Sample delta quaternions at regular intervals
  const samples = [];
  for (let tick = 0; tick <= totalTicks; tick += SAMPLE_STEP) {
    // Find the keyframe at this tick
    let key = rotKeys[0];
    for (let i = 0; i < rotKeys.length - 1; i++) {
      if (rotKeys[i + 1].time > tick) break;
      key = rotKeys[i];
    }

    // Compute delta quaternion: conjugate(rest) * current
    const rw = rest.w, rx = -rest.x, ry = -rest.y, rz = -rest.z;
    const cw = key.w, cx = key.x, cy = key.y, cz = key.z;

    const qw = rw * cw - rx * cx - ry * cy - rz * cz;
    const qx = rw * cx + rx * cw + ry * cz - rz * cy;
    const qy = rw * cy - rx * cz + ry * cw + rz * cx;
    const qz = rw * cz + rx * cy - ry * cx + rz * cw;

    // Compute max deviation from identity
    const dev = Math.sqrt(qx * qx + qy * qy + qz * qz);

    samples.push({
      t: tick,
      qw: Math.round(qw * 10000) / 10000,
      qx: Math.round(qx * 10000) / 10000,
      qy: Math.round(qy * 10000) / 10000,
      qz: Math.round(qz * 10000) / 10000,
      dev: Math.round(dev * 10000) / 10000,
    });
  }

  // Calculate max deviation across all samples
  const maxDev = Math.max(...samples.map(s => s.dev));

  // Check if position varies
  const posKeys = ch.position_keys || [];
  let posVaries = false;
  if (posKeys.length > 1) {
    const p0 = posKeys[0];
    for (let i = 1; i < posKeys.length; i++) {
      if (Math.abs(posKeys[i].x - p0.x) > 0.01 ||
          Math.abs(posKeys[i].y - p0.y) > 0.01 ||
          Math.abs(posKeys[i].z - p0.z) > 0.01) {
        posVaries = true;
        break;
      }
    }
  }

  const hasMotion = maxDev > 0.0001;
  const isSignificant = maxDev > 0.001;

  boneResults[part] = {
    mixamoBone: boneName,
    part,
    samples,
    maxDev,
    hasMotion,
    isSignificant,
    posVaries,
    keyCount: rotKeys.length,
  };

  const marker = isSignificant ? '✅' : hasMotion ? '〰️' : '⬛';
  const posInfo = posVaries ? ' + POS' : '';
  console.log(`  ${marker} ${part} (${boneName}): maxDev=${maxDev.toFixed(4)} (${(maxDev * 180 / Math.PI).toFixed(2)}°) keys=${rotKeys.length}${posInfo}`);
}

// Categorize
const significant = Object.values(boneResults).filter(b => b.isSignificant);
const subtle = Object.values(boneResults).filter(b => b.hasMotion && !b.isSignificant);
const static_ = Object.values(boneResults).filter(b => !b.hasMotion);

console.log(`\n═══ SUMMARY ═══`);
console.log(`Significant motion: ${significant.length} bones`);
console.log(`Subtle motion: ${subtle.length} bones`);
console.log(`Static: ${static_.length} bones`);

// Generate TypeScript output
let ts = `/**
 * Pre-computed breathing idle motion data.
 *
 * GENERATED by extract-idle-data.js — DO NOT EDIT BY HAND.
 * Source: Breathing_Idle_keyframes.json
 * Duration: ${data.duration_seconds}s @ ${data.ticks_per_second} FPS
 * Sampled every ${SAMPLE_STEP} ticks (${(SAMPLE_STEP / data.ticks_per_second).toFixed(2)}s)
 *
 * Each bone stores delta quaternions (relative to Mixamo rest pose).
 * At runtime, the animation controller applies these as additive
 * deltas on top of Mint's relaxed base pose.
 */

export const IDLE_DURATION = ${data.duration_seconds};
export const IDLE_FPS = ${data.ticks_per_second};
export const IDLE_TOTAL_TICKS = ${totalTicks};
export const SAMPLE_STEP = ${SAMPLE_STEP};

export interface BoneSample {
  t: number;
  qw: number;
  qx: number;
  qy: number;
  qz: number;
}

export interface BoneMotionData {
  mixamoBone: string;
  mintKey: string;
  samples: BoneSample[];
  maxDev: number;
}

export const IDLE_BONES: BoneMotionData[] = [
`;

const mintKeyMap = {
  'Hips': 'hips',
  'Spine': 'spine',
  'Spine1': 'spine1',
  'Spine2': 'chest',
  'Neck': 'neck',
  'Head': 'head',
  'L-Clavicle': 'leftClavicle',
  'L-UpperArm': 'leftUpperArm',
  'L-ForeArm': 'leftForearm',
  'L-Hand': 'leftHand',
  'R-Clavicle': 'rightClavicle',
  'R-UpperArm': 'rightUpperArm',
  'R-ForeArm': 'rightForearm',
  'R-Hand': 'rightHand',
  'L-UpLeg': 'leftUpLeg',
  'L-Leg': 'leftLeg',
  'L-Foot': 'leftFoot',
  'L-Toe': 'leftToe',
  'R-UpLeg': 'rightUpLeg',
  'R-Leg': 'rightLeg',
  'R-Foot': 'rightFoot',
  'R-Toe': 'rightToe',
  'L-Thumb1': 'leftThumb1',
  'L-Thumb2': 'leftThumb2',
  'L-Thumb3': 'leftThumb3',
  'L-Index1': 'leftIndex1',
  'L-Index2': 'leftIndex2',
  'L-Index3': 'leftIndex3',
  'L-Middle1': 'leftMiddle1',
  'L-Middle2': 'leftMiddle2',
  'L-Middle3': 'leftMiddle3',
  'L-Ring1': 'leftRing1',
  'L-Ring2': 'leftRing2',
  'L-Ring3': 'leftRing3',
  'L-Pinky1': 'leftPinky1',
  'L-Pinky2': 'leftPinky2',
  'L-Pinky3': 'leftPinky3',
  'R-Thumb1': 'rightThumb1',
  'R-Thumb2': 'rightThumb2',
  'R-Thumb3': 'rightThumb3',
  'R-Index1': 'rightIndex1',
  'R-Index2': 'rightIndex2',
  'R-Index3': 'rightIndex3',
  'R-Middle1': 'rightMiddle1',
  'R-Middle2': 'rightMiddle2',
  'R-Middle3': 'rightMiddle3',
  'R-Ring1': 'rightRing1',
  'R-Ring2': 'rightRing2',
  'R-Ring3': 'rightRing3',
  'R-Pinky1': 'rightPinky1',
  'R-Pinky2': 'rightPinky2',
  'R-Pinky3': 'rightPinky3',
};

for (const part of Object.keys(boneResults).sort()) {
  const b = boneResults[part];
  if (!b.hasMotion) continue;

  const mintKey = mintKeyMap[part] || part;

  const sampleData = b.samples.map(s =>
    `    {t:${s.t},qw:${s.qw},qx:${s.qx},qy:${s.qy},qz:${s.qz}}`
  ).join(',\n');

  ts += `  {\n`;
  ts += `    mixamoBone: '${b.mixamoBone}',\n`;
  ts += `    mintKey: '${mintKey}',\n`;
  ts += `    maxDev: ${b.maxDev.toFixed(6)},\n`;
  ts += `    samples: [\n${sampleData},\n    ],\n`;
  ts += `  },\n`;
}

ts += `];\n`;

fs.writeFileSync(OUT_PATH, ts);
console.log(`\n✅ Wrote ${OUT_PATH}`);
console.log(`   Total bones in output: ${Object.values(boneResults).filter(b => b.hasMotion).length}`);
