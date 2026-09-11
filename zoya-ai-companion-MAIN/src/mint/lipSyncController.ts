import * as THREE from 'three';
import { MintBoneMap } from './animation/skeletonMap';

/**
 * LipSyncController — maps audio viseme values to Mint facial controls.
 *
 * Supports TWO modes:
 *   1. Morph targets (blend shapes) — if the FBX has them
 *   2. Bone rotations — for Mint's facial bone hierarchy
 *
 * Pipeline:
 *   audioAnalyser.getVisemeFrame()
 *     → { mouthOpen, mouthWide, mouthSmile }
 *     → LipSyncController.update()
 *     → morphTargetInfluences[] OR bone quaternion deltas
 *
 * Uses frame-rate-independent exponential smoothing.
 * Emotion morphs are preserved via separate contribution blending.
 */

export interface VisemeInput {
  mouthOpen: number;   // 0.0 – 1.0
  mouthWide: number;   // 0.0 – 1.0
  mouthSmile: number;  // 0.0 – 1.0
}

export interface LipSyncConfig {
  /** Smoothing speed for exponential decay (default: 18) */
  smoothingSpeed: number;
  /** Maximum morph influence value (default: 1.0) */
  maxInfluence: number;
  /** Maximum jaw rotation in degrees (default: 12) */
  maxJawDeg: number;
  /** Maximum lip corner rotation in degrees (default: 8) */
  maxCornerDeg: number;
  /** Maximum lip movement in degrees (default: 6) */
  maxLipDeg: number;
}

const DEFAULT_CONFIG: LipSyncConfig = {
  smoothingSpeed: 14,
  maxInfluence: 1.0,
  maxJawDeg: 25,
  maxCornerDeg: 15,
  maxLipDeg: 20,
};

/** Morph target mapping entry */
interface MorphMapping {
  idx: number;
  current: number;
  target: number;
}

/** Bone mapping entry for lip-sync */
interface BoneChannel {
  bone: THREE.Object3D;
  bindQuat: THREE.Quaternion;
  currentSmoothed: number;
  targetValue: number;
}

/** Calibration data for one facial bone in the procedural mouth pose system. */
interface FacialBoneCalib {
  bone: THREE.Object3D;
  bindQuat: THREE.Quaternion;
  bindPos: THREE.Vector3;
  bindScale: THREE.Vector3;
  calibratedAxis: 'x' | 'y' | 'z';
  calibratedSign: 1 | -1;
  openDeg: number;
  wideDeg: number;
  smileDeg: number;
  localVertIdx: number[];
}

// Scratch objects (reused to avoid GC)
const _tmpQuat = new THREE.Quaternion();
const _tmpEuler = new THREE.Euler();

// ═══════════════════════════════════════════════════════════════════
//  MANUAL FACIAL BONE SWEEP (EXTREME DIAGNOSTIC)
// ═══════════════════════════════════════════════════════════════════

type SweepAxis = 'X' | 'Y' | 'Z';

interface SweepBoneEntry {
  bone: THREE.Object3D;
  bindQuat: THREE.Quaternion;
  bindPos: THREE.Vector3;
  name: string;
  isJaw: boolean;
}

// Extreme rotation limit (degrees) — same for all test bones
const FACE_TEST_ROT_DEG = 60;

// Duration for each test phase in seconds
const FACE_TEST_HOLD_DURATION = 1.5;
const FACE_TEST_REST_DURATION = 0.5;

export class LipSyncController {
  // ─── Module-level singleton ─────────────────────────
  private static _singleton: LipSyncController | null = null;
  private static _debugButtonRegistered = false;

  /** Get or create the single canonical LipSyncController. */
  static getOrCreate(config?: Partial<LipSyncConfig>): LipSyncController {
    if (!LipSyncController._singleton) {
      LipSyncController._singleton = new LipSyncController(config);
    }
    return LipSyncController._singleton;
  }

  private config: LipSyncConfig;
  private mode: 'morph' | 'bone' | 'none' = 'none';
  private initialized = false;

  // ─── Instance ID (for debugging) ──
  private static _instanceCounter = 0;
  private _instanceId = ++LipSyncController._instanceCounter;

  // ─── Morph target mode ────────────────────────────
  private meshEntries: {
    mesh: THREE.Mesh;
    dictionary: { [key: string]: number };
    openMappings: MorphMapping[];
    wideMappings: MorphMapping[];
    smileMappings: MorphMapping[];
  }[] = [];

  // ─── Bone mode ────────────────────────────────────
  private jawChannel: BoneChannel | null = null;
  private lipUpperChannel: BoneChannel | null = null;   // Bon_uplip_M
  private lipLowerChannel: BoneChannel | null = null;   // Bon_Lolip_M
  private cornerLChannel: BoneChannel | null = null;    // Bon_zuiba_L
  private cornerRChannel: BoneChannel | null = null;    // Bon_zuiba_R
  // Extended lip-sync channels (sweep-tested bones)
  private lipUpperLChannel: BoneChannel | null = null;  // Bon_uplip01_L
  private lipUpperRChannel: BoneChannel | null = null;  // Bon_uplip01_R
  private lipLowerLChannel: BoneChannel | null = null;  // Bon_Lolip01_L
  private lipLowerRChannel: BoneChannel | null = null;  // Bon_Lolip01_R
  private colipLChannel: BoneChannel | null = null;     // Bon_colip_L
  private colipRChannel: BoneChannel | null = null;     // Bon_colip_R

  // ─── Procedural mouth pose calibration ─────────────────────────────
  private _calibBones: Map<string, FacialBoneCalib> = new Map();
  private _calibReady = false;
  private _calibUpperToLower = new THREE.Vector3();
  private _calibFaceForward = new THREE.Vector3();

  // Diagnostics
  private diagTimer = 0;
  private diagLogged = false;
  private _firstUpdateLogged = false;
  private _wasSpeaking = false;
  private _audioVisemeLogged = false;
  private _boneDiagLogged = false;

  // ─── Procedural mouth pose smoothing ───
  private _smoothMouthOpen = 0;
  private _smoothMouthWide = 0;
  private _smoothMouthSmile = 0;

  // ─── Facial deformation test (short diagnostic) ───
  private _sweepBones: SweepBoneEntry[] = [];
  private _sweepActive = false;
  private _sweepBoneIdx = 0;       // which bone
  private _sweepAxisIdx = 0;       // 0=X, 1=Y, 2=Z
  private _sweepPhase: 'hold' | 'rest' = 'hold';
  private _sweepTimer = 0;         // time elapsed in current phase
  private _sweepCurrentVal = 0;    // current smoothed rotation (radians)
  private _sweepTargetVal = 0;     // target rotation for interpolation
  private _sweepSign = 1;          // +1 or -1
  private _sweepTestNum = 0;       // current test number (1-based)
  private _sweepTotalTests = 0;    // total tests for this sweep
  private _sweepBoneMap: MintBoneMap | null = null;
  private _sweepSkinResults: string[] = [];

  // ─── Automatic deformation measurement ─────────────
  private _measureMesh: THREE.SkinnedMesh | null = null;
  private _measureBindPositions: Float32Array | null = null;  // bind-pose skinned positions
  private _measureBindBoneMatrices: Float32Array | null = null; // bind-pose bone matrices
  private _measureSkinIndices: THREE.BufferAttribute | null = null;
  private _measureSkinWeights: THREE.BufferAttribute | null = null;
  private _measureVertexCount = 0;
  private _measureBoneCount = 0;
  private _measureResults: {
    bone: string; axis: string; sign: number;
    mean: number; max: number; rms: number; movedVerts: number;
    boneLocalMean: number; boneLocalMax: number; boneVerts: number;
  }[] = [];

  // ─── GPU skinning verification test ─────────────
  private _gpuTestActive = false;
  private _gpuTestBone: THREE.Object3D | null = null;
  private _gpuTestBindQuat = new THREE.Quaternion();
  private _gpuTestAxisIdx = 0; // 0=X, 1=Y, 2=Z
  private _gpuTestPhase: 'hold' | 'restore' = 'hold';
  private _gpuTestTimer = 0;
  private _gpuTestLoggedThisPhase = false;
  private _gpuTestMesh: THREE.SkinnedMesh | null = null;
  private _gpuTestOverlay: HTMLDivElement | null = null;

  // ─── Bone-ranking diagnostic ─────────────────────
  private _rankActive = false;
  private _rankBones: { bone: THREE.Object3D; name: string; bindQuat: THREE.Quaternion; boneIdx: number; localVerts: number[] }[] = [];
  private _rankMesh: THREE.SkinnedMesh | null = null;
  private _rankBindPos: Float32Array | null = null; // bind-pose skinned positions
  private _rankSkinIdx: THREE.BufferAttribute | null = null;
  private _rankSkinWt: THREE.BufferAttribute | null = null;
  private _rankVertCount = 0;
  private _rankBoneIdx = 0;
  private _rankRotIdx = 0; // 0-5: X+, X-, Y+, Y-, Z+, Z-
  private _rankPhase: 'hold' | 'restore' = 'hold';
  private _rankTimer = 0;
  private _rankResults: { bone: string; axis: string; sign: number; mean: number; max: number; movedVerts: number; measured: number }[] = [];
  private _rankOverlay: HTMLDivElement | null = null;

  private static readonly RANK_ROT_DEG = 60;
  private static readonly RANK_HOLD = 1.2; // seconds per test
  private static readonly RANK_REST = 0.3; // seconds between tests
  private static readonly RANK_ROTS: { axis: 'x' | 'y' | 'z'; label: string }[] = [
    { axis: 'x', label: 'X+' }, { axis: 'x', label: 'X-' },
    { axis: 'y', label: 'Y+' }, { axis: 'y', label: 'Y-' },
    { axis: 'z', label: 'Z+' }, { axis: 'z', label: 'Z-' },
  ];
  private static readonly RANK_CANDIDATES = [
    'Bon_yachi_lo', 'Bon_yachi_up', 'Bon_uplip_M', 'Bon_Lolip_M',
    'Bon_zuiba_L', 'Bon_zuiba_R', 'Bon_uplip01_L', 'Bon_uplip01_R',
    'Bon_Lolip01_L', 'Bon_Lolip01_R', 'Bon_colip_L', 'Bon_colip_R',
  ];

  // ─── Visual mouth-opening diagnostic ─────────────
  private _mouthActive = false;
  private _mouthBones: { bone: THREE.Object3D; name: string; bindQuat: THREE.Quaternion }[] = [];
  private _mouthMesh: THREE.SkinnedMesh | null = null;
  private _mouthBoneIdx = 0;
  private _mouthRotIdx = 0; // 0-5: X+, X-, Y+, Y-, Z+, Z-
  private _mouthPhase: 'hold' | 'restore' = 'hold';
  private _mouthTimer = 0;
  private _mouthOverlay: HTMLDivElement | null = null;
  private static readonly MOUTH_CANDIDATES = [
    'Bon_zuiba_L', 'Bon_zuiba_R', 'Bon_Lolip01_L', 'Bon_Lolip01_R',
    'Bon_uplip01_L', 'Bon_uplip01_R', 'Bon_Lolip_M',
    'Bon_colip_L', 'Bon_colip_R', 'Bon_uplip_M',
  ];
  private static readonly MOUTH_ROT_DEG = 15;
  private static readonly MOUTH_HOLD = 1.0;
  private static readonly MOUTH_REST = 0.5;
  private static readonly MOUTH_ROTS: { axis: 'x' | 'y' | 'z'; label: string; angle: number }[] = [
    { axis: 'x', label: 'X+', angle: 15 }, { axis: 'x', label: 'X-', angle: -15 },
    { axis: 'y', label: 'Y+', angle: 15 }, { axis: 'y', label: 'Y-', angle: -15 },
    { axis: 'z', label: 'Z+', angle: 15 }, { axis: 'z', label: 'Z-', angle: -15 },
  ];

  // ─── Geometry-derived facial rig diagnostic ─────────────
  private _rigActive = false;
  private static _facialRigTestActive = false; // module-level lock
  private _rigPhase: 'dump' | 'axis' | 'coordinated' | 'jaw' | 'done' = 'dump';
  private _rigTestIdx = 0;
  private _rigBoneIdx = 0;
  private _rigRotIdx = 0;
  private _rigCoorIdx = 0;
  private _rigJawIdx = 0;
  private _rigHoldPhase: 'hold' | 'restore' = 'hold';
  private _rigTimer = 0;
  private _rigOverlay: HTMLDivElement | null = null;
  private _rigBones: Map<string, THREE.Object3D> = new Map();
  private _rigBindQuats: Map<string, THREE.Quaternion> = new Map();
  private _rigMesh: THREE.SkinnedMesh | null = null;
  // Geometry analysis results
  private _rigUpperToLower = new THREE.Vector3(); // normalized direction from upper to lower lip
  private _rigBoneAxes: Map<string, { worldX: THREE.Vector3; worldY: THREE.Vector3; worldZ: THREE.Vector3 }> = new Map();
  private _rigBestAxis: Map<string, 'x' | 'y' | 'z'> = new Map(); // best axis per bone
  private _rigBestSign: Map<string, 1 | -1> = new Map(); // best sign per bone
  // Test sequences (computed from analysis)
  private _rigAxisTests: { name: string; axis: 'x' | 'y' | 'z'; angle: number }[] = [];
  private _rigCoorTests: { upperAngle: number; lowerAngle: number }[] = [];
  private _rigJawTests: { name: string; angle: number }[] = [];

  private static readonly RIG_ALL_BONES = [
    'mouth', 'Bon_yachi_lo', 'Bon_yachi_up',
    'Bon_uplip_M', 'Bon_Lolip_M',
    'Bon_uplip01_L', 'Bon_uplip01_R', 'Bon_Lolip01_L', 'Bon_Lolip01_R',
    'Bon_uplip02_L', 'Bon_uplip02_R', 'Bon_Lolip02_L', 'Bon_Lolip02_R',
    'Bon_zuiba_L', 'Bon_zuiba_R', 'Bon_colip_L', 'Bon_colip_R',
  ];
  private static readonly RIG_PRIMARY_BONES = [
    'Bon_uplip_M', 'Bon_Lolip_M',
    'Bon_uplip01_L', 'Bon_uplip01_R', 'Bon_Lolip01_L', 'Bon_Lolip01_R',
  ];
  private static readonly RIG_FACIAL_BONES = [
    'mouth', 'Bon_yachi_lo', 'Bon_yachi_up',
    'Bon_uplip_M', 'Bon_Lolip_M',
    'Bon_uplip01_L', 'Bon_uplip01_R', 'Bon_Lolip01_L', 'Bon_Lolip01_R',
    'Bon_uplip02_L', 'Bon_uplip02_R', 'Bon_Lolip02_L', 'Bon_Lolip02_R',
    'Bon_zuiba_L', 'Bon_zuiba_R', 'Bon_colip_L', 'Bon_colip_R',
  ];
  private static readonly RIG_AXIS_BONES = [
    'Bon_uplip_M', 'Bon_Lolip_M',
    'Bon_uplip01_L', 'Bon_uplip01_R', 'Bon_Lolip01_L', 'Bon_Lolip01_R',
    'Bon_zuiba_L', 'Bon_zuiba_R',
  ];
  private static readonly RIG_ROTS: { axis: 'x' | 'y' | 'z'; label: string }[] = [
    { axis: 'x', label: 'X+' }, { axis: 'x', label: 'X-' },
    { axis: 'y', label: 'Y+' }, { axis: 'y', label: 'Y-' },
    { axis: 'z', label: 'Z+' }, { axis: 'z', label: 'Z-' },
  ];
  private static readonly RIG_COOR_MAGNITUDES = [5, 10];
  private static readonly RIG_COOR_BONES = [
    'Bon_uplip_M', 'Bon_Lolip_M',
    'Bon_uplip01_L', 'Bon_uplip01_R', 'Bon_Lolip01_L', 'Bon_Lolip01_R',
  ];
  private static readonly RIG_JAW_BONES = ['Bon_yachi_lo', 'Bon_yachi_up'];
  private static readonly RIG_JAW_MAGNITUDES = [5, 10];
  private static readonly RIG_HOLD = 1.0;
  private static readonly RIG_REST = 0.5;

  private constructor(config?: Partial<LipSyncConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log(`[LipSync] CONSTRUCT instance=${this._instanceId}`);
    if (LipSyncController._singleton) {
      console.error(`[LipSync] ERROR: DUPLICATE CONTROLLER instance=${this._instanceId} (existing=${LipSyncController._singleton._instanceId})`);
      console.error(new Error().stack);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Initialize with morph target meshes from the loaded FBX.
   * If no morph targets match, falls back to bone mode.
   */
  init(morphTargets: { mesh: THREE.Mesh; dictionary: { [key: string]: number } }[]): void {
    this.meshEntries = [];
    this.mode = 'none';

    console.log(`[LipSync] INIT instance=${this._instanceId} morphTargets=${morphTargets.length}`);

    // ─── Try morph targets first ────────────────────
    for (const { mesh, dictionary } of morphTargets) {
      if (!mesh.morphTargetInfluences) {
        console.log(`[LipSync] Mesh "${mesh.name}" has dictionary but NO morphTargetInfluences — skipping`);
        continue;
      }

      const dictSize = Object.keys(dictionary).length;
      console.log(`[LipSync] Mesh "${mesh.name}" has ${dictSize} morph targets, ${mesh.morphTargetInfluences.length} influences`);
      console.log(`[LipSync] Names:`, Object.keys(dictionary).join(', '));

      const openMappings: MorphMapping[] = [];
      const wideMappings: MorphMapping[] = [];
      const smileMappings: MorphMapping[] = [];

      for (const [name, idx] of Object.entries(dictionary)) {
        const ln = name.toLowerCase();

        // MOUTH OPEN
        if (
          ln.includes('mouthopen') || ln.includes('jawopen') ||
          ln.includes('v_aa') || ln.includes('a01') ||
          (ln !== 'mouthclose' && ln !== 'mouth_close' && (
            ln.includes('open') || ln.includes('ah') || ln.includes('oh')
          ))
        ) {
          openMappings.push({ idx, current: 0, target: 0 });
          console.log(`  [LipSync] OPEN matched: "${name}" (idx=${idx})`);
        }

        // MOUTH WIDE
        if (
          ln.includes('mouthwide') || ln.includes('v_ih') ||
          ln.includes('wide') || ln === 'ee'
        ) {
          wideMappings.push({ idx, current: 0, target: 0 });
          console.log(`  [LipSync] WIDE matched: "${name}" (idx=${idx})`);
        }

        // MOUTH SMILE
        if (
          ln.includes('mouthsmile') || ln.includes('v_ee') ||
          ln.includes('e01') || ln.includes('smile')
        ) {
          smileMappings.push({ idx, current: 0, target: 0 });
          console.log(`  [LipSync] SMILE matched: "${name}" (idx=${idx})`);
        }
      }

      if (openMappings.length > 0 || wideMappings.length > 0 || smileMappings.length > 0) {
        this.meshEntries.push({ mesh, dictionary, openMappings, wideMappings, smileMappings });
      }
    }

    if (this.meshEntries.length > 0) {
      this.mode = 'morph';
      this.initialized = true;
      console.log('[LipSync] ═══ MODE: MORPH TARGETS ═══');
      for (const entry of this.meshEntries) {
        console.log(`  Mesh: "${entry.mesh.name}"`);
        if (entry.openMappings.length > 0) {
          console.log(`    MOUTH_OPEN: ${entry.openMappings.map(m => this.getIdxName(entry.dictionary, m.idx)).join(', ')}`);
        }
        if (entry.wideMappings.length > 0) {
          console.log(`    MOUTH_WIDE: ${entry.wideMappings.map(m => this.getIdxName(entry.dictionary, m.idx)).join(', ')}`);
        }
        if (entry.smileMappings.length > 0) {
          console.log(`    MOUTH_SMILE: ${entry.smileMappings.map(m => this.getIdxName(entry.dictionary, m.idx)).join(', ')}`);
        }
      }
    } else {
      console.warn('[LipSync] No mouth morph targets found — will try bone mode');
    }
  }

  /**
   * Initialize bone-based lip sync using the skeleton map.
   * Called after init() if no morph targets were found.
   */
  initBones(boneMap: MintBoneMap): void {
    console.log(`[LipSync] INIT BONES instance=${this._instanceId}`);
    if (this.mode === 'morph') {
      console.log('[LipSync] Morph targets available — skipping bone init');
      return;
    }

    this._sweepBoneMap = boneMap;

    console.log('[LipSync] ═══ INITIALIZING BONE MODE ═══');

    const makeChannel = (bone: THREE.Object3D | null): BoneChannel | null => {
      if (!bone) return null;
      const bindQuat = bone.quaternion.clone();
      console.log(`[LipSync] Bone found: "${bone.name}" bind=(${bindQuat.x.toFixed(3)}, ${bindQuat.y.toFixed(3)}, ${bindQuat.z.toFixed(3)}, ${bindQuat.w.toFixed(3)})`);
      return { bone, bindQuat, currentSmoothed: 0, targetValue: 0 };
    };

    this.jawChannel = makeChannel(boneMap.jawLower);
    this.lipUpperChannel = makeChannel(boneMap.lipUpperM);
    this.lipLowerChannel = makeChannel(boneMap.lipLowerM);
    this.cornerLChannel = makeChannel(boneMap.mouthCornerL);
    this.cornerRChannel = makeChannel(boneMap.mouthCornerR);
    this.lipUpperLChannel = makeChannel(boneMap.lipUpperL);
    this.lipUpperRChannel = makeChannel(boneMap.lipUpperR);
    this.lipLowerLChannel = makeChannel(boneMap.lipLowerL);
    this.lipLowerRChannel = makeChannel(boneMap.lipLowerR);
    this.colipLChannel = makeChannel(boneMap.colipL);
    this.colipRChannel = makeChannel(boneMap.colipR);

    const allChannels = [
      this.jawChannel, this.lipUpperChannel, this.lipLowerChannel,
      this.cornerLChannel, this.cornerRChannel,
      this.lipUpperLChannel, this.lipUpperRChannel,
      this.lipLowerLChannel, this.lipLowerRChannel,
      this.colipLChannel, this.colipRChannel,
    ];
    const foundBones = allChannels.filter(Boolean).length;

    if (foundBones > 0) {
      this.mode = 'bone';
      this.initialized = true;
      console.log(`[LipSync] ═══ MODE: BONES (${foundBones} facial bones) instance=${this._instanceId} ═══`);
      for (const ch of allChannels) {
        if (ch) console.log(`  Bone: "${ch.bone.name}"`);
      }

      // Run calibration to determine correct local rotation axes for each bone
      this.calibrateFacialBones();

      // Register browser-console debug trigger and inject visible button
      this.registerDebugTrigger();
    } else {
      console.warn('[LipSync] No facial bones found — lip sync unavailable');
      this.mode = 'none';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  MANUAL SWEEP CONTROL
  // ═══════════════════════════════════════════════════════════════

  /**
   * Register the browser-console debug trigger and inject a visible button.
   * Called from initBones() after bone mode is confirmed.
   */
  /**
   * Send a debug message to both the browser console AND the server terminal.
   * The server endpoint prints it into the PowerShell/terminal running npm run dev.
   */
  /** Whether to log the verbose per-frame ENTERED message */
  private _logEntered = false;

  private postDebug(msg: string): void {
    console.log(msg);
    try {
      // Fire-and-forget: never block the sweep
      void fetch('/api/zoya/face-debug-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  private registerDebugTrigger(): void {
    // Register window.__testMintMouth — always point to THIS (canonical) instance
    (window as any).__testMintMouth = () => {
      this.triggerManualSweep();
    };

    // Only inject the button ONCE across all controller instances
    if (LipSyncController._debugButtonRegistered) {
      this.postDebug(`[FaceTest] DEBUG BUTTON already registered, skipping (instance=${this._instanceId})`);
      return;
    }
    LipSyncController._debugButtonRegistered = true;

    this.postDebug(`[FaceTest] DEBUG BUTTON OWNER instance=${this._instanceId}`);
    this.injectDebugButton();
    this.injectRankButton();
    this.injectMouthButton();
    this.injectAssetButton();
    this.injectGeomInspectButton();
    this.injectRigButton();
    this.injectMouthPoseTestButton();
    this.injectAxisDiscoveryButton();
  }

  /**
   * Trigger the manual facial bone sweep diagnostic.
   * Can be called from console: window.__testMintMouth()
   * or via the floating "TEST MINT MOUTH" button.
   */
  triggerManualSweep(): void {
    if (this._gpuTestActive) {
      this.postDebug('[GPUFaceTest] Already running — ignoring trigger');
      return;
    }
    if (this.mode !== 'bone') {
      this.postDebug('[GPUFaceTest] Cannot test — mode is not bone');
      return;
    }

    // Find Bon_uplip_M from the bone map
    const bone = this._sweepBoneMap?.lipUpperM;
    if (!bone) {
      this.postDebug('[GPUFaceTest] ERROR: Bon_uplip_M not found');
      return;
    }

    // Find the SkinnedMesh driven by the same skeleton
    let mesh: THREE.SkinnedMesh | null = null;
    let walker: THREE.Object3D = bone;
    while (walker.parent) walker = walker.parent;
    walker.traverse((child) => {
      if (!mesh && (child as THREE.SkinnedMesh).isSkinnedMesh) {
        const sk = (child as THREE.SkinnedMesh).skeleton;
        if (sk && sk.bones.length > 0 && sk.bones.includes(bone as THREE.Bone)) {
          mesh = child as THREE.SkinnedMesh;
        }
      }
    });

    if (!mesh || !mesh.skeleton) {
      this.postDebug('[GPUFaceTest] ERROR: No SkinnedMesh found');
      return;
    }

    // Verify the bone is in the skeleton
    const boneIdx = mesh.skeleton.bones.indexOf(bone as THREE.Bone);

    this.postDebug('[GPUFaceTest]');
    this.postDebug(`[GPUFaceTest] SkinnedMesh: ${mesh.name}`);
    this.postDebug(`[GPUFaceTest] Skeleton bones: ${mesh.skeleton.bones.length}`);
    this.postDebug(`[GPUFaceTest] Bon_uplip_M skeleton index: ${boneIdx}`);
    this.postDebug(`[GPUFaceTest] Bone: Bon_uplip_M FOUND`);
    this.postDebug('[GPUFaceTest]');

    // Setup test state
    this._gpuTestActive = true;
    this._gpuTestBone = bone;
    this._gpuTestBindQuat.copy(bone.quaternion);
    this._gpuTestAxisIdx = 0;
    this._gpuTestPhase = 'hold';
    this._gpuTestTimer = 0;
    this._gpuTestLoggedThisPhase = false;
    this._gpuTestMesh = mesh;

    // Create visual overlay
    this.createGPUOverlay('X +60°');

    // Also pause normal lip-sync so it doesn't fight the test
    this._sweepActive = true; // reuse sweep flag to pause normal lip-sync
    this._sweepBones = []; // but don't run the old sweep logic
  }

  // ═══════════════════════════════════════════════════════════════
  //  GPU SKINNING VERIFICATION TEST
  // ═══════════════════════════════════════════════════════════════

  private static readonly GPU_TEST_AXES: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
  private static readonly GPU_TEST_LABELS = ['X +60°', 'Y +60°', 'Z +60°'];
  private static readonly GPU_TEST_HOLD = 1.5; // seconds per axis
  private static readonly GPU_TEST_ROT_RAD = 60 * Math.PI / 180;

  private createGPUOverlay(label: string): void {
    this.removeGPUOverlay();
    const el = document.createElement('div');
    el.id = 'gpu-face-test-overlay';
    el.innerHTML = `<div style="font-size:22px;font-weight:bold;">MINT BONE TEST</div><div style="font-size:18px;">Bon_uplip_M</div><div style="font-size:24px;font-weight:bold;color:#ff4;">${label}</div>`;
    Object.assign(el.style, {
      position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '999999', padding: '12px 24px', borderRadius: '12px',
      background: 'rgba(0,0,0,0.85)', color: '#fff', fontFamily: 'monospace',
      textAlign: 'center', border: '2px solid #ff4', pointerEvents: 'none',
    });
    document.body.appendChild(el);
    this._gpuTestOverlay = el;
  }

  private updateGPUOverlay(label: string): void {
    if (!this._gpuTestOverlay) return;
    const divs = this._gpuTestOverlay.querySelectorAll('div');
    if (divs[2]) divs[2].textContent = label;
  }

  private removeGPUOverlay(): void {
    if (this._gpuTestOverlay) {
      this._gpuTestOverlay.remove();
      this._gpuTestOverlay = null;
    }
    const existing = document.getElementById('gpu-face-test-overlay');
    if (existing) existing.remove();
  }

  /**
   * Run one frame of the GPU skinning test.
   * Called from update() when _gpuTestActive is true.
   * Tests X, Y, Z at +60° on Bon_uplip_M, one at a time.
   */
  runGPUTest(delta: number): void {
    if (!this._gpuTestBone || !this._gpuTestMesh) {
      this.finishGPUTest();
      return;
    }

    const bone = this._gpuTestBone;
    const mesh = this._gpuTestMesh;
    const skeleton = mesh.skeleton;
    const axes = LipSyncController.GPU_TEST_AXES;
    const labels = LipSyncController.GPU_TEST_LABELS;
    const axisIdx = this._gpuTestAxisIdx;
    const axis = axes[axisIdx];
    const rotRad = LipSyncController.GPU_TEST_ROT_RAD;

    this._gpuTestTimer += delta;

    if (this._gpuTestPhase === 'hold') {
      // Apply rotation
      bone.quaternion.copy(this._gpuTestBindQuat);
      _tmpEuler.set(0, 0, 0);
      _tmpEuler[axis] = rotRad;
      _tmpQuat.setFromEuler(_tmpEuler);
      bone.quaternion.multiply(_tmpQuat);

      // Force matrix update on bone and ALL ancestors
      bone.updateMatrix();
      bone.matrixWorldNeedsUpdate = true;
      let w: THREE.Object3D | null = bone.parent;
      while (w) {
        w.updateMatrix();
        w.matrixWorldNeedsUpdate = true;
        w.updateMatrixWorld(true);
        w = w.parent;
      }

      // Force skeleton to upload updated matrices to GPU
      skeleton.update();

      // Log exactly once per hold phase
      if (!this._gpuTestLoggedThisPhase) {
        this._gpuTestLoggedThisPhase = true;
        this.postDebug(`[GPUFaceTest] ${labels[axisIdx]} ACTIVE`);
      }

      if (this._gpuTestTimer >= LipSyncController.GPU_TEST_HOLD) {
        this._gpuTestTimer = 0;
        this._gpuTestPhase = 'restore';
        this._gpuTestLoggedThisPhase = false;
      }
    } else {
      // Restore phase
      bone.quaternion.copy(this._gpuTestBindQuat);
      bone.updateMatrix();
      bone.matrixWorldNeedsUpdate = true;
      let w: THREE.Object3D | null = bone.parent;
      while (w) {
        w.updateMatrix();
        w.matrixWorldNeedsUpdate = true;
        w.updateMatrixWorld(true);
        w = w.parent;
      }
      skeleton.update();

      if (this._gpuTestTimer === 0) {
        this.postDebug(`[GPUFaceTest] ${labels[axisIdx]} RESTORED`);
      }
      this._gpuTestTimer += delta;

      if (this._gpuTestTimer >= 0.5) {
        this._gpuTestTimer = 0;
        this._gpuTestPhase = 'hold';
        this._gpuTestLoggedThisPhase = false;
        this._gpuTestAxisIdx++;

        if (this._gpuTestAxisIdx >= axes.length) {
          this.finishGPUTest();
          return;
        }

        this.updateGPUOverlay(labels[this._gpuTestAxisIdx]);
      }
    }
  }

  private finishGPUTest(): void {
    // Restore bone to exact bind quaternion
    if (this._gpuTestBone) {
      this._gpuTestBone.quaternion.copy(this._gpuTestBindQuat);
      this._gpuTestBone.updateMatrix();
      this._gpuTestBone.matrixWorldNeedsUpdate = true;
      if (this._gpuTestMesh?.skeleton) this._gpuTestMesh.skeleton.update();
    }
    this._gpuTestActive = false;
    this._gpuTestBone = null;
    this._gpuTestMesh = null;
    this._gpuTestAxisIdx = 0;
    this._gpuTestTimer = 0;
    this.removeGPUOverlay();
    this.postDebug('[GPUFaceTest] COMPLETE');
    this.postDebug('[GPUFaceTest] All bones restored to bind pose.');
  }

  /**
   * Inject a small floating "TEST MINT MOUTH" button into the DOM.
   * This is a temporary diagnostic control.
   */
  private injectDebugButton(): void {
    // Don't inject if already present
    if (document.getElementById('mint-mouth-test-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'mint-mouth-test-btn';
    btn.textContent = '🗣 TEST MINT MOUTH';
    btn.title = 'Run manual facial bone sweep diagnostic';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '80px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '99999',
      padding: '10px 20px',
      fontSize: '14px',
      fontWeight: 'bold',
      fontFamily: 'monospace',
      background: '#e74c3c',
      color: '#fff',
      border: '2px solid #c0392b',
      borderRadius: '8px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      userSelect: 'none',
    });

    btn.addEventListener('click', () => {
      this.triggerManualSweep();
    });

    document.body.appendChild(btn);
    console.log('[FaceSweep] Button injected: "🗣 TEST MINT MOUTH" (bottom center of viewport)');
  }

  /**
   * Inject a second floating button for the bone-ranking diagnostic.
   */
  private injectRankButton(): void {
    if (document.getElementById('rank-face-test-btn')) return;
    (window as any).__rankMintFaceBones = () => this.triggerRankTest();

    const btn = document.createElement('button');
    btn.id = 'rank-face-test-btn';
    btn.textContent = '🧪 RANK MINT FACE BONES';
    btn.title = 'Rank all facial bones by deformation strength';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '130px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '99999',
      padding: '10px 20px',
      fontSize: '14px',
      fontWeight: 'bold',
      fontFamily: 'monospace',
      background: '#4be3c1',
      color: '#000',
      border: '2px solid #2ecc71',
      borderRadius: '8px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      userSelect: 'none',
    });
    btn.addEventListener('click', () => this.triggerRankTest());
    document.body.appendChild(btn);
  }

  private injectMouthButton(): void {
    if (document.getElementById('mouth-open-test-btn')) return;
    (window as any).__findMouthOpening = () => this.triggerMouthTest();

    const btn = document.createElement('button');
    btn.id = 'mouth-open-test-btn';
    btn.textContent = '🧪 FIND MINT MOUTH OPENING';
    btn.title = 'Visually test which bone rotations open Mint mouth';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '180px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '99999',
      padding: '10px 20px',
      fontSize: '14px',
      fontWeight: 'bold',
      fontFamily: 'monospace',
      background: '#f39c12',
      color: '#000',
      border: '2px solid #e67e22',
      borderRadius: '8px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      userSelect: 'none',
    });
    btn.addEventListener('click', () => this.triggerMouthTest());
    document.body.appendChild(btn);
  }

  private injectAssetButton(): void {
    if (document.getElementById('asset-inspect-btn')) return;
    (window as any).__inspectMouthAsset = () => this.triggerMouthAssetDiagnostic();

    const btn = document.createElement('button');
    btn.id = 'asset-inspect-btn';
    btn.textContent = '🔬 INSPECT MINT MOUTH ASSET';
    btn.title = 'Inspect the FBX mouth object structure, skeleton, morphs, and bone influences';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '230px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '99999',
      padding: '10px 20px',
      fontSize: '14px',
      fontWeight: 'bold',
      fontFamily: 'monospace',
      background: '#9b59b6',
      color: '#fff',
      border: '2px solid #8e44ad',
      borderRadius: '8px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      userSelect: 'none',
    });
    btn.addEventListener('click', () => this.triggerMouthAssetDiagnostic());
    document.body.appendChild(btn);
  }

  private injectGeomInspectButton(): void {
    if (document.getElementById('geom-inspect-btn')) return;
    (window as any).__inspectMintMouthGeom = () => this.triggerMouthGeomInspect();

    const btn = document.createElement('button');
    btn.id = 'geom-inspect-btn';
    btn.textContent = '📐 INSPECT MINT MOUTH GEOMETRY';
    btn.title = 'Inspect the exact geometry/skeleton relationship of mouth, .001, and main mesh';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '330px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '99999',
      padding: '10px 20px',
      fontSize: '14px',
      fontWeight: 'bold',
      fontFamily: 'monospace',
      background: '#1abc9c',
      color: '#000',
      border: '2px solid #16a085',
      borderRadius: '8px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      userSelect: 'none',
    });
    btn.addEventListener('click', () => this.triggerMouthGeomInspect());
    document.body.appendChild(btn);
  }

  private injectRigButton(): void {
    if (document.getElementById('rig-test-btn')) return;
    (window as any).__testFacialRig = () => this.triggerRigTest();

    const btn = document.createElement('button');
    btn.id = 'rig-test-btn';
    btn.textContent = '🦴 FACIAL RIG TEST';
    btn.title = 'Full facial rig diagnostic: hierarchy dump + axis test + coordinated mouth-open + jaw test';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '280px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '99999',
      padding: '10px 20px',
      fontSize: '14px',
      fontWeight: 'bold',
      fontFamily: 'monospace',
      background: '#e74c3c',
      color: '#fff',
      border: '2px solid #c0392b',
      borderRadius: '8px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      userSelect: 'none',
    });
    btn.addEventListener('click', () => this.triggerRigTest());
    document.body.appendChild(btn);
  }

  private injectMouthPoseTestButton(): void {
    if (document.getElementById('mouth-pose-test-btn')) return;
    (window as any).__testMintMouthPose = () => this.triggerMouthPoseTest();

    const btn = document.createElement('button');
    btn.id = 'mouth-pose-test-btn';
    btn.textContent = '🧪 TEST MINT MOUTH POSE';
    btn.title = 'Test procedural mouth pose: CLOSED → 25% → 50% → 75% → 100% → CLOSED';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '330px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '99999',
      padding: '10px 20px',
      fontSize: '14px',
      fontWeight: 'bold',
      fontFamily: 'monospace',
      background: '#2ecc71',
      color: '#000',
      border: '2px solid #27ae60',
      borderRadius: '8px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      userSelect: 'none',
    });
    btn.addEventListener('click', () => this.triggerMouthPoseTest());
    document.body.appendChild(btn);
  }

  /**
   * Inject axis discovery button for lip bones.
   */
  private injectAxisDiscoveryButton(): void {
    if (document.getElementById('axis-discovery-btn')) return;
    (window as any).__runLipAxisDiscovery = () => this.triggerAxisDiscovery();

    const btn = document.createElement('button');
    btn.id = 'axis-discovery-btn';
    btn.textContent = '🔬 LIP AXIS DISCOVERY';
    btn.title = 'Test X/Y/Z axes on 6 lip bones at ±3° and ±5° to find vertical axis';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '380px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '99999',
      padding: '10px 20px',
      fontSize: '14px',
      fontWeight: 'bold',
      fontFamily: 'monospace',
      background: '#8e44ad',
      color: '#fff',
      border: '2px solid #9b59b6',
      borderRadius: '8px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      userSelect: 'none',
    });
    btn.addEventListener('click', () => this.triggerAxisDiscovery());
    document.body.appendChild(btn);
  }

  // ═══════════════════════════════════════════════════════════════
  //  LIP BONE AXIS DISCOVERY DIAGNOSTIC
  // ═══════════════════════════════════════════════════════════════

  /**
   * Trigger axis discovery for 6 lip bones.
   * Tests each bone on local X, Y, Z at ±3° and ±5°.
   * Measures weighted average vertex displacement in mesh-local space.
   */
  triggerAxisDiscovery(): void {
    if (this._axisDiscoveryActive) {
      this.postDebug('[AxisDiscovery] Already running');
      return;
    }
    if (this.mode !== 'bone') {
      this.postDebug('[AxisDiscovery] Cannot test — mode is not bone');
      return;
    }

    // Ensure SkinnedMesh is discovered
    this.discoverSkinnedMesh();
    if (!this._measureMesh || !this._measureSkinIndices || !this._measureSkinWeights || !this._measureBindPositions) {
      this.postDebug('[AxisDiscovery] SkinnedMesh/skin data not available');
      return;
    }

    // Capture bind poses for all facial bones and restore them
    this.restoreAllFacialBonesToBind();

    // 6 lip bones to test
    this._axisTestBones = [
      'Bon_uplip_M', 'Bon_uplip01_L', 'Bon_uplip01_R',
      'Bon_Lolip_M', 'Bon_Lolip01_L', 'Bon_Lolip01_R',
    ].map(name => this.findBoneByName(name)).filter(b => b !== null) as THREE.Object3D[];

    if (this._axisTestBones.length === 0) {
      this.postDebug('[AxisDiscovery] No lip bones found');
      return;
    }

    this._axisDiscoveryActive = true;
    this._axisBoneIdx = 0;
    this._axisAxisIdx = 0; // 0=X, 1=Y, 2=Z
    this._axisAngleIdx = 0; // 0=-5, 1=-3, 2=+3, 3=+5
    this._axisPhase = 'hold';
    this._axisTimer = 0;
    this._axisTestAngles = [-5, -3, 3, 5];
    this._axisTestAxes = ['x', 'y', 'z'] as const;

    // Create overlay
    this.createAxisDiscoveryOverlay();

    this.postDebug('[AxisDiscovery] ═══ LIP AXIS DISCOVERY START ═══');
    this.postDebug(`[AxisDiscovery] Testing ${this._axisTestBones.length} bones × 3 axes × 4 angles = ${this._axisTestBones.length * 12} tests`);
    this._sweepActive = true; // pause normal lip-sync
    this._sweepBones = [];
  }

  private _axisDiscoveryActive = false;
  private _axisTestBones: THREE.Object3D[] = [];
  private _axisBoneIdx = 0;
  private _axisAxisIdx = 0;
  private _axisAngleIdx = 0;
  private _axisPhase: 'hold' | 'restore' = 'hold';
  private _axisTimer = 0;
  private _axisTestAngles: number[] = [];
  private _axisTestAxes: ('x' | 'y' | 'z')[] = [];

  private createAxisDiscoveryOverlay(): void {
    this.removeAxisDiscoveryOverlay();
    const total = this._axisTestBones.length * this._axisTestAxes.length * this._axisTestAngles.length;
    const el = document.createElement('div');
    el.id = 'axis-discovery-overlay';
    el.innerHTML = `<div style="font-size:18px;font-weight:bold;">LIP AXIS DISCOVERY</div><div id="axis-progress" style="font-size:14px;">0/${total}</div><div id="axis-current" style="font-size:16px;color:#ff4;"></div>`;
    Object.assign(el.style, {
      position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '999999', padding: '12px 24px', borderRadius: '12px',
      background: 'rgba(0,0,0,0.85)', color: '#fff', fontFamily: 'monospace',
      textAlign: 'center', border: '2px solid #8e44ad', pointerEvents: 'none',
    });
    document.body.appendChild(el);
    this._axisDiscoveryOverlay = el;
  }

  private _axisDiscoveryOverlay: HTMLDivElement | null = null;

  private updateAxisDiscoveryOverlay(progress: string, current: string): void {
    if (!this._axisDiscoveryOverlay) return;
    const p = this._axisDiscoveryOverlay.querySelector('#axis-progress');
    const c = this._axisDiscoveryOverlay.querySelector('#axis-current');
    if (p) p.textContent = progress;
    if (c) c.textContent = current;
  }

  private removeAxisDiscoveryOverlay(): void {
    if (this._axisDiscoveryOverlay) { this._axisDiscoveryOverlay.remove(); this._axisDiscoveryOverlay = null; }
    const el = document.getElementById('axis-discovery-overlay');
    if (el) el.remove();
  }

  /**
   * Restore all facial bones to exact bind quaternion.
   */
  private restoreAllFacialBonesToBind(): void {
    for (const entry of this._calibBones.values()) {
      entry.bone.quaternion.copy(entry.bindQuat);
      entry.bone.updateMatrix();
      entry.bone.matrixWorldNeedsUpdate = true;
    }
    const mesh = this._measureMesh;
    if (mesh && mesh.skeleton) mesh.skeleton.update();
    if (this._sweepBoneMap?.head) {
      let root = this._sweepBoneMap.head;
      while (root.parent) root = root.parent;
      root.updateMatrixWorld(true);
    }
  }

  /**
   * Run one frame of axis discovery test.
   */
  runAxisDiscovery(delta: number): void {
    if (!this._axisDiscoveryActive || this._axisTestBones.length === 0) {
      this.finishAxisDiscovery();
      return;
    }

    const bone = this._axisTestBones[this._axisBoneIdx];
    const axis = this._axisTestAxes[this._axisAxisIdx];
    const angleDeg = this._axisTestAngles[this._axisAngleIdx];
    const rad = angleDeg * Math.PI / 180;

    const mesh = this._measureMesh!;
    const skeleton = mesh.skeleton!;
    const skinIdx = this._measureSkinIndices!;
    const skinWt = this._measureSkinWeights!;
    const bpv = skinIdx.itemSize;
    const boneIdx = skeleton.bones.indexOf(bone as THREE.Bone);

    if (boneIdx === -1) {
      this.postDebug(`[AxisDiscovery] ${bone.name} not in skeleton, skipping`);
      this.advanceAxisTest();
      return;
    }

    // Find entry for bind quaternion
    const entry = this._calibBones.get(bone.name);
    if (!entry) {
      this.postDebug(`[AxisDiscovery] ${bone.name} not in calib, skipping`);
      this.advanceAxisTest();
      return;
    }

    const meshInv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();

    if (this._axisPhase === 'hold') {
      // Apply test rotation from bind pose
      bone.quaternion.copy(entry.bindQuat);
      const tmpEuler = new THREE.Euler(0, 0, 0, 'XYZ');
      tmpEuler[axis] = rad;
      const tmpQuat = new THREE.Quaternion().setFromEuler(tmpEuler);
      bone.quaternion.multiply(tmpQuat);

      bone.updateMatrix();
      bone.matrixWorldNeedsUpdate = true;
      this.forceWorldMatrixUpdate(bone);
      skeleton.update();

      // Measure displacement of vertices weighted to this bone
      const cur = this.computeSkinnedPositions(mesh,
        mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
        skinIdx, skinWt, skeleton.boneMatrices, skeleton.bones.length);

      let totalDX = 0, totalDY = 0, totalDZ = 0;
      let totalAbsDY = 0, totalWeight = 0;
      let weightedVerts = 0;

      for (let v = 0; v < this._measureVertexCount; v++) {
        for (let w = 0; w < bpv; w++) {
          const idx = v * bpv + w;
          if (skinIdx.array[idx] === boneIdx && skinWt.array[idx] > 0.01) {
            const weight = skinWt.array[idx];
            const i3 = v * 3;
            const curPos = new THREE.Vector3(cur[i3], cur[i3 + 1], cur[i3 + 2]);
            const bindPos = new THREE.Vector3(
              this._measureBindPositions[i3],
              this._measureBindPositions[i3 + 1],
              this._measureBindPositions[i3 + 2]
            );
            const delta = curPos.clone().sub(bindPos).applyMatrix4(meshInv);
            totalDX += delta.x * weight;
            totalDY += delta.y * weight;
            totalDZ += delta.z * weight;
            totalAbsDY += Math.abs(delta.y) * weight;
            totalWeight += weight;
            weightedVerts++;
            break;
          }
        }
      }

      const avgDX = totalWeight > 0 ? totalDX / totalWeight : 0;
      const avgDY = totalWeight > 0 ? totalDY / totalWeight : 0;
      const avgDZ = totalWeight > 0 ? totalDZ / totalWeight : 0;
      const avgAbsDY = totalWeight > 0 ? totalAbsDY / totalWeight : 0;

      this.postDebug(
        `[AXIS TEST] bone=${bone.name} axis=${axis.toUpperCase()} angle=${angleDeg > 0 ? '+' : ''}${angleDeg}° ` +
        `weightedVerts=${weightedVerts} ` +
        `avgDX=${avgDX.toFixed(6)} avgDY=${avgDY.toFixed(6)} avgDZ=${avgDZ.toFixed(6)} ` +
        `absDY=${avgAbsDY.toFixed(6)}`
      );

      if (this._axisTimer === 0) {
        this.updateAxisDiscoveryOverlay(
          `${this._axisBoneIdx * 12 + this._axisAxisIdx * 4 + this._axisAngleIdx + 1}/${this._axisTestBones.length * 12}`,
          `${bone.name} ${axis.toUpperCase()} ${angleDeg > 0 ? '+' : ''}${angleDeg}°`
        );
      }

      this._axisPhase = 'restore';
    } else {
      // Restore bind pose
      bone.quaternion.copy(entry.bindQuat);
      bone.updateMatrix();
      bone.matrixWorldNeedsUpdate = true;
      this.forceWorldMatrixUpdate(bone);
      skeleton.update();

      this.advanceAxisTest();
    }

    this._axisTimer += delta;
  }

  private advanceAxisTest(): void {
    this._axisPhase = 'hold';
    this._axisTimer = 0;
    this._axisAngleIdx++;

    if (this._axisAngleIdx >= this._axisTestAngles.length) {
      this._axisAngleIdx = 0;
      this._axisAxisIdx++;
      if (this._axisAxisIdx >= this._axisTestAxes.length) {
        this._axisAxisIdx = 0;
        this._axisBoneIdx++;
        if (this._axisBoneIdx >= this._axisTestBones.length) {
          this.finishAxisDiscovery();
          return;
        }
      }
    }
  }

  private finishAxisDiscovery(): void {
    this._axisDiscoveryActive = false;
    this._axisTestBones = [];
    this._axisBoneIdx = 0;
    this._axisAxisIdx = 0;
    this._axisAngleIdx = 0;
    this._axisPhase = 'hold';
    this._axisTimer = 0;
    this.removeAxisDiscoveryOverlay();

    // Restore all bones to bind pose
    this.restoreAllFacialBonesToBind();
    this._sweepActive = false;

    this.postDebug('[AxisDiscovery] ═══ AXIS DISCOVERY COMPLETE ═══');
    this.postDebug('[AxisDiscovery] All bones restored to bind pose.');
    this.postDebug('[AxisDiscovery] Re-run via: window.__runLipAxisDiscovery() or click the button');
  }

  // ═══════════════════════════════════════════════════════════════
  //  SKIN WEIGHT INSPECTION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Inspect which facial bones have non-zero skin weights
   * on the mouth/face region of Mint's SkinnedMesh.
   */
  private inspectSkinWeights(): void {
    console.log('[FaceSweep] inspectSkinWeights() ENTERED');
    console.log('[FaceSweep]');
    console.log('[FaceSweep] ═══ SKIN WEIGHT INSPECTION ═══');

    try {
      // ─── Find the scene root by walking up from head bone ───
      const headBone = this._sweepBoneMap?.head;
      console.log('[FaceSweep] head bone:', headBone ? `"${headBone.name}"` : 'NULL');

      if (!headBone) {
        console.error('[FaceSweep] ERROR: No head bone in bone map — cannot find scene');
        this._sweepSkinResults.push('ERROR: NO HEAD BONE');
        return;
      }

      // Walk up to find the scene root (Object3D with type === 'Scene' or no parent)
      let walker: THREE.Object3D = headBone;
      let depth = 0;
      while (walker.parent) {
        walker = walker.parent;
        depth++;
        if (depth > 20) break; // safety limit
      }
      const sceneRoot = walker;
      console.log(`[FaceSweep] Walked up ${depth} levels from head to scene root: "${sceneRoot.name || '(unnamed)'}" type=${sceneRoot.type}`);

      // Collect ALL SkinnedMesh objects in the scene
      const meshes: THREE.SkinnedMesh[] = [];
      sceneRoot.traverse((child) => {
        if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
          meshes.push(child as THREE.SkinnedMesh);
        }
      });
      console.log(`[FaceSweep] SkinnedMesh count: ${meshes.length}`);

      if (meshes.length === 0) {
        console.error('[FaceSweep] ERROR: No SkinnedMesh found for Mint');
        this._sweepSkinResults.push('ERROR: NO SKINNED MESH FOUND');
        return;
      }

      // Log all found meshes
      for (let i = 0; i < meshes.length; i++) {
        const m = meshes[i];
        const hasSkeleton = !!m.skeleton;
        const boneCount = m.skeleton?.bones?.length ?? 0;
        console.log(`[FaceSweep]   Mesh[${i}]: "${m.name || '(unnamed)'}" hasSkeleton=${hasSkeleton} boneCount=${boneCount}`);
      }

      // Use the first SkinnedMesh with a skeleton
      let skinnedMesh: THREE.SkinnedMesh | null = null;
      for (const m of meshes) {
        if (m.skeleton && m.skeleton.bones.length > 0) {
          skinnedMesh = m;
          break;
        }
      }

      if (!skinnedMesh || !skinnedMesh.skeleton) {
        console.error('[FaceSweep] ERROR: No SkinnedMesh with valid skeleton found');
        this._sweepSkinResults.push('ERROR: NO VALID SKELETON');
        return;
      }

      const skeleton = skinnedMesh.skeleton;
      const geometry = skinnedMesh.geometry;
      const skinIndex = geometry.getAttribute('skinIndex');
      const skinWeight = geometry.getAttribute('skinWeight');

      console.log(`[FaceSweep] Using mesh: "${skinnedMesh.name || '(unnamed)'}"`);
      console.log(`[FaceSweep] Total bones in skeleton: ${skeleton.bones.length}`);
      console.log(`[FaceSweep] Total vertices: ${geometry.attributes.position.count}`);

      if (!skinIndex || !skinWeight) {
        console.error('[FaceSweep] ERROR: SkinnedMesh has no skinIndex/skinWeight attributes');
        this._sweepSkinResults.push('ERROR: NO SKIN ATTRIBUTES');
        return;
      }

      console.log(`[FaceSweep] skinIndex itemSize: ${skinIndex.itemSize}`);
      console.log(`[FaceSweep] skinWeight itemSize: ${skinWeight.itemSize}`);
      console.log(`[FaceSweep] skinIndex array length: ${skinIndex.array.length}`);
      console.log(`[FaceSweep] skinWeight array length: ${skinWeight.array.length}`);

      // For each candidate bone, find its index in the skeleton and check skin weights
      for (const entry of this._sweepBones) {
        const boneIdx = skeleton.bones.indexOf(entry.bone as THREE.Bone);
        if (boneIdx === -1) {
          const msg = `NO SIGNIFICANT SKIN INFLUENCE: "${entry.bone.name}" — bone NOT in SkinnedMesh skeleton`;
          console.log(`[FaceSweep] ${msg}`);
          this._sweepSkinResults.push(msg);
          continue;
        }

        console.log(`[FaceSweep] Scanning vertices for bone "${entry.bone.name}" (skeleton idx=${boneIdx})...`);

        // Scan all vertices for non-zero weight on this bone
        let maxWeight = 0;
        let weightedVertices = 0;
        const vertexCount = geometry.attributes.position.count;
        const bonesPerVertex = skinIndex.itemSize;

        for (let v = 0; v < vertexCount; v++) {
          for (let w = 0; w < bonesPerVertex; w++) {
            const idx = v * bonesPerVertex + w;
            const boneSlot = skinIndex.array[idx];
            const weight = skinWeight.array[idx];
            if (boneSlot === boneIdx && weight > 0) {
              weightedVertices++;
              if (weight > maxWeight) maxWeight = weight;
            }
          }
        }

        const pct = ((weightedVertices / vertexCount) * 100).toFixed(2);
        if (weightedVertices > 0) {
          const msg = `SKIN INFLUENCE: "${entry.bone.name}" (skeleton idx=${boneIdx}) — ${weightedVertices} vertices (${pct}%), max weight=${maxWeight.toFixed(3)}`;
          console.log(`[FaceSweep] ${msg}`);
          this._sweepSkinResults.push(msg);
        } else {
          const msg = `NO SIGNIFICANT SKIN INFLUENCE: "${entry.bone.name}" (skeleton idx=${boneIdx}) — 0 weighted vertices`;
          console.log(`[FaceSweep] ${msg}`);
          this._sweepSkinResults.push(msg);
        }
      }
    } catch (error) {
      console.error('[FaceSweep] SKIN WEIGHT INSPECTION ERROR:', error);
      this._sweepSkinResults.push(`ERROR: ${error}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  AUTOMATIC DEFORMATION MEASUREMENT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Find the SkinnedMesh driven by the same skeleton as the facial bones.
   * Traverses up from head bone to scene root, then finds SkinnedMesh.
   */
  private discoverSkinnedMesh(): void {
    if (!this._sweepBoneMap?.head) {
      this.postDebug('[FaceMeasure] ERROR: No head bone — cannot find SkinnedMesh');
      return;
    }

    // Walk up to scene root
    let walker: THREE.Object3D = this._sweepBoneMap.head;
    let depth = 0;
    while (walker.parent) {
      walker = walker.parent;
      depth++;
      if (depth > 20) break;
    }

    // Find SkinnedMesh with a skeleton
    let mesh: THREE.SkinnedMesh | null = null;
    walker.traverse((child) => {
      if (!mesh && (child as THREE.SkinnedMesh).isSkinnedMesh) {
        const sk = (child as THREE.SkinnedMesh).skeleton;
        if (sk && sk.bones.length > 0) mesh = child as THREE.SkinnedMesh;
      }
    });

    if (!mesh || !mesh.skeleton) {
      this.postDebug('[FaceMeasure] ERROR: No SkinnedMesh found for Mint');
      return;
    }

    const geometry = mesh.geometry;
    const skinIdx = geometry.getAttribute('skinIndex');
    const skinWt = geometry.getAttribute('skinWeight');
    const posAttr = geometry.getAttribute('position');

    if (!skinIdx || !skinWt || !posAttr) {
      this.postDebug('[FaceMeasure] ERROR: SkinnedMesh missing skinIndex/skinWeight/position');
      return;
    }

    this._measureMesh = mesh;
    this._measureSkinIndices = skinIdx as THREE.BufferAttribute;
    this._measureSkinWeights = skinWt as THREE.BufferAttribute;
    this._measureVertexCount = posAttr.count;
    this._measureBoneCount = mesh.skeleton.bones.length;

    // Capture bind-pose bone matrices (4×4 per bone)
    mesh.skeleton.update();
    this._measureBindBoneMatrices = new Float32Array(mesh.skeleton.boneMatrices);

    // Compute bind-pose skinned positions for all vertices
    this._measureBindPositions = this.computeSkinnedPositions(
      mesh, posAttr, skinIdx as THREE.BufferAttribute, skinWt as THREE.BufferAttribute,
      this._measureBindBoneMatrices, mesh.skeleton.bones.length,
    );

    this.postDebug(`[FaceMeasure] Mesh: "${mesh.name || '(unnamed)'}"`);
    this.postDebug(`[FaceMeasure] Vertices: ${this._measureVertexCount}`);
    this.postDebug(`[FaceMeasure] Skeleton bones: ${this._measureBoneCount}`);
  }

  /**
   * Compute skinned vertex positions from raw geometry + bone matrices.
   * Uses the same math as Three.js SkinnedMesh CPU skinning.
   */
  private computeSkinnedPositions(
    mesh: THREE.SkinnedMesh,
    posAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    skinIdx: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    skinWt: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    boneMatrices: Float32Array,
    boneCount: number,
  ): Float32Array {
    const vertexCount = posAttr.count;
    const result = new Float32Array(vertexCount * 3);
    const bonesPerVertex = skinIdx.itemSize;
    const bindMatrix = mesh.bindMatrix;
    const bindMatrixInv = mesh.bindMatrixInverse;

    const _v = new THREE.Vector3();
    const _skinned = new THREE.Vector3();
    const _boneMat = new THREE.Matrix4();

    for (let vi = 0; vi < vertexCount; vi++) {
      _v.set(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
      _skinned.set(0, 0, 0);

      for (let j = 0; j < bonesPerVertex; j++) {
        const idx = vi * bonesPerVertex + j;
        const boneIndex = skinIdx.array[idx];
        const weight = skinWt.array[idx];
        if (weight <= 0 || boneIndex >= boneCount) continue;

        // Read 4×4 matrix from flat array
        const offset = boneIndex * 16;
        _boneMat.fromArray(boneMatrices, offset);

        // vertex * bindMatrixInv * boneMatrix * bindMatrix * weight
        _skinned.addScaledVector(
          _v.clone().applyMatrix4(bindMatrixInv).applyMatrix4(_boneMat).applyMatrix4(bindMatrix),
          weight,
        );
      }

      result[vi * 3] = _skinned.x;
      result[vi * 3 + 1] = _skinned.y;
      result[vi * 3 + 2] = _skinned.z;
    }

    return result;
  }

  /**
   * Measure vertex displacement between bind-pose and current pose.
   * Returns mean/max/rms displacement and count of moved vertices.
   */
  private measureDisplacement(): { mean: number; max: number; rms: number; movedVerts: number } {
    if (!this._measureMesh || !this._measureBindPositions || !this._measureSkinIndices || !this._measureSkinWeights) {
      return { mean: 0, max: 0, rms: 0, movedVerts: 0 };
    }

    const mesh = this._measureMesh;
    const geometry = mesh.geometry;
    const posAttr = geometry.getAttribute('position');

    // Update skeleton with current bone transforms
    mesh.skeleton.update();
    const currentBoneMatrices = mesh.skeleton.boneMatrices;

    // Compute current skinned positions
    const currentPositions = this.computeSkinnedPositions(
      mesh, posAttr, this._measureSkinIndices, this._measureSkinWeights,
      currentBoneMatrices, mesh.skeleton.bones.length,
    );

    const bindPos = this._measureBindPositions;
    const vertexCount = this._measureVertexCount;
    const THRESHOLD = 0.0001; // minimum displacement to count as "moved"

    let totalDisp = 0;
    let maxDisp = 0;
    let sumSqDisp = 0;
    let movedVerts = 0;

    for (let vi = 0; vi < vertexCount; vi++) {
      const i3 = vi * 3;
      const dx = currentPositions[i3] - bindPos[i3];
      const dy = currentPositions[i3 + 1] - bindPos[i3 + 1];
      const dz = currentPositions[i3 + 2] - bindPos[i3 + 2];
      const disp = Math.sqrt(dx * dx + dy * dy + dz * dz);

      totalDisp += disp;
      sumSqDisp += disp * disp;
      if (disp > maxDisp) maxDisp = disp;
      if (disp > THRESHOLD) movedVerts++;
    }

    const mean = vertexCount > 0 ? totalDisp / vertexCount : 0;
    const rms = vertexCount > 0 ? Math.sqrt(sumSqDisp / vertexCount) : 0;

    return { mean, max: maxDisp, rms, movedVerts };
  }

  /**
   * Measure vertex displacement for a SPECIFIC bone's influence region only.
   * Only counts vertices where the tested bone has skin weight > 0.01.
   * This filters out skeleton hierarchy noise and measures actual local deformation.
   */
  private measureDisplacementForBone(bone: THREE.Object3D): {
    mean: number; max: number; rms: number; movedVerts: number;
    boneLocalMean: number; boneLocalMax: number; boneVerts: number;
  } {
    const global = this.measureDisplacement();

    if (!this._measureMesh || !this._measureSkinIndices || !this._measureSkinWeights) {
      return { ...global, boneLocalMean: 0, boneLocalMax: 0, boneVerts: 0 };
    }

    const mesh = this._measureMesh;
    const skeleton = mesh.skeleton;
    const geometry = mesh.geometry;
    const skinIdx = this._measureSkinIndices;
    const skinWt = this._measureSkinWeights;
    const posAttr = geometry.getAttribute('position');

    // Find this bone's index in the skeleton
    const boneIdx = skeleton.bones.indexOf(bone as THREE.Bone);
    if (boneIdx === -1) {
      return { ...global, boneLocalMean: 0, boneLocalMax: 0, boneVerts: 0 };
    }

    // Recompute current skinned positions
    skeleton.update();
    const currentPositions = this.computeSkinnedPositions(
      mesh, posAttr, skinIdx, skinWt, skeleton.boneMatrices, skeleton.bones.length,
    );

    const bindPos = this._measureBindPositions!;
    const vertexCount = this._measureVertexCount;
    const bonesPerVertex = skinIdx.itemSize;
    const BONE_WEIGHT_THRESHOLD = 0.01;

    let boneTotalDisp = 0;
    let boneMaxDisp = 0;
    let boneVerts = 0;

    for (let vi = 0; vi < vertexCount; vi++) {
      // Check if this vertex has meaningful weight on the tested bone
      let hasBoneWeight = false;
      for (let w = 0; w < bonesPerVertex; w++) {
        const idx = vi * bonesPerVertex + w;
        if (skinIdx.array[idx] === boneIdx && skinWt.array[idx] > BONE_WEIGHT_THRESHOLD) {
          hasBoneWeight = true;
          break;
        }
      }
      if (!hasBoneWeight) continue;

      const i3 = vi * 3;
      const dx = currentPositions[i3] - bindPos[i3];
      const dy = currentPositions[i3 + 1] - bindPos[i3 + 1];
      const dz = currentPositions[i3 + 2] - bindPos[i3 + 2];
      const disp = Math.sqrt(dx * dx + dy * dy + dz * dz);

      boneTotalDisp += disp;
      if (disp > boneMaxDisp) boneMaxDisp = disp;
      boneVerts++;
    }

    const boneLocalMean = boneVerts > 0 ? boneTotalDisp / boneVerts : 0;
    const boneLocalMax = boneMaxDisp;

    return {
      mean: global.mean, max: global.max, rms: global.rms, movedVerts: global.movedVerts,
      boneLocalMean, boneLocalMax, boneVerts,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  SWEEP ANIMATION (EXTREME DIAGNOSTIC)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Run one step of the facial deformation test.
   * Rotation-only: ±60° on X, Y, Z for each bone.
   * Called from update() when test is active.
   */
  private runFacialBoneSweep(delta: number): void {
    // Only log ENTERED once (too verbose every frame)
    if (!this._logEntered) {
      this._logEntered = true;
      this.postDebug(`[FaceTest] ENTERED runFacialBoneSweep() instance=${this._instanceId}`);
    }
    if (!this._sweepActive || this._sweepBones.length === 0) {
      this.postDebug('[FaceTest] SWEEP ABORT: _sweepActive=' + this._sweepActive + ' bones=' + this._sweepBones.length);
      return;
    }

    const bone = this._sweepBones[this._sweepBoneIdx];
    const axes: SweepAxis[] = ['X', 'Y', 'Z'];
    const axis = axes[this._sweepAxisIdx];
    const axisLower = axis.toLowerCase() as 'x' | 'y' | 'z';
    const maxRotRad = FACE_TEST_ROT_DEG * Math.PI / 180;
    const signLabel = this._sweepSign > 0 ? 'POS' : 'NEG';
    const testNum = this._sweepTestNum;
    const total = this._sweepTotalTests;

    if (this._sweepPhase === 'hold') {
      // HOLD phase: apply rotation
      this._sweepTargetVal = this._sweepSign * maxRotRad;

      // Log on first frame of hold
      if (this._sweepTimer === 0) {
        if (this._sweepTestNum === 0) {
          this.postDebug(`[FaceTest] ABOUT TO START TEST 1/${total}`);
        }
        this._sweepTestNum++;
        this.postDebug(`[FaceTest] TEST ${testNum + 1}/${total} START ${bone.name} ROT ${axis} ${signLabel} (${this._sweepSign * FACE_TEST_ROT_DEG}°)`);
      }
    } else {
      // REST phase: return to bind
      this._sweepTargetVal = 0;
    }

    // Smooth interpolation
    const smoothingAlpha = 1 - Math.exp(-14 * delta);
    this._sweepCurrentVal += (this._sweepTargetVal - this._sweepCurrentVal) * smoothingAlpha;

    // Apply rotation to bone (from bind pose)
    bone.bone.quaternion.copy(bone.bindQuat);
    if (Math.abs(this._sweepCurrentVal) > 0.0001) {
      _tmpEuler.set(0, 0, 0);
      _tmpEuler[axisLower] = this._sweepCurrentVal;
      _tmpQuat.setFromEuler(_tmpEuler);
      bone.bone.quaternion.multiply(_tmpQuat);
    }

    // Force matrix update so skeleton picks up the change
    bone.bone.updateMatrix();
    bone.bone.matrixWorldNeedsUpdate = true;
    this.forceWorldMatrixUpdate(bone.bone);

    // Advance timer
    this._sweepTimer += delta;
    const duration = this._sweepPhase === 'hold' ? FACE_TEST_HOLD_DURATION : FACE_TEST_REST_DURATION;

    if (this._sweepTimer >= duration) {
      this._sweepTimer = 0;

      if (this._sweepPhase === 'hold') {
        // Hold done → MEASURE, log END, then rest
        if (this._measureMesh && this._measureBindPositions) {
          const m = this.measureDisplacementForBone(bone.bone);
          const signStr = this._sweepSign > 0 ? '+' : '-';
          this.postDebug(`[FaceMeasure] ${bone.name} ${axis}${signStr} boneLocal=${m.boneLocalMean.toFixed(4)} boneLocalMax=${m.boneLocalMax.toFixed(4)} globalMean=${m.mean.toFixed(4)} globalMax=${m.max.toFixed(4)} boneVerts=${m.boneVerts} totalMoved=${m.movedVerts}`);
          this._measureResults.push({
            bone: bone.name, axis, sign: this._sweepSign,
            mean: m.mean, max: m.max, rms: m.rms, movedVerts: m.movedVerts,
            boneLocalMean: m.boneLocalMean, boneLocalMax: m.boneLocalMax, boneVerts: m.boneVerts,
          });
        }
        this.postDebug(`[FaceTest] TEST ${testNum + 1}/${total} END ${bone.name} ROT ${axis} ${signLabel}`);
        this._sweepPhase = 'rest';
      } else {
        // Rest done → restore bind, then next test
        bone.bone.quaternion.copy(bone.bindQuat);
        this._sweepCurrentVal = 0;
        this._sweepPhase = 'hold';

        if (this._sweepSign > 0) {
          // Was +1, now do -1 on same axis
          this._sweepSign = -1;
        } else {
          // Was -1, done with this axis → next axis
          this._sweepSign = 1;

          if (this._sweepAxisIdx < axes.length - 1) {
            this._sweepAxisIdx++;
          } else {
            // All 3 axes done for this bone
            this.postDebug(`[FaceTest] COMPLETE ${bone.name}`);
            this._sweepAxisIdx = 0;
            this._sweepBoneIdx++;

            if (this._sweepBoneIdx >= this._sweepBones.length) {
              this.finishSweep();
              return;
            }
          }
        }
      }
    }
  }

  /**
   * Finish the test: restore all bones and print summary.
   */
  private finishSweep(): void {
    this._sweepActive = false;

    // Restore ALL tested bones to exact bind quaternion
    for (const entry of this._sweepBones) {
      entry.bone.quaternion.copy(entry.bindQuat);
      entry.bone.position.copy(entry.bindPos);
    }

    this.postDebug('[FaceTest]');
    this.postDebug('[FaceTest] =================================');
    this.postDebug('[FaceTest] SWEEP COMPLETE');
    this.postDebug(`[FaceTest] ${this._sweepTotalTests}/${this._sweepTotalTests} TESTS COMPLETED`);
    this.postDebug('[FaceTest] =================================');

    // ─── FINAL MEASUREMENT RESULTS ─────────────────
    if (this._measureResults.length > 0) {
      this.postDebug('[FaceMeasure]');
      this.postDebug('[FaceMeasure] ===== FINAL RESULTS (sorted by bone-local max) =====');

      // Sort by bone-local max displacement, highest first
      const sorted = [...this._measureResults].sort((a, b) => b.boneLocalMax - a.boneLocalMax);

      for (let i = 0; i < sorted.length; i++) {
        const r = sorted[i];
        const signStr = r.sign > 0 ? '+' : '-';
        this.postDebug(`[FaceMeasure] #${i + 1} ${r.bone} ${r.axis}${signStr} boneLocalMax=${r.boneLocalMax.toFixed(4)} boneLocalMean=${r.boneLocalMean.toFixed(4)} boneVerts=${r.boneVerts}`);
      }

      this.postDebug('[FaceMeasure]');
      this.postDebug('[FaceMeasure] TOP 10 MOST EFFECTIVE BONE-LOCAL CONTROLS');
      const top10 = sorted.slice(0, 10);
      for (let i = 0; i < top10.length; i++) {
        const r = top10[i];
        const signStr = r.sign > 0 ? '+' : '-';
        this.postDebug(`[FaceMeasure]   ${i + 1}. ${r.bone} ${r.axis}${signStr} boneLocalMax=${r.boneLocalMax.toFixed(4)} boneLocalMean=${r.boneLocalMean.toFixed(4)} boneVerts=${r.boneVerts}`);
      }
    } else {
      this.postDebug('[FaceMeasure]');
      this.postDebug('[FaceMeasure] NO MEASUREMENTS RECORDED');
      this.postDebug('[FaceMeasure] SkinnedMesh may not have been found');
    }

    this.postDebug('[FaceMeasure]');
    this.postDebug('[FaceMeasure] MEASUREMENT COMPLETE');
    this.postDebug('[FaceMeasure] All bones restored to exact bind pose.');
    this.postDebug('[FaceTest] Re-run via: window.__testMintMouth() or click the button');
  }

  // ═══════════════════════════════════════════════════════════════
  //  UPDATE (called every frame from the renderer)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Update lip-sync each frame.
   * @param viseme - audio-derived mouth shape values
   * @param delta - frame delta time in seconds
   * @param isSpeaking - whether speech audio is currently playing
   */
  update(viseme: VisemeInput, delta: number, isSpeaking: boolean): void {
    // ─── ONE-TIME: Prove update() runs on this instance ───
    if (!this._firstUpdateLogged) {
      this._firstUpdateLogged = true;
      this.postDebug(`[FaceTest] UPDATE LOOP OWNER instance=${this._instanceId} mode=${this.mode} sweepActive=${this._sweepActive}`);
    }

    // ─── FACIAL RIG TEST: Must have priority ───
    if (this._rigActive && this._rigPhase !== 'dump' && this._rigPhase !== 'done') {
      this.runRigTest(delta);
      return;
    }

    // ─── MOUTH ASSET VISUAL TEST: Must have priority ───
    if (this._mouthVisActive) {
      this.runMouthVisTest(delta);
      return;
    }

    // ─── VISUAL MOUTH TEST: Must have priority before any mode check ───
    if (this._mouthActive) {
      this.runMouthTest(delta);
      return;
    }

    // ─── BONE RANKING: Must have priority before any mode check ───
    if (this._rankActive) {
      this.runRankTest(delta);
      return;
    }

    // ─── GPU TEST: Must have priority before any mode check ───
    if (this._gpuTestActive) {
      this.runGPUTest(delta);
      return; // Skip normal lip-sync during GPU test
    }

    // ─── MOUTH POSE TEST: Must have priority before any mode check ───
    if (this._mouthPoseTestActive) {
      this.runMouthPoseTest(delta);
      return; // Skip normal lip-sync during pose test
    }

    // ─── AXIS DISCOVERY: Must have priority before any mode check ───
    if (this._axisDiscoveryActive) {
      this.runAxisDiscovery(delta);
      return; // Skip normal lip-sync during axis discovery
    }

    // ─── OLD SWEEP: Must have priority before any mode check ───
    if (this._sweepActive && this._sweepBones.length > 0) {
      this.runFacialBoneSweep(delta);
      return; // Skip normal lip-sync during sweep
    }

    if (!this.initialized || this.mode === 'none') {
      return;
    }

    // ─── Speaking start/end ────────────────
    if (isSpeaking && !this._wasSpeaking) {
      this._wasSpeaking = true;
      const msg = `[LipSync] SPEAKING START mouthOpen=${viseme.mouthOpen.toFixed(3)} mouthWide=${viseme.mouthWide.toFixed(3)} mouthSmile=${viseme.mouthSmile.toFixed(3)}`;
      console.log(msg);
      this.postDebug(msg);
    } else if (!isSpeaking && this._wasSpeaking) {
      this._wasSpeaking = false;
      this._boneDiagLogged = false; // reset so next speech event logs again
      this._audioVisemeLogged = false; // reset so next speech logs audio viseme again
      this.postDebug('[LipSync] SPEAKING END');
    }

    if (isSpeaking && !this._audioVisemeLogged) {
      this._audioVisemeLogged = true;
      const msg = `[LipSync] AUDIO VISEME mouthOpen=${viseme.mouthOpen.toFixed(3)} mouthWide=${viseme.mouthWide.toFixed(3)} mouthSmile=${viseme.mouthSmile.toFixed(3)} config: lipDeg=${this.config.maxLipDeg} jawDeg=${this.config.maxJawDeg}`;
      console.log(msg);
      this.postDebug(msg);
    }

    const alpha = 1 - Math.exp(-this.config.smoothingSpeed * delta);

    // ─── NORMAL LIP-SYNC ───
    if (this.mode === 'morph') {
      this.updateMorph(viseme, isSpeaking, alpha);
    } else if (this.mode === 'bone') {
      // Use the new procedural mouth pose system
      if (this._calibReady) {
        // Smooth the viseme inputs
        this._smoothMouthOpen += (Math.max(0, Math.min(1, (isSpeaking ? viseme.mouthOpen * 8 : 0))) - this._smoothMouthOpen) * alpha;
        this._smoothMouthWide += (Math.max(0, Math.min(1, (isSpeaking ? viseme.mouthWide * 8 : 0))) - this._smoothMouthWide) * alpha;
        this._smoothMouthSmile += (Math.max(0, Math.min(1, (isSpeaking ? viseme.mouthSmile * 8 : 0))) - this._smoothMouthSmile) * alpha;

        this.applyMintMouthPose(this._smoothMouthOpen, this._smoothMouthWide, this._smoothMouthSmile);
      } else {
        // Calibration not ready yet, skip this frame
      }
    }

    // Diagnostics (log once while speaking)
    if (isSpeaking && !this.diagLogged) {
      this.diagTimer += delta;
      if (this.diagTimer >= 0.5) {
        this.diagTimer = 0;
        this.logDiagnostics(viseme);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  MORPH TARGET MODE
  // ═══════════════════════════════════════════════════════════════

  private updateMorph(viseme: VisemeInput, isSpeaking: boolean, alpha: number): void {
    for (const entry of this.meshEntries) {
      if (!entry.mesh.morphTargetInfluences) continue;

      const openTarget = isSpeaking ? THREE.MathUtils.clamp(viseme.mouthOpen, 0, this.config.maxInfluence) : 0;
      const wideTarget = isSpeaking ? THREE.MathUtils.clamp(viseme.mouthWide, 0, this.config.maxInfluence) : 0;
      const smileTarget = isSpeaking ? THREE.MathUtils.clamp(viseme.mouthSmile * 0.3, 0, this.config.maxInfluence) : 0;

      this.applyMappings(entry.openMappings, entry.mesh, openTarget, alpha);
      this.applyMappings(entry.wideMappings, entry.mesh, wideTarget, alpha);
      this.applyMappings(entry.smileMappings, entry.mesh, smileTarget, alpha);
    }
  }

  private applyMappings(mappings: MorphMapping[], mesh: THREE.Mesh, target: number, alpha: number): void {
    for (const m of mappings) {
      m.target = target;
      m.current += (m.target - m.current) * alpha;
      if (mesh.morphTargetInfluences) {
        mesh.morphTargetInfluences[m.idx] = m.current;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  BONE MODE (normal lip-sync, NOT the sweep)
  // ═══════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════
  //  PROCEDURAL MINT MOUTH POSE SYSTEM
  // ═══════════════════════════════════════════════════════════════

  /**
   * Calibrate each facial bone: determine which local axis+sign produces
   * movement in the anatomically-correct mouth-opening direction.
   * Uses small angles (±2°, ±3°) and measures only bone-weighted vertices.
   */
  calibrateFacialBones(): void {
    if (this.mode !== 'bone') {
      this.postDebug('[MintMouth] CALIBRATION SKIPPED — mode is not bone');
      return;
    }

    const allChannels = [
      this.jawChannel, this.lipUpperChannel, this.lipLowerChannel,
      this.cornerLChannel, this.cornerRChannel,
      this.lipUpperLChannel, this.lipUpperRChannel,
      this.lipLowerLChannel, this.lipLowerRChannel,
      this.colipLChannel, this.colipRChannel,
    ];
    if (allChannels.every(ch => !ch)) {
      this.postDebug('[MintMouth] CALIBRATION SKIPPED — no bones');
      return;
    }

    // Capture bind poses for every channel
    for (const ch of allChannels) {
      if (!ch) continue;
      const bone = ch.bone;
      // Ensure world matrix is current so we can derive directions
      bone.updateMatrixWorld(true);
      this._calibBones.set(bone.name, {
        bone,
        bindQuat: bone.quaternion.clone(),
        bindPos: bone.position.clone(),
        bindScale: bone.scale.clone(),
        calibratedAxis: 'x',
        calibratedSign: 1,
        openDeg: 20,
        wideDeg: 15,
        smileDeg: 10,
        localVertIdx: [],
      });
    }

    // Discover the SkinnedMesh and compute reference directions
    this.discoverSkinnedMesh();
    const mesh = this._measureMesh;
    if (!mesh || !mesh.skeleton) {
      this.postDebug('[MintMouth] CALIBRATION ERROR: No SkinnedMesh');
      return;
    }

    const skeleton = mesh.skeleton;
    const skinIdx = this._measureSkinIndices;
    const skinWt = this._measureSkinWeights;
    if (!skinIdx || !skinWt) {
      this.postDebug('[MintMouth] CALIBRATION ERROR: No skin attributes');
      return;
    }

    // Compute upper→lower lip direction in world space
    const upBone = this.findBoneByName('Bon_uplip_M');
    const loBone = this.findBoneByName('Bon_Lolip_M');
    let computedDir = false;
    if (upBone && loBone) {
      upBone.updateMatrixWorld(true);
      loBone.updateMatrixWorld(true);
      const upPos = new THREE.Vector3();
      const loPos = new THREE.Vector3();
      upBone.getWorldPosition(upPos);
      loBone.getWorldPosition(loPos);
      this._calibUpperToLower.copy(loPos).sub(upPos);
      if (this._calibUpperToLower.length() > 0.001) {
        this._calibUpperToLower.normalize();
        computedDir = true;
      }
    }

    // Face forward: use mouth bone -Z or head bone -Z
    const mouthBone = this.findBoneByName('mouth');
    if (mouthBone) {
      mouthBone.updateMatrixWorld(true);
      const m = mouthBone.matrixWorld;
      this._calibFaceForward.set(-m.elements[8], -m.elements[9], -m.elements[10]).normalize();
      if (this._calibFaceForward.length() > 0.001) computedDir = true;
    }

    // If no mouth bone, use head
    if (!computedDir && this._sweepBoneMap?.head) {
      const head = this._sweepBoneMap.head;
      head.updateMatrixWorld(true);
      const m = head.matrixWorld;
      this._calibFaceForward.set(-m.elements[8], -m.elements[9], -m.elements[10]).normalize();
      if (this._calibFaceForward.length() > 0.001) computedDir = true;
    }

    // Default direction if all else fails: +Y (downward in typical 3D coords)
    if (!computedDir) {
      this._calibUpperToLower.set(0, 1, 0);
      this._calibFaceForward.set(0, 0, 1);
    }

    // Wide direction = cross(upperToLower, faceForward)
    const wideDir = new THREE.Vector3().crossVectors(this._calibUpperToLower, this._calibFaceForward).normalize();
    // Smile direction = cross(wide, upperToLower) — should point upward
    const smileDir = new THREE.Vector3().crossVectors(wideDir, this._calibUpperToLower).normalize();
    // Ensure smileDir points upward (positive Y); flip if needed
    if (smileDir.y < 0) smileDir.negate();

    // Transform expected directions to local space (mesh-local)
    mesh.updateMatrixWorld(true);
    const worldInv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const localOpenDir = new THREE.Vector3().copy(this._calibUpperToLower).applyMatrix4(worldInv);
    const localWideDir = new THREE.Vector3().copy(wideDir).applyMatrix4(worldInv);
    const localSmileDir = new THREE.Vector3().copy(smileDir).applyMatrix4(worldInv);

    const bpv = skinIdx.itemSize;
    const vcount = this._measureVertexCount;

    // For each channel, find its local vertex indices and calibrate
    let calibratedCount = 0;
    for (const ch of allChannels) {
      if (!ch) continue;
      const bone = ch.bone;
      const entry = this._calibBones.get(bone.name);
      if (!entry) continue;

      const boneIdx = skeleton.bones.indexOf(bone as THREE.Bone);
      if (boneIdx === -1) {
        this.postDebug(`[MintMouth] CALIB ${bone.name}: not in skeleton`);
        continue;
      }

      // Collect local vertex indices weighted to this bone
      const localVerts: number[] = [];
      for (let v = 0; v < vcount; v++) {
        for (let w = 0; w < bpv; w++) {
          const idx = v * bpv + w;
          if (skinIdx.array[idx] === boneIdx && skinWt.array[idx] > 0.05) {
            localVerts.push(v);
            break;
          }
        }
      }
      entry.localVertIdx = localVerts;
      if (localVerts.length === 0) {
        this.postDebug(`[MintMouth] CALIB ${bone.name}: no weighted verts`);
        continue;
      }

      // Determine which direction this bone should move for opening
      let expectedLocalDir = localOpenDir;
      const name = bone.name;
      if (name === 'Bon_uplip_M' || name.includes('uplip')) {
        // Upper lip: move AWAY from lower lip = -openDir
        expectedLocalDir = localOpenDir.clone().negate();
      } else if (name === 'Bon_Lolip_M' || name.includes('Lolip')) {
        // Lower lip: move TOWARD lower lip = +openDir
        expectedLocalDir = localOpenDir.clone();
      } else if (name === 'Bon_yachi_lo' || name === 'Bon_yachi_up') {
        // Jaw: move downward = +openDir
        expectedLocalDir = localOpenDir.clone();
      } else if (name === 'Bon_colip_L' || name === 'Bon_colip_R') {
        // Corners: wide direction (outward). Left vs right?
        const isLeft = name.includes('_L');
        expectedLocalDir = isLeft ? localWideDir.clone().negate() : localWideDir.clone();
      } else if (name === 'Bon_zuiba_L' || name === 'Bon_zuiba_R') {
        // Zuiba: smile direction (upward)
        expectedLocalDir = localSmileDir.clone();
        const isLeft = name.includes('_L');
        if (isLeft) expectedLocalDir.negate();
      }

      // Calibrate: try each local axis at ±2° and ±3°, pick best
      const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z'];
      let bestAxis: 'x' | 'y' | 'z' = 'x';
      let bestSign: 1 | -1 = 1;
      let bestScore = -Infinity;

      const scratchPos = new THREE.Vector3();
      const scratchDelta = new THREE.Vector3();
      const tmpQuat = new THREE.Quaternion();
      const tmpEuler = new THREE.Euler();
      const boneMat = new THREE.Matrix4();

      for (const axis of axes) {
        for (const sign of [-1, 1]) {
          const angle = sign * 2; // degrees
          const rad = angle * Math.PI / 180;

          // Apply rotation from bind pose
          bone.quaternion.copy(entry.bindQuat);
          tmpEuler.set(0, 0, 0);
          tmpEuler[axis] = rad;
          tmpQuat.setFromEuler(tmpEuler);
          bone.quaternion.multiply(tmpQuat);

          // Force matrix updates
          bone.updateMatrix();
          bone.matrixWorldNeedsUpdate = true;
          this.forceWorldMatrixUpdate(bone);
          skeleton.update();

          // Compute current skinned positions
          const cur = this.computeSkinnedPositions(mesh,
            mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
            skinIdx, skinWt, skeleton.boneMatrices, skeleton.bones.length);

          // Compute weighted centroid displacement in expected local direction
          let totalDisp = 0;
          let totalWeight = 0;
          for (const vi of localVerts) {
            const i3 = vi * 3;
            // Find the weight for this bone at this vertex
            let weight = 0;
            for (let w2 = 0; w2 < bpv; w2++) {
              const sidx = vi * bpv + w2;
              if (skinIdx.array[sidx] === boneIdx) {
                weight = skinWt.array[sidx];
                break;
              }
            }
            if (weight <= 0) continue;
            scratchPos.set(cur[i3], cur[i3 + 1], cur[i3 + 2]);
            scratchDelta.copy(scratchPos).sub(entry.bindPos);
            // Displacement in local space; project onto expected local dir
            totalDisp += scratchDelta.dot(expectedLocalDir) * weight;
            totalWeight += weight;
          }

          const score = totalWeight > 0 ? totalDisp / totalWeight : 0;
          if (score > bestScore) {
            bestScore = score;
            bestAxis = axis;
            bestSign = sign as 1 | -1;
          }
        }
      }

      // Restore bind pose
      bone.quaternion.copy(entry.bindQuat);
      bone.updateMatrix();
      bone.matrixWorldNeedsUpdate = true;
      this.forceWorldMatrixUpdate(bone);
      skeleton.update();

      entry.calibratedAxis = bestAxis;
      entry.calibratedSign = bestSign as 1 | -1;
      // Set max degrees based on bone type
      if (name === 'Bon_yachi_lo') {
        entry.openDeg = 25;
      } else if (name === 'Bon_yachi_up') {
        entry.openDeg = 12;
      } else if (name.includes('uplip')) {
        entry.openDeg = 18;
      } else if (name.includes('Lolip')) {
        entry.openDeg = 22;
      } else if (name === 'Bon_colip_L' || name === 'Bon_colip_R') {
        entry.wideDeg = 18;
        entry.smileDeg = 12;
      } else if (name === 'Bon_zuiba_L' || name === 'Bon_zuiba_R') {
        entry.smileDeg = 15;
      }

      calibratedCount++;
      this.postDebug(`[MintMouth] CALIB ${bone.name}: axis=${bestAxis} sign=${bestSign > 0 ? '+' : '-'} score=${bestScore.toFixed(4)} openDeg=${entry.openDeg} wideDeg=${entry.wideDeg} smileDeg=${entry.smileDeg}`);
    }

    // Post-calibration fix: DISABLED - using manual X-axis angles in applyMintMouthPose instead.
    // this.fixLipBoneAxes();

    this._calibReady = true;
    this.postDebug('[MintMouth] CALIBRATION COMPLETE — ' + calibratedCount + ' bones calibrated');
    this.postDebug('[MintMouth] OPEN POSE READY');
    this.postDebug('');
  }

  /**
   * Targeted fix: Lip bones were calibrated to Z-axis but this causes lip twisting.
   * Test X-axis (±2°) on each lip bone to find the sign that moves vertices vertically.
   * Upper lip should move UP (away from lower lip), lower lip should move DOWN.
   */
  private fixLipBoneAxes(): void {
    if (!this._measureMesh || !this._measureSkinIndices || !this._measureSkinWeights || !this._measureBindPositions) {
      this.postDebug('[MintMouth] FIX: SkinnedMesh not available, skipping axis fix');
      return;
    }

    const mesh = this._measureMesh;
    const skeleton = mesh.skeleton;
    const skinIdx = this._measureSkinIndices;
    const skinWt = this._measureSkinWeights;
    const bpv = skinIdx.itemSize;

    const lipBoneNames = [
      'Bon_uplip_M', 'Bon_uplip01_L', 'Bon_uplip01_R',
      'Bon_Lolip_M', 'Bon_Lolip01_L', 'Bon_Lolip01_R',
    ];

    for (const boneName of lipBoneNames) {
      const entry = this._calibBones.get(boneName);
      if (!entry) continue;

      const bone = entry.bone;
      const boneIdx = skeleton.bones.indexOf(bone as THREE.Bone);
      if (boneIdx === -1) continue;

      const isUpper = boneName.includes('uplip');
      // Expected vertical direction in MESH-local space: up for upper lip, down for lower lip
      // The calibration computed _calibUpperToLower as upper->lower (downward) in WORLD space
      // So upper lip should move opposite (UP = -dir), lower lip should move DOWN (+dir)
      // We'll measure displacement in MESH-LOCAL space for consistency
      const meshInv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
      const expectedDirWorld = isUpper 
        ? this._calibUpperToLower.clone().negate()
        : this._calibUpperToLower.clone();
      const expectedDir = expectedDirWorld.clone().applyMatrix4(meshInv).normalize();

      // Test X-axis at ±2°
      let bestSign: 1 | -1 = 1;
      let bestScore = -Infinity;

      for (const sign of [-1, 1]) {
        const rad = sign * 2 * Math.PI / 180;

        bone.quaternion.copy(entry.bindQuat);
        const tmpEuler = new THREE.Euler(rad, 0, 0, 'XYZ');
        const tmpQuat = new THREE.Quaternion().setFromEuler(tmpEuler);
        bone.quaternion.multiply(tmpQuat);

        bone.updateMatrix();
        bone.matrixWorldNeedsUpdate = true;
        this.forceWorldMatrixUpdate(bone);
        skeleton.update();

        const cur = this.computeSkinnedPositions(mesh,
          mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
          skinIdx, skinWt, skeleton.boneMatrices, skeleton.bones.length);

        let totalDisp = 0;
        let totalWeight = 0;
        for (const vi of entry.localVertIdx) {
          const i3 = vi * 3;
          let weight = 0;
          for (let w2 = 0; w2 < bpv; w2++) {
            const sidx = vi * bpv + w2;
            if (skinIdx.array[sidx] === boneIdx) {
              weight = skinWt.array[sidx];
              break;
            }
          }
          if (weight <= 0) continue;
          const scratchPos = new THREE.Vector3(cur[i3], cur[i3 + 1], cur[i3 + 2]);
          // Use vertex bind position from _measureBindPositions, NOT bone position
          const bindPos = new THREE.Vector3(
            this._measureBindPositions[i3],
            this._measureBindPositions[i3 + 1],
            this._measureBindPositions[i3 + 2]
          );
          const scratchDelta = scratchPos.clone().sub(bindPos).applyMatrix4(meshInv);
          totalDisp += scratchDelta.dot(expectedDir) * weight;
          totalWeight += weight;
        }

        const score = totalWeight > 0 ? totalDisp / totalWeight : 0;
        if (score > bestScore) {
          bestScore = score;
          bestSign = sign as 1 | -1;
        }
      }

      // Restore bind pose
      bone.quaternion.copy(entry.bindQuat);
      bone.updateMatrix();
      bone.matrixWorldNeedsUpdate = true;
      this.forceWorldMatrixUpdate(bone);
      skeleton.update();

      // Override to X-axis with the correct sign for vertical movement
      const oldAxis = entry.calibratedAxis;
      const oldSign = entry.calibratedSign;
      entry.calibratedAxis = 'x';
      entry.calibratedSign = bestSign;

      // Also measure vertical displacement per degree on X-axis to set appropriate openDeg
      // Test at ±3° to get a better estimate, then scale to achieve ~4mm vertical separation at 100%
      const testRad = bestSign * 3 * Math.PI / 180;
      bone.quaternion.copy(entry.bindQuat);
      const tmpEuler2 = new THREE.Euler(testRad, 0, 0, 'XYZ');
      const tmpQuat2 = new THREE.Quaternion().setFromEuler(tmpEuler2);
      bone.quaternion.multiply(tmpQuat2);

      bone.updateMatrix();
      bone.matrixWorldNeedsUpdate = true;
      this.forceWorldMatrixUpdate(bone);
      skeleton.update();

      const cur2 = this.computeSkinnedPositions(mesh,
        mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
        skinIdx, skinWt, skeleton.boneMatrices, skeleton.bones.length);

      let totalDisp2 = 0;
      let totalWeight2 = 0;
      for (const vi of entry.localVertIdx) {
        const i3 = vi * 3;
        let weight = 0;
        for (let w2 = 0; w2 < bpv; w2++) {
          const sidx = vi * bpv + w2;
          if (skinIdx.array[sidx] === boneIdx) {
            weight = skinWt.array[sidx];
            break;
          }
        }
        if (weight <= 0) continue;
        const scratchPos = new THREE.Vector3(cur2[i3], cur2[i3 + 1], cur2[i3 + 2]);
        // Use vertex bind position from _measureBindPositions, NOT bone position
        const bindPos = new THREE.Vector3(
          this._measureBindPositions[i3],
          this._measureBindPositions[i3 + 1],
          this._measureBindPositions[i3 + 2]
        );
        const scratchDelta = scratchPos.clone().sub(bindPos).applyMatrix4(meshInv);
        totalDisp2 += scratchDelta.dot(expectedDir) * weight;
        totalWeight2 += weight;
      }

      const dispPerDeg = totalWeight2 > 0 ? (totalDisp2 / totalWeight2) / 3 : 0; // per degree
      // Target: ~4mm vertical movement per lip at 100% (combined ~8mm opening)
      const targetDisp = 0.004; // 4mm
      const newOpenDeg = dispPerDeg > 0 ? Math.min(targetDisp / dispPerDeg, 30) : entry.openDeg;

      // Detailed logging for secondary lip bones
      const isSecondary = boneName.includes('01_');
      if (isSecondary) {
        this.postDebug(`[SECONDARY CALIB] bone=${boneName} axis=x sign=${bestSign > 0 ? '+' : '-'} testAngleDeg=3 verticalDispTotal=${totalDisp2.toFixed(6)} totalWeight=${totalWeight2.toFixed(3)} localVertCount=${entry.localVertIdx.length} dispPerDeg=${dispPerDeg.toFixed(6)} calculatedOpenDeg=${newOpenDeg.toFixed(4)}`);
      }

      entry.openDeg = newOpenDeg;

      // Restore bind pose
      bone.quaternion.copy(entry.bindQuat);
      bone.updateMatrix();
      bone.matrixWorldNeedsUpdate = true;
      this.forceWorldMatrixUpdate(bone);
      skeleton.update();

      this.postDebug(`[MintMouth] FIX ${boneName}: axis ${oldAxis}→x, sign ${oldSign}→${bestSign > 0 ? '+' : '-'} dispPerDeg=${dispPerDeg.toFixed(6)} openDeg=${oldAxis==='z'?entry.openDeg:newOpenDeg.toFixed(1)} (was ${oldAxis==='z'?entry.openDeg:newOpenDeg.toFixed(1)})`);
    }

    this.postDebug('[MintMouth] LIP AXIS FIX COMPLETE');
  }

  /**
   * Apply a coordinated procedural mouth pose to the calibrated facial bones.
   * @param open   0..1 — mouth opening (upper/lower lip separation + jaw)
   * @param wide   0..1 — mouth corner spread
   * @param smile  0..1 — mouth corner upward smile
   *
   * Each bone is rotated FROM ITS BIND POSE by the calibrated axis/sign,
   * weighted by the pose parameters. After applying, the full GPU update
   * chain is forced: bone.updateMatrix + ancestor world update + skeleton.update.
   */
  applyMintMouthPose(open: number, wide: number, smile: number): void {
    open = Math.max(0, Math.min(1, open));
    wide = Math.max(0, Math.min(1, wide));
    smile = Math.max(0, Math.min(1, smile));

    const DEG2RAD = Math.PI / 180;
    const tmpEuler = new THREE.Euler();
    const tmpQuat = new THREE.Quaternion();

    // Manual mouth-open angles (X-axis) - calibrated from axis discovery
    const UPPER_OPEN_DEG = 8;   // negative = upper lip moves up
    const LOWER_OPEN_DEG = 8;   // positive = lower lip moves down
    const JAW_OPEN_DEG = 4;     // capped jaw

    for (const entry of this._calibBones.values()) {
      let angleDeg = 0;
      const axis = 'x'; // All lip bones use local X for vertical opening
      const name = entry.bone.name;

      if (name === 'Bon_yachi_lo') {
        // Jaw: small contribution, capped
        angleDeg = -open * Math.min(JAW_OPEN_DEG, 8);
      } else if (name === 'Bon_yachi_up') {
        angleDeg = -open * Math.min(JAW_OPEN_DEG * 0.5, 4);
      } else if (name === 'Bon_uplip_M' || name.includes('uplip')) {
        // Upper lip: negative X moves vertices UP (increases mouth gap)
        angleDeg = -open * UPPER_OPEN_DEG;
      } else if (name === 'Bon_Lolip_M' || name.includes('Lolip')) {
        // Lower lip: positive X moves vertices DOWN (increases mouth gap)
        angleDeg = open * LOWER_OPEN_DEG;
      } else if (name === 'Bon_colip_L' || name === 'Bon_colip_R') {
        const isLeft = name.includes('_L');
        const wideSign = isLeft ? -1 : 1;
        const calibratedSign = entry.calibratedSign;
        angleDeg = calibratedSign * (wide * entry.wideDeg * wideSign + smile * entry.smileDeg);
      } else if (name === 'Bon_zuiba_L' || name === 'Bon_zuiba_R') {
        const isLeft = name.includes('_L');
        const smileSign = isLeft ? -1 : 1;
        const calibratedSign = entry.calibratedSign;
        angleDeg = calibratedSign * smile * entry.smileDeg * smileSign;
      }

      if (Math.abs(angleDeg) < 0.0001) {
        entry.bone.quaternion.copy(entry.bindQuat);
      } else {
        tmpEuler.set(0, 0, 0);
        tmpEuler[axis] = angleDeg * DEG2RAD;
        tmpQuat.setFromEuler(tmpEuler);
        entry.bone.quaternion.copy(entry.bindQuat).multiply(tmpQuat);
      }
    }

    // ─── Force GPU update chain ───
    for (const entry of this._calibBones.values()) {
      entry.bone.updateMatrix();
      entry.bone.matrixWorldNeedsUpdate = true;
    }
    // Update ancestors of each calibrated bone
    for (const entry of this._calibBones.values()) {
      this.forceWorldMatrixUpdate(entry.bone);
    }
    // Update skeleton bone matrices
    const mesh = this._measureMesh;
    if (mesh && mesh.skeleton) {
      mesh.skeleton.update();
      // Ensure the mesh itself and its ancestors are current
      mesh.updateMatrixWorld(true);
    }
    // Walk to scene root
    if (this._sweepBoneMap?.head) {
      let root = this._sweepBoneMap.head;
      while (root.parent) root = root.parent;
      root.updateMatrixWorld(true);
    }

    // Diagnostic: measure actual lip deformation at each open stage
    if (this._measureMesh) {
      this.measureMouthGapCompact(open);
    }
  }

  /**
   * Targeted diagnostic: measure actual lip deformation for the 6 lip bones at OPEN 100%.
   * Prints concise report per bone and computes mouth gap (upper vs lower lip boundary).
   */
  private measureMouthGapDiagnostic(): void {
    if (!this._measureMesh || !this._measureSkinIndices || !this._measureSkinWeights || !this._measureBindPositions) {
      this.postDebug('[MouthDiag] SkinnedMesh not available');
      return;
    }

    const mesh = this._measureMesh;
    const skeleton = mesh.skeleton;
    const skinIdx = this._measureSkinIndices;
    const skinWt = this._measureSkinWeights;
    const bpv = skinIdx.itemSize;

    // Update skeleton to get current skinned positions
    skeleton.update();
    const curPositions = this.computeSkinnedPositions(mesh,
      mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
      skinIdx, skinWt, skeleton.boneMatrices, skeleton.bones.length);

    const bindPos = this._measureBindPositions;

    const lipBoneNames = [
      'Bon_uplip_M', 'Bon_uplip01_L', 'Bon_uplip01_R',
      'Bon_Lolip_M', 'Bon_Lolip01_L', 'Bon_Lolip01_R',
    ];

    this.postDebug('[MouthDiag] ═══ OPEN 100% DEFORMATION REPORT ═══');

    // For mouth gap: find representative upper/lip boundary vertices
    const upperLipVerts: { vi: number; weight: number }[] = [];
    const lowerLipVerts: { vi: number; weight: number }[] = [];

    for (const boneName of lipBoneNames) {
      const entry = this._calibBones.get(boneName);
      if (!entry) continue;

      const bone = entry.bone;
      const boneIdx = skeleton.bones.indexOf(bone as THREE.Bone);
      if (boneIdx === -1) continue;

      const isUpper = boneName.includes('uplip');

      // Bone rotation delta from bind
      const bindQ = entry.bindQuat;
      const currQ = bone.quaternion;
      const deltaQ = bindQ.clone().invert().multiply(currQ);
      const deltaEuler = new THREE.Euler().setFromQuaternion(deltaQ, 'XYZ');
      const rotationDelta = {
        x: deltaEuler.x * 180 / Math.PI,
        y: deltaEuler.y * 180 / Math.PI,
        z: deltaEuler.z * 180 / Math.PI,
      };

      // Collect top-weighted visible vertices for this bone
      let weightedVerts = 0;
      let totalLocalDisp = 0;
      let totalWorldDisp = 0;
      let totalVerticalDisp = 0;
      let totalWeight = 0;

      for (const vi of entry.localVertIdx) {
        const i3 = vi * 3;
        let weight = 0;
        for (let w2 = 0; w2 < bpv; w2++) {
          const sidx = vi * bpv + w2;
          if (skinIdx.array[sidx] === boneIdx) {
            weight = skinWt.array[sidx];
            break;
          }
        }
        if (weight <= 0.01) continue; // only strongly weighted

        // Current and bind positions
        const cur = new THREE.Vector3(curPositions[i3], curPositions[i3 + 1], curPositions[i3 + 2]);
        const bnd = new THREE.Vector3(bindPos[i3], bindPos[i3 + 1], bindPos[i3 + 2]);

        // World-space delta
        const worldDelta = cur.clone().sub(bnd);
        const worldDisp = worldDelta.length();

        // Mesh-local delta (transform by inverse mesh matrix)
        const meshInv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
        const localCur = cur.clone().applyMatrix4(meshInv);
        const localBnd = bnd.clone().applyMatrix4(meshInv);
        const localDelta = localCur.clone().sub(localBnd);
        const localDisp = localDelta.length();

        // Vertical component (Y in mesh-local space)
        const verticalDisp = localDelta.y;

        totalLocalDisp += localDisp * weight;
        totalWorldDisp += worldDisp * weight;
        totalVerticalDisp += verticalDisp * weight;
        totalWeight += weight;
        weightedVerts++;

        // Collect for mouth gap measurement
        if (isUpper) {
          upperLipVerts.push({ vi, weight });
        } else {
          lowerLipVerts.push({ vi, weight });
        }
      }

      const avgLocal = totalWeight > 0 ? totalLocalDisp / totalWeight : 0;
      const avgWorld = totalWeight > 0 ? totalWorldDisp / totalWeight : 0;
      const avgVertical = totalWeight > 0 ? totalVerticalDisp / totalWeight : 0;

      this.postDebug(
        `[MouthDiag] BONE=${boneName} ` +
        `bindRot=(${bindQ.x.toFixed(4)},${bindQ.y.toFixed(4)},${bindQ.z.toFixed(4)},${bindQ.w.toFixed(4)}) ` +
        `currRot=(${currQ.x.toFixed(4)},${currQ.y.toFixed(4)},${currQ.z.toFixed(4)},${currQ.w.toFixed(4)}) ` +
        `rotDelta=(${rotationDelta.x.toFixed(2)}°,${rotationDelta.y.toFixed(2)}°,${rotationDelta.z.toFixed(2)}°) ` +
        `weightedVerts=${weightedVerts} ` +
        `avgLocalDelta=${avgLocal.toFixed(6)} ` +
        `avgWorldDelta=${avgWorld.toFixed(6)} ` +
        `verticalDelta=${avgVertical.toFixed(6)}`
      );
    }

    // Compute mouth gap: distance between upper and lower lip boundary centroids
    const meshInv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    let upperCentroid = new THREE.Vector3();
    let lowerCentroid = new THREE.Vector3();
    let upperWeight = 0, lowerWeight = 0;

    for (const { vi, weight } of upperLipVerts) {
      const i3 = vi * 3;
      const cur = new THREE.Vector3(curPositions[i3], curPositions[i3 + 1], curPositions[i3 + 2]).applyMatrix4(meshInv);
      upperCentroid.addScaledVector(cur, weight);
      upperWeight += weight;
    }
    for (const { vi, weight } of lowerLipVerts) {
      const i3 = vi * 3;
      const cur = new THREE.Vector3(curPositions[i3], curPositions[i3 + 1], curPositions[i3 + 2]).applyMatrix4(meshInv);
      lowerCentroid.addScaledVector(cur, weight);
      lowerWeight += weight;
    }

    if (upperWeight > 0) upperCentroid.divideScalar(upperWeight);
    if (lowerWeight > 0) lowerCentroid.divideScalar(lowerWeight);

    const mouthGap = upperWeight > 0 && lowerWeight > 0 ? upperCentroid.distanceTo(lowerCentroid) : 0;
    const verticalGap = upperWeight > 0 && lowerWeight > 0 ? Math.abs(upperCentroid.y - lowerCentroid.y) : 0;

    this.postDebug(`[MouthDiag] MOUTH GAP (mesh-local): distance=${mouthGap.toFixed(6)} vertical=${verticalGap.toFixed(6)}`);
    this.postDebug(`[MouthDiag] Upper centroid=(${upperCentroid.x.toFixed(4)},${upperCentroid.y.toFixed(4)},${upperCentroid.z.toFixed(4)}) weight=${upperWeight.toFixed(2)}`);
    this.postDebug(`[MouthDiag] Lower centroid=(${lowerCentroid.x.toFixed(4)},${lowerCentroid.y.toFixed(4)},${lowerCentroid.z.toFixed(4)}) weight=${lowerWeight.toFixed(2)}`);
    this.postDebug('[MouthDiag] ═══ END REPORT ═══');
  }

  /**
   * Compact mouth gap measurement for test stages.
   * Prints: stage, upperY, lowerY, verticalGap
   */
  private measureMouthGapCompact(open: number): void {
    // Only log during the active mouth-pose test. Normal lip-sync calls
    // applyMintMouthPose() every frame, which would otherwise spam
    // "[MOUTH OPEN TEST] stage=CLOSED" forever after TEST COMPLETE.
    if (!this._mouthPoseTestActive) {
      return;
    }
    if (!this._measureMesh || !this._measureSkinIndices || !this._measureSkinWeights || !this._measureBindPositions) {
      return;
    }

    const mesh = this._measureMesh;
    const skeleton = mesh.skeleton;
    const skinIdx = this._measureSkinIndices;
    const skinWt = this._measureSkinWeights;
    const bpv = skinIdx.itemSize;

    skeleton.update();
    const curPositions = this.computeSkinnedPositions(mesh,
      mesh.geometry.getAttribute('position') as THREE.BufferAttribute,
      skinIdx, skinWt, skeleton.boneMatrices, skeleton.bones.length);

    const bindPos = this._measureBindPositions;
    const meshInv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();

    const lipBoneNames = [
      'Bon_uplip_M', 'Bon_uplip01_L', 'Bon_uplip01_R',
      'Bon_Lolip_M', 'Bon_Lolip01_L', 'Bon_Lolip01_R',
    ];

    const upperLipVerts: { vi: number; weight: number }[] = [];
    const lowerLipVerts: { vi: number; weight: number }[] = [];

    for (const boneName of lipBoneNames) {
      const entry = this._calibBones.get(boneName);
      if (!entry) continue;

      const bone = entry.bone;
      const boneIdx = skeleton.bones.indexOf(bone as THREE.Bone);
      if (boneIdx === -1) continue;

      const isUpper = boneName.includes('uplip');

      for (const vi of entry.localVertIdx) {
        const i3 = vi * 3;
        let weight = 0;
        for (let w2 = 0; w2 < bpv; w2++) {
          const sidx = vi * bpv + w2;
          if (skinIdx.array[sidx] === boneIdx) {
            weight = skinWt.array[sidx];
            break;
          }
        }
        if (weight <= 0.01) continue;

        if (isUpper) {
          upperLipVerts.push({ vi, weight });
        } else {
          lowerLipVerts.push({ vi, weight });
        }
      }
    }

    let upperCentroid = new THREE.Vector3();
    let lowerCentroid = new THREE.Vector3();
    let upperWeight = 0, lowerWeight = 0;

    for (const { vi, weight } of upperLipVerts) {
      const i3 = vi * 3;
      const cur = new THREE.Vector3(curPositions[i3], curPositions[i3 + 1], curPositions[i3 + 2]).applyMatrix4(meshInv);
      upperCentroid.addScaledVector(cur, weight);
      upperWeight += weight;
    }
    for (const { vi, weight } of lowerLipVerts) {
      const i3 = vi * 3;
      const cur = new THREE.Vector3(curPositions[i3], curPositions[i3 + 1], curPositions[i3 + 2]).applyMatrix4(meshInv);
      lowerCentroid.addScaledVector(cur, weight);
      lowerWeight += weight;
    }

    if (upperWeight > 0) upperCentroid.divideScalar(upperWeight);
    if (lowerWeight > 0) lowerCentroid.divideScalar(lowerWeight);

    const verticalGap = upperWeight > 0 && lowerWeight > 0 ? (lowerCentroid.y - upperCentroid.y) : 0;

    const stageLabels: Record<number, string> = {
      0: 'CLOSED', 0.25: '25%', 0.5: '50%', 0.75: '75%', 1: '100%',
    };
    const stageLabel = stageLabels[open] ?? `${Math.round(open * 100)}%`;

    this.postDebug(`[MOUTH OPEN TEST] stage=${stageLabel} upperY=${upperCentroid.y.toFixed(6)} lowerY=${lowerCentroid.y.toFixed(6)} verticalGap=${verticalGap.toFixed(6)}`);

    // Also log delta from CLOSED at 100%
    if (open === 1.0 && this._closedVerticalGap !== undefined) {
      const delta = verticalGap - this._closedVerticalGap;
      const upperDelta = upperCentroid.y - this._closedUpperY;
      const lowerDelta = lowerCentroid.y - this._closedLowerY;
      this.postDebug(`[MOUTH OPEN TEST] stage=100 verticalGapDelta=${delta.toFixed(6)} upperDeltaY=${upperDelta.toFixed(6)} lowerDeltaY=${lowerDelta.toFixed(6)}`);
    }

    // Store CLOSED reference
    if (open === 0) {
      this._closedVerticalGap = verticalGap;
      this._closedUpperY = upperCentroid.y;
      this._closedLowerY = lowerCentroid.y;
    }
  }

  private _closedVerticalGap = 0;
  private _closedUpperY = 0;
  private _closedLowerY = 0;

  /**
   * Manual mouth pose test: cycle CLosed → 25% → 50% → 75% → 100% → Closed.
   */
  triggerMouthPoseTest(): void {
    if (this._mouthPoseTestActive) {
      this.postDebug('[MintMouth] Test already running');
      return;
    }
    if (this.mode !== 'bone') {
      this.postDebug('[MintMouth] Cannot test — mode is not bone');
      return;
    }
    if (!this._calibReady) {
      this.postDebug('[MintMouth] Must calibrate first (automatic on init)');
      return;
    }

    this._mouthPoseTestActive = true;
    this._mouthPosePhase = 'closed';
    this._mouthPoseTimer = 0;
    this._mouthPoseLastAppliedPhase = null;
    this._sweepActive = true; // pause normal lip-sync
    this._sweepBones = [];
    this.postDebug('[MintMouth] TEST START');
    this.postDebug('[MintMouth] CLOSED');
  }

  private _mouthPoseTestActive = false;
  private _mouthPosePhase: 'closed' | 'open25' | 'open50' | 'open75' | 'open100' = 'closed';
  private _mouthPoseTimer = 0;
  private _finishAfterClosed = false;
  private _mouthPoseLastAppliedPhase: string | null = null;

  runMouthPoseTest(delta: number): void {
    if (!this._mouthPoseTestActive) { this.finishMouthPoseTest(); return; }

    this._mouthPoseTimer += delta;
    const HOLD = 1.0; // seconds per pose

    // Apply the current pose ONCE per stage (applyMintMouthPose triggers
    // measureMouthGapCompact → [MOUTH OPEN TEST] log, so calling it every
    // frame caused per-frame logging spam + lag).
    let open = 0;
    if (this._mouthPosePhase === 'open25') open = 0.25;
    else if (this._mouthPosePhase === 'open50') open = 0.5;
    else if (this._mouthPosePhase === 'open75') open = 0.75;
    else if (this._mouthPosePhase === 'open100') open = 1.0;

    if (this._mouthPoseLastAppliedPhase !== this._mouthPosePhase) {
      this._mouthPoseLastAppliedPhase = this._mouthPosePhase;
      this.applyMintMouthPose(open, 0, 0);
    }

    // STOP check BEFORE normal phase-advance: final CLOSED hold complete
    // must terminate the test instead of starting another cycle.
    if (this._mouthPosePhase === 'closed' && this._finishAfterClosed && this._mouthPoseTimer >= HOLD) {
      this._mouthPoseTestActive = false;
      this._finishAfterClosed = false;
      this._mouthPoseLastAppliedPhase = null;
      this.postDebug('[MintMouth] TEST COMPLETE');
      this._sweepActive = false;
      // Restore to exact bind pose (CLOSED pose)
      for (const entry of this._calibBones.values()) {
        entry.bone.quaternion.copy(entry.bindQuat);
        entry.bone.updateMatrix();
        entry.bone.matrixWorldNeedsUpdate = true;
      }
      const mesh = this._measureMesh;
      if (mesh && mesh.skeleton) mesh.skeleton.update();
      if (this._sweepBoneMap?.head) {
        let root = this._sweepBoneMap.head;
        while (root.parent) root = root.parent;
        root.updateMatrixWorld(true);
      }
      return;
    }

    if (this._mouthPoseTimer >= HOLD) {
      this._mouthPoseTimer = 0;
      const labels: Record<string, string> = {
        closed: 'CLOSED', open25: 'OPEN 25%', open50: 'OPEN 50%',
        open75: 'OPEN 75%', open100: 'OPEN 100%',
      };
      // Advance to next phase
      if (this._mouthPosePhase === 'closed') {
        this._mouthPosePhase = 'open25';
        this.postDebug('[MintMouth] ' + labels[this._mouthPosePhase]);
      } else if (this._mouthPosePhase === 'open25') {
        this._mouthPosePhase = 'open50';
        this.postDebug('[MintMouth] ' + labels[this._mouthPosePhase]);
      } else if (this._mouthPosePhase === 'open50') {
        this._mouthPosePhase = 'open75';
        this.postDebug('[MintMouth] ' + labels[this._mouthPosePhase]);
      } else if (this._mouthPosePhase === 'open75') {
        this._mouthPosePhase = 'open100';
        this.postDebug('[MintMouth] ' + labels[this._mouthPosePhase]);
      } else if (this._mouthPosePhase === 'open100') {
        this._mouthPosePhase = 'closed';
        this.postDebug('[MintMouth] CLOSED');
        this._finishAfterClosed = true;
      }
    }
  }

  private finishMouthPoseTest(): void {
    this._mouthPoseTestActive = false;
    this._finishAfterClosed = false;
    this._mouthPoseLastAppliedPhase = null;
    this._sweepActive = false;
    // Restore bind pose
    for (const entry of this._calibBones.values()) {
      entry.bone.quaternion.copy(entry.bindQuat);
      entry.bone.updateMatrix();
      entry.bone.matrixWorldNeedsUpdate = true;
    }
    const mesh = this._measureMesh;
    if (mesh && mesh.skeleton) mesh.skeleton.update();
    if (this._sweepBoneMap?.head) {
      let root = this._sweepBoneMap.head;
      while (root.parent) root = root.parent;
      root.updateMatrixWorld(true);
    }
  }

  private forceWorldMatrixUpdate(bone: THREE.Object3D): void {
    // Walk up to root, marking each parent as needing world matrix update
    const ancestors: THREE.Object3D[] = [];
    let walker: THREE.Object3D | null = bone.parent;
    while (walker) {
      ancestors.push(walker);
      walker.updateMatrixWorld(true);
      walker = walker.parent;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  DIAGNOSTICS
  // ═══════════════════════════════════════════════════════════════

  private getIdxName(dictionary: { [key: string]: number }, idx: number): string {
    for (const [name, i] of Object.entries(dictionary)) {
      if (i === idx) return name;
    }
    return `idx:${idx}`;
  }

  private logDiagnostics(viseme: VisemeInput): void {
    this.diagLogged = true;
    console.log(`[LipSync] ═══ ACTIVE (${this.mode} mode) ═══`);
    console.log(`  mouthOpen=${viseme.mouthOpen.toFixed(3)} mouthWide=${viseme.mouthWide.toFixed(3)} mouthSmile=${viseme.mouthSmile.toFixed(3)}`);

    if (this.mode === 'morph') {
      for (const entry of this.meshEntries) {
        console.log(`  Mesh: "${entry.mesh.name}"`);
        for (const m of entry.openMappings) {
          console.log(`    OPEN  "${this.getIdxName(entry.dictionary, m.idx)}" = ${m.current.toFixed(3)}`);
        }
        for (const m of entry.wideMappings) {
          console.log(`    WIDE  "${this.getIdxName(entry.dictionary, m.idx)}" = ${m.current.toFixed(3)}`);
        }
        for (const m of entry.smileMappings) {
          console.log(`    SMILE "${this.getIdxName(entry.dictionary, m.idx)}" = ${m.current.toFixed(3)}`);
        }
      }
    } else if (this.mode === 'bone') {
      if (this.jawChannel) console.log(`  Jaw "${this.jawChannel.bone.name}" = ${(this.jawChannel.currentSmoothed * 180 / Math.PI).toFixed(1)}°`);
      if (this.lipUpperChannel) console.log(`  LipUpper "${this.lipUpperChannel.bone.name}" = ${(this.lipUpperChannel.currentSmoothed * 180 / Math.PI).toFixed(1)}°`);
      if (this.lipLowerChannel) console.log(`  LipLower "${this.lipLowerChannel.bone.name}" = ${(this.lipLowerChannel.currentSmoothed * 180 / Math.PI).toFixed(1)}°`);
      if (this.cornerLChannel) console.log(`  CornerL "${this.cornerLChannel.bone.name}" = ${(this.cornerLChannel.currentSmoothed * 180 / Math.PI).toFixed(1)}°`);
      if (this.cornerRChannel) console.log(`  CornerR "${this.cornerRChannel.bone.name}" = ${(this.cornerRChannel.currentSmoothed * 180 / Math.PI).toFixed(1)}°`);
    }
  }

  reset(): void {
    if (this.mode === 'morph') {
      for (const entry of this.meshEntries) {
        if (!entry.mesh.morphTargetInfluences) continue;
        for (const m of [...entry.openMappings, ...entry.wideMappings, ...entry.smileMappings]) {
          m.current = 0;
          m.target = 0;
          entry.mesh.morphTargetInfluences[m.idx] = 0;
        }
      }
    } else if (this.mode === 'bone') {
      const resetChannel = (ch: BoneChannel | null) => {
        if (!ch) return;
        ch.currentSmoothed = 0;
        ch.targetValue = 0;
        ch.bone.quaternion.copy(ch.bindQuat);
      };
      resetChannel(this.jawChannel);
      resetChannel(this.lipUpperChannel);
      resetChannel(this.lipLowerChannel);
      resetChannel(this.cornerLChannel);
      resetChannel(this.cornerRChannel);
      resetChannel(this.lipUpperLChannel);
      resetChannel(this.lipUpperRChannel);
      resetChannel(this.lipLowerLChannel);
      resetChannel(this.lipLowerRChannel);
      resetChannel(this.colipLChannel);
      resetChannel(this.colipRChannel);
    }

    // Also restore rig test if active
    if (this._rigActive) {
      this.finishRigTest();
    }
    // Also restore mouth asset visual test if active
    if (this._mouthVisActive) {
      this.finishMouthVisTest();
    }
    // Also restore mouth test if active
    if (this._mouthActive) {
      this.finishMouthTest();
    }
    // Also restore rank test if active
    if (this._rankActive) {
      this.finishRankTest();
    }
    // Also restore GPU test if active
    if (this._gpuTestActive) {
      this.finishGPUTest();
    }
    // Also restore sweep bones if sweep was interrupted
    if (this._sweepActive && this._sweepBones.length > 0) {
      for (const entry of this._sweepBones) {
        entry.bone.quaternion.copy(entry.bindQuat);
        entry.bone.position.copy(entry.bindPos);
      }
      this._sweepActive = false;
      console.log('[FaceSweep] Sweep interrupted — all bones restored to bind pose');
    }
    this._sweepActive = false;
  }

  isAvailable(): boolean {
    return this.initialized;
  }

  getMode(): string {
    return this.mode;
  }

  /** Whether any diagnostic test is currently running */
  isSweepActive(): boolean {
    return this._sweepActive || this._gpuTestActive || this._rankActive || this._mouthActive || this._mouthVisActive || this._rigActive;
  }

  // ═══════════════════════════════════════════════════════════════
  //  BONE RANKING DIAGNOSTIC
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start the bone-ranking diagnostic.
   * Tests all 12 candidate facial bones × 6 rotations = 72 tests.
   * Measures actual skinned vertex displacement for each.
   */
  triggerRankTest(): void {
    if (this._rankActive) {
      this.postDebug('[FaceRank] Already running');
      return;
    }
    if (this.mode !== 'bone') {
      this.postDebug('[FaceRank] Cannot rank — mode is not bone');
      return;
    }

    // Find SkinnedMesh first (needed for bone index lookup)
    this.discoverSkinnedMesh();
    if (!this._measureMesh || !this._measureSkinIndices || !this._measureSkinWeights) {
      this.postDebug('[FaceRank2] ERROR: No SkinnedMesh found');
      return;
    }

    this._rankMesh = this._measureMesh;
    this._rankSkinIdx = this._measureSkinIndices;
    this._rankSkinWt = this._measureSkinWeights;
    this._rankVertCount = this._measureVertexCount;

    // Find candidate bones and precompute bone-local vertex sets
    this._rankBones = [];
    const skeleton = this._rankMesh.skeleton;
    const skinIdx = this._rankSkinIdx;
    const skinWt = this._rankSkinWt;
    const bonesPerVert = skinIdx.itemSize;
    const WEIGHT_THRESH = 0.05;

    for (const name of LipSyncController.RANK_CANDIDATES) {
      const bone = this.findBoneByName(name);
      if (!bone) continue;

      const boneIdx = skeleton.bones.indexOf(bone as THREE.Bone);
      if (boneIdx === -1) continue;

      // Precompute which vertices have meaningful weight on this bone
      const localVerts: number[] = [];
      for (let vi = 0; vi < this._rankVertCount; vi++) {
        for (let w = 0; w < bonesPerVert; w++) {
          const idx = vi * bonesPerVert + w;
          if (skinIdx.array[idx] === boneIdx && skinWt.array[idx] >= WEIGHT_THRESH) {
            localVerts.push(vi);
            break;
          }
        }
      }

      this._rankBones.push({
        bone, name,
        bindQuat: bone.quaternion.clone(),
        boneIdx,
        localVerts,
      });
    }

    if (this._rankBones.length === 0) {
      this.postDebug('[FaceRank2] ERROR: No candidate bones found');
      return;
    }

    // Capture bind-pose skinned positions
    const mesh = this._rankMesh;
    mesh.skeleton.update();
    this._rankBindPos = this.computeSkinnedPositions(
      mesh,
      mesh.geometry.getAttribute('position'),
      this._rankSkinIdx,
      this._rankSkinWt,
      new Float32Array(mesh.skeleton.boneMatrices),
      mesh.skeleton.bones.length,
    );

    const totalTests = this._rankBones.length * LipSyncController.RANK_ROTS.length;
    this.postDebug('[FaceRank2]');
    this.postDebug(`[FaceRank2] ═══ BONE RANKING START ═══`);
    for (const b of this._rankBones) {
      this.postDebug(`[FaceRank2]   ${b.name}: boneIdx=${b.boneIdx} localVerts=${b.localVerts.length}`);
    }
    this.postDebug(`[FaceRank2] Tests: ${this._rankBones.length} bones × ${LipSyncController.RANK_ROTS.length} rotations = ${totalTests}`);
    this.postDebug('[FaceRank2]');

    // Activate
    this._rankActive = true;
    this._rankBoneIdx = 0;
    this._rankRotIdx = 0;
    this._rankPhase = 'hold';
    this._rankTimer = 0;
    this._rankResults = [];
    this.createRankOverlay();
    this._sweepActive = true; // pause normal lip-sync
    this._sweepBones = [];
  }

  /** Find a bone by name in the skeleton hierarchy. */
  private findBoneByName(name: string): THREE.Object3D | null {
    // Try the bone map first
    if (this._sweepBoneMap) {
      const bm = this._sweepBoneMap as any;
      for (const key of Object.keys(bm)) {
        const b = bm[key];
        if (b && b.name === name) return b;
      }
    }
    // Fallback: traverse scene
    if (this._rankMesh) {
      let found: THREE.Object3D | null = null;
      this._rankMesh.skeleton.bones.forEach(b => {
        if (!found && b.name === name) found = b;
      });
      if (found) return found;
    }
    // Fallback: walk from head
    if (this._sweepBoneMap?.head) {
      let root = this._sweepBoneMap.head;
      while (root.parent) root = root.parent;
      let found: THREE.Object3D | null = null;
      root.traverse(c => { if (!found && c.name === name) found = c; });
      return found;
    }
    return null;
  }

  /** Create the rank test overlay. */
  private createRankOverlay(): void {
    this.removeRankOverlay();
    const total = this._rankBones.length * LipSyncController.RANK_ROTS.length;
    const el = document.createElement('div');
    el.id = 'rank-face-test-overlay';
    el.innerHTML = `<div style="font-size:18px;font-weight:bold;">RANKING MINT FACE BONES</div><div id="rank-progress" style="font-size:14px;">0/${total}</div><div id="rank-current" style="font-size:16px;color:#ff4;"></div>`;
    Object.assign(el.style, {
      position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '999999', padding: '12px 24px', borderRadius: '12px',
      background: 'rgba(0,0,0,0.85)', color: '#fff', fontFamily: 'monospace',
      textAlign: 'center', border: '2px solid #4be3c1', pointerEvents: 'none',
    });
    document.body.appendChild(el);
    this._rankOverlay = el;
  }

  private updateRankOverlay(progress: string, current: string): void {
    if (!this._rankOverlay) return;
    const p = this._rankOverlay.querySelector('#rank-progress');
    const c = this._rankOverlay.querySelector('#rank-current');
    if (p) p.textContent = progress;
    if (c) c.textContent = current;
  }

  private removeRankOverlay(): void {
    if (this._rankOverlay) { this._rankOverlay.remove(); this._rankOverlay = null; }
    const el = document.getElementById('rank-face-test-overlay');
    if (el) el.remove();
  }

  /**
   * Measure LOCALIZED skin deformation for a specific bone after rotation.
   * Uses the rigid reference technique to cancel out global skeleton movement.
   *
   * For each vertex weighted to the tested bone:
   *   1. Compute where it would be if rigidly attached to the bone (no skinning blend)
   *   2. Compute the actual skinned position (with all bone influences blended)
   *   3. Displacement = actual - rigid reference
   *
   * This isolates the LOCAL deformation caused by the skinning weights,
   * canceling out the rigid body motion of the bone hierarchy.
   */
  private measureRankDisplacement(entry: { boneIdx: number; localVerts: number[] }): {
    mean: number; max: number; movedVerts: number; measured: number;
  } {
    if (!this._rankMesh || !this._rankBindPos || !this._rankSkinIdx || !this._rankSkinWt) {
      return { mean: 0, max: 0, movedVerts: 0, measured: 0 };
    }
    const mesh = this._rankMesh;
    const geometry = mesh.geometry;
    const posAttr = geometry.getAttribute('position');
    const bindMatrix = mesh.bindMatrix;
    const bindMatrixInv = mesh.bindMatrixInverse;

    // Compute current skinned positions
    mesh.skeleton.update();
    const cur = this.computeSkinnedPositions(
      mesh, posAttr, this._rankSkinIdx, this._rankSkinWt,
      mesh.skeleton.boneMatrices, mesh.skeleton.bones.length,
    );

    const bindPos = this._rankBindPos;
    const localVerts = entry.localVerts;
    const bi = entry.boneIdx;

    // Scratch objects
    const _v = new THREE.Vector3();
    const _boneMat = new THREE.Matrix4();
    const _ref = new THREE.Vector3();

    // Read the current bone matrix (worldMatrix * bindMatrixInverse)
    const boneMatOffset = bi * 16;
    _boneMat.fromArray(mesh.skeleton.boneMatrices, boneMatOffset);

    let totalDisp = 0, maxDisp = 0, movedVerts = 0;

    for (const vi of localVerts) {
      const i3 = vi * 3;

      // Rigid reference: where this vertex would be if 100% weighted to the bone
      // Formula: bindMatrix * boneMatrix * bindMatrixInverse * position
      _v.set(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
      _ref.copy(_v).applyMatrix4(bindMatrixInv).applyMatrix4(_boneMat).applyMatrix4(bindMatrix);

      // Actual deformation = actual skinned position - rigid reference
      const dx = cur[i3] - _ref.x;
      const dy = cur[i3 + 1] - _ref.y;
      const dz = cur[i3 + 2] - _ref.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

      totalDisp += d;
      if (d > maxDisp) maxDisp = d;
      if (d > 0.001) movedVerts++;
    }

    const measured = localVerts.length;
    return {
      mean: measured > 0 ? totalDisp / measured : 0,
      max: maxDisp,
      movedVerts,
      measured,
    };
  }

  /**
   * Run one frame of the bone-ranking diagnostic.
   * Tests each bone × 6 rotations, measures displacement, stores results.
   */
  runRankTest(delta: number): void {
    if (!this._rankActive || this._rankBones.length === 0) {
      this.finishRankTest();
      return;
    }

    const entry = this._rankBones[this._rankBoneIdx];
    const rot = LipSyncController.RANK_ROTS[this._rankRotIdx];
    const rotRad = LipSyncController.RANK_ROT_DEG * Math.PI / 180;
    const sign = rot.label.endsWith('+') ? 1 : -1;
    const totalTests = this._rankBones.length * LipSyncController.RANK_ROTS.length;
    const testNum = this._rankBoneIdx * LipSyncController.RANK_ROTS.length + this._rankRotIdx;

    this._rankTimer += delta;

    if (this._rankPhase === 'hold') {
      // Apply rotation
      entry.bone.quaternion.copy(entry.bindQuat);
      _tmpEuler.set(0, 0, 0);
      _tmpEuler[rot.axis] = sign * rotRad;
      _tmpQuat.setFromEuler(_tmpEuler);
      entry.bone.quaternion.multiply(_tmpQuat);

      // Force matrix update on bone and all ancestors
      this.forceWorldMatrixUpdate(entry.bone);

      // Log on first frame
      if (this._rankTimer <= delta * 2) {
        this.updateRankOverlay(
          `${testNum + 1}/${totalTests}`,
          `${entry.name} ${rot.label}`,
        );
      }

      if (this._rankTimer >= LipSyncController.RANK_HOLD) {
        // Measure LOCALIZED displacement at peak rotation
        const m = this.measureRankDisplacement(entry);
        this._rankResults.push({
          bone: entry.name, axis: rot.label, sign,
          mean: m.mean, max: m.max, movedVerts: m.movedVerts,
          measured: m.measured,
        });

        // Restore
        entry.bone.quaternion.copy(entry.bindQuat);
        this.forceWorldMatrixUpdate(entry.bone);

        this._rankTimer = 0;
        this._rankPhase = 'restore';
      }
    } else {
      // Restore phase — timer already incremented at top of method
      if (this._rankTimer >= LipSyncController.RANK_REST) {
        this._rankTimer = 0;
        this._rankPhase = 'hold';
        this._rankRotIdx++;

        if (this._rankRotIdx >= LipSyncController.RANK_ROTS.length) {
          this._rankRotIdx = 0;
          this._rankBoneIdx++;
          if (this._rankBoneIdx >= this._rankBones.length) {
            this.finishRankTest();
            return;
          }
        }
      }
    }
  }

  /** Finish the rank test: restore all bones and print ranked results. */
  private finishRankTest(): void {
    // Restore ALL tested bones to exact bind quaternion
    for (const entry of this._rankBones) {
      entry.bone.quaternion.copy(entry.bindQuat);
    }
    if (this._rankMesh) {
      this.forceWorldMatrixUpdate(this._rankBones[0]?.bone ?? this._rankMesh);
      this._rankMesh.skeleton.update();
    }

    this._rankActive = false;
    this._rankBindPos = null;
    this._rankSkinIdx = null;
    this._rankSkinWt = null;
    this.removeRankOverlay();

    // ─── Print ranked results ───
    if (this._rankResults.length === 0) {
      this.postDebug('[FaceRank2] NO MEASUREMENTS RECORDED');
      return;
    }

    // Sort by mean displacement, highest first
    const sorted = [...this._rankResults].sort((a, b) => b.mean - a.mean);

    // Identify bones with meaningful localized deformation
    // Threshold is small because we measure deformation vs rigid reference,
    // not absolute displacement
    const MEAN_THRESHOLD = 0.0001;
    const strong = sorted.filter(r => r.mean > MEAN_THRESHOLD);
    const weak = sorted.filter(r => r.mean <= MEAN_THRESHOLD);

    this.postDebug('[FaceRank2]');
    this.postDebug('[FaceRank2] COMPLETE');
    this.postDebug('[FaceRank2]');
    this.postDebug('[FaceRank2] Strongest localized mouth deformations:');
    this.postDebug('[FaceRank2]');

    for (let i = 0; i < strong.length; i++) {
      const r = strong[i];
      this.postDebug(
        `[FaceRank2] ${i + 1}. ${r.bone} ${r.axis} ` +
        `measured=${r.measured} mean=${r.mean.toFixed(4)} max=${r.max.toFixed(4)} moved=${r.movedVerts}`,
      );
    }

    if (weak.length > 0) {
      const weakNames = [...new Set(weak.map(r => r.bone))];
      this.postDebug('[FaceRank2]');
      this.postDebug(`[FaceRank2] WEAK/NO DEFORMATION bones: ${weakNames.join(', ')}`);
    }

    this.postDebug('[FaceRank2]');
    this.postDebug('[FaceRank2] All bones restored to bind pose.');
  }

  // ═══════════════════════════════════════════════════════════════
  //  MINT MOUTH ASSET DIAGNOSTIC
  // ═══════════════════════════════════════════════════════════════

  /**
   * Comprehensive FBX asset inspection.
   * Walks the loaded scene, finds mouth objects, checks morphs,
   * inspects bone influences, and optionally runs a visual test.
   */
  // ═══════════════════════════════════════════════════════════════
  //  MINT MOUTH GEOMETRY INSPECTION
  // ═══════════════════════════════════════════════════════════════

  triggerMouthGeomInspect(): void {
    if (!this._sweepBoneMap?.head) {
      this.postDebug('[MintGeom] ERROR: No head bone — cannot find scene');
      return;
    }
    let root: THREE.Object3D = this._sweepBoneMap.head;
    while (root.parent) root = root.parent;

    const TARGET_NAMES = [
      'mouth',
      'player_019_mint_skin_LOD1',
      'player_019_mint_skin_LOD1.001',
    ];

    // Collect ALL matching objects (by exact or contains)
    const matches: THREE.Object3D[] = [];
    root.traverse(child => {
      for (const t of TARGET_NAMES) {
        if (child.name === t || child.name.toLowerCase().includes(t.toLowerCase())) {
          matches.push(child);
          break;
        }
      }
    });

    this.postDebug('');
    this.postDebug('========== MINT MOUTH GEOMETRY INSPECTION ==========');
    this.postDebug('');

    for (const obj of matches) {
      const isBone = !!(obj as any).isBone;
      const isMesh = !!(obj as any).isMesh;
      const isSkinned = !!(obj as any).isSkinnedMesh;
      const type = (obj as any).type ?? obj.constructor?.name ?? 'unknown';
      const parent = obj.parent?.name ?? '(none)';
      const children = obj.children.map(c => c.name).join(', ') || '(none)';

      let geoVerts = '(none)';
      let matCount = '(none)';
      let skeletonBones = '(none)';
      let skeletonRoot = '(none)';

      const geo = (obj as any).geometry;
      if (geo && typeof geo.attributes?.position?.count === 'number') {
        geoVerts = String(geo.attributes.position.count);
      }

      const mats = (obj as any).material;
      if (mats) {
        const arr = Array.isArray(mats) ? mats : [mats];
        matCount = String(arr.length);
      }

      if (isSkinned) {
        const sk = (obj as THREE.SkinnedMesh).skeleton;
        if (sk) {
          skeletonBones = String(sk.bones.length);
          skeletonRoot = sk.bones.length > 0 ? sk.bones[0].name : '(empty)';
        }
      }

      this.postDebug(`[MintGeom] name=${obj.name}`);
      this.postDebug(`[MintGeom] type=${type}`);
      this.postDebug(`[MintGeom] isBone=${isBone}`);
      this.postDebug(`[MintGeom] isMesh=${isMesh}`);
      this.postDebug(`[MintGeom] isSkinnedMesh=${isSkinned}`);
      this.postDebug(`[MintGeom] parent=${parent}`);
      this.postDebug(`[MintGeom] children=${children}`);
      this.postDebug(`[MintGeom] geometryVertices=${geoVerts}`);
      this.postDebug(`[MintGeom] materialCount=${matCount}`);
      if (isSkinned) {
        this.postDebug(`[MintGeom] skeletonBones=${skeletonBones}`);
        this.postDebug(`[MintGeom] skeletonRoot=${skeletonRoot}`);
      }
      this.postDebug('');
    }

    // ─── CRITICAL: INSPECT mouth ───
    const mouthObj = matches.find(o => o.name.toLowerCase() === 'mouth' || o.name.toLowerCase().includes('mouth'));
    this.postDebug('========== MINT MOUTH (mouth object) ==========');
    this.postDebug('');

    if (!mouthObj) {
      this.postDebug('[MintMouth] mouth object NOT FOUND in scene');
      this.postDebug('');
    } else {
      const mouthType = (mouthObj as any).type ?? mouthObj.constructor?.name ?? 'unknown';
      const mouthIsBone = !!(mouthObj as any).isBone;
      const mouthIsGroup = !!(mouthObj as any).isGroup;
      const mouthIsMesh = !!(mouthObj as any).isMesh;
      const mouthIsSkinned = !!(mouthObj as any).isSkinnedMesh;
      const mouthChildren = mouthObj.children.map(c => c.name).join(', ') || '(none)';

      this.postDebug(`[MintMouth] mouthType=${mouthType}`);
      this.postDebug(`[MintMouth] isBone=${mouthIsBone} isGroup=${mouthIsGroup} isMesh=${mouthIsMesh} isSkinnedMesh=${mouthIsSkinned}`);
      this.postDebug(`[MintMouth] children=${mouthChildren}`);

      // For every SkinnedMesh, determine if mouth is in its skeleton
      const allSkinnedMeshes: THREE.SkinnedMesh[] = [];
      root.traverse(child => {
        if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
          allSkinnedMeshes.push(child as THREE.SkinnedMesh);
        }
      });

      for (const sm of allSkinnedMeshes) {
        const sk = sm.skeleton;
        if (!sk) {
          this.postDebug(`[MintMouth] SkinnedMesh="${sm.name}": NO SKELETON`);
          continue;
        }
        let mouthInSkeleton = false;
        let mouthIdx = -1;
        for (let i = 0; i < sk.bones.length; i++) {
          if (sk.bones[i].name === mouthObj.name) {
            mouthInSkeleton = true;
            mouthIdx = i;
            break;
          }
        }
        this.postDebug(`[MintMouth] SkinnedMesh="${sm.name}" skeleton=${sk.bones.length} bones, mouth="${mouthObj.name}" inSkeleton=${mouthInSkeleton} index=${mouthIdx}`);
      }
      this.postDebug('');
    }

    // ─── CRITICAL: INSPECT .001 ───
    const dot001 = matches.find(o => o.name === 'player_019_mint_skin_LOD1.001' || o.name.toLowerCase().includes('lod1.001'));
    this.postDebug('========== MINT .001 (player_019_mint_skin_LOD1.001) ==========');
    this.postDebug('');

    if (dot001 && (dot001 as any).isSkinnedMesh) {
      const sm = dot001 as THREE.SkinnedMesh;
      const sk = sm.skeleton;
      this.postDebug(`[MintGeom] .001 IS SkinnedMesh`);
      this.postDebug(`[MintGeom] .001 skeletonBones=${sk ? sk.bones.length : 'none'}`);
      this.postDebug(`[MintGeom] .001 skeletonRoot=${sk && sk.bones.length > 0 ? sk.bones[0].name : '(none)'}`);

      if (sk) {
        const FACIAL_BONE_NAMES = [
          'mouth', 'Bon_yachi_lo', 'Bon_yachi_up',
          'Bon_uplip_M', 'Bon_Lolip_M',
          'Bon_uplip01_L', 'Bon_uplip01_R',
          'Bon_Lolip01_L', 'Bon_Lolip01_R',
          'Bon_uplip02_L', 'Bon_uplip02_R',
          'Bon_Lolip02_L', 'Bon_Lolip02_R',
          'Bon_zuiba_L', 'Bon_zuiba_R',
          'Bon_colip_L', 'Bon_colip_R',
        ];
        const boneNameToIdx = new Map<string, number>();
        for (let i = 0; i < sk.bones.length; i++) {
          boneNameToIdx.set(sk.bones[i].name, i);
        }

        this.postDebug(`[MintGeom] .001 facial bone presence:`);
        for (const fn of FACIAL_BONE_NAMES) {
          const idx = boneNameToIdx.get(fn);
          this.postDebug(`[MintGeom]   ${fn}: ${idx !== undefined ? 'PRESENT (idx=' + idx + ')' : 'NOT IN SKELETON'}`);
        }

        // Skin weight scan
        const geo = sm.geometry;
        const skinIdx = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
        const skinWt = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
        if (skinIdx && skinWt) {
          this.postDebug(`[MintWeights] .001 skin-weight scan:`);
          const bpv = skinIdx.itemSize;
          const vcount = geo.attributes.position.count;
          for (const fn of FACIAL_BONE_NAMES) {
            const boneIdx = boneNameToIdx.get(fn);
            if (boneIdx === undefined) {
              this.postDebug(`[MintWeights] mesh=.001 bone=${fn} boneIndex=NOT_IN_SKELETON`);
              continue;
            }
            let influenced = 0;
            let maxW = 0;
            for (let v = 0; v < vcount; v++) {
              for (let w = 0; w < bpv; w++) {
                const idx = v * bpv + w;
                if (skinIdx.array[idx] === boneIdx && skinWt.array[idx] > 0) {
                  influenced++;
                  const wt = skinWt.array[idx];
                  if (wt > maxW) maxW = wt;
                  break;
                }
              }
            }
            this.postDebug(`[MintWeights] mesh=.001 bone=${fn} boneIndex=${boneIdx} influencedVertices=${influenced} maxWeight=${maxW.toFixed(3)}`);
          }
        } else {
          this.postDebug('[MintWeights] .001: NO skinIndex/skinWeight attributes');
        }
      }
      this.postDebug('');
    } else if (dot001) {
      this.postDebug(`[MintGeom] .001 is NOT a SkinnedMesh (type=${dot001.type}, isSkinnedMesh=${(dot001 as any).isSkinnedMesh})`);
      this.postDebug('');
    } else {
      this.postDebug('[MintGeom] player_019_mint_skin_LOD1.001 NOT FOUND');
      this.postDebug('');
    }

    // ─── ALSO CHECK THE MAIN MESH ───
    const mainMesh = matches.find(o => o.name === 'player_019_mint_skin_LOD1' && (o as any).isSkinnedMesh);
    this.postDebug('========== MAIN MESH (player_019_mint_skin_LOD1) facial-bone weight check ==========');
    this.postDebug('');

    if (mainMesh && (mainMesh as any).isSkinnedMesh) {
      const sm = mainMesh as THREE.SkinnedMesh;
      const sk = sm.skeleton;
      const geo = sm.geometry;
      const skinIdx = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
      const skinWt = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;

      if (skinIdx && skinWt && sk) {
        const bpv = skinIdx.itemSize;
        const vcount = geo.attributes.position.count;
        const FACIAL_BONE_NAMES = [
          'Bon_uplip_M', 'Bon_Lolip_M',
          'Bon_uplip01_L', 'Bon_uplip01_R',
          'Bon_Lolip01_L', 'Bon_Lolip01_R',
          'Bon_uplip02_L', 'Bon_uplip02_R',
          'Bon_Lolip02_L', 'Bon_Lolip02_R',
          'Bon_zuiba_L', 'Bon_zuiba_R',
          'Bon_colip_L', 'Bon_colip_R',
          'Bon_yachi_lo', 'Bon_yachi_up',
        ];
        const boneNameToIdx = new Map<string, number>();
        for (let i = 0; i < sk.bones.length; i++) {
          boneNameToIdx.set(sk.bones[i].name, i);
        }

        this.postDebug(`[MintWeights] mainMesh=${sm.name} vertices=${vcount} bonesPerVertex=${bpv}`);
        for (const fn of FACIAL_BONE_NAMES) {
          const boneIdx = boneNameToIdx.get(fn);
          if (boneIdx === undefined) {
            this.postDebug(`[MintWeights] mesh=main bone=${fn} boneIndex=NOT_IN_SKELETON`);
            continue;
          }
          let influenced = 0;
          let maxW = 0;
          for (let v = 0; v < vcount; v++) {
            for (let w = 0; w < bpv; w++) {
              const idx = v * bpv + w;
              if (skinIdx.array[idx] === boneIdx && skinWt.array[idx] > 0) {
                influenced++;
                const wt = skinWt.array[idx];
                if (wt > maxW) maxW = wt;
                break;
              }
            }
          }
          this.postDebug(`[MintWeights] mesh=main bone=${fn} boneIndex=${boneIdx} influencedVertices=${influenced} maxWeight=${maxW.toFixed(3)}`);
        }
      } else {
        this.postDebug('[MintWeights] mainMesh: missing skeleton or skin attributes');
      }
      this.postDebug('');
    } else if (mainMesh) {
      this.postDebug(`[MintGeom] mainMesh is NOT a SkinnedMesh (type=${mainMesh.type}, isSkinnedMesh=${(mainMesh as any).isSkinnedMesh})`);
      this.postDebug('');
    } else {
      this.postDebug('[MintGeom] player_019_mint_skin_LOD1 NOT FOUND or not a SkinnedMesh');
      this.postDebug('');
    }

    // ─── VERDICT ───
    this.postDebug('========== MINT MOUTH GEOMETRY VERDICT ==========');
    this.postDebug('');

    const mouthIsBoneFinal = mouthObj ? !!(mouthObj as any).isBone : false;
    const mouthHasGeometryFinal = matches.some(o => o.name.toLowerCase().includes('mouth') && (o as any).isMesh && !(o as any).isBone);
    let mainMeshHasFacialWeights = false;
    let secondaryMeshHasFacialWeights = false;

    // Check main mesh
    const mm = matches.find(o => o.name === 'player_019_mint_skin_LOD1' && (o as any).isSkinnedMesh) as THREE.SkinnedMesh | undefined;
    if (mm && mm.skeleton) {
      const geo = mm.geometry;
      const skinIdx = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
      const skinWt = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
      if (skinIdx && skinWt) {
        const bpv = skinIdx.itemSize;
        const vcount = geo.attributes.position.count;
        const checkBones = ['Bon_uplip_M', 'Bon_Lolip_M', 'Bon_zuiba_L', 'Bon_colip_L'];
        const idxMap = new Map<string, number>();
        for (let i = 0; i < mm.skeleton.bones.length; i++) idxMap.set(mm.skeleton.bones[i].name, i);
        for (const fn of checkBones) {
          const bi = idxMap.get(fn);
          if (bi === undefined) continue;
          for (let v = 0; v < vcount; v++) {
            for (let w = 0; w < bpv; w++) {
              const idx = v * bpv + w;
              if (skinIdx.array[idx] === bi && skinWt.array[idx] > 0) {
                mainMeshHasFacialWeights = true;
                break;
              }
            }
            if (mainMeshHasFacialWeights) break;
          }
        }
      }
    }

    // Check .001
    const dot001Final = matches.find(o => o.name === 'player_019_mint_skin_LOD1.001' && (o as any).isSkinnedMesh) as THREE.SkinnedMesh | undefined;
    if (dot001Final && dot001Final.skeleton) {
      const geo = dot001Final.geometry;
      const skinIdx = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
      const skinWt = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
      if (skinIdx && skinWt) {
        const bpv = skinIdx.itemSize;
        const vcount = geo.attributes.position.count;
        const checkBones = ['Bon_uplip_M', 'Bon_Lolip_M', 'Bon_zuiba_L', 'Bon_colip_L'];
        const idxMap = new Map<string, number>();
        for (let i = 0; i < dot001Final.skeleton.bones.length; i++) idxMap.set(dot001Final.skeleton.bones[i].name, i);
        for (const fn of checkBones) {
          const bi = idxMap.get(fn);
          if (bi === undefined) continue;
          for (let v = 0; v < vcount; v++) {
            for (let w = 0; w < bpv; w++) {
              const idx = v * bpv + w;
              if (skinIdx.array[idx] === bi && skinWt.array[idx] > 0) {
                secondaryMeshHasFacialWeights = true;
                break;
              }
            }
            if (secondaryMeshHasFacialWeights) break;
          }
        }
      }
    }

    // Likely visible mouth mesh
    let likelyVisibleMouthMesh = 'UNKNOWN';
    if (mm && mm.skeleton && (mainMeshHasFacialWeights || secondaryMeshHasFacialWeights)) {
      likelyVisibleMouthMesh = mm.name;
    } else if (dot001Final && dot001Final.skeleton && secondaryMeshHasFacialWeights) {
      likelyVisibleMouthMesh = dot001Final.name;
    } else if (mouthHasGeometryFinal) {
      const mg = matches.find(o => o.name.toLowerCase().includes('mouth') && (o as any).isMesh && !(o as any).isBone);
      if (mg) likelyVisibleMouthMesh = mg.name;
    }

    // Facial bones actually affect visible geometry
    let facialBonesActuallyAffectVisibleGeometry = 'UNKNOWN';
    if (mainMeshHasFacialWeights && likelyVisibleMouthMesh === mm?.name) {
      facialBonesActuallyAffectVisibleGeometry = 'YES — facial bones influence the main SkinnedMesh vertices';
    } else if (secondaryMeshHasFacialWeights && likelyVisibleMouthMesh === dot001Final?.name) {
      facialBonesActuallyAffectVisibleGeometry = 'YES — facial bones influence the .001 SkinnedMesh vertices';
    } else if (mainMeshHasFacialWeights) {
      facialBonesActuallyAffectVisibleGeometry = 'PARTIAL — main mesh has facial weights but likely visible mouth mesh is unclear';
    }

    this.postDebug(`[MintVerdict] mouthObjectType=${mouthObj ? (mouthObj as any).type ?? mouthObj.constructor?.name ?? 'unknown' : 'NOT_FOUND'}`);
    this.postDebug(`[MintVerdict] mouthHasGeometry=${mouthHasGeometryFinal ? 'YES' : 'NO'}`);
    this.postDebug(`[MintVerdict] mainMeshHasFacialWeights=${mainMeshHasFacialWeights ? 'YES' : 'NO'}`);
    this.postDebug(`[MintVerdict] secondaryMeshHasFacialWeights=${secondaryMeshHasFacialWeights ? 'YES' : 'NO'}`);
    this.postDebug(`[MintVerdict] likelyVisibleMouthMesh=${likelyVisibleMouthMesh}`);
    this.postDebug(`[MintVerdict] facialBonesActuallyAffectVisibleGeometry=${facialBonesActuallyAffectVisibleGeometry}`);
    this.postDebug('');
    this.postDebug('=======================================');
    this.postDebug('  INSPECTION COMPLETE — STOP');
    this.postDebug('=======================================');
  }

  triggerMouthAssetDiagnostic(): void {
    this.postDebug('');
    this.postDebug('=========================================');
    this.postDebug('  MINT MOUTH ASSET DIAGNOSTIC');
    this.postDebug('=========================================');
    this.postDebug('');

    // Walk scene from head bone to root
    const headBone = this._sweepBoneMap?.head;
    if (!headBone) {
      this.postDebug('[MouthAsset] ERROR: No head bone — cannot find scene');
      return;
    }
    let root: THREE.Object3D = headBone;
    while (root.parent) root = root.parent;

    // ─── 1. FIND ALL MOUTH OBJECTS ───
    this.postDebug('========== MINT MOUTH ASSET ==========');
    this.postDebug('');

    const mouthObjects: THREE.Object3D[] = [];
    root.traverse(child => {
      if (child.name.toLowerCase().includes('mouth')) {
        mouthObjects.push(child);
      }
    });

    if (mouthObjects.length === 0) {
      this.postDebug('[MouthAsset] No objects containing "mouth" found in scene');
    }

    for (const obj of mouthObjects) {
      const isMesh = !!(obj as any).isMesh;
      const isSkinned = !!(obj as any).isSkinnedMesh;
      const mesh = obj as THREE.Mesh;
      const sk = isSkinned ? (obj as THREE.SkinnedMesh).skeleton : null;
      const geo = (mesh as any).geometry as THREE.BufferGeometry | undefined;

      this.postDebug(`[MouthAsset] FOUND`);
      this.postDebug(`  name: ${obj.name}`);
      this.postDebug(`  type: ${obj.type}`);
      this.postDebug(`  isMesh: ${isMesh}`);
      this.postDebug(`  isSkinnedMesh: ${isSkinned}`);
      this.postDebug(`  visible: ${obj.visible}`);
      if (geo) {
        this.postDebug(`  vertexCount: ${geo.attributes.position?.count ?? 0}`);
        this.postDebug(`  indexCount: ${geo.index?.count ?? 0}`);
      }
      this.postDebug(`  parent: ${obj.parent?.name ?? '(none)'} (${obj.parent?.type ?? 'none'})`);
      this.postDebug(`  children: ${obj.children.length}`);
      this.postDebug('');

      // ─── 2. SKINNED? ───
      if (isSkinned && sk) {
        this.postDebug(`[MouthAsset] SKINNED = YES`);
        this.postDebug(`  skeleton bones: ${sk.bones.length}`);
        this.postDebug(`  bindMode: ${(obj as THREE.SkinnedMesh).bindMode}`);
      } else {
        this.postDebug(`[MouthAsset] SKINNED = NO`);
      }

      // ─── 3. MORPHS ───
      if (geo) {
        const morphDict = (mesh as any).morphTargetDictionary as Record<string, number> | undefined;
        const morphInfluences = (mesh as any).morphTargetInfluences as number[] | undefined;
        const morphAttrs = geo.morphAttributes;
        const morphCount = morphDict ? Object.keys(morphDict).length : 0;
        const hasMorphTargets = morphAttrs && Object.keys(morphAttrs).length > 0;
        const hasInfluences = morphInfluences && morphInfluences.length > 0;

        this.postDebug(`[MouthAsset] MORPHS = ${morphCount > 0 || hasMorphTargets ? 'YES' : 'NO'}`);
        this.postDebug(`  morph target count: ${morphCount}`);
        this.postDebug(`  morphTargetInfluences length: ${morphInfluences?.length ?? 0}`);
        this.postDebug(`  geometry.morphAttributes keys: ${morphAttrs ? Object.keys(morphAttrs).join(', ') : 'none'}`);

        if (morphDict) {
          const names = Object.keys(morphDict);
          // Check for specific keywords
          const keywords = ['jaw', 'mouth', 'viseme', 'vowel', 'lip', 'smile', 'phoneme', 'open', 'close'];
          const found = names.filter(n => {
            const ln = n.toLowerCase();
            return keywords.some(k => ln.includes(k));
          });
          if (found.length > 0) {
            this.postDebug(`  mouth-related morphs: ${found.join(', ')}`);
          }
          // Print first 20 morph names for reference
          if (names.length > 0) {
            this.postDebug(`  all morph names (first 20): ${names.slice(0, 20).join(', ')}${names.length > 20 ? '...' : ''}`);
          }
        }
      }
      this.postDebug('');

      // ─── 4. BONE INFLUENCES (if SkinnedMesh) ───
      if (isSkinned && sk) {
        const skinned = obj as THREE.SkinnedMesh;
        const geo2 = skinned.geometry;
        const skinIdx = geo2.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
        const skinWt = geo2.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;

        if (skinIdx && skinWt) {
          const vertCount = geo2.attributes.position.count;
          const bonesPerVert = skinIdx.itemSize;
          this.postDebug(`[MouthAsset] SKELETON bone influence scan (${vertCount} verts, ${bonesPerVert} bones/vert):`);

          const FACIAL_BONES = [
            'Bon_uplip_M', 'Bon_Lolip_M',
            'Bon_uplip01_L', 'Bon_uplip01_R',
            'Bon_Lolip01_L', 'Bon_Lolip01_R',
            'Bon_uplip02_L', 'Bon_uplip02_R',
            'Bon_Lolip02_L', 'Bon_Lolip02_R',
            'Bon_zuiba_L', 'Bon_zuiba_R',
            'Bon_colip_L', 'Bon_colip_R',
            'Bon_yachi_lo', 'Bon_yachi_up',
          ];

          for (const boneName of FACIAL_BONES) {
            // Find bone in skeleton
            const boneObj = sk.bones.find(b => b.name === boneName);
            if (!boneObj) {
              this.postDebug(`[MouthInfluence] bone=${boneName} NOT_IN_SKELETON`);
              continue;
            }
            const boneIdx = sk.bones.indexOf(boneObj);
            let maxW = 0, totalW = 0, influenced = 0;
            for (let vi = 0; vi < vertCount; vi++) {
              for (let w = 0; w < bonesPerVert; w++) {
                const idx = vi * bonesPerVert + w;
                if (skinIdx.array[idx] === boneIdx && skinWt.array[idx] > 0) {
                  influenced++;
                  totalW += skinWt.array[idx];
                  if (skinWt.array[idx] > maxW) maxW = skinWt.array[idx];
                  break;
                }
              }
            }
            this.postDebug(`[MouthInfluence] bone=${boneName} index=${boneIdx} vertices=${influenced}/${vertCount} maxWeight=${maxW.toFixed(3)} totalWeight=${totalW.toFixed(1)}`);
          }
        }
      }
    }

    // ─── 5. CHECK MAIN BODY MESH ───
    this.postDebug('');
    this.postDebug('--- Main body mesh bone influence scan ---');

    root.traverse(child => {
      if (!(child as THREE.SkinnedMesh).isSkinnedMesh) return;
      const skinned = child as THREE.SkinnedMesh;
      const name = skinned.name;
      // Skip the mouth objects we already checked
      if (name.toLowerCase().includes('mouth')) return;
      if (!skinned.skeleton) return;

      this.postDebug(`[BodyMesh] ${name}:`);
      this.postDebug(`  vertexCount: ${skinned.geometry.attributes.position.count}`);
      this.postDebug(`  skeleton bones: ${skinned.skeleton.bones.length}`);

      const geo = skinned.geometry;
      const skinIdx = geo.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
      const skinWt = geo.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
      const sk = skinned.skeleton;

      if (!skinIdx || !skinWt) return;

      const vertCount = geo.attributes.position.count;
      const bonesPerVert = skinIdx.itemSize;

      const FACIAL_BONES = [
        'Bon_uplip_M', 'Bon_Lolip_M',
        'Bon_uplip01_L', 'Bon_uplip01_R',
        'Bon_Lolip01_L', 'Bon_Lolip01_R',
        'Bon_zuiba_L', 'Bon_zuiba_R',
        'Bon_colip_L', 'Bon_colip_R',
        'Bon_yachi_lo', 'Bon_yachi_up',
      ];

      for (const boneName of FACIAL_BONES) {
        const boneObj = sk.bones.find(b => b.name === boneName);
        if (!boneObj) {
          this.postDebug(`[BodyInfluence] bone=${boneName} NOT_IN_SKELETON`);
          continue;
        }
        const boneIdx = sk.bones.indexOf(boneObj);
        let maxW = 0, influenced = 0;
        for (let vi = 0; vi < vertCount; vi++) {
          for (let w = 0; w < bonesPerVert; w++) {
            const idx = vi * bonesPerVert + w;
            if (skinIdx.array[idx] === boneIdx && skinWt.array[idx] > 0) {
              influenced++;
              if (skinWt.array[idx] > maxW) maxW = skinWt.array[idx];
              break;
            }
          }
        }
        this.postDebug(`[BodyInfluence] bone=${boneName} index=${boneIdx} vertices=${influenced}/${vertCount} maxWeight=${maxW.toFixed(3)}`);
      }
      this.postDebug('');
    });

    // ─── 6. CHECK FOR STATIC MOUTH ───
    const mouthSkinned = mouthObjects.find(o => (o as any).isSkinnedMesh) as THREE.SkinnedMesh | undefined;
    const mouthMesh = mouthObjects.find(o => (o as any).isMesh && !(o as any).isSkinnedMesh) as THREE.Mesh | undefined;

    if (mouthMesh) {
      this.postDebug('[MouthAsset] STATIC_MOUTH = YES');
      this.postDebug(`  vertexCount: ${mouthMesh.geometry?.attributes.position?.count ?? 0}`);
      this.postDebug(`  material: ${(mouthMesh.material as any)?.name ?? (mouthMesh.material as any)?.type ?? 'unknown'}`);
      // Check if any facial bone is in the same skeleton
      this.postDebug('[MouthAsset] CONNECTED_TO_FACIAL_SKELETON = NO (separate mesh, not skinned)');
    }

    // ─── 7. SUMMARY ───
    this.postDebug('');
    this.postDebug('========== RESULT ==========');
    this.postDebug(`[MouthAsset] STATIC_MOUTH = ${mouthMesh ? 'YES' : 'NO'}`);
    this.postDebug(`[MouthAsset] SKINNED = ${mouthSkinned ? 'YES' : 'NO'}`);
    const hasMorphs = mouthObjects.some(o => {
      const g = (o as any).geometry;
      const d = (o as any).morphTargetDictionary;
      return (d && Object.keys(d).length > 0) || (g?.morphAttributes && Object.keys(g.morphAttributes).length > 0);
    });
    this.postDebug(`[MouthAsset] MORPHS = ${hasMorphs ? 'YES' : 'NO'}`);

    // Check if any facial bone has >0 influence on any mesh
    let anyFacialInfluence = false;
    root.traverse(child => {
      if (anyFacialInfluence) return;
      if (!(child as THREE.SkinnedMesh).isSkinnedMesh) return;
      const sk = (child as THREE.SkinnedMesh).skeleton;
      if (!sk) return;
      for (const name of ['Bon_uplip_M', 'Bon_Lolip_M', 'Bon_zuiba_L', 'Bon_colip_L']) {
        if (sk.bones.find(b => b.name === name)) { anyFacialInfluence = true; break; }
      }
    });
    this.postDebug(`[MouthAsset] FACIAL_BONES_CONNECTED = ${anyFacialInfluence ? 'YES' : 'NO'}`);
    this.postDebug('=======================================');

    // ─── 8. OPTIONAL VISUAL TEST (only if mouth is skinned) ───
    if (mouthSkinned && mouthSkinned.skeleton) {
      this.postDebug('');
      this.postDebug('[MouthAsset] Mouth IS skinned — starting 3-bone visual test...');
      this.startMouthVisualTest(mouthSkinned);
    } else if (mouthSkinned) {
      this.postDebug('[MouthAsset] Mouth object exists but has no skeleton — cannot visual test');
    } else {
      this.postDebug('[MouthAsset] No skinned mouth found — visual test skipped');
    }

    this.postDebug('');
    this.postDebug('=========================================');
    this.postDebug('  DIAGNOSTIC COMPLETE — AWAITING RESULTS');
    this.postDebug('=========================================');
  }

  // ─── Visual test for skinned mouth (3 bones × 6 rotations) ───
  private _mouthVisActive = false;
  private _mouthVisBones: { bone: THREE.Object3D; name: string; bindQuat: THREE.Quaternion }[] = [];
  private _mouthVisMesh: THREE.SkinnedMesh | null = null;
  private _mouthVisBoneIdx = 0;
  private _mouthVisRotIdx = 0;
  private _mouthVisPhase: 'hold' | 'restore' = 'hold';
  private _mouthVisTimer = 0;
  private _mouthVisOverlay: HTMLDivElement | null = null;
  private static readonly MOUTH_VIS_CANDIDATES = ['Bon_zuiba_L', 'Bon_zuiba_R', 'Bon_Lolip01_L'];
  private static readonly MOUTH_VIS_ROT_DEG = 10;
  private static readonly MOUTH_VIS_HOLD = 1.0;
  private static readonly MOUTH_VIS_REST = 0.5;
  private static readonly MOUTH_VIS_ROTS: { axis: 'x' | 'y' | 'z'; label: string; angle: number }[] = [
    { axis: 'x', label: 'X+', angle: 10 }, { axis: 'x', label: 'X-', angle: -10 },
    { axis: 'y', label: 'Y+', angle: 10 }, { axis: 'y', label: 'Y-', angle: -10 },
    { axis: 'z', label: 'Z+', angle: 10 }, { axis: 'z', label: 'Z-', angle: -10 },
  ];

  private startMouthVisualTest(mesh: THREE.SkinnedMesh): void {
    this._mouthVisBones = [];
    for (const name of LipSyncController.MOUTH_VIS_CANDIDATES) {
      const bone = mesh.skeleton.bones.find(b => b.name === name);
      if (bone) {
        this._mouthVisBones.push({ bone, name, bindQuat: bone.quaternion.clone() });
      }
    }
    if (this._mouthVisBones.length === 0) {
      this.postDebug('[MouthAsset] No visual test bones found in mouth skeleton');
      return;
    }

    this._mouthVisActive = true;
    this._mouthVisMesh = mesh;
    this._mouthVisBoneIdx = 0;
    this._mouthVisRotIdx = 0;
    this._mouthVisPhase = 'hold';
    this._mouthVisTimer = 0;
    this._sweepActive = true; // pause normal lip-sync
    this._sweepBones = [];

    this.postDebug(`[MouthAsset] Visual test: ${this._mouthVisBones.map(b => b.name).join(', ')} × 6 rotations`);
    this.createMouthVisOverlay();
  }

  private createMouthVisOverlay(): void {
    this.removeMouthVisOverlay();
    const el = document.createElement('div');
    el.id = 'mouth-asset-overlay';
    el.innerHTML = [
      '<div style="font-size:20px;font-weight:bold;color:#9b59b6;">MINT ACTUAL MOUTH TEST</div>',
      '<div id="mav-bone" style="font-size:18px;margin-top:6px;"></div>',
      '<div id="mav-axis" style="font-size:16px;margin-top:4px;"></div>',
      '<div id="mav-prog" style="font-size:14px;margin-top:8px;color:#aaa;"></div>',
    ].join('');
    Object.assign(el.style, {
      position: 'fixed', top: '15px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '999999', padding: '14px 28px', borderRadius: '12px',
      background: 'rgba(0,0,0,0.88)', color: '#fff', fontFamily: 'monospace',
      textAlign: 'center', border: '2px solid #9b59b6', pointerEvents: 'none',
      minWidth: '280px',
    });
    document.body.appendChild(el);
    this._mouthVisOverlay = el;
  }

  private updateMouthVisOverlay(boneName: string, axisLabel: string, angle: number, testNum: number, total: number): void {
    if (!this._mouthVisOverlay) return;
    const b = this._mouthVisOverlay.querySelector('#mav-bone');
    const a = this._mouthVisOverlay.querySelector('#mav-axis');
    const p = this._mouthVisOverlay.querySelector('#mav-prog');
    if (b) b.textContent = `Bone: ${boneName}`;
    if (a) a.textContent = `Axis: ${axisLabel}   Angle: ${angle > 0 ? '+' : ''}${angle}°`;
    if (p) p.textContent = `TEST ${testNum} / ${total}`;
  }

  private removeMouthVisOverlay(): void {
    if (this._mouthVisOverlay) { this._mouthVisOverlay.remove(); this._mouthVisOverlay = null; }
    const el = document.getElementById('mouth-asset-overlay');
    if (el) el.remove();
  }

  runMouthVisTest(delta: number): void {
    if (!this._mouthVisActive || this._mouthVisBones.length === 0) {
      this.finishMouthVisTest();
      return;
    }

    const entry = this._mouthVisBones[this._mouthVisBoneIdx];
    const rot = LipSyncController.MOUTH_VIS_ROTS[this._mouthVisRotIdx];
    const rotRad = rot.angle * Math.PI / 180;
    const total = this._mouthVisBones.length * LipSyncController.MOUTH_VIS_ROTS.length;
    const testNum = this._mouthVisBoneIdx * LipSyncController.MOUTH_VIS_ROTS.length + this._mouthVisRotIdx + 1;

    this._mouthVisTimer += delta;

    if (this._mouthVisPhase === 'hold') {
      entry.bone.quaternion.copy(entry.bindQuat);
      _tmpEuler.set(0, 0, 0);
      _tmpEuler[rot.axis] = rotRad;
      _tmpQuat.setFromEuler(_tmpEuler);
      entry.bone.quaternion.multiply(_tmpQuat);

      // Full chain: bone → ancestors → skeleton → scene
      entry.bone.updateMatrix();
      entry.bone.matrixWorldNeedsUpdate = true;
      this.forceWorldMatrixUpdate(entry.bone);
      if (this._mouthVisMesh) this._mouthVisMesh.skeleton.update();
      // Walk up to scene root and force full world update
      let w: THREE.Object3D | null = entry.bone;
      while (w.parent) w = w.parent;
      w.updateMatrixWorld(true);

      if (this._mouthVisTimer <= delta * 2) {
        this.updateMouthVisOverlay(entry.name, rot.label, rot.angle, testNum, total);
        this.postDebug(`[MouthVis] TEST ${testNum}/${total}  ${entry.name} ${rot.label} HOLDING`);
      }

      if (this._mouthVisTimer >= LipSyncController.MOUTH_VIS_HOLD) {
        this._mouthVisTimer = 0;
        this._mouthVisPhase = 'restore';
      }
    } else {
      entry.bone.quaternion.copy(entry.bindQuat);
      entry.bone.updateMatrix();
      entry.bone.matrixWorldNeedsUpdate = true;
      this.forceWorldMatrixUpdate(entry.bone);
      if (this._mouthVisMesh) this._mouthVisMesh.skeleton.update();
      let w: THREE.Object3D | null = entry.bone;
      while (w.parent) w = w.parent;
      w.updateMatrixWorld(true);

      if (this._mouthVisTimer <= delta * 2) {
        this.postDebug(`[MouthVis] TEST ${testNum}/${total}  ${entry.name} ${rot.label} RESTORED`);
      }

      if (this._mouthVisTimer >= LipSyncController.MOUTH_VIS_REST) {
        this._mouthVisTimer = 0;
        this._mouthVisPhase = 'hold';
        this._mouthVisRotIdx++;
        if (this._mouthVisRotIdx >= LipSyncController.MOUTH_VIS_ROTS.length) {
          this._mouthVisRotIdx = 0;
          this._mouthVisBoneIdx++;
          if (this._mouthVisBoneIdx >= this._mouthVisBones.length) {
            this.finishMouthVisTest();
            return;
          }
        }
      }
    }
  }

  private finishMouthVisTest(): void {
    for (const entry of this._mouthVisBones) {
      entry.bone.quaternion.copy(entry.bindQuat);
      entry.bone.updateMatrix();
      entry.bone.matrixWorldNeedsUpdate = true;
    }
    if (this._mouthVisBones.length > 0) {
      this.forceWorldMatrixUpdate(this._mouthVisBones[0].bone);
    }
    if (this._mouthVisMesh) this._mouthVisMesh.skeleton.update();
    let w: THREE.Object3D | null = this._mouthVisBones[0]?.bone ?? null;
    while (w?.parent) w = w.parent;
    w?.updateMatrixWorld(true);

    this._mouthVisActive = false;
    this.removeMouthVisOverlay();
    this.postDebug('[MouthVis] ALL RESTORED — visual test complete');
  }

  // ═══════════════════════════════════════════════════════════════
  //  COORDINATED FACIAL RIG DIAGNOSTIC
  // ═══════════════════════════════════════════════════════════════

  triggerRigTest(): void {
    if (LipSyncController._facialRigTestActive) {
      this.postDebug('[FaceRig] Already running (module lock)');
      return;
    }
    if (this._rigActive) {
      this.postDebug('[FaceRig] Already running (instance)');
      return;
    }
    if (this.mode !== 'bone') {
      this.postDebug('[FaceRig] Cannot test — mode is not bone');
      return;
    }

    LipSyncController._facialRigTestActive = true;

    // ─── PHASE 1: CAPTURE BIND POSES + ANALYZE GEOMETRY ───
    this.postDebug('');
    this.postDebug('=========================================');
    this.postDebug('  MINT FACIAL RIG DIAGNOSTIC');
    this.postDebug('=========================================');
    this.postDebug('');
    this.postDebug('========== MINT FACIAL RIG ==========');
    this.postDebug('');

    this._rigBones.clear();
    this._rigBindQuats.clear();

    for (const name of LipSyncController.RIG_FACIAL_BONES) {
      const bone = this.findBoneByName(name);
      if (!bone) {
        this.postDebug(`[FaceRig] bone=${name} NOT FOUND`);
        continue;
      }
      this._rigBones.set(name, bone);
      this._rigBindQuats.set(name, bone.quaternion.clone());

      const p = bone.parent;
      const pos = bone.position;
      const rot = bone.rotation;
      const q = bone.quaternion;
      const s = bone.scale;
      this.postDebug(`[FaceRig] bone=${name}`);
      this.postDebug(`[FaceRig]   parent=${p?.name ?? '(none)'} children=${bone.children.length}`);
      this.postDebug(`[FaceRig]   position=(${pos.x.toFixed(4)}, ${pos.y.toFixed(4)}, ${pos.z.toFixed(4)})`);
      this.postDebug(`[FaceRig]   rotation=(${(rot.x * 180 / Math.PI).toFixed(2)}°, ${(rot.y * 180 / Math.PI).toFixed(2)}°, ${(rot.z * 180 / Math.PI).toFixed(2)}°)`);
      this.postDebug(`[FaceRig]   quaternion=(${q.x.toFixed(4)}, ${q.y.toFixed(4)}, ${q.z.toFixed(4)}, ${q.w.toFixed(4)})`);
      this.postDebug(`[FaceRig]   scale=(${s.x.toFixed(4)}, ${s.y.toFixed(4)}, ${s.z.toFixed(4)})`);
      this.postDebug('');
    }

    // Find the SkinnedMesh
    this.discoverSkinnedMesh();
    this._rigMesh = this._measureMesh;

    // ─── STEP 2-4: GEOMETRY-DERIVED AXIS ANALYSIS ───
    this.postDebug('');
    this.postDebug('========== MINT FACIAL COORDINATE ANALYSIS ==========');
    this.postDebug('');

    // STEP 2: world-space basis for each key bone
    const axisBoneNames = ['Bon_uplip_M', 'Bon_Lolip_M', 'Bon_uplip01_L', 'Bon_uplip01_R', 'Bon_Lolip01_L', 'Bon_Lolip01_R',
                           'Bon_zuiba_L', 'Bon_zuiba_R', 'Bon_colip_L', 'Bon_colip_R', 'Bon_yachi_lo', 'Bon_yachi_up'];

    const tmpW = new THREE.Vector3();
    const tmpX = new THREE.Vector3(1, 0, 0);
    const tmpY = new THREE.Vector3(0, 1, 0);
    const tmpZ = new THREE.Vector3(0, 0, 1);

    // Compute reference world axes from Bon_uplip_M once
    const refBone = this._rigBones.get('Bon_uplip_M');
    if (refBone) {
      refBone.updateMatrixWorld(true);
      const wq = new THREE.Quaternion().setFromRotationMatrix(refBone.matrixWorld);
      tmpX.copy(new THREE.Vector3(1, 0, 0)).applyQuaternion(wq);
      tmpY.copy(new THREE.Vector3(0, 1, 0)).applyQuaternion(wq);
      tmpZ.copy(new THREE.Vector3(0, 0, 1)).applyQuaternion(wq);
    }

    for (const name of axisBoneNames) {
      const bone = this._rigBones.get(name);
      if (!bone) {
        this.postDebug(`[FaceAxis] bone=${name} NOT FOUND`);
        continue;
      }
      bone.updateMatrixWorld(true);
      const wq = new THREE.Quaternion().setFromRotationMatrix(bone.matrixWorld);
      const bwx = new THREE.Vector3(1, 0, 0).applyQuaternion(wq);
      const bwy = new THREE.Vector3(0, 1, 0).applyQuaternion(wq);
      const bwz = new THREE.Vector3(0, 0, 1).applyQuaternion(wq);
      this.postDebug(`[FaceAxis] bone=${name}`);
      this.postDebug(`[FaceAxis]   worldX=(${bwx.x.toFixed(3)}, ${bwx.y.toFixed(3)}, ${bwx.z.toFixed(3)})`);
      this.postDebug(`[FaceAxis]   worldY=(${bwy.x.toFixed(3)}, ${bwy.y.toFixed(3)}, ${bwy.z.toFixed(3)})`);
      this.postDebug(`[FaceAxis]   worldZ=(${bwz.x.toFixed(3)}, ${bwz.y.toFixed(3)}, ${bwz.z.toFixed(3)})`);
      this.postDebug('');
    }

    // STEP 3: child direction for central and lateral lip chains
    const chainBoneNames = ['Bon_uplip01_L', 'Bon_Lolip01_L', 'Bon_uplip01_R', 'Bon_Lolip01_R',
                            'Bon_uplip_M', 'Bon_Lolip_M', 'Bon_zuiba_L', 'Bon_zuiba_R'];
    for (const name of chainBoneNames) {
      const bone = this._rigBones.get(name);
      if (!bone || bone.children.length === 0) continue;
      const child = bone.children[0];
      bone.updateMatrixWorld(true);
      child.updateMatrixWorld(true);
      tmpW.setFromMatrixPosition(child.matrixWorld);
      const bw = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
      const dir = new THREE.Vector3().subVectors(tmpW, bw).normalize();
      this.postDebug(`[FaceChain] bone=${name} child=${child.name}`);
      this.postDebug(`[FaceChain]   childDirection=(${dir.x.toFixed(3)}, ${dir.y.toFixed(3)}, ${dir.z.toFixed(3)})`);
      this.postDebug('');
    }

    // STEP 4: upper→lower lip separation direction
    const upBone = this._rigBones.get('Bon_uplip_M');
    const loBone = this._rigBones.get('Bon_Lolip_M');
    let upperToLower = new THREE.Vector3();
    if (upBone && loBone) {
      upBone.updateMatrixWorld(true);
      loBone.updateMatrixWorld(true);
      const upPos = new THREE.Vector3().setFromMatrixPosition(upBone.matrixWorld);
      const loPos = new THREE.Vector3().setFromMatrixPosition(loBone.matrixWorld);
      upperToLower = new THREE.Vector3().subVectors(loPos, upPos).normalize();
      this.postDebug(`[FaceDirection] upperToLower=(${upperToLower.x.toFixed(3)}, ${upperToLower.y.toFixed(3)}, ${upperToLower.z.toFixed(3)})`);

      // Which world axis best aligns with upper→lower?
      const dots = [
        { axis: 'X', d: Math.abs(upperToLower.dot(tmpX)) },
        { axis: 'Y', d: Math.abs(upperToLower.dot(tmpY)) },
        { axis: 'Z', d: Math.abs(upperToLower.dot(tmpZ)) },
      ];
      dots.sort((a, b) => b.d - a.d);
      this.postDebug(`[FaceDirection] upperToLower best world axis: ${dots[0].axis} (|dot|=${dots[0].d.toFixed(3)})`);
      this.postDebug('');
    }

    // ─── STEP 5: DERIVE BEST AXIS FOR EACH KEY BONE ───
    const testBoneNames = ['Bon_uplip_M', 'Bon_Lolip_M', 'Bon_uplip01_L', 'Bon_Lolip01_L', 'Bon_uplip01_R', 'Bon_Lolip01_R', 'Bon_zuiba_L', 'Bon_colip_L', 'Bon_yachi_lo', 'Bon_yachi_up'];
    const headBone = this._rigBones.get('mouth');
    const headRef = headBone ? new THREE.Vector3().setFromMatrixPosition(headBone.matrixWorld) : new THREE.Vector3();

    for (const name of testBoneNames) {
      const bone = this._rigBones.get(name);
      if (!bone) {
        this.postDebug(`[FaceAxis] ${name}: NOT FOUND — skipping derived axis`);
        continue;
      }
      bone.updateMatrixWorld(true);
      const bonePos = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);

      // Use child direction if available, else bone position relative to head
      let dir: THREE.Vector3;
      if (bone.children.length > 0) {
        const child = bone.children[0];
        child.updateMatrixWorld(true);
        const childPos = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld);
        dir = new THREE.Vector3().subVectors(childPos, bonePos).normalize();
      } else {
        dir = new THREE.Vector3().subVectors(bonePos, headRef).normalize();
      }

      // For each local axis, compute how much a +rotation moves the child along upperToLower
      // rotation around axis a moves point at dir by: cross(a, dir)
      const bwx = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(bone.matrixWorld));
      const bwy = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(bone.matrixWorld));
      const bwz = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(bone.matrixWorld));

      const axes = [
        { name: 'X', world: bwx },
        { name: 'Y', world: bwy },
        { name: 'Z', world: bwz },
      ];

      let bestAxis = 'X';
      let bestDot = -Infinity;
      for (const ax of axes) {
        const moveDir = new THREE.Vector3().crossVectors(ax.world, dir).normalize();
        const dot = Math.abs(moveDir.dot(upperToLower));
        if (dot > bestDot) {
          bestDot = dot;
          bestAxis = ax.name;
        }
      }

      // Determine sign: which sign of rotation moves in +upperToLower direction?
      const bestWorldAxis = axes.find(a => a.name === bestAxis)!.world;
      const moveDirPos = new THREE.Vector3().crossVectors(bestWorldAxis, dir).normalize();
      const sign = moveDirPos.dot(upperToLower) >= 0 ? 1 : -1;

      this.postDebug(`[FaceAxis] ${name}: derived best axis=${bestAxis} sign=${sign > 0 ? '+' : '-'} (|dot|=${bestDot.toFixed(3)})`);
      this.postDebug(`[FaceAxis]   childDir=(${dir.x.toFixed(3)}, ${dir.y.toFixed(3)}, ${dir.z.toFixed(3)})`);
      this.postDebug(`[FaceAxis]   bestAxisWorld=(${bestWorldAxis.x.toFixed(3)}, ${bestWorldAxis.y.toFixed(3)}, ${bestWorldAxis.z.toFixed(3)})`);
      this.postDebug('');

      this._rigBestAxis.set(name, bestAxis.toLowerCase() as 'x' | 'y' | 'z');
      this._rigBestSign.set(name, sign as 1 | -1);
    }

    this.postDebug('========== AXIS TEST ==========');
    this.postDebug('');

    // Setup state for axis test phase
    this._rigActive = true;
    this._rigPhase = 'axis';
    this._rigBoneIdx = 0;
    this._rigRotIdx = 0;
    this._rigCoorIdx = 0;
    this._rigJawIdx = 0;
    this._rigHoldPhase = 'hold';
    this._rigTimer = 0;
    this._sweepActive = true; // pause normal lip-sync
    this._sweepBones = [];
    this.createRigOverlay();
  }

  private createRigOverlay(): void {
    this.removeRigOverlay();
    const el = document.createElement('div');
    el.id = 'rig-test-overlay';
    el.innerHTML = [
      '<div style="font-size:18px;font-weight:bold;color:#e74c3c;">MINT FACIAL RIG TEST</div>',
      '<div id="rig-mode" style="font-size:16px;margin-top:6px;"></div>',
      '<div id="rig-detail" style="font-size:15px;margin-top:4px;color:#ff4;"></div>',
      '<div id="rig-prog" style="font-size:13px;margin-top:8px;color:#aaa;"></div>',
    ].join('');
    Object.assign(el.style, {
      position: 'fixed', top: '15px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '999999', padding: '14px 28px', borderRadius: '12px',
      background: 'rgba(0,0,0,0.88)', color: '#fff', fontFamily: 'monospace',
      textAlign: 'center', border: '2px solid #e74c3c', pointerEvents: 'none',
      minWidth: '300px',
    });
    document.body.appendChild(el);
    this._rigOverlay = el;
  }

  private updateRigOverlay(mode: string, detail: string, prog: string): void {
    if (!this._rigOverlay) return;
    const m = this._rigOverlay.querySelector('#rig-mode');
    const d = this._rigOverlay.querySelector('#rig-detail');
    const p = this._rigOverlay.querySelector('#rig-prog');
    if (m) m.textContent = mode;
    if (d) d.textContent = detail;
    if (p) p.textContent = prog;
  }

  private removeRigOverlay(): void {
    if (this._rigOverlay) { this._rigOverlay.remove(); this._rigOverlay = null; }
    const el = document.getElementById('rig-test-overlay');
    if (el) el.remove();
  }

  private rigForceUpdate(bone: THREE.Object3D): void {
    bone.updateMatrix();
    bone.matrixWorldNeedsUpdate = true;
    this.forceWorldMatrixUpdate(bone);
    if (this._rigMesh) this._rigMesh.skeleton.update();
    let w: THREE.Object3D | null = bone;
    while (w.parent) w = w.parent;
    w.updateMatrixWorld(true);
  }

  private rigApplyRotation(name: string, axis: 'x' | 'y' | 'z', angleDeg: number): void {
    const bone = this._rigBones.get(name);
    const bindQ = this._rigBindQuats.get(name);
    if (!bone || !bindQ) return;
    const delta = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(
        axis === 'x' ? 1 : 0,
        axis === 'y' ? 1 : 0,
        axis === 'z' ? 1 : 0,
      ),
      THREE.MathUtils.degToRad(angleDeg),
    );
    bone.quaternion.copy(bindQ).multiply(delta);
  }

  private rigRestore(name: string): void {
    const bone = this._rigBones.get(name);
    const bindQ = this._rigBindQuats.get(name);
    if (!bone || !bindQ) return;
    bone.quaternion.copy(bindQ);
  }

  runRigTest(delta: number): void {
    if (!this._rigActive) { this.finishRigTest(); return; }

    this._rigTimer += delta;

    // ─── PHASE 2: DERIVED-AXIS TEST (STEP 5) ───
    if (this._rigPhase === 'axis') {
      const testBoneNames = ['Bon_uplip_M', 'Bon_Lolip_M', 'Bon_uplip01_L', 'Bon_Lolip01_L', 'Bon_zuiba_L', 'Bon_colip_L'];
      const boneName = testBoneNames[this._rigBoneIdx];
      const bestAxis = this._rigBestAxis.get(boneName);
      const bestSign = this._rigBestSign.get(boneName);
      if (!bestAxis || !bestSign) {
        this.postDebug(`[FaceAxis] ${boneName}: NO DERIVED AXIS — skipping`);
        this._rigRotIdx = 0;
        this._rigBoneIdx++;
        if (this._rigBoneIdx >= testBoneNames.length) {
          this._rigPhase = 'coordinated';
          this._rigCoorIdx = 0;
          this.postDebug('');
          this.postDebug('========== COORDINATED TEST ==========');
          this.postDebug('');
        }
        return;
      }
      // 4 tests per bone: +5°, -5°, +10°, -10°
      const rotList = [
        { angle: bestSign * 5, label: `+5°` },
        { angle: -bestSign * 5, label: `-5°` },
        { angle: bestSign * 10, label: `+10°` },
        { angle: -bestSign * 10, label: `-10°` },
      ];
      const totalAxis = testBoneNames.length * rotList.length;
      const testNum = this._rigBoneIdx * rotList.length + this._rigRotIdx + 1;
      const rot = rotList[this._rigRotIdx];

      if (this._rigHoldPhase === 'hold') {
        this.rigApplyRotation(boneName, bestAxis, rot.angle);
        this.rigForceUpdate(this._rigBones.get(boneName)!);

        if (this._rigTimer <= delta * 2) {
          this.updateRigOverlay('BONE AXIS TEST', `${boneName}`,
            `LOCAL ${bestAxis.toUpperCase()} ${rot.label}   TEST ${testNum}/${totalAxis}`);
          this.postDebug(`[FaceAxis] ${boneName} ${bestAxis.toUpperCase()} ${rot.label} HOLDING`);
        }

        if (this._rigTimer >= LipSyncController.RIG_HOLD) {
          this._rigTimer = 0;
          this._rigHoldPhase = 'restore';
        }
      } else {
        this.rigRestore(boneName);
        this.rigForceUpdate(this._rigBones.get(boneName)!);

        if (this._rigTimer <= delta * 2) {
          this.postDebug(`[FaceAxis] ${boneName} ${bestAxis.toUpperCase()} ${rot.label} RESTORED`);
        }

        if (this._rigTimer >= LipSyncController.RIG_REST) {
          this._rigTimer = 0;
          this._rigHoldPhase = 'hold';
          this._rigRotIdx++;
          if (this._rigRotIdx >= rotList.length) {
            this._rigRotIdx = 0;
            this._rigBoneIdx++;
            if (this._rigBoneIdx >= testBoneNames.length) {
              this._rigPhase = 'coordinated';
              this._rigCoorIdx = 0;
              this.postDebug('');
              this.postDebug('========== COORDINATED TEST ==========');
              this.postDebug('');
            }
          }
        }
      }
      return;
    }

    // ─── PHASE 3: COORDINATED MOUTH-OPEN TEST ───
    if (this._rigPhase === 'coordinated') {
      const magnitudes = LipSyncController.RIG_COOR_MAGNITUDES;
      const mag = magnitudes[this._rigCoorIdx];
      const totalCoor = magnitudes.length;
      const testNum = this._rigCoorIdx + 1;

      if (this._rigHoldPhase === 'hold') {
        // Apply coordinated pose using each bone's derived best axis
        // Upper lip bones: +mag along their best axis (open mouth)
        // Lower lip bones: -mag along their best axis (open mouth)
        for (const name of LipSyncController.RIG_COOR_BONES) {
          const isUpper = name.includes('uplip');
          const axis = this._rigBestAxis.get(name);
          const sign = this._rigBestSign.get(name);
          if (axis && sign) {
            this.rigApplyRotation(name, axis, isUpper ? mag * sign : -mag * sign);
          }
        }
        for (const name of LipSyncController.RIG_COOR_BONES) {
          const bone = this._rigBones.get(name);
          if (bone) this.rigForceUpdate(bone);
        }

        if (this._rigTimer <= delta * 2) {
          const axisStr = this._rigBestAxis.get('Bon_uplip_M')?.toUpperCase() ?? 'X';
          this.updateRigOverlay('COORDINATED MOUTH', `POSE: ${mag}° LOCAL ${axisStr}`,
            `UPPER=+${mag}° LOWER=-${mag}°   TEST ${testNum}/${totalCoor}`);
          this.postDebug(`[FacePose] magnitude=${mag}° HOLDING`);
        }

        if (this._rigTimer >= LipSyncController.RIG_HOLD) {
          this._rigTimer = 0;
          this._rigHoldPhase = 'restore';
        }
      } else {
        for (const name of LipSyncController.RIG_COOR_BONES) {
          this.rigRestore(name);
        }
        for (const name of LipSyncController.RIG_COOR_BONES) {
          const bone = this._rigBones.get(name);
          if (bone) this.rigForceUpdate(bone);
        }

        if (this._rigTimer <= delta * 2) {
          this.postDebug(`[FacePose] magnitude=${mag}° RESTORED`);
        }

        if (this._rigTimer >= LipSyncController.RIG_REST) {
          this._rigTimer = 0;
          this._rigHoldPhase = 'hold';
          this._rigCoorIdx++;
          if (this._rigCoorIdx >= magnitudes.length) {
            this._rigPhase = 'jaw';
            this._rigJawIdx = 0;
            this.postDebug('');
            this.postDebug('========== JAW TEST ==========');
            this.postDebug('');
          }
        }
      }
      return;
    }

    // ─── PHASE 4: JAW TEST (STEP 7) ───
    if (this._rigPhase === 'jaw') {
      const magnitudes = LipSyncController.RIG_JAW_MAGNITUDES;
      const boneName = LipSyncController.RIG_JAW_BONES[this._rigJawIdx % 2];
      const magIdx = Math.floor(this._rigJawIdx / 2);
      const mag = magnitudes[magIdx] ?? magnitudes[magnitudes.length - 1];
      const totalJaw = LipSyncController.RIG_JAW_BONES.length * magnitudes.length;
      const testNum = this._rigJawIdx + 1;

      const jawAxis = this._rigBestAxis.get(boneName);
      const jawSign = this._rigBestSign.get(boneName);
      const axisLabel = jawAxis ? jawAxis.toUpperCase() : 'X';
      const angle = (jawAxis && jawSign) ? jawSign * mag : mag;

      if (this._rigHoldPhase === 'hold') {
        this.rigApplyRotation(boneName, jawAxis ?? 'x', angle);
        const jawBoneH = this._rigBones.get(boneName);
        if (jawBoneH) this.rigForceUpdate(jawBoneH);

        if (this._rigTimer <= delta * 2) {
          this.updateRigOverlay('JAW TEST', `${boneName}`, `LOCAL ${axisLabel} ${jawSign > 0 ? '+' : '-'}${mag}°   TEST ${testNum}/${totalJaw}`);
          this.postDebug(`[JawTest] ${boneName} ${axisLabel}${jawSign > 0 ? '+' : '-'}${mag} HOLDING`);
        }

        if (this._rigTimer >= LipSyncController.RIG_HOLD) {
          this._rigTimer = 0;
          this._rigHoldPhase = 'restore';
        }
      } else {
        this.rigRestore(boneName);
        const jawBone = this._rigBones.get(boneName);
        if (jawBone) this.rigForceUpdate(jawBone);

        if (this._rigTimer <= delta * 2) {
          this.postDebug(`[JawTest] ${boneName} ${axisLabel}${jawSign > 0 ? '+' : '-'}${mag} RESTORED`);
        }

        if (this._rigTimer >= LipSyncController.RIG_REST) {
          this._rigTimer = 0;
          this._rigHoldPhase = 'hold';
          this._rigJawIdx++;
          if (this._rigJawIdx >= totalJaw) {
            this.finishRigTest();
            return;
          }
        }
      }
      return;
    }
  }

  private finishRigTest(): void {
    // Restore ALL tested bones
    for (const [name] of this._rigBones) {
      this.rigRestore(name);
    }
    for (const [name] of this._rigBones) {
      const bone = this._rigBones.get(name);
      if (bone) this.rigForceUpdate(bone);
    }

    this._rigActive = false;
    this.removeRigOverlay();

    this.postDebug('');
    this.postDebug('========== COMPLETE ==========');
    this.postDebug('All bones restored to exact bind pose.');

    LipSyncController._facialRigTestActive = false;
  }

  // ═══════════════════════════════════════════════════════════════
  //  VISUAL MOUTH-OPENING DIAGNOSTIC
  // ═══════════════════════════════════════════════════════════════

  triggerMouthTest(): void {
    if (this._mouthActive) {
      this.postDebug('[FaceMouth] Already running');
      return;
    }
    if (this.mode !== 'bone') {
      this.postDebug('[FaceMouth] Cannot test — mode is not bone');
      return;
    }

    // Find candidate bones
    this._mouthBones = [];
    for (const name of LipSyncController.MOUTH_CANDIDATES) {
      const bone = this.findBoneByName(name);
      if (bone) {
        this._mouthBones.push({ bone, name, bindQuat: bone.quaternion.clone() });
      }
    }
    if (this._mouthBones.length === 0) {
      this.postDebug('[FaceMouth] ERROR: No bones found');
      return;
    }

    // Find the SkinnedMesh
    this.discoverSkinnedMesh();
    this._mouthMesh = this._measureMesh;

    const total = this._mouthBones.length * LipSyncController.MOUTH_ROTS.length;
    this.postDebug('[FaceMouth]');
    this.postDebug(`[FaceMouth] ═══ MOUTH OPENING TEST START ═══`);
    this.postDebug(`[FaceMouth] Bones: ${this._mouthBones.map(b => b.name).join(', ')}`);
    this.postDebug(`[FaceMouth] Tests: ${this._mouthBones.length} bones × ${LipSyncController.MOUTH_ROTS.length} rotations = ${total}`);
    this.postDebug(`[FaceMouth] Rotation: ±${LipSyncController.MOUTH_ROT_DEG}° Hold: ${LipSyncController.MOUTH_HOLD}s Rest: ${LipSyncController.MOUTH_REST}s`);
    this.postDebug('[FaceMouth]');

    this._mouthActive = true;
    this._mouthBoneIdx = 0;
    this._mouthRotIdx = 0;
    this._mouthPhase = 'hold';
    this._mouthTimer = 0;
    this._sweepActive = true; // pause normal lip-sync
    this._sweepBones = [];

    this.createMouthOverlay();
  }

  private createMouthOverlay(): void {
    this.removeMouthOverlay();
    const total = this._mouthBones.length * LipSyncController.MOUTH_ROTS.length;
    const el = document.createElement('div');
    el.id = 'mouth-open-overlay';
    el.innerHTML = [
      '<div style="font-size:20px;font-weight:bold;color:#f39c12;">MINT MOUTH CONTROL TEST</div>',
      '<div id="mo-bone" style="font-size:18px;margin-top:6px;"></div>',
      '<div id="mo-axis" style="font-size:16px;margin-top:4px;"></div>',
      '<div id="mo-prog" style="font-size:14px;margin-top:8px;color:#aaa;"></div>',
    ].join('');
    Object.assign(el.style, {
      position: 'fixed', top: '15px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '999999', padding: '14px 28px', borderRadius: '12px',
      background: 'rgba(0,0,0,0.88)', color: '#fff', fontFamily: 'monospace',
      textAlign: 'center', border: '2px solid #f39c12', pointerEvents: 'none',
      minWidth: '280px',
    });
    document.body.appendChild(el);
    this._mouthOverlay = el;
  }

  private updateMouthOverlay(boneName: string, axisLabel: string, angle: number, testNum: number, total: number): void {
    if (!this._mouthOverlay) return;
    const b = this._mouthOverlay.querySelector('#mo-bone');
    const a = this._mouthOverlay.querySelector('#mo-axis');
    const p = this._mouthOverlay.querySelector('#mo-prog');
    if (b) b.textContent = `Bone: ${boneName}`;
    if (a) a.textContent = `Axis: ${axisLabel}   Angle: ${angle > 0 ? '+' : ''}${angle}°`;
    if (p) p.textContent = `TEST ${testNum} / ${total}`;
  }

  private removeMouthOverlay(): void {
    if (this._mouthOverlay) { this._mouthOverlay.remove(); this._mouthOverlay = null; }
    const el = document.getElementById('mouth-open-overlay');
    if (el) el.remove();
  }

  /**
   * Run one frame of the visual mouth-opening test.
   * Tests each bone × 6 rotations at ±15°, holds for visual inspection.
   */
  runMouthTest(delta: number): void {
    if (!this._mouthActive || this._mouthBones.length === 0) {
      this.finishMouthTest();
      return;
    }

    const entry = this._mouthBones[this._mouthBoneIdx];
    const rot = LipSyncController.MOUTH_ROTS[this._mouthRotIdx];
    const rotRad = rot.angle * Math.PI / 180;
    const total = this._mouthBones.length * LipSyncController.MOUTH_ROTS.length;
    const testNum = this._mouthBoneIdx * LipSyncController.MOUTH_ROTS.length + this._mouthRotIdx + 1;

    this._mouthTimer += delta;

    if (this._mouthPhase === 'hold') {
      // Apply rotation
      entry.bone.quaternion.copy(entry.bindQuat);
      _tmpEuler.set(0, 0, 0);
      _tmpEuler[rot.axis] = rotRad;
      _tmpQuat.setFromEuler(_tmpEuler);
      entry.bone.quaternion.multiply(_tmpQuat);

      // Force matrix update
      entry.bone.updateMatrix();
      entry.bone.matrixWorldNeedsUpdate = true;
      this.forceWorldMatrixUpdate(entry.bone);
      if (this._mouthMesh) this._mouthMesh.skeleton.update();

      // Update overlay on first frame
      if (this._mouthTimer <= delta * 2) {
        this.updateMouthOverlay(entry.name, rot.label, rot.angle, testNum, total);
        this.postDebug(`[FaceMouth] TEST ${testNum}/${total}  ${entry.name} ${rot.label} (${rot.angle > 0 ? '+' : ''}${rot.angle}°) HOLDING`);
      }

      if (this._mouthTimer >= LipSyncController.MOUTH_HOLD) {
        this._mouthTimer = 0;
        this._mouthPhase = 'restore';
      }
    } else {
      // Restore phase
      entry.bone.quaternion.copy(entry.bindQuat);
      entry.bone.updateMatrix();
      entry.bone.matrixWorldNeedsUpdate = true;
      this.forceWorldMatrixUpdate(entry.bone);
      if (this._mouthMesh) this._mouthMesh.skeleton.update();

      if (this._mouthTimer <= delta * 2) {
        this.postDebug(`[FaceMouth] TEST ${testNum}/${total}  ${entry.name} ${rot.label} RESTORED`);
      }

      if (this._mouthTimer >= LipSyncController.MOUTH_REST) {
        this._mouthTimer = 0;
        this._mouthPhase = 'hold';
        this._mouthRotIdx++;

        if (this._mouthRotIdx >= LipSyncController.MOUTH_ROTS.length) {
          this._mouthRotIdx = 0;
          this._mouthBoneIdx++;
          if (this._mouthBoneIdx >= this._mouthBones.length) {
            this.finishMouthTest();
            return;
          }
        }
      }
    }
  }

  private finishMouthTest(): void {
    // Restore ALL bones
    for (const entry of this._mouthBones) {
      entry.bone.quaternion.copy(entry.bindQuat);
      entry.bone.updateMatrix();
      entry.bone.matrixWorldNeedsUpdate = true;
    }
    if (this._mouthBones.length > 0) {
      this.forceWorldMatrixUpdate(this._mouthBones[0].bone);
    }
    if (this._mouthMesh) this._mouthMesh.skeleton.update();

    this._mouthActive = false;
    this.removeMouthOverlay();

    this.postDebug('[FaceMouth]');
    this.postDebug('[FaceMouth] COMPLETE');
    this.postDebug('[FaceMouth]');
    this.postDebug(`[FaceMouth] Candidate controls tested: ${this._mouthBones.map(b => b.name).join(', ')}`);
    this.postDebug('[FaceMouth]');
    this.postDebug('[FaceMouth] All bones restored to bind pose.');
  }
}
