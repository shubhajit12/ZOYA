/**
 * ZOYA Unified PvP Expert Controller v2.
 * Single physical combat authority. No training or adaptive learning.
 * Mineflayer 4.39.x / Minecraft 1.21.x baseline.
 */
import { createPvpExpertBrain } from "./pvpExpertBrain.mjs";
import { Vec3 } from "vec3";

const sleep=ms=>new Promise(r=>setTimeout(r,Math.max(0,Number(ms)||0)));
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const lname=v=>String(v?.name||v?.displayName||"").toLowerCase();

const ITEMS=Object.freeze({
  sword:["netherite_sword","diamond_sword","iron_sword","stone_sword","golden_sword","wooden_sword"],
  axe:["netherite_axe","diamond_axe","iron_axe","stone_axe","golden_axe","wooden_axe"],
  mace:["mace"],
  spear:["netherite_spear","diamond_spear","iron_spear","stone_spear","golden_spear","wooden_spear","spear"],
  bow:["bow"], crossbow:["crossbow"], shield:["shield"], pearl:["ender_pearl"],
  totem:["totem_of_undying"], heal:["enchanted_golden_apple","golden_apple"],
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

export function createPvpExpertController({bot,goals,taskIsActive=()=>true,log=()=>{}}={}){
  if(!bot) throw new Error("PvP Expert Controller requires bot");
  if(!goals?.GoalFollow) throw new Error("PvP Expert Controller requires verified GoalFollow.");

  const brain=createPvpExpertBrain();
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
    lastPearlAt:0,pearlCooldownUntil:0,lastPearlType:null,
    maceLaunchUntil:0,lastMaceSmashAt:0
  };

  const stop=()=>{
    try{bot.pathfinder?.setGoal?.(null)}catch{}
    try{bot.clearControlStates?.()}catch{}
    try{bot.deactivateItem?.()}catch{}
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

  const equipBestMelee=async(preferred=null)=>{
    const order=preferred?[preferred,"sword","axe","spear","mace"]:["sword","axe","spear","mace"];
    for(const type of [...new Set(order)]) if(has(bot,type)&&await equip(type)) return type;
    return null;
  };

  const lookAtTarget=async(t,lead=0)=>{
    if(!t?.position) return false;
    const v=t.velocity||{x:0,y:0,z:0};
    const p=t.position.offset(num(v.x)*lead,num(v.y)*lead, num(v.z)*lead);
    try{await bot.lookAt(p.offset(0,Math.max(.9,num(t.height,1.8)*.62),0),true);return true}catch{return false}
  };

  const approach=async(t,range=2.8)=>{
    if(!t||!goals?.GoalFollow) return false;
    if(dist(bot.entity,t)<=range) return true;
    try{
      bot.pathfinder.setGoal(new goals.GoalFollow(t,range),true);
      const until=Date.now()+650;
      while(state.active&&taskIsActive()&&Date.now()<until){
        if(dist(bot.entity,t)<=range) return true;
        await sleep(75);
      }
      return dist(bot.entity,t)<=range;
    }finally{
      try{bot.pathfinder.setGoal(null)}catch{}
    }
  };

  const strafe=async(t,sign,ms=145)=>{
    await lookAtTarget(t,.08);
    bot.setControlState("forward",true);
    bot.setControlState(sign<0?"left":"right",true);
    bot.setControlState("sprint",true);
    await sleep(ms);
    stop();
    return true;
  };

  const emergencyDisengage=async t=>{
    if(!t)return false;
    await lookAtTarget(t,.05);
    bot.setControlState("back",true);
    bot.setControlState("sprint",true);
    bot.setControlState(state.strafe<0?"left":"right",true);
    await sleep(520);
    stop();
    state.strafe*=-1;
    return true;
  };

  const attack=async(t,type,maxReach)=>{
    if(!t||!await equip(type)) return false;
    const d=dist(bot.entity,t);
    if(d>maxReach){state.failedAction="attack_out_of_range";state.failedActionAt=Date.now();return false}
    await lookAtTarget(t,.05);
    bot.attack(t);
    const cooldown=type==="spear"?1150:type==="mace"?950:700;
    state.lastAttackAt=Date.now();
    state.nextAttackAt=state.lastAttackAt+cooldown;
    state.attackCount++;
    await sprintReset();
    await sleep(55);
    return true;
  };

  const fallingCrit=async t=>{
    if(!await equip("sword")) return false;
    if(dist(bot.entity,t)>3.05) return false;
    bot.setControlState("forward",true);
    bot.setControlState("sprint",true);
    bot.setControlState("jump",true);
    await sleep(75);
    bot.setControlState("jump",false);
    const until=Date.now()+700;
    while(state.active&&taskIsActive()&&Date.now()<until){
      if(isAirborne(bot.entity)&&num(bot.entity.velocity?.y)<-.05&&num(bot.entity.fallDistance)>=.45) break;
      await sleep(20);
    }
    const valid=isAirborne(bot.entity)&&num(bot.entity.velocity?.y)<-.05&&num(bot.entity.fallDistance)>=.45&&dist(bot.entity,t)<=3.05;
    if(!valid){stop();return false}
    await lookAtTarget(t,.02);bot.attack(t);state.lastAttackAt=Date.now();state.nextAttackAt=state.lastAttackAt+700;state.attackCount++;await sprintReset();stop();return true;
  };

  const hitSelect=async t=>{
    if(!await equip("sword")) return false;
    bot.setControlState("sprint",true);
    bot.setControlState("forward",true);
    await sleep(45);
    if(dist(bot.entity,t)<=3.05){await lookAtTarget(t,.02);bot.attack(t);state.lastAttackAt=Date.now();state.nextAttackAt=state.lastAttackAt+700;state.attackCount++}
    await sprintReset();
    bot.setControlState("sprint",false);
    return true;
  };

  const rod=async t=>{
    if(!has(bot,"fishing_rod"))return false;
    if(!await equip("fishing_rod","hand"))return false;
    await lookAtTarget(t,.1);
    try{bot.activateItem();await sleep(180);bot.deactivateItem();return true}catch{return false}
  };

  const heal=async()=>{
    const i=item(bot,"heal"); if(!i)return false;
    stop();
    try{await bot.equip(i,"hand");await bot.consume();await equipBestMelee();return true}catch{return false}
  };

  const shield=async()=>{
    if(!await equip("shield")) return false;
    try{bot.activateItem();await sleep(300);bot.deactivateItem();return true}catch{try{bot.deactivateItem()}catch{};return false}
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
    if(mode==="ambush"){
      const tx=(tp.x-p.x)/len,tz=(tp.z-p.z)/len;
      for(const r of [5.5,7,8.5]) push(p.x+tx*r,p.z+tz*r);
    }else{
      for(const r of [5.5,7,8.5,10]){
        push(p.x+awayX*r,p.z+awayZ*r);
        push(p.x+awayX*r+sideX*2.5,p.z+awayZ*r+sideZ*2.5);
        push(p.x+awayX*r-sideX*2.5,p.z+awayZ*r-sideZ*2.5);
      }
    }
    for(const c of candidates){
      const feet=bot.blockAt(new Vec3(Math.floor(c.x),Math.floor(c.y),Math.floor(c.z)));
      const head=bot.blockAt(new Vec3(Math.floor(c.x),Math.floor(c.y+1),Math.floor(c.z)));
      const below=bot.blockAt(new Vec3(Math.floor(c.x),Math.floor(c.y-1),Math.floor(c.z)));
      if(!pearlBlockSafe(feet)||!pearlBlockSafe(head))continue;
      if(!below||below.boundingBox!=="block")continue;
      if(/lava|fire|magma|cactus|powder_snow/.test(String(below.name||"").toLowerCase()))continue;
      const d=c.distanceTo(tp);
      if(mode==="escape"&&d<3.5)continue;
      return c.offset(.5,.35,.5);
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
    try{
      await bot.lookAt(destination,true);
      bot.activateItem();
      await sleep(85);
      bot.deactivateItem();
      state.lastPearlAt=Date.now();
      state.pearlCooldownUntil=state.lastPearlAt+1000;
      state.lastPearlType=mode;
      await sleep(260);
      return true;
    }catch{
      try{bot.deactivateItem()}catch{}
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
    try{
      if(bot.projectiles?.projectileAtMe||bot.projectiles?.isAimedAt)return true;
    }catch{}
    const p=bot.entity?.position;if(!p)return false;
    return Object.values(bot.entities||{}).some(e=>{
      if(!e?.position||e===bot.entity)return false;
      const n=String(e.name||"").toLowerCase();
      if(!/arrow|spectral_arrow|trident|fireball|small_fireball|wind_charge|snowball|egg/.test(n))return false;
      return e.position.distanceTo(p)<8;
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
    if(!bot.game||bot.game.dimension!=="the_nether"||!has(bot,"anchor")||!has(bot,"glowstone"))return false;
    const p=t?.position;if(!p)return false;
    const id=bot.registry?.blocksByName?.respawn_anchor?.id;
    if(!Number.isInteger(id)||typeof bot.findBlocks!=="function")return false;
    const positions=bot.findBlocks({matching:id,maxDistance:7,count:20});
    let anchor=null,best=Infinity;
    for(const pos of positions){const d=pos.distanceTo(p);if(d<best){anchor=bot.blockAt(pos);best=d}}
    if(!anchor||dist(bot.entity,{position:anchor.position})>5)return false;
    const blast=anchor.position.offset(.5,.5,.5);
    const enemyDamage=typeof bot.getExplosionDamages==="function"?bot.getExplosionDamages(t,blast,5,false):null;
    const selfDamage=typeof bot.getExplosionDamages==="function"?bot.getExplosionDamages(bot.entity,blast,5,false):null;
    if(selfDamage!=null&&selfDamage>5)return false;
    if(enemyDamage!=null&&enemyDamage<4)return false;
    try{
      await equip("glowstone");await bot.activateBlock(anchor);await sleep(100);
      const refreshed=bot.blockAt(anchor.position);
      if(refreshed?.name==="respawn_anchor"){await equip("glowstone");await bot.activateBlock(refreshed)}
      await sleep(180);return true;
    }catch{return false}
  };

  const spearCharge=async t=>{
    if(!await equip("spear"))return false;
    const d=dist(bot.entity,t);
    if(d<2.0||d>4.75)return false;
    await lookAtTarget(t,.12);
    try{
      bot.activateItem();
      const until=Date.now()+950;
      let hit=false;
      while(state.active&&taskIsActive()&&Date.now()<until){
        const live=targetOf(bot,state.targetUsername)||t;
        if(!live)break;
        await lookAtTarget(live,.08);
        const nd=dist(bot.entity,live);
        bot.setControlState("forward",true);
        bot.setControlState("sprint",true);
        if(nd<=4.75&&nd>=2.0){
          // The 1.21.11 spear charge deals contact damage while held; keep
          // the charge active while moving through the valid range.
          hit=true;
        }
        await sleep(35);
        if(hit&&nd<2.0)break;
      }
      bot.deactivateItem();
      stop();
      if(hit){
        state.lastAttackAt=Date.now();
        state.nextAttackAt=state.lastAttackAt+1150;
        await sprintReset();
      }
      return hit;
    }catch(error){
      try{bot.deactivateItem()}catch{}
      stop();
      return false;
    }
  };

  const maceSmash=async(t)=>{
    if(!t||!has(bot,"mace"))return false;
    if(!await equip("mace"))return false;
    const until=Date.now()+900;
    let attempted=false;
    while(state.active&&taskIsActive()&&Date.now()<until){
      const live=targetOf(bot,state.targetUsername)||t;
      if(!live)break;
      const d=dist(bot.entity,live);
      const falling=isAirborne(bot.entity)&&num(bot.entity?.velocity?.y)<-.08;
      const fallDistance=num(bot.entity?.fallDistance);
      await lookAtTarget(live,.02);
      if(falling&&fallDistance>1.5&&d<=3.1){
        bot.attack(live);
        state.lastAttackAt=Date.now();
        state.nextAttackAt=state.lastAttackAt+950;
        state.lastMaceSmashAt=Date.now();
        state.attackCount++;
        attempted=true;
        stop();
        await sleep(180);
        return true;
      }
      bot.setControlState("forward",true);
      bot.setControlState("sprint",true);
      await sleep(25);
    }
    stop();
    return attempted;
  };

  const wind=async t=>{
    if(!t||!await equip("wind"))return false;
    try{
      await lookAtTarget(t,.05);
      bot.activateItem();
      await sleep(90);
      bot.deactivateItem();
      state.maceLaunchUntil=Date.now()+2200;
      await sleep(70);
      return await maceSmash(t);
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
    if(!await equip("firework","off-hand"))return false;
    try{bot.activateItem(true);await sleep(90);return true}catch{return false}
  };

  const sprintReset=async()=>{
    try{bot.setControlState("sprint",false);await sleep(90);bot.setControlState("sprint",true)}catch{}
  };

  const elytraMace=async t=>{
    if(!has(bot,"elytra")||!has(bot,"mace"))return false;
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

      // Remove Elytra before the smash; this is required by vanilla mace rules.
      if(!await equipBestMelee())return false;
      // equipBestMelee may select mace/another weapon; force mace for the smash.
      if(!await equip("mace","hand"))return false;

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
          bot.attack(live);
          state.lastAttackAt=Date.now();
          state.nextAttackAt=state.lastAttackAt+950;
          state.attackCount++;
          stop();
          await sleep(300);
          return true;
        }
        await sleep(30);
      }
      stop();
      state.failedAction="elytra_mace_no_smash";
      state.failedActionAt=Date.now();
      return false;
    }catch(error){
      stop();
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
    const onTargetGone=e=>{
      if(e?.username&&String(e.username).toLowerCase()===state.targetUsername.toLowerCase()) state.lastTargetSeenAt=0;
    };
    try{bot.on?.("playerLeft",onTargetGone)}catch{}
    try{bot.on?.("entityElytraFlew",onElytra)}catch{}
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
        if(state.lastHealth>hp)state.damageTaken+=state.lastHealth-hp;
        if(state.lastTargetHealth!=null&&state.lastTargetHealth>th){
          state.hits++;state.damageDealt+=state.lastTargetHealth-th;
        }
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
        const targetVelocity=t.velocity||{x:0,y:0,z:0};
        const enemyHeld=lname(t.equipment?.[0]||t.heldItem||"");
        const enemyMaceHeld=/mace/.test(enemyHeld);
        const enemyWindHeld=/wind_charge/.test(enemyHeld);
        const enemyMaceThreat=enemyMaceHeld&&(
          (isAirborne(t)&&(num(targetVelocity.y)<-.08||num(t.position?.y)>num(bot.entity?.position?.y)+.6))||
          num(t.fallDistance)>1.5||
          (d<=3.8&&num(targetVelocity.y)<-.03)
        );
        const enemyBurstThreat=(enemyMaceThreat||enemyWindHeld&&(isAirborne(t)||d<=4.0));
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
          fallDistance:num(bot.entity?.fallDistance),heightAdvantage:num(bot.entity?.position?.y)>num(t.position?.y)+1.5,
          knockbacked:speed(bot.entity)>.84,lineOfSight,enemy,
          projectileThreat:projectileThreat(),hazard:hazard(),stuck:state.failedAction==="approach:stuck",
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
            anchorCycleSafe:bot.game?.dimension==="the_nether"&&has(bot,"anchor")&&has(bot,"glowstone"),
            projectileDodge:projectileThreat(),
            windMace:Boolean(has(bot,"wind")&&has(bot,"mace")),
            debuff:has(bot,"potion"),
            elytraMace:Boolean(elytraEquipped&&has(bot,"mace")),
          },
          elytraEquipped,elytraLaunchReady:Boolean(elytraEquipped&&has(bot,"mace")&&has(bot,"firework")&&(bot.entity?.elytraFlying===true||(bot.entity?.onGround===false&&num(bot.entity?.velocity?.y)<-.05)||Boolean(bot.entity?.position?.y>t.position?.y+2))),
          elytraMaceReady:Boolean(elytraEquipped&&has(bot,"mace")&&d>=6&&lineOfSight),
          windMaceReady:Boolean(has(bot,"wind")&&has(bot,"mace")&&d<=7),
          crystalArena:Boolean(crystalBase(t)),nether:bot.game?.dimension==="the_nether",
          hitSelectReady:Boolean(isAirborne(t)&&d<=3.2),
          selfMaceSmashReady:Boolean(has(bot,"mace")&&isAirborne(bot.entity)&&num(bot.entity?.velocity?.y)<-.08&&num(bot.entity?.fallDistance)>1.5),
          windMaceSmashReady:Boolean(has(bot,"wind")&&has(bot,"mace")&&d<=7&&num(state.nextAttackAt)<=Date.now()&&!isAirborne(t)),
          pearlEscapeReady:pearlReady("escape",t),
          pearlAmbushReady:pearlReady("ambush",t),
          recoveryPearlReady:Boolean(has(bot,"pearl")&&Date.now()>=state.pearlCooldownUntil),
          badPosition:Boolean(hazard()||d>14||!lineOfSight),
          totemEquipped:state.totemEquipped||lname(bot.entity?.equipment?.[1])==="totem_of_undying",
          hardCounter:Boolean(eq.shield||eq.elytra||enemy.totemPopped),
          enemyBurstThreat,enemyMaceThreat,
          strafeDirection:state.strafe>0?"right":"left"
        };

        let decision=brain.decide(ctx);
        const blockedUntil=state.failedActions[decision.action]||0;
        if(blockedUntil>Date.now()){
          decision = d<=3.3
            ? {action:"defensive_strafe",style:state.style||"sword",priority:5000,reason:"failed_action_backoff"}
            : {action:"approach",style:state.style||"sword",priority:5000,reason:"failed_action_backoff"};
        }
        state.style=decision.style||state.style;state.action=decision.action;
        if(decision.style&&decision.style!=="utility"&&decision.style!==state.committedStyle){state.committedStyle=decision.style;state.styleCommitUntil=Date.now()+1800;}
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
          case "shield": ok=await shield();break;
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
          case "pearl_escape": ok=await throwPearl(t,"escape");break;
          case "pearl_ambush": ok=await throwPearl(t,"ambush");break;
          case "pearl_recover": ok=await throwPearl(t,"escape");break;
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
          case "strafe_pressure": ok=await strafe(t,state.strafe,145);state.strafe*=-1;break;
          case "defensive_strafe": ok=await strafe(t,state.strafe,190);state.strafe*=-1;break;
          case "reposition": ok=await strafe(t,state.strafe,175);state.strafe*=-1;break;
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
