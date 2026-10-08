/**
 * ZOYA PvP Expert Brain v1
 * Pure tactical decision layer. No Mineflayer calls and no learning/training.
 *
 * Architecture: perception -> tactical posture -> style selection -> action.
 * The controller is the only physical executor.
 */
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const bool=v=>v===true;

export const PVP_EXPERT_BRAIN_VERSION="pvp-expert-brain-v1";

const STYLES=Object.freeze([
  "sword","axe","mace","spear","crystal","anchor","bow","crossbow",
  "shield","elytra","utility"
]);

function weaponAvailable(inv, names){
  return names.some(n=>inv?.[n]>0);
}

function scoreStyles(c){
  const inv=c.inventory||{};
  const e=c.enemy||{};
  const d=num(c.distance,Infinity);
  const scores={};
  for(const s of STYLES) scores[s]=-1000;

  if(weaponAvailable(inv,["mace"])) scores.mace=72+(e.airborne?35:0)+(e.falling?45:0)+(c.heightAdvantage?18:0)-(d>7?20:0);
  if(weaponAvailable(inv,["spear"])) scores.spear=58+(d>3&&d<6?25:0)+(e.shield?8:0);
  if(weaponAvailable(inv,["crystal"])&&weaponAvailable(inv,["obsidian"])) scores.crystal=55+(d<6?25:0)+(e.totem?20:0)+(c.crystalArena?30:0);
  if(weaponAvailable(inv,["respawn_anchor"])&&weaponAvailable(inv,["glowstone"])) scores.anchor=45+(c.nether?35:0);
  if(weaponAvailable(inv,["bow"])) scores.bow=35+(d>7?35:0)+(e.retreating?20:0);
  if(weaponAvailable(inv,["crossbow"])) scores.crossbow=38+(d>8?32:0)+(e.retreating?20:0);
  if(weaponAvailable(inv,["axe"])) scores.axe=52+(e.shield?35:0)+(d<3.5?12:0);
  if(weaponAvailable(inv,["sword"])) scores.sword=50+(d<3.2?28:0)+(e.airborne?12:0);
  if(inv.shield>0) scores.shield=20+(e.meleeThreat?25:0);
  scores.utility=18+(c.projectileThreat?25:0)+(c.hazard?20:0);

  return scores;
}

function bestStyle(c){
  const scores=scoreStyles(c);
  return Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0];
}

export function createPvpExpertBrain(options={}){
  let styleMemory=null;
  let lastAction=null;
  let lastActionAt=0;

  function decide(ctx={}){
    const c=ctx||{};
    const d=num(c.distance,Infinity);
    const hp=num(c.health,20);
    const maxHp=Math.max(1,num(c.maxHealth,20));
    const ehp=num(c.enemy?.health,20);
    const food=num(c.food,20);
    const enemy=c.enemy||{};
    const inv=c.inventory||{};
    const cd=Math.max(0,num(c.attackReadyAt,0)-Date.now());
    const los=c.lineOfSight!==false;
    const onGround=c.onGround!==false;
    const falling=bool(c.falling);
    const fallDistance=num(c.fallDistance,0);
    const projectileThreat=bool(c.projectileThreat);
    const hazard=bool(c.hazard);
    const emergency=hp<=Math.min(6,maxHp*.30);
    const low=hp<=Math.min(10,maxHp*.50);

    const styleScores=scoreStyles(c);
    const preferred=bestStyle(c);
    if(styleMemory && styleScores[styleMemory] >= styleScores[preferred]-8) styleMemory=styleMemory;
    else styleMemory=preferred;

    // Survival and hard counters always outrank damage.
    if(c.dead) return {action:"stop",style:styleMemory,reason:"dead"};
    if(emergency && c.hasTotem) return {action:"totem",style:"utility",priority:1000,reason:"emergency_totem"};
    if(emergency && c.hasPearl && d>=4) return {action:"pearl_escape",style:"utility",priority:980,reason:"emergency_escape"};
    if(low && c.hasHeal && d>=c.healDistanceMin) return {action:"heal",style:"utility",priority:950,reason:"safe_heal_window"};
    if(projectileThreat && c.hasShield && d>3) return {action:"shield",style:"shield",priority:900,reason:"projectile_defense"};
    if(hazard && c.hasWaterBucket) return {action:"water_clutch",style:"utility",priority:890,reason:"hazard_recovery"};

    // Counter-play.
    if(enemy.shield && c.hasAxe && d<=3.5) return {action:"shield_break",style:"axe",priority:860,reason:"shield_counter"};
    if(enemy.airborne && c.hasMace && d<=6.5 && (enemy.falling||enemy.velocityY<-.1))
      return {action:"mace_drop",style:"mace",priority:850,reason:"airborne_mace_window"};
    if(enemy.totemPopped && d<=5 && c.hasBurst) return {action:"finish",style:styleMemory,priority:840,reason:"totem_pop_finish"};
    if(enemy.healing && d<=8 && c.hasDebuff) return {action:"debuff",style:"utility",priority:830,reason:"punish_heal"};

    // Crystal/anchor styles require explicit resource and geometry support.
    if(styleMemory==="crystal" && c.crystalPlacementSafe && d<=7)
      return {action:"crystal_cycle",style:"crystal",priority:800,reason:"crystal_window"};
    if(styleMemory==="anchor" && c.anchorPlacementSafe && d<=7)
      return {action:"anchor_cycle",style:"anchor",priority:790,reason:"anchor_window"};

    // Ranged posture.
    if((styleMemory==="bow"||styleMemory==="crossbow") && d>=7 && los)
      return {action:"ranged_attack",style:styleMemory,priority:700,reason:"ranged_spacing"};
    if(d>6 && c.hasPearl && enemy.retreating && c.hasBurst)
      return {action:"pearl_ambush",style:"utility",priority:690,reason:"close_retreat"};

    // Mace/spear have their own preferred engagement geometry.
    if(styleMemory==="mace" && c.hasMace){
      if(d>6 && c.heightAdvantage) return {action:"mace_approach",style:"mace",priority:650,reason:"mace_height_setup"};
      if(d<=6 && enemy.airborne) return {action:"mace_dive",style:"mace",priority:670,reason:"mace_dive"};
    }
    if(styleMemory==="spear" && c.hasSpear && d>3 && d<=7)
      return {action:"spear_pressure",style:"spear",priority:640,reason:"spear_range"};

    // Core melee.
    if(styleMemory==="axe" && c.hasAxe && d<=3.4 && cd<=0) return {action:"melee_attack",style:"axe",priority:620,reason:"axe_attack"};
    if(styleMemory==="sword" && c.hasSword && d<=3.1 && cd<=0){
      if(falling&&!onGround&&fallDistance>=.45) return {action:"falling_crit",style:"sword",priority:650,reason:"falling_crit"};
      if(enemy.airborne) return {action:"jump_reset",style:"sword",priority:610,reason:"airborne_pressure"};
      return {action:"melee_attack",style:"sword",priority:600,reason:"sword_attack"};
    }

    // Defensive movement and spacing.
    if(d<2.0) return {action:"defensive_strafe",style:styleMemory,priority:540,reason:"too_close"};
    if(d>3.8 && d<7.0 && c.hasMelee) return {action:"approach",style:styleMemory,priority:500,reason:"close_distance"};
    if(d<=4.5) return {action:"strafe_pressure",style:styleMemory,priority:480,reason:"maintain_pressure"};

    // Recovery / repositioning.
    if(c.knockbacked) return {action:"reposition",style:styleMemory,priority:470,reason:"knockback_recovery"};
    if(c.stuck) return {action:"unstuck",style:"utility",priority:460,reason:"movement_recovery"};
    if(!los) return {action:"reacquire",style:styleMemory,priority:450,reason:"lost_los"};

    return {action:"approach",style:styleMemory,priority:300,reason:"default_engagement"};
  }

  return {
    version:PVP_EXPERT_BRAIN_VERSION,
    styles:STYLES,
    decide,
    inspect:ctx=>({style:styleMemory||bestStyle(ctx),scores:scoreStyles(ctx),lastAction,lastActionAt}),
    noteAction:(action)=>{lastAction=action;lastActionAt=Date.now();}
  };
}

export default createPvpExpertBrain;
