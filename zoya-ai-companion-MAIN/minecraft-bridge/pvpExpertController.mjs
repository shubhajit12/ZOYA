/**
 * ZOYA Unified PvP Expert Controller.
 * Single physical combat authority; no training/learning.
 */
import { createPvpExpertBrain } from "./pvpExpertBrain.mjs";
const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,Number(ms)||0)));
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const name=i=>String(i?.name||"").toLowerCase();
const ITEMS=Object.freeze({
 sword:["netherite_sword","diamond_sword","iron_sword","stone_sword","golden_sword","wooden_sword"],
 axe:["netherite_axe","diamond_axe","iron_axe","stone_axe","golden_axe","wooden_axe"],
 mace:["mace"], spear:["netherite_spear","diamond_spear","iron_spear","stone_spear","golden_spear","wooden_spear","spear"],
 bow:["bow"],crossbow:["crossbow"],shield:["shield"],pearl:["ender_pearl"],totem:["totem_of_undying"],
 heal:["enchanted_golden_apple","golden_apple"],water:["water_bucket"],crystal:["end_crystal"],anchor:["respawn_anchor"],
 glowstone:["glowstone"],obsidian:["obsidian"],web:["cobweb"],wind:["wind_charge"]
});
function item(bot,type){return bot.inventory?.items?.().find(i=>ITEMS[type]?.includes(name(i)))||null}
function count(bot,type){return bot.inventory?.items?.().filter(i=>ITEMS[type]?.includes(name(i))).reduce((s,i)=>s+num(i.count),0)||0}
function has(bot,type){return Boolean(item(bot,type))}
function targetOf(bot,u){const w=String(u||"").toLowerCase();return Object.values(bot.players||{}).find(p=>String(p?.username||"").toLowerCase()===w)?.entity||null}
function dist(bot,t){return bot.entity?.position&&t?.position?bot.entity.position.distanceTo(t.position):Infinity}

export function createPvpExpertController({bot,goals,taskIsActive=()=>true,log=()=>{}}={}){
 if(!bot)throw new Error("PvP Expert Controller requires bot");
 const brain=createPvpExpertBrain();
 const state={active:false,targetUsername:null,style:null,action:null,lastAttackAt:0,lastHealth:20,lastTargetHealth:null,strafe:1,attackCount:0,hits:0,damageDealt:0,damageTaken:0,terminationReason:null};
 const stop=()=>{try{bot.pathfinder?.setGoal?.(null)}catch{} try{bot.clearControlStates?.()}catch{}};
 const equip=async type=>{const i=item(bot,type);if(!i)return false;if(name(bot.heldItem)!==name(i))await bot.equip(i,"hand");return true};
 const look=async t=>{if(t?.position)await bot.lookAt(t.position.offset(0,Math.max(.9,num(t.height,1.8)*.62),0),true)};
 const approach=async t=>{if(!goals?.GoalFollow)return false;try{bot.pathfinder.setGoal(new goals.GoalFollow(t,2.7),true);await sleep(170);return true}finally{try{bot.pathfinder.setGoal(null)}catch{}}};
 const strafe=async(t,sign,ms=150)=>{await look(t);bot.setControlState("forward",true);bot.setControlState(sign<0?"left":"right",true);bot.setControlState("sprint",true);await sleep(ms);stop()};
 const melee=async(t,type)=>{if(!await equip(type))return false;const max=type==="spear"?4.8:type==="mace"?3.1:3.15;if(dist(bot,t)>max)return false;await look(t);bot.attack(t);state.lastAttackAt=Date.now();state.attackCount++;await sleep(90);return true};
 const heal=async()=>{const i=item(bot,"heal");if(!i)return false;stop();await bot.equip(i,"hand");await bot.consume();const w=has(bot,"sword")?"sword":has(bot,"axe")?"axe":has(bot,"mace")?"mace":has(bot,"spear")?"spear":null;if(w)await equip(w);return true};
 const shield=async()=>{if(!await equip("shield"))return false;bot.activateItem();await sleep(220);bot.deactivateItem();return true};
 const ranged=async(t,type)=>{if(!await equip(type))return false;await look(t);bot.activateItem();await sleep(type==="bow"?1100:100);bot.deactivateItem();return true};
 const crit=async t=>{if(!await equip("sword"))return false;bot.setControlState("forward",true);bot.setControlState("sprint",true);bot.setControlState("jump",true);await sleep(70);bot.setControlState("jump",false);const end=Date.now()+650;while(state.active&&Date.now()<end){if(bot.entity?.onGround===false&&num(bot.entity.velocity?.y)<-.05&&num(bot.entity.fallDistance)>=.45)break;await sleep(25)}if(bot.entity?.onGround!==false||num(bot.entity.velocity?.y)>=-.05||num(bot.entity.fallDistance)<.45||dist(bot,t)>3.05){stop();return false}await look(t);bot.attack(t);state.lastAttackAt=Date.now();state.attackCount++;stop();return true};
 const run=async(username,task)=>{
  state.active=true;state.targetUsername=String(username||"");state.lastHealth=num(bot.health,20);state.lastTargetHealth=null;state.strafe=1;state.terminationReason=null;
  log("[PVP-EXPERT] active target="+state.targetUsername);
  try{
   while(state.active&&taskIsActive(task)){
    if(num(bot.health)<=0){task.terminationReason="death";return false}
    const t=targetOf(bot,state.targetUsername);if(!t){await sleep(150);continue}
    if(t.health!=null&&num(t.health)<=0){task.terminationReason="target_defeated";return true}
    const hp=num(bot.health,20),th=num(t.health,20),d=dist(bot,t);
    if(state.lastHealth>hp){state.damageTaken+=state.lastHealth-hp} if(state.lastTargetHealth!=null&&state.lastTargetHealth>th){state.hits++;state.damageDealt+=state.lastTargetHealth-th}
    state.lastHealth=hp;state.lastTargetHealth=th;
    const enemy={health:th,shield:false,airborne:t.onGround===false,falling:num(t.velocity?.y)<-.08,velocityY:num(t.velocity?.y),retreating:num(t.velocity?.x)**2+num(t.velocity?.z)**2>.18,totemPopped:false};
    const ctx={distance:d,health:hp,maxHealth:num(bot.maxHealth,20),food:num(bot.food,20),onGround:bot.entity?.onGround!==false,falling:num(bot.entity?.velocity?.y)<-.08,fallDistance:num(bot.entity?.fallDistance),heightAdvantage:num(bot.entity?.position?.y)>num(t.position?.y)+1.5,knockbacked:num(bot.entity?.velocity?.x)**2+num(bot.entity?.velocity?.z)**2>.7,lineOfSight:true,enemy,hasSword:has(bot,"sword"),hasAxe:has(bot,"axe"),hasMace:has(bot,"mace"),hasSpear:has(bot,"spear"),hasMelee:has(bot,"sword")||has(bot,"axe")||has(bot,"mace")||has(bot,"spear"),hasShield:has(bot,"shield"),hasPearl:has(bot,"pearl"),hasTotem:has(bot,"totem"),hasHeal:has(bot,"heal"),hasWaterBucket:has(bot,"water"),hasBurst:has(bot,"mace")||has(bot,"axe")||has(bot,"crystal"),hasDebuff:false,attackReadyAt:Math.max(0,state.lastAttackAt+700-Date.now()),healDistanceMin:4.2,projectileThreat:false,hazard:false,inventory:{sword:count(bot,"sword"),axe:count(bot,"axe"),mace:count(bot,"mace"),spear:count(bot,"spear"),bow:count(bot,"bow"),crossbow:count(bot,"crossbow"),crystal:count(bot,"crystal"),obsidian:count(bot,"obsidian"),respawn_anchor:count(bot,"anchor"),glowstone:count(bot,"glowstone")},strafeDirection:state.strafe>0?"right":"left"};
    const decision=brain.decide(ctx);state.style=decision.style||state.style;state.action=decision.action;
    log("[PVP-EXPERT] style="+state.style+" action="+state.action+" reason="+decision.reason+" dist="+d.toFixed(2));
    if(decision.action==="stop")return false;
    if(decision.action==="heal"){await heal();continue}
    if(decision.action==="shield"){await shield();continue}
    if(decision.action==="pearl_escape"){if(await equip("pearl")){await look(t);bot.activateItem();await sleep(100);bot.deactivateItem()}continue}
    if(decision.action==="totem"){await equip("totem");continue}
    if(decision.action==="shield_break"){await melee(t,"axe");continue}
    if(decision.action==="falling_crit"){await crit(t);continue}
    if(decision.action==="melee_attack"||decision.action==="finish"){await melee(t,decision.style||"sword");continue}
    if(decision.action==="mace_drop"||decision.action==="mace_dive"){await melee(t,"mace");continue}
    if(decision.action==="spear_pressure"){await melee(t,"spear");continue}
    if(decision.action==="ranged_attack"){await ranged(t,decision.style==="crossbow"?"crossbow":"bow");continue}
    if(decision.action==="approach"||decision.action==="mace_approach"){await approach(t);continue}
    if(decision.action==="strafe_pressure"||decision.action==="defensive_strafe"||decision.action==="reposition"||decision.action==="reacquire"||decision.action==="unstuck"){state.strafe*=-1;await strafe(t,state.strafe,decision.action==="defensive_strafe"?190:145);continue}
    if(decision.action==="jump_reset"){bot.setControlState("jump",true);await sleep(60);bot.setControlState("jump",false);continue}
    await sleep(80)
   }
   return false
  }catch(e){task.terminationReason="controller_error: "+String(e?.message||e);log("[PVP-EXPERT] ERROR "+task.terminationReason);return false}
  finally{state.active=false;stop()}
 };
 return {state,run,release:reason=>{state.active=false;state.terminationReason=reason;stop()},brain};
}
export default createPvpExpertController;
