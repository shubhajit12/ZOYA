import * as THREE from 'three';

/**
 * MintSkeletonMap
 *
 * Clean anatomical bone map containing only the bones required
 * for procedural animation. Derived from actual Mint.fbx hierarchy
 * (488 bones total; only ~30 anatomical bones mapped here).
 *
 * Finger bones are discovered at runtime from the actual hand children.
 */

export interface MintBoneMap {
  root: THREE.Object3D | null;
  bip001: THREE.Object3D | null;
  pelvis: THREE.Object3D | null;
  spine: THREE.Object3D | null;
  spine1: THREE.Object3D | null;
  spine2: THREE.Object3D | null;
  neck: THREE.Object3D | null;
  head: THREE.Object3D | null;

  // Left arm
  leftClavicle: THREE.Object3D | null;
  leftUpperArm: THREE.Object3D | null;
  leftForearm: THREE.Object3D | null;
  leftHand: THREE.Object3D | null;

  // Right arm
  rightClavicle: THREE.Object3D | null;
  rightUpperArm: THREE.Object3D | null;
  rightForearm: THREE.Object3D | null;
  rightHand: THREE.Object3D | null;

  // Left leg
  leftThigh: THREE.Object3D | null;
  leftCalf: THREE.Object3D | null;
  leftFoot: THREE.Object3D | null;
  leftToe: THREE.Object3D | null;

  // Right leg
  rightThigh: THREE.Object3D | null;
  rightCalf: THREE.Object3D | null;
  rightFoot: THREE.Object3D | null;
  rightToe: THREE.Object3D | null;

  // Eyes
  leftEye: THREE.Object3D | null;
  rightEye: THREE.Object3D | null;

  // Facial / Lip-sync bones
  mouth: THREE.Object3D | null;
  jawLower: THREE.Object3D | null;     // Bon_yachi_lo (lower teeth/jaw)
  jawUpper: THREE.Object3D | null;     // Bon_yachi_up (upper teeth/jaw)
  lipUpperM: THREE.Object3D | null;    // Bon_uplip_M (center upper lip)
  lipLowerM: THREE.Object3D | null;    // Bon_Lolip_M (center lower lip)
  mouthCornerL: THREE.Object3D | null; // Bon_zuiba_L (left mouth corner)
  mouthCornerR: THREE.Object3D | null; // Bon_zuiba_R (right mouth corner)
  lipUpperL: THREE.Object3D | null;    // Bon_uplip01_L (left upper lip inner)
  lipUpperR: THREE.Object3D | null;    // Bon_uplip01_R (right upper lip inner)
  lipLowerL: THREE.Object3D | null;    // Bon_Lolip01_L (left lower lip inner)
  lipLowerR: THREE.Object3D | null;    // Bon_Lolip01_R (right lower lip inner)
  colipL: THREE.Object3D | null;       // Bon_colip_L (left corner lip)
  colipR: THREE.Object3D | null;       // Bon_colip_R (right corner lip)
  cheekL: THREE.Object3D | null;       // Bon_lianjia_L
  cheekR: THREE.Object3D | null;       // Bon_lianjia_R

  // Discovered finger chains (populated at runtime)
  leftFingers: Map<string, THREE.Object3D[]>;
  rightFingers: Map<string, THREE.Object3D[]>;
}

/** Actual Mint bone names for each anatomical slot */
const BONE_NAME_MAP: Record<string, string[]> = {
  root:        ['root'],
  bip001:      ['Bip001'],
  pelvis:      ['Bip001-Pelvis'],
  spine:       ['Bip001-Spine'],
  spine1:      ['Bip001-Spine1'],
  spine2:      ['Bip001-Spine2'],
  neck:        ['Bip001-Neck'],
  head:        ['Bip001-Head'],
  leftClavicle:  ['Bip001-L-Clavicle'],
  leftUpperArm:  ['Bip001-L-UpperArm'],
  leftForearm:   ['Bip001-L-Forearm'],
  leftHand:      ['Bip001-L-Hand'],
  rightClavicle: ['Bip001-R-Clavicle'],
  rightUpperArm: ['Bip001-R-UpperArm'],
  rightForearm:  ['Bip001-R-Forearm'],
  rightHand:     ['Bip001-R-Hand'],
  leftThigh:   ['Bip001-L-Thigh'],
  leftCalf:    ['Bip001-L-Calf'],
  leftFoot:    ['Bip001-L-Foot'],
  leftToe:     ['Bip001-L-Toe0'],
  rightThigh:  ['Bip001-R-Thigh'],
  rightCalf:   ['Bip001-R-Calf'],
  rightFoot:   ['Bip001-R-Foot'],
  rightToe:    ['Bip001-R-Toe0'],
  leftEye:     ['Bon_eyeball_L'],
  rightEye:    ['Bon_eyeball_R'],
  mouth:       ['mouth'],
  jawLower:    ['Bon_yachi_lo'],
  jawUpper:    ['Bon_yachi_up'],
  lipUpperM:   ['Bon_uplip_M'],
  lipLowerM:   ['Bon_Lolip_M'],
  mouthCornerL: ['Bon_zuiba_L'],
  mouthCornerR: ['Bon_zuiba_R'],
  lipUpperL:   ['Bon_uplip01_L'],
  lipUpperR:   ['Bon_uplip01_R'],
  lipLowerL:   ['Bon_Lolip01_L'],
  lipLowerR:   ['Bon_Lolip01_R'],
  colipL:      ['Bon_colip_L'],
  colipR:      ['Bon_colip_R'],
  cheekL:      ['Bon_lianjia_L'],
  cheekR:      ['Bon_lianjia_R'],
};

/** Finger chain naming: base → mid → tip */
const FINGER_CHAIN_NAMES = ['Finger0', 'Finger1', 'Finger2', 'Finger3', 'Finger4'];
const FINGER_LABELS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

/**
 * Discover all anatomical bones from a loaded Mint FBX model.
 * Returns a MintBoneMap with only the bones that were actually found.
 */
export function discoverMintBones(root: THREE.Object3D): MintBoneMap {
  const map: MintBoneMap = {
    root: null, bip001: null, pelvis: null,
    spine: null, spine1: null, spine2: null,
    neck: null, head: null,
    leftClavicle: null, leftUpperArm: null, leftForearm: null, leftHand: null,
    rightClavicle: null, rightUpperArm: null, rightForearm: null, rightHand: null,
    leftThigh: null, leftCalf: null, leftFoot: null, leftToe: null,
    rightThigh: null, rightCalf: null, rightFoot: null, rightToe: null,
    leftEye: null, rightEye: null,
    mouth: null, jawLower: null, jawUpper: null,
    lipUpperM: null, lipLowerM: null,
    mouthCornerL: null, mouthCornerR: null,
    lipUpperL: null, lipUpperR: null,
    lipLowerL: null, lipLowerR: null,
    colipL: null, colipR: null,
    cheekL: null, cheekR: null,
    leftFingers: new Map(),
    rightFingers: new Map(),
  };

  // Collect all bones from the skeleton
  const allBones: THREE.Bone[] = [];
  root.traverse((child) => {
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
      const sk = (child as THREE.SkinnedMesh).skeleton;
      if (sk?.bones) {
        for (const b of sk.bones) {
          if (!allBones.includes(b)) allBones.push(b);
        }
      }
    }
  });
  // Fallback: if no skinned mesh found, traverse for bones directly
  if (allBones.length === 0) {
    root.traverse((child) => {
      if ((child as THREE.Bone).isBone) allBones.push(child as THREE.Bone);
    });
  }

  console.log(`[MintSkeleton] Total skeleton bones discovered: ${allBones.length}`);

  // Map known bone names to slots
  const findByName = (names: string[]): THREE.Object3D | null => {
    for (const target of names) {
      for (const bone of allBones) {
        if (bone.name === target) return bone;
      }
    }
    return null;
  };

  const slotKeys = Object.keys(BONE_NAME_MAP) as Array<keyof typeof BONE_NAME_MAP>;
  for (const key of slotKeys) {
    (map as any)[key] = findByName(BONE_NAME_MAP[key]);
  }

  // Discover finger chains from actual hand bone children
  discoverFingerChain(map, allBones, 'L', 'leftFingers');
  discoverFingerChain(map, allBones, 'R', 'rightFingers');

  // Log results
  console.log('[MintSkeleton] ─── Body bones ───');
  for (const key of slotKeys) {
    const bone = (map as any)[key] as THREE.Object3D | null;
    if (bone && key !== 'leftFingers' && key !== 'rightFingers') {
      console.log(`  ✅ ${key} → "${bone.name}"`);
    } else if (key !== 'leftFingers' && key !== 'rightFingers') {
      console.log(`  ❌ ${key} → NOT FOUND`);
    }
  }

  console.log('[MintSkeleton] ─── Finger chains ───');
  for (const [label, chain] of map.leftFingers) {
    console.log(`  ✅ L${label} → ${chain.map(b => `"${b.name}"`).join(' → ')}`);
  }
  for (const [label, chain] of map.rightFingers) {
    console.log(`  ✅ R${label} → ${chain.map(b => `"${b.name}"`).join(' → ')}`);
  }

  return map;
}

/**
 * Discover finger chains from a hand bone's children.
 * Maps the first 5 bone children of each hand to finger chains
 * following Mint's naming convention: Finger0=Thumb, Finger1=Index, etc.
 */
function discoverFingerChain(
  map: MintBoneMap,
  allBones: THREE.Bone[],
  side: 'L' | 'R',
  fingerMapKey: 'leftFingers' | 'rightFingers',
) {
  const handBone = side === 'L' ? map.leftHand : map.rightHand;
  if (!handBone) return;

  const fingerMap = side === 'L' ? map.leftFingers : map.rightFingers;

  // Find all finger base bones under this hand
  for (let fi = 0; fi < FINGER_CHAIN_NAMES.length; fi++) {
    const baseName = `Bip001-${side}-${FINGER_CHAIN_NAMES[fi]}`;
    const baseBone = allBones.find(b => b.name === baseName);
    if (!baseBone) continue;

    // Walk up to 3 levels deep (base → mid → tip)
    const chain: THREE.Object3D[] = [baseBone];
    let walker: THREE.Object3D = baseBone;
    for (let depth = 1; depth <= 2; depth++) {
      const nextName = baseName + depth; // e.g. Bip001-L-Finger01
      const next = allBones.find(b => b.name === nextName);
      if (next) {
        chain.push(next);
        walker = next;
      } else {
        // Try walking children
        const childBone = walker.children.find(c => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
        if (childBone) {
          chain.push(childBone);
          walker = childBone;
        } else {
          break;
        }
      }
    }

    fingerMap.set(FINGER_LABELS[fi], chain);
  }
}

/** Check that all critical bones are present */
export function validateSkeleton(map: MintBoneMap): boolean {
  const criticalBones = [
    'pelvis', 'spine', 'spine2', 'neck', 'head',
    'leftUpperArm', 'leftForearm',
    'rightUpperArm', 'rightForearm',
  ] as const;

  let allPresent = true;
  for (const bone of criticalBones) {
    if (!map[bone]) {
      console.warn(`[MintSkeleton] ⚠️  Critical bone missing: ${bone}`);
      allPresent = false;
    }
  }
  return allPresent;
}
