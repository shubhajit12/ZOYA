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
  if (!offhand && !mainhand) return false;
  if (String(offhand?.name || "").toLowerCase() !== "shield" && String(mainhand?.name || "").toLowerCase() !== "shield") return false;
  // The protocol metadata layout is version dependent. Never treat a magic
  // index as authoritative; use it only as a best-effort hint when present.
  const md = target.metadata;
  const hints = Array.isArray(md) ? md : Object.values(md || {});
  return hints.some(v => {
    const n = Number(v?.value ?? v);
    return n === 1 || n === 128 || n === 3 || n === 129;
  }) || Boolean(target.isBlocking === true);
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
  if (Number(ctx.bot.health || 20) > 8) return false;
  const item = inventoryItem(ctx.bot, "totem_of_undying");
  if (!item) return false;
  try { await combatEquip(ctx, item, "off-hand"); return true; } catch { return false; }
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
  const mace = combatWeapon(ctx.bot, "mace");
  if (!mace) return false;
  // Mace attacks are most useful while falling. If already airborne, wait for
  // the descent window; otherwise take a bounded jump and strike on descent.
  await combatEquip(ctx, mace, "hand");
  if (ctx.bot.entity?.onGround) {
    ctx.bot.setControlState?.("jump", true);
    await wait(ctx, 90);
    ctx.bot.setControlState?.("jump", false);
  }
  const deadline = Date.now() + 1100;
  while (Date.now() < deadline) {
    active(ctx);
    const vy = Number(ctx.bot.entity?.velocity?.y || 0);
    if (vy < -0.12) {
      await combatAim(ctx, target, 50);
      ctx.bot.attack(target);
      return true;
    }
    await wait(ctx, 35);
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
  const death=ctx.runtime?.memory?.lastDeath;
  if(Number(bot.health??0)<=0){
    await H.recover_after_death(ctx,"");
  }
  active(ctx);
  let recovered=false;
  if(death){
    try{
      await H.recover_items_after_death(ctx,"");
      recovered=true;
    }catch(error){
      ctx.log?.("[RECOVERY] item recovery unavailable: "+String(error?.message||error));
    }
  }
  active(ctx);
  let returned=false;
  const home=ctx.runtime?.memory?.home;
  if(home && [home.x,home.y,home.z].every(Number.isFinite)){
    await H.return_home(ctx,"");
    returned=true;
  }else if(ctx.runtime?.getStatus?.().ownerUsername){
    try{
      await H.return(ctx,"");
      returned=true;
    }catch(error){
      ctx.log?.("[RECOVERY] owner return unavailable: "+String(error?.message||error));
    }
  }
  ctx.log?.("[RECOVERY] mission complete; respawned="+String(Number(bot.health??0)>0)+
    " itemsRecovered="+String(recovered)+" returned="+String(returned));
  return true;
}



async function followWithDefense(ctx,target,range=3,protectTarget=false){
  const {bot}=ctx;
  if(!target?.isValid)throw new Error("Target lost.");
  let lastCheck=0;
  active(ctx);
  bot.pathfinder.setGoal(new goals.GoalFollow(target,range),true);
  try{
    while(true){
      active(ctx);
      if(!target.isValid)throw new Error("Target lost.");
      const now=Date.now();
      if(now-lastCheck>=250){
        lastCheck=now;
        const nearby=Object.values(bot.entities||{})
          .filter(x=>x?.position&&x!==bot.entity&&HOSTILES.has(entityName(x))&&x.isValid!==false)
          .filter(x=>distance(bot,x)<=10 || (protectTarget&&target.position.distanceTo(x)<=8))
          .sort((a,b)=>distance(bot,a)-distance(bot,b));
        if(nearby.length){
          try{bot.pathfinder.setGoal(null);}catch{}
          await combatAttack(ctx,nearby[0],15000);
          active(ctx);
          bot.pathfinder.setGoal(new goals.GoalFollow(target,range),true);
        }
      }
      await wait(ctx,150);
    }
  }finally{try{bot.pathfinder.setGoal(null);}catch{}}
}

async function combatPrepare(ctx){
  const {bot}=ctx;
  active(ctx);
  try{ await H.equip_best_armor(ctx,""); }catch{}
  const weapon=bestWeapon(bot);
  if(weapon){ active(ctx); await bot.equip(weapon,"hand"); active(ctx); }
  return true;
}
function combatShouldBlock(target){
  const n=entityName(target);
  return /skeleton|stray|pillager|piglin|piglin_brute|blaze|guardian|elder_guardian/.test(n);
}
async function briefShieldBlock(ctx,duration=300){
  const {bot}=ctx;
  const shield=inventoryItem(bot,"shield");
  if(!shield)return false;
  active(ctx);
  if(String(bot.inventory?.slots?.[45]?.name||"").toLowerCase()!=="shield"){
    await bot.equip(shield,"off-hand");
    active(ctx);
  }
  if(String(bot.inventory?.slots?.[45]?.name||"").toLowerCase()!=="shield")return false;
  bot.activateItem(true);
  try{await wait(ctx,duration);return true;}finally{bot.deactivateItem();}
}
async function combatAttack(ctx,target,timeout=15000){
  const {bot}=ctx;
  await combatPrepare(ctx);
  const deadline=Date.now()+timeout;
  let swings=0;
  while(target?.isValid!==false&&(target?.health==null||target.health>0)&&Date.now()<deadline){
    active(ctx);
    const current=target;
    const d=distance(bot,current);
    if(d>3.1){
      bot.pathfinder.setGoal(new goals.GoalFollow(current,2.7),true);
      await wait(ctx,150);
      continue;
    }
    try{bot.pathfinder.setGoal(null);}catch{}
    if(combatShouldBlock(current)){
      await briefShieldBlock(ctx,250);
      active(ctx);
    }
    await bot.lookAt(current.position.offset(0,current.height||1.2,0),true);
    active(ctx);
    bot.attack(current);
    swings++;
    await wait(ctx,450);
    const uuid=current?.uuid;
    if(uuid){
      const fresh=Object.values(bot.entities||{}).find(x=>x?.uuid===uuid&&x!==bot.entity&&x.isValid!==false);
      if(fresh)target=fresh;
    }
  }
  try{bot.pathfinder.setGoal(null);}catch{}
  const killed=(target?.health!=null&&target.health<=0)||(target?.isValid===false&&swings>0);
  ctx.log?.("[COMBAT] target="+entityName(target)+" swings="+String(swings)+" killed="+String(killed));
  return killed;
}
async function defendNearbyThreat(ctx,radius=10){
  active(ctx);
  const target=nearestHostile(ctx,radius);
  if(!target)return false;
  ctx.log?.("[SAFETY] Threat detected; temporarily defending task.");
  await combatAttack(ctx,target,15000);
  active(ctx);
  return true;
}

const H = {
  follow_player: async(ctx,a)=>followWithDefense(ctx,player(ctx.bot,a)?.entity||(()=>{throw new Error("Player not found.");})(),3,false),
  roam: async(ctx)=>{
    const {bot}=ctx;
    while(true){
      active(ctx);
      const angle=Math.random()*Math.PI*2, r=8+Math.random()*12;
      await navigate(ctx,{x:bot.entity.position.x+Math.cos(angle)*r,y:bot.entity.position.y,z:bot.entity.position.z+Math.sin(angle)*r},2,20000,"roam");
      await wait(ctx,250);
    }
  },
  pvp: async(ctx,a)=>{
    const username=required(a,"Player username is required.");
    let lastStrafe=0, lastBow=0, lastPearl=0, lastAdvanced=0, lastLearned=0, lastCritical=0;
    let previousTargetHealth=null;
    while(true){
      active(ctx);
      const p=player(ctx.bot,username);
      if(!p?.entity)throw new Error("Player not found: "+username);
      const target=p.entity;
      if(target.isValid===false || (target.health!=null && target.health<=0)) return true;

      const bot=ctx.bot;
      const dist=combatDistance(bot,target);
      const health=Number(bot.health||20);
      const targetHealth=Number(target.health??20);
      const now=Date.now();

      // Phase 3: survival and defense.
      await combatPrepareTotem(ctx);
      if(health<=7 && combatGapple(bot)){
        await combatUseGapple(ctx);
        await combatRetreat(ctx,target);
        continue;
      }
      if(health<=5 && dist<6 && combatPearl(bot) && now-lastPearl>3500){
        if(await combatPearlEscape(ctx,target)){ lastPearl=Date.now(); continue; }
      }

      // Phase 2: shield defense / shield breaking.
      const targetHasShield=Array.isArray(target.equipment) &&
        target.equipment.some(item=>String(item?.name||"").toLowerCase()==="shield");
      const blocking=targetBlocking(target);
      if(targetHasShield && (blocking || dist<=3.4)){
        const axe=combatWeapon(bot,"axe");
        if(axe){
          await combatEquip(ctx,axe,"hand");
          await combatAim(ctx,target,60);
          bot.attack(target);
          await wait(ctx,260);
          await combatSprintReset(ctx);
        }
      }

      // Phase 4: ranged pressure when the target is outside reliable melee range.
      if(dist>8 && now-lastBow>1800 && combatBow(bot)){
        if(await combatBowAttack(ctx,target)){ lastBow=Date.now(); continue; }
      }

      // Phase 5: advanced 1.21+ weapons, guarded by inventory availability.
      if(now-lastAdvanced>1400){
        if(await combatAdvancedAttack(ctx,target)){ lastAdvanced=Date.now(); continue; }
      }

      // Phase 6: owner-trained techniques remain a tactical overlay, never a
      // second movement/combat engine.
      const training=ctx.runtime?.training;
      const learned=training?.findApplicable?.(blocking?"shield":"combo")||null;
      if(learned && now-lastLearned>1800){
        const result=await training.executeTechnique(learned.name,{target,context:blocking?"shield":"combo",ctx});
        if(result?.ok){ lastLearned=Date.now(); active(ctx); }
      }

      // Phase 2: crit window + sprint reset + short strafing.
      if(dist>3.1){
        bot.pathfinder.setGoal(new goals.GoalFollow(target,2.6),true);
        await wait(ctx,120);
        continue;
      }
      try{bot.pathfinder.setGoal(null);}catch{}
      await combatAim(ctx,target,55);

      if(now-lastStrafe>650){
        const dir=((Math.floor(now/650)&1)===0)?1:-1;
        await combatStrafe(ctx,target,dir,120);
        lastStrafe=Date.now();
      }

      if(previousTargetHealth!=null && targetHealth<previousTargetHealth && health>8 && now-lastCritical>900){
        await combatJumpReset(ctx);
        lastCritical=Date.now();
      }
      previousTargetHealth=targetHealth;

      // Prefer sword for sustained melee; fall back to any weapon.
      const sword=combatWeapon(bot,"sword");
      const axe=combatWeapon(bot,"axe");
      const melee=sword||axe||combatWeapon(bot,"mace")||combatWeapon(bot,"spear");
      if(melee) await combatEquip(ctx,melee,"hand");
      await combatAim(ctx,target,70);
      await combatSprintReset(ctx);
      active(ctx);
      bot.attack(target);
      await wait(ctx,280);
    }
  },
  hit: async(ctx,a)=>{const p=player(ctx.bot,a);if(!p?.entity)throw new Error("Player not found.");return attack(ctx,p.entity,10000);},
  gather_resources: async(ctx,a)=>{
    const q=parts(a),name=required(q[0],"Resource name is required."),amount=Math.max(1,Math.floor(Number(q[1])||1));
    let got=countItem(ctx.bot,name);
    while(got<amount){active(ctx);await defendNearbyThreat(ctx,10);active(ctx);const id=ctx.bot.registry.itemsByName[name.toLowerCase()]?.id;if(id==null)throw new Error("Unknown resource: "+name);
      const block=ctx.bot.findBlock({matching:b=>{
        const bn=String(b?.name||"").toLowerCase();
        if(bn===name.toLowerCase()||bn.includes(name.toLowerCase())) return true;
        const drops=Array.isArray(b?.drops)?b.drops:[];
        return drops.some(d=>Number(d)===Number(id));
      },maxDistance:48});      if(!block)throw new Error("Resource not found nearby: "+name);await digBlock(ctx,block);got=countItem(ctx,name);}
    return true;
  },
  do_task: async(ctx,a)=>{
    const s=required(a,"Task is required."), l=s.toLowerCase();
    if(l.startsWith("mine "))return H.mine(ctx,s.slice(5));
    if(l.startsWith("chop"))return H.chop_tree(ctx,"");
    if(l.startsWith("gather "))return H.gather_resources(ctx,s.slice(7));
    if(l.startsWith("craft "))return H.craft(ctx,s.slice(6));
    throw new Error("Supported do_task forms: mine, chop, gather, craft.");
  },  coordinate: async(ctx,a)=>{
    const q=parts(a),u=required(q.shift(),"Username is required."),task=q.join(" ")||"ready";
    const p=player(ctx.bot,u);
    if(!p?.entity)throw new Error("Player not found.");
    await navigate(ctx,p.entity.position,3,30000,"coordinate");
    ctx.bot.whisper(u,"Ready: "+task);
    return true;
  },
  explore: async(ctx)=>H.roam(ctx,""),
  observe: async(ctx,a)=>{const target=String(a||"").trim();const e=target?findSearchTarget(ctx.bot,target,48):nearest(ctx.bot,()=>true,16);if(!e)throw new Error(target?"Observation target not found: "+target:"Nothing observable nearby.");if(e.position&&e.height!=null)await lookAtEntity(ctx,e);ctx.log?.("observed="+String(e.name||e.username||e.displayName||"target")+" position="+String(e.position||"unknown"));return true;},
  return: async(ctx)=>{const owner=ctx.runtime?.getStatus?.().ownerUsername;if(!owner)throw new Error("Owner is not configured.");const p=player(ctx.bot,owner);if(!p?.entity)throw new Error("Owner is not online.");return navigate(ctx,p.entity.position,3,30000,"return to owner");},
  investigate_entity: async(ctx,a)=>{const wanted=required(a,"Entity name is required.").toLowerCase();const e=nearest(ctx.bot,x=>entityName(x)===wanted||entityName(x).includes(wanted),48);if(!e)throw new Error("Entity not found: "+wanted);await lookAtEntity(ctx,e);ctx.log?.("entity="+entityName(e)+" id="+String(e.id??"unknown")+" uuid="+String(e.uuid??"unknown")+" position="+String(e.position));return true;},
  mine: async(ctx,a)=>{
    const name=required(a,"Block name is required()").toLowerCase();
    const b=ctx.bot.findBlock({matching:x=>String(x?.name||"").toLowerCase()===name,maxDistance:48});
    if(!b)throw new Error("Block not found nearby: "+name);await defendNearbyThreat(ctx,10);return digBlock(ctx,b);
  },
  chop_tree: async(ctx)=>{
    await defendNearbyThreat(ctx,10); const b=ctx.bot.findBlock({matching:x=>/(_log|_stem)$/.test(String(x?.name||"")),maxDistance:32});
    if(!b)throw new Error("No tree log found nearby.");await defendNearbyThreat(ctx,10);return digBlock(ctx,b);
  },
  craft: async(ctx,a)=>{const q=parts(a),amount=Math.max(1,Number(q.at(-1))||1),name=q.length>1?q.slice(0,-1).join("_"):q[0];return craft(ctx,name,amount);},
  eat: async(ctx,a)=>{
    const i=String(a||"").trim()?inventoryItem(ctx.bot,a):ctx.bot.inventory.items().find(i=>ctx.bot.registry.foods?.[i.type]||/bread|apple|beef|pork|chicken|mutton|carrot|potato|stew|melon/.test(i.name));
    if(!i)throw new Error("Food item not found.");await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.consume();return true;
  },
  collect: async(ctx,a)=>{
    const q=parts(a),name=q[0]||"",amount=Math.max(1,Number(q[1])||1),before=countItem(ctx.bot,name);
    while(countItem(ctx.bot,name)<before+amount){
      active(ctx);
      const e=nearest(ctx.bot,e=>String(e?.name||"").toLowerCase()==="item"&&droppedItemMatches(ctx.bot,e,name),32);
      if(!e) throw new Error("Dropped item not found: "+name);
      await navigate(ctx,e.position,0.8,15000,"item pickup");
      await wait(ctx,750);
    }
    return true;
  },
  look_at_player: async(ctx,a)=>{const p=player(ctx.bot,a);if(!p?.entity)throw new Error("Player not found.");return lookAtEntity(ctx,p.entity);},
  chat: async(ctx,a)=>{ctx.bot.chat(required(a,"Message is required.").slice(0,256));return true;},
  private_chat: async(ctx,a)=>{const q=parts(a),u=required(q.shift(),"Username is required."),m=required(q.join(" "),"Message is required.");if(!player(ctx.bot,u))throw new Error("Player not found.");ctx.bot.whisper(u,m.slice(0,256));return true;},
  go_to: async(ctx,a)=>navigate(ctx,coords(a),2,30000,"go_to"),
  look_at_coordinates: async(ctx,a)=>lookAt(ctx,coords(a)),
  stop: async()=>true,
  wait: async(ctx,a)=>{const s=number(a,"Seconds are required.");if(s<0)throw new Error("Seconds cannot be negative.");await wait(ctx,s*1000);return true;},
  return_to_coordinates: async(ctx,a)=>navigate(ctx,coords(a),2,30000,"return_to_coordinates"),
  sprint: async(ctx,a)=>{const s=number(a,"Seconds are required.");if(s<0)throw new Error("Seconds cannot be negative.");ctx.bot.setControlState("sprint",true);try{await wait(ctx,s*1000);}finally{ctx.bot.setControlState("sprint",false);}return true;},
  sneak: async(ctx,a)=>{const s=number(a,"Seconds are required.");if(s<0)throw new Error("Seconds cannot be negative.");ctx.bot.setControlState("sneak",true);try{await wait(ctx,s*1000);}finally{ctx.bot.setControlState("sneak",false);}return true;},
  jump: async(ctx)=>{ctx.bot.setControlState("jump",true);try{await wait(ctx,250);}finally{ctx.bot.setControlState("jump",false);}return true;},
  enter_exit_vehicle: async(ctx)=>{
    if(ctx.bot.vehicle){active(ctx);ctx.bot.dismount();return true;}
    const v=nearest(ctx.bot,e=>["boat","chest_boat","minecart"].includes(entityName(e)),6);if(!v)throw new Error("No nearby mountable vehicle.");if(typeof ctx.bot.mount!=="function")throw new Error("Mineflayer mount API is unavailable.");active(ctx);await ctx.bot.mount(v);return true;
  },
  attack_mob: async(ctx,a)=>{const t=nearest(ctx.bot,e=>HOSTILES.has(entityName(e))&&(!a||entityName(e).includes(String(a).toLowerCase())),32);if(!t)throw new Error("Target mob not found.");return combatAttack(ctx,t);},
  defend: async(ctx)=>{while(true){active(ctx);const t=await nearestHostile(ctx,12);if(t)await combatAttack(ctx,t);else await wait(ctx,250);}},
  guard: async(ctx,a)=>guard(ctx,coords(a)),
  escape: async(ctx)=>{
    const t=await nearestHostile(ctx,12);if(!t)return true;
    const dx=ctx.bot.entity.position.x-t.position.x,dz=ctx.bot.entity.position.z-t.position.z,len=Math.hypot(dx,dz)||1;
    return navigate(ctx,{x:ctx.bot.entity.position.x+dx/len*12,y:ctx.bot.entity.position.y,z:ctx.bot.entity.position.z+dz/len*12},3,15000,"escape");
  },
  chase_target: async(ctx,a)=>followWithDefense(ctx,player(ctx.bot,parts(a)[0])?.entity||(()=>{throw new Error("Target player not found.");})(),3,false),
  equip_best_weapon: async(ctx)=>{const i=bestWeapon(ctx.bot);if(!i)throw new Error("No weapon found.");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);return true;},
  equip_best_armor: async(ctx)=>{
    const {bot}=ctx;
    const destinations=["head","torso","legs","feet"];
    const changes=[];
    let foundArmor=false;

    // Evaluate the inventory before equipping anything so swapping one armor
    // piece into the inventory cannot change the candidates for another slot.
    const bestBySlot=Object.fromEntries(destinations.map(d=>[d,bestArmorBySlot(bot,d)]));

    for(const destination of destinations){
      active(ctx);
      const candidate=bestBySlot[destination];
      const current=equippedArmor(bot,destination);
      if(candidate) foundArmor=true;
      if(!candidate){
        ctx.log?.("[ARMOR] "+destination+" no inventory armor");
        continue;
      }

      const candidateScore=armorScore(candidate,destination);
      const currentScore=current ? armorScore(current,destination) : -Infinity;
      if(current && currentScore>=candidateScore){
        ctx.log?.("[ARMOR] "+destination+" keep "+String(current.name)+"; inventory="+String(candidate.name));
        continue;
      }

      await bot.equip(candidate,destination);
      changes.push(destination+"="+candidate.name);
      ctx.log?.("[ARMOR] equipped "+candidate.name+" -> "+destination);
    }

    if(!foundArmor && destinations.every(d=>!equippedArmor(bot,d))){
      throw new Error("No wearable armor found in inventory.");
    }

    ctx.log?.("[ARMOR] result "+(changes.length?changes.join(", "):"no upgrades needed"));
    return true;
  },
  use_shield: async(ctx,a)=>{
    const seconds=number(required(a,"Shield duration is required."),"Shield duration must be a number of seconds.");
    if(seconds<=0) throw new Error("Shield duration must be greater than 0 seconds.");
    if(!await briefShieldBlock(ctx,seconds*1000)) throw new Error("Shield not found or could not be equipped.");
    ctx.log?.("[SHIELD] held for "+String(seconds)+"s.");
    return true;
  },
  use_ranged_weapon: async(ctx,a)=>{const target=required(a,"Target is required.");const t=player(ctx.bot,target)?.entity||findSearchTarget(ctx.bot,target,32);if(!t)throw new Error("Target not found.");const i=inventoryItem(ctx.bot,"bow")||inventoryItem(ctx.bot,"crossbow");if(!i)throw new Error("Bow/crossbow not found.");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);await lookAtEntity(ctx,t);active(ctx);ctx.bot.activateItem();try{await wait(ctx,1200);}finally{ctx.bot.deactivateItem();}return true;},
  dig: async(ctx,a)=>digBlock(ctx,ctx.bot.blockAt(vec(ctx.bot,coords(a)))),
  harvest_crops: async(ctx)=>{await defendNearbyThreat(ctx,10);const b=ctx.bot.findBlock({matching:x=>CROPS.has(String(x?.name||"")),maxDistance:32});if(!b)throw new Error("No crop found nearby.");return digBlock(ctx,b);},
  fish: async(ctx)=>{
    const {bot}=ctx;
    const rod=inventoryItem(bot,"fishing_rod");
    if(!rod)throw new Error("Fishing rod not found.");
    const spots=findFishingSpots(bot,48);
    if(!spots.length)throw new Error("No usable water fishing spot found in loaded area.");
    let lastNavigationError=null;
    const maxAttempts=Math.min(spots.length,8);
    for(let i=0;i<maxAttempts;i++){
      active(ctx);
      const spot=spots[i];
      const nearbyHostile=nearest(bot,e=>
        HOSTILES.has(entityName(e))&&
        e.isValid!==false&&
        e.position.distanceTo(spot.standPos)<8,
        8
      );
      if(nearbyHostile) continue;
      try{
        const d=bot.entity.position.distanceTo(spot.standPos);
        if(d>2.2) await navigate(ctx,spot.standPos,1.8,10000,"fishing stand");
      }catch(error){
        lastNavigationError=error;
        continue;
      }
      active(ctx);
      await bot.equip(rod,"hand");
      active(ctx);      await bot.lookAt(spot.waterPos,true);
      active(ctx);
      await bot.fish();
      active(ctx);
      ctx.log?.("[FISH] catch completed at "+String(spot.water.position));
      return true;
    }
    if(lastNavigationError) throw new Error("No reachable safe fishing spot found: "+String(lastNavigationError.message||lastNavigationError));
    throw new Error("No reachable safe fishing spot found in loaded area.");
  },
  hunt: async(ctx,a)=>{
    active(ctx);
    const t=await nearestAnimal(ctx,32);
    if(!t)throw new Error("No huntable animal nearby.");
    const weapon=bestWeapon(ctx.bot);
    if(weapon){active(ctx);await ctx.bot.equip(weapon,"hand");active(ctx);}
    const killed=await combatAttack(ctx,t,15000);
    if(!killed)throw new Error("Hunt target was not killed before timeout.");
    return true;
  },
  find_shelter: async(ctx)=>{
    const {bot}=ctx;
    for(let r=2;r<=24;r+=2) for(let i=0;i<16;i++){
      active(ctx); const a=i*Math.PI/8, x=Math.floor(bot.entity.position.x+Math.cos(a)*r), z=Math.floor(bot.entity.position.z+Math.sin(a)*r), y=Math.floor(bot.entity.position.y);
      const floor=bot.blockAt(new bot.entity.position.constructor(x,y-1,z)), foot=bot.blockAt(new bot.entity.position.constructor(x,y,z)), head=bot.blockAt(new bot.entity.position.constructor(x,y+1,z)), roof=bot.blockAt(new bot.entity.position.constructor(x,y+2,z));
      if(floor?.name!=="air"&&floor?.boundingBox==="block"&&foot?.name==="air"&&head?.name==="air"&&roof?.name!=="air"){
        return navigate(ctx,{x:x+0.5,y,z:z+0.5},1.5,15000,"shelter");
      }
    }
    throw new Error("No roofed shelter found in loaded area.");
  },
  recover_after_death: async(ctx)=>{
    const {bot}=ctx;active(ctx);if((bot.health??20)>0)throw new Error("Bot is not dead.");if(typeof bot.respawn!=="function")throw new Error("Mineflayer respawn API is unavailable.");
    const deadline=Date.now()+15000;
    await new Promise((resolve,reject)=>{let settled=false;const cleanup=()=>{bot.removeListener?.("spawn",onSpawn);bot.removeListener?.("end",onEnd);};const onSpawn=()=>{if(settled)return;settled=true;cleanup();resolve();};const onEnd=reason=>{if(settled)return;settled=true;cleanup();reject(new Error("Bot disconnected during recovery: "+String(reason||"")));};bot.once("spawn",onSpawn);bot.once("end",onEnd);try{bot.respawn();}catch(error){settled=true;cleanup();reject(error);return;}const poll=async()=>{while(!settled&&Date.now()<deadline){active(ctx);if(bot.entity?.position&&Number(bot.health)>0){onSpawn();return;}await ctx.sleep(100);}if(!settled){settled=true;cleanup();reject(new Error("Respawn recovery timed out."));}};poll().catch(error=>{if(!settled){settled=true;cleanup();reject(error);}});});
    active(ctx);ctx.log?.("[RECOVER] respawned successfully.");return true;
  },
  find_safe_location: async(ctx)=>findSafe(ctx),
  check_inventory: async(ctx)=>{ctx.log(ctx.bot.inventory.items().map(i=>i.name+" x"+i.count).join(", ")||"empty");return true;},
  find_item: async(ctx,a)=>{const i=inventoryItem(ctx.bot,a);if(!i)throw new Error("Item not found.");ctx.log(i.name+" x"+i.count);return true;},
  count_item: async(ctx,a)=>{ctx.log(String(countItem(ctx.bot,a)));return true;},
  equip_item: async(ctx,a)=>{const i=inventoryItem(ctx.bot,a);if(!i)throw new Error("Item not found.");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);return true;},
  drop_item: async(ctx,a)=>{const i=inventoryItem(ctx.bot,a);if(!i)throw new Error("Item not found.");active(ctx);await ctx.bot.tossStack(i);active(ctx);return true;},
  give_item: async(ctx,a)=>give(ctx,a),
  take_item: async(ctx,a)=>{
    const name=required(a,"Item is required."),before=countItem(ctx.bot,name),e=nearest(ctx.bot,e=>String(e?.name||"").toLowerCase()==="item"&&droppedItemMatchesName(ctx.bot,e,name),32);
    if(!e)throw new Error("Dropped item not found: "+name);await navigate(ctx,e.position,1.2,15000,"take item");const deadline=Date.now()+5000;
    while(Date.now()<deadline){active(ctx);if(countItem(ctx.bot,name)>before)return true;await wait(ctx,100);}throw new Error("Item was not picked up: "+name);
  },
  deposit: async(ctx,a)=>storage(ctx,a,true),
  retrieve: async(ctx,a)=>storage(ctx,a,false),
  sort_inventory: async(ctx)=>{
    const bot=ctx.bot,start=9,end=44;if(typeof bot.moveSlotItem!=="function")throw new Error("Mineflayer inventory move API is unavailable.");
    const snapshot=[];for(let slot=start;slot<=end;slot++){const item=bot.inventory.slots?.[slot];if(item)snapshot.push({name:item.name,type:item.type,metadata:item.metadata??0});}if(!snapshot.length){ctx.log("empty");return true;}
    const desired=[...snapshot].sort((a,b)=>a.name.localeCompare(b.name)||a.type-b.type||a.metadata-b.metadata);
    for(let i=0;i<desired.length;i++){active(ctx);const targetSlot=start+i,wanted=desired[i],current=bot.inventory.slots?.[targetSlot];if(current?.name===wanted.name&&current?.type===wanted.type&&Number(current?.metadata??0)===Number(wanted.metadata??0))continue;let source=-1;for(let slot=targetSlot;slot<=end;slot++){const item=bot.inventory.slots?.[slot];if(item&&item.name===wanted.name&&item.type===wanted.type&&Number(item.metadata??0)===Number(wanted.metadata??0)){source=slot;break;}}if(source<0)throw new Error("Inventory sort source disappeared: "+wanted.name);await bot.moveSlotItem(source,targetSlot);await wait(ctx,75);}
    const actual=[];for(let slot=start;slot<=end;slot++){const item=bot.inventory.slots?.[slot];if(item)actual.push(item.name);}const expected=desired.map(x=>x.name);if(actual.join("|")!==expected.join("|"))throw new Error("Inventory sort verification failed.");ctx.log("sorted="+actual.join(", "));return true;
  },
  smelt: async(ctx,a)=>smelt(ctx,a),
  craft_workbench: async(ctx,a)=>{
    const tableId=ctx.bot.registry?.blocksByName?.crafting_table?.id;
    const table=tableId!=null?ctx.bot.findBlock({matching:tableId,maxDistance:16}):null;
    if(!table)throw new Error("No crafting table nearby.");
    return craft(ctx,a,1,table);
  },
  craft_furnace: async(ctx,a)=>smelt(ctx,a),
  gather_missing_materials: async(ctx,a)=>{
    const name=required(a,"Item is required.").toLowerCase().replace(/\s+/g,"_"),type=ctx.bot.registry?.itemsByName?.[name];if(!type)throw new Error("Unknown item: "+name);
    const recipes=ctx.bot.recipesFor(type.id,null,1,null);if(!recipes.length)throw new Error("No recipe available for "+name+".");let gathered=false;
    for(const ingredient of recipes[0].delta||[]){const id=ingredient?.id,need=Math.max(0,Number(ingredient?.count)||0);if(id==null||need<=0)continue;const ing=ctx.bot.registry.items[id],ingName=String(ing?.name||id),missing=Math.max(0,need-countItem(ctx.bot,ingName));for(let i=0;i<missing;i++){active(ctx);const block=findBlockDroppingItem(ctx.bot,ingName,48);if(!block)throw new Error("Missing material not found nearby: "+ingName);await digBlock(ctx,block);gathered=true;}}
    if(!gathered)ctx.log?.("No missing raw materials.");return true;
  },
  multi_step_craft: async(ctx,a)=>{const name=required(a,"Item is required.").toLowerCase().replace(/\s+/g,"_");await ensureCraftMaterials(ctx,name);return craft(ctx,name,1);},
  place_block: async(ctx,a)=>{const q=parts(a),name=required(q.shift(),"Block is required."),p=coords(q.join(" "));return placeAt(ctx,name,p);},
  break_block: async(ctx,a)=>H.dig(ctx,a),
  open_chest: async(ctx,a)=>{const c=await container(ctx,coords(a),"chest");ctx.log("Chest opened.");return Boolean(c);},
  open_barrel: async(ctx,a)=>{const c=await container(ctx,coords(a),"barrel");ctx.log("Barrel opened.");return Boolean(c);},
  open_door: async(ctx,a)=>ensureDoor(ctx,coords(a),true),
  close_door: async(ctx,a)=>ensureDoor(ctx,coords(a),false),
  use_button: async(ctx,a)=>interactBlock(ctx,coords(a),"button"),
  use_lever: async(ctx,a)=>interactBlock(ctx,coords(a),"lever"),
  use_block: async(ctx,a)=>interactBlock(ctx,coords(a)),
  use_item: async(ctx,a)=>{const i=inventoryItem(ctx.bot,a);if(!i)throw new Error("Item not found.");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);ctx.bot.activateItem();try{await wait(ctx,500);}finally{ctx.bot.deactivateItem();}return true;},
  sleep: async(ctx)=>{const b=ctx.bot.findBlock({matching:x=>String(x?.name||"").endsWith("_bed"),maxDistance:24});if(!b)throw new Error("No bed nearby.");await navigate(ctx,b.position,3.5,30000,"bed navigation");active(ctx);await ctx.bot.sleep(b);return true;},
  find_player: async(ctx,a)=>{const p=player(ctx.bot,a);if(!p)throw new Error("Player not found.");ctx.log(p.username);return true;},
  find_entity: async(ctx,a)=>{const e=nearest(ctx.bot,e=>!a||entityName(e).includes(String(a).toLowerCase()),48);if(!e)throw new Error("Entity not found.");ctx.log(entityName(e));return true;},
  find_item_world: async(ctx,a)=>{
    const e=nearest(ctx.bot,e=>String(e?.name||"").toLowerCase()==="item"&&droppedItemMatches(ctx.bot,e,a),48);
    if(!e)throw new Error("Dropped item not found"+(a?": "+String(a):"."));
    ctx.log("item="+String(a||"unknown")+" at "+e.position);
    return true;
  },
  check_nearby: async(ctx)=>{ctx.log(Object.values(ctx.bot.entities||{}).filter(e=>e?.position&&e!==ctx.bot.entity&&distance(ctx.bot,e)<=16).map(entityName).join(", ")||"none");return true;},
  check_environment: async(ctx)=>{ctx.log("position="+ctx.bot.entity.position.x.toFixed(2)+" "+ctx.bot.entity.position.y.toFixed(2)+" "+ctx.bot.entity.position.z.toFixed(2)+" dimension="+ctx.bot.game?.dimension);return true;},
  detect_hostiles: async(ctx)=>{const h=Object.values(ctx.bot.entities||{}).filter(e=>e?.position&&HOSTILES.has(entityName(e))&&distance(ctx.bot,e)<=16);ctx.log(h.map(entityName).join(", ")||"none");return true;},
  check_health: async(ctx)=>{ctx.log(String(ctx.bot.health??0)+"/20");return true;},
  check_food: async(ctx)=>{ctx.log(String(ctx.bot.food??0)+"/20");return true;},
  check_equipment: async(ctx)=>{const bot=ctx.bot,eq=bot.entity?.equipment||[],slot=i=>eq[i]?.name||"empty";ctx.log("held="+(bot.heldItem?.name||"empty")+" offhand="+slot(5)+" feet="+slot(1)+" legs="+slot(2)+" torso="+slot(3)+" head="+slot(4));return true;},
  ask_permission: async(ctx,a)=>{const q=parts(a),u=required(q.shift(),"Username is required."),action=required(q.join(" "),"Action is required.");return ctx.runtime.askOwner?.(u,action,action)===true;},
  whisper_player: async(ctx,a)=>H.private_chat(ctx,a),
  remember_player: async(ctx,a)=>{const q=parts(a),u=required(q.shift(),"Username is required."),fact=required(q.join(" "),"Fact is required.");const key=String(u).toLowerCase();const existing=ctx.runtime?.memory?.players?.[key]?.facts;const facts=Array.isArray(existing)?[...new Set([...existing,fact])]:[fact];ctx.runtime.rememberPlayer?.(u,{facts});return true;},
  return_home: async(ctx)=>{
    const h=ctx.runtime?.memory?.home;
    if(!h) throw new Error("Home is not remembered.");
    if(String(h.dimension||"unknown")!==String(ctx.bot.game?.dimension||"unknown")) throw new Error("Home is in "+h.dimension+"; current dimension is "+String(ctx.bot.game?.dimension||"unknown")+".");
    return navigate(ctx,h,3,30000,"home");
  },
  forget_home: async(ctx)=>{if(!ctx.runtime?.forgetHome?.()) throw new Error("No home is currently remembered.");return true;},
  remember_location: async(ctx,a)=>{
    const q=parts(a),name=required(q.shift(),"Location name is required."),p=coords(q.join(" "));
    if(!ctx.runtime?.rememberLocation) throw new Error("Location memory service is unavailable.");
    ctx.runtime.rememberLocation(name,p.x,p.y,p.z); return true;
  },
  return_to_location: async(ctx,a)=>{
    const loc=locationMemory(ctx,a); return navigate(ctx,loc,3,30000,"location");
  },
  find_structure: async(ctx,a)=>findStructureMarker(ctx,a),
  find_biome: async(ctx,a)=>findBiome(ctx,a),
  recover_items_after_death: async(ctx)=>recoverDeathItems(ctx),
  repair_equipment: async(ctx,a)=>repairEquipment(ctx,a),
  breed_animals: async(ctx,a)=>breedAnimals(ctx,a),
  enchant_item: async(ctx,a)=>enchantItem(ctx,a),
  milk_animal: async(ctx,a)=>milkAnimal(ctx,a),
  shear_animal: async(ctx,a)=>shearAnimal(ctx,a),
  extinguish_fire: async(ctx)=>extinguishFire(ctx),
  clear_hostiles: async(ctx,a)=>clearHostiles(ctx,a),
  fill_area: async(ctx,a)=>fillArea(ctx,a),
  clear_area: async(ctx,a)=>clearArea(ctx,a),
  replace_blocks: async(ctx,a)=>replaceBlocks(ctx,a),
  use_potion: async(ctx,a)=>usePotion(ctx,a),
  use_firework: async(ctx,a)=>useFirework(ctx,a),
  use_ender_chest: async(ctx,a)=>useEnderChest(ctx,a),
  collect_honey: async(ctx,a)=>collectHoney(ctx,a),
  use_beacon: async(ctx,a)=>useBeacon(ctx,a),
  use_conduit: async(ctx,a)=>useConduit(ctx,a),
  trade_villager: async(ctx,a)=>tradeVillager(ctx,a),
  use_anvil: async(ctx,a)=>useAnvil(ctx,a),
  use_brewing_stand: async(ctx,a)=>useBrewingStand(ctx,a),
  use_shulker_box: async(ctx,a)=>useShulkerBox(ctx,a),
  fill_bucket: async(ctx,a)=>fillBucket(ctx,a),
  place_liquid: async(ctx,a)=>placeLiquid(ctx,a),
  control_vehicle: async(ctx,a)=>controlVehicle(ctx,a),
  use_grindstone: async(ctx,a)=>useWorkstation(ctx,a,"grindstone"),
  use_loom: async(ctx,a)=>useWorkstation(ctx,a,"loom"),
  use_stonecutter: async(ctx,a)=>useWorkstation(ctx,a,"stonecutter"),
  use_cartography_table: async(ctx,a)=>useWorkstation(ctx,a,"cartography_table"),
  use_smithing_table: async(ctx,a)=>useWorkstation(ctx,a,"smithing_table"),
  ignite: async(ctx,a)=>ignite(ctx,a),
  activate_respawn_anchor: async(ctx,a)=>activateRespawnAnchor(ctx,a),
  use_totem: async(ctx)=>useTotem(ctx),
  use_water_bucket: async(ctx,a)=>useBucketKind(ctx,a,"water"),
  use_lava_bucket: async(ctx,a)=>useBucketKind(ctx,a,"lava"),
  collect_powder_snow: async(ctx,a)=>collectPowderSnow(ctx,a),
  use_spyglass: async(ctx,a)=>useSpyglass(ctx,a),
  use_compass: async(ctx)=>useCompass(ctx),
  use_recovery_compass: async(ctx)=>useRecoveryCompass(ctx),
  bow_charge: async(ctx,a)=>chargeBow(ctx,a),
  crossbow_charge: async(ctx)=>chargeCrossbow(ctx),
  trident_attack: async(ctx,a)=>tridentAttack(ctx,a),
  throw_trident: async(ctx,a)=>throwTrident(ctx,a),
  throw_splash_potion: async(ctx,a)=>throwPotionKind(ctx,a,"splash_potion"),
  throw_lingering_potion: async(ctx,a)=>throwPotionKind(ctx,a,"lingering_potion"),
  knockback_target: async(ctx,a)=>knockbackTarget(ctx,a),
  critical_attack: async(ctx,a)=>criticalAttack(ctx,a),
  plant_seeds: async(ctx,a)=>plantSeeds(ctx,a),
  plant_sapling: async(ctx,a)=>plantSapling(ctx,a),
  harvest_and_replant: async(ctx)=>harvestAndReplant(ctx),
  bone_meal: async(ctx,a)=>boneMeal(ctx,a),
  feed_animal: async(ctx,a)=>feedAnimal(ctx,a),
  tame_animal: async(ctx,a)=>tameAnimal(ctx,a),
  lead_animal: async(ctx,a)=>leadAnimal(ctx,a),
  move_animal: async(ctx,a)=>moveAnimal(ctx,a),
  collect_eggs: async(ctx,a)=>collectEggs(ctx,a),
  control_boat: async(ctx,a)=>controlTypedVehicle(ctx,a,"boat"),
  control_horse: async(ctx,a)=>controlTypedVehicle(ctx,a,"horse"),
  control_strider: async(ctx,a)=>controlTypedVehicle(ctx,a,"strider"),
  use_elytra: async(ctx,a)=>useElytra(ctx,a),
  build_blueprint: async(ctx,a)=>buildBlueprint(ctx,a),
  copy_structure: async(ctx,a)=>copyStructure(ctx,a),
  rotate_structure: async(ctx,a)=>rotateStructure(ctx,a),
  mirror_structure: async(ctx,a)=>mirrorStructure(ctx,a),
  repair_structure: async(ctx)=>repairStructure(ctx),
  light_area: async(ctx,a)=>lightArea(ctx,a),
  recovery_mission: async(ctx)=>recoveryMission(ctx),
  goal: async(ctx,a)=>runGoalPlan(ctx,a),
  remember_home: async(ctx,a)=>{
    const p=coords(a);
    const home=ctx.runtime.rememberHome?.(p.x,p.y,p.z);
    if(!home) throw new Error("Home memory service is unavailable.");
    ctx.log?.("[HOME] Remembered at "+home.x+" "+home.y+" "+home.z+" ("+home.dimension+").");
    return true;
  },
  report_result: async(ctx,a)=>{ctx.bot.chat(required(a,"Message is required.").slice(0,256));return true;},
  ask_clarification: async(ctx,a)=>H.private_chat(ctx,a),
  retrieve_item: async(ctx,a)=>{
    const name=required(a,"Item is required.").toLowerCase().replace(/\s+/g,"_");
    const type=ctx.bot.registry?.itemsByName?.[name]; if(!type) throw new Error("Unknown item: "+name);
    const positions=ctx.bot.findBlocks?.({matching:b=>CONTAINERS.has(String(b?.name||"")),maxDistance:32,maxCount:32})||[];
    for(const position of positions){
      active(ctx);
      const ctn=await container(ctx,position);
      try{active(ctx);await ctn.withdraw(type.id,null,1);return true;}catch{}finally{try{await ctn.close();}catch{}}
    }
    throw new Error("Item not found in nearby containers: "+name);
  },
  deliver_item: async(ctx,a)=>H.give_item(ctx,a),
  escort_player: async(ctx,a)=>followWithDefense(ctx,player(ctx.bot,a)?.entity||(()=>{throw new Error("Player not found.");})(),3,true),
  protect_player: async(ctx,a)=>protect(ctx,a),
  guard_location: async(ctx,a)=>guard(ctx,coords(a)),  build: async(ctx,a)=>build(ctx,a),
  search: async(ctx,a)=>{const target=required(a,"Search target is required."),e=findSearchTarget(ctx.bot,target,48);if(!e)throw new Error("Search target not found: "+target);if(e.position&&e.height!=null)await lookAtEntity(ctx,e);ctx.log("found="+String(e.name||e.username||e.displayName||"target")+" position="+String(e.position||"unknown"));return true;},
  watch: async(ctx,a)=>{const s=required(a,"Watch target is required.");while(true){active(ctx);const e=player(ctx.bot,s)?.entity||nearest(ctx.bot,e=>entityName(e).includes(s.toLowerCase()),48);if(!e){ctx.terminate("target_lost");return false;}await lookAtEntity(ctx,e);await wait(ctx,250);}},
  coordinate_with_player: async(ctx,a)=>{
    const q=parts(a),u=required(q.shift(),"Username is required."),task=q.join(" ")||"ready";
    while(true){
      active(ctx);
      const p=player(ctx.bot,u);
      if(!p?.entity){ctx.terminate("target_lost");return false;}
      ctx.bot.whisper(u,"Ready: "+task);
      await follow(ctx,p.entity,3);
    }
  },
  op_command: async(ctx,a)=>{const c=required(a,"Command is required.");ctx.bot.chat(c.startsWith("/")?c:"/"+c);return true;}
};

async function ensureDoor(ctx,p,wantedOpen){
  const b=ctx.bot.blockAt(vec(ctx.bot,p)); if(!b||!String(b.name).includes("door")) throw new Error("Target is not a door.");
  if(distance(ctx.bot,{position:b.position})>4.5) await navigate(ctx,b.position,3.5,20000,"door");
  const props=typeof b.getProperties==="function"?b.getProperties():null;
  const current=props?.open;
  if(typeof current==="boolean" && current===wantedOpen) return true;
  active(ctx); await ctx.bot.lookAt(b.position.offset(0.5,0.5,0.5),true); active(ctx); await ctx.bot.activateBlock(b); return true;
}
async function guard(ctx,p){
  const {bot}=ctx;
  const x=Number(p.x), z=Number(p.z), range=3;
  if(!Number.isFinite(x)||!Number.isFinite(z)) throw new Error("Invalid guard-post X/Z.");

  const reachPost = async label => {
    const deadline=Date.now()+30000;
    let lastProgressAt=Date.now();
    let lastX=bot.entity.position.x;
    let lastZ=bot.entity.position.z;
    let replans=0;
    let goalActive=false;

    while(Date.now()<deadline){
      active(ctx);

      // Guard owns hostile response even while travelling to the post.
      // A safety warning is informational; it must not leave the navigation
      // goal competing with combat.
      const hostile=await nearestHostile(ctx,12);
      if(hostile){
        try{bot.pathfinder.setGoal(null);}catch{}
        goalActive=false;
        await H.equip_best_weapon(ctx,"");
        await attack(ctx,hostile,15000);
        active(ctx);
        lastProgressAt=Date.now();
        lastX=bot.entity.position.x;
        lastZ=bot.entity.position.z;
        replans++;
        if(replans>12) throw new Error(label+" recovery limit reached.");
        continue;
      }

      const dx=bot.entity.position.x-x, dz=bot.entity.position.z-z;
      if(Math.hypot(dx,dz)<=range){
        try{bot.pathfinder.setGoal(null);}catch{}
        goalActive=false;
        return true;
      }

      // Re-issue the same X/Z goal only when the bot has genuinely stalled.
      // This prevents a second movement writer while still recovering from a
      // blocked/stale Pathfinder plan.
      const moved=Math.hypot(bot.entity.position.x-lastX,bot.entity.position.z-lastZ);
      if(moved>=0.15){
        lastProgressAt=Date.now();
        lastX=bot.entity.position.x;
        lastZ=bot.entity.position.z;
      }

      if(Date.now()-lastProgressAt>=2500){
        try{bot.pathfinder.setGoal(null);}catch{}
        goalActive=false;
        replans++;
        if(replans>12) throw new Error(label+" stalled repeatedly.");
        bot.pathfinder.setGoal(new goals.GoalNearXZ(x,z,range),true);
        goalActive=true;
        lastProgressAt=Date.now();
        lastX=bot.entity.position.x;
        lastZ=bot.entity.position.z;
      }else{
        if(!goalActive){
          bot.pathfinder.setGoal(new goals.GoalNearXZ(x,z,range),true);
          goalActive=true;
          replans++;
        }
      }

      await wait(ctx,100);
    }

    try{bot.pathfinder.setGoal(null);}catch{}
    goalActive=false;
    throw new Error(label+" timed out.");
  };

  active(ctx);
  await reachPost("guard post navigation");
  await H.equip_best_weapon(ctx,"");

  while(true){
    active(ctx);
    const target=await nearestHostile(ctx,12);
    if(target){
      try{bot.pathfinder.setGoal(null);}catch{}
      await H.equip_best_weapon(ctx,"");
      await attack(ctx,target,15000);
      continue;
    }

    const dx=bot.entity.position.x-x, dz=bot.entity.position.z-z;
    if(Math.hypot(dx,dz)>range){
      await reachPost("guard post recovery");
      await H.equip_best_weapon(ctx,"");
      continue;
    }
    await wait(ctx,200);
  }
}
async function protect(ctx,a){
  const p=player(ctx.bot,a);
  if(!p?.entity) throw new Error("Player not found.");
  const {bot}=ctx;
  let followed=null;
  let combatTarget=null;
  let combatTargetUuid=null;
  let combatTargetId=null;
  let combatTargetAt=0;
  let ownerDamagedAt=0;
  let ownerDamagedBy=null;
  let ownerDamagedByUuid=null;
  let ownerDamagedById=null;
  let ownerSwingAt=0;
  let swingEntityUuids=new Set();
  let lastProcessedTargetUuid=null;
  let lastProcessedTargetAt=0;
  let defenseIncidentAt=0;
  let lastDefenseScanAt=0;
  let combatBusy=false;

  const ownerEntity=()=>player(bot,p.username)?.entity||null;

  const isLivingCombatEntity=e =>
    !!e &&
    e?.isValid!==false &&    e!==bot.entity &&
    (e.type==="mob"||e.type==="player") &&
    (e.health==null||e.health>0);

  // An exact entityHurt target is already authoritative for the owner-attack  // path. Do not require Mineflayer's broad entity type classification here:
  // protocol/entity variants can briefly expose a valid hurt target without
  // the normal mob/player type while the entity is still attackable.
  const isAttackableTarget=e =>
    !!e &&
    e?.isValid!==false &&
    e!==bot.entity &&
    !!e.position &&
    (e.health==null||e.health>0);

  const resolveEntityUuid=uuid=>{
    if(!uuid) return null;
    return Object.values(bot.entities||{})
      .find(e=>e?.isValid!==false&&e!==bot.entity&&e.uuid===uuid)||null;
  };

  const nearbyCombat=owner=>{
    if(!owner?.position) return [];
    return Object.values(bot.entities||{})
      .filter(isLivingCombatEntity)
      .filter(e=>owner.position.distanceTo(e.position)<=8);
  };

  const rememberTarget=(entity,reason)=>{
    if(!entity?.uuid) return;
    const now=Date.now();
    if(combatTargetUuid===entity.uuid && now-lastProcessedTargetAt<1500) return;
    combatTargetUuid=entity.uuid;
    combatTargetId=entity.id;
    combatTarget=resolveEntityUuid(combatTargetUuid)||entity;
    combatTargetAt=now;
    lastProcessedTargetUuid=entity.uuid;
    lastProcessedTargetAt=now;
    ctx.log?.("[PROTECT] "+reason+
      " entityUUID="+String(combatTargetUuid)+
      " entityId="+String(combatTargetId??"null")+
      " target="+entityName(entity));
  };

  const onSwing=entity=>{
    const owner=ownerEntity();
    if(!owner||entity?.id!==owner.id) return;

    // A swing is only a correlation signal. It is NOT proof that anything
    // was hit, so never log/select nearby UUIDs here.
    ownerSwingAt=Date.now();
    swingEntityUuids=new Set(
      nearbyCombat(owner)
        .map(e=>e.uuid)
        .filter(Boolean)
    );
  };

  const onHurt=(entity,source)=>{
    const owner=ownerEntity();
    if(!owner||!entity) return;

    // The entity delivered by entityHurt is already the exact affected
    // entity. Prefer it directly; resolving through bot.entities can fail
    // when the entity is being removed/dying.
    const hurtEntity=entity.uuid
      ? (resolveEntityUuid(entity.uuid)||entity)
      : entity;

    if(entity.id===owner.id){
      const now=Date.now();
      ownerDamagedAt=now;
      if(now-defenseIncidentAt<1200) return;
      defenseIncidentAt=now;

      if(isLivingCombatEntity(source)){
        ownerDamagedByUuid=source.uuid||null;
        ownerDamagedById=source.id;
        ownerDamagedBy=source;

        if(ownerDamagedBy){
          rememberTarget(ownerDamagedBy,"owner attacker");
        }
      }

      ctx.log?.("[PROTECT] owner hurt; attackerUUID="+
        String(ownerDamagedByUuid??"null")+
        " attackerId="+String(ownerDamagedById??"null"));
      return;
    }

    // Exact server-side attribution when the damage source is the owner.
    if(
      hurtEntity &&
      (source===owner || source?.id===owner.id)
    ){
      rememberTarget(hurtEntity,"owner attack target confirmed by entityHurt source");
      return;
    }

    // Some server/protocol paths omit source. In that case entityHurt still
    // gives the exact hurt entity UUID. Correlate only with a recent owner
    // swing AND the UUID that was visible at swing time.
    if(
      hurtEntity?.uuid &&
      Date.now()-ownerSwingAt<=1500 &&
      swingEntityUuids.has(hurtEntity.uuid)
    ){
      rememberTarget(hurtEntity,"owner attack target matched by entityUUID");
      return;
    }

    // Debug only: prove which UUID Mineflayer reported as hurt without
    // treating unrelated damage as an owner attack.
    if(hurtEntity?.uuid){
      ctx.log?.("[PROTECT] entity hurt observed entityUUID="+
        String(hurtEntity.uuid)+
        " entityId="+String(hurtEntity.id??"null")+
        " sourceUUID="+String(source?.uuid??"null")+
        " sourceId="+String(source?.id??"null"));
    }
  };

  bot.on("entitySwingArm",onSwing);
  bot.on("entityHurt",onHurt);

  const hostileNearOwner=owner=>{
    const direct=ownerDamagedByUuid
      ? resolveEntityUuid(ownerDamagedByUuid)
      : ownerDamagedBy;

    if(isLivingCombatEntity(direct)&&HOSTILES.has(entityName(direct))){
      ctx.log?.("[PROTECT] defense attacker resolved by source entityUUID="+
        String(direct.uuid??"null")+
        " entityId="+String(direct.id??"null")+
        " target="+entityName(direct));
      return direct;
    }

    const candidates=Object.values(bot.entities||{})
      .filter(e=>isAttackableTarget(e)&&HOSTILES.has(entityName(e)))
      .filter(e=>owner.position.distanceTo(e.position)<=12)
      .sort((a,b)=>owner.position.distanceTo(a)-owner.position.distanceTo(b));

    const attacker=candidates[0]||null;
    ctx.log?.("[PROTECT] defense scan ownerHurt=true candidates="+
      candidates.map(e=>entityName(e)+"#"+String(e.id)+"@"+e.position.distanceTo(owner.position).toFixed(2)+"m").join(",")+
      " selected="+(attacker?entityName(attacker):"none"));

    return attacker;
  };
  // Protect mode has two independent defense layers:
  // 1) exact owner damage attribution (entityHurt/source), and
  // 2) a proactive danger scan for hostile mobs already inside the owner's
  //    immediate combat envelope. This prevents an AFK owner from taking a
  //    long series of hits while waiting for another damage event.
  const selfThreat=()=>{
    const owner=ownerEntity();
    if(!owner?.position) return null;
    return Object.values(bot.entities||{})
      .filter(e=>isAttackableTarget(e)&&HOSTILES.has(entityName(e)))
      .filter(e=>owner.position.distanceTo(e.position)<=8)
      .sort((a,b)=>owner.position.distanceTo(a)-owner.position.distanceTo(b))[0]||null;
  };

  try{
    while(true){
      active(ctx);
      const live=ownerEntity();
      if(!live){ctx.terminate("target_lost");return false;}

      if(combatTargetUuid){
        combatTarget=resolveEntityUuid(combatTargetUuid)||combatTarget;
        if(!combatTarget || combatTarget.isValid===false || Date.now()-combatTargetAt>5000){
          combatTarget=null;
          combatTargetUuid=null;
          combatTargetId=null;
        }else{
          combatTargetId=combatTarget.id;
        }
      }

      if(ownerSwingAt && Date.now()-ownerSwingAt>1500){
        ownerSwingAt=0;
        swingEntityUuids.clear();
      }

      if(isAttackableTarget(combatTarget)){
        try{bot.pathfinder.setGoal(null);}catch{}
        followed=null;
        combatBusy=true;
        ctx.log?.("[PROTECT] ATTACK START target="+entityName(combatTarget)+
          " entityUUID="+String(combatTarget.uuid??combatTargetUuid)+
          " entityId="+String(combatTarget.id??combatTargetId));
        try{
          const weapon=bestWeapon(bot);
          if(weapon) await bot.equip(weapon,"hand");
          const killed=await attack(ctx,combatTarget,15000);
          ctx.log?.("[PROTECT] ATTACK END target="+entityName(combatTarget)+
            " entityUUID="+String(combatTarget.uuid??combatTargetUuid)+
            " killed="+String(killed));
        }finally{combatBusy=false;}
        combatTarget=null;
        combatTargetUuid=null;
        combatTargetId=null;
        continue;
      }

      if(!combatBusy && Date.now()-ownerDamagedAt<=1500 &&
         Date.now()-lastDefenseScanAt>=500){
        lastDefenseScanAt=Date.now();
        const attacker=hostileNearOwner(live);
        if(attacker){
          try{bot.pathfinder.setGoal(null);}catch{}
          followed=null;
          combatBusy=true;
          ctx.log?.("[PROTECT] DEFENSE ATTACK START target="+entityName(attacker)+
            " entityUUID="+String(attacker.uuid??"null")+
            " entityId="+String(attacker.id??"null"));
          try{
            const weapon=bestWeapon(bot);
            if(weapon) await bot.equip(weapon,"hand");
            const killed=await attack(ctx,attacker,15000);
            ctx.log?.("[PROTECT] DEFENSE ATTACK END target="+entityName(attacker)+
              " entityUUID="+String(attacker.uuid??"null")+
              " killed="+String(killed));
          }finally{combatBusy=false;}
          ownerDamagedAt=0;
          lastDefenseScanAt=0;
          ownerDamagedBy=null;
          ownerDamagedByUuid=null;
          ownerDamagedById=null;
          continue;
        }
      }

      const threat=selfThreat();
      if(!combatBusy && threat){
        try{bot.pathfinder.setGoal(null);}catch{}
        followed=null;
        combatBusy=true;
        ctx.log?.("[PROTECT] SELF-DEFENSE ATTACK START target="+entityName(threat)+
          " entityUUID="+String(threat.uuid??"null")+
          " entityId="+String(threat.id??"null"));
        try{
          const weapon=bestWeapon(bot);
          if(weapon) await bot.equip(weapon,"hand");
          const killed=await attack(ctx,threat,15000);
          ctx.log?.("[PROTECT] SELF-DEFENSE ATTACK END target="+entityName(threat)+
            " entityUUID="+String(threat.uuid??"null")+
            " killed="+String(killed));
        }finally{combatBusy=false;}
        continue;
      }

      if(live!==followed){
        try{bot.pathfinder.setGoal(new goals.GoalFollow(live,5),true);}catch{}
        followed=live;
      }
      await wait(ctx,100);
    }
  }finally{
    bot.removeListener?.("entitySwingArm",onSwing);
    bot.removeListener?.("entityHurt",onHurt);
    try{bot.pathfinder.setGoal(null);}catch{}
  }
}
async function give(ctx,a){
  const q=parts(a),name=required(q.shift(),"Item is required."),u=required(q.shift(),"Username is required."),p=player(ctx.bot,u)?.entity,i=inventoryItem(ctx.bot,name);
  if(!p)throw new Error("Player not found.");if(!i)throw new Error("Item not found.");await navigate(ctx,p.position,3,20000,"delivery");active(ctx);await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.tossStack(i);return true;
}
async function storage(ctx,a,deposit){
  const q=parts(a),name=required(q.shift(),"Item is required."),p=coords(q.splice(0,3).join(" ")),c=await container(ctx,p);
  try{
    const type=ctx.bot.registry.itemsByName[name.toLowerCase().replace(/\s+/g,"_")];if(!type)throw new Error("Unknown item: "+name);
    active(ctx);
    if(deposit){const n=countItem(ctx.bot,name);if(n<=0)throw new Error("Item not available.");await c.deposit(type.id,null,n,null);}
    else {const n=Math.max(1,Number(q[0])||1);await c.withdraw(type.id,null,n,null);}
    return true;
  }finally{try{await c.close();}catch{}}
}
async function smelt(ctx,a){
  const name=required(a,"Smelting input is required.").toLowerCase();
  const b=ctx.bot.findBlock({matching:x=>/furnace/.test(String(x?.name||"")),maxDistance:24});
  if(!b)throw new Error("No furnace nearby.");
  await navigate(ctx,b.position,3.5,30000,"furnace");
  active(ctx);const f=await ctx.bot.openFurnace(b);
  try{
    const input=inventoryItem(ctx.bot,name);
    const fuel=inventoryItem(ctx.bot,"coal")||inventoryItem(ctx.bot,"charcoal")||inventoryItem(ctx.bot,"planks");
    if(!input)throw new Error("Smelting input not found.");
    if(!fuel)throw new Error("Fuel not found.");
    active(ctx);
    const beforeOutput=f.outputItem?.();
    await f.putInput(input.type??input.id,null,1);
    await f.putFuel(fuel.type??fuel.id,null,1);
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      active(ctx);
      await defendNearbyThreat(ctx,10);
      active(ctx);
      const output=f.outputItem?.();      if(output && (!beforeOutput || output.count>beforeOutput.count || output.type!==beforeOutput.type)){
        await f.takeOutput();
        ctx.log?.("[SMELT] output ready: "+String(output.name||"item"));
        return true;
      }
      await wait(ctx,250);
    }
    throw new Error("Furnace did not produce output before timeout.");
  }finally{try{await f.close();}catch{}}
}
async function findSafe(ctx){
  const {bot}=ctx;
  for(let r=3;r<=24;r+=3) for(let i=0;i<16;i++){
    active(ctx); const a=i*Math.PI/8;
    const x=Math.floor(bot.entity.position.x+Math.cos(a)*r), z=Math.floor(bot.entity.position.z+Math.sin(a)*r), y=Math.floor(bot.entity.position.y);
    const foot=bot.blockAt(new bot.entity.position.constructor(x,y,z));
    const head=bot.blockAt(new bot.entity.position.constructor(x,y+1,z));
    const floor=bot.blockAt(new bot.entity.position.constructor(x,y-1,z));
    const hostiles=Object.values(bot.entities||{}).some(e=>e?.position&&HOSTILES.has(entityName(e))&&e.position.distanceTo(new bot.entity.position.constructor(x,y,z))<5);
    if(!hostiles && foot?.name==="air" && head?.name==="air" && floor?.name!=="air" && floor?.boundingBox==="block")
      return navigate(ctx,{x:x+0.5,y,z:z+0.5},1.5,10000,"safe location");
  }
  throw new Error("No safe location found in loaded area.");
}

async function build(ctx,a){
  const m=required(a,"Build plan is required.").match(/^(pillar|tower|line)\s+(\S+)\s+(\d+)$/i);
  if(!m)throw new Error("Build plan: pillar|tower|line <block> <count>.");
  const kind=m[1].toLowerCase(),name=m[2],n=Math.max(1,Number(m[3]));
  const support=findBuildSupport(ctx.bot,6);
  if(!support)throw new Error("No safe solid build location nearby.");
  const placed=[];
  for(let i=0;i<n;i++){
    active(ctx);
    await defendNearbyThreat(ctx,10);
    active(ctx);
    const p=kind==="line"
      ? {x:support.x+i,y:support.y,z:support.z}
      : {x:support.x,y:support.y+i,z:support.z};
    const b=ctx.bot.blockAt(vec(ctx.bot,p));
    if(b?.name===name){placed.push(p);continue;}
    if(b?.name!=="air")throw new Error("Build target occupied at ("+p.x+", "+p.y+", "+p.z+").");
    await placeAt(ctx,name,p);
    placed.push(p);
  }
  ctx.log?.("[BUILD] "+kind+" placed="+String(placed.length)+" block="+name);
  return true;
}

export const RUNTIME_ACTIONS = new Set();
export const HANDLERS = Object.freeze(H);
assertCapabilityRegistry(HANDLERS);

export async function executeCapability(id,arg,ctx){
  const mode=CAPABILITY_MODES.find(x=>x.id===id);
  if(!mode)throw new Error("Unknown capability: "+id);
  const handler=HANDLERS[id];
  if(typeof handler!=="function")throw new Error("Capability has no handler: "+id);
  if(id==="stop"){ctx.runtime.cancelCurrentTask?.("manual stop");return true;}
  return handler(ctx,arg);
}