#!/usr/bin/env node
/**
 * Offline Sword PvP expert trainer.
 *
 * Inputs:
 *  1. Structured Sword demonstrations (the executable prior).
 *  2. sword-skills.json produced by the video trainer (visual evidence).
 *
 * The result is a bounded executable Sword policy. Video evidence never
 * invents missing timings and never overrides physical Sword reach.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import {createSwordPvpBrain} from "./swordPvpBrain.mjs";

const ROOT=path.resolve(process.env.ZOYA_PVP_TRAINING_DIR||"./minecraft-training");
const INPUT=path.join(ROOT,"sword","swordTrainingDemonstrations.json");
const MODEL=path.join(ROOT,"sword","swordPvpModel.json");
const REPORT=path.join(ROOT,"sword","swordTrainingReport.json");
const VIDEO_SKILLS=path.join(ROOT,"sword","sword-skills.json");

const required=["sprint_reset","spacing","combo_control","crit_timing","defense","healing"];
const visual=["movement","spacing","attack_timing","target_tracking","repositioning","recovery"];
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;

async function load(){
  const d=JSON.parse(await fs.readFile(INPUT,"utf8"));
  if(!Array.isArray(d.techniques)||!d.techniques.length)throw new Error("No Sword expert demonstrations found.");
  return d;
}

function confidenceValue(value){
  if(Number.isFinite(Number(value)))return Math.max(0,Math.min(1,Number(value)));
  return ({high:0.9,medium:0.65,low:0.4,very_high:0.95})[String(value||"medium").toLowerCase()]||0.5;
}

function loadVideoSkills(){
  try{
    const x=JSON.parse(fsSync.readFileSync(VIDEO_SKILLS,"utf8"));
    return Array.isArray(x.skills)?x.skills:[];
  }catch{return [];}
}

function normalizeVideoSkill(skill,index){
  const category=String(skill?.skill||"").toLowerCase().trim();
  if(!visual.includes(category))return null;
  const impl=skill?.implementation&&typeof skill.implementation==="object"?skill.implementation:{};
  return {
    id:"video_"+category+"_"+index,
    category,
    name:String(skill?.name||skill?.id||category),
    confidence:confidenceValue(skill?.confidence),
    evidence:Array.isArray(skill?.evidence)?skill.evidence.slice(0,12):[],
    sourceFrames:Array.isArray(skill?.sourceFrames)?skill.sourceFrames.slice(0,20):[],
    timingNotes:Array.isArray(skill?.timing_notes)?skill.timing_notes.slice(0,8):[],
    implementation:impl
  };
}

function safeRange(value,fallback){
  if(Array.isArray(value)&&value.length>=2){
    const a=Number(value[0]),b=Number(value[1]);
    if(Number.isFinite(a)&&Number.isFinite(b)&&b>=a)return[a,b];
  }
  return fallback;
}

function compile(d,videoSkills=[]){
  const videoTechniques=videoSkills.map(normalizeVideoSkill).filter(Boolean);
  const seed=d.techniques||[];
  const ts=[...seed,...videoTechniques];
  const missing=required.filter(c=>!ts.some(t=>String(t.category||"").toLowerCase()===c));
  if(missing.length)throw new Error("Missing required expert categories: "+missing.join(", "));

  const seedBy=category=>seed.find(t=>String(t.category||"").toLowerCase()===category)||{};
  const seedImpl=category=>seedBy(category).implementation||{};
  const videoBy=category=>videoTechniques.find(t=>t.category===category)||null;
  const impl=category=>videoBy(category)?.implementation||seedImpl(category);

  const spacing=impl("spacing");
  const combo=impl("combo_control");
  const crit=impl("crit_timing");
  const reset=impl("sprint_reset");
  const healing=impl("healing");

  // The supplied video has useful visual evidence for the Sword reach ceiling
  // and target tracking, but not a trustworthy minimum attack distance or
  // exact timing values. Keep exact timing from structured demonstrations.
  const attackMax=Math.min(3.05,Math.max(2.70,
    Number(spacing.attackDistanceCeiling)||Number(spacing.maxDistance)||Number(seedImpl("spacing").attackDistanceCeiling)||3.05));

  const resetRange=safeRange(reset.holdMsRange,safeRange(seedImpl("sprint_reset").holdMsRange,[60,140]));
  const comboRange=safeRange(combo.durationMsRange,safeRange(seedImpl("combo_control").durationMsRange,[120,260]));
  const healMin=Number(healing.minDistance);
  const seedHealMin=Number(seedImpl("healing").minimumDistance);
  const minimumDistance=Number.isFinite(healMin)?healMin:Number.isFinite(seedHealMin)?seedHealMin:4;

  const videoConfidence=Object.fromEntries(visual.map(k=>[k,videoBy(k)?.confidence||0]));
  const weights=Object.fromEntries(required.map(k=>[k,1]));
  for(const k of visual){
    if(videoConfidence[k]>0)weights[k]=1+((videoConfidence[k]-.5)*.30);
  }
  // Video tracking/repositioning are strong priors, but live optimizer still
  // owns later adaptation. Keep every weight bounded.
  for(const k of Object.keys(weights))weights[k]=Math.max(.5,Math.min(1.5,weights[k]));

  const videoEvidence=videoTechniques.map(v=>({
    id:v.id,category:v.category,confidence:v.confidence,
    evidence:v.evidence,sourceFrames:v.sourceFrames,timingNotes:v.timingNotes
  }));

  return {
    version:2,
    brain:"sword",
    brainVersion:"sword-brain-v3",
    kit:"sword",
    source:d.source,
    trainedAt:new Date().toISOString(),
    trainingMode:"expert-demonstration-plus-video-policy",
    policy:{
      spacing:{
        attackMax,
        neutralMax:Number(seedImpl("spacing").neutralDistanceRange?.[1]||3.8),
        pressureMax:Number(seedImpl("spacing").preferredDistanceRange?.[1]||3.2)
      },
      combat:{
        attackCooldown:.95,
        attackIntervalMs:700,
        comboMaxDistance:Number(seedImpl("combo_control").maxDistance||2.9),
        strafeDurationMs:Math.round(comboRange[0]),
        defensiveStrafeMs:150,
        critMaxDistance:Math.min(3,Math.max(2.3,Number(crit.maxDistance)||Number(seedImpl("crit_timing").maxDistance)||2.8)),
        critCooldown:.95
      },
      sprintReset:{
        durationMs:Math.round((resetRange[0]+resetRange[1])/2),
        minMs:Math.max(60,Math.min(160,resetRange[0])),
        maxMs:Math.max(60,Math.min(160,resetRange[1]))
      },
      healing:{
        lowHealth:8,
        emergencyHealth:5,
        minimumDistance:Math.max(3.5,Math.min(7,minimumDistance))
      }
    },
    demonstrations:seed.map(t=>({
      id:t.id,category:t.category,confidence:confidenceValue(t.confidence),
      observed:t.observed,inferred:t.inferred,implementation:t.implementation||{}
    })),
    videoEvidence,
    skillLibrary:videoSkills,
    skillWeights:weights,
    coverage:{
      requiredCategories:required,
      visualCategories:visual,
      categoriesPresent:required.filter(c=>seed.some(t=>String(t.category||"").toLowerCase()===c)),
      videoCategoriesPresent:videoTechniques.map(t=>t.category),
      videoConfidence,
      confidence:mean(seed.map(t=>confidenceValue(t.confidence)))
    },
    learningPolicy:{
      authority:"live_combat_telemetry",
      videoRole:"bounded_prior",
      reachCeiling:3.05,
      neverInferMissingTiming:true
    }
  };
}

function tests(model){
  const b=createSwordPvpBrain(model);
  const cases=[
    ["no target",{targetValid:false},"idle"],
    ["outside reach",{targetValid:true,distance:4,attackCooldown:1},"approach"],
    ["reach ceiling",{targetValid:true,distance:3.05,attackCooldown:1},"attack"],
    ["never attack beyond reach",{targetValid:true,distance:3.06,attackCooldown:1},"approach"],
    ["post hit reset",{targetValid:true,distance:2.9,attackCooldown:.4,recentHit:true},"sprint_reset"],
    ["airborne pressure",{targetValid:true,distance:2.7,attackCooldown:.5,targetAirborne:true},"strafe_pressure"],
    ["gated falling crit",{targetValid:true,distance:2.5,attackCooldown:1,falling:true,onGround:false,fallDistance:.7,targetAirborne:true},"falling_crit"],
    ["jump crit",{targetValid:true,distance:2.5,attackCooldown:1,onGround:true,falling:false},"jump_crit"],
    ["damage recovery",{targetValid:true,distance:3.2,attackCooldown:.4,recentlyDamaged:true},"defensive_strafe"],
    ["heal",{targetValid:true,distance:4.5,health:6,hasGapple:true},"heal"],
    ["tracking loss",{targetValid:true,distance:2.8,attackCooldown:1,lineOfSight:false},"strafe"]
  ];
  const results=cases.map(([name,state,expect])=>{
    const got=b.decide(state);
    return{name,expect,got:got.action,pass:got.action===expect};
  });
  return{results,passed:results.filter(x=>x.pass).length,total:results.length};
}

async function main(){
  console.log("=== ZOYA Sword PvP Expert Brain Trainer ===");
  console.log("[SWORD-TRAIN] Minecraft server is NOT required.");
  const data=await load();
  const videoSkills=loadVideoSkills();
  const model=compile(data,videoSkills);
  const t=tests(model);
  if(t.passed!==t.total)throw new Error("Offline Sword expert policy tests failed: "+t.passed+"/"+t.total);

  await fs.mkdir(path.dirname(MODEL),{recursive:true});
  await fs.writeFile(MODEL,JSON.stringify(model,null,2));
  const report={
    status:"TRAINING_COMPLETED",
    completedAt:new Date().toISOString(),
    source:data.source,
    trainingMode:model.trainingMode,
    seedDemonstrations:data.techniques.length,
    videoSkills:videoSkills.length,
    videoEvidence:model.videoEvidence.length,
    requiredCategories:model.coverage.categoriesPresent,
    videoCategories:model.coverage.videoCategoriesPresent,
    confidence:model.coverage.confidence,
    offlineTests:t,
    minecraftRequired:false,
    note:"Executable Sword policy compiled from structured demonstrations plus bounded video evidence. Live combat telemetry remains the authority for adaptive improvement and mastery."
  };
  await fs.writeFile(REPORT,JSON.stringify(report,null,2));

  console.log("\n[SWORD-TRAIN] TRAINING COMPLETED");
  console.log("[SWORD-TRAIN] Seed demonstrations: "+data.techniques.length);
  console.log("[SWORD-TRAIN] Video skills consumed: "+videoSkills.length);
  console.log("[SWORD-TRAIN] Video evidence consumed: "+model.videoEvidence.length);
  console.log("[SWORD-TRAIN] Offline tests: "+t.passed+"/"+t.total);
  console.log("[SWORD-TRAIN] Model: "+MODEL);
  console.log("[SWORD-TRAIN] Report: "+REPORT);
}
main().catch(e=>{console.error("[SWORD-TRAIN] ERROR: "+(e?.message||String(e)));process.exitCode=1;});
