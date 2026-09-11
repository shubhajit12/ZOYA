import * as THREE from 'three';
import { EmotionType, VisemeFrame } from '../types';

export interface ProceduralMintRig {
  group: THREE.Group;
  headGroup: THREE.Group;
  leftEyeGroup: THREE.Group;
  rightEyeGroup: THREE.Group;
  leftUpperEyelid: THREE.Mesh;
  rightUpperEyelid: THREE.Mesh;
  leftLowerEyelid: THREE.Mesh;
  rightLowerEyelid: THREE.Mesh;
  leftBlush: THREE.Mesh;
  rightBlush: THREE.Mesh;
  mouthMesh: THREE.Mesh;
  mouthLineMesh: THREE.Line;
  leftEyebrow: THREE.Mesh;
  rightEyebrow: THREE.Mesh;
  hairGroup: THREE.Group;
  torsoGroup: THREE.Group;
  updateExpression: (emotion: EmotionType, intensity: number, viseme: VisemeFrame, delta: number) => void;
}

export function createProceduralMint(): ProceduralMintRig {
  const group = new THREE.Group();
  group.name = 'MintProceduralAvatar';

  // Materials
  const skinMaterial = new THREE.MeshStandardMaterial({
    color: 0xffe2d1,
    roughness: 0.5,
    metalness: 0.05,
  });

  const mintHairMaterial = new THREE.MeshStandardMaterial({
    color: 0x4be3c1, // Mint teal signature hair color
    roughness: 0.35,
    metalness: 0.1,
  });

  const eyeWhiteMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.2,
  });

  const irisMaterial = new THREE.MeshStandardMaterial({
    color: 0x22a39f, // Mint deep emerald green iris
    roughness: 0.1,
    metalness: 0.2,
  });

  const pupilMaterial = new THREE.MeshBasicMaterial({ color: 0x0f2d2a });
  const highlightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const clothingMaterial = new THREE.MeshStandardMaterial({
    color: 0x3b82f6, // Modern cozy hoodie navy blue
    roughness: 0.7,
  });

  const mouthMaterial = new THREE.MeshStandardMaterial({
    color: 0xe15b64,
    roughness: 0.3,
    side: THREE.DoubleSide,
  });

  const mouthLineMaterial = new THREE.LineBasicMaterial({
    color: 0x8a2b3b,
    linewidth: 2,
  });

  const blushMaterial = new THREE.MeshBasicMaterial({
    color: 0xff6b8b,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });

  const eyebrowMaterial = new THREE.MeshBasicMaterial({ color: 0x1f7a6a });

  // Torso / Body
  const torsoGroup = new THREE.Group();
  const bodyGeo = new THREE.CylinderGeometry(0.55, 0.65, 1.4, 32);
  const bodyMesh = new THREE.Mesh(bodyGeo, clothingMaterial);
  bodyMesh.position.y = -0.7;
  torsoGroup.add(bodyMesh);

  // Hoodie collar
  const collarGeo = new THREE.TorusGeometry(0.5, 0.12, 16, 32);
  const collarMesh = new THREE.Mesh(collarGeo, clothingMaterial);
  collarMesh.rotation.x = Math.PI / 2;
  collarMesh.position.y = -0.05;
  torsoGroup.add(collarMesh);

  // Neck
  const neckGeo = new THREE.CylinderGeometry(0.2, 0.22, 0.4, 16);
  const neckMesh = new THREE.Mesh(neckGeo, skinMaterial);
  neckMesh.position.y = 0.15;
  torsoGroup.add(neckMesh);

  group.add(torsoGroup);

  // Head Group (parent for rotation & look-at)
  const headGroup = new THREE.Group();
  headGroup.position.y = 0.55;

  // Head Base Mesh
  const headGeo = new THREE.SphereGeometry(0.5, 32, 32);
  headGeo.scale(1.0, 1.12, 1.0);
  const headMesh = new THREE.Mesh(headGeo, skinMaterial);
  headGroup.add(headMesh);

  // Blush Circles (Cheeks)
  const blushGeo = new THREE.CircleGeometry(0.09, 20);
  
  const leftBlush = new THREE.Mesh(blushGeo, blushMaterial.clone());
  leftBlush.position.set(-0.25, -0.04, 0.44);
  leftBlush.rotation.y = -0.3;
  leftBlush.rotation.x = -0.1;
  headGroup.add(leftBlush);

  const rightBlush = new THREE.Mesh(blushGeo, blushMaterial.clone());
  rightBlush.position.set(0.25, -0.04, 0.44);
  rightBlush.rotation.y = 0.3;
  rightBlush.rotation.x = -0.1;
  headGroup.add(rightBlush);

  // Eyes
  const createEye = () => {
    const eyeContainer = new THREE.Group();

    // Eye globe background
    const globeGeo = new THREE.SphereGeometry(0.12, 16, 16);
    globeGeo.scale(1.0, 1.2, 0.5);
    const globe = new THREE.Mesh(globeGeo, eyeWhiteMaterial);
    eyeContainer.add(globe);

    // Iris
    const irisGeo = new THREE.CircleGeometry(0.075, 24);
    const iris = new THREE.Mesh(irisGeo, irisMaterial);
    iris.position.z = 0.055;
    eyeContainer.add(iris);

    // Pupil
    const pupilGeo = new THREE.CircleGeometry(0.035, 16);
    const pupil = new THREE.Mesh(pupilGeo, pupilMaterial);
    pupil.name = 'pupil';
    pupil.position.z = 0.058;
    eyeContainer.add(pupil);

    // Highlight dot
    const hlGeo = new THREE.CircleGeometry(0.018, 12);
    const hl = new THREE.Mesh(hlGeo, highlightMaterial);
    hl.name = 'highlight';
    hl.position.set(0.025, 0.03, 0.06);
    eyeContainer.add(hl);

    return eyeContainer;
  };

  const leftEyeGroup = createEye();
  leftEyeGroup.position.set(-0.16, 0.05, 0.44);
  headGroup.add(leftEyeGroup);

  const rightEyeGroup = createEye();
  rightEyeGroup.position.set(0.16, 0.05, 0.44);
  headGroup.add(rightEyeGroup);

  // Upper Eyelids (for blinking, squinting, happy crescents, sleepy/sad droop)
  const createUpperEyelid = () => {
    const geo = new THREE.SphereGeometry(0.128, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.scale(1.02, 1.22, 0.52);
    const mesh = new THREE.Mesh(geo, skinMaterial);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  };

  const leftUpperEyelid = createUpperEyelid();
  leftUpperEyelid.position.set(-0.16, 0.05, 0.44);
  headGroup.add(leftUpperEyelid);

  const rightUpperEyelid = createUpperEyelid();
  rightUpperEyelid.position.set(0.16, 0.05, 0.44);
  headGroup.add(rightUpperEyelid);

  // Lower Eyelids (for happy crescent eyes, squinting, smiling)
  const createLowerEyelid = () => {
    const geo = new THREE.SphereGeometry(0.126, 16, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    geo.scale(1.02, 1.22, 0.52);
    const mesh = new THREE.Mesh(geo, skinMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.y = 0.01;
    return mesh;
  };

  const leftLowerEyelid = createLowerEyelid();
  leftLowerEyelid.position.set(-0.16, 0.05, 0.44);
  headGroup.add(leftLowerEyelid);

  const rightLowerEyelid = createLowerEyelid();
  rightLowerEyelid.position.set(0.16, 0.05, 0.44);
  headGroup.add(rightLowerEyelid);

  // Eyebrows
  const eyebrowGeo = new THREE.BoxGeometry(0.14, 0.025, 0.02);

  const leftEyebrow = new THREE.Mesh(eyebrowGeo, eyebrowMaterial);
  leftEyebrow.position.set(-0.16, 0.22, 0.48);
  headGroup.add(leftEyebrow);

  const rightEyebrow = new THREE.Mesh(eyebrowGeo, eyebrowMaterial);
  rightEyebrow.position.set(0.16, 0.22, 0.48);
  headGroup.add(rightEyebrow);

  // Mouth Assembly (Dynamic procedural mouth mesh + outline)
  // We construct a parametric mouth geometry that can morph curvature (smile/frown), aperture, and width
  const mouthSegments = 16;
  const mouthGeo = new THREE.PlaneGeometry(0.18, 0.08, mouthSegments, 4);
  const mouthMesh = new THREE.Mesh(mouthGeo, mouthMaterial);
  mouthMesh.position.set(0, -0.16, 0.48);
  headGroup.add(mouthMesh);

  // Mouth upper lip curve line
  const mouthLinePoints: THREE.Vector3[] = [];
  for (let i = 0; i <= mouthSegments; i++) {
    mouthLinePoints.push(new THREE.Vector3((i / mouthSegments - 0.5) * 0.18, 0, 0.001));
  }
  const mouthLineGeo = new THREE.BufferGeometry().setFromPoints(mouthLinePoints);
  const mouthLineMesh = new THREE.Line(mouthLineGeo, mouthLineMaterial);
  mouthMesh.add(mouthLineMesh);

  // Hair Group (Mint signature anime bangs & back hair)
  const hairGroup = new THREE.Group();

  // Back hair volume
  const backHairGeo = new THREE.SphereGeometry(0.53, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.75);
  const backHair = new THREE.Mesh(backHairGeo, mintHairMaterial);
  backHair.position.set(0, 0.05, -0.05);
  hairGroup.add(backHair);

  // Front Bangs
  for (let i = -3; i <= 3; i++) {
    const bangGeo = new THREE.ConeGeometry(0.08, 0.35, 12);
    const bang = new THREE.Mesh(bangGeo, mintHairMaterial);
    bang.position.set(i * 0.07, 0.32, 0.42 - Math.abs(i) * 0.03);
    bang.rotation.z = -i * 0.12;
    bang.rotation.x = 0.3;
    hairGroup.add(bang);
  }

  // Side hair strands
  const leftStrandGeo = new THREE.CylinderGeometry(0.05, 0.02, 0.5, 12);
  const leftStrand = new THREE.Mesh(leftStrandGeo, mintHairMaterial);
  leftStrand.position.set(-0.48, -0.05, 0.2);
  leftStrand.rotation.z = -0.2;
  hairGroup.add(leftStrand);

  const rightStrand = new THREE.Mesh(leftStrandGeo, mintHairMaterial);
  rightStrand.position.set(0.48, -0.05, 0.2);
  rightStrand.rotation.z = 0.2;
  hairGroup.add(rightStrand);

  headGroup.add(hairGroup);
  group.add(headGroup);

  // Animation parameters & State
  let timeAcc = 0;
  let blinkTimer = 0;
  let isBlinking = false;
  let blinkProgress = 0;

  // Smoothed internal expression values (prevents sudden snaps!)
  const smoothed = {
    headTiltZ: 0,
    headTiltX: 0,
    headPanY: 0,
    eyebrowY: 0.22,
    eyebrowRotL: 0,
    eyebrowRotR: 0,
    eyebrowSpread: 0.16,
    upperLidScale: 0.01,
    lowerLidScale: 0.01,
    blushOpacity: 0.0,
    blushScale: 1.0,
    mouthSmileCurve: 0.0,
    mouthOpenAmount: 0.0,
    mouthWidth: 1.0,
    pupilScale: 1.0,
  };

  const updateExpression = (
    emotion: EmotionType,
    intensity: number,
    viseme: VisemeFrame,
    delta: number
  ) => {
    timeAcc += delta;
    const clampedIntensity = Math.min(Math.max(intensity, 0.15), 1.0);

    // 1. Natural Breathing Idle Loop
    const breathRate = emotion === 'excited' ? 2.8 : emotion === 'sad' ? 1.2 : 1.8;
    const breath = Math.sin(timeAcc * breathRate) * 0.02;
    torsoGroup.position.y = breath;
    headGroup.position.y = 0.55 + (breath * 0.5);

    // 2. Blinking Logic
    blinkTimer += delta;
    const blinkInterval = emotion === 'surprised' ? 6.0 : emotion === 'embarrassed' || emotion === 'shy' ? 2.5 : 4.0;
    if (blinkTimer > blinkInterval + Math.random() * 1.5) {
      isBlinking = true;
      blinkTimer = 0;
      blinkProgress = 0;
    }

    let blinkVal = 0.01;
    if (isBlinking) {
      blinkProgress += delta * 14;
      if (blinkProgress >= Math.PI) {
        isBlinking = false;
        blinkVal = 0.01;
      } else {
        blinkVal = Math.sin(blinkProgress);
      }
    }

    // 3. Target Parameters Calculation for Current Emotion
    let targetHeadTiltZ = 0;
    let targetHeadTiltX = 0;
    let targetHeadPanY = 0;
    let targetEyebrowY = 0.22;
    let targetEyebrowRotL = 0;
    let targetEyebrowRotR = 0;
    let targetEyebrowSpread = 0.16;
    let targetUpperLid = 0.01;
    let targetLowerLid = 0.01;
    let targetBlushOpacity = 0.0;
    let targetBlushScale = 1.0;
    let targetMouthSmileCurve = 0.0; // Positive = smile, Negative = frown
    let targetMouthOpen = 0.0;
    let targetMouthWidth = 1.0;
    let targetPupilScale = 1.0;

    switch (emotion) {
      case 'happy':
        targetHeadTiltZ = Math.sin(timeAcc * 1.5) * 0.04;
        targetEyebrowY = 0.235 + (clampedIntensity * 0.02);
        targetEyebrowRotL = 0.08 * clampedIntensity;
        targetEyebrowRotR = -0.08 * clampedIntensity;
        targetLowerLid = 0.25 * clampedIntensity; // gentle crescent eye smile
        targetBlushOpacity = 0.35 * clampedIntensity;
        targetMouthSmileCurve = 0.7 * clampedIntensity;
        targetMouthWidth = 1.15;
        targetPupilScale = 1.1;
        break;

      case 'excited':
        targetHeadTiltZ = Math.sin(timeAcc * 3.5) * 0.06;
        targetHeadTiltX = Math.sin(timeAcc * 4.0) * 0.03;
        targetEyebrowY = 0.26 + (clampedIntensity * 0.03);
        targetEyebrowRotL = 0.12 * clampedIntensity;
        targetEyebrowRotR = -0.12 * clampedIntensity;
        targetUpperLid = 0.01;
        targetLowerLid = 0.35 * clampedIntensity;
        targetBlushOpacity = 0.6 * clampedIntensity;
        targetBlushScale = 1.2;
        targetMouthSmileCurve = 0.9 * clampedIntensity;
        targetMouthOpen = 0.3 * clampedIntensity;
        targetMouthWidth = 1.3;
        targetPupilScale = 1.25;
        break;

      case 'amused':
      case 'playful':
        targetHeadTiltZ = 0.07 * Math.sin(timeAcc * 2.2);
        targetEyebrowY = 0.24;
        targetEyebrowRotL = 0.1;
        targetEyebrowRotR = -0.05; // playful slight asymmetric brow
        targetLowerLid = 0.3 * clampedIntensity;
        targetBlushOpacity = 0.4 * clampedIntensity;
        targetMouthSmileCurve = 0.8 * clampedIntensity;
        targetMouthWidth = 1.2;
        targetPupilScale = 1.15;
        break;

      case 'affectionate':
        targetHeadTiltZ = 0.08 + (Math.sin(timeAcc * 1.0) * 0.02);
        targetHeadTiltX = -0.04;
        targetEyebrowY = 0.23;
        targetEyebrowRotL = 0.05;
        targetEyebrowRotR = -0.05;
        targetLowerLid = 0.3 * clampedIntensity; // warm gentle smiling eyes
        targetBlushOpacity = 0.65 * clampedIntensity;
        targetBlushScale = 1.15;
        targetMouthSmileCurve = 0.75 * clampedIntensity;
        targetMouthWidth = 1.1;
        targetPupilScale = 1.3; // dilated loving eyes
        break;

      case 'shy':
      case 'embarrassed':
        targetHeadTiltZ = -0.06;
        targetHeadTiltX = 0.08; // look slightly down
        targetHeadPanY = -0.08; // turn slightly away
        targetEyebrowY = 0.225;
        targetEyebrowRotL = -0.08 * clampedIntensity; // soft hesitant brows
        targetEyebrowRotR = 0.08 * clampedIntensity;
        targetUpperLid = 0.2 * clampedIntensity; // downcast gaze
        targetBlushOpacity = 0.85 * clampedIntensity; // deep pink blush
        targetBlushScale = 1.3;
        targetMouthSmileCurve = 0.3 * clampedIntensity;
        targetMouthWidth = 0.85; // small shy mouth
        targetPupilScale = 1.05;
        break;

      case 'sad':
      case 'concerned':
        targetHeadTiltZ = -0.05;
        targetHeadTiltX = 0.08; // head lowered
        targetEyebrowY = 0.21;
        targetEyebrowRotL = -0.16 * clampedIntensity; // inner brows raised sadly
        targetEyebrowRotR = 0.16 * clampedIntensity;
        targetUpperLid = 0.25 * clampedIntensity; // drooping sad eyelids
        targetBlushOpacity = 0.0;
        targetMouthSmileCurve = -0.65 * clampedIntensity; // downward frown
        targetMouthWidth = 0.9;
        targetPupilScale = 0.95;
        break;

      case 'angry':
        targetHeadTiltZ = 0.0;
        targetHeadTiltX = -0.06; // slight forward glare
        targetEyebrowY = 0.20;
        targetEyebrowRotL = 0.22 * clampedIntensity; // stern furrowed brows
        targetEyebrowRotR = -0.22 * clampedIntensity;
        targetEyebrowSpread = 0.14; // closer brows
        targetUpperLid = 0.3 * clampedIntensity; // narrowed eyes
        targetLowerLid = 0.15 * clampedIntensity;
        targetBlushOpacity = 0.25 * clampedIntensity; // flushed
        targetMouthSmileCurve = -0.4 * clampedIntensity; // grimace/firm
        targetMouthWidth = 0.95;
        targetPupilScale = 0.85; // focused pupils
        break;

      case 'surprised':
        targetHeadTiltZ = 0.02;
        targetHeadTiltX = -0.05; // slight head pull back
        targetEyebrowY = 0.28 + (clampedIntensity * 0.02); // high raised brows
        targetEyebrowRotL = 0.0;
        targetEyebrowRotR = 0.0;
        targetUpperLid = 0.0; // wide open eyes
        targetLowerLid = 0.0;
        targetBlushOpacity = 0.15;
        targetMouthSmileCurve = 0.1;
        targetMouthOpen = 0.65 * clampedIntensity; // 'O' mouth
        targetMouthWidth = 0.8;
        targetPupilScale = 0.8; // contracted shock pupils
        break;

      case 'thoughtful':
      case 'curious':
        targetHeadTiltZ = 0.12 * (emotion === 'curious' ? 1.2 : 0.8);
        targetHeadTiltX = -0.03;
        targetEyebrowY = 0.235;
        targetEyebrowRotL = 0.14 * clampedIntensity; // one eyebrow raised high
        targetEyebrowRotR = -0.02;
        targetUpperLid = 0.15 * clampedIntensity;
        targetBlushOpacity = 0.1;
        targetMouthSmileCurve = 0.2 * clampedIntensity;
        targetMouthWidth = 0.95;
        targetPupilScale = 1.05;
        break;

      case 'confused':
        targetHeadTiltZ = 0.14;
        targetEyebrowY = 0.22;
        targetEyebrowRotL = 0.16 * clampedIntensity; // quizzical brows
        targetEyebrowRotR = 0.12 * clampedIntensity;
        targetUpperLid = 0.2 * clampedIntensity;
        targetMouthSmileCurve = -0.2 * clampedIntensity;
        targetMouthWidth = 0.9;
        break;

      case 'neutral':
      default:
        targetHeadTiltZ = Math.sin(timeAcc * 0.8) * 0.02;
        targetHeadTiltX = 0;
        targetHeadPanY = Math.sin(timeAcc * 0.5) * 0.03;
        targetEyebrowY = 0.22;
        targetEyebrowRotL = 0;
        targetEyebrowRotR = 0;
        targetEyebrowSpread = 0.16;
        targetUpperLid = 0.01;
        targetLowerLid = 0.01;
        targetBlushOpacity = 0.08;
        targetMouthSmileCurve = 0.15; // gentle natural relaxed smile
        targetMouthWidth = 1.0;
        targetPupilScale = 1.0;
        break;
    }

    // 4. Smooth Exponential Lerp for all visual parameters (Transitions are smooth and fluid!)
    const lerpSpeed = Math.min(delta * 6.5, 0.4); // ~0.25-0.4s natural transition time

    smoothed.headTiltZ = THREE.MathUtils.lerp(smoothed.headTiltZ, targetHeadTiltZ, lerpSpeed);
    smoothed.headTiltX = THREE.MathUtils.lerp(smoothed.headTiltX, targetHeadTiltX, lerpSpeed);
    smoothed.headPanY = THREE.MathUtils.lerp(smoothed.headPanY, targetHeadPanY, lerpSpeed);
    smoothed.eyebrowY = THREE.MathUtils.lerp(smoothed.eyebrowY, targetEyebrowY, lerpSpeed);
    smoothed.eyebrowRotL = THREE.MathUtils.lerp(smoothed.eyebrowRotL, targetEyebrowRotL, lerpSpeed);
    smoothed.eyebrowRotR = THREE.MathUtils.lerp(smoothed.eyebrowRotR, targetEyebrowRotR, lerpSpeed);
    smoothed.eyebrowSpread = THREE.MathUtils.lerp(smoothed.eyebrowSpread, targetEyebrowSpread, lerpSpeed);
    smoothed.upperLidScale = THREE.MathUtils.lerp(smoothed.upperLidScale, targetUpperLid, lerpSpeed);
    smoothed.lowerLidScale = THREE.MathUtils.lerp(smoothed.lowerLidScale, targetLowerLid, lerpSpeed);
    smoothed.blushOpacity = THREE.MathUtils.lerp(smoothed.blushOpacity, targetBlushOpacity, lerpSpeed);
    smoothed.blushScale = THREE.MathUtils.lerp(smoothed.blushScale, targetBlushScale, lerpSpeed);
    smoothed.mouthSmileCurve = THREE.MathUtils.lerp(smoothed.mouthSmileCurve, targetMouthSmileCurve, lerpSpeed);
    smoothed.mouthOpenAmount = THREE.MathUtils.lerp(smoothed.mouthOpenAmount, targetMouthOpen, lerpSpeed);
    smoothed.mouthWidth = THREE.MathUtils.lerp(smoothed.mouthWidth, targetMouthWidth, lerpSpeed);
    smoothed.pupilScale = THREE.MathUtils.lerp(smoothed.pupilScale, targetPupilScale, lerpSpeed);

    // 5. Apply to Three.js Scene Graph Objects

    // Head Rotation
    headGroup.rotation.z = smoothed.headTiltZ;
    headGroup.rotation.x = smoothed.headTiltX;
    headGroup.rotation.y = smoothed.headPanY;

    // Eyebrows
    leftEyebrow.position.set(-smoothed.eyebrowSpread, smoothed.eyebrowY, 0.48);
    rightEyebrow.position.set(smoothed.eyebrowSpread, smoothed.eyebrowY, 0.48);
    leftEyebrow.rotation.z = smoothed.eyebrowRotL;
    rightEyebrow.rotation.z = smoothed.eyebrowRotR;

    // Upper & Lower Eyelids (Blink + Emotional Squint / Droop)
    const effectiveUpperLid = Math.max(blinkVal, smoothed.upperLidScale);
    leftUpperEyelid.scale.y = Math.max(0.01, effectiveUpperLid);
    rightUpperEyelid.scale.y = Math.max(0.01, effectiveUpperLid);

    leftLowerEyelid.scale.y = Math.max(0.01, smoothed.lowerLidScale);
    rightLowerEyelid.scale.y = Math.max(0.01, smoothed.lowerLidScale);

    // Blush Mesh Opacity & Scale
    const leftBlushMat = leftBlush.material as THREE.MeshBasicMaterial;
    const rightBlushMat = rightBlush.material as THREE.MeshBasicMaterial;
    leftBlushMat.opacity = smoothed.blushOpacity;
    rightBlushMat.opacity = smoothed.blushOpacity;
    leftBlush.scale.set(smoothed.blushScale, smoothed.blushScale, 1.0);
    rightBlush.scale.set(smoothed.blushScale, smoothed.blushScale, 1.0);

    // Pupils Dilation
    const leftPupil = leftEyeGroup.getObjectByName('pupil');
    const rightPupil = rightEyeGroup.getObjectByName('pupil');
    if (leftPupil) leftPupil.scale.set(smoothed.pupilScale, smoothed.pupilScale, 1.0);
    if (rightPupil) rightPupil.scale.set(smoothed.pupilScale, smoothed.pupilScale, 1.0);

    // 6. Audio-Driven Visemes + Emotion-Driven Mouth Curvature
    const combinedOpen = Math.max(smoothed.mouthOpenAmount, viseme.mouthOpen * 2.8);
    const combinedSmile = Math.max(smoothed.mouthSmileCurve, viseme.mouthSmile * 0.8);
    const combinedWidth = smoothed.mouthWidth * (1.0 + (viseme.mouthWide * 0.4));

    // Dynamic curvature deformation on mouth mesh vertices
    const mouthPosAttr = mouthGeo.attributes.position;
    const linePosAttr = mouthLineGeo.attributes.position;

    for (let i = 0; i < mouthPosAttr.count; i++) {
      const u = (mouthPosAttr.getX(i) / (0.18 * 0.5)); // -1 to +1 across width
      // Parabolic smile curve: center dips or raises relative to corners
      const curveY = (u * u - 1.0) * combinedSmile * 0.035;
      
      const baseY = mouthPosAttr.getY(i);
      const isUpper = baseY >= 0;
      
      // Open mouth vertically
      const vertOffset = isUpper ? (combinedOpen * 0.04) : -(combinedOpen * 0.05);
      
      mouthPosAttr.setY(i, curveY + vertOffset);
      mouthPosAttr.setX(i, (mouthPosAttr.getX(i) / 0.18) * 0.18 * combinedWidth);
    }
    mouthPosAttr.needsUpdate = true;

    // Update lip contour line
    for (let i = 0; i < linePosAttr.count; i++) {
      const u = (linePosAttr.getX(i) / (0.18 * 0.5));
      const curveY = (u * u - 1.0) * combinedSmile * 0.035 + (combinedOpen * 0.04);
      linePosAttr.setY(i, curveY);
    }
    linePosAttr.needsUpdate = true;
  };

  return {
    group,
    headGroup,
    leftEyeGroup,
    rightEyeGroup,
    leftUpperEyelid,
    rightUpperEyelid,
    leftLowerEyelid,
    rightLowerEyelid,
    leftBlush,
    rightBlush,
    mouthMesh,
    mouthLineMesh,
    leftEyebrow,
    rightEyebrow,
    hairGroup,
    torsoGroup,
    updateExpression,
  };
}

