#!/usr/bin/env node
/**
 * Persistent ZOYA Sword PvP training orchestrator.
 *
 * A training session is a resumable job, not a one-shot process:
 * - checkpoints after every round
 * - Ctrl+C / SIGTERM safely cancels and saves
 * - resume continues from the saved phase/round
 * - every round produces a candidate model
 * - candidate is kept only when the measured score is not worse
 * - curriculum advances through stationary -> strafe -> retreat -> aggressive -> mixed
 * - mastery requires the configured live-performance gate across multiple rounds
 */
import {spawn} from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT=path.resolve(process.env.ZOYA_PVP_TRAINING_DIR||"./minecraft-training");
const LIVE=path.join(ROOT,"sword","live");
const CHECKPOINT=path.join(LIVE,"sword-training-session.json");
const MODEL=path.join(ROOT,"sword","swordPvpModel.json");
const EXPERIENCE=path.join(LIVE,"sword-experience.jsonl");
const ROUNDS=path.join(LIVE,"sword-rounds.jsonl");
const HISTORY=path.join(LIVE,"sword-learning-history.jsonl");
const CANDIDATE_BASELINE=path.join(LIVE,"sword-candidate-baseline.json");

const bridge=process.env.ZOYA_BRIDGE_URL||"http://127.0.0.1:32123";
const target=process.env.ZOYA_TRAIN_OPPONENT||"ZoyaTrainer";
const configPath=process.env.ZOYA_MINECRAFT_CONFIG||path.join(process.env.APPDATA||process.cwd(),"com.zoya.aicompanion","minecraft","config.json");
const requestedRounds=Math.max(1,Number(process.env.ZOYA_TRAIN_ROUNDS||40));
const mode=process.env.ZOYA_TRAIN_OPPONENT_MODE||"curriculum";
const roundMs=Math.max(30000,Number(process.env.ZOYA_TRAIN_ROUND_MS||120000));
const opponentStartTimeoutMs=Math.max(10000,Number(process.env.ZOYA_TRAIN_OPPONENT_START_TIMEOUT_MS||30000));
const roundWaitMs=Math.max(15000,Number(process.env.ZOYA_TRAIN_ROUND_WAIT_MS||125000));
const taskStartTimeoutMs=Math.max(3000,Number(process.env.ZOYA_TRAIN_TASK_START_TIMEOUT_MS||10000));
const minAccuracy=Number(process.env.ZOYA_TRAIN_MIN_ACCURACY||0.55);
const minScore=Number(process.env.ZOYA_TRAIN_MIN_SCORE||55);
const minDamageRatio=Number(process.env.ZOYA_TRAIN_MIN_DAMAGE_RATIO||1.05);
const masteryRounds=Math.max(1,Number(process.env.ZOYA_TRAIN_MASTERY_ROUNDS||3));
const curriculum=["stationary","strafe","retreat","aggressive","mixed"];

let cancelling=false;
let activeOpponent=null;
let activeTaskBaseline=0;

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function ensureDirs(){fs.mkdirSync(LIVE,{recursive:true});fs.mkdirSync(path.dirname(MODEL),{recursive:true});}
function readJson(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;}}
function writeJson(file,value){ensureDirs();fs.writeFileSync(file,JSON.stringify(value,null,2),"utf8");}
function readConfig(){
  const c=readJson(configPath,null);
  if(!c)throw new Error("Cannot read Minecraft config at "+configPath);
  return c;
}
async function getStatus(){
  const r=await fetch(bridge+"/status");
  if(!r.ok)throw new Error("Bridge /status returned HTTP "+r.status);
  return r.json();
}
async function post(pathname,body){
  const r=await fetch(bridge+pathname,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok)throw new Error("Bridge "+pathname+" returned HTTP "+r.status);
  return r.json();
}
function canReachServer(host,port){
  return new Promise(resolve=>{
    const s=new net.Socket(); let done=false;
    const finish=v=>{if(done)return;done=true;s.destroy();resolve(v);};
    s.setTimeout(3000);s.once("connect",()=>finish(true));s.once("timeout",()=>finish(false));s.once("error",()=>finish(false));s.connect(port,host);
  });
}
function loadCheckpoint(){
  const c=readJson(CHECKPOINT,null);
  if(!c)return {
    version:1,status:"new",phaseIndex:0,round:1,completedRounds:0,
    totalRounds:requestedRounds,bestScore:null,lastScore:null,
    consecutiveMasteryRounds:0,acceptedCandidates:0,rejectedCandidates:0,
    startedAt:null,lastCompletedAt:null,updatedAt:null
  };
  return c;
}
function saveCheckpoint(c){
  c.updatedAt=new Date().toISOString();
  writeJson(CHECKPOINT,c);
}
function appendHistory(row){
  ensureDirs();fs.appendFileSync(HISTORY,JSON.stringify({...row,at:new Date().toISOString()})+"\n");
}
function startOpponent(env){
  const child=spawn(process.execPath,["swordTrainingOpponent.mjs"],{env,stdio:["ignore","pipe","inherit"]});
  let connected=false,exited=false,output="";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data",chunk=>{
    const s=String(chunk);output+=s;process.stdout.write(s);
    if(s.includes("[SWORD-OPPONENT] connected "))connected=true;
  });
  child.once("exit",()=>{exited=true;});
  return {child,get connected(){return connected;},get exited(){return exited;},get output(){return output;}};
}
async function waitForOpponentStart(o,round){
  const deadline=Date.now()+opponentStartTimeoutMs;
  while(Date.now()<deadline){
    if(cancelling)throw new Error("TRAINING_CANCELLED");
    if(o.connected)return;
    if(o.exited)throw new Error("Sword training opponent exited before round "+round+" started.");
    await sleep(250);
  }
  try{o.child.kill();}catch{}
  throw new Error("Sword training opponent did not connect within "+opponentStartTimeoutMs+"ms for round "+round+".");
}
async function stopOpponent(o){
  if(!o)return;
  try{o.child.kill("SIGTERM");}catch{}
  const deadline=Date.now()+5000;
  while(!o.exited&&Date.now()<deadline)await sleep(100);
  if(!o.exited)try{o.child.kill("SIGKILL");}catch{}
}
async function cancelZoya(reason){
  try{await fetch(bridge+"/cancel",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reason})});}catch{}
}
async function waitForNewResult(baseline,timeout=10000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    try{
      const r=await fetch(bridge+"/task");
      if(r.ok){
        const t=await r.json(),id=Number(t?.lastTaskResult?.id||0);
        if(id>baseline&&!t?.activeTask)return t.lastTaskResult;
      }
    }catch{}
    await sleep(250);
  }
  return null;
}
async function evaluate(){
  const child=spawn(process.execPath,["swordTrainingEvaluator.mjs"],{env:process.env,stdio:["ignore","pipe","inherit"]});
  child.stdout.setEncoding("utf8");child.stdout.on("data",x=>process.stdout.write(x));
  const code=await new Promise(resolve=>child.once("exit",resolve));
  if(code!==0)throw new Error("Sword evaluator failed.");
  return readJson(path.join(LIVE,"sword-evaluation.json"),null);
}
async function optimizeCandidate(){
  const optimizer=path.join(path.dirname(fileURLToPath(import.meta.url)),"swordTrainingOptimizer.mjs");
  const child=spawn(process.execPath,[optimizer],{env:process.env,stdio:["ignore","pipe","inherit"]});
  child.stdout.setEncoding("utf8");child.stdout.on("data",x=>process.stdout.write(x));
  const code=await new Promise(resolve=>child.once("exit",resolve));
  if(code!==0)throw new Error("Adaptive trainer failed.");
}
function damageRatio(report){
  const d=Number(report?.damageDealt||0),t=Number(report?.damageTaken||0);
  return t>0?d/t:d>0?Infinity:0;
}
function gate(report){
  const accuracy=Number(report?.attackAccuracy||0),score=Number(report?.score||0),ratio=damageRatio(report);
  return {accuracy,score,ratio,pass:accuracy>=minAccuracy&&score>=minScore&&ratio>=minDamageRatio};
}
function snapshotModel(){return fs.existsSync(MODEL)?fs.readFileSync(MODEL,"utf8"):null;}
function experienceCount(){return fs.existsSync(EXPERIENCE)?fs.readFileSync(EXPERIENCE,"utf8").split(/\r?\n/).filter(Boolean).length:0;}
function writeRoundResult(round,phase,report,gateResult,accepted){ensureDirs();fs.appendFileSync(ROUNDS,JSON.stringify({round,phase,report,gate:gateResult,candidateAccepted:accepted,at:new Date().toISOString()})+"\n");}
function markExperienceConsumed(){const m=readJson(MODEL,null);if(!m)return;m.trainingState={...(m.trainingState||{}),experienceLines:experienceCount()};writeJson(MODEL,m);}
function restoreModel(snapshot){
  if(snapshot==null)fs.rmSync(MODEL,{force:true});else fs.writeFileSync(MODEL,snapshot,"utf8");
}
function advanceExperienceOffset(){
  const m=readJson(MODEL,null);
  if(!m)return;
  const lines=fs.existsSync(EXPERIENCE)?fs.readFileSync(EXPERIENCE,"utf8").split(/\r?\n/).filter(Boolean).length:0;
  m.trainingState={...(m.trainingState||{}),experienceLines:lines};
  writeJson(MODEL,m);
}
async function safeCancel(reason="user cancelled training"){
  if(cancelling)return;
  cancelling=true;
  console.log("\n[SWORD-SESSION] "+reason);
  await cancelZoya(reason);
  await waitForNewResult(activeTaskBaseline,5000);
  await stopOpponent(activeOpponent);
  const c=loadCheckpoint();
  c.status="paused";
  c.cancelReason=reason;
  c.lastPausedAt=new Date().toISOString();
  saveCheckpoint(c);
  console.log("[SWORD-SESSION] CHECKPOINT SAVED");
  console.log("[SWORD-SESSION] Resume later with: npm run train:sword:live");
}
process.once("SIGINT",()=>{void safeCancel("training cancelled by user (Ctrl+C)").then(()=>process.exit(0));});
process.once("SIGTERM",()=>{void safeCancel("training cancelled by process shutdown").then(()=>process.exit(0));});

async function main(){
  ensureDirs();
  const c=loadCheckpoint();
  if(c.status==="completed"){
    console.log("[SWORD-SESSION] Previous session already passed the mastery gate.");
    console.log("[SWORD-SESSION] Start a fresh session by setting ZOYA_TRAIN_RESET=1.");
    if(process.env.ZOYA_TRAIN_RESET!=="1")return;
  }
  if(process.env.ZOYA_TRAIN_RESET==="1"){
    c.status="new";c.phaseIndex=0;c.round=1;c.completedRounds=0;c.totalRounds=requestedRounds;
    c.bestScore=null;c.lastScore=null;c.consecutiveMasteryRounds=0;c.acceptedCandidates=0;c.rejectedCandidates=0;
    c.startedAt=null;c.lastCompletedAt=null;c.cancelReason=null;saveCheckpoint(c);
  }
  c.totalRounds=Math.max(c.totalRounds||0,requestedRounds);
  c.status="running";c.startedAt=c.startedAt||new Date().toISOString();saveCheckpoint(c);

  const config=readConfig();
  const host=process.env.ZOYA_TRAIN_HOST||String(config.host||"127.0.0.1");
  const port=Number(process.env.ZOYA_TRAIN_PORT||config.port||25565);
  const bridgeStatus=await getStatus();
  if(!bridgeStatus.connected)throw new Error("ZOYA bridge is not connected to Minecraft.");
  if(String(bridgeStatus.host||"")!==host||Number(bridgeStatus.port||0)!==port)
    throw new Error("Training server does not match connected ZOYA server: "+host+":"+port+" vs "+String(bridgeStatus.host||"?")+":"+String(bridgeStatus.port||"?"));
  if(!(await canReachServer(host,port)))throw new Error("Minecraft server "+host+":"+port+" is not reachable.");

  console.log("=== ZOYA Sword PvP Persistent Training ===");
  console.log("[SWORD-SESSION] "+(c.completedRounds?"RESUMING":"STARTING")+" phase="+(c.phaseIndex+1)+"/5 round="+c.round+" completed="+c.completedRounds+" total="+c.totalRounds);
  console.log("[SWORD-SESSION] Ctrl+C safely pauses and saves. Training never requires the PC to stay on continuously.");

  while(c.completedRounds<c.totalRounds&&!cancelling){
    const phaseIndex=c.phaseIndex%curriculum.length;
    const roundMode=mode==="curriculum"?curriculum[phaseIndex]:mode;
    const round=c.round;
    console.log("\n[SWORD-SESSION] round="+round+" phase="+(phaseIndex+1)+"/5 curriculum="+roundMode);

    const beforeTask=await (await fetch(bridge+"/task")).json();
    activeTaskBaseline=Number(beforeTask?.lastTaskResult?.id||0);
    const snapshot=snapshotModel();
    const opponentEnv={
      ...process.env,ZOYA_TRAIN_HOST:host,ZOYA_TRAIN_PORT:String(port),
      ZOYA_TRAIN_OPPONENT:target,ZOYA_TRAIN_TARGET:process.env.ZOYA_TRAIN_TARGET||"ZOYA",
      ZOYA_TRAIN_OPPONENT_MODE:roundMode,ZOYA_TRAIN_ROUND_MS:String(roundMs)
    };
    activeOpponent=startOpponent(opponentEnv);

    try{
      await waitForOpponentStart(activeOpponent,round);
      console.log("[SWORD-SESSION] opponent connected; dispatching dedicated Sword Kit.");
      const dispatched=await post("/capability",{mode:"pvp",args:target});
      console.log("[SWORD-SESSION] pvp dispatch="+JSON.stringify(dispatched));
      if(!dispatched?.ok||dispatched?.accepted!==true)throw new Error("PvP capability was not accepted for round "+round+".");

      const deadline=Date.now()+roundWaitMs,startDeadline=Date.now()+taskStartTimeoutMs;
      let started=false,finished=false;
      while(Date.now()<deadline){
        if(cancelling)throw new Error("TRAINING_CANCELLED");
        await sleep(500);
        const t=await (await fetch(bridge+"/task")).json();
        const activeId=Number(t?.activeTask?.id||0),resultId=Number(t?.lastTaskResult?.id||0);
        if(activeId>activeTaskBaseline)started=true;
        if(resultId>activeTaskBaseline){
          started=true;
          const status=String(t.lastTaskResult?.status||"").toLowerCase(),reason=String(t.lastTaskResult?.reason||"unknown");
          if(status!=="completed"&&!reason.startsWith("death"))throw new Error("Round "+round+" failed: status="+status+" reason="+reason);
          finished=true;break;
        }
        if(!started&&Date.now()>=startDeadline)throw new Error("Round "+round+" PvP task never started.");
        if(activeOpponent.exited&&started){
          await cancelZoya("training opponent ended");
          await waitForNewResult(activeTaskBaseline);
          finished=true;break;
        }
      }
      if(!finished){
        await cancelZoya("training round timeout");
        const r=await waitForNewResult(activeTaskBaseline,5000);
        if(!String(r?.reason||"").startsWith("death"))throw new Error("Round "+round+" timed out.");
      }
    } finally {
      await stopOpponent(activeOpponent);activeOpponent=null;
    }

    const before=await evaluate();
    const beforeGate=gate(before);
    const hadPending=Boolean(c.pendingCandidate);
    let candidateAccepted=null;

    // Validate a candidate only on a fresh live round with the same curriculum
    // mode that produced it. The candidate is never judged on its own training
    // telemetry.
    if(hadPending){
      const baselineScore=Number(c.pendingCandidate.baselineScore||0);
      const candidateScore=beforeGate.score;
      const candidatePass=beforeGate.pass;
      const improved=candidateScore>=baselineScore+0.5;
      if(candidatePass&&improved){
        candidateAccepted=true;
        c.acceptedCandidates++;
        c.bestScore=Math.max(Number(c.bestScore||0),candidateScore);
        appendHistory({type:"candidate_accepted",round,phase:roundMode,baselineScore,candidateScore,improvement:candidateScore-baselineScore});
        console.log("[SWORD-SESSION] candidate=ACCEPTED baseline="+baselineScore.toFixed(2)+" validation="+candidateScore.toFixed(2));
      }else{
        candidateAccepted=false;
        const base=readJson(CANDIDATE_BASELINE,null);
        if(base)writeJson(MODEL,base);
        markExperienceConsumed();
        c.rejectedCandidates++;
        appendHistory({type:"candidate_rejected",round,phase:roundMode,baselineScore,candidateScore,improvement:candidateScore-baselineScore,gate:beforeGate});
        console.log("[SWORD-SESSION] candidate=REJECTED baseline="+baselineScore.toFixed(2)+" validation="+candidateScore.toFixed(2));
      }
      c.pendingCandidate=null;
      fs.rmSync(CANDIDATE_BASELINE,{force:true});
      saveCheckpoint(c);
    }else{
      c.bestScore=c.bestScore==null?beforeGate.score:Math.max(c.bestScore,beforeGate.score);
    }

    const finalReport=await evaluate();
    const finalGate=gate(finalReport);
    if(finalGate.pass)c.consecutiveMasteryRounds++;else c.consecutiveMasteryRounds=0;

    // Mastery is evaluated on the model actually validated in this round.
    // Only after that measurement do we generate the next candidate.
    if(c.consecutiveMasteryRounds<masteryRounds && c.completedRounds+1<c.totalRounds){
      const baseline=readJson(MODEL,null);
      if(baseline)writeJson(CANDIDATE_BASELINE,baseline);
      await optimizeCandidate();
      const generated=readJson(MODEL,null);
      const bounded=Number(generated?.policy?.spacing?.attackMax||3.05)<=3.05 &&
        Number(generated?.policy?.spacing?.attackMax||3.05)>=2.70;
      if(bounded){
        c.pendingCandidate={phaseIndex,phase:roundMode,baselineScore:finalGate.score,createdRound:round,candidateVersion:generated?.trainedAt||null};
        appendHistory({type:"candidate_generated",round,phase:roundMode,baselineScore:finalGate.score,candidateVersion:generated?.trainedAt||null});
      }else{
        if(baseline)writeJson(MODEL,baseline);
        fs.rmSync(CANDIDATE_BASELINE,{force:true});
        c.rejectedCandidates++;
        appendHistory({type:"candidate_rejected_bounds",round,phase:roundMode,baselineScore:finalGate.score});
      }
    }


    c.lastScore=finalGate.score;
    writeRoundResult(round,roundMode,finalReport,finalGate,candidateAccepted);
    c.completedRounds++;
    c.lastCompletedAt=new Date().toISOString();

    if(c.consecutiveMasteryRounds>=masteryRounds){
      c.status="completed";saveCheckpoint(c);
      console.log("\n[SWORD-SESSION] SWORD PvP MASTERY GATE PASSED");
      console.log("[SWORD-SESSION] consecutive passing rounds="+c.consecutiveMasteryRounds);
      console.log("[SWORD-SESSION] accuracy="+(finalGate.accuracy*100).toFixed(1)+"% score="+finalGate.score.toFixed(1)+" damageRatio="+(Number.isFinite(finalGate.ratio)?finalGate.ratio.toFixed(2):"INF"));
      return;
    }

    // A pending candidate needs a same-mode validation round next.
    // Once it has been validated, advance to the next curriculum phase.
    if(hadPending){
      c.phaseIndex=(phaseIndex+1)%curriculum.length;
    }else{
      c.phaseIndex=phaseIndex;
    }
    c.round++;
    c.status="paused";
    saveCheckpoint(c);
    console.log("[SWORD-SESSION] checkpoint saved after round "+round+"; next="+c.round+" phase="+(c.phaseIndex+1));
    c.status="running";saveCheckpoint(c);
  }

  if(cancelling)return;
  c.status="completed_without_mastery";saveCheckpoint(c);
  console.log("\n[SWORD-SESSION] TRAINING RUN FINISHED WITHOUT MASTERY");
  console.log("[SWORD-SESSION] Run again to continue from the saved model/checkpoint.");
  process.exitCode=2;
}
main().catch(async e=>{
  const message=e?.message||String(e);
  if(message==="TRAINING_CANCELLED")return;
  console.error("[SWORD-SESSION] ERROR: "+message);
  const c=loadCheckpoint();c.status="paused";c.lastError=message;c.lastPausedAt=new Date().toISOString();saveCheckpoint(c);
  await stopOpponent(activeOpponent);
  process.exitCode=1;
});
