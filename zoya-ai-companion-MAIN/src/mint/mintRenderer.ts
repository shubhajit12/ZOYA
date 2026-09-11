import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EmotionType, AnimationIntent } from '../types';
import { audioAnalyser } from '../voice/audioAnalyser';
import { LoadedMintModel, mintFbxService } from './fbxLoader';
import { carlottaVrmLoader, LoadedCarlottaModel } from './carlottaVrmLoader';
import { applyCarlottaRelaxedPose } from './carlottaIdleController';
import { carlottaAnimationController } from './carlottaAnimationController';
import { carlottaGestureController } from './carlottaGestureController';
import { dispatchSkillIntent, registerSkillDevHooks } from './carlottaSkillSystem';
import { carlottaExpressionController } from './carlottaExpressionController';
import { carlottaLipSync } from './carlottaLipSync';
import { applyCarlottaTextureQuality } from './carlottaTextureQuality';
import { isDevBuild } from './runtimeEnv';
import {
  QUALITY_PROFILES,
  FramePacer,
  resolveEffectiveQuality,
  type EffectivePerformanceQuality,
  type PerformanceQualitySetting,
  type QualityProfile,
} from './performanceQuality';
import { createProceduralMint, ProceduralMintRig } from './proceduralMint';
import { MintAnimationController } from './animation/animationController';
import { EyeTracker } from './eyeTracking';
import { LipSyncController } from './lipSyncController';

const MINT_FBX_URL = '/mint/Mint.fbx';
const CARLOTTA_VRM_URL = '/mint/Carlotta.vrm';

// Phase 3: model selection. 'carlotta' is the default production character;
// 'mint' remains available as a fallback (FBX upload path + auto-load fallback).
export type ActiveModelId = 'carlotta' | 'mint';
const DEFAULT_MODEL: ActiveModelId = 'carlotta';

export class MintRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;
  private animationFrameId: number | null = null;
  private clock = new THREE.Clock();

  private proceduralAvatar: ProceduralMintRig | null = null;
  private fbxAvatar: LoadedMintModel | null = null;
  private vrmAvatar: LoadedCarlottaModel | null = null;
  private activeModelGroup: THREE.Group | null = null;
  private activeModelId: ActiveModelId | null = null;
  private isFbxLoaded = false;
  private isVrmLoaded = false;
  private vrmLoadPromise: Promise<boolean> | null = null;

  private currentEmotion: EmotionType = 'neutral';
  private currentEmotionIntensity: number = 0.45;

  // NEW: Procedural animation controller
  private animController = new MintAnimationController();

  // Eye tracking
  private eyeTracker: EyeTracker | null = null;

  // Lip-sync hysteresis + minimum hold
  private _lipsyncSpeaking = false;
  private _speakingHoldTimer = 0; // keeps isSpeaking=true for min duration after last trigger
  // Last App-level TTS speaking flag (forwarded to VRM lip-sync diagnostics).
  private appSpeaking = false;

  // Lip sync
  private lipSync: LipSyncController | null = null;

  // Mouse position for eye tracking
  private mouseX = 0;
  private mouseY = 0;
  private mouseOnCanvas = false;

  // Diagnostics timer (FBX path only — VRM path does not use this)
  private diagTimer = 0;

  // Performance quality (Settings → Performance → Quality).
  // pixelRatioCap is always enforced; antialias is fixed at renderer creation.
  private pixelRatioCap = QUALITY_PROFILES.high.pixelRatioCap;
  private appliedAntialias = true;
  private effectiveQuality: EffectivePerformanceQuality = 'high';
  // Tiered frame pacing (render + update skip) + DEV perf readout state.
  private framePacer = new FramePacer();
  private perfFpsEma = 60;
  private perfFrameMsEma = 16.7;

  // ── Spring-bone throttle ──────────────────────────────────────────────────
  // Accumulates real time between spring-bone updates. When springBoneUpdateFps
  // is 0 (High/Medium) this accumulator is never checked and vrm.update() fires
  // every rendered frame. On Low (20 Hz target) it fires every 50 ms regardless
  // of render rate. The accumulated dt is passed so motion stays correct.
  private sbAcc = 0;
  private springBoneUpdateFps = 0; // 0 = uncapped (matches profile field)

  // ── DEV-only split timing & Frame Scheduling Diagnostics ──────────────────
  // EMA accumulators for per-system JS cost (ms). Only computed in DEV builds;
  // all writes are gated by isDevBuild(). Read by getPerfStats().
  private devVrmMs = 0;    // vrm.update() (spring-bone + expression damping)
  private devAnimMs = 0;   // carlottaAnimationController.update()
  private devGestMs = 0;   // carlottaGestureController.update()
  private devExprMs = 0;   // carlottaExpressionController.update()
  private devLipMs = 0;    // carlottaLipSync.update()
  private devRenderMs = 0; // renderer.render()
  private devUpdateMs = 0; // all CPU updates combined (excludes render)

  // Scheduling diagnostics (ms)
  private devRafIntervalMs = 16.7;
  private devTimeBeforeUpdateMs = 0;
  private devTimeAfterRenderMs = 0;
  private devTotalFrameIntervalMs = 16.7;
  private devMissedFrames = 0;
  private lastRafTimestamp = 0;
  private lastFrameEndTimestamp = 0;

  // WebGL disjoint timer query (GPU timing)
  private gpuTimerQueryExt: any = null;
  private gpuTimerQuery: any = null;
  private devGpuTimeMs = -1; // -1 if unsupported or pending
  private gpuTimerSupported = false;

  // ── Cached drawing-buffer size ────────────────────────────────────────────
  // Reused in getPerfStats() to avoid a `new THREE.Vector2()` per 2Hz call.
  private _dbSize = new THREE.Vector2();

  constructor() {
    this.scene = new THREE.Scene();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambientLight);
    const mainLight = new THREE.DirectionalLight(0xfff5ea, 1.4);
    mainLight.position.set(2, 4, 3);
    this.scene.add(mainLight);
    const fillLight = new THREE.DirectionalLight(0x90e0ef, 0.6);
    fillLight.position.set(-3, 1, -2);
    this.scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0x4be3c1, 0.35);
    rimLight.position.set(0, 3, -4);
    this.scene.add(rimLight);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 0.5, 4.5);

    this.initProceduralAvatar();
  }

  private initProceduralAvatar() {
    if (this.activeModelGroup) this.scene.remove(this.activeModelGroup);
    this.proceduralAvatar = createProceduralMint();
    this.activeModelGroup = this.proceduralAvatar.group;
    this.scene.add(this.activeModelGroup);
  }

  /**
   * Phase 3: load Carlotta (VRM) through the isolated VRM loader.
   * Uses the existing scene/camera/controls; only swaps the model group.
   * No lip-sync, emotion, eye-tracking, or procedural wiring in this phase.
   * Mint fallback remains available via autoLoadFbx()/loadFbxModel().
   */
  public autoLoadCarlotta(): Promise<boolean> {
    // Avoid duplicate concurrent VRM loads.
    if (this.vrmLoadPromise) return this.vrmLoadPromise;
    this.vrmLoadPromise = this.loadCarlottaFromUrl(CARLOTTA_VRM_URL).finally(() => {
      this.vrmLoadPromise = null;
    });
    return this.vrmLoadPromise;
  }

  public async loadCarlottaFromUrl(url: string): Promise<boolean> {
    try {
      const loaded = await carlottaVrmLoader.loadVRMFromUrl(url);
      this.replaceActiveModel(loaded.vrm.scene);
      // Dispose previous VRM resources only after the new scene is in place.
      if (this.vrmAvatar) carlottaVrmLoader.dispose(this.vrmAvatar);
      this.vrmAvatar = loaded;
      this.fbxAvatar = null;
      this.proceduralAvatar = null;
      this.activeModelId = 'carlotta';
      this.isVrmLoaded = true;
      this.isFbxLoaded = false;
      // Relaxed standing pose FIRST (normalized humanoid pose), propagate it
      // to raw bones once, THEN capture it as the idle base. Order matters.
      applyCarlottaRelaxedPose(loaded.vrm);
      loaded.vrm.update(0);
      // Sole owner of Carlotta upper-body animation bones (resolved + logged inside).
      carlottaAnimationController.init(loaded.vrm);
      // Gesture layer: arm/hand bones (+ torso via body yield for bow only).
      carlottaGestureController.init(loaded.vrm);
      // Bind the single VRM lip-sync to this model's expression manager.
      carlottaLipSync.bind(loaded.vrm);
      // Bind facial-expression follower (reads body emotion state only).
      carlottaExpressionController.init(loaded.vrm);
      console.log('[CarloPose] idle base captured after relaxed pose');
      // Apply the current texture tier to the fresh full-resolution textures.
      applyCarlottaTextureQuality(loaded.vrm, this.effectiveQuality);
      console.log('[MintRenderer] Carlotta VRM active (Mint fallback available)');
      return true;
    } catch (err) {
      console.warn('[MintRenderer] Carlotta VRM auto-load failed:', err);
      return false;
    }
  }

  /** Swap the rendered model group. Camera/controls/lights are untouched. */
  private replaceActiveModel(group: THREE.Group) {
    if (this.activeModelGroup) this.scene.remove(this.activeModelGroup);
    this.activeModelGroup = group;
    this.scene.add(this.activeModelGroup);
  }

  public async autoLoadFbx(): Promise<boolean> {
    try {
      const loaded = await mintFbxService.loadFBXFromUrl(MINT_FBX_URL);
      if (this.activeModelGroup) this.scene.remove(this.activeModelGroup);
      this.fbxAvatar = loaded;
      this.proceduralAvatar = null;
      this.activeModelGroup = loaded.group;
      this.scene.add(this.activeModelGroup);
      this.isFbxLoaded = true;

      // Discover skeleton bones for the NEW animation controller
      this.animController.discoverBones(loaded.group);

      // Initialize eye tracking
      this.initEyeTracking();

      // Initialize lip sync (singleton — always same instance)
      this.lipSync = LipSyncController.getOrCreate();
      this.lipSync.init(loaded.morphTargets);
      if (this.lipSync.getMode() === 'none') {
        this.lipSync.initBones(this.animController.getBoneMap());
      }
      console.log(`[MintRenderer] Lip sync mode: ${this.lipSync.getMode()}`);

      return true;
    } catch (err) {
      console.warn('[MintRenderer] FBX auto-load failed:', err);
      return false;
    }
  }

  public mount(container: HTMLDivElement, qualitySetting: PerformanceQualitySetting = 'auto'): boolean {
    const width = container.clientWidth || 400;
    const height = container.clientHeight || 500;
    try {
      // Resolve the effective tier BEFORE renderer creation so antialiasing
      // (creation-time only) already matches the selected quality profile.
      this.effectiveQuality = resolveEffectiveQuality(qualitySetting);
      const profile: QualityProfile = QUALITY_PROFILES[this.effectiveQuality];
      this.pixelRatioCap = profile.pixelRatioCap;
      this.appliedAntialias = profile.antialias;
      this.framePacer.setTargetFps(profile.targetFps);
      this.springBoneUpdateFps = profile.springBoneUpdateFps;
      this.sbAcc = 0;
      this.renderer = new THREE.WebGLRenderer({ antialias: profile.antialias, alpha: true, powerPreference: 'high-performance' });
      const dom = this.renderer.domElement;
      dom.style.position = 'absolute';
      dom.style.top = '0';
      dom.style.left = '0';
      dom.style.width = '100%';
      dom.style.height = '100%';
      this.renderer.setPixelRatio(
        Math.min(window.devicePixelRatio || 1, this.pixelRatioCap)
      );
      this.renderer.setSize(width, height);
      // No shadow casters exist in the Carlotta path; keep shadow work off.
      this.renderer.shadowMap.enabled = profile.shadowsEnabled;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.logQualityBaseline('mount', qualitySetting);
      container.appendChild(dom);

      // Probe for EXT_disjoint_timer_query_webgl2 in DEV builds
      if (isDevBuild()) {
        try {
          const gl = this.renderer.getContext();
          this.gpuTimerQueryExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') || gl.getExtension('EXT_disjoint_timer_query');
          this.gpuTimerSupported = !!this.gpuTimerQueryExt;
          if (this.gpuTimerSupported) {
            console.info('[ZoyaPerf] WebGL GPU Timer Query supported and enabled');
          } else {
            console.info('[ZoyaPerf] WebGL GPU Timer Query (EXT_disjoint_timer_query) not supported on this device/browser');
          }
        } catch {
          this.gpuTimerSupported = false;
        }
      }

      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();

      this.controls = new OrbitControls(this.camera, dom);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      // Single navigation owner: OrbitControls handles orbit, pan, AND zoom.
      // LEFT = orbit, RIGHT = pan, wheel = native cursor-centered dolly.
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      this.controls.enablePan = true; // right-drag pans camera + target together
      this.controls.enableRotate = true;
      this.controls.enableZoom = true; // native wheel dolly (with zoomToCursor)
      this.controls.zoomToCursor = true; // wheel zooms toward the cursor point
      this.controls.screenSpacePanning = true; // pan in the screen plane
      this.controls.rotateSpeed = 0.8;
      this.controls.minDistance = 0.5;
      this.controls.maxDistance = 12.0;
      this.controls.minPolarAngle = Math.PI * 0.1;
      this.controls.maxPolarAngle = Math.PI * 0.85;
      this.controls.target.set(0, 0.3, 0);
      this.controls.update();

      this.startRenderLoop();
      // Default production character is Carlotta; Mint remains as fallback.
      // mount() stays synchronous so callers can detect WebGL failure.
      if (DEFAULT_MODEL === 'carlotta') {
        this.autoLoadCarlotta().then((ok) => {
          if (!ok) this.autoLoadFbx();
        });
      } else {
        this.autoLoadFbx();
      }
      return true;
    } catch (err: any) {
      this.renderer = null;
      return false;
    }
  }

  public unmount() {
    if (this.animationFrameId) { cancelAnimationFrame(this.animationFrameId); this.animationFrameId = null; }
    // Release Carlotta CPU/GPU resources (46MB VRM + uploaded textures) so
    // quality-switch remounts and teardown do not leak them. Mirrors the
    // model-switch path in loadFbxModel; the instance is discarded afterwards.
    if (this.vrmAvatar) {
      carlottaAnimationController.reset();
      carlottaGestureController.reset();
      carlottaExpressionController.reset();
      carlottaLipSync.reset();
      carlottaVrmLoader.dispose(this.vrmAvatar);
      this.vrmAvatar = null;
      this.isVrmLoaded = false;
    }
    if (this.controls) { this.controls.dispose(); this.controls = null; }
    if (this.renderer) { this.renderer.domElement.remove(); this.renderer.dispose(); this.renderer = null; }
  }

  public resize(width: number, height: number) {
    if (!this.renderer || width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Never restore an uncapped devicePixelRatio on resize.
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.pixelRatioCap)
    );
    this.renderer.setSize(width, height);
  }

  /** Effective quality tier currently backing this renderer. */
  public getEffectiveQuality(): EffectivePerformanceQuality {
    return this.effectiveQuality;
  }

  /** Antialias flag the live WebGLRenderer was created with. */
  public getAppliedAntialias(): boolean {
    return this.appliedAntialias;
  }

  /**
   * Live-apply the safe subset of a quality profile (pixel ratio + shadows +
   * texture resolution). Antialiasing is creation-time only and is
   * intentionally NOT touched here; callers must recreate the renderer when
   * the antialias flag changes.
   */
  public applyRenderQuality(profile: QualityProfile, effective: EffectivePerformanceQuality): void {
    this.effectiveQuality = effective;
    this.pixelRatioCap = profile.pixelRatioCap;
    this.framePacer.setTargetFps(profile.targetFps);
    this.springBoneUpdateFps = profile.springBoneUpdateFps;
    this.sbAcc = 0; // reset accumulator on quality change to avoid stale carry
    if (!this.renderer) return;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.pixelRatioCap)
    );
    this.renderer.shadowMap.enabled = profile.shadowsEnabled;
    if (this.vrmAvatar) {
      applyCarlottaTextureQuality(this.vrmAvatar.vrm, effective);
    }
    this.logQualityBaseline('apply', 'manual');
  }

  /**
   * Development-only one-time GPU baseline (pixel ratio, drawing buffer,
   * tier). Never runs per frame; silent in production builds.
   */
  private logQualityBaseline(phase: 'mount' | 'apply', setting: PerformanceQualitySetting | 'manual'): void {
    if (!isDevBuild() || !this.renderer) return;
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    console.info(
      `[ZoyaQuality] ${phase} setting=${setting} tier=${this.effectiveQuality} ` +
      `pixelRatio=${this.renderer.getPixelRatio()} ` +
      `drawingBuffer=${size.x}x${size.y} ` +
      `antialias=${this.appliedAntialias} shadows=${this.renderer.shadowMap.enabled}`
    );
  }

  public async loadFbxModel(file: File): Promise<boolean> {
    try {
      const loaded = await mintFbxService.loadFbxFromFile(file);
      if (this.vrmAvatar) {
        if (this.activeModelGroup === this.vrmAvatar.vrm.scene) {
          this.scene.remove(this.activeModelGroup);
        }
        carlottaAnimationController.reset();
        carlottaGestureController.reset();
        carlottaExpressionController.reset();
        carlottaLipSync.reset();
        carlottaVrmLoader.dispose(this.vrmAvatar);
        this.vrmAvatar = null;
        this.isVrmLoaded = false;
      }
      if (this.activeModelGroup) this.scene.remove(this.activeModelGroup);
      this.fbxAvatar = loaded;
      this.proceduralAvatar = null;
      this.activeModelId = 'mint';
      this.activeModelGroup = loaded.group;
      this.scene.add(this.activeModelGroup);
      this.isFbxLoaded = true;
      this.animController.discoverBones(loaded.group);
      this.initEyeTracking();

      // Initialize lip sync (singleton — always same instance)
      this.lipSync = LipSyncController.getOrCreate();
      this.lipSync.init(loaded.morphTargets);
      if (this.lipSync.getMode() === 'none') {
        this.lipSync.initBones(this.animController.getBoneMap());
      }
      console.log(`[MintRenderer] Lip sync mode: ${this.lipSync.getMode()}`);

      return true;
    } catch { return false; }
  }

  public getIsFbxLoaded() { return this.isFbxLoaded; }
  public getIsVrmLoaded() { return this.isVrmLoaded; }
  public getActiveModelId(): ActiveModelId | null { return this.activeModelId; }
  public getActiveAvatarType() {
    if (this.vrmAvatar) return 'Carlotta (VRM)';
    if (this.fbxAvatar) return 'Mint.fbx (Game Model)';
    if (this.proceduralAvatar) return 'Procedural Mint';
    return 'None';
  }
  public setEmotion(emotion: EmotionType, intensity: number = 0.5) {
    this.currentEmotion = emotion;
    this.currentEmotionIntensity = intensity;
    // Pass emotion to the animation controller
    this.animController.setEmotion(emotion, intensity);
  }

  /**
   * Set the animation intent driven by conversation context.
   * Called from App.tsx when Groq provides an animation intent.
   * Mint path goes to the legacy animController (unchanged); Carlotta path
   * resolves through the skill system, which activates only procedurally
   * supported intents and safely ignores the rest.
   */
  public setAnimationIntent(intent: AnimationIntent) {
    this.animController.setIntent(intent);
    registerSkillDevHooks();
    dispatchSkillIntent(intent);
  }

  /**
   * Set the speaking state for talking animation.
   * Called from MintCanvas when voice state changes. Mint path goes to the
   * legacy animController; Carlotta path nudges idle↔talking only (never
   * overrides listening/thinking and never touches emotion).
   */
  public setSpeaking(isSpeaking: boolean) {
    this.animController.setSpeaking(isSpeaking);
    this.appSpeaking = isSpeaking;
    const current = carlottaAnimationController.getState();
    if (isSpeaking && current === 'idle') {
      carlottaAnimationController.setState('talking');
    } else if (!isSpeaking && current === 'talking') {
      carlottaAnimationController.setState('idle');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  EYE TRACKING
  // ═══════════════════════════════════════════════════════════════

  private initEyeTracking(): void {
    if (!this.renderer) return;
    const canvas = this.renderer.domElement;

    this.eyeTracker = new EyeTracker(this.camera);
    this.eyeTracker.init(this.animController.getBoneMap());

    // Track mouse position over the canvas
    canvas.addEventListener('mousemove', (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
    });

    canvas.addEventListener('mouseenter', () => {
      this.mouseOnCanvas = true;
    });

    canvas.addEventListener('mouseleave', () => {
      this.mouseOnCanvas = false;
      // Reset to center when mouse leaves — eyes return to neutral
      const rect = canvas.getBoundingClientRect();
      this.mouseX = rect.width / 2;
      this.mouseY = rect.height / 2;
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  RENDER LOOP
  // ═══════════════════════════════════════════════════════════════

  private startRenderLoop = () => {
    const loop = (rafTimestamp: number) => {
      // ── Frame scheduling measurements (DEV only) ──────────────────────────
      let tLoopStart = 0;
      if (isDevBuild()) {
        tLoopStart = performance.now();
        if (this.lastRafTimestamp > 0) {
          const rafDiff = rafTimestamp - this.lastRafTimestamp;
          if (rafDiff > 0 && rafDiff < 500) {
            this.devRafIntervalMs += (rafDiff - this.devRafIntervalMs) * 0.05;
          }
        }
        this.lastRafTimestamp = rafTimestamp;

        // Total frame interval (end of last frame -> start of this frame)
        if (this.lastFrameEndTimestamp > 0) {
          const totalDiff = tLoopStart - this.lastFrameEndTimestamp;
          if (totalDiff > 0 && totalDiff < 500) {
            this.devTotalFrameIntervalMs += (totalDiff - this.devTotalFrameIntervalMs) * 0.05;
          }
        }
      }

      const rawDelta = this.clock.getDelta();
      // Tiered frame pacing: on capped tiers, skip whole frames (updates +
      // render) and advance by accumulated dt so motion stays correct.
      // Controls stay usable: they update on rendered frames (30fps on LOW).
      const pacing = this.framePacer.accumulate(rawDelta);
      if (!pacing.render) {
        if (isDevBuild()) {
          this.lastFrameEndTimestamp = performance.now();
        }
        this.animationFrameId = requestAnimationFrame(loop);
        return;
      }
      const frameStart = performance.now();
      if (isDevBuild()) {
        // Time elapsed between rAF firing and actual update initiation
        const timeBeforeUpdate = frameStart - tLoopStart;
        this.devTimeBeforeUpdateMs += (timeBeforeUpdate - this.devTimeBeforeUpdateMs) * 0.05;
      }
      const delta = pacing.dt;
      if (this.controls) this.controls.update();
      const viseme = audioAnalyser.getVisemeFrame();

      if (this.proceduralAvatar) {
        this.proceduralAvatar.updateExpression(this.currentEmotion, this.currentEmotionIntensity, viseme, delta);
      } else if (this.vrmAvatar) {
        // ── Carlotta VRM update path ─────────────────────────────────────────
        //
        // Order is significant:
        //  1. lip-sync writes 'aa' weight
        //  2. expression controller writes emotion weights
        //  3. vrm.update() applies those weights + runs spring-bone physics
        //  4. animation controller writes upper-body bone rotations (post-VRM)

        // ─ 1. Lip-sync ─────────────────────────────────────────────────────
        const t0 = isDevBuild() ? performance.now() : 0;
        carlottaLipSync.update(viseme, delta, this.appSpeaking);
        const t1 = isDevBuild() ? performance.now() : 0;

        // ─ 2. Expression controller ────────────────────────────────────────
        carlottaExpressionController.update(delta);
        const t2 = isDevBuild() ? performance.now() : 0;

        // ─ 3. VRM update (spring-bone + lookAt + expression damping) ───────
        let didUpdateVrm = false;
        if (this.springBoneUpdateFps <= 0) {
          carlottaVrmLoader.update(this.vrmAvatar, delta);
          didUpdateVrm = true;
        } else {
          const sbInterval = 1 / this.springBoneUpdateFps;
          this.sbAcc += delta;
          if (this.sbAcc >= sbInterval) {
            const sbDt = Math.min(this.sbAcc, sbInterval * 4);
            this.sbAcc -= sbDt;
            if (this.sbAcc > sbInterval * 4) this.sbAcc = 0;
            carlottaVrmLoader.update(this.vrmAvatar, sbDt);
            didUpdateVrm = true;
          }
        }
        const t3 = isDevBuild() ? performance.now() : 0;

        // ─ 4. Animation controller ─────────────────────────────────────────
        carlottaAnimationController.update(delta);
        const t4 = isDevBuild() ? performance.now() : 0;

        // ─ 5. Gesture layer (arms; torso only while yielded by body) ────────
        carlottaGestureController.update(delta);
        const t5 = isDevBuild() ? performance.now() : 0;

        // ─ DEV split timing EMA ────────────────────────────────────────────
        if (isDevBuild()) {
          const EMA = 0.05;
          this.devLipMs  += ((t1 - t0) - this.devLipMs)  * EMA;
          this.devExprMs += ((t2 - t1) - this.devExprMs) * EMA;
          if (didUpdateVrm) {
            this.devVrmMs += ((t3 - t2) - this.devVrmMs) * EMA;
          }
          this.devAnimMs += ((t4 - t3) - this.devAnimMs) * EMA;
          this.devGestMs += ((t5 - t4) - this.devGestMs) * EMA;
          this.devUpdateMs += ((t5 - t0) - this.devUpdateMs) * EMA;
        }

      } else if (this.fbxAvatar) {
        const MIN_SPEAKING_HOLD = 1.0;
        const rawDetected = viseme.mouthOpen > 0.02;
        if (rawDetected) {
          this._lipsyncSpeaking = true;
          this._speakingHoldTimer = MIN_SPEAKING_HOLD;
        } else if (this._speakingHoldTimer > 0) {
          this._speakingHoldTimer -= delta;
          this._lipsyncSpeaking = true;
        } else {
          this._lipsyncSpeaking = false;
        }
        const isSpeaking = this._lipsyncSpeaking;
        this.animController.setSpeaking(isSpeaking);
        this.animController.update(delta);

        if (this.lipSync) {
          this.lipSync.update(viseme, delta, isSpeaking);
        }

        const intensity = Math.min(Math.max(this.currentEmotionIntensity, 0.1), 1.0);
        const emotion = this.currentEmotion;
        const lerpFactor = Math.min(delta * 8.0, 0.35);

        this.fbxAvatar.morphTargets.forEach(({ mesh, dictionary }) => {
          if (!mesh.morphTargetInfluences) return;
          Object.keys(dictionary).forEach((key) => {
            const idx = dictionary[key];
            const lk = key.toLowerCase();
            let tw = 0;

            if (emotion === 'happy' || emotion === 'excited' || emotion === 'amused' || emotion === 'playful') {
              if (lk.includes('joy') || lk.includes('happy') || lk.includes('smile') || lk.includes('fun') || lk.includes('cheerful')) tw = Math.max(tw, 0.85 * intensity);
              if (lk.includes('eyesquint') || lk.includes('eyeblink') || lk.includes('eye_smile')) tw = Math.max(tw, 0.35 * intensity);
            } else if (emotion === 'sad' || emotion === 'concerned') {
              if (lk.includes('sorrow') || lk.includes('sad') || lk.includes('frown') || lk.includes('cry') || lk.includes('grief')) tw = Math.max(tw, 0.8 * intensity);
              if (lk.includes('browdown') || lk.includes('browinnerup')) tw = Math.max(tw, 0.7 * intensity);
            } else if (emotion === 'angry') {
              if (lk.includes('angry') || lk.includes('anger') || lk.includes('rage') || lk.includes('fury')) tw = Math.max(tw, 0.85 * intensity);
              if (lk.includes('browdown')) tw = Math.max(tw, 0.75 * intensity);
            } else if (emotion === 'surprised') {
              if (lk.includes('surprise') || lk.includes('surprised') || lk.includes('shock') || lk.includes('astounded')) tw = Math.max(tw, 0.9 * intensity);
              if (lk.includes('eyewide') || lk.includes('browup') || lk.includes('eye_wide')) tw = Math.max(tw, 0.8 * intensity);
            } else if (emotion === 'shy' || emotion === 'embarrassed' || emotion === 'affectionate') {
              if (lk.includes('blush') || lk.includes('shy') || lk.includes('embarrassed') || lk.includes('redcheek')) tw = Math.max(tw, 0.9 * intensity);
              if (lk.includes('smile') || lk.includes('joy')) tw = Math.max(tw, 0.5 * intensity);
            }

            if (tw > 0) {
              const cw = mesh.morphTargetInfluences[idx] || 0;
              mesh.morphTargetInfluences[idx] = THREE.MathUtils.lerp(cw, tw, lerpFactor);
            }
          });
        });

        if (this.eyeTracker && this.renderer) {
          const rect = this.renderer.domElement.getBoundingClientRect();
          this.eyeTracker.update(
            delta,
            this.mouseX,
            this.mouseY,
            rect.width,
            rect.height,
          );
        }

        this.diagTimer += delta;
        if (this.diagTimer > 5.0) {
          this.diagTimer = 0;
          if (this.activeModelGroup) {
            this.animController.runDiagnostics();
            this.animController.checkWorldTransform(this.activeModelGroup);
          }
        }
      }

      // ─ Render (with optional GPU timer query if supported) ────────────────
      const tRenderStart = isDevBuild() ? performance.now() : 0;
      let glContext: any = null;
      if (isDevBuild() && this.gpuTimerSupported && this.renderer) {
        try {
          glContext = this.renderer.getContext();
          const ext = this.gpuTimerQueryExt;
          // Check previous query result if available
          if (this.gpuTimerQuery) {
            const available = glContext.getQueryParameter(this.gpuTimerQuery, glContext.QUERY_RESULT_AVAILABLE);
            const disjoint = glContext.getParameter(ext.GPU_DISJOINT_EXT);
            if (available && !disjoint) {
              const timeElapsedNano = glContext.getQueryParameter(this.gpuTimerQuery, glContext.QUERY_RESULT);
              this.devGpuTimeMs = timeElapsedNano / 1000000;
            }
          }
          // Start query for current render pass
          if (!this.gpuTimerQuery) {
            this.gpuTimerQuery = glContext.createQuery();
          }
          if (this.gpuTimerQuery) {
            glContext.beginQuery(ext.TIME_ELAPSED_EXT, this.gpuTimerQuery);
          }
        } catch {
          this.gpuTimerSupported = false;
        }
      }

      if (this.renderer) {
        try { this.renderer.render(this.scene, this.camera); } catch {}
      }

      if (isDevBuild() && this.gpuTimerSupported && glContext && this.gpuTimerQuery) {
        try {
          const ext = this.gpuTimerQueryExt;
          glContext.endQuery(ext.TIME_ELAPSED_EXT);
        } catch {}
      }

      const tRenderEnd = isDevBuild() ? performance.now() : 0;
      if (isDevBuild()) {
        this.devRenderMs += ((tRenderEnd - tRenderStart) - this.devRenderMs) * 0.05;
      }

      // DEV perf readout state (EMA over rendered frames only).
      const frameMs = performance.now() - frameStart;
      this.perfFrameMsEma += (frameMs - this.perfFrameMsEma) * 0.05;
      if (delta > 0.0001) {
        this.perfFpsEma += (1 / delta - this.perfFpsEma) * 0.05;
      }

      if (isDevBuild()) {
        const tFrameFinish = performance.now();
        const timeAfterRender = tFrameFinish - tRenderEnd;
        this.devTimeAfterRenderMs += (timeAfterRender - this.devTimeAfterRenderMs) * 0.05;
        this.lastFrameEndTimestamp = tFrameFinish;

        // Missed frame check: if expected interval at target FPS is exceeded by >50%
        const targetFps = this.framePacer.getTargetFps() || 60;
        const expectedIntervalMs = 1000 / targetFps;
        if (frameMs > expectedIntervalMs * 1.5) {
          this.devMissedFrames++;
        }
      }

      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  };

  /**
   * Snapshot for the DEV-only performance readout. renderer.info reflects
   * the last rendered frame. CPU frame time is measured JS cost, NOT GPU
   * utilization (the browser exposes no GPU-time API here).
   *
   * Split timing fields (vrmMs, animMs, etc.) are only non-zero in DEV builds;
   * in production the EMA accumulators are never written so they stay at 0.
   */
  public getPerfStats(): {
    tier: EffectivePerformanceQuality;
    targetFps: number;
    springBoneUpdateFps: number;
    fps: number;
    frameMs: number;
    pixelRatio: number;
    devicePixelRatio: number;
    canvasWidth: number;
    canvasHeight: number;
    drawingBufferWidth: number;
    drawingBufferHeight: number;
    drawCalls: number;
    triangles: number;
    geometries: number;
    textures: number;
    programs: number;
    // DEV split timing (ms, EMA). Zero in production builds.
    vrmMs: number;
    animMs: number;
    gestMs: number;
    exprMs: number;
    lipMs: number;
    renderMs: number;
    updateMs: number;
    // DEV frame scheduling diagnostics
    rafIntervalMs: number;
    timeBeforeUpdateMs: number;
    timeAfterRenderMs: number;
    totalFrameIntervalMs: number;
    missedFrames: number;
    gpuTimeMs: number;
    gpuTimerSupported: boolean;
  } {
    const info = this.renderer?.info;
    if (this.renderer) this.renderer.getDrawingBufferSize(this._dbSize);
    const dom = this.renderer?.domElement;
    return {
      tier: this.effectiveQuality,
      targetFps: this.framePacer.getTargetFps(),
      springBoneUpdateFps: this.springBoneUpdateFps,
      fps: Math.round(this.perfFpsEma * 10) / 10,
      frameMs: Math.round(this.perfFrameMsEma * 100) / 100,
      pixelRatio: this.renderer ? this.renderer.getPixelRatio() : 0,
      devicePixelRatio: typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1,
      canvasWidth: dom ? dom.clientWidth : 0,
      canvasHeight: dom ? dom.clientHeight : 0,
      drawingBufferWidth: this._dbSize.x,
      drawingBufferHeight: this._dbSize.y,
      drawCalls: info ? info.render.calls : 0,
      triangles: info ? info.render.triangles : 0,
      geometries: info ? info.memory.geometries : 0,
      textures: info ? info.memory.textures : 0,
      programs: info ? info.programs.length : 0,
      vrmMs:    Math.round(this.devVrmMs    * 1000) / 1000,
      animMs:   Math.round(this.devAnimMs   * 1000) / 1000,
      gestMs:   Math.round(this.devGestMs   * 1000) / 1000,
      exprMs:   Math.round(this.devExprMs   * 1000) / 1000,
      lipMs:    Math.round(this.devLipMs    * 1000) / 1000,
      renderMs: Math.round(this.devRenderMs * 1000) / 1000,
      updateMs: Math.round(this.devUpdateMs * 1000) / 1000,
      rafIntervalMs: Math.round(this.devRafIntervalMs * 100) / 100,
      timeBeforeUpdateMs: Math.round(this.devTimeBeforeUpdateMs * 1000) / 1000,
      timeAfterRenderMs: Math.round(this.devTimeAfterRenderMs * 1000) / 1000,
      totalFrameIntervalMs: Math.round(this.devTotalFrameIntervalMs * 100) / 100,
      missedFrames: this.devMissedFrames,
      gpuTimeMs: Math.round(this.devGpuTimeMs * 100) / 100,
      gpuTimerSupported: this.gpuTimerSupported,
    };
  }
}
