#!/usr/bin/env node
/**
 * ZOYA Sword PvP Video Trainer
 * MP4 -> sampled frames -> Groq vision observations -> structured Sword skills.
 * It never connects to Minecraft and never controls the bot.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

const ROOT = path.resolve(process.env.ZOYA_PVP_TRAINING_DIR || "./minecraft-training");
const VIDEO_DIR = path.resolve(process.argv[2] || path.join(ROOT, "videos"));
const OUT_DIR = path.join(ROOT, "sword");
const FRAMES_DIR = path.join(OUT_DIR, "frames");
const OBS_FILE = path.join(OUT_DIR, "observations.json");
const SKILLS_FILE = path.join(OUT_DIR, "sword-skills.json");
const MODEL = process.env.ZOYA_VISION_MODEL || "qwen/qwen3.8-27b";
const API_KEY = process.env.GROQ_API_KEY;
const FPS = Math.max(0.1, Number(process.env.ZOYA_TRAIN_FPS || 0.5));
const MAX_IMAGES_PER_CALL = 3;
const MAX_BYTES = 19 * 1024 * 1024;
const SKILL_SCHEMA = ["movement","spacing","sprint_reset","attack_timing","crit_timing","combo_control","target_tracking","repositioning","defense","healing","disengagement","recovery"];

function fail(message) { console.error("\n[SWORD-TRAIN] ERROR: " + message); process.exitCode = 1; }
function run(command,args) {
  return new Promise((resolve,reject) => {
    const child=spawn(command,args,{stdio:["ignore","pipe","pipe"],windowsHide:true});
    let stdout="",stderr="";
    child.stdout.on("data",d=>stdout+=d); child.stderr.on("data",d=>stderr+=d);
    child.on("error",reject); child.on("close",code=>code===0?resolve(stdout):reject(new Error(stderr||command+" exited "+code)));
  });
}
async function requireFfmpeg() { try { await run("ffmpeg",["-version"]); await run("ffprobe",["-version"]); } catch { throw new Error("ffmpeg and ffprobe are required on PATH."); } }
async function durationSeconds(video) {
  const out=await run("ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",video]);
  const n=Number.parseFloat(out.trim()); if(!Number.isFinite(n)||n<=0) throw new Error("Could not read duration: "+video); return n;
}
async function sampleVideo(video) {
  const id=createHash("sha1").update(video).digest("hex").slice(0,10);
  const dir=path.join(FRAMES_DIR,id); await fs.mkdir(dir,{recursive:true});
  const duration=await durationSeconds(video);
  const pattern=path.join(dir,"frame-%06d.jpg");
  await run("ffmpeg",["-hide_banner","-loglevel","error","-i",video,"-vf","fps="+FPS+",scale=960:-2:force_original_aspect_ratio=decrease","-q:v","4","-y",pattern]);
  const files=(await fs.readdir(dir)).filter(x=>x.endsWith(".jpg")).sort();
  return {video,duration,files:files.map(x=>path.join(dir,x))};
}
async function imageDataUrl(file) {
  const data=await fs.readFile(file);
  if(data.length>MAX_BYTES) throw new Error("Sampled image exceeds API image limit: "+file);
  return "data:image/jpeg;base64,"+data.toString("base64");
}
async function groqJson(messages,maxTokens) {
  const res=await fetch("https://api.groq.com/openai/v1/chat/completions",{
    method:"POST",headers:{"Authorization":"Bearer "+API_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({model:MODEL,messages,temperature:0.2,max_completion_tokens:maxTokens,response_format:{type:"json_object"}})
  });
  if(!res.ok) throw new Error("Groq HTTP "+res.status+": "+await res.text());
  const json=await res.json(); const raw=json.choices?.[0]?.message?.content;
  if(!raw) throw new Error("Groq returned no content.");
  return JSON.parse(raw);
}
async function vision(frames,videoName,frameStart) {
  const content=[{type:"text",text:
    "Extract reusable Minecraft Java Sword PvP skills from these consecutive sampled montage frames. "+
    "Only infer what is visually supported. Do not invent exact key presses. Return JSON with key observations, "+
    "an array of objects: sequence, skill, confidence, evidence, likely_goal, prerequisites, timing_notes. "+
    "skill must be one of: "+SKILL_SCHEMA.join(", ")+". Focus on movement, spacing, sprint resets, attack/crit timing, "+
    "combo control, target tracking, repositioning, defense, healing, disengagement and recovery. Video="+videoName+
    ", frameStart="+frameStart}];
  for(const file of frames) content.push({type:"image_url",image_url:{url:await imageDataUrl(file)}});
  return groqJson([{role:"user",content}],1600);
}
async function synthesize(observations) {
  return groqJson([{role:"user",content:
    "Build a conservative Sword PvP skill library from these visual observations. Merge duplicates and never invent "+
    "mechanics not supported by evidence. Return JSON: {skills:[{id,name,skill,description,when_to_use,avoid_when,confidence,evidence}]}. "+
    "Only use these categories: "+SKILL_SCHEMA.join(", ")+"\n"+JSON.stringify(observations)}],5000);
}
async function main() {
  console.log("=== ZOYA Sword PvP Video Trainer ===");
  if(!API_KEY) throw new Error("GROQ_API_KEY is not set.");
  await requireFfmpeg(); await fs.mkdir(FRAMES_DIR,{recursive:true});
  const names=(await fs.readdir(VIDEO_DIR)).filter(x=>/\.(mp4|mkv|webm|mov)$/i.test(x));
  if(!names.length) throw new Error("No videos found in "+VIDEO_DIR);
  const observations=[];
  for(const name of names) {
    const sampled=await sampleVideo(path.join(VIDEO_DIR,name));
    console.log("[SWORD-TRAIN] "+name+" | "+sampled.duration.toFixed(1)+"s | "+sampled.files.length+" frames");
    for(let i=0;i<sampled.files.length;i+=MAX_IMAGES_PER_CALL) {
      const batch=sampled.files.slice(i,i+MAX_IMAGES_PER_CALL);
      process.stdout.write("  analyzing frames "+(i+1)+"-"+(i+batch.length)+"/"+sampled.files.length+"\r");
      const result=await vision(batch,name,i);
      observations.push({video:name,frameStart:i,result});
    }
    process.stdout.write("\n");
  }
  await fs.writeFile(OBS_FILE,JSON.stringify({version:1,kit:"sword",model:MODEL,fps:FPS,generatedAt:new Date().toISOString(),observations},null,2));
  const merged=await synthesize(observations);
  const output={version:1,kit:"sword",source:"video_reference",generatedAt:new Date().toISOString(),model:MODEL,skillCategories:SKILL_SCHEMA,skills:merged.skills||[]};
  await fs.writeFile(SKILLS_FILE,JSON.stringify(output,null,2));
  console.log("\n[SWORD-TRAIN] COMPLETE");
  console.log("[SWORD-TRAIN] Observations: "+observations.length);
  console.log("[SWORD-TRAIN] Skills: "+output.skills.length);
  console.log("[SWORD-TRAIN] "+SKILLS_FILE);
  console.log("[SWORD-TRAIN] Minecraft server was NOT used.");
}
main().catch(fail);
