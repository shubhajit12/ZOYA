import * as THREE from 'three';
import { MintBoneMap } from './skeletonMap';
import { MintBindPose } from './bindPose';

/**
 * MintBasePose — Geometric Arm Solver (CORRECTED)
 *
 * Convention (Three.js):
 *   A.multiply(B) = A ∘ B  (B applied first, then A)
 *   bone.worldQ = parentWorldQ × localQ
 *
 * CORRECTIONS from previous version:
 * 1. Uses updateMatrixWorld(true) for accurate world positions (handles scale, hierarchy)
 * 2. Hand delta computed independently (not copied from forearm)
 * 3. Clavicle direction uses actual world positions (not raw local subtraction)
 * 4. Original quaternions captured and restored after solve
 */

export interface BoneBaseDelta { quaternion: THREE.Quaternion }
export interface MintBasePoseData { deltas: Map<THREE.Object3D, BoneBaseDelta> }

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Build a full 3D orientation quaternion where the local +X (forward) axis
 * points in `forwardDir` world space, and the local +Y (up) axis stays as
 * close to `worldUp` as possible.
 *
 * Mint bones have their local X-axis pointing along the bone toward their child.
 */
function buildOrientationFromForward(forwardDir: THREE.Vector3, worldUp: THREE.Vector3): THREE.Quaternion {
  const fx = forwardDir.clone().normalize();
  let fy = worldUp.clone().normalize();

  // Gram-Schmidt: make fy perpendicular to fx
  fy.sub(fx.clone().multiplyScalar(fy.dot(fx))).normalize();
  if (fy.lengthSq() < 0.001) {
    // fx is nearly parallel to worldUp — pick alternative
    fy.set(0, 0, 1).sub(fx.clone().multiplyScalar(fx.z)).normalize();
  }

  const fz = new THREE.Vector3().crossVectors(fx, fy).normalize();
  fy = new THREE.Vector3().crossVectors(fz, fx).normalize();

  // Build rotation matrix: columns are where local axes map in world space
  const m = new THREE.Matrix4().makeBasis(fx, fy, fz);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

// ─── Single Bone Test ───────────────────────────────────────────

/**
 * Test rotation of a SINGLE bone (L-UpperArm only).
 * All other bones stay at bind pose.
 * Prints full verification including post-application world direction.
 */
export function runSingleBoneTest(boneMap: MintBoneMap, root: THREE.Object3D): void {
  console.log('%c[SingleBoneTest] ═══ SINGLE BONE VERIFICATION ═══', 'color: #ff0000; font-weight: bold');

  root.updateWorldMatrix(true, true);

  const upperArm = boneMap.leftUpperArm;
  const forearm = boneMap.leftForearm;
  if (!upperArm || !forearm) {
    console.error('[SingleBoneTest] Bones not found');
    return;
  }

  // 1. Capture bind pose
  const bindLocalQ = upperArm.quaternion.clone();

  // Compute parent world Q by traversing from root down to upperArm.parent
  const parentWorldQ = new THREE.Quaternion();
  const chain: THREE.Object3D[] = [];
  let current: THREE.Object3D | null = upperArm.parent;
  while (current) {
    chain.unshift(current);
    current = current.parent;
  }
  for (const bone of chain) {
    parentWorldQ.multiply(bone.quaternion);
  }

  // 2. Compute current world direction: upperArm → forearm
  const startPos = new THREE.Vector3();
  const endPos = new THREE.Vector3();
  upperArm.getWorldPosition(startPos);
  forearm.getWorldPosition(endPos);
  const originalDir = endPos.clone().sub(startPos).normalize();

  // 3. Target direction
  const targetDir = new THREE.Vector3(0, -1, 0).normalize();

  // 4. Build desired world orientation
  const desiredWorldQ = buildOrientationFromForward(targetDir, new THREE.Vector3(0, 0, -1));

  // 5. Verify: desiredWorldQ × (1,0,0) should ≈ targetDir
  const verifyDir = new THREE.Vector3(1, 0, 0).applyQuaternion(desiredWorldQ);
  const verifyDot = verifyDir.dot(targetDir);
  console.log(`[SingleBoneTest] Orientation verify: dot=${verifyDot.toFixed(6)} (should be ~1.0)`);

  // 6. Compute local delta
  // Relationship: desiredWorldQ = worldDelta × bindWorldQ
  // Therefore:    worldDelta = desiredWorldQ × bindWorldQ⁻¹
  //               localDelta = desiredLocalQ × bindLocalQ⁻¹
  const bindWorldQ = parentWorldQ.clone().multiply(bindLocalQ);
  const desiredLocalQ = parentWorldQ.clone().invert().multiply(desiredWorldQ);
  const localDelta = desiredLocalQ.clone().multiply(bindLocalQ.clone().invert());

  // 7. Verify mathematically
  const worldDelta = desiredWorldQ.clone().multiply(bindWorldQ.clone().invert());
  const rotatedDir = originalDir.clone().applyQuaternion(worldDelta);
  const angleError = Math.acos(Math.max(-1, Math.min(1, rotatedDir.dot(targetDir)))) * 180 / Math.PI;

  console.log(`[SingleBoneTest]`);
  console.log(`  Bone: ${upperArm.name}`);
  console.log(`  Original world dir: (${originalDir.x.toFixed(4)}, ${originalDir.y.toFixed(4)}, ${originalDir.z.toFixed(4)})`);
  console.log(`  Target world dir:   (${targetDir.x.toFixed(4)}, ${targetDir.y.toFixed(4)}, ${targetDir.z.toFixed(4)})`);
  console.log(`  World delta rotated: (${rotatedDir.x.toFixed(4)}, ${rotatedDir.y.toFixed(4)}, ${rotatedDir.z.toFixed(4)})`);
  console.log(`  Angle error: ${angleError.toFixed(4)}°`);
  console.log(`  bindLocalQ:  (${bindLocalQ.x.toFixed(4)}, ${bindLocalQ.y.toFixed(4)}, ${bindLocalQ.z.toFixed(4)}, ${bindLocalQ.w.toFixed(4)})`);
  console.log(`  localDelta:  (${localDelta.x.toFixed(4)}, ${localDelta.y.toFixed(4)}, ${localDelta.z.toFixed(4)}, ${localDelta.w.toFixed(4)})`);

  if (angleError > 1.0) {
    console.error(`[SingleBoneTest] ❌ ANGLE ERROR TOO LARGE: ${angleError.toFixed(2)}° — FIX MATH BEFORE PROCEEDING`);
    return;
  }

  // 8. Apply ONLY L-UpperArm
  // finalLocalQ = localDelta × bindLocalQ = (desiredLocalQ × bindLocalQ⁻¹) × bindLocalQ = desiredLocalQ
  const finalLocalQ = localDelta.clone().multiply(bindLocalQ);
  upperArm.quaternion.copy(finalLocalQ);

  // 9. Force world matrix update
  root.updateMatrixWorld(true);

  // 10. Measure ACTUAL resulting world direction
  upperArm.getWorldPosition(startPos);
  forearm.getWorldPosition(endPos);
  const actualDir = endPos.clone().sub(startPos).normalize();
  const actualError = Math.acos(Math.max(-1, Math.min(1, actualDir.dot(targetDir)))) * 180 / Math.PI;

  console.log(`[SingleBoneTest] POST-APPLICATION:`);
  console.log(`  Actual world dir: (${actualDir.x.toFixed(4)}, ${actualDir.y.toFixed(4)}, ${actualDir.z.toFixed(4)})`);
  console.log(`  Actual angle error: ${actualError.toFixed(4)}°`);

  if (actualError < 1.0) {
    console.log(`%c[SingleBoneTest] ✅ SINGLE BONE TEST PASSED`, 'color: #00ff00; font-weight: bold');
  } else {
    console.error(`[SingleBoneTest] ❌ SINGLE BONE TEST FAILED — actual error ${actualError.toFixed(2)}°`);
  }

  // 11. Restore bind pose
  upperArm.quaternion.copy(bindLocalQ);
  root.updateMatrixWorld(true);

  console.log('%c[SingleBoneTest] ═══ END ═══', 'color: #ff0000; font-weight: bold');
}

// ─── Full Arm Chain Solver (TARGET-BASED) ───────────────────────

export function createBasePose(
  boneMap: MintBoneMap,
  _bindPose: MintBindPose,
): MintBasePoseData {
  console.log('%c[MintBasePose] ═══ TARGET-BASED ARM SOLVER ═══', 'color: #ff9900; font-weight: bold');

  const deltas = new Map<THREE.Object3D, BoneBaseDelta>();
  const identity = new THREE.Quaternion();

  // Non-arm bones — identity (unchanged from bind)
  const nonArmSlots = [
    'pelvis', 'spine', 'spine1', 'spine2', 'neck', 'head',
    'leftThigh', 'leftCalf', 'leftFoot', 'leftToe',
    'rightThigh', 'rightCalf', 'rightFoot', 'rightToe',
  ] as const;
  for (const slot of nonArmSlots) {
    const bone = boneMap[slot];
    if (bone) deltas.set(bone, { quaternion: identity.clone() });
  }

  // Fingers — identity
  for (const chain of [...boneMap.leftFingers.values(), ...boneMap.rightFingers.values()]) {
    for (const bone of chain) {
      if (!deltas.has(bone)) deltas.set(bone, { quaternion: identity.clone() });
    }
  }

  // Solve both arms
  solveArmChain(deltas, boneMap, 'L');
  solveArmChain(deltas, boneMap, 'R');

  console.log(`[MintBasePose] ✅ ${deltas.size} bone deltas`);
  return { deltas };
}

/**
 * Solve one arm chain: clavicle → upperArm → forearm → hand.
 *
 * TARGET-BASED approach:
 * 1. Compute target elbow/hand positions from actual arm lengths
 * 2. Compute bone directions from target positions
 * 3. Solve clavicle first (rotates shoulder)
 * 4. Solve upper arm from UPDATED shoulder position
 * 5. Solve forearm from UPDATED elbow position
 * 6. Hand follows forearm through hierarchy (identity delta)
 * 7. All original quaternions captured and restored after solve
 */
function solveArmChain(
  deltas: Map<THREE.Object3D, BoneBaseDelta>,
  boneMap: MintBoneMap,
  side: 'L' | 'R',
) {
  const root = findRoot(boneMap.leftUpperArm || boneMap.rightUpperArm!);
  if (!root) {
    console.error(`[MintBasePose] Cannot find root bone`);
    return;
  }

  const clavicle = side === 'L' ? boneMap.leftClavicle : boneMap.rightClavicle;
  const upperArm = side === 'L' ? boneMap.leftUpperArm : boneMap.rightUpperArm;
  const forearm = side === 'L' ? boneMap.leftForearm : boneMap.rightForearm;
  const hand = side === 'L' ? boneMap.leftHand : boneMap.rightHand;

  if (!clavicle || !upperArm || !forearm || !hand) {
    console.warn(`[MintBasePose] ${side} arm incomplete`);
    return;
  }

  // Ensure world matrices are fresh
  root.updateMatrixWorld(true);

  // Capture ALL original quaternions before solving
  const origClavQ = clavicle.quaternion.clone();
  const origUaQ = upperArm.quaternion.clone();
  const origFaQ = forearm.quaternion.clone();
  const origHandQ = hand.quaternion.clone();

  const _wpA = new THREE.Vector3();
  const _wpB = new THREE.Vector3();

  // ── MEASURE ARM LENGTHS FROM BIND POSE ─────────────────────
  // World-space distances between bone positions
  const shoulderPos = new THREE.Vector3();
  const elbowPos = new THREE.Vector3();
  const wristPos = new THREE.Vector3();
  const handPos = new THREE.Vector3();
  clavicle.getWorldPosition(shoulderPos);
  upperArm.getWorldPosition(elbowPos);
  forearm.getWorldPosition(wristPos);
  hand.getWorldPosition(handPos);

  const worldUpperArmLen = elbowPos.distanceTo(shoulderPos);
  const worldForearmLen = wristPos.distanceTo(elbowPos);
  const worldHandOffset = handPos.distanceTo(wristPos);

  // Local bone position offsets (determines actual chain geometry)
  const localUaOffset = upperArm.position.length();  // clavicle-local offset to upperArm
  const localFaOffset = forearm.position.length();    // upperArm-local offset to forearm
  const localHandOffset = hand.position.length();     // forearm-local offset to hand

  // The upper arm's LOCAL position determines where the elbow ends up
  // after clavicle rotation. Use local offset, not world distance.
  const upperArmLength = localUaOffset;
  // The forearm's LOCAL position determines where the hand ends up
  // after upper arm rotation. Use local offset, not world distance.
  const forearmLength = localFaOffset;

  console.log(`  ${side} WORLD distances: shoulder→elbow=${worldUpperArmLen.toFixed(3)} elbow→wrist=${worldForearmLen.toFixed(3)} wrist→hand=${worldHandOffset.toFixed(3)}`);
  console.log(`  ${side} LOCAL  offsets:  upperArm.pos=${localUaOffset.toFixed(3)} forearm.pos=${localFaOffset.toFixed(3)} hand.pos=${localHandOffset.toFixed(3)}`);
  console.log(`  ${side} Using: upperArmLength=${upperArmLength.toFixed(3)} forearmLength=${forearmLength.toFixed(3)}`);
  console.log(`  ${side} Shoulder: (${shoulderPos.x.toFixed(3)}, ${shoulderPos.y.toFixed(3)}, ${shoulderPos.z.toFixed(3)})`);
  console.log(`  ${side} Elbow (bind): (${elbowPos.x.toFixed(3)}, ${elbowPos.y.toFixed(3)}, ${elbowPos.z.toFixed(3)})`);
  console.log(`  ${side} Wrist (bind): (${wristPos.x.toFixed(3)}, ${wristPos.y.toFixed(3)}, ${wristPos.z.toFixed(3)})`);
  console.log(`  ${side} Hand (bind):  (${handPos.x.toFixed(3)}, ${handPos.y.toFixed(3)}, ${handPos.z.toFixed(3)})`);

  // ── COMPUTE TARGET POSITIONS FROM ACTUAL BODY GEOMETRY ─────
  // Instead of fixed offsets, derive arm geometry from Mint's actual skeleton.
  const sign = side === 'L' ? -1 : 1; // left = negative X, right = positive X
  const worldUp = new THREE.Vector3(0, 0, -1);

  // 1. Read body reference from thigh bones (where the legs are)
  const leftThighBone = boneMap.leftThigh;
  const rightThighBone = boneMap.rightThigh;
  let leftThighX = -0.04; // fallback
  let rightThighX = 0.04;
  if (leftThighBone && rightThighBone) {
    const ltPos = new THREE.Vector3();
    const rtPos = new THREE.Vector3();
    leftThighBone.getWorldPosition(ltPos);
    rightThighBone.getWorldPosition(rtPos);
    leftThighX = ltPos.x;
    rightThighX = rtPos.x;
  }
  // Body half-width at thigh height: max of |thighX| + surface margin
  const bodyHalfWidth = Math.max(Math.abs(leftThighX), Math.abs(rightThighX)) + 0.03;

  // 2. Upper arm angle: must place elbow OUTSIDE the body
  // The elbow X must be at least bodyHalfWidth from center
  const minElbowX = bodyHalfWidth;
  const uaAngleRad = Math.asin(Math.min(0.35, minElbowX / Math.max(0.01, upperArmLength)));
  const uaAngleDeg = uaAngleRad * 180 / Math.PI;
  const uaDir = new THREE.Vector3(sign * Math.sin(uaAngleRad), -Math.cos(uaAngleRad), 0).normalize();

  // 3. Target elbow: shoulder + upperArm direction × length
  const targetElbow = new THREE.Vector3().copy(shoulderPos).addScaledVector(uaDir, upperArmLength);

  // 4. Hand target: beside the outer thigh (not arbitrary centerline offset)
  const thighBone = side === 'L' ? leftThighBone : rightThighBone;
  let handTargetX: number;
  if (thighBone) {
    const tPos = new THREE.Vector3();
    thighBone.getWorldPosition(tPos);
    // Hand X = thigh X + small outward offset (clears body surface)
    handTargetX = tPos.x + sign * 0.025;
  } else {
    // Fallback: use body half-width
    handTargetX = sign * bodyHalfWidth;
  }

  const targetHand = new THREE.Vector3(
    handTargetX,
    targetElbow.y - forearmLength, // hang straight down from elbow
    shoulderPos.z + 0.015,         // slight forward offset for natural pose
  );

  // 5. Derive forearm direction from elbow→targetHand
  const faDir = targetHand.clone().sub(targetElbow).normalize();

  // Log geometry
  console.log(`  ${side} Thigh X: L=${leftThighX.toFixed(3)} R=${rightThighX.toFixed(3)} bodyHalfWidth=${bodyHalfWidth.toFixed(3)}`);
  console.log(`  ${side} Upper arm angle: ${uaAngleDeg.toFixed(1)}° from vertical`);
  console.log(`  ${side} uaDir=(${uaDir.x.toFixed(3)}, ${uaDir.y.toFixed(3)}, ${uaDir.z.toFixed(3)})`);
  console.log(`  ${side} faDir=(${faDir.x.toFixed(3)}, ${faDir.y.toFixed(3)}, ${faDir.z.toFixed(3)})`);
  console.log(`  ${side} Target shoulder: (${shoulderPos.x.toFixed(3)}, ${shoulderPos.y.toFixed(3)}, ${shoulderPos.z.toFixed(3)})`);
  console.log(`  ${side} Target elbow:   (${targetElbow.x.toFixed(3)}, ${targetElbow.y.toFixed(3)}, ${targetElbow.z.toFixed(3)})`);
  console.log(`  ${side} Target hand:    (${targetHand.x.toFixed(3)}, ${targetHand.y.toFixed(3)}, ${targetHand.z.toFixed(3)})`);

  // ── CLAVICLE ───────────────────────────────────────────────
  // Direction from bind shoulder to target elbow
  const clavDir = targetElbow.clone().sub(shoulderPos).normalize();
  const clavDesiredWorldQ = buildOrientationFromForward(clavDir, worldUp);

  const clavicleParentWorldQ = computeWorldQUpToParent(clavicle);
  const clavicleBindLocalQ = clavicle.quaternion.clone();
  const clavDesiredLocalQ = clavicleParentWorldQ.clone().invert().multiply(clavDesiredWorldQ);
  const clavLocalDelta = clavDesiredLocalQ.clone().multiply(clavicleBindLocalQ.clone().invert());

  deltas.set(clavicle, { quaternion: clavLocalDelta });

  // Apply clavicle delta and update world matrices
  const clavFinalQ = clavLocalDelta.clone().multiply(clavicleBindLocalQ);
  clavicle.quaternion.copy(clavFinalQ);
  root.updateMatrixWorld(true);

  // Verify clavicle
  clavicle.getWorldPosition(_wpA);
  upperArm.getWorldPosition(_wpB);
  const clavActualDir = _wpB.clone().sub(_wpA).normalize();
  const clavError = Math.acos(Math.max(-1, Math.min(1, clavActualDir.dot(clavDir)))) * 180 / Math.PI;
  console.log(`  ${side}-Clavicle: target=(${clavDir.x.toFixed(3)}, ${clavDir.y.toFixed(3)}, ${clavDir.z.toFixed(3)}) actual=(${clavActualDir.x.toFixed(3)}, ${clavActualDir.y.toFixed(3)}, ${clavActualDir.z.toFixed(3)}) error=${clavError.toFixed(3)}°`);

  // ── UPPER ARM ──────────────────────────────────────────────
  // Shoulder is now at _wpA (from clavicle verification above)
  const newShoulderPos = _wpA.clone();
  const uaTargetDir = targetElbow.clone().sub(newShoulderPos).normalize();

  const uaDesiredWorldQ = buildOrientationFromForward(uaTargetDir, worldUp);
  const uaParentWorldQ = computeWorldQUpToParent(upperArm);
  const uaBindLocalQ = upperArm.quaternion.clone();
  const uaDesiredLocalQ = uaParentWorldQ.clone().invert().multiply(uaDesiredWorldQ);
  const uaLocalDelta = uaDesiredLocalQ.clone().multiply(uaBindLocalQ.clone().invert());

  deltas.set(upperArm, { quaternion: uaLocalDelta });

  // Apply upper arm delta and update world matrices
  const uaFinalQ = uaLocalDelta.clone().multiply(uaBindLocalQ);
  upperArm.quaternion.copy(uaFinalQ);
  root.updateMatrixWorld(true);

  // Verify upper arm
  upperArm.getWorldPosition(_wpA);
  forearm.getWorldPosition(_wpB);
  const uaActualDir = _wpB.clone().sub(_wpA).normalize();
  const uaError = Math.acos(Math.max(-1, Math.min(1, uaActualDir.dot(uaTargetDir)))) * 180 / Math.PI;
  console.log(`  ${side}-UpperArm: target=(${uaTargetDir.x.toFixed(3)}, ${uaTargetDir.y.toFixed(3)}, ${uaTargetDir.z.toFixed(3)}) actual=(${uaActualDir.x.toFixed(3)}, ${uaActualDir.y.toFixed(3)}, ${uaActualDir.z.toFixed(3)}) error=${uaError.toFixed(3)}°`);

  // ── FOREARM ────────────────────────────────────────────────
  // Elbow is now at _wpA (from upper arm verification)
  const newElbowPos = _wpA.clone();
  const faTargetDir = targetHand.clone().sub(newElbowPos).normalize();

  const faDesiredWorldQ = buildOrientationFromForward(faTargetDir, worldUp);
  const faParentWorldQ = computeWorldQUpToParent(forearm);
  const faBindLocalQ = forearm.quaternion.clone();
  const faDesiredLocalQ = faParentWorldQ.clone().invert().multiply(faDesiredWorldQ);
  const faLocalDelta = faDesiredLocalQ.clone().multiply(faBindLocalQ.clone().invert());

  deltas.set(forearm, { quaternion: faLocalDelta });

  // Apply forearm delta and update world matrices
  const faFinalQ = faLocalDelta.clone().multiply(faBindLocalQ);
  forearm.quaternion.copy(faFinalQ);
  root.updateMatrixWorld(true);

  // Verify forearm
  forearm.getWorldPosition(_wpA);
  hand.getWorldPosition(_wpB);
  const faActualDir = _wpB.clone().sub(_wpA).normalize();
  const faError = Math.acos(Math.max(-1, Math.min(1, faActualDir.dot(faTargetDir)))) * 180 / Math.PI;
  console.log(`  ${side}-Forearm: target=(${faTargetDir.x.toFixed(3)}, ${faTargetDir.y.toFixed(3)}, ${faTargetDir.z.toFixed(3)}) actual=(${faActualDir.x.toFixed(3)}, ${faActualDir.y.toFixed(3)}, ${faActualDir.z.toFixed(3)}) error=${faError.toFixed(3)}°`);

  // ── HAND — orient palm inward, fingers along forearm ────────
  // The hand's bind orientation was designed for T-pose.
  // When the forearm hangs down, we need the hand's palm to face
  // inward (toward the body) and fingers to point along the forearm.
  //
  // Desired hand world orientation:
  //   X axis = same as forearm world X (along bone = downward)
  //   Y axis = toward body center (palm faces inward)
  //   Z axis = cross(X, Y)
  const forearmWorldQ = new THREE.Quaternion();
  { // compute forearm world Q from the chain after forearm solve
    const fChain: THREE.Object3D[] = [];
    let fCur: THREE.Object3D | null = forearm.parent;
    while (fCur) { fChain.unshift(fCur); fCur = fCur.parent; }
    for (const b of fChain) forearmWorldQ.multiply(b.quaternion);
    forearmWorldQ.multiply(faFinalQ);
  }

  // Extract forearm's world X axis (the bone direction = downward)
  const faWorldX = new THREE.Vector3(1, 0, 0).applyQuaternion(forearmWorldQ);
  // Desired hand Y axis: toward body center
  // For left hand: +X world (rightward = toward center)
  // For right hand: -X world (leftward = toward center)
  const towardBody = new THREE.Vector3(sign * -1, 0, 0);
  // Build desired hand world orientation: X = bone direction, Y = toward body
  const handDesiredWorldQ = buildOrientationFromForward(faWorldX, towardBody);

  // Convert to hand's local space and compute delta from bind
  const handParentWorldQ = computeWorldQUpToParent(hand);
  const handBindLocalQ = hand.quaternion.clone();
  const handDesiredLocalQ = handParentWorldQ.clone().invert().multiply(handDesiredWorldQ);
  const handLocalDelta = handDesiredLocalQ.clone().multiply(handBindLocalQ.clone().invert());

  deltas.set(hand, { quaternion: handLocalDelta });

  // Apply hand delta and update world matrices for verification
  const handFinalQ = handLocalDelta.clone().multiply(handBindLocalQ);
  hand.quaternion.copy(handFinalQ);
  root.updateMatrixWorld(true);

  // ── COMPREHENSIVE HAND/WRIST DIAGNOSTIC ────────────────────
  const finalHandPos = _wpB.clone();
  const handWorldQ = new THREE.Quaternion();
  { // compute hand world Q
    const hChain: THREE.Object3D[] = [];
    let hCur: THREE.Object3D | null = hand.parent;
    while (hCur) { hChain.unshift(hCur); hCur = hCur.parent; }
    for (const b of hChain) handWorldQ.multiply(b.quaternion);
    handWorldQ.multiply(handFinalQ);
  }
  const handX = new THREE.Vector3(1, 0, 0).applyQuaternion(handWorldQ);
  const handY = new THREE.Vector3(0, 1, 0).applyQuaternion(handWorldQ);
  const handZ = new THREE.Vector3(0, 0, 1).applyQuaternion(handWorldQ);

  console.log(`  ${side}-Hand world axes:`);
  console.log(`    X(fingers)=(${handX.x.toFixed(3)}, ${handX.y.toFixed(3)}, ${handX.z.toFixed(3)})`);
  console.log(`    Y(palm)=(${handY.x.toFixed(3)}, ${handY.y.toFixed(3)}, ${handY.z.toFixed(3)})`);
  console.log(`    Z=(${handZ.x.toFixed(3)}, ${handZ.y.toFixed(3)}, ${handZ.z.toFixed(3)})`);
  console.log(`  ${side}-Hand position: (${finalHandPos.x.toFixed(3)}, ${finalHandPos.y.toFixed(3)}, ${finalHandPos.z.toFixed(3)})`);

  // Check hand position relative to torso
  const torsoCenter = new THREE.Vector3();
  const spineBone = boneMap.spine;
  if (spineBone) spineBone.getWorldPosition(torsoCenter);
  const handDistFromTorso = Math.abs(finalHandPos.x - torsoCenter.x);
  console.log(`  ${side}-Hand dist-from-torso-center=${handDistFromTorso.toFixed(3)}`);
  if (handDistFromTorso < 0.05) {
    console.warn(`  ⚠️  ${side}-Hand may be inside torso! dist=${handDistFromTorso.toFixed(3)}`);
  }

  // Check symmetry with other hand
  const otherHand = side === 'L' ? boneMap.rightHand : boneMap.leftHand;
  if (otherHand) {
    const otherPos = new THREE.Vector3();
    otherHand.getWorldPosition(otherPos);
    const xDiff = Math.abs(finalHandPos.x) - Math.abs(otherPos.x);
    const yDiff = Math.abs(finalHandPos.y - otherPos.y);
    console.log(`  ${side}-Hand symmetry check: X diff=${xDiff.toFixed(4)} Y diff=${yDiff.toFixed(4)}`);
  }

  // ── RESTORE ALL ORIGINAL QUATERNIONS ───────────────────────
  clavicle.quaternion.copy(origClavQ);
  upperArm.quaternion.copy(origUaQ);
  forearm.quaternion.copy(origFaQ);
  hand.quaternion.copy(origHandQ);
  root.updateMatrixWorld(true);
}

/**
 * Compute a bone's world quaternion by traversing from root to this bone.
 * Reads each bone's local quaternion and accumulates the chain.
 */
function computeWorldQUpToParent(bone: THREE.Object3D): THREE.Quaternion {
  const chain: THREE.Object3D[] = [];
  let current: THREE.Object3D | null = bone.parent;
  while (current) {
    chain.unshift(current);
    current = current.parent;
  }
  const worldQ = new THREE.Quaternion();
  for (const b of chain) {
    worldQ.multiply(b.quaternion);
  }
  return worldQ;
}

/**
 * Find the root bone by traversing up the parent chain.
 */
function findRoot(bone: THREE.Object3D): THREE.Object3D | null {
  let current: THREE.Object3D | null = bone;
  while (current.parent) {
    current = current.parent;
  }
  return current;
}

export function getBaseDelta(basePose: MintBasePoseData, bone: THREE.Object3D): THREE.Quaternion {
  return basePose.deltas.get(bone)?.quaternion ?? new THREE.Quaternion();
}

// ─── Diagnostic: bone-segment direction table ───────────────────

export function dumpBoneDirections(boneMap: MintBoneMap, root: THREE.Object3D): void {
  console.log('%c[MintBasePose] ═══ BONE SEGMENT DIRECTIONS ═══', 'color: #00ffff; font-weight: bold');
  root.updateWorldMatrix(true, true);

  const segments: [string, string, string][] = [
    ['L-Clavicle', 'leftClavicle', 'leftUpperArm'],
    ['L-UpperArm', 'leftUpperArm', 'leftForearm'],
    ['L-Forearm',  'leftForearm',  'leftHand'],
    ['R-Clavicle', 'rightClavicle', 'rightUpperArm'],
    ['R-UpperArm', 'rightUpperArm', 'rightForearm'],
    ['R-Forearm',  'rightForearm',  'rightHand'],
  ];

  const downDir = new THREE.Vector3(0, -1, 0);
  console.log('  Segment      | Start            | End              | Direction                 | Len   | FromDown');
  console.log('  -------------|------------------|------------------|--------------------------|-------|---------');

  for (const [label, startSlot, endSlot] of segments) {
    const sb = (boneMap as any)[startSlot] as THREE.Object3D | null;
    const eb = (boneMap as any)[endSlot] as THREE.Object3D | null;
    if (!sb || !eb) { console.log(`  ${label.padEnd(13)}| MISSING`); continue; }

    const sp = new THREE.Vector3(); sb.getWorldPosition(sp);
    const ep = new THREE.Vector3(); eb.getWorldPosition(ep);
    const dir = ep.clone().sub(sp);
    const len = dir.length();
    dir.normalize();
    const ang = Math.acos(Math.min(1, Math.max(-1, dir.dot(downDir)))) * 180 / Math.PI;
    console.log(`  ${label.padEnd(13)}| ${sb.name.padEnd(16)}| ${eb.name.padEnd(16)}| (${dir.x.toFixed(3)}, ${dir.y.toFixed(3)}, ${dir.z.toFixed(3)}) | ${len.toFixed(1).padEnd(5)} | ${ang.toFixed(1)}°`);
  }

  console.log('%c[MintBasePose] ═══ END ═══', 'color: #00ffff; font-weight: bold');
}
