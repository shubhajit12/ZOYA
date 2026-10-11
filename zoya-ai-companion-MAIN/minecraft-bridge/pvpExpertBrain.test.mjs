import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPvpExpertBrain } from "./pvpExpertBrain.mjs";
import { failedActionBackoffMs } from "./pvpExpertController.mjs";
import { getEnchantmentLevel, chooseMaceDodgeSide, canStartStunSlam, estimateObservedFallDistance, predictTargetPosition, distanceToEntityHitbox, isNewHitConfirmation, isHitConfirmed, shouldCountHealthDeltaHit, shouldApplyFailedActionBackoff, isConfirmedPearlCatch, isConfirmedPearlTeleport, isProjectileOnCollisionCourse, projectileClosestApproach, isCrystalFallbackSafe, isAnchorFallbackSafe, isEntityUsingItem, isEntityBlockingWithShield, isEnemyMaceDiveThreat, pressureOrbitMode, isLikelyTotemPop, isHostilePotionItem } from "./pvpExpertController.mjs";

const makeBrain=()=>createPvpExpertBrain();

{
  assert.equal(getEnchantmentLevel({nbt:{Enchantments:[{id:"minecraft:lunge",lvl:{type:"short",value:2}}]}},"lunge"),2,
    "Lunge enchantment level must be read from legacy-style NBT");
  assert.equal(getEnchantmentLevel({components:{"minecraft:enchantments":{levels:{"minecraft:lunge":3}}}},"lunge"),3,
    "Lunge enchantment level must be read from modern component-style data");
  assert.equal(getEnchantmentLevel({nbt:{Enchantments:[{id:"minecraft:sharpness",lvl:5}]}},"lunge"),0,
    "missing Lunge enchantment must not trigger a lunge action");
}

{
  const botPosition={x:0,y:64,z:0},targetPosition={x:0,y:64,z:3};
  const sideA=chooseMaceDodgeSide({botYaw:0,botPosition,targetPosition,targetYaw:Math.PI,targetVelocity:{x:0,y:0,z:0}});
  const sideB=chooseMaceDodgeSide({botYaw:0,botPosition,targetPosition,targetYaw:0,targetVelocity:{x:.2,y:0,z:0}});
  assert.ok(sideA===1||sideA===-1,"mace dodge must choose a concrete lateral side");
  assert.ok(sideB===1||sideB===-1,"mace dodge must choose a concrete lateral side against a moving target");
  assert.notEqual(chooseMaceDodgeSide({}),0,"missing geometry must still return a safe deterministic side");
}

{
  const baseStun={hasAxe:true,hasMace:true,hasWind:true,axeHotbar:true,maceHotbar:true,shielding:true,distance:2.8,attackReady:true};
  assert.equal(canStartStunSlam(baseStun),true,
    "stun-slam setup must be eligible from the ground when all real prerequisites are present");
  assert.equal(canStartStunSlam({...baseStun,shielding:false}),false,
    "stun-slam must not start unless the opponent is actively shield-blocking");
  assert.equal(canStartStunSlam({...baseStun,distance:4}),false,
    "stun-slam axe-disable must remain inside verified melee reach");
  assert.equal(canStartStunSlam({...baseStun,maceHotbar:false}),false,
    "stun-slam must fail closed if the follow-up mace cannot be selected");
}


const controllerSource=readFileSync(new URL("./pvpExpertController.mjs",import.meta.url),"utf8");
const brainSource=readFileSync(new URL("./pvpExpertBrain.mjs",import.meta.url),"utf8");

{
  assert.equal(isHostilePotionItem({name:"splash_potion",nbt:{Potion:"minecraft:strong_poison"}}),true,
    "legacy potion metadata with a hostile effect must be eligible for debuff");
  assert.equal(isHostilePotionItem({name:"splash_potion",components:{"minecraft:potion_contents":{potion:"minecraft:strong_harming"}}}),true,
    "modern potion components with a hostile effect must be eligible for debuff");
  assert.equal(isHostilePotionItem({name:"splash_potion",components:{"minecraft:potion_contents":{potion:"minecraft:healing"}}}),false,
    "beneficial healing potions must not be thrown at an opponent as debuffs");
  assert.equal(isHostilePotionItem({name:"splash_potion",customName:"Poison",components:{"minecraft:potion_contents":{potion:"minecraft:healing"}}}),false,"a user-controlled display name must not override beneficial potion effects");
  assert.equal(isHostilePotionItem({name:"splash_potion"}),false,
    "unknown potion metadata must fail closed instead of guessing its effect");
}


{
  const potionStart=controllerSource.indexOf('if(type==="potion"){');
  const potionEnd=controllerSource.indexOf("\n  const pearlBlockSafe=",potionStart);
  const potionBody=controllerSource.slice(potionStart,potionEnd);
  assert.ok(potionBody.includes("potion_throw_confirmed="),
    "potion execution must log observed throw confirmation");
  assert.ok(potionBody.includes("projectile_spawned")&&potionBody.includes("inventory_decreased"),
    "potion throw must be confirmed from a new projectile/cloud or inventory decrement");
  assert.ok(potionBody.includes("effect_confirmed=false"),
    "potion projectile spawn must not be mislabeled as a confirmed useful effect");
  assert.ok(controllerSource.includes('const recoveryMode=dist(bot.entity,t)>14&&!hazard()?"grapple":"escape"')&&controllerSource.includes("pearl_recover_mode="),
    "far-range recovery must use a target-directed grapple pearl rather than increasing separation");

assert.ok(controllerSource.includes('pearlGrappleReady:Boolean(pearlReady("grapple",t))')&&controllerSource.includes("Date.now()>=Math.max(state.pearlCooldownUntil,state.pearlFailureUntil)"),
    "grapple and recovery readiness must respect the same pearl failure cooldown as the throw executor");

assert.ok(controllerSource.includes("pearl_retry_backoff mode=")&&controllerSource.includes("Math.min(30000,1800*(2**(state.pearlFailureStreak-1)))"),
    "failed escape/ambush pearls must apply bounded exponential backoff instead of rapidly consuming inventory");
  assert.ok(controllerSource.includes("pearl_catch_retry_backoff reason=")&&controllerSource.includes("Math.min(30000,3500*(2**(state.pearlCatchFailureStreak-1)))"),
    "failed pearl-catch combos must cool down progressively after repeated unconfirmed teleports");

assert.ok(controllerSource.includes("strafe_movement_confirmed=")&&controllerSource.includes("pressure_orbit_confirmed="),"strafe/orbit must confirm displacement");
assert.ok((controllerSource.match(/const targetHurtBefore=state\.lastSelfTargetHurtAt;/g)||[]).length>=2,"bow and crossbow must use self-attributed target damage, not unrelated damage");
assert.ok((controllerSource.match(/state\.lastSelfTargetHurtAt>targetHurtBefore/g)||[]).length>=4,"bow/crossbow confirmation comparisons must use the same self-attributed damage signal as their baseline");

assert.ok(controllerSource.includes("state.lastSelfTargetHurtAt=now;")&&
  controllerSource.indexOf("if(source&&(source.id!==bot.entity?.id&&source.username!==bot.username)) return;")<controllerSource.indexOf("const sourceIsSelf=Boolean(source&&")&&
  controllerSource.includes("if(!sourceIsSelf&&(age<0||age>450))return;"),
  "known foreign damage must be rejected, while explicitly self-attributed delayed projectile hits bypass only the missing-source melee timing fallback");

assert.ok(controllerSource.includes("projectile_dodge_confirmed=")&&controllerSource.includes("emergency_hold_confirmed="),"dodge/hold must confirm movement");
assert.ok(controllerSource.includes('case "spacing_hold": ok=await pressureOrbit(t,state.strafe,140);break;'),"spacing hold must use verified orbit executor");

assert.ok(controllerSource.includes("emergency_disengage_confirmed=")&&controllerSource.includes("return reachedGap||progressed;"),
    "emergency disengage must not report success if it neither reaches a safe gap nor gains distance");
  assert.ok(controllerSource.includes("mace_evasion_confirmed=")&&controllerSource.includes("return evasionConfirmed;"),
    "mace evasion must confirm observed displacement instead of succeeding from issued movement inputs alone");

assert.ok(controllerSource.includes("shield_raised_observed=")&&controllerSource.includes("isEntityBlockingWithShield(bot.entity)")&&controllerSource.includes("projectile_block_confirmed=false"),
    "shield execution must observe an active shield raise and must not mislabel the pose as a confirmed projectile block");

assert.ok(controllerSource.includes('" shieldReady="+Boolean(ctx.shieldReady)+" meleeBlockReady="+Boolean(ctx.meleeBlockReady)+" projectileThreat="+Boolean(ctx.projectileThreat)'),
  "combat diagnostics must not conflate shield cooldown readiness with melee-block eligibility");

assert.ok(!/return true;/.test(potionBody),
    "potion action must not return unconditional success after issuing a use packet");
}

const heldCloseDeclaration=controllerSource.indexOf("const enemyMaceHeldClose=Boolean(enemyMaceHeld&&d<=7.5);");
const windMaceReadiness=controllerSource.indexOf("windMaceSmashReady:Boolean(");
assert.ok(heldCloseDeclaration>=0,"enemyMaceHeldClose must be explicitly defined in the combat tick");
assert.ok(windMaceReadiness>heldCloseDeclaration,"enemyMaceHeldClose must be defined before wind-mace readiness reads it");

assert.ok(controllerSource.includes('combat_loadout totem_equipped='),"PvP startup must log and prepare an available offhand totem");
assert.ok(controllerSource.includes("Date.now()-state.lastAttackConfirmedAt<=2500"),"delayed target equipment updates must not erase a recent confirmed totem-pop inference window");
assert.ok(controllerSource.includes('" current="+currentArmor'),"PvP armor preflight must report the actual equipped armor slots instead of an ambiguous none-needed result");

{
  assert.equal(isLikelyTotemPop({wasEquipped:true,nowEquipped:false,targetHealth:null,recentConfirmedHit:true}),true,
    "a recent confirmed hit plus disappearance of the equipped totem should trigger the pop-pressure window when player health is unavailable");
  assert.equal(isLikelyTotemPop({wasEquipped:true,nowEquipped:false,targetHealth:3,recentConfirmedHit:false}),true,
    "low observed target health may corroborate an equipment transition");
  assert.equal(isLikelyTotemPop({wasEquipped:true,nowEquipped:false,targetHealth:null,recentConfirmedHit:false}),false,
    "equipment disappearance without a recent hit must not be mislabeled as a pop");
  assert.equal(isLikelyTotemPop({wasEquipped:false,nowEquipped:false,targetHealth:1,recentConfirmedHit:true}),false,
    "a target without an equipped totem cannot have a totem pop inferred");
}


{
  const d=makeBrain().decide({health:20,distance:null,lineOfSight:true,capabilities:{sword:true},inventory:{sword:1},enemy:{}});
  assert.equal(d.action,"approach","missing range data must be treated as unknown distance, never as point-blank melee range");
}

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
  const popDecision=makeBrain().decide({...base,distance:4.52,pearlCatchReady:true,
    enemy:{...base.enemy,totemPopped:true}});
  assert.equal(popDecision.action,"approach",
    "a confirmed totem-pop window at mid-range must take priority over a speculative pearl catch");
  assert.ok(brainSource.indexOf("if(e.totemPopped&&d<=3.05")<brainSource.indexOf("if(c.pearlCatchReady)"),
    "totem-pop finishing logic must precede pearl-catch selection");
}

{
  const d=makeBrain().decide({...base,distance:5.5});
  assert.notEqual(d.action,"spear_pressure","spear pressure must never be selected beyond the executor's 5.0m contract");
}

{
  const d=makeBrain().decide({...base,distance:2.2});
  assert.equal(d.action,"melee_attack","in-range sword pressure must attack instead of retreating at 2.2 blocks");
  assert.equal(d.style,"sword");
}

{
  const d=makeBrain().decide({...base,distance:2.4,lineOfSight:false,enemy:{...base.enemy,totemPopped:false}});
  assert.equal(d.action,"reacquire","melee cooldowns must not be wasted attacking through blocked line of sight");
  assert.equal(d.reason,"lost_los_before_attack");
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


{
  assert.ok(controllerSource.includes("const crossbowChargeState=() =>") || controllerSource.includes("const crossbowChargeState=()=>"),
    "crossbow combat must inspect charged state instead of treating a short use as a shot");
  assert.ok(controllerSource.includes("crossbow_load_unconfirmed"),
    "crossbow must fail closed when loading cannot be confirmed");
  assert.ok(controllerSource.includes("crossbow_shot_confirmed="),
    "crossbow fire must be confirmed by projectile spawn or target damage");
  assert.ok(controllerSource.includes("crossbow_shot_confirmed="),
    "crossbow firing must confirm a projectile launch or observed target damage");
  assert.ok(controllerSource.includes("bow_shot_confirmed="),
    "bow firing must confirm a projectile launch or observed target damage");
  assert.ok(controllerSource.includes("return bobberSeen;"),
    "rod control must not report success when no cast/bobber was observed");
  assert.ok(controllerSource.includes("const deadline=Date.now()+1700"),
    "crossbow must allow a real load interval before firing");
}


{
  assert.ok(controllerSource.includes("rod_cast_reel_confirmed="),
    "rod control must cast and retract with two use actions, not merely release item use");
  assert.match(controllerSource,/bot\.deactivateItem\(\);\r?\n\s*await sleep\(50\);\r?\n\s*bot\.activateItem\(\);\r?\n\s*await sleep\(90\);\r?\n\s*bot\.deactivateItem\(\);/,
    "rod must release the cast state, issue a fresh reel click, and release again before melee follow-up on Windows and Unix line endings");
}


{
  const approach=projectileClosestApproach(
    {x:4,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:0,z:0},{x:0,y:0,z:0},8
  );
  assert.ok(approach && approach.ticks===4 && approach.distance===0,
    "projectile defense must calculate the future closest-approach point");
  assert.equal(isProjectileOnCollisionCourse(
    {x:4,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:0,z:0},{x:0,y:0,z:0},1.35,8
  ),true);
  assert.equal(isProjectileOnCollisionCourse(
    {x:4,y:0,z:4},{x:-1,y:0,z:0},{x:0,y:0,z:0},{x:0,y:0,z:0},1.35,8
  ),false,"projectiles passing beside the player must not trigger dodge");
  assert.equal(isProjectileOnCollisionCourse(
    {x:2,y:0,z:0},{x:1,y:0,z:0},{x:0,y:0,z:0},{x:0,y:0,z:0},1.35,8
  ),false,"nearby projectiles moving away must not trigger dodge");
  assert.ok(controllerSource.includes('bot.blockAt(bot.entity?.position?.offset(0,1,0))'),
  "spear Lunge readiness must reject water at both feet and head");
  assert.ok(controllerSource.includes('case "spear_lunge": ok=await spearLunge(t);'),
  "spear lunge brain action must route to a real spear-jab executor");
  assert.ok(controllerSource.includes("const lungeObserved=confirmed&&displacement>.65")&&
    controllerSource.includes('spear_lunge_confirmed="+lungeObserved'),
    "spear lunge success must require both a confirmed hit and observed lunge displacement");
  assert.ok(controllerSource.includes("chooseMaceDodgeSide("),
  "mace evasion must select its lateral direction from opponent facing and motion");
  assert.ok(controllerSource.includes("predictive_side="),
    "projectile dodging must choose a trajectory-aware lateral side");
}


{
  const boostStart=controllerSource.indexOf("const fireworkBoost=async()=>");
  const sprintResetStart=controllerSource.indexOf("const sprintReset=async",boostStart);
  const boostBody=controllerSource.slice(boostStart,sprintResetStart);
  assert.ok(boostBody.includes("if(!flying())"),
    "Elytra rockets must not be fired when glide is not active");
  assert.ok(boostBody.includes("firework_boost_confirmed=")&&boostBody.includes("after-before>=.08"),
    "firework boost success must require observed velocity increase, not just an issued use packet");
  assert.ok(boostBody.includes("state.lastFireworkAt=Date.now()"),
    "unconfirmed firework attempts must still be rate-limited to prevent rocket drain");
}

{
  assert.ok(controllerSource.includes('noteFailure?.("elytra_mace","flight_not_started");')&&
    controllerSource.includes("await restoreElytra();"),
    "failed Elytra takeoff must restore the flight chest item");
  assert.ok(controllerSource.includes("const fallDistance=estimateObservedFallDistance(bot.entity,divePeakY)"),
    "Elytra mace must require a measured downward fall, not merely being above the target");
  assert.ok(controllerSource.includes("const confirmed=await waitForHitConfirmation(live,hitsBefore,targetHealthBefore,280);"),
    "Elytra mace action must return server-confirmed hit status rather than issued-input status");
  assert.ok(controllerSource.includes("Never send two attacks in the same tick and label that a stun"),
    "Elytra mace must not claim an unverified same-tick axe/mace stun");
}


{
  assert.ok(controllerSource.includes("const maceConfirmed=await wind(live);"),
    "stun slam must execute a wind launch and then the real mace-smash executor");
  assert.ok(controllerSource.includes("stun_slam_confirmed=\"+maceConfirmed"),
    "stun slam success must reflect the confirmed mace follow-up, not only the axe hit");
  assert.ok(brainSource.indexOf('reason:"confirmed_shield_disable_wind_mace_slam"')<
    brainSource.indexOf('reason:"shield_drain_sequence"'),
    "full stun-slam prerequisites must route before the shield-drain fallback");
}


{
  {
  const stunStart=controllerSource.indexOf("const stunSlam=async t=>");
  const windReset=controllerSource.indexOf("const windChargeReset=async t=>",stunStart);
  const stunBody=controllerSource.slice(stunStart,windReset);
  assert.ok(stunBody.includes("canStartStunSlam("),
    "stun-slam executor must share the tested real-prerequisite gate");
  assert.ok(!stunBody.includes("!isAirborne(bot.entity)"),
    "stun-slam must initiate the axe-disable before the wind launch, not require the bot to already be falling");
}

assert.ok(controllerSource.includes("const equipTotemVerified=async()=>"),
    "totem equip must be a verified survival action, not an inventory-transfer success");
  assert.ok(controllerSource.includes('state.totemEquipped=/totem_of_undying/.test(offhandName())'),
    "combat startup must derive totem state from observed offhand equipment");
  assert.ok(controllerSource.includes("offhand_totem_verified="),
    "logs must distinguish a requested equip from an observed offhand totem");
}


{
  const rangedCtx={...base,distance:9,lineOfSight:true,hasBowAmmo:false,hasCrossbowAmmo:false,inventory:{...base.inventory,bow:1,crossbow:1}};
  assert.notEqual(makeBrain().decide(rangedCtx).action,"ranged_attack",
    "brain must not repeatedly choose bow firing without ammunition");
  const loadedCrossbowCtx={...rangedCtx,styleMemory:"crossbow",hasCrossbowAmmo:true};
  assert.equal(makeBrain().decide(loadedCrossbowCtx).action,"ranged_attack",
    "a loaded crossbow remains usable even without spare inventory arrows");
  const rocketCrossbowCtx={...rangedCtx,styleMemory:"crossbow",hasCrossbowAmmo:true,hasFireworkAmmo:true};
  assert.equal(makeBrain().decide(rocketCrossbowCtx).action,"ranged_attack",
    "a crossbow loaded with a firework rocket remains a valid ranged style");
  assert.ok(controllerSource.includes('count(bot,"firework")>0||crossbowChargeState()===true'),
    "crossbow style feasibility must include firework-rocket ammunition");
  assert.ok(controllerSource.includes("bow_fire_blocked reason=no_arrow_ammunition"),
    "bow executor must refuse to charge without ammunition");
  assert.ok(controllerSource.includes("crossbow_fire_blocked reason=unloaded_no_valid_ammunition"),
    "crossbow executor must refuse to load/fire without ammunition");
}


{
  assert.ok(controllerSource.includes("state.lastTargetHurtAt=now;"),
    "target hurt events must be observable independently of direct melee attack confirmation");
  assert.ok(controllerSource.includes("targetHurtObserved=state.lastTargetHurtAt>targetHurtBefore"),
    "crystal and anchor detonation must accept observed target damage when player health is unavailable");
}


{
  assert.equal(isEntityUsingItem({metadata:{8:1}}),true,
    "Java living-entity hand-state bit 0 must detect shield/bow/eating use");
  assert.equal(isEntityUsingItem({metadata:{8:{value:1}}}),true,
    "typed Mineflayer metadata must also detect active item use");
  assert.equal(isEntityUsingItem({metadata:{8:2}}),false,
    "offhand-selection bit alone must not be mistaken for active item use");
  assert.equal(isEntityUsingItem({metadata:{8:0}}),false);
  assert.equal(isEntityUsingItem({isUsingItem:true}),true,
    "explicit high-level use state takes precedence when available");
  assert.ok(controllerSource.includes("usingItem:isEntityBlockingWithShield(t)"),
    "combat brain must use protocol-aware active-hand detection for enemy counterplay");
}


{
  assert.equal(isEntityBlockingWithShield({equipment:[{name:"diamond_sword"},{name:"shield"}],metadata:{8:1}}),false,
    "using a main-hand item while carrying an offhand shield is not active shield blocking");
  assert.equal(isEntityBlockingWithShield({equipment:[{name:"diamond_sword"},{name:"shield"}],metadata:{8:3}}),true,
    "the offhand active-hand bit must detect actual offhand shield blocking");
  assert.equal(isEntityBlockingWithShield({equipment:[{name:"shield"},{name:"totem_of_undying"}],metadata:{8:1}}),true,
    "main-hand shield use must be recognized");
  assert.equal(isEntityBlockingWithShield({equipment:[{name:"diamond_sword"},{name:"shield"}],metadata:{8:0}}),false);
  assert.ok(controllerSource.includes("usingItem:isEntityBlockingWithShield(t)"),
    "brain shield logic must receive active-shield state, not generic item-use state");
}


{
  assert.equal(isCrystalFallbackSafe({health:20,selfDistance:4.2,targetDistance:3.5,totemEquipped:false}),true,
    "crystal fallback should allow a high-health, favorable-distance trade that is physically placeable");
  assert.equal(isCrystalFallbackSafe({health:16,selfDistance:4.2,targetDistance:3.5,totemEquipped:false}),false,
    "crystal fallback must reject low-health trades without a totem");
  assert.equal(isCrystalFallbackSafe({health:12,selfDistance:3.2,targetDistance:2.6,totemEquipped:true}),true,
    "a totem-backed crystal trade can use the explicit lower safety margin");
  assert.equal(isCrystalFallbackSafe({health:12,selfDistance:2.8,targetDistance:2.1,totemEquipped:true}),false,
    "crystal fallback must reject point-blank self-damage risk");
  assert.equal(isAnchorFallbackSafe({health:20,selfDistance:4.5,targetDistance:3.5,reachable:true}),true,
    "anchor placement should be possible within reach when health and geometry are safe");
  assert.equal(isAnchorFallbackSafe({health:20,selfDistance:4.5,targetDistance:3.5,reachable:false}),false,
    "anchor placement must reject positions outside actual placement reach");
  assert.equal(isAnchorFallbackSafe({health:11,selfDistance:3.5,targetDistance:2.5,totemEquipped:true,reachable:true}),false,
    "anchor placement must reject low-health totem-backed detonations");
  assert.ok(controllerSource.includes("minSelfDistance:state.totemEquipped?3.25:4.25"),
    "new anchor placement must use a safety gate that can coexist with actual block reach");
  assert.ok(controllerSource.includes("await restoreElytra();return false"),
    "Elytra mace failure paths must restore the chest slot");
}


{
  assert.ok(controllerSource.includes("wind_charge_cancel_confirmed="),
    "wind-charge interruption must confirm impact, not just item activation");
  assert.ok(controllerSource.includes("projectile_spawned=false"),
    "wind-charge interruption must fail closed when no projectile launches");
  assert.ok(controllerSource.includes("water_clutch_confirmed="),
    "water clutch must verify that a water block was actually placed");
}

console.log("PvP Expert Brain deterministic tests passed.");

// Survival must not assume a totem exists: a detected falling-mace threat still evades.
{
  const d=makeBrain().decide({...base,health:16,distance:3.5,hasTotem:false,hasPearl:false,capabilities:{...base.capabilities,totem:false,pearl:false},
    enemyMaceThreat:true,maceEscapeReady:true,enemy:{...base.enemy,held:"mace",airborne:true,falling:true}});
  assert.equal(d.action,"emergency_disengage","without pearl or totem, Zoya must still evade a detected mace dive");
}
{
  const d=makeBrain().decide({...base,health:5,distance:3.5,hasTotem:false,hasPearl:false,capabilities:{...base.capabilities,totem:false,pearl:false},
    enemyMaceThreat:true,maceEscapeReady:true,enemy:{...base.enemy,held:"mace",airborne:true,falling:true}});
  assert.equal(d.action,"emergency_disengage","critical health without totem/pearl must prioritize evasive movement");
}
// The closest-range branch must not depend on pearl-escape eligibility.
{
  const d=makeBrain().decide({...base,health:16,distance:2.4,hasTotem:false,hasPearl:false,maceEscapeReady:false,
    capabilities:{...base.capabilities,totem:false,pearl:false},enemyMaceThreat:true,
    enemy:{...base.enemy,held:"mace",airborne:true,falling:true}});
  assert.equal(d.action,"emergency_disengage","at point-blank range, no-totem survival must still evade when pearl escape is unavailable");
}

// A confirmed pop must beat close-spacing retreat and finish with a fast sword hit.
{
  const d=makeBrain().decide({...base,distance:2.1,attackReadyAt:0,enemy:{...base.enemy,totemPopped:true}});
  assert.equal(d.action,"finish","a confirmed totem pop at melee range must trigger immediate finishing pressure");
  assert.equal(d.style,"sword","finishing pressure should use fast sword attacks when available");
}



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
  assert.equal(d.action,"approach","at four blocks Zoya must close into actual sword reach rather than issue an out-of-range finish");
}

{
  const d=makeBrain().decide({...base,distance:2.4,attackReadyAt:Date.now()+300,enemy:{...base.enemy,totemPopped:true}});
  assert.equal(d.action,"finish_wait","a popped totem must not cause Zoya to retreat while her sword cooldown recovers");
}

{
  const d=makeBrain().decide({...base,health:11,distance:6.5,totemEquipped:false,
    capabilities:{...base.capabilities,totem:false,pearl:false},enemyMaceHeldClose:true,
    enemy:{...base.enemy,held:"mace"}});
  assert.equal(d.action,"emergency_disengage","without a totem, low-health Zoya must evade a nearby mace holder before eating");
}

{
  const d=makeBrain().decide({...base,health:13,distance:5,totemEquipped:false,
    capabilities:{...base.capabilities,totem:false,pearl:true},recoveryPearlReady:true,pearlEscapeReady:true,
    enemyMaceHeldClose:true,enemy:{...base.enemy,held:"mace"}});
  assert.equal(d.action,"pearl_escape","use a validated pearl to escape a mace burst when no totem is equipped");
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
  const d=makeBrain().decide({...base,distance:8,enemy:{...base.enemy,retreating:true},recoveryPearlReady:true,pearlAmbushReady:true,capabilities:{...base.capabilities,pearl:true,burst:false}});
  assert.equal(d.action,"pearl_ambush","a validated pearl intercept must not require the unrelated burst capability flag");
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
  assert.equal(d.action,"melee_attack","2.3 blocks is valid sword reach and should not trigger passive retreat");
  assert.equal(d.style,"sword","close-range pressure should use the sword rather than a utility fallback");
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
  const d=makeBrain().decide({...base,distance:2.0,enemy:{...base.enemy,shield:true,usingItem:false}});
  assert.equal(d.action,"melee_attack","a carried but inactive shield must not trigger shield-break logic");
  assert.equal(d.style,"sword","use fast sword pressure until the target actually raises its shield");
}

{
  const d=makeBrain().decide({...base,distance:2.6,enemy:{...base.enemy,shield:true,usingItem:false}});
  assert.equal(d.action,"melee_attack","do not waste the axe cooldown while a carried shield is not actively blocking");
  assert.equal(d.style,"sword");
}
{
  const d=makeBrain().decide({...base,distance:2.6,enemy:{...base.enemy,shield:true,usingItem:true}});
  assert.equal(d.action,"shield_break","an actively used shield should trigger an axe counter at valid melee spacing");
  assert.equal(d.style,"axe");
}


{
  const d=makeBrain().decide({...base,distance:3.0,falling:false,onGround:true,fallDistance:0,hitSelectReady:false,
    inventory:{...base.inventory,spear:0},capabilities:{...base.capabilities,spear:false},
    enemy:{...base.enemy,airborne:true}});
  assert.notEqual(d.action,"hit_select","an airborne target alone is not a landing-timed hit-select window");
}
{
  const predicted=predictTargetPosition({x:10,y:64,z:0},{x:0.2,y:0,z:0},{x:0.02,y:0,z:-0.01},3);
  assert.ok(Math.abs(predicted.x-10.69)<0.001,"target aim should include bounded acceleration as well as velocity");
  assert.ok(Math.abs(predicted.y-64)<0.001,"vertical prediction should preserve level movement when vertical velocity and acceleration are zero");
  assert.ok(Math.abs(predicted.z+0.045)<0.001,"lateral acceleration should be included in short-horizon prediction");
  const capped=predictTargetPosition({x:0,y:0,z:0},{x:1,y:0,z:0},{x:1,y:0,z:0},20);
  assert.ok(capped.x<=4.28,"target prediction horizon and acceleration must be bounded to avoid aiming far ahead");
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
assert.ok(controllerSource.includes('const navigationAction=new Set(["approach","reacquire","mace_approach"]).has(decision.action)') &&
  controllerSource.includes('reason:"failed_navigation_reposition"'),
  "a blocked navigation action must reposition instead of immediately retrying the same failed path");
assert.ok(controllerSource.includes("const botMoved=startPos&&bot.entity?.position?bot.entity.position.distanceTo(startPos):0") &&
  controllerSource.includes("|| botMoved>=0.35"),
  "approach must recognize real bot movement even if the target moves away faster");
}

console.log("Hit-dedupe and emergency hysteresis regression tests passed.");

// A close mace holder is evaded before ZOYA takes the first burst hit.
{
  const d=makeBrain().decide({...base,distance:3.2,health:20,maceEvasionReady:true,enemyMaceHeldClose:true,
    enemy:{...base.enemy,held:"mace",airborne:false,falling:false}});
  assert.equal(d.action,"mace_evasion","close-range mace pressure must trigger a proactive lateral/backstep before waiting for low health");
}
{
  const d=makeBrain().decide({...base,distance:3.2,health:20,maceEvasionReady:false,enemyMaceHeldClose:true,
    enemy:{...base.enemy,held:"mace",airborne:false,falling:false}});
  assert.notEqual(d.action,"mace_evasion","mace evasion cooldown must prevent a movement-action spam loop");
}
assert.ok(controllerSource.includes('case "mace_evasion": ok=await maceEvasion(t);break;'),
  "the proactive mace-evasion decision must be connected to a real controller executor");
assert.ok(controllerSource.includes("maceEvasionCooldownUntil=Date.now()+650"),
  "mace evasion must have a bounded cooldown so it can counterattack instead of retreating forever");
assert.ok(controllerSource.includes('const num=(v,d=0)=>v==null||v===""?d:Number.isFinite(Number(v))?Number(v):d;'),
  "missing player-health metadata must remain unknown instead of coercing null to zero");
assert.ok(controllerSource.includes("if(t.health!=null&&state.lastTargetHealth!=null&&state.lastTargetHealth>th){"),
  "health-delta hit confirmation must never infer a hit from an unavailable target-health field");
assert.ok(controllerSource.includes("state.lastHealth=hp;state.lastTargetHealth=t.health!=null&&Number.isFinite(Number(t.health))?Number(t.health):null;"),
  "unknown health samples must break the damage-delta chain instead of poisoning the next sample");

// Predict a credible airborne mace threat before the damage lands.
assert.equal(isEnemyMaceDiveThreat({heldItem:"mace",airborne:true,distance:5.8,targetY:65,selfY:64,targetVelocityY:0,verticalDelta:0}),true,"an airborne mace holder in dive range is a threat before downward velocity is observed");
assert.equal(isEnemyMaceDiveThreat({heldItem:"mace",airborne:false,distance:9,targetY:64,selfY:64,targetVelocityY:0,verticalDelta:0}),false,"a distant grounded mace holder is not an immediate dive threat");
assert.equal(isEnemyMaceDiveThreat({heldItem:"netherite_sword",airborne:true,distance:4,targetY:65,selfY:64,targetVelocityY:-0.4,verticalDelta:-0.4}),false,"ordinary airborne sword combat is not classified as mace dive");

// Attack attempts are only successful when the server confirms a hit.
assert.equal(isHitConfirmed(4,5,20,20),true,"an entityHurt hit counter increment confirms a hit");
assert.equal(isHitConfirmed(4,4,20,18),true,"a target health decrease confirms a hit when entityHurt is unavailable");
assert.equal(isHitConfirmed(4,4,20,20),false,"a swing with no hit or health change is not a successful attack");
assert.equal(isHitConfirmed(4,4,20,20.5),false,"target healing must not be counted as attack success");

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

// Prefer sustained sword pressure over unnecessary axe swaps when no shield is involved.
{
  const d=makeBrain().decide({...base,distance:3.3,inventory:{...base.inventory,spear:0},
    capabilities:{...base.capabilities,spear:false},enemy:{...base.enemy,shield:false}});
  assert.equal(d.action,"approach","outside sword reach, close with the sword instead of issuing slow out-of-range axe swings");
  assert.equal(d.style,"sword");
}
{
  const d=makeBrain().decide({...base,distance:3.0,enemy:{...base.enemy,shield:true,usingItem:true}});
  assert.equal(d.style,"axe","an actively used shield should promote axe counterplay");
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
// Never self-launch into a close opponent who is already holding a mace.
{
  const d=makeBrain().decide({...base,distance:4.5,windMaceSmashReady:true,enemyMaceHeldClose:true,
    capabilities:{...base.capabilities,wind:true,mace:true},enemy:{...base.enemy,held:"mace"}});
  assert.notEqual(d.action,"wind_mace_launch","a close mace holder makes self-launching into the air an unsafe opening");
  assert.equal(d.style,"spear","prefer grounded mid-range spear pressure over a risky self-launch when a spear is available");
  assert.equal(d.action,"spear_pressure");
}

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
  assert.equal(d.action,"shield_drain","raised shield with drain prerequisites should select the bounded multi-strike executor");
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

{
  assert.equal(distanceToEntityHitbox(
    {position:{x:0,y:64,z:0},height:1.8},
    {position:{x:3.3,y:64,z:0},height:1.8,width:0.6}
  ),3.0,"melee reach should measure from eye to nearest target hitbox point, not feet-to-feet distance");
  assert.ok(Math.abs(distanceToEntityHitbox(
    {position:{x:0,y:64,z:0},height:1.8},
    {position:{x:4,y:64,z:0},height:1.8,width:0.6}
  )-3.7)<1e-9,"target hitbox geometry must still reject genuinely out-of-reach attacks");
  assert.equal(distanceToEntityHitbox(null,{position:{x:0,y:0,z:0}}),Infinity,
    "unknown attacker geometry must fail closed");
}

console.log("Advanced Impossible tactical routing regression tests passed.");

{
{
  const d=makeBrain().decide({...base,distance:2.7,spearLungeReady:true,capabilities:{...base.capabilities,spear:true}});
  assert.equal(d.action,"spear_lunge","an enchanted spear should use its jab-lunge in valid close range");
}
  const d=makeBrain().decide({...base,distance:2.8,stunSlamReady:true,capabilities:{...base.capabilities,wind:true},
    enemy:{...base.enemy,shield:true,usingItem:true}});
  assert.equal(d.action,"stun_slam","grounded shield target with axe, mace, and wind must start the full axe-disable → launch → confirmed slam sequence");
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

assert.equal(failedActionBackoffMs("melee_attack",true),0,"an unconfirmed swing must use the vanilla weapon cooldown, not an extra action lock");
assert.equal(failedActionBackoffMs("finish",true),0,"a totem-pop finisher must not be suppressed for 1.6 seconds after a swing");
assert.equal(failedActionBackoffMs("melee_attack",false),450,"an equip/precondition failure still gets a bounded retry delay");
assert.equal(failedActionBackoffMs("wind_mace_launch",false),1600,"complex launch failures retain a longer bounded recovery window");
console.log("PvP failed-strike cooldown regression tests passed.");

{
  assert.ok(controllerSource.includes('helmet:["netherite_helmet","diamond_helmet","iron_helmet","chainmail_helmet","golden_helmet","leather_helmet","turtle_shell"]'),
    "helmet slot must include turtle shell instead of treating it as a chestplate");
  assert.ok(controllerSource.includes('leggings:["netherite_leggings","diamond_leggings","iron_leggings","chainmail_leggings","golden_leggings","leather_leggings"]') &&
    controllerSource.includes('boots:["netherite_boots","diamond_boots","iron_boots","chainmail_boots","golden_boots","leather_boots"]'),
    "preflight must recognize leggings and boots armor upgrades");
  assert.ok(controllerSource.includes("const equipCombatArmor=async()=>") &&
    controllerSource.includes("await equipCombatArmor();") &&
    controllerSource.includes("candidates.sort((a,b)=>armorTier(lname(b))-armorTier(lname(a)))"),
    "combat must select the strongest available armor instead of relying on inventory order");
  assert.ok(controllerSource.includes('const originalChestName=lname(bot.entity?.equipment?.[4]||"");') &&
    controllerSource.includes("torso_loadout_restored="),
    "Elytra-mace must restore the original torso item instead of always leaving Elytra equipped");
}


{
  const d=makeBrain().decide({...base,distance:2.8,maceCrystalDTapReady:true,selfMaceSmashReady:true,attackReadyAt:0,
    capabilities:{...base.capabilities,crystal:true},inventory:{...base.inventory,crystal:2,obsidian:8}});
  assert.equal(d.action,"mace_d_tap","validated mace smash window with a safe crystal base should select mace-crystal D-tap");
}
console.log("Mace-crystal D-tap and attribute-swap separation tests passed.");

{
  assert.ok(controllerSource.includes('mace_d_tap sequence_complete=true mace_confirmed=true crystal_followup_confirmed=') &&
    /return true;\r?\n\s*};\r?\n\r?\n\s*const maceSmash=async/.test(controllerSource),
    "a confirmed mace hit must not be reclassified as failure merely because the optional crystal follow-up is unsafe or unconfirmed");
  assert.ok(controllerSource.includes('const jumpSynced=bot.entity?.onGround===true;') &&
    controllerSource.includes('if(jumpSynced)bot.setControlState("jump",true);') &&
    controllerSource.includes('if(jumpSynced)bot.setControlState("jump",false);') &&
    controllerSource.includes('wind_mace_launch_input jump_synchronized='),
    "ground wind-charge mace setup must synchronize a jump input and always release it before validating actual launch");
}



// Opponent model must learn from repeated observed behavior without assuming
// hidden inventory or changing decisions from a single noisy snapshot.
{
  const brain=makeBrain();
  for(let i=0;i<12;i++){
    brain.decide({...base,distance:4,enemy:{...base.enemy,shield:true,usingItem:true,retreating:i%2===0,held:"shield"}});
  }
  const model=brain.inspect(base).opponentModel;
  assert.equal(model.samples,12,"opponent profile must count observed combat decisions");
  assert.ok(model.shieldRate>0.9,"repeated active shield use must be reflected in the learned profile");
  assert.ok(model.retreatRate>0.4&&model.retreatRate<0.6,"retreat frequency must be measured from observations");
  assert.ok(model.weaponChanges.some(([name])=>name==="shield"),"observed held-item changes must be recorded");
}
console.log("Evidence-based opponent adaptation regression tests passed.");

assert.ok(controllerSource.includes("retreating:speed(t)>.18&&!enemyClosing"),
  "retreat adaptation must distinguish movement away from ZOYA from generic target movement");


// Defensive shield should trigger before collision range; pearl pursuit must not depend on an unrelated burst flag.
assert.ok(controllerSource.includes("d>=2.25&&d<=5.2&&!enemyMaceThreat"),"shield readiness covers an approaching melee threat before point-blank range");
assert.ok(brainSource.includes('d>=2.25&&d<=5.2&&!e.shield'),"shield decision uses widened block window");
assert.ok(brainSource.includes('has(c,"pearl")&&c.recoveryPearlReady&&c.pearlAmbushReady'),"pearl intercept does not depend on unrelated burst capability flag");


assert.ok(controllerSource.includes('" shield="+count(bot,"shield")+" pearls="+count(bot,"pearl")'),"combat startup must report whether shield/pearls are actually available within the expanded inventory line");
assert.ok(controllerSource.includes("stunSlamReady=\"+Boolean(ctx.stunSlamReady)") && controllerSource.includes("pearlCatchReady=\"+Boolean(ctx.pearlCatchReady)"),"combat telemetry must expose pearl-catch and stun-slam readiness instead of hiding skipped prerequisites");


// Ranged aim uses bounded flight-time lead, while kit scoring avoids committing
// to a bow/crossbow that cannot currently fire.
{
  assert.ok(controllerSource.includes('const leadTicks=Math.max(0,Math.min(12,num(lead)*20));'),
    "aim prediction must support a bounded ranged flight-time lead instead of clamping every shot to four ticks");
  assert.ok(controllerSource.includes("maxLeadTicks=4") && controllerSource.includes("predictTargetPosition(t.position,v,state.targetAcceleration,leadTicks,12)"),
    "look targeting must pass the extended bound through to the predictor while other prediction callers keep the conservative default");
  assert.ok(controllerSource.includes('?Math.min(.6,.08+dist(bot.entity,live)*.035):.08'),
    "bow and crossbow aim lead must scale with observed distance while melee aim remains short");
  assert.ok(brainSource.includes('if(invHas(c,"bow")&&c.hasBowAmmo!==false)'),
    "unavailable bows must not win style selection and trap the bot in ranged mode");
  assert.ok(brainSource.includes('if(invHas(c,"crossbow")&&c.hasCrossbowAmmo!==false)'),
    "unloaded crossbows without ammunition must not win style selection");
  const noRangedAmmo=makeBrain().decide({...base,distance:9,lineOfSight:true,hasBowAmmo:false,hasCrossbowAmmo:false,
    inventory:{...base.inventory,bow:1,crossbow:1}});
  assert.notEqual(noRangedAmmo.style,"bow","no-ammo bow must not be selected as the preferred combat style");
  assert.notEqual(noRangedAmmo.style,"crossbow","unloaded no-ammo crossbow must not be selected as the preferred combat style");
}
console.log("Predictive ranged aim and ammo-aware kit selection tests passed.");


// A real Java critical cannot be delivered while sprinting; the controller
// must release sprint and revalidate the falling window before attacking.
{
  const critStart=controllerSource.indexOf("const fallingCrit=async t=>");
  const critEnd=controllerSource.indexOf("const hitSelect=async t=>",critStart);
  const critBody=controllerSource.slice(critStart,critEnd);
  assert.ok(critBody.includes('bot.setControlState("sprint",false);') &&
    critBody.includes("const critWindowStillValid=") &&
    critBody.indexOf('bot.setControlState("sprint",false);')<critBody.indexOf("const critWindowStillValid=") &&
    critBody.indexOf("const critWindowStillValid=")<critBody.indexOf("bot.attack(t);"),
    "falling sword critical must release sprint and revalidate the falling hit window before the swing");
}
console.log("Sprint-free critical-hit timing tests passed.");


// A shield must remain raised across the incoming projectile's impact window,
// not be dropped the moment the blocking pose is first observed.
{
  const shieldStart=controllerSource.indexOf("const shield=async(t,holdMs=260)=>");
  const shieldEnd=controllerSource.indexOf("const crossbowChargeState=",shieldStart);
  const shieldBody=controllerSource.slice(shieldStart,shieldEnd);
  assert.ok(shieldBody.includes("Math.max(260,Math.min(650,num(holdMs,260)))") &&
    shieldBody.includes("if(isEntityBlockingWithShield(bot.entity))blockObserved=true") &&
    !shieldBody.includes("if(isEntityBlockingWithShield(bot.entity)){blockObserved=true;break}"),
    "shielding must hold for the configured impact window after the block animation begins");
  assert.ok(controllerSource.includes('case "shield": ok=await shield(t,ctx.projectileThreat?550:320);break;'),
    "projectile defense must use a longer shield hold than a brief melee block");
  assert.ok(controllerSource.includes("shield_raised_observed=") && controllerSource.includes("projectile_block_confirmed=false"),
    "shield telemetry must not mistake observing the raised pose for confirming that a projectile was actually blocked");
}
console.log("Projectile shield impact-window tests passed.");


// Mace smash windows use entity hitbox geometry rather than center distance,
// which includes vertical separation during the falling strike.
{
  const smashStart=controllerSource.indexOf("const maceSmash=async(t,priorFallDistance=0,settleMs=180)=>");
  const smashEnd=controllerSource.indexOf("const wind=async t=>",smashStart);
  const smashBody=controllerSource.slice(smashStart,smashEnd);
  assert.ok(smashBody.includes("const smashHitboxDistance=distanceToEntityHitbox(bot.entity,live)") &&
    smashBody.includes("if(falling&&fallDistance>1.5&&smashHitboxDistance<=3.05)"),
    "mace smash must use target hitbox distance during descent instead of an overly restrictive center-distance band");
  const windStart=controllerSource.indexOf("const wind=async t=>");
  const windEnd=controllerSource.indexOf("const dodge=async t=>",windStart);
  const windBody=controllerSource.slice(windStart,windEnd);
  assert.ok(windBody.includes("if(fallDistance>1.5&&smashHitboxDistance<=3.05)"),
    "wind-charge mace combo must call the smash executor when the falling hitbox enters real reach");
}
console.log("Falling mace hitbox-window tests passed.");

assert.ok(controllerSource.includes('function isAirborne(e){return e?.onGround===false||(e?.onGround==null&&num(e?.velocity?.y)<-.08)}'),
  "airborne combat windows must still be recognized from downward velocity when a server omits onGround metadata");
assert.ok(controllerSource.includes('onGround:bot.entity?.onGround===true||(bot.entity?.onGround==null&&Math.abs(num(bot.entity?.velocity?.y))<.08),falling:num(bot.entity?.velocity?.y)<-.08'),
  "brain context must not misclassify an unknown onGround state as grounded while the bot is falling");



// High pearl-catch throws need enough time for a real server-side landing;
// a short timeout incorrectly labels a still-flying pearl as a failed catch.
{
  const catchStart=controllerSource.indexOf("const pearlCatch=async(t,diagonal=false)=>");
  const catchEnd=controllerSource.indexOf("const windChargeCancel=async t=>",catchStart);
  const catchBody=controllerSource.slice(catchStart,catchEnd);
  assert.ok(catchBody.includes("const catchUntil=Date.now()+2800"),
    "high pearl-catch throws must wait long enough for the pearl to land and the teleport to be observed");
  assert.ok(catchBody.includes("isConfirmedPearlCatch(displaced,pearlStillExists)"),
    "longer pearl-catch waiting must still require real displacement and projectile disappearance, not just time elapsed");
}
console.log("High pearl-catch landing-window tests passed.");

assert.ok(controllerSource.includes('const p=bot.entity.position.clone()') &&
  controllerSource.includes('const pearlAim=()=>bot.entity.position.offset(hx,hy,hz)'),
  "pearl-catch aiming must use the actual airborne position and a repeatable aim ray");
assert.ok(controllerSource.includes("const hx=diagonal?(awayX*3.0+sideX*2.5):awayX*4.5") &&
  controllerSource.includes("const hz=diagonal?(awayZ*3.0+sideZ*2.5):awayZ*4.5") &&
  controllerSource.includes("const hy=diagonal?7.0:8.0"),
  "pearl-catch throws must use a defined upward trajectory with meaningful horizontal travel");
assert.ok(controllerSource.includes("pearl_catch_throw_aim mode=") &&
  controllerSource.includes("elevationDeg="),
  "pearl-catch logs must expose the actual throw geometry for diagnosing trajectory failures");
const catchStartForTiming=controllerSource.indexOf("const pearlCatch=async(t,diagonal=false)=>");
const catchEndForTiming=controllerSource.indexOf("const windChargeCancel=async t=>",catchStartForTiming);
const catchTimingBody=controllerSource.slice(catchStartForTiming,catchEndForTiming);
const pearlFireAt=catchTimingBody.indexOf('if(!selectHotbarItem("pearl"))');
const windFireAt=catchTimingBody.indexOf('if(!selectHotbarItem("wind"))',pearlFireAt);
const observePearlAt=catchTimingBody.indexOf("const pearlUntil=Date.now()+700");
assert.ok(pearlFireAt>=0&&windFireAt>pearlFireAt&&observePearlAt>windFireAt,
  "the wind charge must be fired immediately after the pearl, before waiting for projectile observation");
assert.ok(catchTimingBody.includes('pearl_catch_skipped reason=pearl_and_wind_must_be_in_distinct_hotbar_slots') &&
  controllerSource.includes('hotbarSlot("pearl")!==hotbarSlot("wind")'),
  "the combo must not claim readiness if the two items cannot be switched quickly from distinct hotbar slots");
assert.ok(controllerSource.includes('pearlCatchReady:Boolean(has(bot,"pearl")&&has(bot,"mace")&&count(bot,"wind")>=2&&hotbarSlot("pearl")!=null&&hotbarSlot("wind")!=null'),
  "brain readiness must match the combo's hotbar prerequisites");
console.log("Pearl-catch same-line timing regression tests passed.");
assert.ok(controllerSource.includes("hp>7&&!enemyMaceHeldClose&&!enemyMaceThreat"),
  "pearl-catch readiness must be suppressed when a close enemy mace threat makes the setup unsafe");

const throwPearlStart=controllerSource.indexOf("const throwPearl=async(t,mode=\"escape\")=>");
const throwPearlEnd=controllerSource.indexOf("const webEscape=async()=>",throwPearlStart);
const throwPearlBody=controllerSource.slice(throwPearlStart,throwPearlEnd);
assert.ok(throwPearlBody.includes("const estimatedFlightTicks=horizontalDistance/1.35") &&
  throwPearlBody.includes("const dropCompensation=Math.max(0.15,Math.min(3.5,0.03*estimatedFlightTicks*(estimatedFlightTicks+1)/2))") &&
  throwPearlBody.includes("await bot.lookAt(aimPoint,true)"),
  "ordinary pearl throws must compensate for gravity instead of aiming directly at the landing block");
assert.ok(throwPearlBody.includes("const teleportDeadline=Date.now()+3500") &&
  throwPearlBody.includes("pearl_throw_aim mode="),
  "pearl throws must expose aim geometry and allow a bounded landing/teleport confirmation window");

assert.ok(throwPearlBody.includes('bot.on?.("entitySpawn",pearlSpawnListener)') &&
  throwPearlBody.includes('bot.removeListener?.("entitySpawn",pearlSpawnListener)') &&
  throwPearlBody.includes("let observedPearl=null, pearlSpawnListener=null"),
  "ordinary pearl tracking must capture fast entity spawns and always remove its listener");
assert.ok(catchTimingBody.includes('bot.on?.("entitySpawn",pearlSpawnListener)') &&
  catchTimingBody.includes("const beforePos=catchBaseline") &&
  catchTimingBody.includes('bot.removeListener?.("entitySpawn",pearlSpawnListener)'),
  "instant pearl catches must retain the pearl spawn and measure displacement from before teleport, with listener cleanup");


assert.ok(catchTimingBody.includes("pearl_catch_wind_followup_projectile_observed="),
  "pearl catch telemetry must distinguish an unobserved wind-charge follow-up from a failed teleport");

assert.ok(catchTimingBody.includes("const firstWindAt=Date.now()") &&
  catchTimingBody.includes("const windReadyAt=firstWindAt+650") &&
  catchTimingBody.includes("pearl_catch_first_wind_cooldown_elapsed_ms="),
  "pearl catch must respect the first wind charge's half-second cooldown before firing the immediate follow-up");



// The preflight inventory line must show all major kit prerequisites so a
// missing bow/crystal/anchor/elytra is distinguishable from broken execution.
assert.ok(controllerSource.includes('skill_inventory sword=') &&
  controllerSource.includes('bow="+count(bot,"bow")') &&
  controllerSource.includes('crystals="+count(bot,"crystal")') &&
  controllerSource.includes('anchors="+count(bot,"anchor")') &&
  controllerSource.includes('elytra="+count(bot,"elytra")') &&
  controllerSource.includes('fireworks="+count(bot,"firework")'),
  "combat preflight must log the item counts needed to explain why kit-specific skills are unavailable");
console.log("Full combat-kit inventory telemetry tests passed.");
