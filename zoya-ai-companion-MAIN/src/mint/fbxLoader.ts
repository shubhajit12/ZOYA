import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export interface LoadedMintModel {
  group: THREE.Group;
  morphTargets: { mesh: THREE.Mesh; dictionary: { [key: string]: number } }[];
  headBone: THREE.Object3D | null;
}

/**
 * Known Mint texture filenames → correct served URLs.
 * Built by scanning public/ at startup.
 */
const knownTextures = new Map<string, string>();

async function discoverTextures(): Promise<void> {
  if (knownTextures.size > 0) return;

  const filenames = [
    'common_face_d.png',
    'T_player_019_mint_01_d_1.png',
    'T_player_019_mint_02_d_new.png',
    'T_player_019_mint_eyes_d.png',
    'T_player_019_mint_face_d1.png',
    'T_player_019_mint_hair_01_d.png',
    'T_player_019_mint_hair_02_d.png',
  ];

  const dirs = ['/textures/', '/mint/', '/mint/textures/'];

  for (const dir of dirs) {
    for (const name of filenames) {
      if (knownTextures.has(name)) continue;
      try {
        const resp = await fetch(`${dir}${name}`, { method: 'HEAD' });
        if (resp.ok) {
          knownTextures.set(name, `${dir}${name}`);
        }
      } catch { /* ignore */ }
    }
  }

  console.log('[FBXLoader] Texture discovery:', Object.fromEntries(knownTextures));
}

export class MintFBXService {

  public async loadFBXFromUrl(url: string): Promise<LoadedMintModel> {
    await discoverTextures();
    const loader = this.createLoader();
    const fbx = await new Promise<THREE.Group>((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });
    console.log(`[FBXLoader] FBX loaded from: ${url}`);
    return this.processLoadedFBX(fbx);
  }

  public async loadFbxFromFile(file: File): Promise<LoadedMintModel> {
    await discoverTextures();
    const loader = this.createLoader();
    const fbx = await new Promise<THREE.Group>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          resolve(loader.parse(e.target!.result as ArrayBuffer, file.name));
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsArrayBuffer(file);
    });
    console.log(`[FBXLoader] Parsed uploaded file: ${file.name}`);
    return this.processLoadedFBX(fbx);
  }

  /**
   * Override resolveURL to redirect broken texture paths.
   */
  private createLoader(): FBXLoader {
    const manager = new THREE.LoadingManager();

    const originalResolve = manager.resolveURL.bind(manager);
    manager.resolveURL = (url: string, path?: string) => {
      const filename = url.split(/[/\\]/).pop() || url;
      if (knownTextures.has(filename)) {
        const correct = knownTextures.get(filename)!;
        if (correct !== url) {
          console.log(`[FBXLoader] ↳ Redirecting: "${url}" → "${correct}"`);
        }
        return correct;
      }
      return originalResolve(url, path);
    };

    manager.onError = (url: string) => {
      console.warn(`[FBXLoader] Texture 404: ${url}`);
    };

    return new FBXLoader(manager);
  }

  private processLoadedFBX(fbx: THREE.Group): LoadedMintModel {

    // ═══════════════════════════════════════════════════════════════
    //  BEFORE: Log what FBXLoader assigned (PBR materials)
    // ═══════════════════════════════════════════════════════════════
    console.group('[Mint] ═══ BEFORE conversion (PBR) ═══');
    this.logMaterials(fbx);
    console.groupEnd();

    // ═══════════════════════════════════════════════════════════════
    //  KEY FIX: Convert ALL materials from PBR → Unlit/Emission
    //
    //  Mint was designed for flat 2D anime shading:
    //    Image Texture → Emission → Material Output
    //
    //  Three.js equivalent: MeshBasicMaterial
    //  - Texture color displayed directly, no lighting calculations
    //  - No shadows, no reflections, no PBR shading
    //  - Preserves original texture appearance exactly
    //
    //  This is the Blender emission shader translated to Three.js.
    // ═══════════════════════════════════════════════════════════════
    let convertedCount = 0;
    fbx.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;

      // Disable shadows — Mint is flat anime, no self-shadowing
      mesh.castShadow = false;
      mesh.receiveShadow = false;

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

      const newMats = materials.map((mat) => {
        const m = mat as any;

        // If material has a diffuse texture, convert to unlit
        if (m.map) {
          const tex = m.map as THREE.Texture;
          // Ensure correct colorSpace for the texture
          tex.colorSpace = THREE.SRGBColorSpace;

          const unlit = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: m.transparent || false,
            opacity: m.opacity !== undefined ? m.opacity : 1.0,
            side: m.side !== undefined ? m.side : THREE.FrontSide,
            depthWrite: m.transparent ? false : true,
          });
          unlit.name = m.name || 'unlit';
          convertedCount++;
          return unlit;
        }

        // No texture — preserve original material color as unlit
        if (m.color) {
          const unlit = new THREE.MeshBasicMaterial({
            color: m.color.clone(),
            transparent: m.transparent || false,
            opacity: m.opacity !== undefined ? m.opacity : 1.0,
            side: m.side !== undefined ? m.side : THREE.FrontSide,
            depthWrite: m.transparent ? false : true,
          });
          unlit.name = m.name || 'unlit';
          convertedCount++;
          return unlit;
        }

        // Fallback — white unlit
        return new THREE.MeshBasicMaterial({ color: 0xffffff });
      });

      mesh.material = Array.isArray(mesh.material) ? newMats : newMats[0];
    });

    console.log(`[Mint] ✅ Converted ${convertedCount} material(s) from PBR → Unlit/Emission`);

    // ═══════════════════════════════════════════════════════════════
    //  AFTER: Log the unlit materials
    // ═══════════════════════════════════════════════════════════════
    console.group('[Mint] ═══ AFTER conversion (Unlit) ═══');
    this.logMaterials(fbx);
    console.groupEnd();

    // ═══════════════════════════════════════════════════════════════
    //  EXTRACT DATA — morph targets, animations, bones
    // ═══════════════════════════════════════════════════════════════
    const morphTargets: { mesh: THREE.Mesh; dictionary: { [key: string]: number } }[] = [];
    let headBone: THREE.Object3D | null = null;
    const allBones: string[] = [];
    const allMeshes: string[] = [];

    fbx.traverse((child) => {
      if ((child as THREE.Bone).isBone) allBones.push(child.name);
      const n = child.name.toLowerCase();
      if ((n.includes('head') || n.includes('neck') || n.includes('eye') || n.includes('jaw')) && !headBone) {
        headBone = child;
      }
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        allMeshes.push(mesh.name);
        if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
          morphTargets.push({ mesh, dictionary: mesh.morphTargetDictionary });
        }
      }
    });

    console.group('[Mint] ═══ Summary ═══');
    console.log(`  Bones: ${allBones.length}, Meshes: ${allMeshes.length}`);
    console.log(`  Bone names:`, allBones);
    console.log(`  Mesh names:`, allMeshes);
    // ALWAYS log mesh info — even if no morph targets found
    console.log(`  All mesh names:`, allMeshes);
    console.log(`  Total meshes found: ${allMeshes.length}`);
    if (morphTargets.length > 0) {
      console.log(`  Morph targets: ${morphTargets.reduce((s, mt) => s + Object.keys(mt.dictionary).length, 0)} across ${morphTargets.length} mesh(es)`);
      morphTargets.forEach(({ mesh, dictionary }) => {
        console.log(`  [Mint LipSync] Mesh: "${mesh.name}"`);
        console.log(`  [Mint LipSync] Morph targets:`);
        Object.keys(dictionary).forEach((name) => {
          console.log(`    ${name} (idx=${dictionary[name]})`);
        });
      });
    } else {
      console.warn('  [Mint LipSync] NO MORPH TARGETS FOUND on any mesh');
      console.log('  Checking each mesh for morph data...');
      fbx.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const hasDict = !!mesh.morphTargetDictionary;
          const hasInfl = !!mesh.morphTargetInfluences;
          const inflLen = mesh.morphTargetInfluences?.length ?? 0;
          console.log(`    Mesh "${mesh.name}": morphDict=${hasDict} morphInfluences=${hasInfl} inflLength=${inflLen}`);
        }
      });
    }
    // NOTE: Animations are no longer loaded by this service.
    // The procedural animation system in ./animation/ handles all animation.
    console.groupEnd();

    // Auto-center & scale — fit model so full body is visible
    const box = new THREE.Box3().setFromObject(fbx);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      fbx.scale.setScalar(2.8 / maxDim);
    }
    const center = box.getCenter(new THREE.Vector3());
    fbx.position.sub(center.multiplyScalar(fbx.scale.x));
    fbx.position.y += 0.3;

    // Rotate 180° around Y so Mint faces the camera (camera is at +Z)
    fbx.rotation.y = Math.PI;

    return { group: fbx, morphTargets, headBone };
  }

  private logMaterials(fbx: THREE.Group): void {
    fbx.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;
      const mesh = child as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mat, idx) => {
        const m = mat as any;
        const maps: string[] = [];
        ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'].forEach((prop) => {
          const tex: THREE.Texture | null = m[prop];
          if (tex) {
            const img = tex.image as any;
            const src = img?.src || img?.currentSrc || '(embedded)';
            maps.push(`${prop}=${src}`);
          }
        });
        const color = m.color ? `#${m.color.getHexString()}` : 'none';
        console.log(`  "${mesh.name}" Mat[${idx}] "${m.name || '?'}" type=${m.type} color=${color} [${maps.join(', ') || 'NO MAPS'}]`);
      });
    });
  }
}

export const mintFbxService = new MintFBXService();

