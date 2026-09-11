import * as THREE from 'three';
import { MintBoneMap } from './skeletonMap';

/**
 * MintBindPose
 *
 * Captures Mint's original local transforms ONCE at initialization.
 * Every animation frame must start from this known reference.
 *
 * CRITICAL: This is never overwritten. It is the immutable reference.
 */

export interface BoneBindData {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

export interface MintBindPose {
  /** Map from bone Object3D to its captured bind data */
  bones: Map<THREE.Object3D, BoneBindData>;
  /** Reference to the bone map used during capture */
  boneMap: MintBoneMap;
}

/**
 * Capture Mint's current local transforms as the immutable bind pose.
 * Must be called after the FBX is loaded and skeleton is discovered,
 * but BEFORE any animation is applied.
 *
 * @param boneMap - The discovered skeleton bone map
 * @param root - The FBX model root (for world matrix update)
 * @returns An immutable MintBindPose object
 */
export function captureBindPose(boneMap: MintBoneMap, root: THREE.Object3D): MintBindPose {
  // Force world matrix computation so local transforms are accurate
  root.updateWorldMatrix(true, true);

  const bones = new Map<THREE.Object3D, BoneBindData>();

  console.log('%c[MintBindPose] ═══ CAPTURING IMMUTABLE BIND POSE ═══', 'color: #00ff88; font-weight: bold');

  // Capture all bones from the bone map
  const slots = [
    'root', 'bip001', 'pelvis', 'spine', 'spine1', 'spine2',
    'neck', 'head',
    'leftClavicle', 'leftUpperArm', 'leftForearm', 'leftHand',
    'rightClavicle', 'rightUpperArm', 'rightForearm', 'rightHand',
    'leftThigh', 'leftCalf', 'leftFoot', 'leftToe',
    'rightThigh', 'rightCalf', 'rightFoot', 'rightToe',
  ] as const;

  for (const slot of slots) {
    const bone = boneMap[slot];
    if (!bone) continue;

    // CRITICAL: Do NOT use .toArray() here — toArray writes to array indices [0],[1],[2]
    // which does NOT update the .x/.y/.z/.w properties on THREE.Vector3/Quaternion.
    // .clone() reads .x/.y/.z/.w, so toArray + clone = garbage data.
    bones.set(bone, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone(),
    });

    console.log(`  📌 ${slot} "${bone.name}" q=(${bone.quaternion.x.toFixed(4)}, ${bone.quaternion.y.toFixed(4)}, ${bone.quaternion.z.toFixed(4)}, ${bone.quaternion.w.toFixed(4)})`);
  }

  // Capture finger bones too (for safety — we want to be able to restore them)
  const captureFingerMap = (fingerMap: Map<string, THREE.Object3D[]>, prefix: string) => {
    for (const [label, chain] of fingerMap) {
      for (const bone of chain) {
        if (!bones.has(bone)) {
          bones.set(bone, {
            position: bone.position.clone(),
            quaternion: bone.quaternion.clone(),
            scale: bone.scale.clone(),
          });
          console.log(`  📌 ${prefix}${label} "${bone.name}"`);
        }
      }
    }
  };

  captureFingerMap(boneMap.leftFingers, 'L');
  captureFingerMap(boneMap.rightFingers, 'R');

  console.log(`%c[MintBindPose] ✅ Captured ${bones.size} bone bind poses`, 'color: #00ff88; font-weight: bold');

  return { bones, boneMap };
}

/**
 * Get the bind pose quaternion for a specific bone.
 * Returns identity quaternion if bone not found (never null/undefined in hot path).
 */
export function getBindQuat(bindPose: MintBindPose, bone: THREE.Object3D): THREE.Quaternion {
  return bindPose.bones.get(bone)?.quaternion ?? new THREE.Quaternion();
}

/**
 * Get the bind pose position for a specific bone.
 */
export function getBindPosition(bindPose: MintBindPose, bone: THREE.Object3D): THREE.Vector3 {
  return bindPose.bones.get(bone)?.position ?? new THREE.Vector3();
}
