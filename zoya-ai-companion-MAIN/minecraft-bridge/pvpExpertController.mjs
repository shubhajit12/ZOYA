/**
 * ZOYA Unified PvP Expert Controller v2.
 * Single physical combat authority. No training or adaptive learning.
 * Mineflayer 4.39.x / Minecraft 1.21.x baseline.
 */
import { createPvpExpertBrain } from "./pvpExpertBrain.mjs";
import { Vec3 } from "vec3";
import { THEO_PVP_DIFFICULTY } from "./pvpDifficulty.mjs";

const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,Number(ms)||0)));
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const lname=v=>String(v?.name||v?.displayName||"").toLowerCase();

const ITEMS=Object.freeze({
  sword:["netherite_sword","diamond_sword","iron_sword","stone_sword","golden_sword","wooden_sword"],
  axe:["netherite_axe","diamond_axe","iron_axe","stone_axe","golden_axe","wooden_axe"],
  mace:["mace"],
  spear:["netherite_spear","diamond_spear","iron_spear","stone_spear","golden_spear","wooden_spear","spear"],
  bow:["bow"], crossbow:["crossbow"], shield:["shield"], pearl:["ender_pearl"],
  totem:["totem_of_undying"], chestplate:["netherite_chestplate","diamond_chestplate","iron_chestplate","chainmail_chestplate","golden_chestplate","leather_chestplate","turtle_shell"], heal:["enchanted_golden_apple","golden_apple"],
  water:["water_bucket"], lava:["lava_bucket"], crystal:["end_crystal"], anchor:["respawn_anchor"],
  glowstone:["glowstone"], obsidian:["obsidian"], web:["cobweb"], shears:["shears"], wind:["wind_charge"],
  rod:["fishing_rod"], firework:["firework_rocket"], elytra:["elytra"],
  potion:["splash_potion","lingering_potion"]
});

function inv(bot){return bot.inventory?.items?.()||[]}
function item(bot,type){return inv(bot).find(i=>ITEMS[type]?.includes(lname(i)))||null}
function count(bot,type){return inv(bot).filter(i=>ITEMS[type]?.includes(lname(i))).reduce((n,i)=>n+num(i.count),0)}
function has(bot,type){return Boolean(item(bot,type))}
function dist(a,b){return a?.position&&b?.position?a.position.distanceTo(b.position):Infinity}
function targetOf(bot,u){
  const w=String(u||"").toLowerCase();
  return Object.values(bot.players||{}).find(p=>String(p?.username||"").toLowerCase()===w)?.entity||null;
}
function speed(e){return Math.hypot(num(e?.velocity?.x),num(e?.velocity?.z))}
function isAirborne(e){return e?.onGround===false}
function isElytraItem(i){return lname(i)==="elytra"}

export function estimateObservedFallDistance(entity, peakY) {
  const y=num(entity?.position?.y,0);
  return Math.max(0,num(entity?.fallDistance),num(peakY,y)-y);
}

// Pure spacing policy shared with deterministic tests. Never extends hit reach.
export function pressureOrbitMode(distance) {
  const d=Number(distance);
  if(!Number.isFinite(d)||d>3.0)return "approach";
  if(d<2.65)return "retreat";
  return "orbit";
}

export function isNewHitConfirmation(now, lastConfirmedAt, dedupeWindowMs=450) {
  return !Number.isFinite(Number(lastConfirmedAt)) || Number(now)-Number(lastConfirmedAt)>Math.max(0,Number(dedupeWindowMs)||0);
}

export function isHitConfirmed(hitsBefore,hitsAfter,healthBefore,healthAfter) {
  const hitCountIncreased=Number.isFinite(Number(hitsBefore))&&Number.isFinite(Number(hitsAfter))&&Number(hitsAfter)>Number(hitsBefore);
  const healthDropped=healthBefore!=null&&healthAfter!=null&&Number.isFinite(Number(healthBefore))&&Number.isFinite(Number(healthAfter))&&Number(healthAfter)<Number(healthBefore)-0.05;
  return hitCountIncreased||healthDropped;
}

export function shouldCountHealthDeltaHit(now, pendingEntityHitUntil, lastConfirmedAt, dedupeWindowMs=450) {
  return !(Number(pendingEntityHitUntil)>Number(now)) && isNewHitConfirmation(now,lastConfirmedAt,dedupeWindowMs);
}

export function shouldApplyFailedActionBackoff(action) {
  return !new Set(["emergency_disengage","emergency_hold","heal","totem","pearl_escape","pearl_recover","water_clutch","web_escape"]).has(String(action));
}

export function isConfirmedPearlTeleport(displacement, pearlStillExists, minimumDistance=4) {
  // Item activation or blast knockback alone is not a teleport confirmation.
  return Number(displacement)>Math.max(0,Number(minimumDistance)||0) && !Boolean(pearlStillExists);
}

export function isConfirmedPearlCatch(displaced, pearlStillExists) {
  return isConfirmedPearlTeleport(displaced?3.01:0,pearlStillExists,3);
}

export function isProjectileOnCollisionCourse(projectilePosition, projectileVelocity, playerPosition, playerVelocity={x:0,y:0,z:0}, radius=1.35, horizonTicks=16) {
  if(!projectilePosition||!playerPosition)return false;
  const n=(v)=>Number.isFinite(Number(v))?Number(v):0;
  const rx=n(projectilePosition.x)-n(playerPosition.x);
  const ry=n(projectilePosition.y)-n(playerPosition.y);
  const rz=n(projectilePosition.z)-n(playerPosition.z);
  const vx=n(projectileVelocity?.x)-n(playerVelocity?.x);
  const vy=n(projectileVelocity?.y)-n(playerVelocity?.y);
  const vz=n(projectileVelocity?.z)-n(playerVelocity?.z);
  const current=Math.hypot(rx,ry,rz);
  if(current<=radius)return true;
  const speed2=vx*vx+vy*vy+vz*vz;
  if(speed2<0.0025)return current<=2.5;
  const closestTick=-(rx*vx+ry*vy+rz*vz)/speed2;
  if(closestTick<0||closestTick>horizonTicks)return false;
  return Math.hypot(rx+vx*closestTick,ry+vy*closestTick,rz+vz*closestTick)<=radius;
}

export function createPvpExpertController({bot,goals,taskIsActive=()=>true,log=()=>{},difficulty=THEO_PVP_DIFFICULTY}={}){
  if(!bot) throw new Error("PvP Expert Controller requires bot");
  if(!goals?.GoalFollow) throw new Error("PvP Expert Controller requires verified GoalFollow.");

  const combatDifficulty=Object.freeze({...THEO_PVP_DIFFICULTY,...(difficulty||{})});
  const brain=createPvpExpertBrain({difficulty:combatDifficulty});
  const state={
    active:false,targetUsername:null,style:null,action:null,
    lastAttackAt:0,nextAttackAt:0,lastHealth:20,lastTargetHealth:null,lastTargetPos:null,
    strafe:1,attackCount:0,hits:0,damageDealt:0,damageTaken:0,
    terminationReason:null,lastDecisionLogAt:0,lastLoggedStyle:null,lastLoggedAction:null,
    failedAction:null,failedActionAt:0,elytraFlying:false,lastFireworkAt:0,
    lastProgressAt:0,lastProgressPos:null,lastTargetSeenAt:0,
    enemyTotemWasEquipped:false,enemyTotemPopUntil:0,
    failedActions:Object.create(null),failedActionUntil:0,
    committedStyle:null,styleCommitUntil:0,totemEquipped:false,
    lastPearlAt:0,pearlCooldownUntil:0,lastPearlType:null,pearlCatchCooldownUntil:0,maceEscapeCooldownUntil:0,emergencyRetreatUntil:0,spacingLockUntil:0,shieldCooldownUntil:0,
    lastAttackConfirmedAt:0,pendingEntityHitUntil:0,
    maceLaunchUntil:0,lastMaceSmashAt:0,lastJumpResetAt:0,lastTargetOnGround:null,targetLandedAt:0,
    lastAttackAttemptAt:0,lastAttackConfirmedAt:0,selfPeakY:null
  };

  const stop=()=>{
    try{bot.pathfinder?.setGoal?.(null)}catch{}
    try{bot.clearControlStates?.()}catch{}
    try{bot.deactivateItem?.()}catch{}
  };

  const waitForHitConfirmation=async(t,hitsBefore,healthBefore,timeout=280)=>{
    const deadline=Date.now()+Math.max(0,Number(timeout)||0);
    while(state.active&&taskIsActive()&&Date.now()<deadline){
      const healthAfter=t?.health!=null&&Number.isFinite(Number(t.health))?Number(t.health):null;
      if(isHitConfirmed(hitsBefore,state.hits,healthBefore,healthAfter))return true;
      await sleep(20);
    }
    const healthAfter=t?.health!=null&&Number.isFinite(Number(t.health))?Number(t.health):null;
    return isHitConfirmed(hitsBefore,state.hits,healthBefore,healthAfter);
  };

  const equip=async(type,destination="hand")=>{
    const i=item(bot,type);
    if(!i) return false;
    try{
      await bot.equip(i,destination);
      return true;
    }catch(error){
      log("[PVP-EXPERT] equip "+type+" failed: "+(error?.message||String(error)));
      return false;
    }
  };

  const hotbarSlot=type=>{
    const i=item(bot,type);
    return i&&Number.isInteger(i.slot)&&i.slot>=36&&i.slot<=44?i.slot-36:null;
  };
  const selectHotbarItem=type=>{
    const slot=hotbarSlot(type);
    if(slot==null||typeof bot.setQuickBarSlot!=="function")return false;
    try{bot.setQuickBarSlot(slot);return true}catch{return false}
  };

  const equipBestMelee=async(preferred=null)=>{
    const order=preferred?[preferred,"sword","axe","spear","mace"]:["sword","axe","spear","mace"];
    for(const type of [...new Set(order)]) if(has(bot,type)&&await equip(type)) return type;
    return null;
  };

  // Mineflayer entity velocity is measured per game tick, not per second.
  // Convert seconds-style lead values to ticks so prediction is meaningful
  // (0.10 s ~= 2 ticks) without extrapolating too far into the future.
  const lookAtTarget=async(t,lead=0.10)=>{
    if(!t?.position) return false;
    const v=t.velocity||{x:0,y:0,z:0};
    const leadTicks=Math.max(0,Math.min(4,num(lead)*20));
    const p=t.position.offset(num(v.x)*leadTicks,num(v.y)*leadTicks,num(v.z)*leadTicks);
    try{await bot.lookAt(p.offset(0,Math.max(.9,num(t.height,1.8)*.62),0),true);return true}catch{return false}
  };

  const approach=async(t,range=2.8)=>{
    if(!t||!goals?.GoalFollow) return false;
    if(dist(bot.entity,t)<=range) return true;
    try{
      bot.pathfinder.setGoal(new goals.GoalFollow(t,range),true);
      const targetSpeed=speed(t);
      const until=Date.now()+(targetSpeed>.35?1400:1100);
      const start=dist(bot.entity,t);
      while(state.active&&taskIsActive()&&Date.now()<until){
        if(dist(bot.entity,t)<=range) return true;
        await sleep(75);
      }
      const remaining=dist(bot.entity,t);
      // Starting a valid path and making progress is a successful navigation
      // action; do not mark it failed merely because 650 ms was not enough to
      // reach a moving player.
      return remaining<=start-0.35 || remaining<=range+0.5;
    }finally{
      try{bot.pathfinder.setGoal(null)}catch{}
    }
  };

  const strafe=async(t,sign,ms=Number(combatDifficulty.strafeMs||120))=>{
    await lookAtTarget(t,.10);
    bot.setControlState("forward",true);
    bot.setControlState(sign<0?"left":"right",true);
    bot.setControlState("sprint",true);
    await sleep(ms);
    stop();
    return true;
  };

  // Expert pressure orbits at sword spacing instead of blindly holding W.
  const pressureOrbit=async(t,sign,ms=Number(combatDifficulty.strafeMs||95))=>{
    if(!t?.position)return false;
    const until=Date.now()+Math.max(60,Number(ms)||95);
    try{
      while(state.active&&taskIsActive()&&Date.now()<until){
        const live=targetOf(bot,state.targetUsername)||t;
        if(!live?.position)break;
        const d=dist(bot.entity,live);
        const mode=pressureOrbitMode(d);
        await lookAtTarget(live,.10);
        bot.setControlState("left",sign<0);
        bot.setControlState("right",sign>0);
        if(mode==="approach"){
          bot.setControlState("back",false);
          bot.setControlState("forward",true);
          bot.setControlState("sprint",true);
        }else if(mode==="retreat"){
          bot.setControlState("forward",false);
          bot.setControlState("back",true);
          bot.setControlState("sprint",false);
        }else{
          // Between 2.65 and 3.0 blocks, strafe laterally without closing
          // distance; actual vanilla melee reach remains capped at 3.05 blocks.
          bot.setControlState("forward",false);
          bot.setControlState("back",false);
          bot.setControlState("sprint",false);
        }
        await sleep(25);
      }
      return true;
    }finally{stop();}
  };

  const emergencyDisengage=async t=>{
    if(!t)return false;
    const start=dist(bot.entity,t);
    const deadline=Date.now()+1100;
    try{
      bot.setControlState("back",true);
      bot.setControlState("sprint",true);
      bot.setControlState(state.strafe<0?"left":"right",true);
      while(state.active&&taskIsActive()&&Date.now()<deadline){
        const live=targetOf(bot,state.targetUsername)||t;
        if(live) await lookAtTarget(live,.05);
        const d=dist(bot.entity,live||t);
        if(d>=4.75) break;
        await sleep(35);
      }
    }finally{
      stop();
    }
    state.strafe*=-1;
    // Keep the emergency lock long enough to heal/escape; never let the next
    // brain tick immediately turn a retreat into a re-engagement.
    state.emergencyRetreatUntil=Date.now()+3200;
    return true;
  };

  const emergencyHold=async t=>{
    if(!t)return false;
    const deadline=Date.now()+260;
    try{
      while(state.active&&taskIsActive()&&Date.now()<deadline){
        const live=targetOf(bot,state.targetUsername)||t;
        if(live) await lookAtTarget(live,.05);
        const d=dist(bot.entity,live||t);
        // "Hold" is a safe-spacing state, not a stationary pause: maintain
        // a buffer so a moving opponent cannot simply walk back into melee.
        if(d>=6.25){stop();await sleep(90);return true;}
        bot.setControlState("back",true);
        bot.setControlState("sprint",true);
        bot.setControlState(state.strafe<0?"left":"right",true);
        await sleep(35);
      }
      return true;
    }finally{stop();}
  };

  const spacingRetreat=async t=>{
    if(!t)return false;
    const start=dist(bot.entity,t);
    const deadline=Date.now()+900;
    let separated=false;
    try{
      bot.setControlState("back",true);
      bot.setControlState("sprint",true);
      while(state.active&&taskIsActive()&&Date.now()<deadline){
        const live=targetOf(bot,state.targetUsername)||t;
        if(live) await lookAtTarget(live,.04);
        const d=dist(bot.entity,live||t);
        // Create a real buffer, not a one-tick step into attack range.
        if(d>=2.65||d>=start+0.8){separated=true;break;}
        await sleep(35);
      }
      separated=separated||dist(bot.entity,t)>=2.65||dist(bot.entity,t)>=start+0.8;
      state.spacingLockUntil=Date.now()+450;
      return separated;
    }finally{
      stop();
    }
  };

  const attack=async(t,type,maxReach)=>{
    if(!t||!await equip(type)) return false;
    const d=dist(bot.entity,t);
    if(d>maxReach){state.failedAction="attack_out_of_range";state.failedActionAt=Date.now();return false}
    await lookAtTarget(t,.05);
    const hitsBefore=state.hits;
    const targetHealthBefore=t.health!=null&&Number.isFinite(Number(t.health))?Number(t.health):null;
    bot.attack(t);
    // Respect Java attack-speed recovery instead of issuing sword-speed swings
    // with slow weapons. A mace smash is handled separately by its fall window.
    const cooldown=type==="spear"?900:type==="mace"?1667:type==="axe"?1000:625;
    state.lastAttackAt=Date.now();
    state.lastAttackAttemptAt=state.lastAttackAt;
    state.nextAttackAt=state.lastAttackAt+cooldown;
    state.attackCount++;
    log("[PVP-EXPERT] swing_issued weapon="+type+" distance="+d.toFixed(2)+"; awaiting server damage confirmation");
    await sprintReset(type);
    await sleep(55);
    const confirmed=await waitForHitConfirmation(t,hitsBefore,targetHealthBefore,280);
    if(!confirmed)log("[PVP-EXPERT] swing_unconfirmed weapon="+type+" target="+state.targetUsername+"; action will enter bounded backoff");
    return confirmed;
  };

  const fallingCrit=async t=>{
    if(!await equip("sword")) return false;
    if(dist(bot.entity,t)>3.05) return false;
    bot.setControlState("forward",true);
    bot.setControlState("sprint",true);
    bot.setControlState("jump",true);
    await sleep(75);
    bot.setControlState("jump",false);
    let peakY=num(bot.entity?.position?.y);
    const until=Date.now()+700;
    while(state.active&&taskIsActive()&&Date.now()<until){
      peakY=Math.max(peakY,num(bot.entity?.position?.y));
      if(isAirborne(bot.entity)&&num(bot.entity.velocity?.y)<-.05&&estimateObservedFallDistance(bot.entity,peakY)>=.45) break;
      await sleep(20);
    }
    peakY=Math.max(peakY,num(bot.entity?.position?.y));
    const valid=isAirborne(bot.entity)&&num(bot.entity.velocity?.y)<-.05&&estimateObservedFallDistance(bot.entity,peakY)>=.45&&dist(bot.entity,t)<=3.05;
    if(!valid){stop();return false}
    await lookAtTarget(t,.02);
    const hitsBefore=state.hits,targetHealthBefore=t.health!=null&&Number.isFinite(Number(t.health))?Number(t.health):null;
    bot.attack(t);state.lastAttackAt=Date.now();state.lastAttackAttemptAt=state.lastAttackAt;state.nextAttackAt=state.lastAttackAt+625;state.attackCount++;
    await sprintReset("sword");stop();
    return await waitForHitConfirmation(t,hitsBefore,targetHealthBefore,280);
  };

  const hitSelect=async t=>{
    if(!await equip("sword")) return false;
    bot.setControlState("sprint",true);
    bot.setControlState("forward",true);
    await sleep(45);
    if(dist(bot.entity,t)>3.05){await sprintReset();stop();return false}
    await lookAtTarget(t,.02);
    const hitsBefore=state.hits,targetHealthBefore=t.health!=null&&Number.isFinite(Number(t.health))?Number(t.health):null;
    bot.attack(t);state.lastAttackAt=Date.now();state.lastAttackAttemptAt=state.lastAttackAt;state.nextAttackAt=state.lastAttackAt+625;state.attackCount++;
    await sprintReset();
    bot.setControlState("sprint",false);
    const confirmed=await waitForHitConfirmation(t,hitsBefore,targetHealthBefore,280);
    if(!confirmed)log("[PVP-EXPERT] hit_select_unconfirmed target="+state.targetUsername);
    return confirmed;
  };

  const rod=async t=>{
    // Inventory aliases are centralized in ITEMS. The old "fishing_rod" key
    // did not exist, so this handler always returned false before equipping.
    if(!has(bot,"rod"))return false;
    if(!await equip("rod","hand"))return false;
    await lookAtTarget(t,.1);
    try{bot.activateItem();await sleep(180);bot.deactivateItem();return true}catch{return false}
  };

  const heal=async()=>{
    const i=item(bot,"heal"); if(!i)return false;
    stop();
    try{await bot.equip(i,"hand");await bot.consume();await equipBestMelee();return true}catch{return false}
  };

  const shield=async t=>{
    if(!has(bot,"shield")||Date.now()<state.shieldCooldownUntil)return false;
    if(!await equip("shield")) return false;
    try{
      if(t) await lookAtTarget(t,.02);
      bot.activateItem();
      await sleep(260);
      bot.deactivateItem();
      state.shieldCooldownUntil=Date.now()+850;
      // The shield is a timed defensive window, not a new permanent combat style.
      await equipBestMelee();
      log("[PVP-EXPERT] shield_block completed; melee weapon restored");
      return true;
    }catch{try{bot.deactivateItem()}catch{};state.shieldCooldownUntil=Date.now()+500;await equipBestMelee();return false}
  };

  const ranged=async(t,type)=>{
    if(!await equip(type)) return false;
    await lookAtTarget(t,.15);
    try{
      bot.activateItem();
      if(type==="bow") await sleep(1050); else await sleep(160);
      bot.deactivateItem();
      await sleep(90);
      return true;
    }catch{try{bot.deactivateItem()}catch{};return false}
  };

  const pearlBlockSafe=(block)=>{
    if(!block)return false;
    const n=String(block.name||"").toLowerCase();
    if(/lava|fire|campfire|magma|cactus|powder_snow/.test(n))return false;
    return block.boundingBox==="empty"||/air|water|grass|flower|snow|vine|torch|button|rail/.test(n);
  };

  const pearlDestination=(t,mode="escape")=>{
    const p=bot.entity?.position;
    if(!p)return null;
    const tp=t?.position||p;
    const dx=p.x-tp.x,dz=p.z-tp.z;
    const len=Math.hypot(dx,dz)||1;
    const awayX=dx/len,awayZ=dz/len;
    const sideX=-awayZ,sideZ=awayX;
    const candidates=[];
    const push=(x,z)=>candidates.push(new Vec3(x,p.y,z));
    if(mode==="ambush"||mode==="grapple"){
      const tx=(tp.x-p.x)/len,tz=(tp.z-p.z)/len;
      const ranges=mode==="grapple"?[9,11,13,15]:[5.5,7,8.5];
      for(const r of ranges){
        push(p.x+tx*r,p.z+tz*r);
        if(mode==="grapple"){
          push(p.x+tx*r+sideX*2.0,p.z+tz*r+sideZ*2.0);
          push(p.x+tx*r-sideX*2.0,p.z+tz*r-sideZ*2.0);
        }
      }
    }else{
      for(const r of [5.5,7,8.5,10]){
        if(mode==="diagonal_catch"){
          push(p.x+awayX*r+sideX*3.25,p.z+awayZ*r+sideZ*3.25);
          push(p.x+awayX*r-sideX*3.25,p.z+awayZ*r-sideZ*3.25);
        }else{
          push(p.x+awayX*r,p.z+awayZ*r);
          push(p.x+awayX*r+sideX*2.5,p.z+awayZ*r+sideZ*2.5);
          push(p.x+awayX*r-sideX*2.5,p.z+awayZ*r-sideZ*2.5);
        }
      }
    }
    for(const c of candidates){
      // The bot may be airborne/falling when it needs the pearl. Search a
      // bounded vertical band for a real two-block landing space with solid
      // support instead of requiring the current Y coordinate to be usable.
      for(const dy of [0,-1,-2,-3,-4,-5,1,2]){
        const y=c.y+dy;
        const feet=bot.blockAt(new Vec3(Math.floor(c.x),Math.floor(y),Math.floor(c.z)));
        const head=bot.blockAt(new Vec3(Math.floor(c.x),Math.floor(y+1),Math.floor(c.z)));
        const below=bot.blockAt(new Vec3(Math.floor(c.x),Math.floor(y-1),Math.floor(c.z)));
        if(!pearlBlockSafe(feet)||!pearlBlockSafe(head))continue;
        if(!below||below.boundingBox!=="block")continue;
        if(/lava|fire|magma|cactus|powder_snow/.test(String(below.name||"").toLowerCase()))continue;
        const landing=new Vec3(c.x,y,c.z);
        const d=landing.distanceTo(tp);
        if((mode==="escape"||mode==="diagonal_catch")&&d<3.5)continue;
        return landing.offset(.5,.35,.5);
      }
    }
    return null;
  };

  const pearlReady=(mode,t)=>{
    if(!has(bot,"pearl"))return false;
    if(Date.now()<state.pearlCooldownUntil)return false;
    return Boolean(pearlDestination(t,mode));
  };

  const throwPearl=async(t,mode="escape")=>{
    if(!t?.position||!bot.entity?.position)return false;
    if(Date.now()<state.pearlCooldownUntil)return false;
    const destination=pearlDestination(t,mode);
    if(!destination)return false;
    if(!await equip("pearl"))return false;
    const beforePos=bot.entity.position.clone();
    const beforePearls=new Set(Object.values(bot.entities||{}).filter(e=>/ender_pearl/.test(lname(e))).map(e=>e.id));
    try{
      await bot.lookAt(destination,true);
      bot.activateItem();
      await sleep(85);
      bot.deactivateItem();
      let pearl=null;
      const projectileDeadline=Date.now()+650;
      while(state.active&&taskIsActive()&&Date.now()<projectileDeadline&&!pearl){
        pearl=Object.values(bot.entities||{}).filter(e=>/ender_pearl/.test(lname(e))&&!beforePearls.has(e.id)&&e.position)
          .sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0]||null;
        if(!pearl)await sleep(20);
      }
      if(!pearl){
        log("[PVP-EXPERT] pearl_throw mode="+mode+" projectile_spawned=false teleport_confirmed=false");
        return false;
      }
      state.lastPearlAt=Date.now();
      state.pearlCooldownUntil=state.lastPearlAt+1000;
      state.lastPearlType=mode;
      const teleportDeadline=Date.now()+2200;
      let teleported=false;
      while(state.active&&taskIsActive()&&Date.now()<teleportDeadline){
        const displacement=bot.entity.position.distanceTo(beforePos);
        const stillExists=Boolean(bot.entities?.[pearl.id]);
        if(isConfirmedPearlTeleport(displacement,stillExists,4)){teleported=true;break}
        await sleep(25);
      }
      log("[PVP-EXPERT] pearl_throw mode="+mode+" projectile_spawned=true teleport_confirmed="+teleported);
      return teleported;
    }catch(error){
      try{bot.deactivateItem()}catch{}
      log("[PVP-EXPERT] pearl_throw mode="+mode+" failed: "+(error?.message||String(error)));
      return false;
    }
  };

  const webEscape=async()=>{
    if(!has(bot,"sword")&&!has(bot,"shears"))return false;
    const p=bot.entity?.position;
    if(!p)return false;
    const blocks=[
      bot.blockAt(p),
      bot.blockAt(p.offset(0,1,0)),
      bot.blockAt(p.offset(0,-1,0))
    ].filter(Boolean);
    const web=blocks.find(b=>String(b.name||"").toLowerCase()==="cobweb");
    if(!web)return false;
    try{
      if(has(bot,"sword")) await equip("sword");
      else await equip("shears");
      await bot.dig(web,true);
      return true;
    }catch{return false}
  };

  const projectileDodge=async t=>{
    if(!t)return false;
    state.strafe*=-1;
    await lookAtTarget(t,.12);
    bot.setControlState(state.strafe<0?"left":"right",true);
    bot.setControlState("forward",true);
    bot.setControlState("sprint",true);
    await sleep(210);
    stop();
    return true;
  };

  const useWaterClutch=async()=>{
    if(!await equip("water"))return false;
    const p=bot.entity?.position;if(!p)return false;
    try{
      const below=bot.blockAt(p.offset(0,-1,0));
      if(below&&!/air|water|lava/.test(String(below.name))) await bot.look(0,Math.PI/2,true);
      bot.activateItem();await sleep(100);bot.deactivateItem();
      return true;
    }catch{return false}
  };

  const detectEquipment=t=>{
    const eq=Array.isArray(t?.equipment)?t.equipment:[];
    const names=eq.map(lname);
    const held=eq[0]||null, off=eq[1]||null;
    return {
      shield:names.includes("shield")||lname(held)==="shield"||lname(off)==="shield",
      totem:names.includes("totem_of_undying")||lname(held)==="totem_of_undying"||lname(off)==="totem_of_undying",
      elytra:names.includes("elytra"),
      held:lname(held),offhand:lname(off)
    };
  };

  const projectileThreat=()=>{
    const p=bot.entity?.position;if(!p)return false;
    const playerVelocity=bot.entity?.velocity||{x:0,y:0,z:0};
    return Object.values(bot.entities||{}).some(e=>{
      if(!e?.position||e===bot.entity)return false;
      const n=String(e.name||"").toLowerCase();
      if(!/arrow|spectral_arrow|trident|fireball|small_fireball|wind_charge|snowball|egg/.test(n))return false;
      // Distance alone creates false alarms for projectiles flying away or
      // passing beside ZOYA. Predict relative-motion closest approach instead.
      return isProjectileOnCollisionCourse(e.position,e.velocity,p,playerVelocity,1.35,16);
    });
  };

  const hazard=()=>{
    const p=bot.entity?.position;if(!p)return false;
    const b=bot.blockAt(p), below=bot.blockAt(p.offset(0,-1,0));
    return /lava|fire|magma/.test(String(b?.name||""))||/lava|fire|magma/.test(String(below?.name||""));
  };

  const crystalBase=t=>{
    const tp=t?.position;if(!tp)return null;
    const ids=["obsidian","bedrock"].map(n=>bot.registry?.blocksByName?.[n]?.id).filter(Number.isInteger);
    if(!ids.length||typeof bot.findBlocks!=="function")return null;
    const positions=bot.findBlocks({matching:ids,maxDistance:6,count:40});
    let best=null,bestD=Infinity;
    for(const p of positions){
      const b=bot.blockAt(p);if(!b)continue;
      const d=p.distanceTo(tp);
      if(d<bestD&&p.y>=tp.y-2){best=b;bestD=d}
    }
    return best;
  };

  const crystalCycle=async t=>{
    if(!has(bot,"crystal")||!has(bot,"obsidian")||!bot.placeEntity)return false;
    const base=crystalBase(t);
    if(!base||dist(bot.entity,{position:base.position})>4.5)return false;
    const selfPos=bot.entity.position;
    const crystalPos=base.position.offset(.5,1,.5);
    const enemyDamage=typeof bot.getExplosionDamages==="function"?bot.getExplosionDamages(t,crystalPos,6,false):null;
    const selfDamage=typeof bot.getExplosionDamages==="function"?bot.getExplosionDamages(bot.entity,crystalPos,6,false):null;
    if(selfDamage!=null&&enemyDamage!=null&&selfDamage>Math.max(6,enemyDamage*.8))return false;
    await equip("crystal");
    try{
      await bot.placeEntity(base,new Vec3(0,1,0));
      await sleep(180);
      const crystals=Object.values(bot.entities||{}).filter(e=>String(e.name||"").toLowerCase()==="end_crystal"&&e.position.distanceTo(crystalPos)<1.4);
      const c=crystals.sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0];
      if(c){await equipBestMelee();await lookAtTarget(c,.0);bot.attack(c);await sleep(120);return true}
    }catch(error){log("[PVP-EXPERT] crystal cycle failed: "+(error?.message||String(error)));}
    return false;
  };

  const anchorCycle=async t=>{
    const dimension=String(bot.game?.dimension||"");
    // Respawn anchors explode in the Overworld and End, not in the Nether.
    if(!["overworld","the_end"].includes(dimension)||!has(bot,"anchor")||!has(bot,"glowstone")||!t?.position||typeof bot.placeBlock!=="function")return false;
    const target=t.position;
    if(typeof bot.canSeeEntity==="function"&&!bot.canSeeEntity(t))return false;
    // Treat exposure as 100% when checking our own safety: select only a
    // placement at least 7.5 blocks away, and only engage above safe HP.
    // This is deliberately conservative because vanilla Mineflayer does not
    // expose a dependable built-in explosion-damage estimator.
    if(num(bot.health,20)<10&&!state.totemEquipped)return false;
    const anchorId=bot.registry?.blocksByName?.respawn_anchor?.id;
    if(!Number.isInteger(anchorId))return false;
    const candidates=[];
    const getAnchorCharges=block=>Number(block?.getProperties?.()?.charges??block?.properties?.charges??0);
    const isSafeAir=block=>Boolean(block&&block.boundingBox==="empty"&&/^(air|cave_air|void_air)$/.test(String(block.name||"")));
    const consider=pos=>{
      const block=bot.blockAt(pos);
      if(!block||block.type!==anchorId)return;
      const blast=pos.offset(.5,.5,.5);
      const selfDistance=blast.distanceTo(bot.entity.position);
      const targetDistance=blast.distanceTo(target);
      if(selfDistance>=7.5&&targetDistance<=4.5)candidates.push({pos,block,selfDistance,targetDistance,existing:true});
    };
    if(typeof bot.findBlocks==="function"){
      for(const pos of bot.findBlocks({matching:anchorId,maxDistance:12,count:30}))consider(pos);
    }
    // If there is no suitable pre-placed anchor, find a safe supported floor
    // cell near the target and place one. Never place into occupied/unknown cells.
    if(!candidates.length){
      const tx=Math.floor(target.x),ty=Math.floor(target.y),tz=Math.floor(target.z);
      for(let dy=-2;dy<=0;dy++)for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++){
        const supportPos=new Vec3(tx+dx,ty+dy-1,tz+dz);
        const support=bot.blockAt(supportPos);
        const anchorPos=supportPos.offset(0,1,0);
        const cell=bot.blockAt(anchorPos),head=bot.blockAt(anchorPos.offset(0,1,0));
        if(!support||support.boundingBox!=="block"||!isSafeAir(cell)||!isSafeAir(head))continue;
        const blast=anchorPos.offset(.5,.5,.5);
        const selfDistance=blast.distanceTo(bot.entity.position),targetDistance=blast.distanceTo(target);
        if(selfDistance<7.5||targetDistance>4.5||targetDistance<1.5)continue;
        candidates.push({pos:anchorPos,block:support,support,selfDistance,targetDistance,existing:false});
      }
    }
    candidates.sort((a,b)=>a.targetDistance-b.targetDistance||b.selfDistance-a.selfDistance);
    const chosen=candidates[0];
    if(!chosen)return false;
    try{
      if(!chosen.existing){
        if(!await equip("anchor"))return false;
        await bot.placeBlock(chosen.support,new Vec3(0,1,0));
        await sleep(120);
      }
      let anchor=bot.blockAt(chosen.pos);
      if(!anchor||anchor.name!=="respawn_anchor")return false;
      let charges=getAnchorCharges(anchor);
      if(charges<1){
        if(!await equip("glowstone"))return false;
        await bot.activateBlock(anchor);
        await sleep(120);
        anchor=bot.blockAt(chosen.pos);
        charges=getAnchorCharges(anchor);
      }
      if(!anchor||anchor.name!=="respawn_anchor"||charges<1)return false;
      // Recheck the live geometry before detonating: target movement or our own
      // movement during placement can invalidate the original safe-distance gate.
      const blast=chosen.pos.offset(.5,.5,.5);
      if(blast.distanceTo(bot.entity.position)<7.5||blast.distanceTo((targetOf(bot,state.targetUsername)||t).position)>4.5)return false;
      const liveTarget=targetOf(bot,state.targetUsername)||t;
      const targetHealthBefore=Number.isFinite(Number(liveTarget.health))?Number(liveTarget.health):null;
      const selfHealthBefore=num(bot.health,20);
      try{await bot.unequip("hand")}catch{}
      await bot.activateBlock(anchor);
      await sleep(350);
      const targetHealthAfter=Number.isFinite(Number(liveTarget.health))?Number(liveTarget.health):null;
      const targetDamaged=targetHealthBefore!=null&&targetHealthAfter!=null&&targetHealthAfter<targetHealthBefore;
      const selfDamaged=num(bot.health,20)<selfHealthBefore;
      const exploded=bot.blockAt(chosen.pos)?.name!=="respawn_anchor";
      const confirmed=exploded&&(targetDamaged||selfDamaged);
      log("[PVP-EXPERT] anchor_detonation_confirmed="+confirmed+" target_damage_observed="+targetDamaged+" self_damage_observed="+selfDamaged+" self_distance="+blast.distanceTo(bot.entity.position).toFixed(2));
      await equipBestMelee();
      return confirmed;
    }catch(error){
      log("[PVP-EXPERT] anchor cycle failed: "+(error?.message||String(error)));
      await equipBestMelee();
      return false;
    }
  };
  const spearCharge=async t=>{
    if(!await equip("spear"))return false;
    const d=dist(bot.entity,t);
    if(d<2.0||d>4.75)return false;
    await lookAtTarget(t,.12);
    try{
      bot.activateItem();
      const until=Date.now()+950;
      const hitsBefore=state.hits;
      let enteredRange=false;
      while(state.active&&taskIsActive()&&Date.now()<until){
        const live=targetOf(bot,state.targetUsername)||t;
        if(!live)break;
        await lookAtTarget(live,.08);
        const nd=dist(bot.entity,live);
        bot.setControlState("forward",true);
        bot.setControlState("sprint",true);
        if(nd<=4.75&&nd>=2.0){
          // Being inside the nominal spear range is only an attempt, not a
          // confirmed hit. Mineflayer's entityHurt event verifies contact.
          state.lastAttackAttemptAt=Date.now();
          enteredRange=true;
        }
        await sleep(35);
        if(enteredRange&&nd<2.0)break;
      }
      bot.deactivateItem();
      stop();
      if(enteredRange){
        state.lastAttackAt=Date.now();
        state.nextAttackAt=state.lastAttackAt+900;
        await sprintReset("spear");
        await sleep(110);
      }
      return state.hits>hitsBefore;
    }catch(error){
      try{bot.deactivateItem()}catch{}
      stop();
      return false;
    }
  };


  // Pearl catching is the actual wind-charge/pearl combo: self-launch,
  // throw a high pearl, then hit the pearl with a second wind charge to teleport
  // to it and gain a fast aerial mace window. It is not an ordinary escape pearl.
  const pearlCatch=async(t,diagonal=false)=>{
    if(!t?.position||!has(bot,"pearl")||!has(bot,"mace")||count(bot,"wind")<2||!bot.entity?.position)return false;
    if(Date.now()<num(state.pearlCatchCooldownUntil))return false;
    state.pearlCatchCooldownUntil=Date.now()+1200;
    const p=bot.entity.position,tp=t.position;
    const dx=p.x-tp.x,dz=p.z-tp.z,len=Math.hypot(dx,dz)||1;
    const awayX=dx/len,awayZ=dz/len,sideX=-awayZ,sideZ=awayX;
    const before=new Set(Object.values(bot.entities||{}).filter(e=>/ender_pearl/.test(lname(e))).map(e=>e.id));
    const startY=num(p.y);
    try{
      // Launch off the ground with the first wind charge.
      if(bot.entity?.onGround===false)return false;
      bot.setControlState("jump",true);
      await sleep(55);
      bot.setControlState("jump",false);
      if(!await equip("wind"))return false;
      await bot.lookAt(p.offset(0,-1.25,0),true);
      bot.activateItem();await sleep(65);bot.deactivateItem();
      let launched=false;
      const launchUntil=Date.now()+650;
      while(state.active&&taskIsActive()&&Date.now()<launchUntil){
        if(num(bot.entity?.position?.y)-startY>=.25&&num(bot.entity?.velocity?.y)>.12){launched=true;break}
        await sleep(20);
      }
      if(!launched)return false;

      // Throw high; the diagonal variant adds a lateral vector so the pearl
      // travels across the opponent's line instead of straight up their axis.
      if(!await equip("pearl"))return false;
      const hx=diagonal?(awayX*3.0+sideX*5.0):awayX*2.0;
      const hz=diagonal?(awayZ*3.0+sideZ*5.0):awayZ*2.0;
      await bot.lookAt(new Vec3(p.x+hx,p.y+17,p.z+hz),true);
      bot.activateItem();await sleep(65);bot.deactivateItem();
      state.lastPearlAt=Date.now();state.pearlCooldownUntil=state.lastPearlAt+1000;state.lastPearlType=diagonal?"diagonal_catch":"catch";
      state.pearlCatchCooldownUntil=Date.now()+3500;

      let pearl=null;
      const pearlUntil=Date.now()+600;
      while(state.active&&taskIsActive()&&Date.now()<pearlUntil&&!pearl){
        pearl=Object.values(bot.entities||{}).filter(e=>/ender_pearl/.test(lname(e))&&!before.has(e.id)&&e.position)
          .sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0]||null;
        if(!pearl)await sleep(20);
      }
      if(!pearl)return false;

      // Use the second charge to collide with the live pearl projectile.
      if(!await equip("wind"))return false;
      const v=pearl.velocity||{x:0,y:0,z:0};
      await bot.lookAt(pearl.position.offset(num(v.x)*3,num(v.y)*3,num(v.z)*3),true);
      const beforePos=bot.entity.position.clone();
      bot.activateItem();await sleep(65);bot.deactivateItem();
      const catchUntil=Date.now()+1200;
      let caught=false;
      while(state.active&&taskIsActive()&&Date.now()<catchUntil){
        const pearlStillExists=Boolean(bot.entities?.[pearl.id]);
        const displaced=bot.entity.position.distanceTo(beforePos)>3.0;
        if(isConfirmedPearlCatch(displaced,pearlStillExists)){caught=true;break}
        await sleep(25);
      }
      state.pearlCatchCooldownUntil=Date.now()+3500;
      await equipBestMelee();
      log("[PVP-EXPERT] pearl_catch mode="+(diagonal?"diagonal":"standard")+" pearl_found=true pearl_removed="+(!bot.entities?.[pearl.id])+" teleport_confirmed="+caught);
      if(caught&&has(bot,"mace")){
        await sleep(80);
        await maceSmash(t);
      }
      return caught;
    }catch(error){
      log("[PVP-EXPERT] pearl_catch failed: "+(error?.message||String(error)));
      try{bot.deactivateItem()}catch{}
      stop();
      await equipBestMelee();
      return false;
    }finally{
      try{bot.setControlState("jump",false)}catch{}
    }
  };

  // Opponent-targeted wind charge is separate from the self-launch mace combo.
  const windChargeCancel=async t=>{
    if(!t?.position||!has(bot,"wind")||!isAirborne(t))return false;
    const d=dist(bot.entity,t);
    if(d<3.0||d>7.0)return false;
    if(!await equip("wind"))return false;
    try{
      await lookAtTarget(t,.02);
      bot.activateItem();
      await sleep(70);
      bot.deactivateItem();
      await sleep(90);
      await equipBestMelee();
      log("[PVP-EXPERT] wind_charge_cancel issued target_airborne=true distance="+d.toFixed(2));
      return true;
    }catch{
      try{bot.deactivateItem()}catch{}
      await equipBestMelee();
      return false;
    }
  };

  // Drain a raised shield with bounded axe pressure, then return to sword when
  // equipment metadata indicates the shield is no longer being used.
  const shieldDrain=async t=>{
    if(!t?.position||!has(bot,"axe"))return false;
    const until=Date.now()+2300;
    let swings=0;
    while(state.active&&taskIsActive()&&Date.now()<until&&swings<2){
      const live=targetOf(bot,state.targetUsername)||t;
      if(!live?.position||dist(bot.entity,live)>3.2)break;
      const held=lname(live.equipment?.[0]||live.heldItem||"");
      const using=Boolean(live.isUsingItem||live.metadata?.isUsingItem);
      if(!/shield/.test(held)&&!using)break;
      if(Date.now()>=state.nextAttackAt){
        if(!await attack(live,"axe",3.2))break;
        swings++;
      }
      await sleep(75);
    }
    const live=targetOf(bot,state.targetUsername)||t;
    const held=lname(live?.equipment?.[0]||live?.heldItem||"");
    if(has(bot,"sword")&&dist(bot.entity,live)<=3.05&&(!/shield/.test(held)||!Boolean(live?.isUsingItem))){
      await sleep(80);
      if(Date.now()>=state.nextAttackAt)await attack(live,"sword",3.05);
    }
    await equipBestMelee(has(bot,"sword")?"sword":"axe");
    return swings>0;
  };

  // Only call this a backstab when the target-facing vector confirms the bot
  // is behind the opponent; otherwise fail safely after a short flank attempt.
  const backstab=async t=>{
    if(!t?.position||!has(bot,"sword")||dist(bot.entity,t)>5.5)return false;
    const deadline=Date.now()+620;
    while(state.active&&taskIsActive()&&Date.now()<deadline){
      const live=targetOf(bot,state.targetUsername)||t;
      if(!live?.position)break;
      await lookAtTarget(live,.04);
      const yaw=num(live.yaw);
      const fx=-Math.sin(yaw),fz=Math.cos(yaw);
      const dx=num(bot.entity?.position?.x)-num(live.position.x);
      const dz=num(bot.entity?.position?.z)-num(live.position.z);
      const len=Math.hypot(dx,dz)||1;
      const behind=(fx*dx+fz*dz)/len<-.52;
      const d=dist(bot.entity,live);
      if(behind&&d<=3.05&&d>=2.15){
        stop();
        return await attack(live,"sword",3.05);
      }
      bot.setControlState("forward",false);
      bot.setControlState("back",false);
      bot.setControlState(state.strafe<0?"left":"right",true);
      bot.setControlState("sprint",d>3.2);
      await sleep(45);
    }
    stop();
    return false;
  };

  // Attribute-swap mace D-tap: keep the fast sword selected during setup,
  // equip mace only at the verified falling hit window, then restore sword
  // immediately after the server receives the mace attack.
  const maceAttributeSwap=async t=>{
    if(!t?.position||!has(bot,"sword")||!has(bot,"mace")||!isAirborne(bot.entity))return false;
    // Last-tick attribute swaps require both weapons on the hotbar; inventory
    // transfers during the fall window are too slow and are rejected safely.
    if(hotbarSlot("sword")==null||hotbarSlot("mace")==null)return false;
    if(!selectHotbarItem("sword"))return false;
    const deadline=Date.now()+900;
    let peakY=Math.max(num(bot.entity?.position?.y),num(state.selfPeakY,bot.entity?.position?.y));
    while(state.active&&taskIsActive()&&Date.now()<deadline){
      const live=targetOf(bot,state.targetUsername)||t;
      if(!live?.position)break;
      peakY=Math.max(peakY,num(bot.entity?.position?.y));
      const d=dist(bot.entity,live);
      const fall=estimateObservedFallDistance(bot.entity,peakY);
      const vy=num(bot.entity?.velocity?.y);
      await lookAtTarget(live,.02);
      if(vy<-.08&&fall>1.5&&d>=2.35&&d<=3.1){
        // Last-moment swap: do not carry mace throughout the whole setup.
        if(!selectHotbarItem("mace"))return false;
        const finalD=dist(bot.entity,live);
        if(!isAirborne(bot.entity)||num(bot.entity?.velocity?.y)>=-.04||finalD>3.1||finalD<2.25){
          selectHotbarItem("sword");
          return false;
        }
        const hitsBefore=state.hits,targetHealthBefore=live.health!=null&&Number.isFinite(Number(live.health))?Number(live.health):null;
        bot.attack(live);
        state.lastAttackAt=Date.now();state.lastAttackAttemptAt=state.lastAttackAt;
        state.nextAttackAt=state.lastAttackAt+1667;state.attackCount++;
        state.lastMaceSmashAt=Date.now();
        selectHotbarItem("sword");
        log("[PVP-EXPERT] mace_attribute_swap issued sword_setup=true mace_impact=true sword_restored=true distance="+finalD.toFixed(2)+" fall="+fall.toFixed(2));
        await sprintReset("sword");
        const confirmed=await waitForHitConfirmation(live,hitsBefore,targetHealthBefore,280);
        log("[PVP-EXPERT] mace_attribute_swap confirmed="+confirmed);
        return confirmed;
      }
      if(d>3.1){
        bot.setControlState("forward",true);bot.setControlState("sprint",true);
      }else if(d<2.35){
        bot.setControlState("forward",false);bot.setControlState("back",true);bot.setControlState("sprint",false);
      }else{
        bot.setControlState("forward",false);bot.setControlState("back",false);bot.setControlState("sprint",false);
      }
      await sleep(20);
    }
    stop();
    selectHotbarItem("sword");
    return false;
  };

  // Stun-slam: only attempts the axe stun + mace impact when already falling
  // through a real smash window and the target is visibly using a shield.
  const stunSlam=async t=>{
    if(!t?.position||!isAirborne(bot.entity)||!has(bot,"axe")||!has(bot,"mace"))return false;
    if(hotbarSlot("axe")==null||hotbarSlot("mace")==null)return false;
    const held=lname(t.equipment?.[0]||t.heldItem||"");
    if(!/shield/.test(held)||!Boolean(t.isUsingItem||t.metadata?.isUsingItem))return false;
    const d=dist(bot.entity,t);
    if(d<2.25||d>3.2||num(bot.entity?.velocity?.y)>=-.08||estimateObservedFallDistance(bot.entity,state.selfPeakY)<=1.5)return false;
    if(num(state.nextAttackAt)>Date.now())return false;
    const originalSlot=Number.isInteger(bot.quickBarSlot)?bot.quickBarSlot:null;
    const hitsBefore=state.hits,targetHealthBefore=t.health!=null&&Number.isFinite(Number(t.health))?Number(t.health):null;
    // Packet sequence is deliberately synchronous: axe hit, hotbar swap,
    // mace hit, all within one client tick when both items are already hotbar.
    if(!selectHotbarItem("axe"))return false;
    await lookAtTarget(t,.0);
    bot.attack(t);
    state.lastAttackAt=Date.now();state.lastAttackAttemptAt=state.lastAttackAt;
    state.nextAttackAt=state.lastAttackAt+1667;state.attackCount++;
    if(!selectHotbarItem("mace"))return false;
    bot.attack(t);
    state.lastAttackAt=Date.now();state.lastAttackAttemptAt=state.lastAttackAt;
    state.nextAttackAt=state.lastAttackAt+1667;state.attackCount++;
    await sleep(40);
    if(originalSlot!=null)try{bot.setQuickBarSlot(originalSlot)}catch{}
    const confirmed=await waitForHitConfirmation(t,hitsBefore,targetHealthBefore,280);
    log("[PVP-EXPERT] stun_slam packet_sequence=axe_then_mace same_tick=true confirmed="+confirmed);
    return confirmed;
  };

  // Mid-air wind-charge reset: use a downward charge to brake a dangerous
  // descent, preserve the observed apex/fall estimate, then re-enter the mace
  // impact window only if the game actually changes vertical velocity.
  const windChargeReset=async t=>{
    if(!t?.position||!has(bot,"wind")||!has(bot,"mace")||!isAirborne(bot.entity))return false;
    const d=dist(bot.entity,t),vy0=num(bot.entity?.velocity?.y);
    const fall0=estimateObservedFallDistance(bot.entity,state.selfPeakY);
    if(d<2.25||d>3.25||vy0>=-.25||fall0<=1.5||!await equip("wind"))return false;
    const peak=num(state.selfPeakY,num(bot.entity?.position?.y)+fall0);
    try{
      await bot.lookAt(bot.entity.position.offset(0,-8,0),true);
      bot.activateItem();await sleep(65);bot.deactivateItem();
      const until=Date.now()+420;
      let resetObserved=false;
      while(state.active&&taskIsActive()&&Date.now()<until){
        const vy=num(bot.entity?.velocity?.y);
        if(vy>vy0+.22||vy>-.08){resetObserved=true;break}
        await sleep(20);
      }
      const retainedFall=Math.max(fall0,estimateObservedFallDistance(bot.entity,peak));
      if(!resetObserved){
        log("[PVP-EXPERT] wind_charge_reset unavailable; preserve ordinary mace descent");
        return await maceSmash(t,retainedFall);
      }
      const relaunchUntil=Date.now()+850;
      while(state.active&&taskIsActive()&&Date.now()<relaunchUntil){
        const live=targetOf(bot,state.targetUsername)||t;
        if(!live?.position)break;
        const fall=estimateObservedFallDistance(bot.entity,peak);
        const vy=num(bot.entity?.velocity?.y);
        const nd=dist(bot.entity,live);
        await lookAtTarget(live,.02);
        if(isAirborne(bot.entity)&&vy<-.08&&fall>1.5&&nd>=2.25&&nd<=3.1){
          log("[PVP-EXPERT] wind_charge_reset observed=true fall_retained="+fall.toFixed(2));
          return await maceSmash(live,fall);
        }
        await sleep(20);
      }
      stop();
      return false;
    }catch{
      try{bot.deactivateItem()}catch{}
      stop();
      return false;
    }
  };

  // Mace D-tap: first land the falling mace hit, then immediately execute
  // the safe crystal follow-up on a validated nearby obsidian base.
  const maceDTap=async t=>{
    if(!t?.position||!has(bot,"mace")||!has(bot,"crystal")||!has(bot,"obsidian")||!crystalBase(t))return false;
    const fall=estimateObservedFallDistance(bot.entity,state.selfPeakY);
    const smashed=await maceSmash(t,fall,45);
    if(!smashed)return false;
    const live=targetOf(bot,state.targetUsername)||t;
    if(!live?.position||dist(bot.entity,live)>5||!crystalBase(live))return true;
    await sleep(35);
    const crystalHit=await crystalCycle(live);
    log("[PVP-EXPERT] mace_d_tap mace_attempt=true crystal_followup="+crystalHit);
    return crystalHit;
  };

  const maceSmash=async(t,priorFallDistance=0,settleMs=180)=>{
    if(!t||!has(bot,"mace"))return false;
    if(!await equip("mace"))return false;
    const until=Date.now()+900;
    let peakY=num(bot.entity?.position?.y)+Math.max(0,num(priorFallDistance));
    while(state.active&&taskIsActive()&&Date.now()<until){
      const live=targetOf(bot,state.targetUsername)||t;
      if(!live)break;
      const d=dist(bot.entity,live);
      peakY=Math.max(peakY,num(bot.entity?.position?.y));
      const falling=isAirborne(bot.entity)&&num(bot.entity?.velocity?.y)<-.08;
      const fallDistance=estimateObservedFallDistance(bot.entity,peakY);
      await lookAtTarget(live,.02);
      if(falling&&fallDistance>1.5&&d>=2.35&&d<=3.1){
        stop();
        const hitsBefore=state.hits;
        const targetHealthBefore=live.health!=null&&Number.isFinite(Number(live.health))?Number(live.health):null;
        bot.attack(live);
        state.lastAttackAt=Date.now();
        state.lastAttackAttemptAt=state.lastAttackAt;
        state.nextAttackAt=state.lastAttackAt+1667;
        state.lastMaceSmashAt=Date.now();
        state.attackCount++;
        log("[PVP-EXPERT] mace_smash_issued distance="+d.toFixed(2)+" fall="+fallDistance.toFixed(2)+"; awaiting server damage confirmation");
        await sleep(settleMs);
        const confirmed=await waitForHitConfirmation(live,hitsBefore,targetHealthBefore,280);
        log("[PVP-EXPERT] mace_smash_confirmed="+confirmed);
        return confirmed;
      }
      // Keep the target in the real smash window. Forward-only steering was
      // the source of the launch overshoot; brake/backpedal when too close.
      if(falling&&d>3.1){
        bot.setControlState("back",false);
        bot.setControlState("forward",true);
        bot.setControlState("sprint",true);
      }else if(d<2.35){
        bot.setControlState("forward",false);
        bot.setControlState("back",true);
        bot.setControlState("sprint",false);
      }else{
        bot.setControlState("forward",false);
        bot.setControlState("back",false);
        bot.setControlState("sprint",false);
      }
      await sleep(25);
    }
    stop();
    return false;
  };

  const wind=async t=>{
    if(!t||!await equip("wind"))return false;
    const initialDistance=dist(bot.entity,t);
    if(initialDistance<3.5||initialDistance>6.5)return false;
    try{
      // Wind Charge has two distinct tactical jobs. This action is ONLY the
      // self-launch half of the mace combo: never aim it at the opponent.
      const startY=num(bot.entity?.position?.y);
      let peakY=startY;
      const launchDeadline=Date.now()+1050;
      await bot.lookAt(bot.entity.position.offset(0,-1.35,0),true);
      bot.activateItem();
      await sleep(70);
      bot.deactivateItem();

      // Verify an actual self-launch, not merely a tiny velocity change.
      let launched=false;
      while(state.active&&taskIsActive()&&Date.now()<launchDeadline){
        const liveY=num(bot.entity?.position?.y);
        peakY=Math.max(peakY,liveY);
        const vy=num(bot.entity?.velocity?.y);
        if(liveY-startY>=0.28&&vy>0.22){
          launched=true;
          break;
        }
        await sleep(25);
      }
      if(!launched){
        stop();
        return false;
      }

      state.maceLaunchUntil=Date.now()+2800;

      // The launch itself supplies the vertical impulse. Do not hold forward
      // throughout ascent/descent: that drove ZOYA past the target by 7-10m.
      // During descent, steer only when outside the smash window and brake if
      // too close; swing only after the real falling-distance gate is met.
      const smashDeadline=state.maceLaunchUntil;
      while(state.active&&taskIsActive()&&Date.now()<smashDeadline){
        const live=targetOf(bot,state.targetUsername)||t;
        if(!live)break;
        const d=dist(bot.entity,live);
        const vy=num(bot.entity?.velocity?.y);
        peakY=Math.max(peakY,num(bot.entity?.position?.y));
        const fallDistance=estimateObservedFallDistance(bot.entity,peakY);
        await lookAtTarget(live,.04);
        if(isAirborne(bot.entity)&&vy<-.08){
          if(fallDistance>1.5&&d>=2.35&&d<=3.1){
            stop();
            return await maceSmash(live,fallDistance);
          }
          if(d>3.1){
            bot.setControlState("back",false);
            bot.setControlState("forward",true);
            bot.setControlState("sprint",true);
          }else if(d<2.35){
            bot.setControlState("forward",false);
            bot.setControlState("back",true);
            bot.setControlState("sprint",false);
          }else{
            bot.setControlState("forward",false);
            bot.setControlState("back",false);
            bot.setControlState("sprint",false);
          }
        }else{
          bot.setControlState("forward",false);
          bot.setControlState("back",false);
          bot.setControlState("sprint",false);
        }
        await sleep(25);
      }
      stop();
      return false;
    }catch{
      try{bot.deactivateItem()}catch{}
      stop();
      return false;
    }
  };

  const dodge=async t=>{
    state.strafe*=-1;
    return strafe(t,state.strafe,190);
  };

  const waterRecover=async()=>useWaterClutch();

  const fireworkBoost=async()=>{
    if(!has(bot,"firework"))return false;
    // Never replace an off-hand totem with a firework during Elytra combat.
    // Fireworks can be launched from the main hand; restore the melee weapon
    // immediately after the short boost input.
    if(!await equip("firework","hand"))return false;
    try{
      bot.activateItem();
      await sleep(90);
      bot.deactivateItem();
      await equipBestMelee();
      return true;
    }catch{
      try{bot.deactivateItem()}catch{}
      await equipBestMelee();
      return false;
    }
  };

  const sprintReset=async(type="auto")=>{
    try{
      // W/S taps must be mutually exclusive. Holding forward and back together
      // cancels the intended reset and produces the close-range oscillation
      // seen in live logs.
      const useSTap=Boolean(combatDifficulty.sTap&&(
        // Alternate W-tap and S-tap rhythms; a confirmed hit can bias the
        // immediate next reset toward S-tap to preserve combo spacing.
        state.attackCount%2===0 ||
        (state.lastAttackConfirmedAt>0&&Date.now()-state.lastAttackConfirmedAt<220)
      ));
      bot.setControlState("sprint",false);
      bot.setControlState("forward",false);
      if(useSTap){
        bot.setControlState("back",true);
        await sleep(Math.max(55,Number(combatDifficulty.sprintResetMs||82)-10));
        bot.setControlState("back",false);
      }else if(combatDifficulty.wTap!==false){
        // Release W briefly to reset sprint, then re-enter with sprint.
        await sleep(Math.max(45,Math.min(75,Number(combatDifficulty.sprintResetMs||82)-12)));
      }else{
        await sleep(Number(combatDifficulty.sprintResetMs||82));
      }
      bot.setControlState("forward",true);
      bot.setControlState("sprint",true);
    }catch{
      try{bot.setControlState("back",false);bot.setControlState("forward",true);bot.setControlState("sprint",true)}catch{}
    }
  };

  const elytraMace=async t=>{
    if(!has(bot,"elytra")||!has(bot,"mace"))return false;
    // Always restore the flight chest item on every exit path, including exceptions.
    const restoreElytra=async()=>{
      if(has(bot,"elytra")&&num(bot.health,20)>0){
        try{await equip("elytra","torso");log("[PVP-EXPERT] elytra_preserved_and_restored")}catch{}
      }
    };
    // Vanilla does not allow gliding down onto a target with an Elytra.
    // Use the Elytra only to gain altitude, then remove it before the smash.
    try{
      stop();
      if(!await equip("elytra","torso"))return false;
      await lookAtTarget(t,.25);
      bot.setControlState("jump",true);
      await sleep(140);
      bot.setControlState("jump",false);
      const flyUntil=Date.now()+1200;
      while(state.active&&taskIsActive()&&Date.now()<flyUntil){
        if(bot.entity?.elytraFlying||state.elytraFlying)break;
        await sleep(25);
      }
      if(!(bot.entity?.elytraFlying||state.elytraFlying)){
        try{await bot.elytraFly()}catch{}
      }
      if(!(bot.entity?.elytraFlying||state.elytraFlying)){
        noteFailure?.("elytra_mace","flight_not_started");
        return false;
      }

      const targetY=num(t.position?.y);
      const climbUntil=Date.now()+2500;
      while(state.active&&taskIsActive()&&Date.now()<climbUntil){
        const live=targetOf(bot,state.targetUsername)||t;
        if(!live)break;
        await lookAtTarget(live,.4);
        bot.setControlState("forward",true);
        bot.setControlState("sprint",true);
        const y=num(bot.entity?.position?.y);
        if(y>=targetY+7)break;
        if(has(bot,"firework")&&Date.now()-state.lastFireworkAt>900){
          if(await fireworkBoost())state.lastFireworkAt=Date.now();
        }
        await sleep(60);
      }
      stop();

      // Vanilla mace smash requires leaving Elytra glide before impact.
      // Actually swap the torso slot (the previous code only changed the hand,
      // leaving Elytra equipped and making the advertised swap a no-op).
      if(has(bot,"chestplate")){
        if(!await equip("chestplate","torso"))return false;
      }else{
        try{await bot.unequip("torso")}catch{return false}
      }
      if(!await equip("mace","hand")){await restoreElytra();return false}

      const diveUntil=Date.now()+1800;
      while(state.active&&taskIsActive()&&Date.now()<diveUntil){
        const live=targetOf(bot,state.targetUsername)||t;
        if(!live)break;
        const d=dist(bot.entity,live);
        const vy=num(bot.entity?.velocity?.y);
        const y=num(bot.entity?.position?.y);
        await lookAtTarget(live,.0);
        // Keep moving toward the target while descending. Do not attack until
        // the target is within real mace hit range and the bot is falling.
        bot.setControlState("forward",true);
        if(d<=3.05&&vy<-.12&&y>num(live.position?.y)+.3){
          const enemyHeld=lname(live.equipment?.[0]||live.heldItem||"");
          const enemyShielding=/shield/.test(enemyHeld)&&Boolean(live.isUsingItem||live.metadata?.isUsingItem);
          if(enemyShielding&&has(bot,"axe")&&hotbarSlot("axe")!=null&&hotbarSlot("mace")!=null){
            // Elytra stun-slam uses the same synchronous axe→mace hotbar
            // packet sequence; never pretend a slow inventory transfer is a stun.
            const originalSlot=Number.isInteger(bot.quickBarSlot)?bot.quickBarSlot:null;
            if(selectHotbarItem("axe")){bot.attack(live);selectHotbarItem("mace");bot.attack(live)}
            else bot.attack(live);
            if(originalSlot!=null)try{bot.setQuickBarSlot(originalSlot)}catch{}
          }else{
            bot.attack(live);
          }
          state.lastAttackAt=Date.now();
          state.lastAttackAttemptAt=state.lastAttackAt;
          state.nextAttackAt=state.lastAttackAt+1667;
          state.attackCount++;
          log("[PVP-EXPERT] elytra_mace_smash_issued distance="+d.toFixed(2)+" shield_stun_attempt="+enemyShielding+"; awaiting server damage confirmation");
          stop();
          await sleep(180);
          await restoreElytra();
          await sleep(120);
          return true;
        }
        await sleep(30);
      }
      stop();
      await restoreElytra();
      state.failedAction="elytra_mace_no_smash";
      state.failedActionAt=Date.now();
      return false;
    }catch(error){
      stop();
      await restoreElytra();
      state.failedAction="elytra_mace_error";
      state.failedActionAt=Date.now();
      log("[PVP-EXPERT] elytra-mace failed: "+(error?.message||String(error)));
      return false;
    }
  };

  const noteFailure=(action,reason)=>{
    state.failedAction=action+":"+reason;state.failedActionAt=Date.now();
  };

  const run=async(username,task)=>{
    state.active=true;state.targetUsername=String(username||"");
    state.lastHealth=num(bot.health,20);state.lastTargetHealth=null;state.nextAttackAt=0;state.lastTargetPos=null;
    state.strafe=1;state.terminationReason=null;state.failedAction=null;state.elytraFlying=false;
    state.committedStyle=null;state.styleCommitUntil=0;state.totemEquipped=lname(bot.entity?.equipment?.[1])==="totem_of_undying";
    state.lastDecisionLogAt=0;state.lastLoggedStyle=null;state.lastLoggedAction=null;
    state.lastProgressAt=Date.now();state.lastProgressPos=bot.entity?.position?.clone?.()||null;
    state.lastTargetSeenAt=Date.now();state.enemyTotemWasEquipped=false;state.enemyTotemPopUntil=0;
    state.failedActions=Object.create(null);state.failedActionUntil=0;
    const onElytra=e=>{if(e===bot.entity)state.elytraFlying=true};
    state.pearlCooldownUntil=0;
      state.pearlCatchCooldownUntil=0;
    state.maceEscapeCooldownUntil=0;
    state.emergencyRetreatUntil=0;
    state.spacingLockUntil=0;
    state.lastJumpResetAt=0;
    state.lastTargetOnGround=null;
    state.targetLandedAt=0;
    state.lastAttackAttemptAt=0;
    state.lastAttackConfirmedAt=0;state.pendingEntityHitUntil=0;
    state.selfPeakY=num(bot.entity?.position?.y);
    const onTargetGone=e=>{
      if(e?.username&&String(e.username).toLowerCase()===state.targetUsername.toLowerCase()) state.lastTargetSeenAt=0;
    };
    const onTargetHurt=(entity,source)=>{
      const target=targetOf(bot,state.targetUsername);
      if(!state.active||!target||entity?.id!==target.id) return;
      const age=Date.now()-state.lastAttackAttemptAt;
      if(age<0||age>450) return;
      // When Mineflayer identifies the source, reject damage from other
      // entities. Some servers omit source metadata, so the short attack-time
      // + target-identity window is the fallback for PvP players.
      if(source&&(source.id!==bot.entity?.id&&source.username!==bot.username)) return;
      // Health-delta polling and entityHurt may report the same server hit.
      // Count the first confirmation only; the 450ms attack window is also
      // the maximum plausible overlap for these two Mineflayer signals.
      if(!isNewHitConfirmation(Date.now(),state.lastAttackConfirmedAt,450)) return;
      state.hits++;
      state.lastAttackConfirmedAt=Date.now();
      state.pendingEntityHitUntil=state.lastAttackConfirmedAt+1200;
      log("[PVP-EXPERT] hit_confirmed source=entityHurt target="+state.targetUsername+" totalHits="+state.hits);
    };
    try{bot.on?.("playerLeft",onTargetGone)}catch{}
    try{bot.on?.("entityHurt",onTargetHurt)}catch{}
    try{bot.on?.("entityElytraFlew",onElytra)}catch{}
    log("[PVP-EXPERT] brain_version="+brain.version+" difficulty="+combatDifficulty.id+
      " styleLockMs="+combatDifficulty.styleLockMs+" styleSwitchMargin="+combatDifficulty.styleSwitchMargin+
      " strafeMs="+combatDifficulty.strafeMs+" sprintResetMs="+combatDifficulty.sprintResetMs);
    log("[PVP-EXPERT] active target="+state.targetUsername);

    try{
      while(state.active&&taskIsActive(task)){
        if(num(bot.health)<=0){task.terminationReason="death";return false}
        const t=targetOf(bot,state.targetUsername);
        if(!t){
          if(Date.now()-state.lastTargetSeenAt>5000){task.terminationReason="target_lost";return false}
          await sleep(120);continue
        }
        state.lastTargetSeenAt=Date.now();
        if(t.health!=null&&num(t.health)<=0){task.terminationReason="target_defeated";return true}

        const hp=num(bot.health,20),th=num(t.health,20),d=dist(bot.entity,t);
        const selfY=num(bot.entity?.position?.y);
        if(bot.entity?.onGround!==false||!Number.isFinite(state.selfPeakY)) state.selfPeakY=selfY;
        else state.selfPeakY=Math.max(num(state.selfPeakY,selfY),selfY);
        const selfFallDistance=estimateObservedFallDistance(bot.entity,state.selfPeakY);
        const tookDamage=state.lastHealth>hp+0.05;
        if(tookDamage){
          state.damageTaken+=state.lastHealth-hp;
          // Jump-reset only on a fresh hit, while grounded and in a real duel
          // range. This is a short, bounded input rather than constant jumping.
          if(combatDifficulty.jumpReset&&bot.entity?.onGround===true&&d<=4.5&&Date.now()-state.lastJumpResetAt>=500){
            state.lastJumpResetAt=Date.now();
            try{
              bot.setControlState("jump",true);
              await sleep(50);
            }finally{
              try{bot.setControlState("jump",false)}catch{}
            }
            log("[PVP-EXPERT] jump_reset triggered after observed damage at distance="+d.toFixed(2));
          }
        }
        if(state.lastTargetHealth!=null&&state.lastTargetHealth>th){
          const dealt=state.lastTargetHealth-th;
          state.damageDealt+=dealt;
          // Fallback for servers where entityHurt is missing. If the event
          // already counted this hit, do not count the health delta again.
          const hitAt=Date.now();
          if(shouldCountHealthDeltaHit(hitAt,state.pendingEntityHitUntil,state.lastAttackConfirmedAt,450)){
            state.hits++;
            state.lastAttackConfirmedAt=hitAt;
            log("[PVP-EXPERT] hit_confirmed source=health_delta damage="+dealt.toFixed(2)+" totalHits="+state.hits);
          }
          state.pendingEntityHitUntil=0;
        }
        // Combo timing is based on the target's actual landing transition, not
        // merely on seeing an airborne entity at any point during its jump.
        const targetGrounded=t.onGround===true;
        if(state.lastTargetOnGround===false&&targetGrounded) state.targetLandedAt=Date.now();
        state.lastTargetOnGround=targetGrounded;
        state.lastHealth=hp;state.lastTargetHealth=th;
        const eq=detectEquipment(t);
        const enemyTotemNow=eq.totem;
        const enemyTotemPopped=state.enemyTotemWasEquipped && !enemyTotemNow && th<=4;
        if(enemyTotemPopped) state.enemyTotemPopUntil=Date.now()+2600;
        state.enemyTotemWasEquipped=enemyTotemNow;
        const lineOfSight=typeof bot.canSeeEntity==="function"?bot.canSeeEntity(t):true;
        const equippedChest=bot.entity?.equipment?.[4]||null;
        const elytraEquipped=isElytraItem(equippedChest);
        const dPos=state.lastTargetPos?t.position.distanceTo(state.lastTargetPos):0;
        const targetVerticalDelta=state.lastTargetPos?num(t.position?.y)-num(state.lastTargetPos?.y):0;
        const targetVelocity=t.velocity||{x:0,y:0,z:0};
        const enemyHeld=lname(t.equipment?.[0]||t.heldItem||"");
        const enemyMaceHeld=/mace/.test(enemyHeld);
        const enemyWindHeld=/wind_charge/.test(enemyHeld);
        const enemyMaceThreat=enemyMaceHeld&&(
          (isAirborne(t)&&(num(targetVelocity.y)<-.08||num(t.position?.y)>num(bot.entity?.position?.y)+.6))||
          targetVerticalDelta<-.18||
          (d<=3.2&&num(targetVelocity.y)<-.03)
        );
        const enemyBurstThreat=(enemyMaceThreat||enemyWindHeld&&(isAirborne(t)||d<=4.0));
        const enemyHorizDist=Math.max(.001,Math.hypot(num(bot.entity?.position?.x)-num(t.position?.x),num(bot.entity?.position?.z)-num(t.position?.z)));
        const enemyClosing=((num(targetVelocity.x)*(num(bot.entity?.position?.x)-num(t.position?.x))+num(targetVelocity.z)*(num(bot.entity?.position?.z)-num(t.position?.z)))/enemyHorizDist)>.018;
        const enemyMeleeWeapon=/sword|axe|spear|mace|trident/.test(enemyHeld);
        const meleeBlockReady=enemyClosing&&enemyMeleeWeapon&&d>=2.65&&d<=4.25&&!enemyMaceThreat;
        const botDx=num(bot.entity?.position?.x)-num(t.position?.x);
        const botDz=num(bot.entity?.position?.z)-num(t.position?.z);
        const botHoriz=Math.hypot(botDx,botDz)||1;
        const targetYaw=num(t.yaw);
        const targetFacingDot=(-Math.sin(targetYaw)*botDx+Math.cos(targetYaw)*botDz)/botHoriz;
        const backstabReady=d>=2.15&&d<=3.05&&targetFacingDot<.35;
        const projectileIncoming=projectileThreat();
        const crystalCycleReady=has(bot,"crystal")&&has(bot,"obsidian")&&Boolean(crystalBase(t));
        const enemy={
          health:th,shield:eq.shield,usingItem:Boolean(t.isUsingItem||t.metadata?.isUsingItem),
          airborne:isAirborne(t),falling:num(targetVelocity.y)<-.08,velocityY:num(targetVelocity.y),
          retreating:speed(t)>.18,totemPopped:Date.now()<state.enemyTotemPopUntil,
          healing:Boolean(t.isUsingItem&&/golden_apple|potion/i.test(eq.held||"")),
          meleeThreat:d<5,
          elytra:eq.elytra,held:eq.held,offhand:eq.offhand
        };
        const ctx={
          distance:d,health:hp,maxHealth:num(bot.maxHealth,20),food:num(bot.food,20),
          onGround:bot.entity?.onGround!==false,falling:num(bot.entity?.velocity?.y)<-.08,
          fallDistance:selfFallDistance,heightAdvantage:num(bot.entity?.position?.y)>num(t.position?.y)+1.5,
          knockbacked:speed(bot.entity)>.84,lineOfSight,enemy,
          projectileThreat:projectileIncoming,projectileDodge:projectileIncoming,
          crystalCycleSafe:crystalCycleReady,
          hazard:hazard(),stuck:state.failedAction==="approach:stuck",
          hasSword:has(bot,"sword"),hasAxe:has(bot,"axe"),hasMace:has(bot,"mace"),hasSpear:has(bot,"spear"),
          hasMelee:has(bot,"sword")||has(bot,"axe")||has(bot,"mace")||has(bot,"spear"),
          hasShield:has(bot,"shield"),hasPearl:has(bot,"pearl"),hasTotem:has(bot,"totem"),hasHeal:has(bot,"heal"),
          hasWaterBucket:has(bot,"water"),hasBurst:has(bot,"mace")||has(bot,"axe")||has(bot,"crystal"),
          hasDebuff:has(bot,"potion"),hasRod:has(bot,"rod"),
          webbed:Boolean(bot.blockAt?.(bot.entity.position)?.name==="cobweb"||bot.blockAt?.(bot.entity.position.offset(0,1,0))?.name==="cobweb"),
          attackReadyAt:state.nextAttackAt,healDistanceMin:4.2,
          inventory:{
            sword:count(bot,"sword"),axe:count(bot,"axe"),mace:count(bot,"mace"),spear:count(bot,"spear"),
            bow:count(bot,"bow"),crossbow:count(bot,"crossbow"),crystal:count(bot,"crystal"),
            obsidian:count(bot,"obsidian"),respawn_anchor:count(bot,"anchor"),glowstone:count(bot,"glowstone")
          },
          capabilities:{
            melee:has(bot,"sword")||has(bot,"axe")||has(bot,"mace")||has(bot,"spear"),
            totem:has(bot,"totem"),pearl:has(bot,"pearl"),heal:has(bot,"heal"),water:has(bot,"water"),
            shield:has(bot,"shield"),burst:has(bot,"mace")||has(bot,"axe")||has(bot,"crystal"),
            spear:has(bot,"spear"),mace:has(bot,"mace"),axe:has(bot,"axe"),sword:has(bot,"sword"),
            crystalCycleSafe:has(bot,"crystal")&&has(bot,"obsidian")&&Boolean(crystalBase(t)),
            anchorArena:["overworld","the_end"].includes(String(bot.game?.dimension||"")),
            anchorCycleSafe:["overworld","the_end"].includes(String(bot.game?.dimension||""))&&has(bot,"anchor")&&has(bot,"glowstone")&&num(bot.health,20)>=10,
            projectileDodge:projectileIncoming,
            rod:has(bot,"rod"),
             wind:has(bot,"wind"),
             firework:has(bot,"firework"),
            windMace:Boolean(has(bot,"wind")&&has(bot,"mace")),
            debuff:has(bot,"potion"),
            elytraMace:Boolean(elytraEquipped&&has(bot,"mace")),
          },
          elytraEquipped,
          // Root-level fields are consumed by the brain; capability flags above
          // are only for has(ctx, key) gates.
          anchorArena:["overworld","the_end"].includes(String(bot.game?.dimension||"")),
          anchorCycleSafe:["overworld","the_end"].includes(String(bot.game?.dimension||""))&&has(bot,"anchor")&&has(bot,"glowstone")&&num(bot.health,20)>=10,
          elytraLaunchReady:Boolean(elytraEquipped&&has(bot,"mace")&&has(bot,"firework")&&(bot.entity?.elytraFlying===true||(bot.entity?.onGround===false&&num(bot.entity?.velocity?.y)<-.05)||Boolean(bot.entity?.position?.y>t.position?.y+2))),
          elytraMaceReady:Boolean(elytraEquipped&&has(bot,"mace")&&d>=6&&lineOfSight),
           rocketMaceReady:Boolean(elytraEquipped&&has(bot,"mace")&&has(bot,"firework")&&d>=6&&lineOfSight),
           elytraStunSlamReady:Boolean(elytraEquipped&&has(bot,"mace")&&has(bot,"axe")&&eq.shield&&enemy.usingItem&&d>=6&&lineOfSight),
          windMaceReady:Boolean(has(bot,"wind")&&has(bot,"mace")&&d<=7),
          crystalArena:crystalCycleReady,nether:bot.game?.dimension==="the_nether",
          hitSelectReady:Boolean(state.targetLandedAt>0&&Date.now()-state.targetLandedAt<=150&&d<=3.2),
          selfMaceSmashReady:Boolean(has(bot,"mace")&&isAirborne(bot.entity)&&num(bot.entity?.velocity?.y)<-.08&&selfFallDistance>1.5),
           maceAttributeSwapReady:Boolean(has(bot,"mace")&&has(bot,"sword")&&hotbarSlot("mace")!=null&&hotbarSlot("sword")!=null&&isAirborne(bot.entity)&&num(bot.entity?.velocity?.y)<-.08&&selfFallDistance>1.5&&d<=3.1),
           maceCrystalDTapReady:Boolean(has(bot,"mace")&&has(bot,"crystal")&&has(bot,"obsidian")&&Boolean(crystalBase(t))&&isAirborne(bot.entity)&&num(bot.entity?.velocity?.y)<-.08&&selfFallDistance>1.5&&num(state.nextAttackAt)<=Date.now()&&d>=2.35&&d<=3.1),
          windMaceSmashReady:Boolean(has(bot,"wind")&&has(bot,"mace")&&d>=3.5&&d<=6.5&&num(state.nextAttackAt)<=Date.now()&&!isAirborne(t)&&hp>7),
          pearlCatchReady:Boolean(has(bot,"pearl")&&has(bot,"mace")&&count(bot,"wind")>=2&&bot.entity?.onGround!==false&&Date.now()>=state.pearlCatchCooldownUntil&&d>=4.5&&d<=12&&lineOfSight&&hp>7),
           diagonalPearlCatchReady:Boolean(has(bot,"pearl")&&has(bot,"mace")&&count(bot,"wind")>=2&&bot.entity?.onGround!==false&&Date.now()>=state.pearlCatchCooldownUntil&&d>=4.5&&d<=12&&lineOfSight&&hp>7&&enemy.retreating),
           pearlEscapeReady:pearlReady("escape",t),
          pearlAmbushReady:pearlReady("ambush",t),
           pearlGrappleReady:Boolean(has(bot,"pearl")&&pearlDestination(t,"grapple")),
           windCancelReady:Boolean(has(bot,"wind")&&isAirborne(t)&&d>=3&&d<=7),
           windChargeResetReady:Boolean(has(bot,"wind")&&has(bot,"mace")&&isAirborne(bot.entity)&&num(bot.entity?.velocity?.y)<-.25&&selfFallDistance>1.5&&d>=2.25&&d<=3.25),
           shieldDrainReady:Boolean(eq.shield&&enemy.usingItem),
           backstabReady:Boolean(backstabReady),
           stunSlamReady:Boolean(has(bot,"axe")&&has(bot,"mace")&&hotbarSlot("axe")!=null&&hotbarSlot("mace")!=null&&isAirborne(bot.entity)&&num(bot.entity?.velocity?.y)<-.08&&selfFallDistance>1.5&&num(state.nextAttackAt)<=Date.now()&&d>=2.25&&d<=3.2&&eq.shield&&enemy.usingItem),
          maceEscapeReady:Boolean(Date.now()>=state.maceEscapeCooldownUntil&&d>=2.8),
          recoveryPearlReady:Boolean(has(bot,"pearl")&&Date.now()>=state.pearlCooldownUntil),
          shieldReady:Boolean(Date.now()>=state.shieldCooldownUntil),
          meleeBlockReady,
          emergencyRetreatUntil:state.emergencyRetreatUntil,

          badPosition:Boolean(hazard()||d>14||!lineOfSight),
          totemEquipped:state.totemEquipped||lname(bot.entity?.equipment?.[1])==="totem_of_undying",
          hardCounter:Boolean((eq.shield&&enemy.usingItem)||(eq.elytra&&isAirborne(t))||enemy.totemPopped),
          spacingLockUntil:state.spacingLockUntil,
          enemyBurstThreat,enemyMaceThreat,
          enemyMaceHeldClose:Boolean(enemyMaceHeld&&d<=5),
          strafeDirection:state.strafe>0?"right":"left"
        };

        let decision=brain.decide(ctx);
        const blockedUntil=state.failedActions[decision.action]||0;
        // A stale failure cooldown must never replace survival, healing, or
        // escape decisions with an approach/attack action at critical health.
        if(shouldApplyFailedActionBackoff(decision.action)&&blockedUntil>Date.now()){
          decision = d<=3.3
            ? {action:"defensive_strafe",style:state.style||"sword",priority:5000,reason:"failed_action_backoff"}
            : {action:"approach",style:state.style||"sword",priority:5000,reason:"failed_action_backoff"};
        }
        state.style=decision.style||state.style;state.action=decision.action;
        if(decision.style&&decision.style!=="utility"&&decision.style!==state.committedStyle){state.committedStyle=decision.style;state.styleCommitUntil=Date.now()+Number(combatDifficulty.styleLockMs||450);}
        brain.noteAction(decision.action);

        const now=Date.now(),changed=state.style!==state.lastLoggedStyle||state.action!==state.lastLoggedAction;
        if(changed||now-state.lastDecisionLogAt>=750){
          log("[PVP-EXPERT] style="+state.style+" action="+state.action+" reason="+decision.reason+" dist="+d.toFixed(2));
          state.lastDecisionLogAt=now;state.lastLoggedStyle=state.style;state.lastLoggedAction=state.action;
        }

        let ok=true;
        switch(decision.action){
          case "stop": return false;
          case "heal": ok=await heal();break;
          case "shield": ok=await shield(t);break;
          case "totem": {
            const equipped=await equip("totem","off-hand");
            if(equipped){
              state.totemEquipped=true;
              await emergencyDisengage(t);
              state.failedAction=null;
            }
            ok=equipped;
            break;
          }
          case "emergency_disengage": ok=await emergencyDisengage(t);break;
          case "emergency_hold": ok=await emergencyHold(t);break;
          case "spacing_retreat": ok=await spacingRetreat(t);break;
          case "spacing_hold": {
            await lookAtTarget(t,.04);
            bot.setControlState("forward",false);
            bot.setControlState("back",false);
            bot.setControlState("sprint",false);
            bot.setControlState(state.strafe<0?"left":"right",true);
            await sleep(140);
            stop();
            ok=true;
            break;
          }
          case "pearl_escape":
            ok=await throwPearl(t,"escape");
            if(ok) state.maceEscapeCooldownUntil=Date.now()+2600;
            break;
          case "pearl_ambush": ok=await throwPearl(t,"ambush");break;
          case "pearl_recover": ok=await throwPearl(t,"escape");break;
          case "pearl_catch": ok=await pearlCatch(t,false);break;
          case "diagonal_pearl_catch": ok=await pearlCatch(t,true);break;
          case "pearl_grapple": ok=await throwPearl(t,"grapple");break;
          case "wind_charge_cancel": ok=await windChargeCancel(t);break;
          case "wind_charge_reset": ok=await windChargeReset(t);break;
          case "shield_drain": ok=await shieldDrain(t);break;
          case "rod_control": ok=await rod(t);break;
          case "backstab": ok=await backstab(t);break;
          case "mace_d_tap": ok=await maceDTap(t);break;
          case "mace_attribute_swap": ok=await maceAttributeSwap(t);break;
          case "stun_slam": ok=await stunSlam(t);break;
          case "rocket_mace": ok=await elytraMace(t);break;
          case "water_clutch": ok=await waterRecover();break;
          case "web_escape": ok=await webEscape();break;
          case "shield_break": ok=await attack(t,"axe",3.2);break;
          case "falling_crit": ok=await fallingCrit(t);break;
          case "hit_select": ok=await hitSelect(t);break;
          case "melee_attack": ok=await attack(t,decision.style==="axe"?"axe":decision.style==="mace"?"mace":decision.style==="spear"?"spear":"sword",decision.style==="spear"?5.0:decision.style==="mace"?3.1:3.05);break;
          case "finish": ok=await attack(t,has(bot,"mace")?"mace":has(bot,"axe")?"axe":"sword",3.1);break;
          case "mace_drop": ok=await attack(t,"mace",3.1);break;
          case "mace_dive": ok=await maceSmash(t);break;
          case "mace_approach": ok=await approach(t,3.0);break;
          case "spear_pressure": ok=await spearCharge(t);break;
          case "ranged_attack": ok=await ranged(t,decision.style==="crossbow"?"crossbow":"bow");break;
          case "crystal_cycle": ok=await crystalCycle(t);break;
          case "anchor_cycle": ok=await anchorCycle(t);break;
          case "elytra_mace": ok=await elytraMace(t);break;
          case "wind_mace_launch": ok=await wind(t);break;
          case "dodge_projectile": ok=await projectileDodge(t);break;
          case "approach": ok=await approach(t,2.8);break;
          case "strafe_pressure": ok=await pressureOrbit(t,state.strafe,Number(combatDifficulty.strafeMs||95));state.strafe*=-1;break;
          case "defensive_strafe": ok=await strafe(t,state.strafe,Number(combatDifficulty.strafeMs||120)+55);state.strafe*=-1;break;
          case "reposition": ok=await strafe(t,state.strafe,Number(combatDifficulty.strafeMs||120)+40);state.strafe*=-1;break;
          case "reacquire": ok=await approach(t,3.2);break;
          case "unstuck": stop();await sleep(160);state.strafe*=-1;ok=await strafe(t,state.strafe,180);break;
          case "debuff": ok=await ranged(t,"potion");break;
          default: await sleep(80); break;
        }

        if(!ok){
          noteFailure(decision.action,"execution_failed");
          state.failedActions[decision.action]=Date.now()+1600;
          state.failedActionUntil=Date.now()+1600;
          await sleep(90);
        }else{
          state.failedAction=null;
          delete state.failedActions[decision.action];
        }

        const progressPos=bot.entity?.position;
        if(progressPos&&state.lastProgressPos){
          if(progressPos.distanceTo(state.lastProgressPos)>0.35){
            state.lastProgressAt=Date.now();
            state.lastProgressPos=progressPos.clone();
          }else if(Date.now()-state.lastProgressAt>1800&&["approach","mace_approach","reacquire","strafe_pressure"].includes(decision.action)){
            state.failedActions[decision.action]=Date.now()+1800;
            state.lastProgressAt=Date.now();
            state.lastProgressPos=progressPos.clone();
            stop();
          }
        }
        state.lastTargetPos=t.position?.clone?.()||t.position||null;
      }
      return false;
    }catch(error){
      task.terminationReason="controller_error: "+String(error?.message||error);
      log("[PVP-EXPERT] ERROR "+task.terminationReason);
      return false;
    }finally{
      state.active=false;stop();
      try{bot.removeListener?.("entityElytraFlew",onElytra)}catch{}
      try{bot.removeListener?.("entityHurt",onTargetHurt)}catch{}
      try{bot.removeListener?.("playerLeft",onTargetGone)}catch{}
    }
  };

  return {
    state,run,
    release:reason=>{state.active=false;state.terminationReason=reason;stop()},
    brain
  };
}
export default createPvpExpertController;
