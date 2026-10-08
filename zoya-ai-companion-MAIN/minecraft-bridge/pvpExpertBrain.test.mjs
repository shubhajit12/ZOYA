import assert from "node:assert/strict";
import { createPvpExpertBrain } from "./pvpExpertBrain.mjs";

const makeBrain=()=>createPvpExpertBrain();

const base={
  health:20,maxHealth:20,food:20,distance:4,onGround:true,falling:false,fallDistance:0,
  heightAdvantage:false,lineOfSight:true,projectileThreat:false,hazard:false,
  hasMelee:true,hasSword:true,hasAxe:true,hasMace:true,hasSpear:true,hasShield:true,
  hasPearl:true,hasTotem:true,hasHeal:true,hasWaterBucket:true,hasBurst:true,
  attackReadyAt:0,healDistanceMin:4.2,
  capabilities:{melee:true,sword:true,axe:true,mace:true,spear:true,shield:true,pearl:true,totem:true,heal:true,water:true,burst:true},
  inventory:{sword:1,axe:1,mace:1,spear:1,obsidian:0,crystal:0,respawn_anchor:0,glowstone:0},
  enemy:{health:20,shield:false,airborne:false,falling:false,velocityY:0,retreating:false,totemPopped:false,meleeThreat:true}
};

{
  const d=makeBrain().decide({...base,distance:5.5});
  assert.notEqual(d.action,"spear_pressure","spear pressure must never be selected beyond the executor's 5.0m contract");
}

{
  const d=makeBrain().decide({...base,distance:8,elytraEquipped:true,elytraMaceReady:true,elytraLaunchReady:true,
    capabilities:{...base.capabilities,elytraMace:true}});
  assert.equal(d.action,"elytra_mace");
  assert.equal(d.style,"elytra");
}

{
  const d=makeBrain().decide({...base,distance:4,inventory:{...base.inventory,crystal:4,obsidian:16},
    crystalArena:true,crystalCycleSafe:true,capabilities:{...base.capabilities,burst:true,crystalCycleSafe:true}});
  assert.equal(d.action,"crystal_cycle");
}

{
  const d=makeBrain().decide({...base,health:5,hasTotem:true});
  assert.equal(d.action,"totem");
}

console.log("PvP Expert Brain deterministic tests passed.");


{
  const d=makeBrain().decide({...base,webbed:true});
  assert.equal(d.action,"web_escape");
}

{
  const d=makeBrain().decide({...base,projectileThreat:true,projectileDodge:true,distance:6,capabilities:{...base.capabilities,shield:false}});
  assert.equal(d.action,"dodge_projectile");
}

{
  const d=makeBrain().decide({...base,distance:4,enemy:{...base.enemy,totemPopped:true},capabilities:{...base.capabilities,burst:true}});
  assert.equal(d.action,"finish");
}

{
  const d=makeBrain().decide({...base,health:5,distance:3.2,totemEquipped:true,capabilities:{...base.capabilities,totem:true}});
  assert.equal(d.action,"emergency_disengage");
}

console.log("PvP Expert expanded deterministic tests passed.");


{
  const d=makeBrain().decide({...base,distance:25,enemy:{...base.enemy,retreating:true},capabilities:{...base.capabilities,pearl:true,burst:true}});
  assert.notEqual(d.action,"pearl_ambush");
}

{
  const d=makeBrain().decide({...base,distance:8,enemy:{...base.enemy,retreating:true},pearlAmbushReady:true,capabilities:{...base.capabilities,pearl:true,burst:true}});
  assert.equal(d.action,"pearl_ambush");
}

{
  const d=makeBrain().decide({...base,distance:5,enemyBurstThreat:true,totemEquipped:false,capabilities:{...base.capabilities,totem:true}});
  assert.equal(d.action,"totem");
}

{
  const d=makeBrain().decide({...base,distance:9,elytraMaceReady:true,elytraLaunchReady:false,capabilities:{...base.capabilities,mace:true,elytraMace:true}});
  assert.notEqual(d.action,"elytra_mace");
}

console.log("PvP Expert burst/pearl/Elytra gating tests passed.");


{
  const d=makeBrain().decide({...base,distance:4.5,enemyMaceThreat:true,pearlEscapeReady:true,maceEscapeReady:true});
  assert.equal(d.action,"pearl_escape","an active mace threat should trigger a defensive pearl when a safe pearl is available");
}

{
  const d=makeBrain().decide({...base,distance:3.2,enemyMaceThreat:true,pearlEscapeReady:false,totemEquipped:false});
  assert.equal(d.action,"totem","without a safe pearl, burst defense must pre-arm the totem");
}

{
  const d=makeBrain().decide({...base,distance:2.8,selfMaceSmashReady:true,attackReadyAt:0});
  assert.equal(d.action,"mace_dive","a real falling mace window must select the smash executor");
}

{
  const d=makeBrain().decide({...base,distance:5,windMaceSmashReady:true,attackReadyAt:0});
  assert.equal(d.action,"wind_mace_launch","wind charge + mace should be a chained smash action, not a standalone wind throw");
}

{
  const d=makeBrain().decide({...base,distance:8,recoveryPearlReady:true,pearlEscapeReady:true,knockbacked:true});
  assert.equal(d.action,"pearl_recover","recovery pearl should be available for severe displacement");
}

{
  const d=makeBrain().decide({...base,distance:8,enemy:{...base.enemy,retreating:true},pearlAmbushReady:false,capabilities:{...base.capabilities,pearl:true,burst:true}});
  assert.notEqual(d.action,"pearl_ambush","offensive pearl must be blocked when the controller has not validated a safe landing");
}

console.log("PvP Expert tactical pearl/mace regression tests passed.");


{
  const d=makeBrain().decide({...base,distance:2.5,windMaceSmashReady:true});
  assert.notEqual(d.action,"wind_mace_launch","wind-charge mace setup must not fire point-blank");
}

{
  const d=makeBrain().decide({...base,distance:4.5,enemyMaceThreat:true,pearlEscapeReady:true,maceEscapeReady:false});
  assert.notEqual(d.action,"pearl_escape","defensive pearl must respect the controller's anti-spam/real-threat gate");
}


{
  const d=makeBrain().decide({...base,distance:3.0,falling:true,onGround:false,fallDistance:0.6,hasSpear:false,capabilities:{...base.capabilities,spear:false},inventory:{...base.inventory,spear:0}});
  assert.equal(d.action,"falling_crit","Theo-impossible profile should preserve a real falling crit window");
}

{
  const d=makeBrain().decide({...base,distance:3.0,falling:false,onGround:true,fallDistance:0,hitSelectReady:true,enemy:{...base.enemy,airborne:true}});
  assert.equal(d.action,"hit_select","Theo-impossible profile should use hit-select against an airborne target when no higher-priority counter applies");
}

{
  const d=makeBrain().decide({...base,distance:0.8});
  assert.equal(d.action,"defensive_strafe","ordinary melee must never attack from point-blank collision range");
}

{
  const d=makeBrain().decide({...base,distance:2.0,enemy:{...base.enemy,shield:true}});
  assert.equal(d.action,"defensive_strafe","shield counter must also respect the minimum spacing gate");
}

{
  const d=makeBrain().decide({...base,distance:2.6,enemy:{...base.enemy,shield:true}});
  assert.equal(d.action,"shield_break","shield break remains available at valid melee spacing");
}

console.log("Theobald-impossible difficulty regression tests passed.");
