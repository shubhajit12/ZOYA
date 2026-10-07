#!/usr/bin/env node
import {spawn} from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
const bridge=process.env.ZOYA_BRIDGE_URL||"http://127.0.0.1:32123";
const target=process.env.ZOYA_TRAIN_OPPONENT||"ZoyaTrainer";
const rounds=Math.max(1,Number(process.env.ZOYA_TRAIN_ROUNDS||5));
const configPath=process.env.ZOYA_MINECRAFT_CONFIG||path.join(process.env.APPDATA||process.cwd(),"com.zoya.aicompanion","minecraft","config.json");
const configured=JSON.parse(fs.readFileSync(configPath,"utf8"));
const host=process.env.ZOYA_TRAIN_HOST||String(configured.host||"127.0.0.1"),port=Number(process.env.ZOYA_TRAIN_PORT||configured.port||25565);
const mode=process.env.ZOYA_TRAIN_OPPONENT_MODE||"strafe";
const env={...process.env,ZOYA_TRAIN_HOST:host,ZOYA_TRAIN_PORT:String(port),ZOYA_TRAIN_OPPONENT:target,ZOYA_TRAIN_TARGET:process.env.ZOYA_TRAIN_TARGET||"ZOYA",ZOYA_TRAIN_OPPONENT_MODE:mode};
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function post(path,body){const r=await fetch(bridge+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});return r.json();}
async function status(){const r=await fetch(bridge+"/status");return r.json();}
console.log("=== ZOYA Sword PvP Training Session ===");
console.log("[SWORD-SESSION] Server="+host+":"+port+" opponent="+target+" mode="+mode+" rounds="+rounds);
const bridgeStatus=await status();
if(!bridgeStatus.connected)throw new Error("ZOYA bridge is not connected to Minecraft.");
if(String(bridgeStatus.host||"")!==host||Number(bridgeStatus.port||0)!==port)throw new Error("Training server does not match connected ZOYA server: "+host+":"+port+" vs "+String(bridgeStatus.host||"?")+":"+String(bridgeStatus.port||"?"));
const reachable=await new Promise(resolve=>{const s=new net.Socket();let done=false;const finish=v=>{if(done)return;done=true;s.destroy();resolve(v)};s.setTimeout(3000);s.once("connect",()=>finish(true));s.once("timeout",()=>finish(false));s.once("error",()=>finish(false));s.connect(port,host)});
if(!reachable)throw new Error("Minecraft server "+host+":"+port+" is not reachable. No training rounds were started.");
console.log("[SWORD-SESSION] Minecraft server reachable. Starting training rounds.");
for(let round=1;round<=rounds;round++){
  const child=spawn(process.execPath,["swordTrainingOpponent.mjs"],{env,stdio:["ignore","inherit","inherit"]});
  await sleep(2500);
  if(opponentExited){try{child.kill();}catch{};throw new Error("Sword training opponent exited before round "+round+" started.");}
  const result=await post("/capability",{mode:"pvp",args:target});
  console.log("[SWORD-SESSION] round="+round+" pvp dispatch="+JSON.stringify(result));
  const deadline=Date.now()+Math.max(15000,Number(process.env.ZOYA_TRAIN_ROUND_WAIT_MS||125000));
  let completed=false;
  while(Date.now()<deadline){
    if(!completed)throw new Error("Round "+round+" did not finish normally.");
  await sleep(1000);
    const t=await (await fetch(bridge+"/task")).json();
    if(!t.activeTask){completed=true;break;}
  }
  try{child.kill();}catch{}
  await sleep(1000);
}
console.log("[SWORD-SESSION] rounds dispatched. Run npm run eval:sword to summarize telemetry.");
