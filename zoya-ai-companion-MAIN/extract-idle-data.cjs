/**
 * Build-time script to extract ABSOLUTE animated quaternions from
 * Breathing_Idle_keyframes.json, including rest pose for each bone.
 *
 * Run once:  node extract-idle-data.cjs
 * Outputs:   src/mint/idleMotionData.ts
 */
const fs = require('fs');
const path = require('path');

const JSON_PATH = 'A:\\whitehat-jr\\Downloads\\json-for-animation-of-zoya\\Breathing_Idle_keyframes.json';
const OUT_PATH = path.join(__dirname, 'src', 'mint', 'idleMotionData.ts');

console.log('Reading JSON from:', JSON_PATH);
const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
console.log(`Loaded: ${data.name} | ${data.duration_seconds}s @ ${data.ticks_per_second} FPS | ${data.num_channels} channels`);

const MIXAMO_MAP = {
  'mixamorig:Hips': 'Hips', 'mixamorig:Spine': 'Spine', 'mixamorig:Spine1': 'Spine1',
  'mixamorig:Spine2': 'Spine2', 'mixamorig:Neck': 'Neck', 'mixamorig:Head': 'Head',
  'mixamorig:LeftShoulder': 'L-Clavicle', 'mixamorig:LeftArm': 'L-UpperArm',
  'mixamorig:LeftForeArm': 'L-ForeArm', 'mixamorig:LeftHand': 'L-Hand',
  'mixamorig:LeftHandThumb1': 'L-Thumb1', 'mixamorig:LeftHandThumb2': 'L-Thumb2',
  'mixamorig:LeftHandThumb3': 'L-Thumb3', 'mixamorig:LeftHandIndex1': 'L-Index1',
  'mixamorig:LeftHandIndex2': 'L-Index2', 'mixamorig:LeftHandIndex3': 'L-Index3',
  'mixamorig:LeftHandMiddle1': 'L-Middle1', 'mixamorig:LeftHandMiddle2': 'L-Middle2',
  'mixamorig:LeftHandMiddle3': 'L-Middle3', 'mixamorig:LeftHandRing1': 'L-Ring1',
  'mixamorig:LeftHandRing2': 'L-Ring2', 'mixamorig:LeftHandRing3': 'L-Ring3',
  'mixamorig:LeftHandPinky1': 'L-Pinky1', 'mixamorig:LeftHandPinky2': 'L-Pinky2',
  'mixamorig:LeftHandPinky3': 'L-Pinky3',
  'mixamorig:RightShoulder': 'R-Clavicle', 'mixamorig:RightArm': 'R-UpperArm',
  'mixamorig:RightForeArm': 'R-ForeArm', 'mixamorig:RightHand': 'R-Hand',
  'mixamorig:RightHandThumb1': 'R-Thumb1', 'mixamorig:RightHandThumb2': 'R-Thumb2',
  'mixamorig:RightHandThumb3': 'R-Thumb3', 'mixamorig:RightHandIndex1': 'R-Index1',
  'mixamorig:RightHandIndex2': 'R-Index2', 'mixamorig:RightHandIndex3': 'R-Index3',
  'mixamorig:RightHandMiddle1': 'R-Middle1', 'mixamorig:RightHandMiddle2': 'R-Middle2',
  'mixamorig:RightHandMiddle3': 'R-Middle3', 'mixamorig:RightHandRing1': 'R-Ring1',
  'mixamorig:RightHandRing2': 'R-Ring2', 'mixamorig:RightHandRing3': 'R-Ring3',
  'mixamorig:RightHandPinky1': 'R-Pinky1', 'mixamorig:RightHandPinky2': 'R-Pinky2',
  'mixamorig:RightHandPinky3': 'R-Pinky3',
  'mixamorig:LeftUpLeg': 'L-UpLeg', 'mixamorig:LeftLeg': 'L-Leg',
  'mixamorig:LeftFoot': 'L-Foot', 'mixamorig:LeftToeBase': 'L-Toe',
  'mixamorig:RightUpLeg': 'R-UpLeg', 'mixamorig:RightLeg': 'R-Leg',
  'mixamorig:RightFoot': 'R-Foot', 'mixamorig:RightToeBase': 'R-Toe',
};

const SAMPLE_STEP = 3;
const totalTicks = Math.round(data.duration_ticks);
const boneResults = {};

for (const ch of data.channels) {
  const part = MIXAMO_MAP[ch.bone];
  if (!part) { console.log(`  skip: ${ch.bone}`); continue; }

  const rotKeys = ch.rotation_keys || [];
  if (rotKeys.length === 0) continue;

  // Rest pose = first keyframe
  const rest = rotKeys[0];

  // Sample ABSOLUTE animated quaternions (not deltas)
  const samples = [];
  for (let tick = 0; tick <= totalTicks; tick += SAMPLE_STEP) {
    let key = rotKeys[0];
    for (let i = 0; i < rotKeys.length - 1; i++) {
      if (rotKeys[i + 1].time > tick) break;
      key = rotKeys[i];
    }
    samples.push({
      t: tick,
      qw: Math.round(key.w * 10000) / 10000,
      qx: Math.round(key.x * 10000) / 10000,
      qy: Math.round(key.y * 10000) / 10000,
      qz: Math.round(key.z * 10000) / 10000,
    });
  }

  // Compute max deviation from rest (delta = inv(rest)*animated)
  let maxDev = 0;
  const rw = rest.w, rx = -rest.x, ry = -rest.y, rz = -rest.z;
  for (const s of samples) {
    const qw = rw * s.qw - rx * s.qx - ry * s.qy - rz * s.qz;
    const qx = rw * s.qx + rx * s.qw + ry * s.qz - rz * s.qy;
    const qy = rw * s.qy - rx * s.qz + ry * s.qw + rz * s.qx;
    const qz = rw * s.qz + rx * s.qy - ry * s.qx + rz * s.qw;
    const dev = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (dev > maxDev) maxDev = dev;
  }

  const hasMotion = maxDev > 0.0001;
  const isSignificant = maxDev > 0.001;

  boneResults[part] = {
    mixamoBone: ch.bone, part, samples, maxDev, hasMotion, isSignificant,
    rest: { qw: rest.w, qx: rest.x, qy: rest.y, qz: rest.z },
  };

  const marker = isSignificant ? 'SIG' : hasMotion ? 'sub' : '---';
  console.log(`  [${marker}] ${part} (${ch.bone}): maxDev=${(maxDev * 180 / Math.PI).toFixed(2)}°`);
}

const sig = Object.values(boneResults).filter(b => b.isSignificant).length;
const sub = Object.values(boneResults).filter(b => b.hasMotion && !b.isSignificant).length;
console.log(`\nSignificant: ${sig} | Subtle: ${sub} | Total with motion: ${sig + sub}`);

const mintKeyMap = {
  'Hips': 'hips', 'Spine': 'spine', 'Spine1': 'spine1', 'Spine2': 'chest',
  'Neck': 'neck', 'Head': 'head',
  'L-Clavicle': 'leftClavicle', 'L-UpperArm': 'leftUpperArm',
  'L-ForeArm': 'leftForearm', 'L-Hand': 'leftHand',
  'R-Clavicle': 'rightClavicle', 'R-UpperArm': 'rightUpperArm',
  'R-ForeArm': 'rightForearm', 'R-Hand': 'rightHand',
  'L-UpLeg': 'leftUpLeg', 'L-Leg': 'leftLeg', 'L-Foot': 'leftFoot', 'L-Toe': 'leftToe',
  'R-UpLeg': 'rightUpLeg', 'R-Leg': 'rightLeg', 'R-Foot': 'rightFoot', 'R-Toe': 'rightToe',
  'L-Thumb1': 'leftThumb1', 'L-Thumb2': 'leftThumb2', 'L-Thumb3': 'leftThumb3',
  'L-Index1': 'leftIndex1', 'L-Index2': 'leftIndex2', 'L-Index3': 'leftIndex3',
  'L-Middle1': 'leftMiddle1', 'L-Middle2': 'leftMiddle2', 'L-Middle3': 'leftMiddle3',
  'L-Ring1': 'leftRing1', 'L-Ring2': 'leftRing2', 'L-Ring3': 'leftRing3',
  'L-Pinky1': 'leftPinky1', 'L-Pinky2': 'leftPinky2', 'L-Pinky3': 'leftPinky3',
  'R-Thumb1': 'rightThumb1', 'R-Thumb2': 'rightThumb2', 'R-Thumb3': 'rightThumb3',
  'R-Index1': 'rightIndex1', 'R-Index2': 'rightIndex2', 'R-Index3': 'rightIndex3',
  'R-Middle1': 'rightMiddle1', 'R-Middle2': 'rightMiddle2', 'R-Middle3': 'rightMiddle3',
  'R-Ring1': 'rightRing1', 'R-Ring2': 'rightRing2', 'R-Ring3': 'rightRing3',
  'R-Pinky1': 'rightPinky1', 'R-Pinky2': 'rightPinky2', 'R-Pinky3': 'rightPinky3',
};

let ts = `/**\n * Pre-computed breathing idle motion data.\n * GENERATED by extract-idle-data.cjs — DO NOT EDIT BY HAND.\n * Source: Breathing_Idle_keyframes.json\n * Duration: ${data.duration_seconds}s @ ${data.ticks_per_second} FPS\n * Each bone stores ABSOLUTE animated quaternions + rest pose.\n */\n\nexport const IDLE_DURATION = ${data.duration_seconds};\nexport const IDLE_FPS = ${data.ticks_per_second};\nexport const IDLE_TOTAL_TICKS = ${totalTicks};\nexport const SAMPLE_STEP = ${SAMPLE_STEP};\n\nexport interface BoneSample {\n  t: number;\n  qw: number;\n  qx: number;\n  qy: number;\n  qz: number;\n}\n\nexport interface BoneMotionData {\n  mixamoBone: string;\n  mintKey: string;\n  rest: { qw: number; qx: number; qy: number; qz: number };\n  samples: BoneSample[];\n  maxDev: number;\n}\n\nexport const IDLE_BONES: BoneMotionData[] = [\n`;

let outputCount = 0;
for (const part of Object.keys(boneResults).sort()) {
  const b = boneResults[part];
  if (!b.hasMotion) continue;
  const mintKey = mintKeyMap[part] || part;
  const r = b.rest;

  const sampleLines = b.samples.map(s =>
    `    {t:${s.t},qw:${s.qw},qx:${s.qx},qy:${s.qy},qz:${s.qz}}`
  ).join(',\n');

  ts += `  {\n    mixamoBone: '${b.mixamoBone}',\n    mintKey: '${mintKey}',\n    rest: {qw:${r.qw},qx:${r.qx},qy:${r.qy},qz:${r.qz}},\n    maxDev: ${b.maxDev.toFixed(6)},\n    samples: [\n${sampleLines},\n    ],\n  },\n`;
  outputCount++;
}

ts += `];\n`;

fs.writeFileSync(OUT_PATH, ts, 'utf8');
console.log(`\nWrote ${OUT_PATH} (${outputCount} bones)`);
