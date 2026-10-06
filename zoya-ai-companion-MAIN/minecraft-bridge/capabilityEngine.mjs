import pathfinderPackage from "mineflayer-pathfinder";
const { goals } = pathfinderPackage;
import { CAPABILITY_MODES, assertCapabilityRegistry } from "./capabilityModes.mjs";

export const CAPABILITIES = CAPABILITY_MODES;

const HOSTILES = new Set(["zombie","husk","drowned","skeleton","stray","creeper","spider","cave_spider","witch","pillager","vindicator","evoker","ravager","phantom","blaze","magma_cube","silverfish","endermite","guardian","elder_guardian","piglin_brute","hoglin","zoglin","enderman"]);
const PASSIVES = new Set(["cow","pig","sheep","chicken","rabbit","horse","donkey","mule","llama","goat","mooshroom","strider","turtle","fish","cod","salmon"]);
const CROPS = new Set(["wheat","carrots","potatoes","beetroots","nether_wart"]);
const CONTAINERS = new Set(["chest","trapped_chest","barrel","shulker_box","ender_chest"]);
const WEAPON_KINDS = ["mace","sword","axe","trident"];

const CAPABILITY_ENGINE_PATCH = "combat-survival-interruption-v1-area-workstations-liquids-vehicle-player-interactions-2026-10-04";
const required = (v,msg="Argument is required.") => {
  const s=String(v??"").trim(); if(!s) throw new Error(msg); return s;
};
const parts = v => String(v??"").trim().split(/\s+/).filter(Boolean);
const number = (v,msg="Expected a number.") => {
  const n=Number(v); if(!Number.isFinite(n)) throw new Error(msg); return n;
};
const vec = (bot,p) => new bot.entity.position.constructor(Number(p.x),Number(p.y),Number(p.z));
const coords = v => {
  const a=parts(v).map(Number); if(a.length!==3||a.some(n=>!Number.isFinite(n))) throw new Error("Expected x y z.");
  return {x:a[0],y:a[1],z:a[2]};
};
const sleep = ms => new Promise(r=>setTimeout(r,Math.max(0,Number(ms)||0)));

function entityName(e){ return String(e?.name||e?.displayName||e?.username||"").toLowerCase(); }
function distance(bot,e){ return e?.position ? bot.entity.position.distanceTo(e.position) : Infinity; }
function nearest(bot,predicate,max=Infinity){
  return Object.values(bot.entities||{}).filter(e=>e?.position&&e!==bot.entity&&distance(bot,e)<=max&&predicate(e))
    .sort((a,b)=>distance(bot,a)-distance(bot,b))[0]||null;
}
function player(bot,name){
  const w=required(name,"Username is required.").toLowerCase();
  return Object.values(bot.players||{}).find(p=>String(p?.username||"").toLowerCase()===w)||null;
}
function inventoryItem(bot,name){
  const w=required(name,"Item is required.").toLowerCase().replace(/\s+/g,"_");
  return bot.inventory.items().find(i=>i.name.toLowerCase()===w) ||
    bot.inventory.items().find(i=>i.name.toLowerCase().includes(w)) || null;
}
function countItem(bot,name){
  const w=String(name||"").toLowerCase().replace(/\s+/g,"_");
  return bot.inventory.items().filter(i=>i.name.toLowerCase()===w||i.name.toLowerCase().includes(w)).reduce((n,i)=>n+i.count,0);
}
function weaponScore(name){
  const n=String(name||"").toLowerCase();
  const m=n.includes("netherite")?7:n.includes("diamond")?6:n.includes("iron")?5:n.includes("stone")?4:n.includes("golden")?3:n.includes("wooden")?2:0;
  const k=n.includes("mace")?4:n.includes("sword")?3:n.includes("axe")?2:n.includes("trident")?1:0;
  return m*10+k;
}
function bestWeapon(bot){
  return bot.inventory.items().filter(i=>WEAPON_KINDS.some(k=>i.name.toLowerCase().includes(k)))
    .sort((a,b)=>weaponScore(b.name)-weaponScore(a.name))[0]||null;
}
function armorSlot(name){
  const n=String(name||"").toLowerCase();
  if(n.includes("helmet")||n==="turtle_shell") return "head";
  if(n.includes("chestplate")) return "torso";
  if(n.includes("leggings")) return "legs";
  if(n.includes("boots")) return "feet";
  return null;
}
function armorMaterialTier(name){
  const n=String(name||"").toLowerCase();
  if(n.includes("netherite")) return 7;
  if(n.includes("diamond")) return 6;
  if(n.includes("iron")) return 5;
  if(n.includes("chainmail")) return 4;
  if(n.includes("golden")) return 3;
  if(n.includes("leather")) return 2;
  if(n.includes("turtle_shell")) return 4;
  return 0;
}
function armorEnchantments(item){
  const found={};
  const root=item?.nbt?.value??item?.nbt;
  const readScalar=v=>v?.value??v;
  const walk=node=>{
    if(!node||typeof node!=="object") return;
    if(Array.isArray(node)){for(const value of node) walk(value);return;}
    const id=readScalar(node.id);
    const lvl=Number(readScalar(node.lvl));
    if(typeof id==="string"&&Number.isFinite(lvl)){
      const key=id.toLowerCase().replace(/^minecraft:/,"");
      found[key]=Math.max(found[key]||0,lvl);
    }
    for(const value of Object.values(node)) walk(value);
  };
  walk(root);
  return found;
}
function armorScore(item,destination){
  const tier=armorMaterialTier(item?.name);
  if(!tier||armorSlot(item?.name)!==destination) return -Infinity;
  const e=armorEnchantments(item);
  // Material tier is the primary ranking. Protection enchantments are the
  // secondary ranking, followed by durability-oriented enchantments.
  return tier*1000 +
    (e.protection||0)*40 +
    (e.fire_protection||0)*30 +
    (e.blast_protection||0)*28 +
    (e.projectile_protection||0)*28 +
    (e.unbreaking||0)*3 +
    (e.mending||0)*2;
}
function equippedArmor(bot,destination){
  const index={feet:1,legs:2,torso:3,head:4}[destination];
  return index==null?null:(bot.entity?.equipment?.[index]||null);
}
function bestArmorBySlot(bot,destination){
  return bot.inventory.items()
    .filter(item=>armorSlot(item.name)===destination)
    .sort((a,b)=>armorScore(b,destination)-armorScore(a,destination))[0]||null;
}
function active(ctx){ ctx.assertActive(); }
async function wait(ctx,ms){ await ctx.sleep(ms); active(ctx); }

async function navigate(ctx,p,range=2,timeout=30000,label="navigation"){
  const {bot}=ctx, t=vec(bot,p);
  active(ctx);
  bot.pathfinder.setGoal(new goals.GoalNear(t.x,t.y,t.z,range));
  const deadline=Date.now()+timeout;
  try{
    while(Date.now()<deadline){
      active(ctx);
      if(bot.entity.position.distanceTo(t)<=range)return true;
      await wait(ctx,100);
    }
    throw new Error(label+" timed out.");
  }finally{try{bot.pathfinder.setGoal(null);}catch{}}
}
async function follow(ctx,target,range=3){
  const {bot}=ctx;
  if(!target?.isValid) throw new Error("Target lost.");
  bot.pathfinder.setGoal(new goals.GoalFollow(target,range),true);
  try{
    while(true){
      active(ctx);
      if(!target.isValid) throw new Error("Target lost.");
      await wait(ctx,150);
    }
  }finally{try{bot.pathfinder.setGoal(null);}catch{}}
}

async function navigateXZ(ctx,p,range=3,timeout=30000,label="navigation"){
  const {bot}=ctx;
  active(ctx);
  const x=Number(p.x), z=Number(p.z);  if(!Number.isFinite(x)||!Number.isFinite(z)) throw new Error("Invalid X/Z target.");
  bot.pathfinder.setGoal(new goals.GoalNearXZ(x,z,range));
  const deadline=Date.now()+timeout;
  try{
    while(Date.now()<deadline){
      active(ctx);
      const dx=bot.entity.position.x-x;
      const dz=bot.entity.position.z-z;
      if(Math.hypot(dx,dz)<=range) return true;
      await wait(ctx,100);
    }
    throw new Error(label+" timed out.");
  }finally{try{bot.pathfinder.setGoal(null);}catch{}}
}
async function lookAt(ctx,p){ active(ctx); await ctx.bot.lookAt(vec(ctx.bot,p),true); return true; }
async function lookAtEntity(ctx,e){ active(ctx); await ctx.bot.lookAt(e.position.offset(0,e.height||1.4,0),true); return true; }

function combatItem(bot, predicate) {
  return bot.inventory?.items?.().find(item => predicate(String(item?.name || "").toLowerCase())) || null;
}
function combatWeapon(bot, kind) {
  const order = kind === "axe" ? ["netherite_axe","diamond_axe","iron_axe","stone_axe","golden_axe","wooden_axe"]
    : kind === "mace" ? ["mace"]
    : kind === "spear" ? ["netherite_spear","diamond_spear","iron_spear","stone_spear","golden_spear","wooden_spear","spear"]
    : ["netherite_sword","diamond_sword","iron_sword","stone_sword","golden_sword","wooden_sword"];
  for (const wanted of order) {
    const item = bot.inventory?.items?.().find(x => String(x?.name || "").toLowerCase() === wanted);
    if (item) return item;
  }
  return null;
}
function combatShield(bot) {
  return bot.inventory?.items?.().find(x => String(x?.name || "").toLowerCase() === "shield") || null;
}
function combatGapple(bot) {
  return combatItem(bot, n => n === "enchanted_golden_apple" || n === "golden_apple");
}
function combatPearl(bot) {
  return combatItem(bot, n => n === "ender_pearl");
}
function combatBow(bot) {
  return combatItem(bot, n => n === "bow") && combatItem(bot, n => n === "arrow" || n.endsWith("_arrow"));
}
function combatDistance(bot, target) {
  return target?.position ? bot.entity.position.distanceTo(target.position) : Infinity;
}
function combatPredictedPosition(target, leadMs = 120) {
  const p = target?.position;
  const v = target?.velocity;
  if (!p) return null;
  const t = Math.max(0, Math.min(350, Number(leadMs) || 0)) / 1000;
  return { x: p.x + Number(v?.x || 0) * t, y: p.y + Number(v?.y || 0) * t, z: p.z + Number(v?.z || 0) * t };
}
async function combatAim(ctx, target, leadMs = 80) {
  active(ctx);
  const point = combatPredictedPosition(target, leadMs) || target.position;
  await ctx.bot.lookAt(vec(ctx.bot, { x: point.x, y: point.y + Math.max(0.9, Number(target.height || 1.2) * 0.65), z: point.z }), true);
}
function targetBlocking(target) {
  if (!target) return false;
  const offhand = target.equipment?.[1];
  const mainhand = target.equipment?.[0];
  const offhandShield = String(offhand?.name || "").toLowerCase() === "shield";
  const mainhandShield = String(mainhand?.name || "").toLowerCase() === "shield";
  if (!offhandShield && !mainhandShield) return false;

  // Mineflayer's Entity does not expose a stable, documented player
  // "isBlocking" property. For player shield use, the protocol's living
  // entity hand-state metadata is the authoritative signal we can observe:
  // bit 0 = active item use, bit 1 = off-hand active. Prefer it when present.
  const rawHandState = target.metadata?.[8];
  const handState = Number(
    rawHandState?.value ?? rawHandState
  );
  if (Number.isFinite(handState)) {
    const usingItem = (handState & 0x01) !== 0;
    if (!usingItem) return false;
    const offhandActive = (handState & 0x02) !== 0;
    return offhandActive ? offhandShield : mainhandShield;
  }

  // Compatibility fallbacks for servers/entity implementations that expose
  // a higher-level flag instead of the raw hand-state metadata.
  if (target.isBlocking === true) return true;
  if (target.isUsingItem === true) {
    // Without hand-state information, only trust the main-hand shield. This
    // avoids falsely treating an off-hand shield as active while eating/bowing.
    return mainhandShield && String(target.heldItem?.name || "").toLowerCase() === "shield";
  }
  return false;
}
async function combatEquip(ctx, item, destination = "hand") {
  if (!item) return false;
  active(ctx);
  await ctx.bot.equip(item, destination);
  active(ctx);
  return true;
}
async function combatSprintReset(ctx) {
  const bot = ctx.bot;
  active(ctx);
  bot.setControlState?.("sprint", false);
  await wait(ctx, 60);
  bot.setControlState?.("sprint", true);
  await wait(ctx, 90);
  bot.setControlState?.("sprint", false);
}
async function combatStrafe(ctx, target, direction = 1, ms = 180) {
  const bot = ctx.bot;
  active(ctx);
  try { bot.pathfinder?.setGoal?.(null); } catch {}
  await combatAim(ctx, target, 40);
  bot.setControlState?.("forward", true);
  bot.setControlState?.("left", direction < 0);
  bot.setControlState?.("right", direction > 0);
  bot.setControlState?.("sprint", true);
  try { await wait(ctx, ms); } finally {
    bot.clearControlStates?.();
  }
}
async function combatJumpReset(ctx) {
  const bot = ctx.bot;
  if (!bot.entity?.onGround) return;
  active(ctx);
  bot.setControlState?.("jump", true);
  await wait(ctx, 70);
  bot.setControlState?.("jump", false);
}
async function combatRetreat(ctx, target) {
  const bot = ctx.bot;
  const dx = bot.entity.position.x - target.position.x;
  const dz = bot.entity.position.z - target.position.z;
  const len = Math.hypot(dx, dz) || 1;
  const point = { x: bot.entity.position.x + dx / len * 8, y: bot.entity.position.y, z: bot.entity.position.z + dz / len * 8 };
  try { await navigate(ctx, point, 4, 4500, "combat retreat"); } catch {}
}
async function combatUseGapple(ctx) {
  const item = combatGapple(ctx.bot);
  if (!item) return false;
  await combatEquip(ctx, item, "hand");
  try { await ctx.bot.consume(); return true; } catch { return false; }
}
async function combatPrepareTotem(ctx) {
  const bot = ctx.bot;
  const totem = inventoryItem(bot, "totem_of_undying");
  if (!totem) return false;
  // Mace/crystal kits benefit from a totem in the off-hand even at full
  // health. Sword/axe combat keeps the shield unless an emergency totem is
  // required.
  const maceKit = Boolean(combatWeapon(bot, "mace"));
  const crystalKit = Boolean(combatItem(bot, n => n === "end_crystal"));
  const emergency = Number(bot.health || 20) <= 8;
  if (!maceKit && !crystalKit && !emergency) return false;
  try { await combatEquip(ctx, totem, "off-hand"); return true; } catch { return false; }
}
async function combatPearlEscape(ctx, target) {
  const pearl = combatPearl(ctx.bot);
  if (!pearl) return false;
  const bot = ctx.bot;
  const dx = bot.entity.position.x - target.position.x;
  const dz = bot.entity.position.z - target.position.z;
  const len = Math.hypot(dx, dz) || 1;
  const point = { x: bot.entity.position.x + dx / len * 12, y: bot.entity.position.y + 2, z: bot.entity.position.z + dz / len * 12 };
  await combatEquip(ctx, pearl, "hand");
  await ctx.bot.lookAt(vec(ctx.bot, point), true);
  active(ctx);
  bot.activateItem();
  await wait(ctx, 650);
  return true;
}
async function combatBowAttack(ctx, target) {
  const bow = combatItem(ctx.bot, n => n === "bow");
  const arrow = combatItem(ctx.bot, n => n === "arrow" || n.endsWith("_arrow"));
  if (!bow || !arrow) return false;
  await combatEquip(ctx, bow, "hand");
  await combatAim(ctx, target, 140);
  active(ctx);
  ctx.bot.activateItem();
  try { await wait(ctx, 900); } finally { try { ctx.bot.deactivateItem(); } catch {} }
  return true;
}
async function combatMaceAttack(ctx, target) {
  const bot = ctx.bot;
  const mace = combatWeapon(bot, "mace");
  if (!mace) return false;

  await combatEquip(ctx, mace, "hand");
  const deadline = Date.now() + 2200;
  let armed = false;

  while (Date.now() < deadline) {
    active(ctx);
    const d = combatDistance(bot, target);
    const fall = Number(bot.entity?.fallDistance || 0);
    const vy = Number(bot.entity?.velocity?.y || 0);
    const airborne = !bot.entity?.onGround;

    if (airborne && fall > 1.5 && d <= 4.0) {
      await combatAim(ctx, target, 25);
      ctx.log?.("[PVP] mace attack window | dist=" + d.toFixed(2) + " fall=" + fall.toFixed(2));
      bot.attack(target);
      return true;
    }

    // If we are already airborne, do not start another jump. Wait for a real
    // downward smash window so the mace attack is server-valid.
    if (airborne) {
      if (vy < -0.05 || fall > 0.8) armed = true;
    } else if (!armed) {
      bot.setControlState?.("jump", true);
      await wait(ctx, 80);
      bot.setControlState?.("jump", false);
    }

    await wait(ctx, 25);
  }
  return false;
}

async function combatWindMaceAttack(ctx, target) {
  const bot = ctx.bot;
  const wind = combatItem(bot, n => n === "wind_charge");
  const mace = combatWeapon(bot, "mace");
  if (!wind || !mace || !bot.entity?.onGround) return false;

  const initialDistance = combatDistance(bot, target);
  if (initialDistance < 3.5 || initialDistance > 12) return false;

  // Vanilla wind-mace setup: jump first, then throw the wind charge near the
  // top of the jump while looking straight down. Throwing from the ground
  // without the jump produces a short/low launch and leaves no reliable smash
  // window.
  await combatEquip(ctx, wind, "hand");
  active(ctx);
  bot.setControlState?.("jump", true);
  await wait(ctx, 180);
  bot.setControlState?.("jump", false);

  await wait(ctx, 60);
  active(ctx);
  await bot.lookAt(vec(bot, {
    x: bot.entity.position.x,
    y: bot.entity.position.y - 8,
    z: bot.entity.position.z
  }), true);

  const damageBefore = targetDamageEvents;
  ctx.log?.("[PVP] wind-mace launch | dist=" + initialDistance.toFixed(2));
  bot.activateItem();

  // Give the projectile time to collide and apply its upward knockback.
  await wait(ctx, 180);
  await combatEquip(ctx, mace, "hand");

  const smashDeadline = Date.now() + 3000;
  let lastAimAt = 0;
  let attackSent = false;

  while (Date.now() < smashDeadline) {
    active(ctx);
    if (Number(bot.health || 20) <= 7) return false;
    if (target?.isValid === false) return false;

    const d = combatDistance(bot, target);
    const fall = Number(bot.entity?.fallDistance || 0);
    const vy = Number(bot.entity?.velocity?.y || 0);
    const now = Date.now();

    // Continuously put the target under the crosshair during descent.
    if (now - lastAimAt >= 35) {
      await combatAim(ctx, target, 20);
      lastAimAt = now;
    }

    // Vanilla's mace smash becomes valid once fallDistance exceeds 1.5.
    // Use a conservative normal-reach window and only swing while descending.
    if (!attackSent && !bot.entity?.onGround && fall >= 1.55 && vy < -0.05 && d <= 3.0) {
      ctx.log?.("[PVP] mace attack window | dist=" + d.toFixed(2) +
        " fall=" + fall.toFixed(2) + " vy=" + vy.toFixed(2));

      // Ensure the mace is fully selected before the swing and avoid sending
      // an early attack from the previous sword-combat cooldown.
      await wait(ctx, 80);
      await combatAim(ctx, target, 15);
      bot.attack(target);
      attackSent = true;

      await wait(ctx, 180);
      if (targetDamageEvents > damageBefore) {
        ctx.log?.("[PVP] mace hit confirmed | damageEvents=" + String(targetDamageEvents));
        return true;
      }

      ctx.log?.("[PVP] mace swing sent but no damage telemetry; aborting combo");
      return false;
    }

    if (bot.entity?.onGround) break;
    await wait(ctx, 20);
  }

  ctx.log?.("[PVP] wind-mace missed; no valid smash window");
  return false;
}

async function activateElytraForZoya(ctx) {
  const bot = ctx.bot;
  const version = String(bot.version || "").trim();
  const protocol = Number(bot.protocolVersion ?? bot._client?.protocolVersion ?? bot._client?.version);

  // 1.21.11 is protocol 774. Do not delegate this critical packet to an
  // unknown/stale client mapping: send the exact Mineflayer packet name and
  // mapper value used by the 1.21.11 protocol data.
  if (version === "1.21.11" && protocol === 774) {
    if (!bot.entity?.id && bot.entity?.id !== 0) throw new Error("Missing player entity id for Elytra activation.");
    if (!bot.registry?.supportFeature?.("entityActionUsesStringMapper")) {
      throw new Error("Minecraft 1.21.11 protocol data is missing the string-mapped entity_action feature.");
    }
    ctx.log?.("[PVP] elytra packet | version=1.21.11 protocol=774 action=start_elytra_flying");
    bot._client.write("entity_action", {
      entityId: bot.entity.id,
      actionId: "start_elytra_flying",
      jumpBoost: 0
    });
    return true;
  }

  await bot.elytraFly();
  return true;
}

async function combatElytraMaceAttack(ctx, target) {
  const bot = ctx.bot;
  if (bot.__zoyaElytraSafe === false) {
    ctx.log?.("[PVP] elytra-mace blocked by protocol safety guard | version=" +
      String(bot.version || "unknown") + " protocol=" +
      String(bot.protocolVersion ?? bot._client?.protocolVersion ?? bot._client?.version ?? "unknown"));
    return false;
  }
  const mace = combatWeapon(bot, "mace");
  const elytra = inventoryItem(bot, "elytra");
  const rocket = combatItem(bot, n => n === "firework_rocket");
  if (!mace || !elytra || !rocket || !bot.entity?.onGround) return false;

  const startDistance = combatDistance(bot, target);
  if (startDistance < 15 || startDistance > 50) return false;

  // Real Elytra-mace setup:
  // 1) equip Elytra + rocket
  // 2) jump high enough to leave the ground
  // 3) explicitly enter fall-flying
  // 4) use rockets to gain altitude
  // 5) stop gliding, equip mace, and dive onto the target.
  try {
    await combatEquip(ctx, elytra, "torso");
    await combatEquip(ctx, rocket, "hand");

    // Pathfinder must not own movement during the aerial combo.
    try { bot.pathfinder?.setGoal?.(null); } catch {}
    bot.clearControlStates?.();

    await combatAim(ctx, target, 180);
    bot.setControlState?.("jump", true);
    await wait(ctx, 250);
    bot.setControlState?.("jump", false);

    // Give physics a little more time to establish an airborne state before
    // requesting fall-flying. Runtime-aware wait exits with task cancellation
    // instead of hanging if the server disconnects during the launch.
    await wait(ctx, 100);
    if (bot.entity?.onGround) {
      ctx.log?.("[PVP] elytra launch failed: still grounded");
      return false;
    }

    ctx.log?.("[PVP] elytra start request | version="+String(bot.version||"unknown")+
      " protocol="+String(bot._client?.version||bot._client?.protocolVersion||"unknown"));
    try {
      await activateElytraForZoya(ctx);
    } catch (err) {
      ctx.log?.("[PVP] elytraFly rejected: " + String(err?.message || err));
      return false;
    }

    // Mineflayer documents elytraFly() as the fall-flying activation call.
    // Wait for the server/entity state before sending any rocket.
    await wait(ctx, 150);
    if (!bot.entity?.elytraFlying) {
      ctx.log?.("[PVP] elytra launch not acknowledged");
      return false;
    }

    ctx.log?.("[PVP] elytra dive started | dist=" + startDistance.toFixed(2));

    const climbDeadline = Date.now() + 5000;
    let lastRocketAt = 0;
    let rocketCount = 0;

    while (Date.now() < climbDeadline) {
      active(ctx);
      if (Number(bot.health || 20) <= 9) return false;
      if (!bot.entity?.elytraFlying) {
        ctx.log?.("[PVP] elytra flight ended during climb");
        return false;
      }

      const targetY = Number(target.position?.y || 0);
      const botY = Number(bot.entity?.position?.y || 0);
      const nowMs = Date.now();

      // Stop climbing once we have useful vertical separation. The target
      // must be below us for a real mace fall.
      if (botY >= targetY + 12) break;

      // Firework rockets are the actual Elytra propulsion mechanism.
      if (nowMs - lastRocketAt >= 900) {
        await combatEquip(ctx, rocket, "hand");
        await combatAim(ctx, target, 220);
        active(ctx);
        bot.activateItem();
        rocketCount++;
        lastRocketAt = nowMs;
        ctx.log?.("[PVP] elytra rocket #" + String(rocketCount));
      }

      await wait(ctx, 100);
    }

    if (!bot.entity?.elytraFlying) return false;

    // Stop fall-flying before the mace impact. Swapping the Elytra out of the
    // torso slot is deterministic and leaves the bot in a normal fall.
    const chest = combatItem(bot, n => /_(chestplate)$/.test(n));
    if (!chest) {
      ctx.log?.("[PVP] elytra dive aborted: no chestplate to swap out");
      return false;
    }
    await combatEquip(ctx, chest, "torso");
    await combatEquip(ctx, mace, "hand");

    const damageBefore = targetDamageEvents;
    const smashDeadline = Date.now() + 3000;

    while (Date.now() < smashDeadline) {
      active(ctx);
      if (Number(bot.health || 20) <= 7) return false;
      if (target?.isValid === false) return false;

      const fall = Number(bot.entity?.fallDistance || 0);
      const vy = Number(bot.entity?.velocity?.y || 0);
      const d = combatDistance(bot, target);

      // Keep the target under the crosshair while descending.
      await combatAim(ctx, target, 35);

      if (!bot.entity?.onGround && !bot.entity?.elytraFlying &&
          fall >= 1.55 && vy < -0.05 && d <= 3.2) {
        ctx.log?.("[PVP] elytra-mace impact window | dist=" + d.toFixed(2) +
          " fall=" + fall.toFixed(2) + " vy=" + vy.toFixed(2));
        await wait(ctx, 50);
        await combatAim(ctx, target, 15);
        bot.attack(target);

        await wait(ctx, 200);
        if (targetDamageEvents > damageBefore) {
          ctx.log?.("[PVP] elytra-mace hit confirmed");
          return true;
        }
        ctx.log?.("[PVP] elytra-mace swing sent but no damage telemetry");
        return false;
      }

      if (bot.entity?.onGround) break;
      await wait(ctx, 50);
    }
  } catch (err) {
    ctx.log?.("[PVP] elytra-mace aborted: " + String(err?.message || err));
  }
  return false;
}

async function combatAdvancedAttack(ctx, target) {
  const mace = combatWeapon(ctx.bot, "mace");
  if (mace && Number(target?.position?.y || 0) - Number(ctx.bot.entity?.position?.y || 0) > 2) {
    return combatMaceAttack(ctx, target);
  }
  const spear = combatWeapon(ctx.bot, "spear");
  if (spear && combatDistance(ctx.bot, target) > 3.2 && combatDistance(ctx.bot, target) < 6.0) {
    await combatEquip(ctx, spear, "hand");
    await combatAim(ctx, target, 90);
    ctx.bot.attack(target);
    return true;
  }
  return false;
}
async function attack(ctx,target,timeout=15000){
  const {bot}=ctx; const deadline=Date.now()+timeout;
  let lastEntityId=target?.id;
  let swings=0;
  while(target?.isValid!==false && (target?.health==null||target.health>0) && Date.now()<deadline){
    active(ctx);
    const current=target;
    const d=distance(bot,current);
    if(d>3.1){
      bot.pathfinder.setGoal(new goals.GoalFollow(current,2.7),true);
      await wait(ctx,150);
      continue;
    }
    try{bot.pathfinder.setGoal(null);}catch{}
    await bot.lookAt(current.position.offset(0,current.height||1.2,0),true);
    active(ctx);
    bot.attack(current);
    swings++;
    await wait(ctx,450);
    // Mineflayer can invalidate an entity object during a world/entity update.
    // Re-resolve by UUID so a still-alive target does not silently end combat.
    const uuid=current?.uuid;
    if(uuid){
      const fresh=Object.values(bot.entities||{}).find(e=>e?.uuid===uuid&&e!==bot.entity);
      if(fresh && fresh.isValid!==false){
        target=fresh;
        lastEntityId=fresh.id;
      }
    }
  }
  try{bot.pathfinder.setGoal(null);}catch{}
  const alive=target?.isValid!==false && (target?.health==null||target.health>0);
  const killed=(target?.health!=null&&target.health<=0)||(target?.isValid===false&&swings>0);
  ctx.log?.("[COMBAT] attack loop target="+entityName(target)+
    " swings="+String(swings)+
    " finalHealth="+String(target?.health??"unknown")+
    " valid="+String(target?.isValid!==false)+
    " entityId="+String(target?.id??lastEntityId)+
    " killed="+String(killed));
  return killed;
}

async function nearestHostile(ctx,max=16){
  return nearest(ctx.bot,e=>HOSTILES.has(entityName(e))&&e.isValid!==false,max);
}

async function nearestAnimal(ctx,max=24){
  return nearest(ctx.bot,e=>PASSIVES.has(entityName(e)),max);
}
function locationMemory(ctx,name){
  const key=String(name||"").trim().toLowerCase().replace(/\s+/g,"_");
  const loc=ctx.runtime?.memory?.locations?.[key];
  if(!loc) throw new Error("Location not remembered: "+String(name));
  if(loc.dimension && String(ctx.bot.game?.dimension||"unknown")!==String(loc.dimension)) throw new Error("Location is in "+loc.dimension+"; current dimension is "+String(ctx.bot.game?.dimension||"unknown")+".");
  return loc;
}
async function findStructureMarker(ctx,name){
  const key=String(name||"").trim().toLowerCase().replace(/\s+/g,"_");
  const signatures={
    village:["bell","hay_block","composter","lectern","bed"],
    fortress:["nether_bricks","nether_brick_fence","nether_brick_stairs"],
    stronghold:["end_portal_frame","stone_bricks","iron_door"],
    monument:["prismarine","sea_lantern"],
    bastion:["blackstone","gilded_blackstone"],
    temple:["chest","sandstone","cut_sandstone"],
    desert_pyramid:["sandstone","cut_sandstone","orange_terracotta"],
    jungle_temple:["cobblestone","mossy_cobblestone","tripwire_hook"],
    shipwreck:["oak_planks","spruce_planks","dark_oak_planks","chest"]
  };
  const sig=signatures[key];
  if(!sig) throw new Error("Unsupported structure search: "+String(name)+".");
  const matches=[];
  for(const blockName of sig){
    const id=ctx.bot.registry?.blocksByName?.[blockName]?.id;
    if(id==null) continue;
    const found=ctx.bot.findBlocks({matching:id,maxDistance:64,count:8})||[];
    for(const pos of found) matches.push({name:blockName,pos});
  }
  if(!matches.length) throw new Error("No "+key+" marker found in loaded area.");
  matches.sort((a,b)=>ctx.bot.entity.position.distanceTo(vec(ctx.bot,a.pos))-ctx.bot.entity.position.distanceTo(vec(ctx.bot,b.pos)));
  const hit=matches[0];
  await navigate(ctx,hit.pos,2.5,30000,key+" marker");
  ctx.log?.("[STRUCTURE] "+key+" marker="+hit.name+" at "+String(hit.pos));
  return true;
}
async function findBiome(ctx,name){
  const wanted=String(name||"").trim().toLowerCase().replace(/^minecraft:/,"").replace(/\s+/g,"_");
  const info=ctx.bot.registry?.biomesByName?.[wanted];
  if(!info) throw new Error("Unknown biome: "+wanted);
  const world=ctx.bot.world;
  if(typeof world?.getBiome!=="function") throw new Error("Mineflayer world biome API is unavailable.");
  const origin=ctx.bot.entity.position;
  for(let r=0;r<=64;r+=4){
    for(let a=0;a<16;a++){
      active(ctx);
      const ang=a*Math.PI/8;
      const x=Math.floor(origin.x+Math.cos(ang)*r);
      const z=Math.floor(origin.z+Math.sin(ang)*r);
      const p=new ctx.bot.entity.position.constructor(x,Math.floor(origin.y),z);
      const id=world.getBiome(p);
      const numeric=typeof id==="number"?id:Number(id?.id);
      if(numeric===Number(info.id)){
        await navigate(ctx,{x:x+0.5,y:origin.y,z:z+0.5},3,30000,"biome");
        ctx.log?.("[BIOME] found "+wanted+" at "+x+" "+Math.floor(origin.y)+" "+z);
        return true;
      }
    }
  }
  throw new Error("Biome not found in loaded area within 64 blocks: "+wanted);
}
async function recoverDeathItems(ctx){
  const death=ctx.runtime?.memory?.lastDeath;
  if(!death||![death.x,death.y,death.z].every(Number.isFinite)) throw new Error("No remembered death location.");
  if(String(death.dimension||"unknown")!==String(ctx.bot.game?.dimension||"unknown")) throw new Error("Death location is in "+death.dimension+"; current dimension is "+String(ctx.bot.game?.dimension||"unknown")+".");
  const origin={x:death.x,y:death.y,z:death.z};
  let recovered=0;
  for(let pass=0;pass<3;pass++){
    active(ctx);
    const items=Object.values(ctx.bot.entities||{}).filter(e=>e?.position&&String(e.name||"").toLowerCase()==="item"&&e.position.distanceTo(vec(ctx.bot,origin))<=48);
    if(!items.length) break;
    for(const item of items.sort((a,b)=>a.position.distanceTo(vec(ctx.bot,origin))-b.position.distanceTo(vec(ctx.bot,origin)))){
      active(ctx);
      await navigate(ctx,item.position,1.2,15000,"death-item recovery");
      await wait(ctx,750);
      recovered++;
    }
  }
  if(!recovered) throw new Error("No dropped items found near remembered death location.");
  ctx.log?.("[RECOVER] approached "+recovered+" dropped item stack(s).");
  return true;
}
async function repairEquipment(ctx,a){
  const name=required(a,"Item is required.");  const target=inventoryItem(ctx.bot,name);
  if(!target) throw new Error("Item not found: "+name);
  const anvil=ctx.bot.findBlock({matching:x=>String(x?.name||"").endsWith("_anvil"),maxDistance:24});
  if(!anvil) throw new Error("No anvil nearby.");
  if(typeof ctx.bot.openAnvil!=="function") throw new Error("Mineflayer anvil API is unavailable.");
  await navigate(ctx,anvil.position,3.5,30000,"anvil");
  const spare=ctx.bot.inventory.items().find(i=>i.type===target.type&&i!==target);
  if(!spare) throw new Error("A second copy/material for repairing "+target.name+" is required.");
  active(ctx);const av=await ctx.bot.openAnvil(anvil);
  try{
    active(ctx);
    await av.combine(target,spare);
    ctx.log?.("[ANVIL] repaired "+target.name+" using a second matching item.");
    return true;
  }finally{try{await av.close?.();}catch{}}
}
const BREED_FOOD={
  cow:["wheat"],sheep:["wheat"],goat:["wheat"],pig:["carrot","potato","beetroot"],
  chicken:["wheat_seeds","beetroot_seeds","melon_seeds","pumpkin_seeds","torchflower_seeds"],
  rabbit:["carrot","golden_carrot","dandelion"],horse:["golden_carrot","golden_apple"],
  donkey:["golden_carrot","golden_apple"],mule:["golden_carrot","golden_apple"],
  llama:["hay_block"],mooshroom:["wheat"],turtle:["seagrass"],strider:["warped_fungus"]
};
async function breedAnimals(ctx,a){
  const wanted=required(a,"Animal is required.").toLowerCase();
  const foodNames=BREED_FOOD[wanted];
  if(!foodNames) throw new Error("No breeding rule for "+wanted+".");
  const food=foodNames.map(n=>inventoryItem(ctx.bot,n)).find(Boolean);
  if(!food) throw new Error("Breeding food not found for "+wanted+".");
  const animals=Object.values(ctx.bot.entities||{}).filter(e=>e?.position&&entityName(e)===wanted&&e.isValid!==false).sort((x,y)=>distance(ctx.bot,x)-distance(ctx.bot,y)).slice(0,2);
  if(animals.length<2) throw new Error("Need two nearby "+wanted+" animals.");
  active(ctx);await ctx.bot.equip(food,"hand");
  for(const animal of animals){active(ctx);await navigate(ctx,animal.position,2.5,10000,"breeding animal");await ctx.bot.activateEntity(animal);await wait(ctx,300);}
  ctx.log?.("[BREED] fed two "+wanted+" animals.");
  return true;
}
async function enchantItem(ctx,a){
  const target=inventoryItem(ctx.bot,required(a,"Item is required."));
  if(!target) throw new Error("Item not found.");
  const lapis=inventoryItem(ctx.bot,"lapis_lazuli");
  if(!lapis) throw new Error("Lapis lazuli not found.");
  const table=ctx.bot.findBlock({matching:ctx.bot.registry?.blocksByName?.enchanting_table?.id,maxDistance:24});
  if(!table) throw new Error("No enchanting table nearby.");
  if(typeof ctx.bot.openEnchantmentTable!=="function") throw new Error("Mineflayer enchantment-table API is unavailable.");
  await navigate(ctx,table.position,3.5,30000,"enchanting table");
  active(ctx);const et=await ctx.bot.openEnchantmentTable(table);
  try{
    active(ctx);
    await et.putTargetItem(target);
    await et.putLapis(lapis);
    const deadline=Date.now()+5000;
    while(Date.now()<deadline && (!Array.isArray(et.enchantments)||et.enchantments.every(x=>Number(x?.level)<0))){active(ctx);await wait(ctx,100);}
    const choices=(et.enchantments||[]).map((x,i)=>({i,level:Number(x?.level)})).filter(x=>x.level>=0).sort((a,b)=>b.level-a.level);
    if(!choices.length) throw new Error("No enchantment choices available.");
    const result=await et.enchant(choices[0].i);
    ctx.log?.("[ENCHANT] selected highest available level "+choices[0].level+" for "+target.name+"; result="+String(result?.name||"item"));
    return true;
  }finally{try{await et.close?.();}catch{}}
}



function nearestAnimalByNames(ctx,names,maxDistance=32){
  const wanted=new Set(names.map(x=>String(x).toLowerCase().replace(/\\s+/g,"_")));
  return nearest(ctx.bot,e=>wanted.has(entityName(e).replace(/\\s+/g,"_")),maxDistance);
}
async function milkAnimal(ctx,a){
  const wanted=required(a,"Animal is required.").toLowerCase().replace(/\\s+/g,"_");
  const allowed=new Set(["cow","goat"]);
  if(!allowed.has(wanted)) throw new Error("Only cow or goat can be milked.");
  const bucket=inventoryItem(ctx.bot,"bucket");
  if(!bucket) throw new Error("Empty bucket not found.");
  const target=nearestAnimalByNames(ctx,[wanted],32);
  if(!target) throw new Error("No nearby "+wanted+" found.");
  const before=countItem(ctx.bot,"milk_bucket");
  await navigate(ctx,target.position,2.5,15000,"milk animal");
  active(ctx);
  await ctx.bot.equip(bucket,"hand");
  active(ctx);
  await ctx.bot.activateEntity(target);
  await wait(ctx,500);
  const after=countItem(ctx.bot,"milk_bucket");
  if(after<=before) throw new Error("Milk action did not produce a milk bucket.");
  ctx.log?.("[MILK] milked "+wanted+"; milk buckets="+String(after));
  return true;
}
async function shearAnimal(ctx,a){
  const wanted=required(a,"Animal is required.").toLowerCase().replace(/\\s+/g,"_");
  const allowed=new Set(["sheep","mooshroom"]);
  if(!allowed.has(wanted)) throw new Error("Only sheep or mooshroom can be sheared.");
  const shears=inventoryItem(ctx.bot,"shears");
  if(!shears) throw new Error("Shears not found.");
  const target=nearestAnimalByNames(ctx,[wanted],32);
  if(!target) throw new Error("No nearby "+wanted+" found.");
  await navigate(ctx,target.position,2.5,15000,"shear animal");
  active(ctx);
  await ctx.bot.equip(shears,"hand");
  active(ctx);
  ctx.bot.useOn(target);
  await wait(ctx,500);
  ctx.log?.("[SHEAR] shearing action sent to "+wanted+".");
  return true;
}
async function extinguishFire(ctx){
  const {bot}=ctx;
  const fireBlocks=bot.findBlocks?.({
    matching:b=>["fire","soul_fire"].includes(String(b?.name||"")),
    maxDistance:24,
    count:64
  })||[];
  const campfires=bot.findBlocks?.({
    matching:b=>["campfire","soul_campfire"].includes(String(b?.name||"")) && b?.getProperties?.().lit===true,
    maxDistance:24,
    count:32
  })||[];
  if(!fireBlocks.length&&!campfires.length) throw new Error("No fire found nearby.");
  let extinguished=0;
  for(const p of fireBlocks){
    active(ctx);
    const block=bot.blockAt(p);
    if(!block||!["fire","soul_fire"].includes(String(block.name||""))) continue;
    await digBlock(ctx,block);
    extinguished++;
  }
  if(campfires.length){
    const shovel=inventoryItem(bot,"netherite_shovel")||inventoryItem(bot,"diamond_shovel")||inventoryItem(bot,"iron_shovel")||inventoryItem(bot,"stone_shovel")||inventoryItem(bot,"golden_shovel")||inventoryItem(bot,"wooden_shovel");
    if(!shovel) throw new Error("Lit campfire found, but no shovel is available to extinguish it.");
    await bot.equip(shovel,"hand");
    for(const p of campfires){
      active(ctx);
      const block=bot.blockAt(p);
      if(!block) continue;
      const lit=block.getProperties?.().lit;
      if(lit===true){
        await navigate(ctx,block.position,3.5,15000,"campfire");
        active(ctx);
        await bot.activateBlock(block);
        await wait(ctx,250);
        if(block.getProperties?.().lit===false) extinguished++;
      }
    }
  }
  if(!extinguished) throw new Error("Fire was found but could not be extinguished.");
  ctx.log?.("[FIRE] extinguished "+String(extinguished)+" fire source(s).");
  return true;
}

async function tradeVillager(ctx,a){
  const q=parts(a), index=Math.max(0,Math.floor(Number(q.shift()??0))), times=Math.max(1,Math.floor(Number(q.shift()??1)));
  const target=nearest(ctx.bot,e=>entityName(e)==="villager",24);
  if(!target)throw new Error("No villager nearby.");
  if(typeof ctx.bot.openVillager!=="function")throw new Error("Mineflayer villager API is unavailable.");
  await navigate(ctx,target.position,3.5,30000,"villager");
  active(ctx);
  const villager=await ctx.bot.openVillager(target);
  try{
    const deadline=Date.now()+5000;
    while(Date.now()<deadline&&(!Array.isArray(villager.trades)||villager.trades.length===0)){active(ctx);await wait(ctx,100);}
    const trade=villager.trades?.[index];
    if(!trade)throw new Error("Villager trade index out of range: "+index);
    if(trade.disabled)throw new Error("Selected villager trade is disabled.");
    active(ctx);
    await villager.trade(index,times);
    ctx.log?.("[TRADE] completed trade="+String(index)+" times="+String(times));
    return true;
  }finally{try{await villager.close?.();}catch{}}
}
async function useAnvil(ctx,a){
  const q=parts(a), first=required(q.shift(),"Item is required."), secondName=q.shift()||null, rename=q.join(" ")||undefined;
  const item=inventoryItem(ctx.bot,first);
  if(!item)throw new Error("Item not found: "+first);
  const second=secondName?inventoryItem(ctx.bot,secondName):null;
  if(secondName&&!second)throw new Error("Second item not found: "+secondName);
  const anvil=ctx.bot.findBlock({matching:x=>String(x?.name||"").endsWith("_anvil"),maxDistance:24});
  if(!anvil)throw new Error("No anvil nearby.");
  if(typeof ctx.bot.openAnvil!=="function")throw new Error("Mineflayer anvil API is unavailable.");
  await navigate(ctx,anvil.position,3.5,30000,"anvil");
  active(ctx);
  const av=await ctx.bot.openAnvil(anvil);
  try{
    active(ctx);
    if(second)await av.combine(item,second,rename);
    else if(rename&&typeof av.rename==="function")await av.rename(item,rename);
    else await av.combine(item,undefined);
    ctx.log?.("[ANVIL] operation completed for "+item.name);
    return true;
  }finally{try{await av.close?.();}catch{}}
}
async function useBrewingStand(ctx,a){
  const q=parts(a), ingredient=required(q.shift(),"Brewing ingredient is required."), potion=q.shift()||"water_bottle";
  const count=Math.max(1,Math.min(3,Math.floor(Number(q.shift()||3))));
  const stand=ctx.bot.findBlock({matching:ctx.bot.registry?.blocksByName?.[ "brewing_stand"]?.id,maxDistance:24});
  if(!stand)throw new Error("No brewing stand nearby.");
  if(typeof ctx.bot.openBrewingStand!=="function")throw new Error("Mineflayer brewing-stand API is unavailable.");
  await navigate(ctx,stand.position,3.5,30000,"brewing stand");
  active(ctx);
  const brew=await ctx.bot.openBrewingStand(stand);
  try{
    const ing=inventoryItem(ctx.bot,ingredient), fuel=inventoryItem(ctx.bot,"blaze_powder");
    if(!ing)throw new Error("Brewing ingredient not found: "+ingredient);
    if(!fuel)throw new Error("Blaze powder not found.");
    const potionItem=inventoryItem(ctx.bot,potion);
    if(!potionItem)throw new Error("Potion bottle not found: "+potion);
    active(ctx);
    if(brew.fuelItem?.()==null)await brew.putFuel(fuel.type??fuel.id,null,1);
    await brew.putIngredient(ing.type??ing.id,null,1);
    for(let slot=0;slot<count;slot++){
      active(ctx);
      const p=inventoryItem(ctx.bot,potion);
      if(!p)break;
      await brew.putPotion(slot,p.type??p.id,null,1);
    }
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      active(ctx);
      if(Number(brew.progress||0)>=1||brew.brewingStopped===true)break;
      await wait(ctx,250);
    }
    ctx.log?.("[BREW] brewing operation completed/started with "+ingredient);
    return true;
  }finally{try{await brew.close?.();}catch{}}
}
async function useShulkerBox(ctx,a){
  const q=parts(a), action=(q.shift()||"open").toLowerCase();
  let itemName=null, amount=null, p;
  if(action==="open"){
    p=coords(q.join(" "));
  }else if(action==="deposit"||action==="retrieve"){
    itemName=required(q.shift(),"Item is required.");
    amount=Math.max(1,Math.floor(Number(q.shift()||1)));
    p=coords(q.join(" "));
  }else{
    throw new Error("Shulker action must be open, deposit, or retrieve.");
  }
  const box=ctx.bot.blockAt(vec(ctx.bot,p));
  if(!box||String(box.name)!=="shulker_box")throw new Error("Target is not a shulker box.");
  const c=await container(ctx,p,"shulker_box");
  try{
    if(action==="deposit"){
      const item=inventoryItem(ctx.bot,itemName);
      if(!item)throw new Error("Item not found: "+itemName);
      await c.deposit(item.type??item.id,null,amount);
      return true;
    }
    if(action==="retrieve"){
      const type=ctx.bot.registry?.itemsByName?.[String(itemName).toLowerCase().replace(/\s+/g,"_")];
      if(!type)throw new Error("Unknown item: "+itemName);
      await c.withdraw(type.id,null,amount);
      return true;
    }
    ctx.log?.("[SHULKER] opened.");
    return true;
  }finally{try{await c.close?.();}catch{}}
}
async function fillBucket(ctx,a){
  const p=coords(a), b=ctx.bot.blockAt(vec(ctx.bot,p));
  if(!b)throw new Error("Target block is not loaded.");
  const bucket=inventoryItem(ctx.bot,"bucket");
  if(!bucket)throw new Error("Empty bucket not found.");
  const sourceNames=new Set(["water","flowing_water","lava","flowing_lava"]);
  if(!sourceNames.has(String(b.name)))throw new Error("Target is not a water/lava source or flowing block.");
  await navigate(ctx,b.position,3.5,15000,"bucket source");
  active(ctx);await ctx.bot.equip(bucket,"hand");active(ctx);await ctx.bot.lookAt(b.position.offset(0.5,0.5,0.5),true);active(ctx);ctx.bot.activateItem();await wait(ctx,600);
  const filled=inventoryItem(ctx.bot,String(b.name).includes("lava")?"lava_bucket":"water_bucket");
  if(!filled)throw new Error("Bucket pickup was not confirmed.");
  ctx.log?.("[BUCKET] filled from "+b.name);
  return true;
}
async function placeLiquid(ctx,a){
  const q=parts(a), liquid=required(q.shift(),"Liquid bucket is required."), p=coords(q.join(" "));
  const item=inventoryItem(ctx.bot,liquid);
  if(!item||!/(water_bucket|lava_bucket)$/.test(item.name))throw new Error("Water/lava bucket not found.");
  const target=ctx.bot.blockAt(vec(ctx.bot,p));
  if(!target)throw new Error("Target block is not loaded.");
  const ref=ctx.bot.blockAt(vec(ctx.bot,{x:p.x,y:p.y-1,z:p.z}));
  if(!ref||ref.name==="air")throw new Error("No reference block below liquid target.");
  await navigate(ctx,ref.position,3.5,15000,"liquid placement");
  active(ctx);await ctx.bot.equip(item,"hand");active(ctx);await ctx.bot.lookAt(ref.position.offset(0.5,1,0.5),true);active(ctx);ctx.bot.activateItem();await wait(ctx,600);
  const after=ctx.bot.blockAt(vec(ctx.bot,p));
  if(!after||!["water","lava"].includes(String(after.name)))throw new Error("Liquid placement was not confirmed.");
  ctx.log?.("[BUCKET] placed "+liquid+" at "+String(p));
  return true;
}
async function controlVehicle(ctx,a){
  const q=parts(a),seconds=Math.max(0.1,Number(q.shift()||2)),forward=Number(q.shift()??1),sideways=Number(q.shift()??0);
  if(!ctx.bot.vehicle)throw new Error("Bot is not mounted.");
  if(typeof ctx.bot.moveVehicle==="function"){
    active(ctx);ctx.bot.moveVehicle(sideways,forward);await wait(ctx,seconds*1000);ctx.bot.moveVehicle(0,0);return true;
  }
  ctx.bot.setControlState("forward",forward>0);ctx.bot.setControlState("back",forward<0);ctx.bot.setControlState("left",sideways<0);ctx.bot.setControlState("right",sideways>0);
  try{await wait(ctx,seconds*1000);}finally{ctx.bot.setControlState("forward",false);ctx.bot.setControlState("back",false);ctx.bot.setControlState("left",false);ctx.bot.setControlState("right",false);}
  return true;
}


const STRUCTURE_CLIPBOARD={blocks:[],size:{x:0,y:0,z:0}};
async function useWorkstation(ctx,a,expected){const p=coords(a),b=ctx.bot.blockAt(vec(ctx.bot,p));if(!b||b.name!==expected)throw new Error("Target is not a "+expected+".");await navigate(ctx,b.position,3.5,15000,expected);active(ctx);await ctx.bot.activateBlock(b);await wait(ctx,500);return true;}
async function ignite(ctx,a){const p=coords(a),b=ctx.bot.blockAt(vec(ctx.bot,p)),i=inventoryItem(ctx.bot,"flint_and_steel");if(!b)throw new Error("Target block is not loaded.");if(!i)throw new Error("Flint and steel not found.");await navigate(ctx,b.position,3.5,15000,"ignite");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.activateBlock(b);await wait(ctx,500);return true;}
async function activateRespawnAnchor(ctx,a){const p=coords(a),b=ctx.bot.blockAt(vec(ctx.bot,p)),i=inventoryItem(ctx.bot,"glowstone");if(!b||b.name!=="respawn_anchor")throw new Error("Target is not a respawn anchor.");if(!i)throw new Error("Glowstone not found.");await navigate(ctx,b.position,3.5,15000,"respawn anchor");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.activateBlock(b);await wait(ctx,500);return true;}
async function useTotem(ctx){const i=inventoryItem(ctx.bot,"totem_of_undying");if(!i)throw new Error("Totem of Undying not found.");active(ctx);await ctx.bot.equip(i,"off-hand");active(ctx);return true;}
async function useBucketKind(ctx,a,kind){const p=coords(a),b=ctx.bot.blockAt(vec(ctx.bot,p)),i=inventoryItem(ctx.bot,kind+"_bucket");if(!b)throw new Error("Target block is not loaded.");if(!i)throw new Error(kind+" bucket not found.");await navigate(ctx,b.position,3.5,15000,kind+" bucket");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.activateBlock(b);await wait(ctx,600);return true;}
async function collectPowderSnow(ctx,a){const p=coords(a),b=ctx.bot.blockAt(vec(ctx.bot,p)),i=inventoryItem(ctx.bot,"bucket");if(!b||!["powder_snow","powder_snow_cauldron"].includes(b.name))throw new Error("Target is not powder snow.");if(!i)throw new Error("Empty bucket not found.");await navigate(ctx,b.position,3.5,15000,"powder snow");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.activateBlock(b);await wait(ctx,600);if(!inventoryItem(ctx.bot,"powder_snow_bucket"))throw new Error("Powder snow pickup not confirmed.");return true;}
async function useSpyglass(ctx,a){const ms=Math.max(100,number(a)*1000),i=inventoryItem(ctx.bot,"spyglass");if(!i)throw new Error("Spyglass not found.");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);ctx.bot.activateItem();try{await wait(ctx,ms)}finally{try{ctx.bot.deactivateItem()}catch{}}return true;}
async function useCompass(ctx){const i=inventoryItem(ctx.bot,"compass");if(!i)throw new Error("Compass not found.");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);return true;}
async function useRecoveryCompass(ctx){const i=inventoryItem(ctx.bot,"recovery_compass");if(!i)throw new Error("Recovery compass not found.");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);return true;}
async function chargeBow(ctx,a){const ms=Math.max(100,number(a)*1000),i=inventoryItem(ctx.bot,"bow");if(!i)throw new Error("Bow not found.");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);ctx.bot.activateItem();try{await wait(ctx,ms)}finally{try{ctx.bot.deactivateItem()}catch{}}return true;}
async function chargeCrossbow(ctx){const i=inventoryItem(ctx.bot,"crossbow");if(!i)throw new Error("Crossbow not found.");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);ctx.bot.activateItem();try{await wait(ctx,1800)}finally{try{ctx.bot.deactivateItem()}catch{}}return true;}
function targetEntity(ctx,name){const q=required(name,"Target is required.").toLowerCase(),p=player(ctx.bot,q);if(p?.entity)return p.entity;const e=nearest(ctx.bot,x=>entityName(x)===q||entityName(x).includes(q),32);if(!e)throw new Error("Target not found: "+q);return e;}
async function tridentAttack(ctx,a){const t=targetEntity(ctx,a),i=inventoryItem(ctx.bot,"trident");if(!i)throw new Error("Trident not found.");await navigate(ctx,t.position,3.5,15000,"trident");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.attack(t);return true;}
async function throwTrident(ctx,a){const ms=Math.max(200,number(a)*1000),i=inventoryItem(ctx.bot,"trident");if(!i)throw new Error("Trident not found.");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);ctx.bot.activateItem();try{await wait(ctx,ms)}finally{try{ctx.bot.deactivateItem()}catch{}}return true;}
async function throwPotionKind(ctx,a,k){const i=inventoryItem(ctx.bot,required(a,"Potion item is required."));if(!i||!i.name.includes(k))throw new Error(k+" not found.");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);ctx.bot.activateItem();await wait(ctx,700);return true;}
async function knockbackTarget(ctx,a){const t=targetEntity(ctx,a);await navigate(ctx,t.position,3.2,15000,"knockback");active(ctx);ctx.bot.setControlState("sprint",true);try{await wait(ctx,100);active(ctx);await ctx.bot.attack(t)}finally{try{ctx.bot.setControlState("sprint",false)}catch{}}return true;}
async function criticalAttack(ctx,a){const t=targetEntity(ctx,a);await navigate(ctx,t.position,3.2,15000,"critical");active(ctx);ctx.bot.setControlState("jump",true);await wait(ctx,120);ctx.bot.setControlState("jump",false);await wait(ctx,80);active(ctx);await ctx.bot.attack(t);return true;}
async function plantAt(ctx,itemName,p){const i=inventoryItem(ctx.bot,itemName),b=ctx.bot.blockAt(vec(ctx.bot,p));if(!i)throw new Error("Planting item not found.");if(!b||!["farmland","dirt","grass_block","podzol","mycelium","soul_sand"].includes(b.name))throw new Error("Invalid planting block.");await navigate(ctx,b.position,3.5,15000,"planting");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.activateBlock(b);await wait(ctx,400);return true;}
async function plantSeeds(ctx,a){const q=parts(a),i=required(q.shift(),"Seed item is required.");return plantAt(ctx,i,coords(q.join(" ")))}
async function plantSapling(ctx,a){const q=parts(a),i=required(q.shift(),"Sapling item is required.");return plantAt(ctx,i,coords(q.join(" ")))}
async function harvestAndReplant(ctx){const ps=ctx.bot.findBlocks?.({matching:b=>CROPS.has(String(b?.name||"")),maxDistance:24,maxCount:64})||[];let n=0;for(const p of ps){active(ctx);const b=ctx.bot.blockAt(p);if(!b)continue;await digBlock(ctx,b);const seed=b.name==="wheat"?"wheat_seeds":b.name;const i=inventoryItem(ctx.bot,seed);if(i)try{await plantAt(ctx,seed,{x:p.x,y:p.y-1,z:p.z});n++}catch{}}return true;}
async function boneMeal(ctx,a){const p=coords(a),b=ctx.bot.blockAt(vec(ctx.bot,p)),i=inventoryItem(ctx.bot,"bone_meal");if(!b||!i)throw new Error("Target or bone meal unavailable.");await navigate(ctx,b.position,3.5,15000,"bone meal");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.activateBlock(b);await wait(ctx,400);return true;}
function animalEntity(ctx,name){const q=required(name,"Animal is required.").toLowerCase(),e=nearest(ctx.bot,x=>(PASSIVES.has(entityName(x))||["wolf","cat","parrot","ocelot"].includes(entityName(x)))&&entityName(x).includes(q),24);if(!e)throw new Error("Animal not found: "+q);return e;}
async function feedAnimal(ctx,a){const e=animalEntity(ctx,a),food={cow:"wheat",sheep:"wheat",pig:"carrot",chicken:"wheat_seeds",rabbit:"carrot",goat:"wheat"}[entityName(e)]||"wheat",i=inventoryItem(ctx.bot,food);if(!i)throw new Error("Food not found.");await navigate(ctx,e.position,3.5,15000,"animal");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.activateEntity(e);return true;}
async function tameAnimal(ctx,a){const e=animalEntity(ctx,a),food={wolf:"bone",cat:"cod",horse:"golden_carrot",donkey:"golden_carrot",parrot:"wheat_seeds"}[entityName(e)]||"bone",i=inventoryItem(ctx.bot,food);if(!i)throw new Error("Taming item not found.");await navigate(ctx,e.position,3.5,15000,"tame");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.activateEntity(e);return true;}
async function leadAnimal(ctx,a){const e=animalEntity(ctx,a),i=inventoryItem(ctx.bot,"lead");if(!i)throw new Error("Lead not found.");await navigate(ctx,e.position,3.5,15000,"lead");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.useOn(e);return true;}
async function moveAnimal(ctx,a){const q=parts(a),name=required(q.shift(),"Animal is required."),p=coords(q.join(" ")),e=animalEntity(ctx,name),i=inventoryItem(ctx.bot,"lead");if(!i)throw new Error("Lead not found.");await navigate(ctx,e.position,3.5,15000,"move animal");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.useOn(e);await navigate(ctx,p,3.5,30000,"animal destination");return true;}
async function collectEggs(ctx,a){const r=a?Number(a):16;if(!Number.isFinite(r)||r<1||r>48)throw new Error("Radius must be 1-48.");const eggs=Object.values(ctx.bot.entities||{}).filter(e=>e?.position&&e.name==="item"&&JSON.stringify(e.metadata||"").toLowerCase().includes("egg")&&e.position.distanceTo(ctx.bot.entity.position)<=r);if(!eggs.length)throw new Error("No dropped items detected nearby.");for(const e of eggs){await navigate(ctx,e.position,1.5,10000,"egg")}return true;}
async function controlTypedVehicle(ctx,a,type){if(!ctx.bot.vehicle)throw new Error("Bot is not mounted.");if(entityName(ctx.bot.vehicle)!==type)throw new Error("Mounted vehicle is not a "+type+".");return controlVehicle(ctx,a);}
async function useElytra(ctx,a){const s=Math.max(1,number(a)),i=inventoryItem(ctx.bot,"elytra");if(!i)throw new Error("Elytra not found.");active(ctx);await ctx.bot.equip(i,"torso");active(ctx);if(typeof ctx.bot.elytraFly==="function")await ctx.bot.elytraFly();await wait(ctx,s*1000);return true;}
function parseBlueprint(a){const out=[];for(const row of required(a).split(/[;\n]+/)){const q=parts(row),name=q.shift(),x=Number(q.shift()),y=Number(q.shift()),z=Number(q.shift());if(name&&[x,y,z].every(Number.isFinite))out.push({name,x,y,z})}if(!out.length)throw new Error("Blueprint contains no valid blocks.");if(out.length>512)throw new Error("Blueprint exceeds 512 blocks.");return out;}
async function buildBlueprint(ctx,a){for(const b of parseBlueprint(a)){active(ctx);await placeAt(ctx,b.name,b)}return true;}
async function copyStructure(ctx,a){const q=parts(a).map(Number);if(q.length!==6||q.some(n=>!Number.isFinite(n)))throw new Error("copy_structure requires 6 coordinates.");const min={x:Math.min(q[0],q[3]),y:Math.min(q[1],q[4]),z:Math.min(q[2],q[5])},max={x:Math.max(q[0],q[3]),y:Math.max(q[1],q[4]),z:Math.max(q[2],q[5])};const blocks=[];for(let y=min.y;y<=max.y;y++)for(let z=min.z;z<=max.z;z++)for(let x=min.x;x<=max.x;x++){active(ctx);const b=ctx.bot.blockAt(vec(ctx.bot,{x,y,z}));if(b&&b.name!=="air")blocks.push({name:b.name,x:x-min.x,y:y-min.y,z:z-min.z})}STRUCTURE_CLIPBOARD.blocks=blocks;STRUCTURE_CLIPBOARD.size={x:max.x-min.x+1,y:max.y-min.y+1,z:max.z-min.z+1};return true;}
function transformClipboard(kind,v){if(!STRUCTURE_CLIPBOARD.blocks.length)throw new Error("Structure clipboard is empty.");const size=STRUCTURE_CLIPBOARD.size,out=[];if(kind==="rotate"){let turns=((Math.round(v/90)%4)+4)%4,sx=size.x,sz=size.z;for(const b0 of STRUCTURE_CLIPBOARD.blocks){let x=b0.x,z=b0.z;for(let i=0;i<turns;i++){const nx=sz-1-z,nz=x;x=nx;z=nz;[sx,sz]=[sz,sx]}out.push({name:b0.name,x,y:b0.y,z})}STRUCTURE_CLIPBOARD.blocks=out;STRUCTURE_CLIPBOARD.size={x:sx,y:size.y,z:sz}}else{const axis=String(v).toLowerCase();if(!["x","z"].includes(axis))throw new Error("Mirror axis must be x or z.");for(const b of STRUCTURE_CLIPBOARD.blocks)out.push({...b,[axis]:STRUCTURE_CLIPBOARD.size[axis]-1-b[axis]});STRUCTURE_CLIPBOARD.blocks=out}}
async function rotateStructure(ctx,a){transformClipboard("rotate",number(a));return true;}
async function mirrorStructure(ctx,a){transformClipboard("mirror",a);return true;}
async function repairStructure(ctx){if(!STRUCTURE_CLIPBOARD.blocks.length)throw new Error("Structure clipboard is empty.");for(const b of STRUCTURE_CLIPBOARD.blocks){active(ctx);const p={x:Math.floor(ctx.bot.entity.position.x+b.x),y:Math.floor(ctx.bot.entity.position.y+b.y),z:Math.floor(ctx.bot.entity.position.z+b.z)};const live=ctx.bot.blockAt(vec(ctx.bot,p));if(!live||live.name!==b.name)try{await placeAt(ctx,b.name,p)}catch{}}return true;}
async function lightArea(ctx,a){const {min,max}=boundedArea(a,"light_area"),i=inventoryItem(ctx.bot,"torch")||inventoryItem(ctx.bot,"lantern");if(!i)throw new Error("Torch or lantern not found.");for(let y=min.y;y<=max.y;y++)for(let z=min.z;z<=max.z;z++)for(let x=min.x;x<=max.x;x+=4){active(ctx);const floor=ctx.bot.blockAt(vec(ctx.bot,{x,y:y-1,z})),spot=ctx.bot.blockAt(vec(ctx.bot,{x,y,z}));if(floor?.name!=="air"&&spot?.name==="air")try{await placeAt(ctx,i.name,{x,y,z})}catch{}}return true;}

async function usePotion(ctx,a){
  const item=inventoryItem(ctx,required(a,"Potion item is required."));
  if(!item||!/(potion|splash_potion|lingering_potion)/.test(item.name))throw new Error("Potion item not found.");
  const before=countItem(ctx,item.name);
  active(ctx);await ctx.bot.equip(item,"hand");active(ctx);
  if(/splash_potion|lingering_potion/.test(item.name)){
    ctx.bot.activateItem();await wait(ctx,700);
  }else{
    await ctx.bot.consume();
  }
  const after=countItem(ctx,item.name);
  if(after>=before)throw new Error("Potion use was not confirmed.");
  return true;
}
async function useFirework(ctx,a){
  const item=inventoryItem(ctx.bot,a||"firework_rocket");
  if(!item||item.name!=="firework_rocket")throw new Error("Firework rocket not found.");
  const before=countItem(ctx.bot,"firework_rocket");
  active(ctx);await ctx.bot.equip(item,"hand");active(ctx);ctx.bot.activateItem();await wait(ctx,500);
  const after=countItem(ctx.bot,"firework_rocket");
  if(after>=before)throw new Error("Firework activation was not confirmed.");
  return true;
}
async function useEnderChest(ctx,a){
  const p=coords(a);
  const b=ctx.bot.blockAt(vec(ctx.bot,p));
  if(!b||b.name!=="ender_chest")throw new Error("Target is not an ender chest.");
  if(distance(ctx.bot,{position:b.position})>4.5)await navigate(ctx,b.position,3.5,30000,"ender chest");
  active(ctx);
  const c=await ctx.bot.openContainer(b);
  try{ctx.log?.("[ENDER_CHEST] opened.");return true;}finally{try{await c.close?.();}catch{}}
}
async function collectHoney(ctx,a){
  const q=parts(a), tool=(q.shift()||"bottle").toLowerCase(), p=coords(q.join(" "));
  const b=ctx.bot.blockAt(vec(ctx.bot,p));
  if(!b||!["bee_nest","beehive"].includes(b.name))throw new Error("Target is not a bee nest or beehive.");
  const item=inventoryItem(ctx.bot,tool==="shears"?"shears":"glass_bottle");
  if(!item)throw new Error((tool==="shears"?"Shears":"Glass bottle")+" not found.");
  const before=ctx.bot.inventory.items().reduce((n,i)=>n+i.count,0);
  await navigate(ctx,b.position,3.5,15000,"honey collection");
  active(ctx);await ctx.bot.equip(item,"hand");active(ctx);await ctx.bot.lookAt(b.position.offset(0.5,0.5,0.5),true);active(ctx);ctx.bot.activateBlock(b);await wait(ctx,700);
  const after=ctx.bot.inventory.items().reduce((n,i)=>n+i.count,0);
  if(after===before)ctx.log?.("[HONEY] interaction sent; inventory delta not observable.");
  return true;
}
async function useBeacon(ctx,a){
  const p=coords(a),b=ctx.bot.blockAt(vec(ctx.bot,p));
  if(!b||b.name!=="beacon")throw new Error("Target is not a beacon.");
  await navigate(ctx,b.position,3.5,15000,"beacon");
  active(ctx);
  const w=await ctx.bot.openBlock(b);
  try{ctx.log?.("[BEACON] opened.");return true;}finally{try{await w.close?.();}catch{}}
}
async function useConduit(ctx,a){
  const p=coords(a),b=ctx.bot.blockAt(vec(ctx.bot,p));
  if(!b||b.name!=="conduit")throw new Error("Target is not a conduit.");
  await navigate(ctx,b.position,3.5,15000,"conduit");
  active(ctx);await ctx.bot.activateBlock(b);ctx.log?.("[CONDUIT] activated/interacted.");return true;
}

function boundedArea(a,label){
  const q=parts(a), name=label==="fill_area"?required(q.shift(),"Block is required."):null;
  const nums=q.map(Number);
  if(nums.length!==6||nums.some(n=>!Number.isFinite(n)))throw new Error(label+" requires x1 y1 z1 x2 y2 z2.");
  const p1={x:Math.floor(nums[0]),y:Math.floor(nums[1]),z:Math.floor(nums[2])},p2={x:Math.floor(nums[3]),y:Math.floor(nums[4]),z:Math.floor(nums[5])};
  const min={x:Math.min(p1.x,p2.x),y:Math.min(p1.y,p2.y),z:Math.min(p1.z,p2.z)},max={x:Math.max(p1.x,p2.x),y:Math.max(p1.y,p2.y),z:Math.max(p1.z,p2.z)};
  const volume=(max.x-min.x+1)*(max.y-min.y+1)*(max.z-min.z+1);
  if(volume<1||volume>512)throw new Error(label+" area must contain 1-512 blocks.");
  return {name,min,max,volume};
}
async function fillArea(ctx,a){
  const {name,min,max}=boundedArea(a,"fill_area");let placed=0;
  for(let y=min.y;y<=max.y;y++)for(let z=min.z;z<=max.z;z++)for(let x=min.x;x<=max.x;x++){
    active(ctx);if((placed%8)===0)await defendNearbyThreat(ctx,10);
    const b=ctx.bot.blockAt(new ctx.bot.entity.position.constructor(x,y,z));
    if(b?.name===name){placed++;continue;}
    if(b?.name!=="air")continue;
    await placeAt(ctx,name,{x,y,z});placed++;
  }
  ctx.log?.("[AREA] filled "+String(placed)+" block(s) with "+name);return true;
}
async function clearArea(ctx,a){
  const {min,max}=boundedArea(a,"clear_area");let cleared=0;
  for(let y=min.y;y<=max.y;y++)for(let z=min.z;z<=max.z;z++)for(let x=min.x;x<=max.x;x++){
    active(ctx);if((cleared%8)===0)await defendNearbyThreat(ctx,10);
    const b=ctx.bot.blockAt(new ctx.bot.entity.position.constructor(x,y,z));
    if(!b||b.name==="air")continue;
    await digBlock(ctx,b);cleared++;
  }
  ctx.log?.("[AREA] cleared "+String(cleared)+" block(s)");return true;
}
async function replaceBlocks(ctx,a){
  const q=parts(a),from=required(q.shift(),"Source block is required."),to=required(q.shift(),"Replacement block is required.");
  const {min,max}=boundedArea(q.join(" "),"replace_blocks");let changed=0;
  for(let y=min.y;y<=max.y;y++)for(let z=min.z;z<=max.z;z++)for(let x=min.x;x<=max.x;x++){
    active(ctx);if((changed%8)===0)await defendNearbyThreat(ctx,10);
    const b=ctx.bot.blockAt(new ctx.bot.entity.position.constructor(x,y,z));
    if(!b||b.name!==from)continue;
    await digBlock(ctx,b);
    await placeAt(ctx,to,{x,y,z});
    changed++;
  }
  ctx.log?.("[AREA] replaced "+String(changed)+" block(s) "+from+" -> "+to);return true;
}
async function clearHostiles(ctx,a){
  const raw=String(a??"").trim();
  const radius=raw?Number(raw):16;
  if(!Number.isFinite(radius)||radius<1||radius>64) throw new Error("Radius must be between 1 and 64.");  let defeated=0;
  for(let pass=0;pass<32;pass++){
    active(ctx);
    const target=nearest(ctx.bot,e=>HOSTILES.has(entityName(e))&&e.isValid!==false&&(e.health==null||e.health>0),radius);
    if(!target) break;
    const weapon=bestWeapon(ctx.bot);
    if(weapon) await ctx.bot.equip(weapon,"hand");
    const killed=await combatAttack(ctx,target,15000);
    if(!killed) throw new Error("Failed to clear hostile target: "+entityName(target));
    defeated++;
  }
  if(defeated===0) throw new Error("No hostiles found within "+radius+" blocks.");
  ctx.log?.("[HOSTILES] cleared "+String(defeated)+" hostile target(s) within "+String(radius)+" blocks.");
  return true;
}

async function craft(ctx,name,amount=1,table=null){
  const {bot}=ctx, key=required(name,"Item is required.").toLowerCase().replace(/\s+/g,"_");
  const type=bot.registry?.itemsByName?.[key]; if(!type) throw new Error("Unknown craft item: "+key);
  const target=Math.max(1,Math.floor(Number(amount)||1));
  let recipes=bot.recipesFor(type.id,null,target,table||undefined);
  if(!recipes.length){
    const tableId=bot.registry?.blocksByName?.crafting_table?.id;
    table=table|| (tableId!=null ? bot.findBlock({matching:tableId,maxDistance:16}) : null);
    if(!table) throw new Error("No usable crafting table/recipe nearby.");
    if(distance(bot,{position:table.position})>3.5) await navigate(ctx,table.position,3.2,30000,"crafting table");
    recipes=bot.recipesFor(type.id,null,target,table);
  }
  if(!recipes.length) throw new Error("No recipe for "+key+".");
  const recipe=recipes[0], per=Math.max(1,Number(recipe.result?.count||1));
  const crafts=Math.max(1,Math.ceil(target/per));
  const before=countItem(bot,key);
  active(ctx); await bot.craft(recipe,crafts,table);
  active(ctx);
  if(countItem(bot,key)<before+target) throw new Error("Craft did not produce the requested amount.");
  return true;
}

async function digBlock(ctx,block){
  active(ctx); if(!block||block.name==="air") throw new Error("Target block is not diggable.");
  if(distance(ctx.bot,{position:block.position})>4.5) await navigate(ctx,block.position,3.5,30000,"block navigation");
  active(ctx); await ctx.bot.dig(block); return true;
}
async function container(ctx,p,expected=null){
  const {bot}=ctx, b=bot.blockAt(vec(bot,p));
  if(!b||!CONTAINERS.has(String(b.name))) throw new Error("Expected a supported container.");
  if(expected && !String(b.name).includes(expected)) throw new Error("Expected "+expected+".");
  if(distance(bot,{position:b.position})>4.5) await navigate(ctx,b.position,3.5,30000,"container navigation");
  active(ctx); return bot.openContainer(b);
}
async function interactBlock(ctx,p,expected=null){
  const {bot}=ctx,b=bot.blockAt(vec(bot,p)); if(!b) throw new Error("Block not loaded.");
  if(expected && !String(b.name).includes(expected)) throw new Error("Expected "+expected+".");
  if(distance(bot,{position:b.position})>4.5) await navigate(ctx,b.position,3.5,30000,"block navigation");
  active(ctx); await bot.lookAt(b.position.offset(0.5,0.5,0.5),true); active(ctx); await bot.activateBlock(b); return true;
}
async function placeAt(ctx,name,p){
  const {bot}=ctx;
  const target=bot.blockAt(vec(bot,p));
  const item=inventoryItem(bot,name);
  if(!item) throw new Error("Placement item not found: "+name);
  if(!target||target.name!=="air") throw new Error("Placement target is not empty.");
  const ref=bot.blockAt(vec(bot,{x:p.x,y:p.y-1,z:p.z}));
  if(!ref||ref.name==="air"||ref.boundingBox!=="block") throw new Error("No solid reference block below placement target.");
  if(distance(bot,{position:target.position})>4.5){
    active(ctx);
    // GoalPlaceBlock is the pathfinder-native placement-position goal. It
    // owns navigation only; the actual placement remains a single explicit
    // bot.placeBlock writer below.
    if(typeof goals.GoalPlaceBlock === "function"){
      const upFace=new bot.entity.position.constructor(0,1,0);
      const placeGoal=new goals.GoalPlaceBlock(
        target.position,
        bot.world,
        {range:4.5,LOS:true,faces:[upFace],facing:"up"}
      );
      bot.pathfinder.setGoal(placeGoal);
      try{
        const deadline=Date.now()+30000;
        while(Date.now()<deadline){
          active(ctx);
          if(distance(bot,{position:target.position})<=4.5) break;
          await wait(ctx,100);
        }
        if(distance(bot,{position:target.position})>4.5) throw new Error("block placement navigation timed out.");
      }finally{try{bot.pathfinder.setGoal(null);}catch{}}
    }else{
      await navigate(ctx,{x:p.x,y:p.y,z:p.z},4.2,30000,"block placement");
    }
  }
  active(ctx);
  await bot.lookAt(target.position.offset(0.5,0.5,0.5),true);
  await bot.equip(item,"hand");
  active(ctx);
  await bot.placeBlock(ref,new bot.entity.position.constructor(0,1,0));
  const expectedId=bot.registry?.blocksByName?.[String(name).toLowerCase()]?.id;
  const deadline=Date.now()+1500;
  while(Date.now()<deadline){
    active(ctx);
    const placed=bot.blockAt(target.position);
    if(placed&&placed.name!=="air"&&(expectedId==null||placed.type===expectedId)) return true;
    await wait(ctx,75);
  }
  throw new Error("Server did not confirm "+name+" at ("+p.x+", "+p.y+", "+p.z+").");
}


function droppedItemMatches(bot,e,name){
  const wanted=String(name||"").trim().toLowerCase().replace(/\s+/g,"_");
  if(!wanted) return true;
  const scalar=v=>v?.value??v;
  const names=new Set();
  const visit=node=>{
    if(node==null) return;
    if(Array.isArray(node)){for(const value of node) visit(value);return;}
    if(typeof node!=="object") return;
    const directName=scalar(node.name);
    const displayName=scalar(node.displayName);
    if(typeof directName==="string") names.add(directName.toLowerCase().replace(/^minecraft:/,"").replace(/\s+/g,"_"));
    if(typeof displayName==="string") names.add(displayName.toLowerCase().replace(/^minecraft:/,"").replace(/\s+/g,"_"));
    const rawId=scalar(node.itemId??node.item_id);
    if(rawId!=null && Number.isFinite(Number(rawId))){
      const id=Number(rawId);
      const item=Object.values(bot.registry?.itemsByName||{}).find(i=>Number(i?.id)===id);
      if(item?.name) names.add(String(item.name).toLowerCase());
    }
    for(const value of Object.values(node)) visit(value);
  };
  visit(e?.itemStack);
  visit(e?.item);
  visit(e?.metadata);
  visit(e?.displayName);
  return [...names].some(n=>n===wanted||n.includes(wanted)||wanted.includes(n));
}

function droppedItemMatchesName(bot,e,name){
  const wanted=String(name||"").trim().toLowerCase().replace(/\s+/g,"_");if(!wanted)return true;const names=new Set();
  const add=v=>{const x=String(v?.value??v??"").trim().toLowerCase().replace(/^minecraft:/,"").replace(/\s+/g,"_");if(x)names.add(x);};
  const walk=node=>{if(node==null)return;if(Array.isArray(node)){for(const v of node)walk(v);return;}if(typeof node!=="object")return;add(node.name);add(node.displayName);const id=node.itemId??node.item_id;if(Number.isFinite(Number(id))){const item=Object.values(bot.registry?.itemsByName||{}).find(i=>Number(i?.id)===Number(id));if(item?.name)add(item.name);}for(const v of Object.values(node))walk(v);};
  walk(e?.itemStack);walk(e?.item);walk(e?.metadata);add(e?.displayName);return [...names].some(n=>n===wanted||n.includes(wanted)||wanted.includes(n));
}
function findSearchTarget(bot,target,maxDistance=48){
  const wanted=String(target||"").trim().toLowerCase().replace(/\s+/g,"_");if(!wanted)return null;
  const p=Object.values(bot.players||{}).find(x=>String(x?.username||"").toLowerCase()===wanted);if(p?.entity&&distance(bot,p.entity)<=maxDistance)return p.entity;
  const entity=nearest(bot,e=>{const n=entityName(e).replace(/\s+/g,"_");return n===wanted||n.includes(wanted)||wanted.includes(n);},maxDistance);if(entity)return entity;
  const item=nearest(bot,e=>String(e?.name||"").toLowerCase()==="item"&&droppedItemMatchesName(bot,e,wanted),maxDistance);if(item)return item;
  return bot.findBlock?.({matching:b=>{const n=String(b?.name||"").toLowerCase().replace(/\s+/g,"_");return n===wanted||n.includes(wanted)||wanted.includes(n);},maxDistance})||null;
}
function findBlockDroppingItem(bot,itemName,maxDistance=48){
  const key=String(itemName||"").trim().toLowerCase().replace(/\s+/g,"_"),type=bot.registry?.itemsByName?.[key];if(!type)return null;  return bot.findBlock?.({matching:b=>{if(!b||b.name==="air")return false;const n=String(b.name||"").toLowerCase().replace(/\s+/g,"_");return n===key||n.includes(key)||(Array.isArray(b.drops)&&b.drops.some(d=>Number(d)===Number(type.id)));},maxDistance})||null;
}
async function ensureCraftMaterials(ctx,name,seen=new Set()){
  const key=required(name,"Item is required.").toLowerCase().replace(/\s+/g,"_");if(seen.has(key))throw new Error("Craft dependency cycle detected: "+key);seen.add(key);
  const bot=ctx.bot,type=bot.registry?.itemsByName?.[key];if(!type)throw new Error("Unknown craft item: "+key);
  const recipes=bot.recipesFor(type.id,null,1,null);if(!recipes.length){seen.delete(key);return false;}
  for(const ingredient of recipes[0].delta||[]){const id=ingredient?.id,need=Math.max(0,Number(ingredient?.count)||0);if(id==null||need<=0)continue;const ing=bot.registry.items[id],ingName=String(ing?.name||id),have=countItem(bot,ingName);if(have>=need)continue;const missing=need-have,ingRecipes=bot.recipesFor(id,null,missing,null);if(ingRecipes.length){await ensureCraftMaterials(ctx,ingName,seen);await craft(ctx,ingName,missing);}else for(let i=0;i<missing;i++){active(ctx);const block=findBlockDroppingItem(bot,ingName,48);if(!block)throw new Error("Missing raw material not found nearby: "+ingName);await digBlock(ctx,block);}}
  seen.delete(key);return true;
}
function findFishingSpot(bot,maxDistance=32){
  const positions=bot.findBlocks?.({
    matching:b=>b?.name==="water"||b?.name==="flowing_water",
    maxDistance,
    count:64
  })||[];
  const origin=bot.entity.position;
  const hostiles=Object.values(bot.entities||{})
    .filter(e=>e?.position&&HOSTILES.has(entityName(e))&&e.isValid!==false);
  const offsets=[
    [1,0],[-1,0],[0,1],[0,-1],
    [1,1],[1,-1],[-1,1],[-1,-1]
  ];
  const candidates=[];
  for(const p of positions){
    const water=bot.blockAt(p);
    if(!water) continue;
    for(const [dx,dz] of offsets){
      const stand=bot.blockAt(new bot.entity.position.constructor(p.x+dx,p.y,p.z+dz));
      const standHead=bot.blockAt(new bot.entity.position.constructor(p.x+dx,p.y+1,p.z+dz));
      const floor=bot.blockAt(new bot.entity.position.constructor(p.x+dx,p.y-1,p.z+dz));
      if(stand?.name!=="air"||standHead?.name!=="air"||floor?.boundingBox!=="block") continue;
      const standPos=stand.position.offset(0.5,0,0.5);
      const waterPos=water.position.offset(0.5,0.2,0.5);
      const hostilePenalty=hostiles.some(e=>e.position.distanceTo(water.position)<8)?1000:0;
      candidates.push({
        water,
        stand,
        standPos,
        waterPos,
        score:origin.distanceTo(standPos)+hostilePenalty
      });
    }
  }
  candidates.sort((a,b)=>a.score-b.score);
  return candidates[0]||null;
}
function findFishingSpots(bot,maxDistance=48){
  const positions=bot.findBlocks?.({
    matching:b=>String(b?.name||"")==="water",
    maxDistance,
    count:128
  })||[];
  const origin=bot.entity.position;
  const hostiles=Object.values(bot.entities||{})
    .filter(e=>e?.position&&HOSTILES.has(entityName(e))&&e.isValid!==false);
  const offsets=[
    [1,0],[-1,0],[0,1],[0,-1],
    [1,1],[1,-1],[-1,1],[-1,-1]
  ];
  const candidates=[];
  const seen=new Set();

  for(const p of positions){
    const water=bot.blockAt(p);
    if(!water||water.name!=="water") continue;
    for(let dy=-2;dy<=2;dy++){
      const sy=p.y+dy;
      for(const [dx,dz] of offsets){
        const sx=p.x+dx, sz=p.z+dz;
        const key=sx+","+sy+","+sz;
        if(seen.has(key)) continue;
        seen.add(key);
        const stand=bot.blockAt(new bot.entity.position.constructor(sx,sy,sz));
        const standHead=bot.blockAt(new bot.entity.position.constructor(sx,sy+1,sz));
        const floor=bot.blockAt(new bot.entity.position.constructor(sx,sy-1,sz));
        if(!stand||!standHead||!floor) continue;
        if(stand.name!=="air"||standHead.name!=="air") continue;
        if(floor.boundingBox!=="block") continue;
        const standPos=stand.position.offset(0.5,0,0.5);
        const waterPos=water.position.offset(0.5,0.15,0.5);
        if(standPos.distanceTo(water.position)>2.0) continue;
        const hostilePenalty=hostiles.some(e=>e.position.distanceTo(standPos)<8)?1000:0;
        candidates.push({water,stand,standPos,waterPos,score:origin.distanceTo(standPos)+hostilePenalty});
      }
    }
  }
  candidates.sort((a,b)=>a.score-b.score);
  return candidates;
}
function findBuildSupport(bot,maxDistance=6){
  const base=bot.entity.position.floored();
  const candidates=[];
  for(let dx=-4;dx<=4;dx++) for(let dz=-4;dz<=4;dz++){
    if(Math.abs(dx)+Math.abs(dz)<2) continue;
    const x=base.x+dx,z=base.z+dz,y=base.y;
    const floor=bot.blockAt(new bot.entity.position.constructor(x,y-1,z));
    const target=bot.blockAt(new bot.entity.position.constructor(x,y,z));
    const head=bot.blockAt(new bot.entity.position.constructor(x,y+1,z));
    if(floor?.boundingBox==="block"&&target?.name==="air"&&head?.name==="air"){
      const d=Math.hypot(dx,dz);
      if(d<=maxDistance)candidates.push({x,y,z,d});
    }
  }
  candidates.sort((a,b)=>a.d-b.d);
  return candidates[0]||null;
}

const GOAL_SEPARATOR = /\\s*;\\s*|\\r?\\n+/;

function parseGoalPlan(input){
  const raw=required(input,"Goal objective is required.").trim();
  if(raw.startsWith("[")||raw.startsWith("{")){
    try{
      const parsed=JSON.parse(raw);
      const steps=Array.isArray(parsed)?parsed:[parsed];
      return steps.map(step=>{
        if(typeof step==="string"){
          const m=step.trim().match(/^(\\S+)(?:\\s+(.*))?$/);
          if(!m)throw new Error("Invalid goal step: "+step);
          return {mode:m[1].toLowerCase(),args:m[2]||""};
        }
        const mode=required(step?.mode,"Goal step mode is required.").toLowerCase();
        return {mode,args:String(step?.args??"").trim()};
      });
    }catch(error){
      if(error instanceof SyntaxError) throw new Error("Goal JSON is invalid.");
      throw error;
    }
  }
  return raw.split(GOAL_SEPARATOR).map(step=>{
    const s=step.trim();
    if(!s)return null;
    const call=s.match(/^(\\w+)(?:\\((.*)\\)|\\s+(.*))?$/);
    if(!call)throw new Error("Invalid goal step: "+s);
    return {mode:call[1].toLowerCase(),args:String(call[2]??call[3]??"").trim()};
  }).filter(Boolean);
}

async function runGoalPlan(ctx,input){
  const steps=parseGoalPlan(input);
  if(!steps.length)throw new Error("Goal contains no steps.");
  const results=[];
  for(let i=0;i<steps.length;i++){
    active(ctx);
    const step=steps[i];
    if(step.mode==="goal")throw new Error("A goal cannot directly contain another goal.");
    if(step.mode==="stop")throw new Error("stop is not valid inside a goal plan.");
    const handler=H[step.mode];
    if(typeof handler!=="function")throw new Error("Unknown goal capability: "+step.mode);
    ctx.log?.("[GOAL] "+String(i+1)+"/"+String(steps.length)+" -> "+step.mode+(step.args?" "+step.args:""));
    const result=await handler(ctx,step.args);
    results.push({mode:step.mode,result});
  }
  ctx.log?.("[GOAL] completed "+String(steps.length)+" step(s).");
  return results.every(x=>x.result!==false);
}

async function recoveryMission(ctx){
  const {bot}=ctx;