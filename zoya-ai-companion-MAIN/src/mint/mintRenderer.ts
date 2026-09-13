import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EmotionType, AnimationIntent } from '../types';
import { audioAnalyser } from '../voice/audioAnalyser';
import { LoadedMintModel, mintFbxService } from './fbxLoader';
import { carlottaVrmLoader, LoadedCarlottaModel } from './carlottaVrmLoader';
import { applyCarlottaRelaxedPose } from './carlottaIdleController';
import { carlottaAnimationController } from './carlottaAnimationController';
import { carlottaGestureController } from './carlottaGestureController';
import { carlottaCompanionController } from './carlottaCompanionController';
import { dispatchSkillIntent, registerSkillDevHooks } from './carlottaSkillSystem';
import { carlottaExpressionController } from './carlottaExpressionController';
import { carlottaLipSync } from './carlottaLipSync';
import { applyCarlottaTextureQuality } from './carlottaTextureQuality';
import { isDevBuild } from './runtimeEnv';
import { QUALITY_PROFILES, FramePacer, resolveEffectiveQuality, type EffectivePerformanceQuality, type PerformanceQualitySetting, type QualityProfile } from './performanceQuality';
import { createProceduralMint, ProceduralMintRig } from './proceduralMint';
import { MintAnimationController } from './animation/animationController';
import { EyeTracker } from './eyeTracking';
import { LipSyncController } from './lipSyncController';

const MINT_FBX_URL = '/mint/Mint.fbx';
const CARLOTTA_VRM_URL = '/mint/Carlotta.vrm';
export type ActiveModelId = 'carlotta' | 'mint';
const DEFAULT_MODEL: ActiveModelId = 'carlotta';

const COMPANION_MODEL_Y_OFFSET = -1.7;

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
  private animController = new MintAnimationController();
  private eyeTracker: EyeTracker | null = null;
  private _lipsyncSpeaking = false;
  private _speakingHoldTimer = 0;
  private appSpeaking = false;
  private lipSync: LipSyncController | null = null;
  private mouseX = 0;
  private mouseY = 0;
  private mouseOnCanvas = false;
  private diagTimer = 0;
  private pixelRatioCap = QUALITY_PROFILES.high.pixelRatioCap;
  private appliedAntialias = true;
  private effectiveQuality: EffectivePerformanceQuality = 'high';
  private framePacer = new FramePacer();
  private perfFpsEma = 60;
  private perfFrameMsEma = 16.7;
  private sbAcc = 0;
  private springBoneUpdateFps = 0;
  private devVrmMs = 0;
  private devAnimMs = 0;
  private devGestMs = 0;
  private devExprMs = 0;
  private devLipMs = 0;
  private devRenderMs = 0;
  private devUpdateMs = 0;
  private devRafIntervalMs = 16.7;
  private devTimeBeforeUpdateMs = 0;
  private devTimeAfterRenderMs = 0;
  private devTotalFrameIntervalMs = 16.7;
  private devMissedFrames = 0;
  private lastRafTimestamp = 0;
  private lastFrameEndTimestamp = 0;
  private gpuTimerQueryExt: any = null;
  private gpuTimerQuery: any = null;
  private devGpuTimeMs = -1;
  private gpuTimerSupported = false;
  private _dbSize = new THREE.Vector2();
  private companionMode = false;

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

  private applyCompanionModelTransform(): void {
    if (!this.activeModelGroup || this.activeModelId !== 'carlotta') return;
    this.activeModelGroup.position.y = this.companionMode ? COMPANION_MODEL_Y_OFFSET : 0;
  }

  public setCompanionMode(enabled: boolean): void {
    this.companionMode = enabled;
    this.applyCompanionModelTransform();
    if (this.controls) this.controls.enabled = !enabled;
    if (enabled) {
      this.camera.position.set(0, 0.72, 3.25);
      this.camera.lookAt(0, 0.55, 0);
      this.camera.updateProjectionMatrix();
      if (this.vrmAvatar) carlottaCompanionController.enter();
    } else {
      this.camera.position.set(0, 0.5, 4.5);
      if (this.controls) {
        this.controls.target.set(0, 0.3, 0);
        this.controls.enabled = true;
        this.controls.update();
      }
      if (this.vrmAvatar) carlottaCompanionController.exit();
    }
  }

  public exitCompanionMotion(): void {
    if (this.vrmAvatar) carlottaCompanionController.exit();
  }

  private initProceduralAvatar() {
    if (this.activeModelGroup) this.scene.remove(this.activeModelGroup);
    this.proceduralAvatar = createProceduralMint();
    this.activeModelGroup = this.proceduralAvatar.group;
    this.scene.add(this.activeModelGroup);
  }

  public autoLoadCarlotta(): Promise<boolean> {
    if (this.vrmLoadPromise) return this.vrmLoadPromise;
    this.vrmLoadPromise = this.loadCarlottaFromUrl(CARLOTTA_VRM_URL).finally(() => { this.vrmLoadPromise = null; });
    return this.vrmLoadPromise;
  }

  public async loadCarlottaFromUrl(url: string): Promise<boolean> {
    try {
      const loaded = await carlottaVrmLoader.loadVRMFromUrl(url);
      this.replaceActiveModel(loaded.vrm.scene);
      if (this.vrmAvatar) carlottaVrmLoader.dispose(this.vrmAvatar);
      this.vrmAvatar = loaded;
      this.fbxAvatar = null;
      this.proceduralAvatar = null;
      this.activeModelId = 'carlotta';
      this.isVrmLoaded = true;
      this.isFbxLoaded = false;
      this.applyCompanionModelTransform();
      applyCarlottaRelaxedPose(loaded.vrm);
      loaded.vrm.update(0);
      carlottaAnimationController.init(loaded.vrm);
      carlottaGestureController.init(loaded.vrm);
      carlottaGestureController.start('bow');
      carlottaLipSync.bind(loaded.vrm);
      carlottaExpressionController.init(loaded.vrm);
      carlottaCompanionController.init(loaded.vrm);
      if (this.companionMode) carlottaCompanionController.enter();
      console.log('[CarloPose] idle base captured after relaxed pose');
      applyCarlottaTextureQuality(loaded.vrm, this.effectiveQuality);
      console.log('[MintRenderer] Carlotta VRM active (Mint fallback available)');
      return true;
    } catch (err) {
      console.warn('[MintRenderer] Carlotta VRM auto-load failed:', err);
      return false;
    }
  }

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
      this.animController.discoverBones(loaded.group);
      this.initEyeTracking();
      this.lipSync = LipSyncController.getOrCreate();
      this.lipSync.init(loaded.morphTargets);
      if (this.lipSync.getMode() === 'none') this.lipSync.initBones(this.animController.getBoneMap());
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
      this.effectiveQuality = resolveEffectiveQuality(qualitySetting);
      const profile: QualityProfile = QUALITY_PROFILES[this.effectiveQuality];
      this.pixelRatioCap = profile.pixelRatioCap;
      this.appliedAntialias = profile.antialias;
      this.framePacer.setTargetFps(profile.targetFps);
      this.springBoneUpdateFps = profile.springBoneUpdateFps;
      this.sbAcc = 0;
      this.renderer = new THREE.WebGLRenderer({ antialias: profile.antialias, alpha: true, powerPreference: 'high-performance' });
      const dom = this.renderer.domElement;
      dom.style.position = 'absolute'; dom.style.top = '0'; dom.style.left = '0'; dom.style.width = '100%'; dom.style.height = '100%';
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
      this.renderer.setSize(width, height);
      this.renderer.shadowMap.enabled = profile.shadowsEnabled;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.logQualityBaseline('mount', qualitySetting);
      container.appendChild(dom);
      if (isDevBuild()) {
        try {
          const gl = this.renderer.getContext();
          this.gpuTimerQueryExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') || gl.getExtension('EXT_disjoint_timer_query');
          this.gpuTimerSupported = !!this.gpuTimerQueryExt;
        } catch { this.gpuTimerSupported = false; }
      }
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.controls = new OrbitControls(this.camera, dom);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      this.controls.enablePan = true;
      this.controls.enableRotate = true;
      this.controls.enableZoom = true;
      this.controls.zoomToCursor = true;
      this.controls.screenSpacePanning = true;
      this.controls.rotateSpeed = 0.8;
      this.controls.minDistance = 0.5;
      this.controls.maxDistance = 12.0;
      this.controls.minPolarAngle = Math.PI * 0.1;
      this.controls.maxPolarAngle = Math.PI * 0.85;
      this.controls.target.set(0, 0.3, 0);
      this.controls.update();
      if (this.companionMode) {
        this.controls.enabled = false;
        this.camera.position.set(0, 0.72, 3.25);
        this.camera.lookAt(0, 0.55, 0);
      }
      this.startRenderLoop();
      if (DEFAULT_MODEL === 'carlotta') this.autoLoadCarlotta().then((ok) => { if (!ok) this.autoLoadFbx(); }); else this.autoLoadFbx();
      return true;
    } catch {
      this.renderer = null;
      return false;
    }
  }

  public unmount() {
    if (this.animationFrameId) { cancelAnimationFrame(this.animationFrameId); this.animationFrameId = null; }
    if (this.vrmAvatar) {
      carlottaAnimationController.reset();
      carlottaGestureController.reset();
      carlottaCompanionController.reset();
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.setSize(width, height);
  }

  public getEffectiveQuality(): EffectivePerformanceQuality { return this.effectiveQuality; }
  public getAppliedAntialias(): boolean { return this.appliedAntialias; }

  public applyRenderQuality(profile: QualityProfile, effective: EffectivePerformanceQuality): void {
    this.effectiveQuality = effective;
    this.pixelRatioCap = profile.pixelRatioCap;
    this.framePacer.setTargetFps(profile.targetFps);
    this.springBoneUpdateFps = profile.springBoneUpdateFps;
    this.sbAcc = 0;
    if (!this.renderer) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.shadowMap.enabled = profile.shadowsEnabled;
    if (this.vrmAvatar) applyCarlottaTextureQuality(this.vrmAvatar.vrm, effective);
    this.logQualityBaseline('apply', 'manual');
  }

  private logQualityBaseline(phase: 'mount' | 'apply', setting: PerformanceQualitySetting | 'manual'): void {
    if (!isDevBuild() || !this.renderer) return;
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    console.info(`[ZoyaQuality] ${phase} setting=${setting} tier=${this.effectiveQuality} pixelRatio=${this.renderer.getPixelRatio()} drawingBuffer=${size.x}x${size.y} antialias=${this.appliedAntialias} shadows=${this.renderer.shadowMap.enabled}`);
  }

  public async loadFbxModel(file: File): Promise<boolean> {
    try {
      const loaded = await mintFbxService.loadFbxFromFile(file);
      if (this.vrmAvatar) {
        if (this.activeModelGroup === this.vrmAvatar.vrm.scene) this.scene.remove(this.activeModelGroup);
        carlottaAnimationController.reset();
        carlottaGestureController.reset();
        carlottaCompanionController.reset();
        carlottaExpressionController.reset();
        carlottaLipSync.reset();
        carlottaVrmLoader.dispose(this.vrmAvatar);
        this.vrmAvatar = null;
        this.isVrmLoaded = false;
      }
      if (this.activeModelGroup) this.scene.remove(this.activeModelGroup);
      this.fbxAvatar = loaded;
      this.proceduralAvatar = null;
      this.activeModelGroup = loaded.group;
      this.scene.add(this.activeModelGroup);
      this.activeModelId = 'mint';
      this.isFbxLoaded = true;
      this.animController.discoverBones(loaded.group);
      this.initEyeTracking();
      this.lipSync = LipSyncController.getOrCreate();
      this.lipSync.init(loaded.morphTargets);
      if (this.lipSync.getMode() === 'none') this.lipSync.initBones(this.animController.getBoneMap());
      console.log(`[MintRenderer] Lip sync mode: ${this.lipSync.getMode()}`);
      return true;
    } catch (err) {
      console.warn('[MintRenderer] FBX file load failed:', err);
      return false;
    }
  }

  private initEyeTracking() {
    if (!this.renderer) return;
    this.eyeTracker = new EyeTracker(this.renderer.domElement);
    this.eyeTracker.setModel(this.fbxAvatar?.group ?? null);
  }

  public setEmotion(emotion: EmotionType, intensity = 0.45) {
    this.currentEmotion = emotion;
    this.currentEmotionIntensity = intensity;
    if (this.vrmAvatar) carlottaExpressionController.setEmotion(emotion, intensity);
  }

  public getEmotion(): EmotionType { return this.currentEmotion; }
  public getEmotionIntensity(): number { return this.currentEmotionIntensity; }

  public setSpeaking(speaking: boolean) {
    this.appSpeaking = speaking;
  }

  public getCamera(): THREE.PerspectiveCamera { return this.camera; }
  public getActiveModel(): THREE.Object3D | null { return this.activeModelGroup; }
  public isCarlottaLoaded(): boolean { return this.isVrmLoaded; }
  public isSpeaking(): boolean { return this.appSpeaking; }

  public setPerformanceQuality(profile: QualityProfile, effective: EffectivePerformanceQuality) {
    this.applyRenderQuality(profile, effective);
  }

  public setMousePosition(x: number, y: number, onCanvas: boolean) {
    this.mouseX = x;
    this.mouseY = y;
    this.mouseOnCanvas = onCanvas;
  }

  public dispose() {
    this.unmount();
    this.eyeTracker?.dispose();
    this.eyeTracker = null;
  }

  private startRenderLoop() {
    const render = (timestamp: number) => {
      this.animationFrameId = requestAnimationFrame(render);
      const dt = this.clock.getDelta();
      this.framePacer.update(dt);
      if (!this.renderer) return;
      if (this.vrmAvatar) {
        const t0 = performance.now();
        this.vrmAvatar.vrm.update(dt);
        this.devVrmMs = performance.now() - t0;
        const t1 = performance.now();
        carlottaAnimationController.update(dt);
        this.devAnimMs = performance.now() - t1;
        const t2 = performance.now();
        carlottaGestureController.update(dt);
        this.devGestMs = performance.now() - t2;
        const t3 = performance.now();
        carlottaExpressionController.update(dt);
        this.devExprMs = performance.now() - t3;
        const t4 = performance.now();
        carlottaLipSync.update(dt);
        this.devLipMs = performance.now() - t4;
        const t5 = performance.now();
        carlottaCompanionController.update(dt);
        this.devGestMs += performance.now() - t5;
      }
      if (this.fbxAvatar && !this.vrmAvatar) {
        this.eyeTracker?.update(dt);
        this.animController.update(dt);
        this.lipSync?.update(dt);
      }
      const t6 = performance.now();
      this.renderer.render(this.scene, this.camera);
      this.devRenderMs = performance.now() - t6;
      this.devUpdateMs = this.devVrmMs + this.devAnimMs + this.devGestMs + this.devExprMs + this.devLipMs;
      if (this.renderer.info.render) {
        const info = this.renderer.info.render;
        this._dbSize.copy(this.renderer.getDrawingBufferSize(new THREE.Vector2()));
      }
      this.lastRafTimestamp = timestamp;
    };
    this.animationFrameId = requestAnimationFrame(render);
  }
}
