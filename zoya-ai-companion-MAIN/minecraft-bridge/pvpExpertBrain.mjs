/**
 * ZOYA PvP Expert Brain v2
 * Deterministic tactical policy. No training, learning, or adaptive telemetry.
 *
 * Contract: every returned action has a feasibility gate represented by ctx.
 * The controller is the sole physical executor.
 */
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const has=(c,k)=>c?.capabilities?.[k]===true;
const invHas=(c,k)=>num(c?.inventory?.[k])>0;

export const PVP_EXPERT_BRAIN_VERSION="pvp-expert-brain-v2";

const STYLES=Object.freeze([
  "sword","axe","mace","spear","crystal","anchor","bow","crossbow",
  "shield","elytra","utility"
]);

function styleScores(c){
  const d=num(c.distance,Infinity), e=c.enemy||{}, s={};
  for(const k of STYLES) s[k]=-1000;

  if(invHas(c,"mace")) s.mace=52+(e.airborne?34:0)+(e.falling?45:0)+(c.heightAdvantage?18:0)+(c.elytraMaceReady?58:0)-(d>8?28:0);
  if(invHas(c,"spear")) s.spear=48+(d>=3&&d<=5?35:0)+(e.retreating?12:0);
  if(invHas(c,"axe")) s.axe=50+(e.shield?42:0)+(d<=3.5?15:0);
  if(invHas(c,"sword")) s.sword=48+(d<=3.15?32:0)+(e.airborne?14:0);
  if(invHas(c,"bow")) s.bow=30+(d>=7?35:0)+(e.retreating?18:0);
  if(invHas(c,"crossbow")) s.crossbow=34+(d>=8?35:0)+(e.retreating?18:0);
  if(invHas(c,"crystal")&&invHas(c,"obsidian")) s.crystal=38+(c.crystalArena?38:0)+(d<=6?18:0);
  if(invHas(c,"respawn_anchor")&&invHas(c,"glowstone")&&c.nether) s.anchor=42+(d<=7?25:0);
  if(c.elytraEquipped&&invHas(c,"mace")) s.elytra=60+(c.elytraMaceReady?70:0)+(d>7?15:0);
  if(invHas(c,"shield")) s.shield=18+(e.meleeThreat?30:0)+(c.projectileThreat?35:0);
  s.utility=15+(c.projectileThreat?30:0)+(c.hazard?30:0);
  return s;
}

function bestStyle(c){
  const s=styleScores(c);
  return Object.keys(s).reduce((a,b)=>s[b]>s[a]?b:a,"utility");
}

export function createPvpExpertBrain(){
  let styleMemory=null;
  let lastAction=null;
  let lastActionAt=0;

  function decide(ctx={}){
    const c=ctx||{}, e=c.enemy||{}, d=num(c.distance,Infinity);
    const hp=num(c.health,20), maxHp=Math.max(1,num(c.maxHealth,20));
    const low=hp<=Math.min(10,maxHp*.5), emergency=hp<=Math.min(6,maxHp*.3);
    const falling=Boolean(c.falling), onGround=c.onGround!==false;
    const attackReady=num(c.attackReadyAt,0)<=Date.now();
    const scores=styleScores(c), preferred=bestStyle(c);
    if(!styleMemory||scores[preferred]>scores[styleMemory]+8) styleMemory=preferred;

    if(c.dead) return {action:"stop",style:styleMemory,priority:10000,reason:"dead"};
    if(emergency&&has(c,"totem")) return {action:"totem",style:"utility",priority:9900,reason:"emergency_totem"};
    if(emergency&&has(c,"pearl")&&d>=4) return {action:"pearl_escape",style:"utility",priority:9800,reason:"emergency_escape"};
    if(low&&has(c,"heal")&&d>=num(c.healDistanceMin,4.2)) return {action:"heal",style:"utility",priority:9700,reason:"safe_heal_window"};
    if(c.hazard&&has(c,"water")) return {action:"water_clutch",style:"utility",priority:9600,reason:"hazard_recovery"};
    if(c.projectileThreat&&has(c,"shield")&&d>3) return {action:"shield",style:"shield",priority:9500,reason:"projectile_defense"};

    if(e.shield&&has(c,"axe")&&d<=3.4&&attackReady) return {action:"shield_break",style:"axe",priority:9400,reason:"shield_counter"};
    if(e.usingItem&&e.shield&&has(c,"axe")&&d<=3.4&&attackReady) return {action:"shield_break",style:"axe",priority:9400,reason:"shield_bait_counter"};
    if(e.totemPopped&&d<=5&&has(c,"burst")) return {action:"finish",style:styleMemory,priority:9300,reason:"totem_pop_finish"};
    if(e.healing&&has(c,"debuff")&&d<=8) return {action:"debuff",style:"utility",priority:9200,reason:"punish_heal"};

    // Genuine Elytra + mace sequence. It outranks ordinary mace only when the
    // controller confirms the flight prerequisites.
    if(has(c,"elytraMace")&&c.elytraMaceReady&&invHas(c,"mace")){
      if(d>=7||c.heightAdvantage) return {action:"elytra_mace",style:"elytra",priority:9100,reason:"elytra_mace_setup"};
    }

    if(e.airborne&&e.falling&&has(c,"mace")&&d<=6.2&&attackReady)
      return {action:"mace_dive",style:"mace",priority:9000,reason:"airborne_mace_window"};
    if(styleMemory==="mace"&&has(c,"mace")&&d>3.1&&d<=7)
      return {action:"mace_approach",style:"mace",priority:7000,reason:"mace_geometry"};

    if(styleMemory==="crystal"&&c.crystalCycleSafe&&d<=6)
      return {action:"crystal_cycle",style:"crystal",priority:8900,reason:"safe_crystal_cycle"};
    if(styleMemory==="anchor"&&c.anchorCycleSafe&&d<=7)
      return {action:"anchor_cycle",style:"anchor",priority:8800,reason:"safe_anchor_cycle"};

    if((styleMemory==="bow"||styleMemory==="crossbow")&&d>=7&&c.lineOfSight)
      return {action:"ranged_attack",style:styleMemory,priority:7600,reason:"ranged_spacing"};
    if(d>=8&&e.retreating&&has(c,"pearl")&&has(c,"burst"))
      return {action:"pearl_ambush",style:"utility",priority:7500,reason:"close_retreat"};

    if(styleMemory==="spear"&&has(c,"spear")&&d>=3&&d<=4.75&&attackReady)
      return {action:"spear_pressure",style:"spear",priority:7400,reason:"spear_range"};
    if(styleMemory==="axe"&&has(c,"axe")&&d<=3.2&&attackReady)
      return {action:"melee_attack",style:"axe",priority:7300,reason:"axe_attack"};
    if(styleMemory==="sword"&&has(c,"sword")&&d<=3.05&&attackReady){
      if(falling&&!onGround&&num(c.fallDistance)>=.45) return {action:"falling_crit",style:"sword",priority:7800,reason:"falling_crit"};
      if(e.airborne&&c.hitSelectReady) return {action:"hit_select",style:"sword",priority:7350,reason:"hit_select"};
      return {action:"melee_attack",style:"sword",priority:7200,reason:"sword_attack"};
    }

    if(c.knockbacked) return {action:"reposition",style:styleMemory,priority:6100,reason:"knockback_recovery"};
    if(c.stuck) return {action:"unstuck",style:"utility",priority:6000,reason:"movement_recovery"};
    if(!c.lineOfSight) return {action:"reacquire",style:styleMemory,priority:5900,reason:"lost_los"};

    if(d<2.0) return {action:"defensive_strafe",style:styleMemory,priority:5700,reason:"too_close"};
    if(d>3.2&&d<7&&has(c,"melee")) return {action:"approach",style:styleMemory,priority:5600,reason:"close_distance"};
    if(d<=4.5) return {action:"strafe_pressure",style:styleMemory,priority:5400,reason:"maintain_pressure"};
    if(has(c,"projectileDodge")&&c.projectileThreat) return {action:"dodge_projectile",style:"utility",priority:5300,reason:"projectile_dodge"};

    return {action:"approach",style:styleMemory,priority:3000,reason:"default_engagement"};
  }

  return {
    version:PVP_EXPERT_BRAIN_VERSION,
    styles:STYLES,
    decide,
    inspect:ctx=>({style:styleMemory||bestStyle(ctx),scores:styleScores(ctx),lastAction,lastActionAt}),
    noteAction:a=>{lastAction=a;lastActionAt=Date.now()}
  };
}
export default createPvpExpertBrain;
