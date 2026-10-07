#!/usr/bin/env node
import {spawn} from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const bridge=process.env.ZOYA_BRIDGE_URL||"http://127.0.0.1:32123";
const target=process.env.ZOYA_TRAIN_OPPONENT||"ZoyaTrainer";
const rounds=Math.max(1,Number(process.env.ZOYA_TRAIN_ROUNDS||5));
const configPath=process.env.ZOYA_MINECRAFT_CONFIG||path.join(process.env.APPDATA||process.cwd(),"com.zoya.aicompanion","minecraft","config.json");
const mode=process.env.ZOYA_TRAIN_OPPONENT_MODE||"strafe";
const opponentStartTimeoutMs=Math.max(10000,Number(process.env.ZOYA_TRAIN_OPPONENT_START_TIMEOUT_MS||30000));

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function readConfig(){
  try{return JSON.parse(fs.readFileSync(configPath,"utf8"));}catch(error){
    throw new Error("Cannot read Minecraft config at "+configPath+": "+(error instanceof Error?error.message:String(error)));
  }
}
async function getStatus(){
  const response=await fetch(bridge+"/status");
  if(!response.ok)throw new Error("Bridge /status returned HTTP "+response.status);
  return response.json();
}
async function post(pathname,body){
  const response=await fetch(bridge+pathname,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  if(!response.ok)throw new Error("Bridge "+pathname+" returned HTTP "+response.status);
  return response.json();
}
function canReachServer(host,port){
  return new Promise(resolve=>{
    const socket=new net.Socket();
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;socket.destroy();resolve(value);};
    socket.setTimeout(3000);
    socket.once("connect",()=>finish(true));
    socket.once("timeout",()=>finish(false));
    socket.once("error",()=>finish(false));
    socket.connect(port,host);
  });
}
function startOpponent(env){
  const child=spawn(process.execPath,["swordTrainingOpponent.mjs"],{env,stdio:["ignore","pipe","inherit"]});
  let connected=false;
  let exited=false;
  let output="";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data",chunk=>{
    const text=String(chunk);
    output+=text;
    process.stdout.write(text);
    if(text.includes("[SWORD-OPPONENT] connected "))connected=true;
  });
  child.once("exit",()=>{exited=true;});
  return {child,get connected(){return connected;},get exited(){return exited;},get output(){return output;}};
}
async function waitForOpponentStart(opponent,round){
  const deadline=Date.now()+opponentStartTimeoutMs;
  while(Date.now()<deadline){
    if(opponent.connected)return;
    if(opponent.exited)throw new Error("Sword training opponent exited before round "+round+" started.");
    await sleep(250);
  }
  try{opponent.child.kill();}catch{}
  throw new Error("Sword training opponent did not connect within "+opponentStartTimeoutMs+"ms for round "+round+".");
}
async function stopOpponent(opponent){
  try{opponent.child.kill();}catch{}
  const deadline=Date.now()+5000;
  while(!opponent.exited&&Date.now()<deadline)await sleep(100);
}

console.log("=== ZOYA Sword PvP Training Session ===");
const config=readConfig();
const host=process.env.ZOYA_TRAIN_HOST||String(config.host||"127.0.0.1");
const port=Number(process.env.ZOYA_TRAIN_PORT||config.port||25565);
const opponentEnv={
  ...process.env,
  ZOYA_TRAIN_HOST:host,
  ZOYA_TRAIN_PORT:String(port),
  ZOYA_TRAIN_OPPONENT:target,
  ZOYA_TRAIN_TARGET:process.env.ZOYA_TRAIN_TARGET||"ZOYA",
  ZOYA_TRAIN_OPPONENT_MODE:mode
};
console.log("[SWORD-SESSION] Server="+host+":"+port+" opponent="+target+" mode="+mode+" rounds="+rounds);

const bridgeStatus=await getStatus();
if(!bridgeStatus.connected)throw new Error("ZOYA bridge is not connected to Minecraft.");
if(String(bridgeStatus.host||"")!==host||Number(bridgeStatus.port||0)!==port){
  throw new Error("Training server does not match connected ZOYA server: "+host+":"+port+" vs "+String(bridgeStatus.host||"?")+":"+String(bridgeStatus.port||"?"));
}
if(!(await canReachServer(host,port))){
  throw new Error("Minecraft server "+host+":"+port+" is not reachable. No training rounds were started.");
}
console.log("[SWORD-SESSION] Minecraft server reachable. Starting training rounds.");

for(let round=1;round<=rounds;round++){
  const opponent=startOpponent(opponentEnv);
  await waitForOpponentStart(opponent,round);
  console.log("[SWORD-SESSION] round="+round+" opponent connected. Dispatching Sword PvP.");
  const result=await post("/capability",{mode:"pvp",args:target});
  console.log("[SWORD-SESSION] round="+round+" pvp dispatch="+JSON.stringify(result));
  if(!result?.ok||result?.accepted!==true){
    await stopOpponent(opponent);
    throw new Error("PvP capability was not accepted for round "+round+".");
  }

  const deadline=Date.now()+Math.max(15000,Number(process.env.ZOYA_TRAIN_ROUND_WAIT_MS||125000));
  let completed=false;
  while(Date.now()<deadline){
    await sleep(1000);
    const response=await fetch(bridge+"/task");
    if(!response.ok)throw new Error("Bridge /task returned HTTP "+response.status);
    const task=await response.json();
    if(!task.activeTask){completed=true;break;}
    if(opponent.exited)break;
  }
  await stopOpponent(opponent);
  if(!completed)throw new Error("Round "+round+" did not finish normally.");
  await sleep(1000);
}
console.log("[SWORD-SESSION] rounds completed. Run npm run eval:sword to summarize telemetry.");
