import pathfinderPackage from "mineflayer-pathfinder";
const { goals } = pathfinderPackage;
import { CAPABILITY_MODES, assertCapabilityRegistry } from "./capabilityModes.mjs";

export const CAPABILITIES = CAPABILITY_MODES;

const HOSTILES = new Set(["zombie","husk","drowned","skeleton","stray","creeper","spider","cave_spider","witch","pillager","vindicator","evoker","ravager","phantom","blaze","magma_cube","silverfish","endermite","guardian","elder_guardian","piglin_brute","hoglin","zoglin"]);
const PASSIVES = new Set(["cow","pig","sheep","chicken","rabbit","horse","donkey","mule","llama","goat","mooshroom","strider","turtle","fish","cod","salmon"]);
const CROPS = new Set(["wheat","carrots","potatoes","beetroots","nether_wart"]);
const CONTAINERS = new Set(["chest","trapped_chest","barrel","shulker_box"]);
const WEAPON_KINDS = ["mace","sword","axe","trident"];

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
  bot.pathfinder.setGoal(new goals.GoalFollow(target,range),true);
  try{
    while(true){ active(ctx); if(!target.isValid) throw new Error("Target lost."); await wait(ctx,150); }
  }finally{try{bot.pathfinder.setGoal(null);}catch{}}
}
async function lookAt(ctx,p){ active(ctx); await ctx.bot.lookAt(vec(ctx.bot,p),true); return true; }
async function lookAtEntity(ctx,e){ active(ctx); await ctx.bot.lookAt(e.position.offset(0,e.height||1.4,0),true); return true; }

async function attack(ctx,target,timeout=15000){
  const {bot}=ctx; const deadline=Date.now()+timeout;
  while(target?.isValid!==false && (target?.health==null||target.health>0) && Date.now()<deadline){
    active(ctx);
    if(distance(bot,target)>3.1){
      bot.pathfinder.setGoal(new goals.GoalFollow(target,2.7),true);
      await wait(ctx,150);
      continue;
    }
    try{bot.pathfinder.setGoal(null);}catch{}
    await bot.lookAt(target.position.offset(0,target.height||1.2,0),true);
    active(ctx); bot.attack(target);
    await wait(ctx,450);
  }
  try{bot.pathfinder.setGoal(null);}catch{}
  return target?.isValid!==false && (target?.health==null||target.health<=0);
}

async function nearestHostile(ctx,max=16){
  return nearest(ctx.bot,e=>HOSTILES.has(entityName(e))&&e.isValid!==false,max);
}
async function nearestAnimal(ctx,max=24){
  return nearest(ctx.bot,e=>PASSIVES.has(entityName(e)),max);
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
  const {bot}=ctx, target=bot.blockAt(vec(bot,p));
  const item=inventoryItem(bot,name);
  if(!item) throw new Error("Placement item not found: "+name);
  if(!target||target.name!=="air") throw new Error("Placement target is not empty.");
  const ref=bot.blockAt(vec(bot,{x:p.x,y:p.y-1,z:p.z}));
  if(!ref) throw new Error("No valid reference block for placement.");
  if(distance(bot,{position:target.position})>4.5){
    bot.pathfinder.setGoal(new goals.GoalPlaceBlock(target.position,bot.world,{range:4.5,LOS:true}));
    const deadline=Date.now()+30000;
    try{while(Date.now()<deadline){active(ctx);if(distance(bot,{position:target.position})<=4.5)return await placeDirect(ctx,item,ref);await wait(ctx,100);}throw new Error("placement navigation timed out.");}
    finally{try{bot.pathfinder.setGoal(null);}catch{}}
  }
  return placeDirect(ctx,item,ref);
}
async function placeDirect(ctx,item,ref){
  const {bot}=ctx; await bot.equip(item,"hand"); active(ctx);
  await bot.placeBlock(ref,new bot.entity.position.constructor(0,1,0)); return true;
}

const H = {
  follow_player: async(ctx,a)=>follow(ctx,player(ctx.bot,a)?.entity||(()=>{throw new Error("Player not found.");})(),3),
  roam: async(ctx)=>{
    const {bot}=ctx; const angle=Math.random()*Math.PI*2, r=8+Math.random()*12;
    return navigate(ctx,{x:bot.entity.position.x+Math.cos(angle)*r,y:bot.entity.position.y,z:bot.entity.position.z+Math.sin(angle)*r},2,20000,"roam");
  },
  pvp: async(ctx,a)=>{
    const p=player(ctx.bot,a); if(!p?.entity)throw new Error("Player not found.");
    return attack(ctx,p.entity,60000);
  },
  hit: async(ctx,a)=>{const p=player(ctx.bot,a);if(!p?.entity)throw new Error("Player not found.");return attack(ctx,p.entity,10000);},
  gather_resources: async(ctx,a)=>{
    const q=parts(a),name=required(q[0],"Resource name is required."),amount=Math.max(1,Math.floor(Number(q[1])||1));
    let got=countItem(ctx.bot,name);
    while(got<amount){active(ctx);const id=ctx.bot.registry.itemsByName[name.toLowerCase()]?.id;if(id==null)throw new Error("Unknown resource: "+name);
      const block=ctx.bot.findBlock({matching:b=>b?.drops?.some?.(d=>d===id)||String(b?.name||"").toLowerCase().includes(name.toLowerCase()),maxDistance:32});
      if(!block)throw new Error("Resource not found nearby: "+name);await digBlock(ctx,block);got=countItem(ctx,name);}
    return true;
  },
  do_task: async(ctx,a)=>{
    const s=required(a,"Task is required."), l=s.toLowerCase();
    if(l.startsWith("mine "))return H.mine(ctx,s.slice(5));
    if(l.startsWith("chop"))return H.chop_tree(ctx,"");
    if(l.startsWith("gather "))return H.gather_resources(ctx,s.slice(7));
    if(l.startsWith("craft "))return H.craft(ctx,s.slice(6));
    throw new Error("Supported do_task forms: mine, chop, gather, craft.");
  },
  coordinate: async(ctx,a)=>H.coordinate_with_player(ctx,a),
  explore: async(ctx)=>H.roam(ctx,""),
  observe: async(ctx,a)=>H.search(ctx,a),
  return: async(ctx)=>{const owner=ctx.runtime?.getStatus?.().ownerUsername;if(!owner)throw new Error("Owner is not configured.");const p=player(ctx.bot,owner);if(!p?.entity)throw new Error("Owner is not online.");return navigate(ctx,p.entity.position,3,30000,"return to owner");},
  investigate_entity: async(ctx,a)=>H.search(ctx,a),
  mine: async(ctx,a)=>{
    const name=required(a,"Block name is required()").toLowerCase();
    const b=ctx.bot.findBlock({matching:x=>String(x?.name||"").toLowerCase()===name,maxDistance:48});
    if(!b)throw new Error("Block not found nearby: "+name);return digBlock(ctx,b);
  },
  chop_tree: async(ctx)=>{
    const b=ctx.bot.findBlock({matching:x=>/(_log|_stem)$/.test(String(x?.name||"")),maxDistance:32});
    if(!b)throw new Error("No tree log found nearby.");return digBlock(ctx,b);
  },
  craft: async(ctx,a)=>{const q=parts(a),amount=Math.max(1,Number(q.at(-1))||1),name=q.length>1?q.slice(0,-1).join("_"):q[0];return craft(ctx,name,amount);},
  eat: async(ctx,a)=>{
    const i=String(a||"").trim()?inventoryItem(ctx.bot,a):ctx.bot.inventory.items().find(i=>ctx.bot.registry.foods?.[i.type]||/bread|apple|beef|pork|chicken|mutton|carrot|potato|stew|melon/.test(i.name));
    if(!i)throw new Error("Food item not found.");await ctx.bot.equip(i,"hand");active(ctx);await ctx.bot.consume();return true;
  },
  collect: async(ctx,a)=>{
    const q=parts(a),name=q[0]||"",amount=Math.max(1,Number(q[1])||1),before=countItem(ctx.bot,name);
    while(countItem(ctx.bot,name)<before+amount){active(ctx);const e=nearest(ctx.bot,e=>e.name==="item"&&(!name||String(e.metadata?.item?.itemId||e.displayName||"").toLowerCase().includes(name.toLowerCase())),32);if(!e)throw new Error("Dropped item not found.");await navigate(ctx,e.position,1.5,15000,"item pickup");await wait(ctx,500);}
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
    if(ctx.bot.vehicle){ctx.bot.dismount();return true;}
    const v=nearest(ctx.bot,e=>["boat","chest_boat","minecart"].includes(entityName(e)),6);if(!v)throw new Error("No nearby mountable vehicle.");if(typeof ctx.bot.mount!=="function")throw new Error("Mineflayer mount API is unavailable.");await ctx.bot.mount(v);return true;
  },
  attack_mob: async(ctx,a)=>{const t=nearest(ctx.bot,e=>HOSTILES.has(entityName(e))&&(!a||entityName(e).includes(String(a).toLowerCase())),32);if(!t)throw new Error("Target mob not found.");return attack(ctx,t);},
  defend: async(ctx)=>{while(true){active(ctx);const t=await nearestHostile(ctx,12);if(t)await attack(ctx,t);else await wait(ctx,250);}},
  guard: async(ctx,a)=>guard(ctx,coords(a)),
  escape: async(ctx)=>{
    const t=await nearestHostile(ctx,12);if(!t)return true;
    const dx=ctx.bot.entity.position.x-t.position.x,dz=ctx.bot.entity.position.z-t.position.z,len=Math.hypot(dx,dz)||1;
    return navigate(ctx,{x:ctx.bot.entity.position.x+dx/len*12,y:ctx.bot.entity.position.y,z:ctx.bot.entity.position.z+dz/len*12},3,15000,"escape");
  },
  chase_target: async(ctx,a)=>follow(ctx,player(ctx.bot,parts(a)[0])?.entity||(()=>{throw new Error("Target player not found.");})(),3),
  equip_best_weapon: async(ctx)=>{const i=bestWeapon(ctx.bot);if(!i)throw new Error("No weapon found.");await ctx.bot.equip(i,"hand");return true;},
  use_shield: async(ctx)=>{const i=inventoryItem(ctx.bot,"shield");if(!i)throw new Error("Shield not found.");await ctx.bot.equip(i,"off-hand");ctx.bot.activateItem();await wait(ctx,750);ctx.bot.deactivateItem();return true;},
  use_ranged_weapon: async(ctx,a)=>{const t=player(ctx.bot,a)?.entity||nearest(ctx.bot,e=>!HOSTILES.has(entityName(e))&&entityName(e).includes(String(a||"").toLowerCase()),32);if(!t)throw new Error("Target not found.");const i=inventoryItem(ctx.bot,"bow")||inventoryItem(ctx.bot,"crossbow");if(!i)throw new Error("Bow/crossbow not found.");await ctx.bot.equip(i,"hand");await lookAtEntity(ctx,t);ctx.bot.activateItem();await wait(ctx,1200);ctx.bot.deactivateItem();return true;},
  dig: async(ctx,a)=>digBlock(ctx,ctx.bot.blockAt(vec(ctx.bot,coords(a)))),
  harvest_crops: async(ctx)=>{const b=ctx.bot.findBlock({matching:x=>CROPS.has(String(x?.name||"")),maxDistance:32});if(!b)throw new Error("No crop found nearby.");return digBlock(ctx,b);},
  fish: async(ctx)=>{active(ctx);await ctx.bot.fish();return true;},
  hunt: async(ctx,a)=>{const t=await nearestAnimal(ctx,32);if(!t)throw new Error("No huntable animal nearby.");return attack(ctx,t);},
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
  recover_after_death: async(ctx)=>{await wait(ctx,1000);return true;},
  find_safe_location: async(ctx)=>findSafe(ctx),
  check_inventory: async(ctx)=>{ctx.log(ctx.bot.inventory.items().map(i=>i.name+" x"+i.count).join(", ")||"empty");return true;},
  find_item: async(ctx,a)=>{const i=inventoryItem(ctx.bot,a);if(!i)throw new Error("Item not found.");ctx.log(i.name+" x"+i.count);return true;},
  count_item: async(ctx,a)=>{ctx.log(String(countItem(ctx.bot,a)));return true;},
  equip_item: async(ctx,a)=>{const i=inventoryItem(ctx.bot,a);if(!i)throw new Error("Item not found.");await ctx.bot.equip(i,"hand");return true;},
  drop_item: async(ctx,a)=>{const i=inventoryItem(ctx.bot,a);if(!i)throw new Error("Item not found.");await ctx.bot.tossStack(i);return true;},
  give_item: async(ctx,a)=>give(ctx,a),
  take_item: async(ctx,a)=>{const e=nearest(ctx.bot,e=>e.name==="item"&&(!a||entityName(e).includes(String(a).toLowerCase())),32);if(!e)throw new Error("Dropped item not found.");await navigate(ctx,e.position,1.5,15000,"take item");return true;},
  deposit: async(ctx,a)=>storage(ctx,a,true),
  retrieve: async(ctx,a)=>storage(ctx,a,false),
  sort_inventory: async(ctx)=>{const names=ctx.bot.inventory.items().sort((a,b)=>a.name.localeCompare(b.name)).map(i=>i.name+" x"+i.count);ctx.log(names.join(", ")||"empty");return true;},
  smelt: async(ctx,a)=>smelt(ctx,a),
  craft_workbench: async(ctx,a)=>craft(ctx,a,1),
  craft_furnace: async(ctx,a)=>craft(ctx,a,1),
  gather_missing_materials: async(ctx,a)=>{
    const name=required(a,"Item is required.").toLowerCase().replace(/\s+/g,"_");
    const type=ctx.bot.registry?.itemsByName?.[name]; if(!type) throw new Error("Unknown item: "+name);
    const recipes=ctx.bot.recipesFor(type.id,null,1,null); if(!recipes.length) throw new Error("No recipe available for "+name+".");
    const missing=[];
    for(const ingredient of recipes[0].delta||[]){
      const id=ingredient?.id, need=Math.max(0,Number(ingredient?.count)||0);
      if(id==null||need<=0) continue;
      const ing=ctx.bot.registry.items[id]; const have=countItem(ctx.bot,ing?.name||"");
      if(have<need) missing.push({name:ing?.name||String(id),count:need-have});
    }
    if(!missing.length) return true;
    for(const m of missing){
      active(ctx);
      const block=ctx.bot.findBlock({matching:b=>String(b?.name||"").toLowerCase().includes(m.name.toLowerCase()),maxDistance:48});
      if(!block) throw new Error("Missing material not found nearby: "+m.name);
      for(let i=0;i<m.count;i++) await digBlock(ctx,block);
    }
    return true;
  },
  multi_step_craft: async(ctx,a)=>craft(ctx,a,1),
  place_block: async(ctx,a)=>{const q=parts(a),name=required(q.shift(),"Block is required."),p=coords(q.join(" "));return placeAt(ctx,name,p);},
  break_block: async(ctx,a)=>H.dig(ctx,a),
  open_chest: async(ctx,a)=>{const c=await container(ctx,coords(a),"chest");ctx.log("Chest opened.");return Boolean(c);},
  open_barrel: async(ctx,a)=>{const c=await container(ctx,coords(a),"barrel");ctx.log("Barrel opened.");return Boolean(c);},
  open_door: async(ctx,a)=>ensureDoor(ctx,coords(a),true),
  close_door: async(ctx,a)=>ensureDoor(ctx,coords(a),false),
  use_button: async(ctx,a)=>interactBlock(ctx,coords(a),"button"),
  use_lever: async(ctx,a)=>interactBlock(ctx,coords(a),"lever"),
  use_block: async(ctx,a)=>interactBlock(ctx,coords(a)),
  use_item: async(ctx,a)=>{const i=inventoryItem(ctx.bot,a);if(!i)throw new Error("Item not found.");await ctx.bot.equip(i,"hand");ctx.bot.activateItem();await wait(ctx,500);ctx.bot.deactivateItem();return true;},
  sleep: async(ctx)=>{const b=ctx.bot.findBlock({matching:x=>String(x?.name||"").endsWith("_bed"),maxDistance:24});if(!b)throw new Error("No bed nearby.");await navigate(ctx,b.position,3.5,30000,"bed navigation");await ctx.bot.sleep(b);return true;},
  find_player: async(ctx,a)=>{const p=player(ctx.bot,a);if(!p)throw new Error("Player not found.");ctx.log(p.username);return true;},
  find_entity: async(ctx,a)=>{const e=nearest(ctx.bot,e=>!a||entityName(e).includes(String(a).toLowerCase()),48);if(!e)throw new Error("Entity not found.");ctx.log(entityName(e));return true;},
  find_item_world: async(ctx,a)=>{const e=nearest(ctx.bot,e=>e.name==="item"&&(!a||entityName(e).includes(String(a).toLowerCase())),48);if(!e)throw new Error("Dropped item not found.");ctx.log("item at "+e.position);return true;},
  check_nearby: async(ctx)=>{ctx.log(Object.values(ctx.bot.entities||{}).filter(e=>e?.position&&e!==ctx.bot.entity&&distance(ctx.bot,e)<=16).map(entityName).join(", ")||"none");return true;},
  check_environment: async(ctx)=>{ctx.log("position="+ctx.bot.entity.position.x.toFixed(2)+" "+ctx.bot.entity.position.y.toFixed(2)+" "+ctx.bot.entity.position.z.toFixed(2)+" dimension="+ctx.bot.game?.dimension);return true;},
  detect_hostiles: async(ctx)=>{const h=Object.values(ctx.bot.entities||{}).filter(e=>e?.position&&HOSTILES.has(entityName(e))&&distance(ctx.bot,e)<=16);ctx.log(h.map(entityName).join(", ")||"none");return true;},
  check_health: async(ctx)=>{ctx.log(String(ctx.bot.health??0)+"/20");return true;},
  check_food: async(ctx)=>{ctx.log(String(ctx.bot.food??0)+"/20");return true;},
  check_equipment: async(ctx)=>{ctx.log("held="+(ctx.bot.heldItem?.name||"empty"));return true;},
  ask_permission: async(ctx,a)=>{const q=parts(a),u=required(q.shift(),"Username is required."),action=required(q.join(" "),"Action is required.");return ctx.runtime.askOwner?.(u,action,action)===true;},
  whisper_player: async(ctx,a)=>H.private_chat(ctx,a),
  remember_player: async(ctx,a)=>{const q=parts(a),u=required(q.shift(),"Username is required."),fact=required(q.join(" "),"Fact is required.");ctx.runtime.rememberPlayer?.(u,{facts:[fact]});return true;},
  report_result: async(ctx,a)=>{ctx.bot.chat(required(a,"Message is required.").slice(0,256));return true;},
  ask_clarification: async(ctx,a)=>H.private_chat(ctx,a),
  retrieve_item: async(ctx,a)=>{
    const name=required(a,"Item is required.").toLowerCase().replace(/\s+/g,"_");
    const type=ctx.bot.registry?.itemsByName?.[name]; if(!type) throw new Error("Unknown item: "+name);
    const blocks=Object.values(ctx.bot.findBlocks?.({matching:b=>CONTAINERS.has(String(b?.name||"")),maxDistance:32})||[]);
    for(const b of blocks){
      active(ctx);
      const ctn=await container(ctx,b.position);
      try{await ctn.withdraw(type.id,null,1);return true;}catch{}finally{try{await ctn.close();}catch{}}
    }
    throw new Error("Item not found in nearby containers: "+name);
  },
  deliver_item: async(ctx,a)=>H.give_item(ctx,a),
  escort_player: async(ctx,a)=>follow(ctx,player(ctx.bot,a)?.entity||(()=>{throw new Error("Player not found.");})(),3),
  protect_player: async(ctx,a)=>protect(ctx,a),
  guard_location: async(ctx,a)=>guard(ctx,coords(a)),
  build: async(ctx,a)=>build(ctx,a),
  search: async(ctx,a)=>{const e=nearest(ctx.bot,e=>!a||entityName(e).includes(String(a).toLowerCase()),48);if(!e)throw new Error("Search target not found.");await lookAtEntity(ctx,e);ctx.log(entityName(e));return true;},
  watch: async(ctx,a)=>{const s=required(a,"Watch target is required.");while(true){active(ctx);const e=player(ctx.bot,s)?.entity||nearest(ctx.bot,e=>entityName(e).includes(s.toLowerCase()),48);if(!e){ctx.terminate("target_lost");return false;}await lookAtEntity(ctx,e);await wait(ctx,250);}},
  coordinate_with_player: async(ctx,a)=>{const q=parts(a),u=required(q.shift(),"Username is required."),task=q.join(" ")||"ready";const p=player(ctx.bot,u);if(!p?.entity)throw new Error("Player not found.");await navigate(ctx,p.entity.position,3,30000,"coordinate");ctx.bot.whisper(u,"Ready: "+task);return true;},
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
  const {bot}=ctx; active(ctx);
  await navigate(ctx,p,3,20000,"guard post");
  await H.equip_best_weapon(ctx,"");
  while(true){
    active(ctx);
    const target=await nearestHostile(ctx,12);
    if(target){await H.equip_best_weapon(ctx,"");await attack(ctx,target,15000);continue;}
    if(bot.entity.position.distanceTo(vec(bot,p))>3){await navigate(ctx,p,3,20000,"guard post recovery");continue;}
    await wait(ctx,200);
  }
}
async function protect(ctx,a){
  const p=player(ctx.bot,a);if(!p?.entity)throw new Error("Player not found.");
  while(true){active(ctx);const live=player(ctx.bot,p.username)?.entity;if(!live){ctx.terminate("target_lost");return false;}
    const h=await nearestHostile(ctx,8);if(h&&distance(ctx.bot,h)<=8){await attack(ctx,h,15000);continue;}
    if(distance(ctx.bot,live)>5)await followOnce(ctx,live,5);else await wait(ctx,250);
  }
}
async function followOnce(ctx,t,r){return navigate(ctx,t.position,r,20000,"follow");}
async function give(ctx,a){
  const q=parts(a),name=required(q.shift(),"Item is required."),u=required(q.shift(),"Username is required."),p=player(ctx.bot,u)?.entity,i=inventoryItem(ctx.bot,name);
  if(!p)throw new Error("Player not found.");if(!i)throw new Error("Item not found.");await navigate(ctx,p.position,3,20000,"delivery");await ctx.bot.equip(i,"hand");await ctx.bot.tossStack(i);return true;
}
async function storage(ctx,a,deposit){
  const q=parts(a),name=required(q.shift(),"Item is required."),p=coords(q.splice(0,3).join(" ")),c=await container(ctx,p);
  try{
    const type=ctx.bot.registry.itemsByName[name.toLowerCase().replace(/\s+/g,"_")];if(!type)throw new Error("Unknown item: "+name);
    if(deposit){const n=countItem(ctx.bot,name);if(n<=0)throw new Error("Item not available.");await c.deposit(type.id,null,n,null);}
    else {const n=Math.max(1,Number(q[0])||1);await c.withdraw(type.id,null,n,null);}
    return true;
  }finally{try{await c.close();}catch{}}
}
async function smelt(ctx,a){
  const name=required(a,"Smelting input is required.").toLowerCase(),b=ctx.bot.findBlock({matching:x=>/furnace/.test(String(x?.name||"")),maxDistance:24});
  if(!b)throw new Error("No furnace nearby.");await navigate(ctx,b.position,3.5,30000,"furnace");
  const f=await ctx.bot.openFurnace(b);try{
    const input=inventoryItem(ctx.bot,name),fuel=inventoryItem(ctx.bot,"coal")||inventoryItem(ctx.bot,"charcoal")||inventoryItem(ctx.bot,"planks");
    if(!input)throw new Error("Smelting input not found.");if(!fuel)throw new Error("Fuel not found.");
    await f.putInput(input.type??input.id,null,Math.min(input.count,64));await f.putFuel(fuel.type??fuel.id,null,Math.min(fuel.count,8));await wait(ctx,1200);await f.takeOutput();return true;
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
  const m=required(a,"Build plan is required.").match(/^(pillar|tower|line)\s+(\S+)\s+(\d+)$/i);if(!m)throw new Error("Build plan: pillar|tower|line <block> <count>.");
  const kind=m[1].toLowerCase(),name=m[2],n=Math.max(1,Number(m[3])),base=ctx.bot.entity.position.floored();
  for(let i=0;i<n;i++){active(ctx);const p=kind==="line"?{x:base.x+i,y:base.y,z:base.z}:{x:base.x,y:base.y+i,z:base.z};const b=ctx.bot.blockAt(vec(ctx.bot,p));if(b?.name!=="air")continue;await placeAt(ctx,name,p);}return true;
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
