/**
 * ZOYA PvP Expert Brain v2
 * Deterministic tactical policy. No training, learning, or adaptive telemetry.
 *
 * Contract: every returned action has a feasibility gate represented by ctx.
 * The controller is the sole physical executor.
 */
import { THEO_PVP_DIFFICULTY } from "./pvpDifficulty.mjs";

const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const has=(c,k)=>c?.capabilities?.[k]===true;
const invHas=(c,k)=>num(c?.inventory?.[k])>0;

export const PVP_EXPERT_BRAIN_VERSION="pvp-expert-brain-v4-theo-impossible";

const STYLES=Object.freeze([
  "sword","axe","mace","spear","crystal","anchor","bow","crossbow",
  "shield","elytra","utility"
]);

function styleScores(c){
  const d=num(c.distance,Infinity), e=c.enemy||{}, s={};
  for(const k of STYLES) s[k]=-1000;

  // A mace in the inventory is not, by itself, a reason to select mace.
  // The old base score (52) made it the default style even on flat ground,
  // where the executor could not produce a smash and fell back to strafing.
  // Promote it only when the controller has verified a real launch/smash or
  // Elytra setup window; height is a modest opportunity, not a permanent lock.
  if(invHas(c,"mace")) s.mace=12+(c.selfMaceSmashReady?62:0)+(c.windMaceSmashReady?54:0)+(c.elytraMaceReady?58:0)+(c.heightAdvantage?10:0)-(d>8?28:0);
  if(invHas(c,"spear")) s.spear=20+(d>=3&&d<=5?35:0)+(e.retreating?12:0);
  if(invHas(c,"axe")) s.axe=50+(e.shield?42:0)+(d<=3.5?15:0);
  if(invHas(c,"sword")) s.sword=48+(d<=3.15?32:0)+(e.airborne?14:0);
  if(invHas(c,"bow")) s.bow=30+(d>=7?35:0)+(e.retreating?18:0);
  if(invHas(c,"crossbow")) s.crossbow=34+(d>=8?35:0)+(e.retreating?18:0);
  if(invHas(c,"crystal")&&invHas(c,"obsidian")) s.crystal=38+(c.crystalArena?38:0)+(d<=6?18:0);
  if(invHas(c,"respawn_anchor")&&invHas(c,"glowstone")&&c.anchorArena) s.anchor=42+(d<=7?25:0);
  if(c.elytraEquipped&&invHas(c,"mace")) s.elytra=60+(c.elytraMaceReady?70:0)+(d>7?15:0);
  if(invHas(c,"shield")) s.shield=18+(e.meleeThreat?30:0)+(c.projectileThreat?35:0);
  s.utility=15+(c.projectileThreat?30:0)+(c.hazard?30:0);
  return s;
}

function bestStyle(c){
  const s=styleScores(c);
  return Object.keys(s).reduce((a,b)=>s[b]>s[a]?b:a,"utility");
}

export function createPvpExpertBrain(options={}){
  const difficulty=options.difficulty||THEO_PVP_DIFFICULTY;
  let styleMemory=null;
  let styleLockUntil=0;
  let lastAction=null;
  let lastActionAt=0;

  function decide(ctx={}){
    const c=ctx||{}, e=c.enemy||{}, d=num(c.distance,Infinity);
    const now=Date.now();
    const hp=num(c.health,20), maxHp=Math.max(1,num(c.maxHealth,20));
    // Treat 12 HP as the low-health decision boundary and 10 HP as an
    // emergency. Five modern mace contacts can outpace a golden-apple heal;
    // waiting until 8 HP makes the first defensive action too late.
    const low=hp<=Math.min(12,maxHp*.6), emergency=hp<=Math.min(10,maxHp*.5);
    const falling=Boolean(c.falling), onGround=c.onGround!==false;
    const attackReady=num(c.attackReadyAt,0)<=Date.now();
    const scores=styleScores(c), preferred=bestStyle(c);
    // Keep a deliberate style lock to avoid weapon thrashing, but never let
    // that lock suppress the basic sword combo when the duel has collapsed
    // into ordinary melee range. Previously a mace/spear selected at 4-5m
    // could remain committed for nearly a second at 2.5m, producing strafes
    // instead of attacks while the opponent was already in reach.
    const urgentMeleeFallback=d<=3.05&&has(c,"sword")&&preferred==="sword"&&styleMemory!=="sword";
    if(!styleMemory||(!c.hardCounter&&(now>=styleLockUntil||urgentMeleeFallback)&&scores[preferred]>scores[styleMemory]+Number(difficulty.styleSwitchMargin||18))){
      styleMemory=preferred;
      styleLockUntil=now+Number(difficulty.styleLockMs||450);
    }

    if(c.dead) return {action:"stop",style:styleMemory,priority:10000,reason:"dead"};
    // If the opponent has a mace in hand inside burst range and health is
    // dropping, equip an available totem first; otherwise use a validated
    // pearl or create a real distance buffer. Never try to eat through it.
    if(c.enemyMaceHeldClose&&hp<=14){
      if(has(c,"totem")&&!c.totemEquipped)
        return {action:"totem",style:"utility",priority:9990,reason:"mace_burst_equip_totem"};
      if(c.recoveryPearlReady&&c.pearlEscapeReady&&d>=2.8)
        return {action:"pearl_escape",style:"utility",priority:9980,reason:"mace_burst_escape"};
      return {action:"emergency_disengage",style:"utility",priority:9970,reason:"mace_burst_evade"};
    }
    // Emergency survival is a sequence, not a repeated single action:
    // equip the totem once, immediately create distance, then heal/re-engage.
    if(emergency){
      if(c.enemyMaceThreat&&c.pearlEscapeReady&&c.maceEscapeReady)
        return {action:"pearl_escape",style:"utility",priority:9950,reason:"emergency_mace_escape"};
      // If a validated pearl can break melee range, teleport before spending
      // a tick equipping a totem or attempting to eat under immediate pressure.
      if(c.recoveryPearlReady&&c.pearlEscapeReady&&d<4.75)
        return {action:"pearl_escape",style:"utility",priority:9945,reason:"critical_health_close_pearl_escape"};
      if(c.enemyMaceThreat&&has(c,"totem")&&!c.totemEquipped)
        return {action:"totem",style:"utility",priority:9940,reason:"emergency_mace_totem"};
      if(c.enemyMaceThreat)
        return {action:"emergency_disengage",style:"utility",priority:9930,reason:"emergency_mace_evade_no_totem"};
      if(has(c,"totem")&&!c.totemEquipped)
        return {action:"totem",style:"utility",priority:9900,reason:"emergency_totem"};
      if(c.recoveryPearlReady&&c.pearlEscapeReady)
        return {action:"pearl_escape",style:"utility",priority:9880,reason:"emergency_pearl_recovery"};
      // Recovery lock controls movement only; it must never suppress a heal
      // after ZOYA has already created the safe gap. The old ordering held
      // position for the entire lock even at safe distance, wasting golden-apple
      // regeneration time while health was critical.
      if(has(c,"heal")&&d>=4.75)
        return {action:"heal",style:"utility",priority:9910,reason:"emergency_heal_safe_gap"};
      // If close and a validated landing exists, spend a pearl to create the
      // gap instead of repeatedly running into the same retreat lock.
      if(c.recoveryPearlReady&&c.pearlEscapeReady&&d<4.75)
        return {action:"pearl_escape",style:"utility",priority:9900,reason:"emergency_pearl_create_gap"};
      if(c.emergencyRetreatUntil&&now<c.emergencyRetreatUntil)
        return {action:d>=4.75?"emergency_hold":"emergency_disengage",style:"utility",priority:9890,reason:d>=4.75?"emergency_safe_distance_hold":"emergency_retreat_lock"};
      if(has(c,"heal")&&d<4.75)
        return {action:"emergency_disengage",style:"utility",priority:9800,reason:"emergency_heal_distance"};
      if(has(c,"pearl")&&c.pearlEscapeReady)
        return {action:"pearl_escape",style:"utility",priority:9700,reason:"emergency_escape"};
      // Match the controller's actual retreat target: once there is a 4.25-block
      // gap, hold it. Requiring 7.5 blocks made the controller repeatedly restart
      // its own emergency lock and could keep it in retreat mode indefinitely.
      if(d>=4.75) return {action:"emergency_hold",style:"utility",priority:9640,reason:"emergency_safe_distance"};
      return {action:"emergency_disengage",style:"utility",priority:9650,reason:"emergency_no_heal"};
    }
    if(c.enemyMaceThreat&&c.pearlEscapeReady&&c.maceEscapeReady)
      return {action:"pearl_escape",style:"utility",priority:9870,reason:"mace_attack_escape"};
    if(c.enemyMaceThreat&&has(c,"totem")&&!c.totemEquipped)
      return {action:"totem",style:"utility",priority:9860,reason:"mace_burst_totem"};
    if(c.enemyMaceThreat)
      return {action:"emergency_disengage",style:"utility",priority:9855,reason:"mace_evade_no_totem"};
    if((c.enemyMaceThreat||c.enemyMaceHeldClose)&&has(c,"totem")&&!c.totemEquipped&&c.health<=10)
      return {action:"totem",style:"utility",priority:9850,reason:"mace_burst_totem"};
    if(c.enemyMaceThreat&&has(c,"totem")&&!c.totemEquipped)
      return {action:"totem",style:"utility",priority:9845,reason:"mace_burst_totem"};
    if(c.enemyBurstThreat&&has(c,"totem")&&!c.totemEquipped)
      return {action:"totem",style:"utility",priority:9840,reason:"burst_threat_totem"};
    // At low health, a validated pearl is a tactical disengage when the
    // opponent is too close to eat safely. Otherwise preserve the golden apple.
    if(low&&c.recoveryPearlReady&&c.pearlEscapeReady&&d<num(c.healDistanceMin,4.2))
      return {action:"pearl_escape",style:"utility",priority:9710,reason:"low_health_pearl_escape"};
    if(low&&has(c,"heal")&&d>=num(c.healDistanceMin,4.2)) return {action:"heal",style:"utility",priority:9700,reason:"safe_heal_window"};
    if(c.pearlCatchReady)
      return {action:c.diagonalPearlCatchReady?"diagonal_pearl_catch":"pearl_catch",style:"utility",priority:9670,reason:c.diagonalPearlCatchReady?"diagonal_pearl_wind_catch":"pearl_wind_catch"};
    if(c.webbed) return {action:"web_escape",style:"utility",priority:9650,reason:"cobweb_escape"};
    if(c.hazard&&has(c,"water")) return {action:"water_clutch",style:"utility",priority:9600,reason:"hazard_recovery"};
    if(c.stunSlamReady&&has(c,"axe")&&has(c,"mace"))
      return {action:"stun_slam",style:"mace",priority:9420,reason:"falling_shield_stun_slam"};
    if(e.shield&&has(c,"axe")&&d>=2.45&&d<=3.4&&attackReady&&c.shieldDrainReady)
      return {action:"shield_drain",style:"axe",priority:9410,reason:"shield_drain_sequence"};
    if(c.windCancelReady&&has(c,"wind")&&d>=3&&d<=7)
      return {action:"wind_charge_cancel",style:"utility",priority:9390,reason:"cancel_airborne_approach"};
    if(c.backstabReady&&has(c,"sword")&&d>=2.15&&d<=3.05&&attackReady)
      return {action:"backstab",style:"sword",priority:7380,reason:"verified_rear_arc"};
    if(c.pearlGrappleReady&&c.recoveryPearlReady&&has(c,"pearl")&&d>=9&&d<=15&&e.retreating)
      return {action:"pearl_grapple",style:"utility",priority:7520,reason:"far_pearl_intercept"};
    if(c.projectileThreat&&c.shieldReady&&has(c,"shield")&&d>2.2) return {action:"shield",style:"shield",priority:9530,reason:"projectile_defense"};
    // Briefly block an advancing melee opponent when shield is available. Do not
    // raise it at point-blank collision range, during a mace burst escape, or
    // against an opponent already shielding (axe counter logic handles that).
    if(c.meleeBlockReady&&c.shieldReady&&has(c,"shield")&&d>=2.65&&d<=4.25&&!e.shield) return {action:"shield",style:"shield",priority:9520,reason:"incoming_melee_block"};
    if(c.projectileThreat&&c.projectileDodge) return {action:"dodge_projectile",style:"utility",priority:9490,reason:"projectile_dodge"};
    if(e.retreating&&d>=4&&d<=9&&has(c,"rod")) return {action:"rod_control",style:"utility",priority:7550,reason:"rod_control"};

    if(e.shield&&has(c,"axe")&&d>=2.45&&d<=3.4&&attackReady) return {action:"shield_break",style:"axe",priority:9400,reason:"shield_counter"};
    if(e.usingItem&&e.shield&&has(c,"axe")&&d>=2.45&&d<=3.4&&attackReady) return {action:"shield_break",style:"axe",priority:9400,reason:"shield_bait_counter"};

    // The pop signal has a short lifetime; spend it on immediate melee pressure.
    if(e.totemPopped&&d<=3.05&&has(c,"sword")){
      if(attackReady) return {action:"finish",style:"sword",priority:9600,reason:"totem_pop_sword_finish"};
      return {action:"finish_wait",style:"sword",priority:9590,reason:"totem_pop_wait_for_attack_cooldown"};
    }
    if(e.totemPopped&&d>3.05&&d<=5&&has(c,"melee"))
      return {action:"approach",style:styleMemory||"sword",priority:9550,reason:"totem_pop_pressure"};
    if(e.totemPopped&&d>5&&d<=12&&has(c,"pearl")) return {action:"pearl_ambush",style:"utility",priority:9250,reason:"punish_totem_pop"};

    // Retreat only when body overlap makes aim/attack unreliable. The old
    // 2.45-block cutoff forced ZOYA to back away while still inside sword
    // reach; that wasted attack windows and made her far too passive.
    if(d<1.85) return {action:"spacing_retreat",style:styleMemory||"sword",priority:8100,reason:"too_close_spacing"};
    if(c.spacingLockUntil&&now<c.spacingLockUntil&&d<3.05)
      return {action:"spacing_hold",style:styleMemory||"sword",priority:8050,reason:"spacing_recovery_window"};
    if(e.healing&&has(c,"debuff")&&d<=8) return {action:"debuff",style:"utility",priority:9200,reason:"punish_heal"};

    // Genuine Elytra + mace sequence. It outranks ordinary mace only when the
    // controller confirms the flight prerequisites.
    if(c.windMaceSmashReady&&has(c,"mace")&&d>=3.5&&d<=6.5&&c.lineOfSight&&c.health>7)
      return {action:"wind_mace_launch",style:"mace",priority:9080,reason:"wind_charge_mace_setup"};

    if(c.elytraStunSlamReady&&has(c,"elytraMace")&&c.elytraLaunchReady&&invHas(c,"mace"))
      return {action:"elytra_mace",style:"elytra",priority:9120,reason:"elytra_shield_stun_slam"};
    if(c.rocketMaceReady&&has(c,"elytraMace")&&c.elytraLaunchReady&&invHas(c,"mace")&&d>=7)
      return {action:"rocket_mace",style:"elytra",priority:9110,reason:"firework_rocket_mace"};
    if(has(c,"elytraMace")&&c.elytraMaceReady&&c.elytraLaunchReady&&invHas(c,"mace")){
      if(d>=7||c.heightAdvantage) return {action:"elytra_mace",style:"elytra",priority:9100,reason:"elytra_mace_setup"};
    }

    if(c.windChargeResetReady&&has(c,"wind")&&has(c,"mace")&&d>=2.25&&d<=3.25&&attackReady)
      return {action:"wind_charge_reset",style:"mace",priority:9070,reason:"midair_wind_charge_fall_reset"};
    if(c.maceCrystalDTapReady&&c.selfMaceSmashReady&&has(c,"mace")&&has(c,"crystal")&&d<=3.1&&attackReady)
      return {action:"mace_d_tap",style:"mace",priority:9075,reason:"mace_then_crystal_d_tap"};
    if(c.maceAttributeSwapReady&&has(c,"mace")&&has(c,"sword")&&d<=3.1&&attackReady)
      return {action:"mace_attribute_swap",style:"mace",priority:9060,reason:"mace_attribute_swap"};
    if(c.selfMaceSmashReady&&has(c,"mace")&&d<=3.1&&attackReady)
      return {action:"mace_dive",style:"mace",priority:9050,reason:"self_mace_smash_window"};
    if(e.airborne&&e.falling&&has(c,"mace")&&d<=6.2&&attackReady)
      return {action:"mace_approach",style:"mace",priority:7000,reason:"enemy_airborne_mace_geometry"};
    if(styleMemory==="mace"&&has(c,"mace")&&d>3.1&&d<=7)
      return {action:"mace_approach",style:"mace",priority:7000,reason:"mace_geometry"};

    if(styleMemory==="crystal"&&c.crystalCycleSafe&&d<=6)
      return {action:"crystal_cycle",style:"crystal",priority:8900,reason:"safe_crystal_cycle"};
    if(styleMemory==="anchor"&&c.anchorCycleSafe&&d<=7)
      return {action:"anchor_cycle",style:"anchor",priority:8800,reason:"safe_anchor_cycle"};

    if((styleMemory==="bow"||styleMemory==="crossbow")&&d>=7&&c.lineOfSight)
      return {action:"ranged_attack",style:styleMemory,priority:7600,reason:"ranged_spacing"};
    if(c.recoveryPearlReady&&c.pearlEscapeReady&&c.recoveryPearlReady&&(
      c.knockbacked||c.stuck||c.hazard||c.badPosition
    ))
      return {action:"pearl_recover",style:"utility",priority:7350,reason:"tactical_recovery"};
    if(d>=6&&d<=12&&e.retreating&&has(c,"pearl")&&has(c,"burst")&&c.pearlAmbushReady)
      return {action:"pearl_ambush",style:"utility",priority:7500,reason:"close_retreat"};

    if(styleMemory==="spear"&&has(c,"spear")&&d>=3&&d<=4.75&&attackReady)
      return {action:"spear_pressure",style:"spear",priority:7400,reason:"spear_range"};
    if(styleMemory==="axe"&&has(c,"axe")&&d>=1.75&&d<=3.2&&attackReady)
      return {action:"melee_attack",style:"axe",priority:7300,reason:"axe_attack"};
    if(styleMemory==="sword"&&has(c,"sword")&&d>=1.75&&d<=3.05&&attackReady){
      if(falling&&!onGround&&num(c.fallDistance)>=.45&&d>=Number(difficulty.critMinRange||2.45)) return {action:"falling_crit",style:"sword",priority:7800,reason:"falling_crit"};
      if(c.hitSelectReady&&attackReady&&d>=2.35) return {action:"hit_select",style:"sword",priority:7350,reason:"landing_timed_hit_select"};
      return {action:"melee_attack",style:"sword",priority:7200,reason:"sword_attack"};
    }

    if(c.knockbacked) return {action:"reposition",style:styleMemory,priority:6100,reason:"knockback_recovery"};
    if(c.stuck) return {action:"unstuck",style:"utility",priority:6000,reason:"movement_recovery"};
    if(!c.lineOfSight) return {action:"reacquire",style:styleMemory,priority:5900,reason:"lost_los"};

    
    if(d>Number(difficulty.attackRange||3.05)&&d<7&&has(c,"melee")) return {action:"approach",style:styleMemory,priority:5600,reason:"close_distance"};
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
