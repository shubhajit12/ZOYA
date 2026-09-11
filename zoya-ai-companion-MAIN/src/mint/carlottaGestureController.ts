import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { CARLOTTA_IDLE_MAX_DELTA } from './carlottaIdleController';
import { carlottaAnimationController } from './carlottaAnimationController';
import { isDevBuild } from './runtimeEnv';

/**
 * CarlottaGestureController — procedural gesture layer.
 *
 * Carlotta's VRM scene is authored facing -Z. The loader rotates the entire
 * VRM scene +180° around Y, making her visual front +Z for ZOYA's camera.
 * Gesture targets therefore use the FINAL WORLD frame directly. They must
 * not apply the scene/root rotation a second time.
 */

export type CarlottaGestureName = 'wave' | 'greeting' | 'goodbye' | 'point' | 'shrug' | 'clap' | 'bow';
export function isValidCarlottaGestureName(value: unknown): value is CarlottaGestureName { return value === 'wave' || value === 'greeting' || value === 'goodbye' || value === 'point' || value === 'shrug' || value === 'clap' || value === 'bow'; }
export type GesturePhase = 'idle' | 'active' | 'recovering';
type ArmBoneName = 'leftUpperArm' | 'leftLowerArm' | 'leftHand' | 'rightUpperArm' | 'rightLowerArm' | 'rightHand';
type TorsoBoneName = 'spine' | 'neck' | 'head';
type GestureBoneName = ArmBoneName | TorsoBoneName;
const ARM_BONES: readonly ArmBoneName[] = ['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand'];
const TORSO_BONES: readonly TorsoBoneName[] = ['spine', 'neck', 'head'];
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _restWorld = new THREE.Quaternion();
const _parentWorld = new THREE.Quaternion();
const _parentInv = new THREE.Quaternion();
const _targetWorld = new THREE.Quaternion();
const _targetLocal = new THREE.Quaternion();
const _deltaWorld = new THREE.Quaternion();
const _direction = new THREE.Vector3();
const _childPosition = new THREE.Vector3();
const _bonePosition = new THREE.Vector3();
const _characterForward = new THREE.Vector3();
const _characterRight = new THREE.Vector3();

interface Pose { leftUpperArm?: [number,number,number]; leftLowerArm?: [number,number,number]; leftHand?: [number,number,number]; rightUpperArm?: [number,number,number]; rightLowerArm?: [number,number,number]; rightHand?: [number,number,number]; spine?: [number,number,number]; neck?: [number,number,number]; head?: [number,number,number]; }
interface Keyframe { time: number; pose: Pose; }
interface GestureDef { duration: number; writesTorso: boolean; keyframes: readonly Keyframe[]; required: readonly GestureBoneName[]; }
function pose(rightUpperArm?: [number,number,number], rightLowerArm?: [number,number,number], rightHand?: [number,number,number], leftUpperArm?: [number,number,number], leftLowerArm?: [number,number,number], leftHand?: [number,number,number], spine?: [number,number,number], neck?: [number,number,number], head?: [number,number,number]): Pose { return { rightUpperArm,rightLowerArm,rightHand,leftUpperArm,leftLowerArm,leftHand,spine,neck,head }; }
function key(time:number,p:Pose):Keyframe{return{time,pose:p};}
const WAVE:readonly Keyframe[]=[key(0,pose()),key(.38,pose([0,0,1.05],[0,-.18,0])),key(.72,pose([0,0,1.52],[0,-.55,0])),key(1.05,pose([0,0,1.52],[0,-.22,0],[0,0,.10])),key(1.38,pose([0,0,1.52],[0,-.68,0],[0,0,-.16])),key(1.70,pose([0,0,1.52],[0,-.20,0],[0,0,.16])),key(2.02,pose([0,0,1.52],[0,-.68,0],[0,0,-.16])),key(2.34,pose([0,0,1.52],[0,-.20,0],[0,0,.16])),key(2.68,pose([0,0,1.40],[0,-.38,0],[0,0,.08])),key(3.02,pose([0,0,.85],[0,-.16,0])),key(3.40,pose())];
const GREETING:readonly Keyframe[]=[key(0,pose()),key(.35,pose([0,0,1],[0,-.18,0])),key(.65,pose([0,0,1.46],[0,-.48,0])),key(.95,pose([0,0,1.46],[0,-.16,0],[0,0,.10])),key(1.25,pose([0,0,1.46],[0,-.54,0],[0,0,-.10])),key(1.55,pose([0,0,1.46],[0,-.16,0],[0,0,.10])),key(1.80,pose([0,0,1.20],[0,-.30,0])),key(2.15,pose())];
const GOODBYE:readonly Keyframe[]=[key(0,pose()),key(.45,pose([0,0,1.10],[0,-.20,0])),key(.78,pose([0,0,1.55],[0,-.52,0])),key(1.05,pose([0,0,1.55],[0,-.18,0],[0,0,.12])),key(1.35,pose([0,0,1.55],[0,-.70,0],[0,0,-.18])),key(1.68,pose([0,0,1.55],[0,-.18,0],[0,0,.18])),key(2.01,pose([0,0,1.55],[0,-.70,0],[0,0,-.18])),key(2.34,pose([0,0,1.55],[0,-.18,0],[0,0,.18])),key(2.67,pose([0,0,1.55],[0,-.70,0],[0,0,-.18])),key(3,pose([0,0,1.55],[0,-.24,0],[0,0,.10])),key(3.35,pose([0,0,1.08],[0,-.16,0])),key(3.8,pose())];
const POINT:readonly Keyframe[]=[key(0,pose()),key(.32,pose()),key(.68,pose()),key(1,pose()),key(1.45,pose()),key(1.78,pose()),key(2.15,pose())];
const SHRUG:readonly Keyframe[]=[key(0,pose()),key(.25,pose([0,0,.28],undefined,undefined,[0,0,-.28])),key(.55,pose([0,0,.72],[0,-.12,0],undefined,[0,0,-.72],[0,.12,0])),key(.90,pose([0,0,.72],[0,-.18,0],undefined,[0,0,-.72],[0,.18,0])),key(1.20,pose([0,0,.48],[0,-.08,0],undefined,[0,0,-.48],[0,.08,0])),key(1.60,pose())];
const CLAP:readonly Keyframe[]=[key(0,pose()),key(.30,pose([0,-.22,.42],[0,-.25,0],undefined,[0,.22,-.42],[0,.25,0])),key(.70,pose([0,-.48,.92],[0,-.72,0],[0,0,.12],[0,.48,-.92],[0,.72,0],[0,0,-.12])),key(1.05,pose([0,-.42,.84],[0,-.90,0],[0,0,.08],[0,.42,-.84],[0,.90,0],[0,0,-.08])),key(1.32,pose([0,-.50,.96],[0,-.98,0],[0,0,.13],[0,.50,-.96],[0,.98,0],[0,0,-.13])),key(1.62,pose([0,-.42,.84],[0,-.90,0],[0,0,.08],[0,.42,-.84],[0,.90,0],[0,0,-.08])),key(1.90,pose([0,-.50,.96],[0,-.98,0],[0,0,.13],[0,.50,-.96],[0,.98,0],[0,0,-.13])),key(2.20,pose([0,-.30,.58],[0,-.42,0],undefined,[0,.30,-.58],[0,.42,0])),key(2.70,pose())];
const BOW:readonly Keyframe[]=[key(0,pose()),key(.35,pose()),key(.72,pose()),key(1.12,pose()),key(1.50,pose()),key(1.85,pose()),key(2.30,pose())];
const REQUIRE_ARM_RIGHT:readonly GestureBoneName[]=['rightUpperArm','rightLowerArm','rightHand'];
const REQUIRE_SHRUG:readonly GestureBoneName[]=['leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm'];
const REQUIRE_CLAP:readonly GestureBoneName[]=['leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand'];
const REQUIRE_BOW:readonly GestureBoneName[]=['spine','neck','head','leftUpperArm','rightUpperArm'];
const GESTURES:Record<CarlottaGestureName,GestureDef>={wave:{duration:3.4,writesTorso:false,keyframes:WAVE,required:REQUIRE_ARM_RIGHT},greeting:{duration:2.15,writesTorso:false,keyframes:GREETING,required:REQUIRE_ARM_RIGHT},goodbye:{duration:3.8,writesTorso:false,keyframes:GOODBYE,required:REQUIRE_ARM_RIGHT},point:{duration:2.15,writesTorso:false,keyframes:POINT,required:REQUIRE_ARM_RIGHT},shrug:{duration:1.6,writesTorso:false,keyframes:SHRUG,required:REQUIRE_SHRUG},clap:{duration:2.7,writesTorso:false,keyframes:CLAP,required:REQUIRE_CLAP},bow:{duration:2.3,writesTorso:true,keyframes:BOW,required:REQUIRE_BOW}};
const START_BLEND=.16,RECOVER_BLEND=.32;
interface ControlledBone{name:GestureBoneName;node:THREE.Object3D;base:THREE.Quaternion;current:THREE.Vector3;from:THREE.Vector3;sampled:THREE.Vector3;}
function smoothstep(x:number):number{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);}
export class CarlottaGestureController{
 private bones=new Map<GestureBoneName,ControlledBone>(); private initialized=false; private active:CarlottaGestureName|null=null; private phase:GesturePhase='idle'; private time=0; private blendT=1; private recoverT=1; private completed:CarlottaGestureName|null=null; private diagAcc=0; private pointOffsets=new Map<GestureBoneName,THREE.Euler>(); private bowOffsets=new Map<GestureBoneName,THREE.Euler>();
 public init(vrm:VRM):void{this.reset();const wanted:readonly GestureBoneName[]=[...ARM_BONES,...TORSO_BONES];for(const name of wanted){const node=vrm.humanoid.getRawBoneNode(name);if(!node){console.warn(`[CarloGesture] bone "${name}" missing — gestures needing it will refuse`);continue;}this.bones.set(name,{name,node,base:node.quaternion.clone(),current:new THREE.Vector3(),from:new THREE.Vector3(),sampled:new THREE.Vector3()});}this.initialized=this.bones.size>0;this.calibrateWorldDirections(vrm.scene);console.log(`[CarloGesture] final-world-frame calibrated controller initialized (${this.bones.size}/${wanted.length} bones)`);this.registerDevHooks();}
 public getIsInitialized():boolean{return this.initialized;} public getActive():CarlottaGestureName|null{return this.active;} public getPhase():GesturePhase{return this.phase;} public getCompleted():CarlottaGestureName|null{return this.completed;}
 private calibrateWorldDirections(_root:THREE.Object3D):void{
  this.pointOffsets.clear();this.bowOffsets.clear();
  // IMPORTANT: carlottaVrmLoader.ts already applies scene.rotation.y = PI.
  // Therefore the FINAL visual frame is simply world +Z forward / -X right.
  // Applying _rootWorld here would rotate these directions a second time and
  // produce exactly the backwards gestures seen in the previous builds.
  _characterForward.set(0,0,1);
  _characterRight.set(-1,0,0);
  const pointNames:readonly GestureBoneName[]=['rightUpperArm','rightLowerArm'];
  for(const name of pointNames){const bone=this.bones.get(name);if(!bone)continue;const childName=name==='rightUpperArm'?'rightLowerArm':'rightHand';const child=this.bones.get(childName)?.node;if(!child)continue;bone.node.getWorldPosition(_bonePosition);child.getWorldPosition(_childPosition);_direction.subVectors(_childPosition,_bonePosition).normalize();if(_direction.lengthSq()<1e-6)continue;bone.node.getWorldQuaternion(_restWorld);_deltaWorld.setFromUnitVectors(_direction,_characterForward);_targetWorld.copy(_deltaWorld).multiply(_restWorld);this.worldTargetToLocalOffset(bone.node,bone.base,_targetWorld,this.pointOffsets,name);}
  const hand=this.bones.get('rightHand');if(hand){hand.node.getWorldQuaternion(_restWorld);_direction.set(0,0,1).applyQuaternion(_restWorld).normalize();_deltaWorld.setFromUnitVectors(_direction,_characterForward);_targetWorld.copy(_deltaWorld).multiply(_restWorld);this.worldTargetToLocalOffset(hand.node,hand.base,_targetWorld,this.pointOffsets,'rightHand');}
  // With final visual forward = +Z and character-right = -X, +X is the
  // forward/down bow axis. Keep the bow calibration in final world space too.
  const bowAxis=_characterRight.clone().negate();
  for(const name of ['spine','neck','head'] as const){const bone=this.bones.get(name);if(!bone)continue;bone.node.getWorldQuaternion(_restWorld);_quat.setFromAxisAngle(bowAxis,.44);_targetWorld.copy(_quat).multiply(_restWorld);this.worldTargetToLocalOffset(bone.node,bone.base,_targetWorld,this.bowOffsets,name);}
  for(const name of ['leftUpperArm','rightUpperArm'] as const){const bone=this.bones.get(name);if(!bone)continue;bone.node.getWorldQuaternion(_restWorld);_quat.setFromAxisAngle(bowAxis,.10);_targetWorld.copy(_quat).multiply(_restWorld);this.worldTargetToLocalOffset(bone.node,bone.base,_targetWorld,this.bowOffsets,name);}
  if(isDevBuild())console.info('[CarloGestureCalibration] FINAL world frame: forward=+Z, right=-X; no root double-rotation');
 }
 private worldTargetToLocalOffset(node:THREE.Object3D,base:THREE.Quaternion,targetWorld:THREE.Quaternion,out:Map<GestureBoneName,THREE.Euler>,name:GestureBoneName):void{if(node.parent){node.parent.getWorldQuaternion(_parentWorld);_parentInv.copy(_parentWorld).invert();}else _parentInv.identity();_targetLocal.copy(_parentInv).multiply(targetWorld);_quat.copy(base).invert().multiply(_targetLocal);_euler.setFromQuaternion(_quat,'XYZ');let stored=out.get(name);if(!stored){stored=new THREE.Euler();out.set(name,stored);}stored.copy(_euler);}
 public start(name:CarlottaGestureName):boolean{if(!isValidCarlottaGestureName(name)||!this.initialized)return false;const def=GESTURES[name];for(const required of def.required)if(!this.bones.has(required))return false;for(const bone of this.bones.values())bone.from.copy(bone.current);this.active=name;this.phase='active';this.time=0;this.blendT=0;this.recoverT=1;this.completed=null;carlottaAnimationController.setBodyHold(def.writesTorso);if(isDevBuild())console.info(`[CarloGesture] start=${name} phase=active`);return true;}
 public cancel():void{if(!this.active||this.phase!=='active')return;for(const bone of this.bones.values())bone.from.copy(bone.current);this.phase='recovering';this.recoverT=0;}
 public reset():void{for(const bone of this.bones.values())bone.node.quaternion.copy(bone.base);this.bones.clear();this.pointOffsets.clear();this.bowOffsets.clear();this.initialized=false;this.active=null;this.phase='idle';this.time=0;this.blendT=1;this.recoverT=1;this.completed=null;this.diagAcc=0;}
 public update(delta:number):void{if(!this.initialized)return;const dt=Math.min(Math.max(delta,0),CARLOTTA_IDLE_MAX_DELTA);if(this.phase==='active'&&this.active){this.time+=dt;this.blendT=Math.min(1,this.blendT+dt/START_BLEND);this.applyGesture(this.active,this.time,smoothstep(this.blendT));if(this.time>=GESTURES[this.active].duration){for(const bone of this.bones.values())bone.from.copy(bone.current);this.phase='recovering';this.recoverT=0;carlottaAnimationController.setBodyHold(false);}}
 else if(this.phase==='recovering'){this.recoverT=Math.min(1,this.recoverT+dt/RECOVER_BLEND);const t=smoothstep(this.recoverT);for(const bone of this.bones.values()){bone.current.lerpVectors(bone.from,new THREE.Vector3(),t);bone.node.quaternion.copy(bone.base);this.applyCurrentOffset(bone);}if(this.recoverT>=1){for(const bone of this.bones.values()){bone.current.set(0,0,0);bone.from.set(0,0,0);bone.sampled.set(0,0,0);bone.node.quaternion.copy(bone.base);}this.completed=this.active;this.active=null;this.phase='idle';carlottaAnimationController.setBodyHold(false);if(isDevBuild())console.info(`[CarloGesture] complete=${this.completed} phase=idle`);}}
 else {for(const bone of this.bones.values())bone.node.quaternion.copy(bone.base);}
 this.diagAcc+=dt;if(this.diagAcc>=1){this.diagAcc=0;}}
 private applyGesture(name:CarlottaGestureName,time:number,weight:number):void{if(name==='point'){this.applyOffsetMap(this.pointOffsets,time,weight,GESTURES[name].duration,0.35,1.0);return;}if(name==='bow'){this.applyOffsetMap(this.bowOffsets,time,weight,GESTURES[name].duration,0.32,1.0);return;}const def=GESTURES[name];const pose=this.samplePose(def.keyframes,time,def.duration);for(const bone of this.bones.values()){const target=pose[bone.name];if(!target){bone.current.set(0,0,0);continue;}bone.current.set(target[0],target[1],target[2]).multiplyScalar(weight);}this.applyCurrentOffsetsToNodes();}
 private applyOffsetMap(offsets:Map<GestureBoneName,THREE.Euler>,time:number,weight:number,duration:number,rise:number,fall:number):void{const holdStart=Math.min(rise,duration*.25),holdEnd=Math.max(holdStart,duration-fall);let envelope=1;if(time<holdStart)envelope=smoothstep(time/Math.max(.001,holdStart));else if(time>holdEnd)envelope=smoothstep((duration-time)/Math.max(.001,duration-holdEnd));const w=weight*envelope;for(const bone of this.bones.values()){const offset=offsets.get(bone.name);if(!offset){bone.current.set(0,0,0);continue;}bone.current.set(offset.x,offset.y,offset.z).multiplyScalar(w);}this.applyCurrentOffsetsToNodes();}
 private applyCurrentOffsetsToNodes():void{for(const bone of this.bones.values()){bone.node.quaternion.copy(bone.base);this.applyCurrentOffset(bone);}}
 private applyCurrentOffset(bone:ControlledBone):void{if(bone.current.lengthSq()===0)return;_euler.set(bone.current.x,bone.current.y,bone.current.z,'XYZ');_quat.setFromEuler(_euler);bone.node.quaternion.multiply(_quat);}
 private samplePose(keyframes:readonly Keyframe[],time:number,duration:number):Pose{if(time<=0)return keyframes[0].pose;if(time>=duration)return keyframes[keyframes.length-1].pose;let a=keyframes[0],b=keyframes[keyframes.length-1];for(let i=1;i<keyframes.length;i++){if(time<=keyframes[i].time){a=keyframes[i-1];b=keyframes[i];break;}}const span=Math.max(.0001,b.time-a.time);const t=smoothstep((time-a.time)/span);const out:Pose={};for(const name of [...ARM_BONES,...TORSO_BONES] as const){const av=a.pose[name],bv=b.pose[name];if(av&&bv)out[name]=[av[0]+(bv[0]-av[0])*t,av[1]+(bv[1]-av[1])*t,av[2]+(bv[2]-av[2])*t];else if(bv)out[name]=[bv[0],bv[1],bv[2]];else if(av)out[name]=[av[0],av[1],av[2]];}return out;}
 private registerDevHooks():void{if(!isDevBuild())return;const g=globalThis as unknown as Record<string,unknown>;g.__zoyaGesture={start:(name:unknown)=>this.start(name as CarlottaGestureName),cancel:()=>this.cancel(),state:()=>({active:this.active,phase:this.phase,completed:this.completed,initialized:this.initialized})};}
}
export const carlottaGestureController=new CarlottaGestureController();
