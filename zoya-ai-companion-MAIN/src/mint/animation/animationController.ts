import * as THREE from 'three';
import { AnimationIntent } from '../../types';
import { MintBoneMap, discoverMintBones, validateSkeleton } from './skeletonMap';
import { MintBindPose, captureBindPose } from './bindPose';
import { createPoseComposer, DebugMode } from './poseComposer';
import { dumpBoneDirections, runSingleBoneTest } from './basePose';

/**
 * MintAnimationController (NEW)
 *
 * Clean, minimal procedural animation system for Mint.
 * Replaces the old Mixamo retargeting system entirely.
 *
 * Architecture:
 * - Discovers Mint's actual skeleton bones (only anatomical bones)
 * - Captures immutable bind pose once
 * - Computes procedural animations from the bind pose every frame
 * - Never accumulates quaternion drift
 * - Modular layers: base → idle → emotion → talking
 *
 * No external animation files. No Mixamo. No AnimationMixer.
 */

const PRIORITY: Record<AnimationIntent, number> = {
  greeting: 4, goodbye: 4,
  surprised: 3, laughing: 3,
  happy: 2, excited: 2, sad: 2, angry: 2, shy: 2, confused: 2, talking: 2,
  thinking: 1, listening: 1, calm: 1,
  idle: 0,
};

export class MintAnimationController {
  // ═══════════════════════════════════════════════════════════════
  //  DEBUG MODES
  // ═══════════════════════════════════════════════════════════════
  static DEBUG_MODE: DebugMode = 'IDLE_ONLY';

  // ═══════════════════════════════════════════════════════════════
  //  STATE
  // ═══════════════════════════════════════════════════════════════
  private boneMap: MintBoneMap | null = null;
  private bindPose: MintBindPose | null = null;
  private composer: ReturnType<typeof createPoseComposer> | null = null;
  private currentIntent: AnimationIntent = 'idle';
  private targetIntent: AnimationIntent = 'idle';
  private currentEmotion: string = 'neutral';
  private currentIntensity: number = 0.4;
  private isSpeaking: boolean = false;
  private initialized = false;
  private firstFrameDone = false;
  private time = 0;
  private initialRootPosition: THREE.Vector3 | null = null;

  // ═══════════════════════════════════════════════════════════════
  //  BONE DISCOVERY
  // ═══════════════════════════════════════════════════════════════

  /**
   * Discover Mint's skeleton bones from the loaded FBX model.
   * Must be called after the FBX is loaded and the model group is available.
   */
  discoverBones(root: THREE.Object3D) {
    this.initialized = false;
    this.composer = null;
    this.bindPose = null;

    console.log('%c[MintAnim] ═══ BONE DISCOVERY (NEW SYSTEM) ═══', 'color: #00ff00; font-weight: bold');

    // Discover anatomical bones
    this.boneMap = discoverMintBones(root);

    // Validate that critical bones are present
    if (!validateSkeleton(this.boneMap)) {
      console.error('[MintAnim] ❌ Critical bones missing — animation will not work');
      return;
    }

    // Capture immutable bind pose
    this.bindPose = captureBindPose(this.boneMap, root);

    // Diagnostic: dump actual bone world positions and directions
    dumpBoneDirections(this.boneMap, root);

    // Single bone verification test
    runSingleBoneTest(this.boneMap, root);

    // Build the pose composer (creates base pose, idle, emotion, talking)
    this.composer = createPoseComposer(this.boneMap, this.bindPose);

    // Store the initial root position set by FBX loader (auto-centering)
    this.initialRootPosition = root.position.clone();

    this.initialized = true;

    console.log('%c[MintAnim] ✅ NEW ANIMATION SYSTEM INITIALIZED', 'color: #00ff00; font-weight: bold');
    console.log(`[MintAnim] Debug mode: ${MintAnimationController.DEBUG_MODE}`);

    if (MintAnimationController.DEBUG_MODE !== 'FULL') {
      console.log(`%c[MintAnim] ═══ DEBUG: ${MintAnimationController.DEBUG_MODE} ═══`, 'color: #ff00ff; font-weight: bold');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTENT / EMOTION / SPEAKING STATE
  // ═══════════════════════════════════════════════════════════════

  setIntent(intent: AnimationIntent) {
    if (intent === this.targetIntent) return;
    if (PRIORITY[intent] >= PRIORITY[this.targetIntent] || this.targetIntent === 'idle') {
      this.targetIntent = intent;
      this.currentIntent = intent;
    }
  }

  getIntent(): AnimationIntent {
    return this.currentIntent;
  }

  setEmotion(emotion: string, intensity: number = 0.5) {
    this.currentEmotion = emotion;
    this.currentIntensity = intensity;
  }

  setSpeaking(isSpeaking: boolean) {
    this.isSpeaking = isSpeaking;
  }

  getBoneMap(): MintBoneMap | null {
    return this.boneMap;
  }

  /**
   * Set the debug mode for testing individual animation layers.
   */
  static setDebugMode(mode: DebugMode) {
    MintAnimationController.DEBUG_MODE = mode;
    console.log(`[MintAnim] Debug mode set to: ${mode}`);
  }

  /**
   * Get the list of available debug modes.
   */
  static getDebugModes(): DebugMode[] {
    return ['FULL', 'BASE_ONLY', 'IDLE_ONLY', 'EMOTION_ONLY', 'TALKING_ONLY'];
  }

  // ═══════════════════════════════════════════════════════════════
  //  UPDATE (called every frame)
  // ═══════════════════════════════════════════════════════════════

  update(delta: number) {
    if (!this.initialized || !this.composer) return;

    this.time += delta;

    // Map animation intent to emotion for the body pose
    const bodyEmotion = this.mapIntentToEmotion(this.currentIntent);

    // Update the pose composer
    this.composer.update(
      delta,
      this.isSpeaking ? 'talking' : bodyEmotion,
      this.currentIntensity,
      this.isSpeaking,
      MintAnimationController.DEBUG_MODE,
    );

    // ONE-TIME: Verify base pose is actually applied after first frame
    if (!this.firstFrameDone && this.boneMap) {
      this.firstFrameDone = true;

      // Force world matrix update so we can read actual world positions
      const root = this.findRoot();
      if (root) root.updateMatrixWorld(true);

      console.log('%c[FirstFrame] ═══ POST-UPDATE ARM DIRECTIONS ═══', 'color: #00ffff; font-weight: bold');

      const checkArm = (label: string, startSlot: string, endSlot: string) => {
        const startBone = (this.boneMap as any)[startSlot] as THREE.Object3D | undefined;
        const endBone = (this.boneMap as any)[endSlot] as THREE.Object3D | undefined;
        if (!startBone || !endBone) return;

        const startPos = new THREE.Vector3();
        const endPos = new THREE.Vector3();
        startBone.getWorldPosition(startPos);
        endBone.getWorldPosition(endPos);
        const dir = endPos.clone().sub(startPos).normalize();
        const downDir = new THREE.Vector3(0, -1, 0);
        const fromDown = Math.acos(Math.min(1, Math.max(-1, dir.dot(downDir)))) * 180 / Math.PI;

        console.log(`  ${label}: dir=(${dir.x.toFixed(3)}, ${dir.y.toFixed(3)}, ${dir.z.toFixed(3)}) fromDown=${fromDown.toFixed(1)}°`);
        console.log(`    startWorld=(${startPos.x.toFixed(3)}, ${startPos.y.toFixed(3)}, ${startPos.z.toFixed(3)})`);
        console.log(`    endWorld=(${endPos.x.toFixed(3)}, ${endPos.y.toFixed(3)}, ${endPos.z.toFixed(3)})`);

        // Also log the bone's current local quaternion
        const bq = startBone.quaternion;
        console.log(`    localQ=(${bq.x.toFixed(4)}, ${bq.y.toFixed(4)}, ${bq.z.toFixed(4)}, ${bq.w.toFixed(4)})`);
      };

      checkArm('L-Clavicle→UpperArm', 'leftClavicle', 'leftUpperArm');
      checkArm('L-UpperArm→Forearm', 'leftUpperArm', 'leftForearm');
      checkArm('L-Forearm→Hand', 'leftForearm', 'leftHand');
      checkArm('R-Clavicle→UpperArm', 'rightClavicle', 'rightUpperArm');
      checkArm('R-UpperArm→Forearm', 'rightUpperArm', 'rightForearm');
      checkArm('R-Forearm→Hand', 'rightForearm', 'rightHand');

      // Hand orientation axes diagnostic
      const checkHandAxes = (lab: string, slot: string) => {
        const bone = (this.boneMap as any)[slot] as THREE.Object3D | undefined;
        if (!bone) return;
        const wq = new THREE.Quaternion();
        const ch: THREE.Object3D[] = [];
        let c: THREE.Object3D | null = bone;
        while (c) { ch.unshift(c); c = c.parent; }
        for (const b of ch) wq.multiply(b.quaternion);
        const hx = new THREE.Vector3(1,0,0).applyQuaternion(wq);
        const hy = new THREE.Vector3(0,1,0).applyQuaternion(wq);
        const hz = new THREE.Vector3(0,0,1).applyQuaternion(wq);
        const hp = new THREE.Vector3(); bone.getWorldPosition(hp);
        console.log(`  ${lab} world axes:`);
        console.log(`    X(fingers)=(${hx.x.toFixed(3)},${hx.y.toFixed(3)},${hx.z.toFixed(3)})`);
        console.log(`    Y(palm)=(${hy.x.toFixed(3)},${hy.y.toFixed(3)},${hy.z.toFixed(3)})`);
        console.log(`    Z=(${hz.x.toFixed(3)},${hz.y.toFixed(3)},${hz.z.toFixed(3)})`);
        console.log(`    pos=(${hp.x.toFixed(3)},${hp.y.toFixed(3)},${hp.z.toFixed(3)})`);
      };
      checkHandAxes('L-Hand', 'leftHand');
      checkHandAxes('R-Hand', 'rightHand');

      console.log('%c[FirstFrame] ═══ END ═══', 'color: #00ffff; font-weight: bold');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  INTENT → EMOTION MAPPING
  // ═══════════════════════════════════════════════════════════════

  private findRoot(): THREE.Object3D | null {
    if (!this.boneMap) return null;
    const bone = this.boneMap.leftUpperArm || this.boneMap.rightUpperArm;
    if (!bone) return null;
    let current: THREE.Object3D | null = bone;
    while (current.parent) current = current.parent;
    return current;
  }

  private mapIntentToEmotion(intent: AnimationIntent): string {
    // Map animation intents to body emotions
    switch (intent) {
      case 'happy':
      case 'excited':
      case 'greeting':
      case 'goodbye':
        return intent === 'greeting' ? 'greeting'
          : intent === 'goodbye' ? 'goodbye'
          : intent;
      case 'sad':
      case 'angry':
      case 'surprised':
      case 'confused':
      case 'shy':
      case 'calm':
        return intent;
      case 'thinking':
        return 'thinking';
      case 'laughing':
        return 'laughing';
      case 'listening':
        return 'listening';
      case 'talking':
        return 'talking';
      case 'idle':
      default:
        return this.currentEmotion || 'neutral';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  DIAGNOSTICS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Run safety diagnostics on bone transforms.
   * Call periodically (e.g., every 5 seconds) to catch issues.
   */
  runDiagnostics(): void {
    if (!this.boneMap || !this.bindPose) return;

    // Specific bones requested for detailed inspection
    const inspectSlots = [
      'leftThigh', 'leftCalf', 'rightThigh', 'rightCalf',
      'leftClavicle', 'leftUpperArm', 'leftForearm',
      'rightClavicle', 'rightUpperArm', 'rightForearm',
    ] as const;

    console.group('[MintDiag] ═══ BONE INSPECTION ═══');
    for (const slot of inspectSlots) {
      const bone = this.boneMap[slot];
      if (!bone) continue;

      const bindData = this.bindPose.bones.get(bone);
      const bq = bone.quaternion;

      // Quaternion length check
      const len = Math.sqrt(bq.x * bq.x + bq.y * bq.y + bq.z * bq.z + bq.w * bq.w);
      if (Math.abs(len - 1.0) > 0.01) {
        console.error(`[MintDiag] ❌ NON-NORMALIZED on ${slot}: len=${len.toFixed(6)}`);
      }
      if (isNaN(bq.x) || isNaN(bq.y) || isNaN(bq.z) || isNaN(bq.w)) {
        console.error(`[MintDiag] ❌ NaN on ${slot}`);
        continue;
      }

      // Compute delta from bind
      if (bindData) {
        // q and -q represent the SAME physical rotation.
        // Use the absolute dot product to handle sign ambiguity:
        //   dot = bindQ.w*bq.w + bindQ.x*bq.x + bindQ.y*bq.y + bindQ.z*bq.z
        //   angle = 2 * acos(|dot|)
        // This correctly gives 0° when bindQ = ±bq (same rotation)
        // and 180° only for genuinely opposite rotations.
        const bDot = bindData.quaternion.w * bq.w + bindData.quaternion.x * bq.x
                   + bindData.quaternion.y * bq.y + bindData.quaternion.z * bq.z;
        const angleDeg = 2 * Math.acos(Math.min(1, Math.abs(bDot))) * 180 / Math.PI;

        // Also compute the diff quaternion for debugging
        const diff = bindData.quaternion.clone().invert().multiply(bq);

        if (angleDeg > 170) {
          console.error(`[MintDiag] ❌ 180° FLIP on ${slot} "${bone.name}": ${angleDeg.toFixed(1)}° from bind`);
          console.error(`  bind q=(${bindData.quaternion.x.toFixed(4)}, ${bindData.quaternion.y.toFixed(4)}, ${bindData.quaternion.z.toFixed(4)}, ${bindData.quaternion.w.toFixed(4)})`);
          console.error(`  curr q=(${bq.x.toFixed(4)}, ${bq.y.toFixed(4)}, ${bq.z.toFixed(4)}, ${bq.w.toFixed(4)})`);
          console.error(`  dot=${bDot.toFixed(6)} diff=(${diff.x.toFixed(4)}, ${diff.y.toFixed(4)}, ${diff.z.toFixed(4)}, ${diff.w.toFixed(4)})`);
        } else if (angleDeg > 0.001) {
          console.log(`[MintDiag] ${slot} "${bone.name}": delta=${angleDeg.toFixed(3)}° dot=${bDot.toFixed(4)}`);
        } else {
          console.log(`[MintDiag] ${slot} "${bone.name}": unchanged (identity delta) dot=${bDot.toFixed(4)}`);
        }
      } else {
        console.warn(`[MintDiag] ${slot} "${bone.name}": NOT in bind pose map`);
      }
    }
    console.groupEnd();
  }

  /**
   * Check if the model root position has been accidentally modified.
   */
  checkWorldTransform(root: THREE.Object3D): boolean {
    // Compare against the INITIAL position set by FBX loader, not against zero.
    // The FBX loader auto-centers the model, so position.z may not be zero.
    const pos = root.position;
    const scale = root.scale;
    let safe = true;

    if (this.initialRootPosition) {
      const dx = Math.abs(pos.x - this.initialRootPosition.x);
      const dz = Math.abs(pos.z - this.initialRootPosition.z);
      if (dx > 0.01 || dz > 0.01) {
        console.warn(`[MintDiag] ⚠️  Model position drifted from initial: delta=(${dx.toFixed(3)}, ?, ${dz.toFixed(3)})`);
        safe = false;
      }
    }
    if (Math.abs(scale.x - scale.y) > 0.01 || Math.abs(scale.y - scale.z) > 0.01) {
      console.warn(`[MintDiag] ⚠️  Non-uniform scale detected`);
      safe = false;
    }
    return safe;
  }
}
