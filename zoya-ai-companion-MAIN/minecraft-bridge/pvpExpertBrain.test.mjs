import assert from "node:assert/strict";
import { createPvpExpertBrain } from "./pvpExpertBrain.mjs";
import { estimateObservedFallDistance, isNewHitConfirmation, shouldCountHealthDeltaHit, shouldApplyFailedActionBackoff, isConfirmedPearlCatch, isConfirmedPearlTeleport, isProjectileOnCollisionCourse, pressureOrbitMode } from "./pvpExpertController.mjs";

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
  const d=makeBrain().decide({...base,distance:3.0,falling:false,onGround:true,fallDistance:0,hitSelectReady:true,
    inventory:{...base.inventory,spear:0},capabilities:{...base.capabilities,spear:false},
    enemy:{...base.enemy,airborne:false}});
  assert.equal(d.action,"hit_select","Theo-impossible profile should hit-select inside the short post-landing window, not at any arbitrary airborne moment");
}

{
  const d=makeBrain().decide({...base,distance:0.8});
  assert.equal(d.action,"spacing_retreat","point-blank combat should create actual separation, not strafe in place");
}

{
  const d=makeBrain().decide({...base,distance:1.7});
  assert.equal(d.action,"spacing_retreat","close combat should back away into a usable melee window");
}

{
  const d=makeBrain().decide({...base,distance:2.3});
  assert.equal(d.action,"spacing_retreat","the minimum attack buffer must extend beyond point-blank collision range");
  assert.notEqual(d.style,"utility","spacing recovery must preserve the selected combat style rather than visually thrash to utility");
}

{
  const d=makeBrain().decide({...base,distance:2.8,spacingLockUntil:Date.now()+500});
  assert.equal(d.action,"spacing_hold","after retreat, the bot should strafe without immediately advancing or attacking");
}

{
  const d=makeBrain().decide({...base,health:5,distance:3.2,capabilities:{...base.capabilities,heal:false,totem:false},emergencyRetreatUntil:0});
  assert.equal(d.action,"emergency_disengage","critical health without healing or totem must retreat when the opponent is still close");
}

{
  const d=makeBrain().decide({...base,health:5,distance:8,capabilities:{...base.capabilities,heal:false,totem:false},emergencyRetreatUntil:0});
  assert.equal(d.action,"emergency_hold","critical health without recovery items should hold an already-safe distance rather than spam retreat forever");
}

{
  const d=makeBrain().decide({...base,health:5,distance:5.86,capabilities:{...base.capabilities,heal:false,totem:false},emergencyRetreatUntil:0});
  assert.equal(d.action,"emergency_hold","a 5.86-block gap is already beyond the controller's 4.25-block retreat target");
}

{
  const d=makeBrain().decide({...base,health:5,distance:5.86,capabilities:{...base.capabilities,heal:false,totem:false},emergencyRetreatUntil:Date.now()+2000});
  assert.equal(d.action,"emergency_hold","an active emergency lock must not reissue retreat after a safe gap has been reached");
}

{
  const d=makeBrain().decide({...base,distance:2.0,enemy:{...base.enemy,shield:true}});
  assert.equal(d.action,"spacing_retreat","shield counter must also respect the minimum spacing gate");
}

{
  const d=makeBrain().decide({...base,distance:2.6,enemy:{...base.enemy,shield:true}});
  assert.equal(d.action,"shield_break","shield break remains available at valid melee spacing");
}


{
  const d=makeBrain().decide({...base,distance:3.0,falling:false,onGround:true,fallDistance:0,hitSelectReady:false,
    inventory:{...base.inventory,spear:0},capabilities:{...base.capabilities,spear:false},
    enemy:{...base.enemy,airborne:true}});
  assert.notEqual(d.action,"hit_select","an airborne target alone is not a landing-timed hit-select window");
}
{
  const distance=estimateObservedFallDistance({position:{y:65},onGround:false,velocity:{y:-0.4}},70.4);
  assert.ok(Math.abs(distance-5.4)<0.001,"wind-charge descent must be estimated from observed Y positions when Mineflayer exposes no fallDistance field");
}

{
  const distance=estimateObservedFallDistance({position:{y:68.2},fallDistance:0},70.4);
  assert.ok(Math.abs(distance-2.2)<0.001,"estimated descent must advance as the bot falls from the tracked apex");
}

console.log("Theobald-impossible difficulty regression tests passed.");

{
  const d=makeBrain().decide({...base,health:5,distance:4.2,capabilities:{...base.capabilities,heal:false,totem:false},emergencyRetreatUntil:Date.now()+2000});
  assert.equal(d.action,"emergency_disengage","an active retreat lock must keep moving until the full 4.75-block safety gap is reached");
}

{
  const d=makeBrain().decide({...base,health:5,distance:4.8,capabilities:{...base.capabilities,heal:false,totem:false},emergencyRetreatUntil:Date.now()+2000});
  assert.equal(d.action,"emergency_hold","the lock must stop retreat after the 4.75-block safety gap is reached");
}

{
  assert.equal(isNewHitConfirmation(1000,0,450),true);
  assert.equal(isNewHitConfirmation(1100,1000,450),false,"entityHurt + health delta for one attack must count once");
  assert.equal(isNewHitConfirmation(1501,1000,450),true,"a later attack confirmation should count after the dedupe window");
  assert.equal(shouldCountHealthDeltaHit(1800,2100,1600,450),false,"a delayed health delta must not double-count a hit already confirmed by entityHurt");
  assert.equal(shouldCountHealthDeltaHit(2201,2100,1600,450),true,"a health-delta fallback should count when no entityHurt confirmation is pending");
  assert.equal(shouldApplyFailedActionBackoff("emergency_disengage"),false,"failed-action cooldowns must never override emergency retreat");
  assert.equal(shouldApplyFailedActionBackoff("emergency_hold"),false,"failed-action cooldowns must never override emergency safe spacing");
  assert.equal(shouldApplyFailedActionBackoff("approach"),true,"ordinary navigation actions may still use failure cooldowns");
}

console.log("Hit-dedupe and emergency hysteresis regression tests passed.");

// Pearl catch must not report a wind-charge knockback as a teleport.
assert.equal(isConfirmedPearlCatch(false, true), false, "no displacement means no confirmed catch");
assert.equal(isConfirmedPearlCatch(true, true), false, "a blast that moves ZOYA while the pearl still exists is not a confirmed catch");
assert.equal(isConfirmedPearlCatch(false, false), false, "pearl disappearance alone is not enough");
assert.equal(isConfirmedPearlCatch(true, false), true, "displacement plus removal of the tracked pearl confirms the catch sequence");
console.log("Pearl catch confirmation regression tests passed.");
assert.equal(isConfirmedPearlTeleport(0,true),false,"a pearl throw without displacement must not be reported as a teleport");
assert.equal(isConfirmedPearlTeleport(5,true),false,"displacement while the projectile still exists is not a confirmed teleport");
assert.equal(isConfirmedPearlTeleport(5,false),true,"a vanished projectile plus a teleport-sized displacement confirms the pearl");
assert.equal(isConfirmedPearlTeleport(3.5,false),false,"small movement is not enough to confirm a pearl teleport");
console.log("Pearl throw confirmation regression tests passed.");

{
  const d=makeBrain().decide({...base,health:7.5,distance:3.2,capabilities:{...base.capabilities,heal:false,totem:false},emergencyRetreatUntil:0});
  assert.equal(d.action,"emergency_disengage","at 7.5 HP, ZOYA must remain in survival mode instead of re-engaging while vulnerable");
}

{
  const d=makeBrain().decide({...base,distance:2.8,windMaceSmashReady:false,selfMaceSmashReady:false,elytraMaceReady:false});
  assert.equal(d.style,"sword","a mace in inventory must not outrank sword in ordinary close-range combat");
  assert.equal(d.action,"melee_attack","at valid sword range, Impossible must attack rather than idle in a failed mace setup");
}

{
  const d=makeBrain().decide({...base,distance:4.5,windMaceSmashReady:false,selfMaceSmashReady:false,elytraMaceReady:false});
  assert.equal(d.style,"spear","without a verified mace setup window, choose the weapon with a valid mid-range engagement");
  assert.equal(d.action,"spear_pressure","mid-range spear engagement should not be replaced by a non-executable mace setup");
}

{
  const d=makeBrain().decide({...base,distance:4.5,windMaceSmashReady:true});
  assert.equal(d.style,"mace","mace is preferred when the controller verifies a real wind-charge setup window");
  assert.equal(d.action,"wind_mace_launch");
}

console.log("Impossible style-selection regression tests passed.");


// Shield policy: block only in a valid defensive window and respect cooldown gates.
{
  const d=makeBrain().decide({...base,distance:3.4,shieldReady:true,meleeBlockReady:true,enemy:{...base.enemy,shield:false}});
  assert.equal(d.action,"shield","a closing melee opponent in the shield window should trigger a timed block");
  assert.equal(d.reason,"incoming_melee_block");
}
{
  const d=makeBrain().decide({...base,distance:3.4,shieldReady:false,meleeBlockReady:true,enemy:{...base.enemy,shield:false}});
  assert.notEqual(d.action,"shield","shield cooldown must prevent repeated blocks");
}
{
  const d=makeBrain().decide({...base,distance:2.2,shieldReady:true,meleeBlockReady:true,enemy:{...base.enemy,shield:false}});
  assert.notEqual(d.action,"shield","shielding must not mask point-blank spacing recovery");
}
{
  const d=makeBrain().decide({...base,distance:3.4,projectileThreat:true,shieldReady:true,enemy:{...base.enemy,shield:false}});
  assert.equal(d.action,"shield","a detected projectile should use a ready shield");
}

// Projectile defense must predict a collision, not shield against every nearby projectile.
assert.equal(isProjectileOnCollisionCourse({x:5,y:0,z:0},{x:-0.5,y:0,z:0},{x:0,y:0,z:0},{x:0,y:0,z:0}),true,"an incoming projectile on a collision path should trigger defense");
assert.equal(isProjectileOnCollisionCourse({x:5,y:0,z:0},{x:0.5,y:0,z:0},{x:0,y:0,z:0},{x:0,y:0,z:0}),false,"a projectile moving away must not trigger defense");
assert.equal(isProjectileOnCollisionCourse({x:5,y:0,z:4},{x:-0.5,y:0,z:0},{x:0,y:0,z:0},{x:0,y:0,z:0}),false,"a projectile on a clear miss trajectory must not trigger defense");
assert.equal(isProjectileOnCollisionCourse({x:20,y:0,z:0},{x:-0.1,y:0,z:0},{x:0,y:0,z:0},{x:0,y:0,z:0}),false,"a projectile outside the prediction horizon must not trigger defense");
console.log("Projectile collision-course regression tests passed.");

// Respawn-anchor PvP is only eligible where anchors actually explode.
{
  const d=makeBrain().decide({...base,distance:5,anchorArena:true,anchorCycleSafe:true,
    inventory:{...base.inventory,respawn_anchor:1,glowstone:4},
    capabilities:{...base.capabilities,anchorCycleSafe:true}});
  assert.equal(d.action,"anchor_cycle","an available safe anchor setup in the Overworld/End should be selected");
}
{
  const d=makeBrain().decide({...base,distance:5,anchorArena:false,anchorCycleSafe:false,
    inventory:{...base.inventory,respawn_anchor:1,glowstone:4}});
  assert.notEqual(d.action,"anchor_cycle","anchor combat must not be selected in the Nether where anchors do not explode");
}

// Rod control must be reachable only when the controller exposes the rod capability.
{
  const d=makeBrain().decide({...base,distance:6,capabilities:{...base.capabilities,rod:true},enemy:{...base.enemy,retreating:true}});
  assert.equal(d.action,"rod_control","a retreating target at rod range should select the wired rod executor");
}

// Expert sword pressure keeps real vanilla spacing instead of walking into the target.
assert.equal(pressureOrbitMode(4.0),"approach","close distance while outside sword reach");
assert.equal(pressureOrbitMode(3.0),"orbit","circle at the edge of normal sword range");
assert.equal(pressureOrbitMode(2.4),"retreat","rebuild spacing when inside the opponent's hitbox pressure");
assert.equal(pressureOrbitMode(Infinity),"approach","reacquire a target when distance is unavailable");
console.log("PvP expert pressure-orbit spacing tests passed.");


{
  const d=makeBrain().decide({...base,distance:1.8,spacingLockUntil:Date.now()+500});
  assert.equal(d.action,"spacing_retreat","a recovery lock must never mask a new point-blank collision; retreat takes priority");
}

console.log("PvP Expert spacing-lock priority regression test passed.");


// Survival recovery must use a safe gap immediately instead of waiting for the retreat lock.
{
  const d=makeBrain().decide({...base,health:5,distance:5.2,capabilities:{...base.capabilities,heal:true,totem:false},emergencyRetreatUntil:Date.now()+2000});
  assert.equal(d.action,"heal","a safe gap must permit critical healing even while the movement lock is active");
}
{
  const d=makeBrain().decide({...base,health:5,distance:3.2,capabilities:{...base.capabilities,heal:true,pearl:true,totem:false},recoveryPearlReady:true,pearlEscapeReady:true,emergencyRetreatUntil:Date.now()+2000});
  assert.equal(d.action,"pearl_escape","at critical health and unsafe distance, a validated pearl should create the gap before repeating retreat");
}
{
  const d=makeBrain().decide({...base,health:9,distance:3.0,capabilities:{...base.capabilities,heal:true,pearl:true},recoveryPearlReady:true,pearlEscapeReady:true});
  assert.equal(d.action,"pearl_escape","low health in melee range should use a safe pearl to disengage before trying to eat");
}
console.log("PvP Expert heal/pearl recovery priority tests passed.");


// Advanced Impossible combat routes must select real, gated executor actions.
{
  const d=makeBrain().decide({...base,distance:4.5,pearlCatchReady:true,diagonalPearlCatchReady:true});
  assert.equal(d.action,"diagonal_pearl_catch","diagonal pearl catch requires a prevalidated safe landing");
}
{
  const d=makeBrain().decide({...base,distance:4.5,pearlCatchReady:true,diagonalPearlCatchReady:false});
  assert.equal(d.action,"pearl_catch","fall recovery should use the validated non-diagonal catch when diagonal landing is unavailable");
}
{
  const d=makeBrain().decide({...base,distance:4.5,windCancelReady:true,capabilities:{...base.capabilities,wind:true},enemy:{...base.enemy,airborne:true}});
  assert.equal(d.action,"wind_charge_cancel","wind-charge cancel is separate from self-launch mace setup");
}
{
  const d=makeBrain().decide({...base,distance:2.8,shieldDrainReady:true,attackReadyAt:0,enemy:{...base.enemy,shield:true,usingItem:true}});
  assert.equal(d.action,"shield_drain","raised shield with axe available should select bounded drain sequence");
}
{
  const d=makeBrain().decide({...base,distance:2.8,backstabReady:true,attackReadyAt:0});
  assert.equal(d.action,"backstab","rear-arc opportunity should select the verified backstab executor");
}
{
  const d=makeBrain().decide({...base,distance:12,pearlGrappleReady:true,recoveryPearlReady:true,enemy:{...base.enemy,retreating:true}});
  assert.equal(d.action,"pearl_grapple","far pearl intercept should only be selected with a validated landing");
}
{
  const d=makeBrain().decide({...base,distance:2.8,maceAttributeSwapReady:true,selfMaceSmashReady:true,attackReadyAt:0});
  assert.equal(d.action,"mace_attribute_swap","falling mace hit should use a last-tick sword-to-mace attribute swap when both weapons are hotbar-ready");
}
console.log("Advanced Impossible tactical routing regression tests passed.");

{
  const d=makeBrain().decide({...base,distance:2.8,stunSlamReady:true,enemy:{...base.enemy,shield:true,usingItem:true}});
  assert.equal(d.action,"stun_slam","falling shield target should trigger the bounded axe-stun then mace sequence");
}
{
  const d=makeBrain().decide({...base,distance:8,rocketMaceReady:true,elytraMaceReady:true,elytraLaunchReady:true,elytraEquipped:true,
    capabilities:{...base.capabilities,elytraMace:true,firework:true}});
  assert.equal(d.action,"rocket_mace","firework-capable Elytra setup should select rocket macing");
}
console.log("Stun-slam and rocket-mace routing regression tests passed.");

{
  const d=makeBrain().decide({...base,distance:2.8,windChargeResetReady:true,attackReadyAt:0,capabilities:{...base.capabilities,wind:true,mace:true}});
  assert.equal(d.action,"wind_charge_reset","a verified mid-air wind-charge reset window should precede a normal mace swing");
}
console.log("Wind-charge fall-reset routing regression test passed.");

{
  const d=makeBrain().decide({...base,distance:2.8,maceCrystalDTapReady:true,selfMaceSmashReady:true,attackReadyAt:0,
    capabilities:{...base.capabilities,crystal:true},inventory:{...base.inventory,crystal:2,obsidian:8}});
  assert.equal(d.action,"mace_d_tap","validated mace smash window with a safe crystal base should select mace-crystal D-tap");
}
console.log("Mace-crystal D-tap and attribute-swap separation tests passed.");
