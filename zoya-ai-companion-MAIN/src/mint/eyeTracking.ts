import * as THREE from 'three';
import { MintBoneMap } from './animation/skeletonMap';

/**
 * Eye tracking system for Mint.
 *
 * Makes Mint's eyeball bones follow the mouse cursor position.
 * Architecture: Raw Mouse → 3D Target → Bounded Rotation → Exponential Smoothing → Eye Bones
 *
 * Uses Bon_eyeball_L and Bon_eyeball_R (children of Bone_head).
 *
 * Smoothing: Frame-rate-independent exponential decay.
 *   alpha = 1 - Math.exp(-speed * delta)
 *   smoothed = lerp(smoothed, raw, alpha)
 */

export interface EyeTrackingConfig {
  /** Maximum horizontal rotation in degrees (default: 25°) */
  maxHorizontalDeg: number;
  /** Maximum vertical rotation in degrees (default: 18°) */
  maxVerticalDeg: number;
  /** Exponential smoothing speed (default: 12). Higher = faster response. */
  smoothingSpeed: number;
}

const DEFAULT_CONFIG: EyeTrackingConfig = {
  maxHorizontalDeg: 25,
  maxVerticalDeg: 18,
  smoothingSpeed: 12,
};

export class EyeTracker {
  private leftEye: THREE.Object3D | null = null;
  private rightEye: THREE.Object3D | null = null;
  private camera: THREE.PerspectiveCamera;
  private config: EyeTrackingConfig;

  // Bind poses (captured once at init)
  private leftBindQ = new THREE.Quaternion();
  private rightBindQ = new THREE.Quaternion();
  private leftParentWorldQ = new THREE.Quaternion();
  private rightParentWorldQ = new THREE.Quaternion();

  // Raw target: the instantaneous mouse-derived 3D point
  private rawTarget = new THREE.Vector3();
  // Smoothed target: exponentially smoothed version of rawTarget
  private smoothedTarget = new THREE.Vector3();
  private initialized = false;

  // Reusable objects
  private _raycaster = new THREE.Raycaster();
  private _mouse = new THREE.Vector2();
  private _facePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private _hitPoint = new THREE.Vector3();
  private _eyeWorldPos = new THREE.Vector3();
  private _lookDir = new THREE.Vector3();
  private _clampedDir = new THREE.Vector3();
  private _desiredWorldQ = new THREE.Quaternion();
  private _desiredLocalQ = new THREE.Quaternion();
  private _localDelta = new THREE.Quaternion();
  private _finalLocalQ = new THREE.Quaternion();

  // Diagnostics (logged once)
  private diagLogged = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    config?: Partial<EyeTrackingConfig>,
  ) {
    this.camera = camera;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize with discovered bone map. Captures bind poses.
   */
  init(boneMap: MintBoneMap): void {
    this.leftEye = boneMap.leftEye;
    this.rightEye = boneMap.rightEye;

    if (!this.leftEye || !this.rightEye) {
      console.warn('[EyeTracker] Eye bones not found — tracking disabled');
      return;
    }

    // Capture bind quaternions
    this.leftBindQ.copy(this.leftEye.quaternion);
    this.rightBindQ.copy(this.rightEye.quaternion);

    // Capture parent world quaternions
    this.leftParentWorldQ.copy(this.computeParentWorldQ(this.leftEye));
    this.rightParentWorldQ.copy(this.computeParentWorldQ(this.rightEye));

    // Initialize smoothed target to neutral (center of screen = straight ahead)
    this.rawTarget.set(0, 0, -1);
    this.smoothedTarget.copy(this.rawTarget);

    this.initialized = true;

    console.log(`[EyeTracker] ✅ Initialized L="${this.leftEye.name}" R="${this.rightEye.name}"`);
    console.log(`[EyeTracker] maxH=${this.config.maxHorizontalDeg}° maxV=${this.config.maxVerticalDeg}° speed=${this.config.smoothingSpeed}`);

    this.logBindPose();
  }

  /**
   * Update eye tracking each frame.
   *
   * Pipeline: Raw mouse → 3D target → bounded rotation → exponential smoothing → bone quaternions
   *
   * @param delta - frame delta time in seconds
   * @param mouseCanvasX - mouse X on canvas in CSS pixels
   * @param mouseCanvasY - mouse Y on canvas in CSS pixels
   * @param canvasWidth - canvas width in CSS pixels
   * @param canvasHeight - canvas height in CSS pixels
   */
  update(
    delta: number,
    mouseCanvasX: number,
    mouseCanvasY: number,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    if (!this.leftEye || !this.rightEye || !this.initialized) return;

    // 1. Convert mouse position to NDC (-1 to +1)
    this._mouse.x = (mouseCanvasX / canvasWidth) * 2 - 1;
    this._mouse.y = -(mouseCanvasY / canvasHeight) * 2 + 1;

    // 2. Raycast to find raw 3D target point on the face-depth plane
    this._raycaster.setFromCamera(this._mouse, this.camera);
    this._hitPoint.set(0, 0, 0);
    this._raycaster.ray.intersectPlane(this._facePlane, this._hitPoint);

    // Set raw target (if intersection failed, keep previous raw target)
    if (this._hitPoint.x !== 0 || this._hitPoint.y !== 0 || this._hitPoint.z !== 0) {
      this.rawTarget.copy(this._hitPoint);
    }

    // 3. Frame-rate-independent exponential smoothing
    //    alpha = 1 - exp(-speed * delta) ensures consistent behavior across FPS
    const alpha = 1 - Math.exp(-this.config.smoothingSpeed * delta);
    this.smoothedTarget.lerp(this.rawTarget, alpha);

    // 4. Apply to both eyes
    this.applyEyeRotation(this.leftEye, this.leftBindQ, this.leftParentWorldQ, 'L');
    this.applyEyeRotation(this.rightEye, this.rightBindQ, this.rightParentWorldQ, 'R');
  }

  /**
   * Compute the rotation for a single eye bone to look at the smoothed target.
   * Applies clamping and converts to local space.
   */
  private applyEyeRotation(
    eyeBone: THREE.Object3D,
    bindLocalQ: THREE.Quaternion,
    parentWorldQ: THREE.Quaternion,
    _side: 'L' | 'R',
  ): void {
    // Get eye world position
    eyeBone.getWorldPosition(this._eyeWorldPos);

    // Direction from eye to smoothed target
    this._lookDir.copy(this.smoothedTarget).sub(this._eyeWorldPos).normalize();

    // Clamp rotation to max angles
    const hAngle = Math.atan2(this._lookDir.x, -this._lookDir.z);
    const vAngle = Math.atan2(
      this._lookDir.y,
      Math.sqrt(this._lookDir.x * this._lookDir.x + this._lookDir.z * this._lookDir.z),
    );

    const maxH = THREE.MathUtils.degToRad(this.config.maxHorizontalDeg);
    const maxV = THREE.MathUtils.degToRad(this.config.maxVerticalDeg);

    const clampedH = THREE.MathUtils.clamp(hAngle, -maxH, maxH);
    const clampedV = THREE.MathUtils.clamp(vAngle, -maxV, maxV);

    // Build clamped direction vector
    this._clampedDir.set(
      Math.sin(clampedH) * Math.cos(clampedV),
      Math.sin(clampedV),
      -Math.cos(clampedH) * Math.cos(clampedV),
    ).normalize();

    // Build desired world orientation: rotate local X to point along clampedDir
    this._desiredWorldQ.setFromUnitVectors(new THREE.Vector3(1, 0, 0), this._clampedDir);

    // Convert to local space using proven math: localDelta = desiredLocal × bindLocal⁻¹
    this._desiredLocalQ.copy(parentWorldQ).invert().multiply(this._desiredWorldQ);
    this._localDelta.copy(this._desiredLocalQ).multiply(bindLocalQ.clone().invert());
    this._finalLocalQ.copy(this._localDelta).multiply(bindLocalQ);

    eyeBone.quaternion.copy(this._finalLocalQ);
  }

  /**
   * Compute a bone's parent world quaternion by traversing up the hierarchy.
   */
  private computeParentWorldQ(bone: THREE.Object3D): THREE.Quaternion {
    const q = new THREE.Quaternion();
    const chain: THREE.Object3D[] = [];
    let current: THREE.Object3D | null = bone.parent;
    while (current) {
      chain.unshift(current);
      current = current.parent;
    }
    for (const b of chain) {
      q.multiply(b.quaternion);
    }
    return q;
  }

  /**
   * Log bind pose info for debugging.
   */
  private logBindPose(): void {
    if (this.diagLogged) return;
    this.diagLogged = true;

    const logBone = (label: string, bone: THREE.Object3D) => {
      const lq = bone.quaternion;
      console.log(`[EyeTracker] ${label} "${bone.name}" bindLocalQ=(${lq.x.toFixed(4)}, ${lq.y.toFixed(4)}, ${lq.z.toFixed(4)}, ${lq.w.toFixed(4)})`);
      const pos = new THREE.Vector3();
      bone.getWorldPosition(pos);
      console.log(`[EyeTracker] ${label} worldPos=(${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`);
    };

    if (this.leftEye) logBone('L', this.leftEye);
    if (this.rightEye) logBone('R', this.rightEye);
  }

  /**
   * Check if eye tracking is available.
   */
  isAvailable(): boolean {
    return this.leftEye !== null && this.rightEye !== null;
  }
}
