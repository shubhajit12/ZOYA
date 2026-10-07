/**
 * ZOYA Sword PvP Kit Controller
 * Single owner of Sword-kit combat decisions and main-hand equipment.
 */
import fs from "node:fs";
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function findPlayer(bot,name){const k=String(name||"").trim().toLowerCase();return k?Object.values(bot.players||{}).find(p=>String(p?.username||"").toLowerCase()===k)?.entity||null:null;}
function sword(bot){for(const n of ["netherite_sword","diamond_sword","iron_sword","stone_sword","golden_sword","wooden_sword"]){const i=bot.inventory?.items?.().find(x=>String(x?.name||"").toLowerCase()===n);if(i)return i;}return null;}
function gapple(bot){return bot.inventory?.items?.().find(i=>["enchanted_golden_apple","golden_apple"].includes(String(i?.name||"").toLowerCase()))||null;}
function distance(a,b){return a?.position&&b?.position?a.position.distanceTo(b.position):Infinity;}
export function loadSwordModel(modelPath){try{return JSON.parse(fs.readFileSync(modelPath,"utf8"));}catch{return null;}}
export function createSwordPvpController({bot,brain,taskIsActive,wait,log=()=>{},model=null,modelPath=null,goals=null}={}){
 if(!bot||!brain?.decide)throw new Error("Sword controller requires bot and Sword Brain.");
 const state={active:false,targetUuid:null,targetUsername:null,weapon:"sword",strategy:null,since:0,lastAttackAt:0,lastTargetHealth:null,lastSelfHealth:null,lastDamageAt:0,lastTakenAt:0,strafeSign:1,roundStartedAt:0,hits:0,attacks:0,damageDealt:0,damageTaken:0};
 let currentModel=model||{};
  let p=currentModel?.policy||{}, attackIntervalMs=Math.max(600,Number(p.attackIntervalMs||650)), resetMs=clamp(Number(p.sprintReset?.durationMs||100),60,160), telemetryPath=String(currentModel?.telemetryPath||"minecraft-training/sword/live/sword-rounds.jsonl"), experiencePath="minecraft-training/sword/live/sword-experience.jsonl";
  const refreshModel=()=>{
    if(!modelPath)return currentModel;
    try{currentModel=JSON.parse(fs.readFileSync(modelPath,"utf8"));p=currentModel?.policy||{};attackIntervalMs=Math.max(700,Number(p.attackIntervalMs||950));resetMs=clamp(Number(p.sprintReset?.durationMs||100),60,160);telemetryPath=String(currentModel?.telemetryPath||telemetryPath);}catch(error){log("[SWORD-KIT] model reload failed: "+(error?.message||String(error)));}
    brain.setModel?.(currentModel);
    return currentModel;
  };
  const record=event=>{
    try{fs.mkdirSync("minecraft-training/sword/live",{recursive:true});fs.appendFileSync(experiencePath,JSON.stringify({...event,roundStartedAt:state.roundStartedAt,targetUsername:state.targetUsername,modelVersion:currentModel?.trainedAt||"unknown",at:new Date().toISOString()})+"\n");}catch{}
  };
 const alive=()=>bot.health==null||Number(bot.health)>0, active=()=>state.active&&(!taskIsActive||taskIsActive());
 const release=reason=>{if(state.active){log("[SWORD-KIT] owner=controller release reason="+reason);if(telemetryPath){try{fs.mkdirSync("minecraft-training/sword/live",{recursive:true});fs.appendFileSync(telemetryPath,JSON.stringify({...state,endedAt:new Date().toISOString(),releaseReason:reason})+"\n");}catch{}}}state.active=false;state.targetUuid=null;state.targetUsername=null;state.strategy=null;try{bot.pathfinder?.setGoal?.(null);}catch{}try{bot.clearControlStates?.();}catch{}};
 const acquire=target=>{const uuid=String(target?.uuid||target?.id||"");if(state.targetUuid!==uuid){state.targetUuid=uuid;state.targetUsername=String(target?.username||target?.name||"");state.since=Date.now();state.strategy="sword_pressure";log("[SWORD-KIT] owner=controller weapon=sword target="+(state.targetUsername||uuid)+" acquired");}};
 const equipSword=async()=>{const i=sword(bot);if(!i)throw new Error("No usable sword in inventory.");if(String(bot.heldItem?.name||"").toLowerCase()!==i.name.toLowerCase()){await bot.equip(i,"hand");log("[SWORD-KIT] owner=controller weapon=sword equipped="+i.name);}return true;};
 const aim=async t=>{if(t?.position)await bot.lookAt(t.position.offset(0,Math.max(.9,Number(t.height||1.2)*.65),0),true);};
 const stop=()=>{try{bot.clearControlStates?.();}catch{}};
 const strafe=async(t,dir,ms)=>{await aim(t);bot.setControlState?.("forward",true);bot.setControlState?.("left",dir<0);bot.setControlState?.("right",dir>0);bot.setControlState?.("sprint",true);await wait(clamp(ms||140,80,260));stop();};
 const reset=async()=>{bot.setControlState?.("sprint",false);await wait(resetMs);bot.setControlState?.("sprint",true);};
 const approach=async t=>{if(typeof goals?.GoalFollow!=="function")throw new Error("Sword controller requires runtime-provided mineflayer-pathfinder GoalFollow.");try{bot.pathfinder.setGoal(new goals.GoalFollow(t,2.7),true);await wait(180);}finally{try{bot.pathfinder.setGoal(null);}catch{}}};
 const heal=async()=>{const i=gapple(bot);if(!i)return false;await bot.equip(i,"hand");await bot.consume();log("[SWORD-KIT] owner=controller action=heal item="+i.name);await equipSword();return true;};
 async function run(targetUsername,task){
  refreshModel();
  brain.setModel?.(currentModel);
  state.active=true;state.targetUsername=String(targetUsername||"");state.roundStartedAt=Date.now();state.targetUuid=null;state.strategy=null;state.lastAttackAt=0;state.lastTargetHealth=null;state.lastSelfHealth=null;state.lastDamageAt=0;state.lastTakenAt=0;state.strafeSign=1;state.hits=0;state.attacks=0;state.damageDealt=0;state.damageTaken=0;log("[SWORD-KIT] owner=controller weapon=sword active target="+state.targetUsername);
  try{
   await equipSword();
   while(active()){
    if(!alive()){release("death");if(task)task.terminationReason="death";return false;}
    let t=findPlayer(bot,state.targetUsername);
    if(!t){
      const targetDeadline=Date.now()+Math.max(3000,Number(currentModel?.targetAcquireTimeoutMs||10000));
      log("[SWORD-KIT] waiting for target visibility: "+state.targetUsername);
      while(active() && Date.now()<targetDeadline){
        await wait(250);
        t=findPlayer(bot,state.targetUsername);
        if(t)break;
      }
    }
    if(!t){release("target_lost");if(task)task.terminationReason="target_lost";return false;}
    if(t.health!=null&&Number(t.health)<=0){release("target_defeated");if(task)task.terminationReason="target_defeated";return true;}
    acquire(t);const d=distance(bot.entity,t),hp=Number(bot.health??20),prev=state.lastTargetHealth,prevSelf=state.lastSelfHealth;
    if(prev!=null&&Number(t.health)<prev){state.lastDamageAt=Date.now();state.hits++;state.damageDealt+=Math.max(0,prev-Number(t.health));record({event:"hit",damage:Math.max(0,prev-Number(t.health)),distance:d});}
    if(prevSelf!=null&&hp<prevSelf){state.lastTakenAt=Date.now();state.damageTaken+=Math.max(0,prevSelf-hp);record({event:"taken",damage:Math.max(0,prevSelf-hp),distance:d});} state.lastSelfHealth=hp; state.lastTargetHealth=Number(t.health??prev??20);
    const now=Date.now(),cd=clamp((now-state.lastAttackAt)/attackIntervalMs,0,1);
    const decision=brain.decide({targetValid:true,distance:d,health:hp,attackCooldown:cd,recentHit:now-state.lastDamageAt<220,recentlyDamaged:now-state.lastTakenAt<500&&state.lastTakenAt>0,targetAirborne:t.onGround===false,targetConstrained:t.onGround===false,onGround:bot.entity?.onGround!==false,falling:Number(bot.entity?.velocity?.y||0)<-0.08,hasGapple:Boolean(gapple(bot)),emergency:hp<=5,strafeDirection:state.strafeSign>0?"right":"left"});
    log("[SWORD-KIT] owner=controller weapon=sword action="+decision.action+" dist="+d.toFixed(2)+" hp="+hp.toFixed(1));
    record({event:"decision",action:decision.action,reason:decision.reason,distance:d,health:hp,targetHealth:Number(t.health??0),attackCooldown:cd,recentHit:now-state.lastDamageAt<220,recentlyDamaged:now-state.lastTakenAt<500});
    if(decision.action==="idle")return false;
    if(decision.action==="heal"){await heal();continue;}
    if(decision.action==="approach"){await approach(t);continue;}
    if(decision.action==="sprint_reset"){await reset();continue;}
    if(decision.action==="jump_crit"){
      await equipSword();
      await aim(t);
      bot.setControlState?.("forward",true);
      bot.setControlState?.("sprint",true);
      bot.setControlState?.("jump",true);
      await wait(80);
      bot.setControlState?.("jump",false);
      // Do not swing merely because the jump key was pressed. Wait for the
      // real descending phase so this is an actual falling-crit attempt.
      const critDeadline=Date.now()+700;
      while(active() && Date.now()<critDeadline){
        const vy=Number(bot.entity?.velocity?.y||0);
        const fall=Number(bot.entity?.fallDistance||0);
        if(!bot.entity?.onGround && vy< -0.05 && fall>=0.55)break;
        await wait(25);
      }
      if(!active())break;
      await aim(t);
      bot.attack(t);
      state.lastAttackAt=Date.now();
      state.attacks++;
      record({event:"attack",kind:"jump_crit",distance:d,health:hp,targetHealth:Number(t.health??0),fallDistance:Number(bot.entity?.fallDistance||0)});
      await wait(120);
      bot.clearControlStates?.();
      continue;
    }
    if(decision.action==="attack"||decision.action==="falling_crit"){await equipSword();await aim(t);bot.attack(t);state.lastAttackAt=Date.now();state.attacks++;record({event:"attack",kind:decision.action,distance:d,health:hp,targetHealth:Number(t.health??0)});await wait(90);continue;}
    if(["strafe_pressure","defensive_strafe","strafe"].includes(decision.action)){state.strafeSign*=-1;await strafe(t,state.strafeSign,decision.durationMs||140);continue;}
    await wait(100);
   }
   return false;
  }catch(e){
    if(taskIsActive&&!taskIsActive())return false;
    const message=String(e?.message||e||"unknown controller error").slice(0,240);
    if(task)task.terminationReason="controller_error: "+message;
    log("[SWORD-KIT] ERROR: "+message);
    return false;
  }
  finally{release("task_end");}
 }
 return {state,run,release,setModel:next=>{if(next&&typeof next==="object"){currentModel=next;p=currentModel.policy||{};attackIntervalMs=Math.max(700,Number(p.attackIntervalMs||950));resetMs=clamp(Number(p.sprintReset?.durationMs||100),60,160);}},reloadModel:refreshModel};
}
export default createSwordPvpController;

// Verified build boundary: Sword Kit is the sole owner of Sword PvP main-hand execution.
// Live trainer feedback is persisted as experience and hot-reloaded between rounds.
// Offline model compilation is verified before bridge packaging.
// Brain training tests include the learned jump-crit branch.
