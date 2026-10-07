#!/usr/bin/env node
/**
 * Offline Sword PvP trainer.
 * Compiles video-derived expert demonstrations into a Sword Brain policy.
 * It never connects to Minecraft.
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
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
async function load(){const d=JSON.parse(await fs.readFile(INPUT,"utf8"));if(!Array.isArray(d.techniques)||!d.techniques.length)throw new Error("No Sword expert demonstrations found.");return d;}
function loadVideoSkills(){try{const x=JSON.parse(fsSync.readFileSync(VIDEO_SKILLS,"utf8"));return Array.isArray(x.skills)?x.skills:[];}catch{return [];}}
function normalizeVideoTechnique(skill,index){
  const category=String(skill?.skill||"").toLowerCase().trim();
  if(!category||!required.includes(category)) return null;
  const impl=skill?.implementation&&typeof skill.implementation==="object"?skill.implementation:{};
  return {
    id:"video_"+category+"_"+index,
    name:String(skill?.name||skill?.id||category),
    category,
    confidence:String(skill?.confidence||"medium").toLowerCase(),
    observed:String(skill?.evidence||skill?.description||"Video-derived visual evidence."),
    inferred:"Implementation parameters are derived only from the video trainer output and remain bounded.",
    implementation:impl
  };
}
function compile(d,videoSkills=[]){
  const videoTechniques=videoSkills.map(normalizeVideoTechnique).filter(Boolean);
  // Seed demonstrations remain useful as prior knowledge, while video-derived
  // techniques are appended and take precedence when extracting parameters.
  // This makes the two supplied videos an actual input to the compiled brain,
  // rather than merely an unrelated report.
  const ts=[...(Array.isArray(d.techniques)?d.techniques:[]),...videoTechniques];
  const missing=required.filter(c=>!ts.some(t=>t.category===c));
  if(missing.length)throw new Error("Missing required expert categories: "+missing.join(", "));
  const by=c=>ts.find(t=>t.category===c)?.implementation||{};
  const sp=by("spacing"),rs=by("sprint_reset"),co=by("combo_control"),cr=by("crit_timing"),he=by("healing");
  const videoBy=skill=>videoSkills.find(x=>String(x.skill||"").toLowerCase()===skill)||{};
  const vh=(skill,key,fallback)=>{const v=Number(videoBy(skill)?.implementation?.[key]);return Number.isFinite(v)?v:fallback;};
  const score={high:1,medium:.7,low:.4};
  return {version:1,brain:"sword",brainVersion:"sword-brain-v2",source:d.source,trainedAt:new Date().toISOString(),trainingMode:"expert-demonstration-imitation",
    policy:{spacing:{attackMax:Math.min(3.05,Math.max(2.7,vh("spacing","attackDistanceCeiling",Number(sp.attackDistanceCeiling||3.2)))),neutralMax:Number((sp.neutralDistanceRange||[3,3.8])[1]),pressureMax:Number((sp.preferredDistanceRange||[2.7,3.2])[1])},
      combat:{attackCooldown:.95,attackIntervalMs:650,comboMaxDistance:2.9,strafeDurationMs:Number((co.durationMsRange||[120,260])[0]),critMaxDistance:Math.min(3,Math.max(2.2,vh("crit_timing","maxDistance",Number(cr.maxDistance||2.8)))),critCooldown:.95},
      sprintReset:{durationMs:Math.round(mean(rs.holdMsRange||[60,140])),minMs:Math.max(40,Math.min(180,vh("sprint_reset","holdMsRange",Number((rs.holdMsRange||[60,140])[0])))),maxMs:Number((rs.holdMsRange||[60,140])[1])},
      healing:{lowHealth:8,emergencyHealth:5,minimumDistance:Math.max(3.5,Math.min(7,vh("healing","minDistance",Number(he.minimumDistance||4))) )}},
    demonstrations:ts.map(t=>({id:t.id,category:t.category,confidence:t.confidence,observed:t.observed,inferred:t.inferred})),
    skillLibrary:videoSkills,skillWeights:Object.fromEntries(required.map(c=>[c,1])),trainingMode:"expert-demonstration-imitation",coverage:{requiredCategories:required,categoriesPresent:required.filter(c=>ts.some(t=>t.category===c)),confidence:mean(ts.map(t=>score[t.confidence]||.5))}};
}
function tests(model){
  const b=createSwordPvpBrain(model),cases=[
    ["no target",{targetValid:false},"idle"],
    ["outside range",{targetValid:true,distance:4,attackCooldown:1},"approach"],
    ["valid attack",{targetValid:true,distance:3.0,attackCooldown:1},"attack"],
    ["post hit reset",{targetValid:true,distance:2.9,attackCooldown:.4,recentHit:true},"sprint_reset"],
    ["combo pressure",{targetValid:true,distance:2.7,attackCooldown:.5,targetAirborne:true},"strafe_pressure"],
    ["gated crit",{targetValid:true,distance:2.5,attackCooldown:1,falling:true,onGround:false,targetConstrained:true},"falling_crit"],
    ["jump crit",{targetValid:true,distance:2.5,attackCooldown:1,onGround:true,falling:false},"jump_crit"],
    ["damage recovery",{targetValid:true,distance:3.2,attackCooldown:.4,recentlyDamaged:true},"defensive_strafe"],
    ["heal",{targetValid:true,distance:4.5,health:6,hasGapple:true},"heal"]
  ];
  const results=cases.map(([name,state,expect])=>{const got=b.decide(state);return{name,expect,got:got.action,pass:got.action===expect};});
  return{results,passed:results.filter(x=>x.pass).length,total:results.length};
}
async function main(){
  console.log("=== ZOYA Sword PvP Brain Trainer ===");
  console.log("[SWORD-TRAIN] Minecraft server is NOT required.");
  const data=await load(),videoSkills=loadVideoSkills(),model=compile(data,videoSkills),t=tests(model);
  if(t.passed!==t.total)throw new Error("Offline Sword brain tests failed: "+t.passed+"/"+t.total);
  await fs.mkdir(path.dirname(MODEL),{recursive:true});
  await fs.writeFile(MODEL,JSON.stringify(model,null,2));
  const report={status:"TRAINING_COMPLETED",completedAt:new Date().toISOString(),source:data.source,trainingMode:"expert-demonstration-imitation",demonstrations:model.demonstrations.length,seedDemonstrations:data.techniques.length,videoSkills:videoSkills.length,videoDerivedDemonstrations:model.demonstrations.filter(t=>String(t.id).startsWith("video_")).length,categories:model.coverage.categoriesPresent,confidence:model.coverage.confidence,offlineTests:t,minecraftRequired:false,note:"Video-derived observations and seed demonstrations were compiled into the Sword Brain and passed deterministic offline tests. Live Minecraft combat evaluation then adapts bounded policy parameters from measured outcomes."};
  await fs.writeFile(REPORT,JSON.stringify(report,null,2));
  console.log("\n[SWORD-TRAIN] TRAINING COMPLETED");
  console.log("[SWORD-TRAIN] Expert demonstrations: "+data.techniques.length);
  console.log("[SWORD-TRAIN] Video skill library: "+videoSkills.length);
  console.log("[SWORD-TRAIN] Categories: "+model.coverage.categoriesPresent.join(", "));
  console.log("[SWORD-TRAIN] Offline tests: "+t.passed+"/"+t.total);
  console.log("[SWORD-TRAIN] Model: "+MODEL);
  console.log("[SWORD-TRAIN] Report: "+REPORT);
  console.log("[SWORD-TRAIN] Minecraft server was NOT used.");
}
main().catch(e=>{console.error("[SWORD-TRAIN] ERROR: "+(e?.message||String(e)));process.exitCode=1;});
