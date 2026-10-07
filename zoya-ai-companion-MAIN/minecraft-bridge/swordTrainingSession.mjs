#!/usr/bin/env node
import {spawn} from "node:child_process";
const bridge=process.env.ZOYA_BRIDGE_URL||"http://127.0.0.1:32123";
const target=process.env.ZOYA_TRAIN_OPPONENT||"ZoyaTrainer";
const rounds=Math.max(1,Number(process.env.ZOYA_TRAIN_ROUNDS||5));
const host=process.env.ZOYA_TRAIN_HOST||"127.0.0.1",port=process.env.ZOYA_TRAIN_PORT||"25565";
const mode=process.env.ZOYA_TRAIN_OPPONENT_MODE||"strafe";
const env={...process.env,ZOYA_TRAIN_HOST:host,ZOYA_TRAIN_PORT:port,ZOYA_TRAIN_OPPONENT:target,ZOYA_TRAIN_TARGET:process.env.ZOYA_TRAIN_TARGET||"ZOYA",ZOYA_TRAIN_OPPONENT_MODE:mode};
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function post(path,body){const r=await fetch(bridge+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});return r.json();}
async function status(){const r=await fetch(bridge+"/status");return r.json();}
console.log("=== ZOYA Sword PvP Training Session ===");
console.log("[SWORD-SESSION] Server="+host+":"+port+" opponent="+target+" mode="+mode+" rounds="+rounds);
for(let round=1;round<=rounds;round++){
  const s=await status();
  if(!s.connected)throw new Error("ZOYA bridge is not connected to Minecraft.");
  const child=spawn(process.execPath,["swordTrainingOpponent.mjs"],{env,stdio:["ignore","inherit","inherit"]});
  await sleep(2500);
  const result=await post("/capability",{mode:"pvp",args:target});
  console.log("[SWORD-SESSION] round="+round+" pvp dispatch="+JSON.stringify(result));
  const deadline=Date.now()+Math.max(15000,Number(process.env.ZOYA_TRAIN_ROUND_WAIT_MS||125000));
  while(Date.now()<deadline){
    await sleep(1000);
    const t=await (await fetch(bridge+"/task")).json();
    if(!t.activeTask)break;
  }
  try{child.kill();}catch{}
  await sleep(1000);
}
console.log("[SWORD-SESSION] rounds dispatched. Run npm run eval:sword to summarize telemetry.");
