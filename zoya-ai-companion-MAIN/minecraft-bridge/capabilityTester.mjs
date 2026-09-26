import pathfinderPackage from "mineflayer-pathfinder";
import readline from "node:readline";

const { goals } = pathfinderPackage;

const CAPABILITIES = [
  ["follow_player","Follow Player","player username"],["roam","Roam",null],["pvp","PvP","player username"],
  ["hit","Hit","player username"],["gather_resources","Gather Resources",null],["do_task","Do Task","task description"],
  ["coordinate","Coordinate","player username (or blank for Zoya)"],["explore","Explore",null],["observe","Observe",null],
  ["return","Return","owner"],["investigate_entity","Investigate Entity","entity name"],["mine","Mine","block name (or blank)"],
  ["chop_tree","Chop Tree",null],["craft","Craft","item"],["eat","Eat","food (or blank)"],["collect","Collect","item (or blank)"],
  ["look_at_player","Look At Player","player username"],["go_to","Go To","x y z"],["look_at_coordinates","Look At Coordinates","x y z"],
  ["stop","Stop / Cancel",null],["wait","Wait","seconds"],["return_to_coordinates","Return To Coordinates","x y z"],
  ["sprint","Sprint","seconds"],["sneak","Sneak","seconds"],["jump","Jump",null],
  ["enter_exit_vehicle","Enter / Exit Vehicle",null],["attack_mob","Attack Mob","mob name"],["defend","Defend",null],
  ["guard","Guard","x y z"],["escape","Escape",null],["chase_target","Chase Target","player/entity name"],
  ["equip_best_weapon","Equip Best Weapon",null],["use_shield","Use Shield",null],["use_ranged_weapon","Use Ranged Weapon","target name"],
  ["dig","Dig","x y z (or blank for block below)"],["harvest_crops","Harvest Crops",null],["fish","Fish",null],
  ["hunt","Hunt Animals",null],["find_shelter","Find Shelter",null],["recover_after_death","Recover After Death",null],
  ["find_safe_location","Find Safe Location",null],["check_inventory","Check Inventory",null],["find_item","Find Item","item"],
  ["count_item","Count Item","item"],["equip_item","Equip Item","item"],["drop_item","Drop Item","item"],
  ["give_item","Give Item","item + player"],["take_item","Take Item","item"],["deposit","Deposit","item + chest/barrel coords"],
  ["retrieve","Retrieve","item + chest/barrel coords"],["sort_inventory","Sort Inventory",null],["smelt","Smelt","item"],
  ["craft_workbench","Craft With Workbench","item"],["craft_furnace","Craft With Furnace","item"],
  ["gather_missing_materials","Gather Missing Materials","item"],["multi_step_craft","Multi-Step Craft","item"],
  ["place_block","Place Block","block + x y z"],["break_block","Break Block","x y z"],
  ["open_chest","Open Chest","x y z"],["open_barrel","Open Barrel","x y z"],["open_door","Open Door","x y z"],
  ["close_door","Close Door","x y z"],["use_button","Use Button","x y z"],["use_lever","Use Lever","x y z"],
  ["use_block","Use Block","x y z"],["use_item","Use Item","item"],["sleep","Sleep",null],
  ["find_player","Find Player","player username"],["find_entity","Find Entity","entity name"],["find_item_world","Find Item In World","item"],
  ["check_nearby","Check Nearby Area",null],["check_environment","Check Environment",null],["detect_hostiles","Detect Hostiles",null],
  ["check_health","Check Health",null],["check_food","Check Food",null],["check_equipment","Check Equipment",null],
  ["ask_permission","Ask Permission","player + action"],["whisper_player","Whisper Player","player + message"],
  ["remember_player","Remember Player","player + fact"],["report_result","Report Result","message"],
  ["ask_clarification","Ask Clarification","player + question"],["retrieve_item","Retrieve Item","item"],
  ["deliver_item","Deliver Item","item + player"],["escort_player","Escort Player","player"],
  ["protect_player","Protect Player","player"],["guard_location","Guard Location","x y z"],["build","Build","plan"],
  ["search","Search For Something","target"],["watch","Watch","target"],["coordinate_with_player","Coordinate With Player","player + task"],
  ["op_command","Use OP Command","validated command"]
];

const DELEGATED = new Map([
  ["follow_player","follow_player"],["roam","safe_roam"],["pvp","pvp"],["gather_resources","gather_basic_resources"],
  ["explore","explore"],["return","return_to_owner"],["investigate_entity","investigate_entity"],["mine","mine"],
  ["chop_tree","chop_tree"],["craft","craft"],["eat","eat"],["collect","collect"],["look_at_player","look_at_player"]
]);

const HOSTILES = new Set(["zombie","husk","drowned","skeleton","stray","creeper","spider","cave_spider","witch","pillager","vindicator","evoker","ravager","phantom","blaze","magma_cube","silverfish","endermite","guardian","elder_guardian","piglin_brute","hoglin","zoglin"]);
const ANIMALS = new Set(["cow","pig","sheep","chicken","rabbit","horse","donkey","mule","llama","goat","mooshroom","strider","bee"]);
const CROPS = new Set(["wheat","carrots","potatoes","beetroots","nether_wart","cocoa","sweet_berry_bush"]);
const WEAPON_WORDS = ["sword","axe","trident","mace"];
const FOOD_WORDS = ["apple","bread","beef","porkchop","chicken","mutton","rabbit","potato","carrot","beetroot","cod","salmon","melon","stew","berries"];

function parseCoords(value) {
  const parts = String(value || "").trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) throw new Error("Expected coordinates as: x y z");
  return { x: parts[0], y: parts[1], z: parts[2] };
}
function parseCoordsFromEnd(value) {
  const m = String(value || "").trim().match(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/);
  if (!m) throw new Error("Expected x y z coordinates.");
  return { x:Number(m[1]), y:Number(m[2]), z:Number(m[3]), prefix:String(value).slice(0,m.index).trim() };
}
function dist(a,b) { return a && b ? a.distanceTo(b) : Infinity; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function findPlayer(bot,name) {
  const wanted=String(name||"").trim().toLowerCase();
  return Object.values(bot.players||{}).find(p=>String(p?.username||"").toLowerCase()===wanted) || null;
}
function findEntity(bot,name,predicate=()=>true) {
  const wanted=String(name||"").trim().toLowerCase();
  return Object.values(bot.entities||{}).filter(e=>e?.position && predicate(e) && (!wanted || String(e.username||e.name||e.displayName||"").toLowerCase().includes(wanted)))
    .sort((a,b)=>dist(a.position,bot.entity.position)-dist(b.position,bot.entity.position))[0] || null;
}
function inventoryCount(bot,name) {
  const wanted=String(name||"").trim().toLowerCase();
  return bot.inventory.items().filter(i=>i.name.toLowerCase().includes(wanted)).reduce((n,i)=>n+i.count,0);
}
function findInventoryItem(bot,name) {
  const wanted=String(name||"").trim().toLowerCase();
  return bot.inventory.items().find(i=>i.name.toLowerCase()===wanted) || bot.inventory.items().find(i=>i.name.toLowerCase().includes(wanted));
}
function nearestBlock(bot,names,max=24) {
  const wanted=Array.isArray(names)?names.map(x=>String(x).toLowerCase()):[String(names||"").toLowerCase()];
  const p=bot.entity.position;
  let best=null,bestD=max;
  const r=Math.ceil(max);
  for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++) for(let dz=-r;dz<=r;dz++) {
    const d=Math.sqrt(dx*dx+dy*dy+dz*dz); if(d>bestD) continue;
    const b=bot.blockAt(p.offset(dx,dy,dz));
    if(!b || b.name==="air") continue;
    if(!wanted.length || wanted.some(n=>b.name.toLowerCase().includes(n))) { best=b; bestD=d; }
  }
  return best;
}
async function goto(bot,x,y,z,r=1.5) {
  if(!goals?.GoalNear) throw new Error("GoalNear unavailable.");
  await bot.pathfinder.goto(new goals.GoalNear(x,y,z,r));
  return dist(bot.entity.position,{x,y,z})<=r+1.25;
}
async function equipMatching(bot,words,dest="hand") {
  const item=bot.inventory.items().find(i=>words.some(w=>i.name.toLowerCase().includes(w)));
  if(!item) return false;
  await bot.equip(item,dest); return true;
}
async function attackLoop(bot,target,timeout=15000) {
  const started=Date.now();
  while(target && target.isValid!==false && (target.health==null || target.health>0) && Date.now()-started<timeout) {
    if(dist(bot.entity.position,target.position)>3.2) await goto(bot,target.position.x,target.position.y,target.position.z,2.4);
    await bot.lookAt(target.position.offset(0,target.height||1,0),true);
    bot.attack(target); await sleep(450);
  }
  return !target || target.health==null || target.health<=0 || target.isValid===false;
}

async function directCapability({bot,runtime,id,arg,log}) {
  if(DELEGATED.has(id)) {
    if(["pvp","follow_player","look_at_player"].includes(id) && !arg) throw new Error("A player username is required.");
    return runtime.execute(DELEGATED.get(id),{targetUsername:arg,permissionGranted:true});
  }

  if(id==="hit") {
    const target=findPlayer(bot,arg)?.entity; if(!target) throw new Error("Player not found.");
    await bot.lookAt(target.position.offset(0,target.height||1.5,0),true); bot.attack(target); return true;
  }
  if(id==="go_to"||id==="return_to_coordinates") { const p=parseCoords(arg); log("[CAPABILITY] Target "+JSON.stringify(p)); return goto(bot,p.x,p.y,p.z); }
  if(id==="look_at_coordinates") { const p=parseCoords(arg); await bot.lookAt(p,true); return true; }
  if(id==="stop") { runtime.cancelCurrentTask("manual capability tester"); bot.pathfinder.setGoal(null); bot.clearControlStates(); return true; }
  if(id==="wait") { const n=Number(arg||1); if(!Number.isFinite(n)||n<0) throw new Error("Seconds must be a positive number."); await sleep(Math.min(n,300)*1000); return true; }
  if(["jump","sprint","sneak"].includes(id)) {
    const n=id==="jump"?0.15:Number(arg||1); if(!Number.isFinite(n)||n<0) throw new Error("Invalid duration.");
    const state=id==="jump"?"jump":id; bot.setControlState(state,true); await sleep(Math.min(n,id==="jump"?1:30)*1000); bot.setControlState(state,false); return true;
  }

  if(id==="enter_exit_vehicle") {
    if(bot.vehicle){ bot.dismount(); return true; }
    const v=findEntity(bot,"",e=>["boat","minecart","horse","donkey","mule","llama","pig","camel","strider"].includes(String(e.name||"").toLowerCase()));
    if(!v) throw new Error("No nearby rideable vehicle found.");
    await goto(bot,v.position.x,v.position.y,v.position.z,2.5); await bot.lookAt(v.position.offset(0,v.height||1,0),true); bot.mount(v); return true;
  }
  if(id==="attack_mob"||id==="hunt") {
    await equipMatching(bot,WEAPON_WORDS);
    const target=findEntity(bot,id==="hunt"?"":arg,e=>ANIMALS.has(String(e.name||"").toLowerCase()) && !HOSTILES.has(String(e.name||"").toLowerCase()));
    if(!target) throw new Error("Target mob not found.");
    return attackLoop(bot,target);
  }
  if(id==="defend") {
    await equipMatching(bot,WEAPON_WORDS); const target=findEntity(bot,"",e=>HOSTILES.has(String(e.name||"").toLowerCase())&&dist(e.position,bot.entity.position)<=16);
    if(!target) throw new Error("No hostile target nearby."); return attackLoop(bot,target);
  }
  if(id==="guard"||id==="guard_location") {
    const p=parseCoords(arg); log("[GUARD] Holding area at "+JSON.stringify(p));
    await goto(bot,p.x,p.y,p.z,2); for(let i=0;i<20;i++){ if(HOSTILES.size){ const h=findEntity(bot,"",e=>HOSTILES.has(String(e.name||"").toLowerCase())&&dist(e.position,bot.entity.position)<=12); if(h){await equipMatching(bot,WEAPON_WORDS); await attackLoop(bot,h,5000);} } await sleep(500); } return true;
  }
  if(id==="escape"||id==="find_safe_location") {
    const p=bot.entity.position; const candidates=[[16,0,0],[-16,0,0],[0,0,16],[0,0,-16],[10,0,10],[-10,0,-10]];
    const safe=candidates.map(([x,y,z])=>p.offset(x,y,z)).find(q=>!Object.values(bot.entities||{}).some(e=>e?.position&&HOSTILES.has(String(e.name||"").toLowerCase())&&dist(e.position,q)<10));
    if(!safe) throw new Error("No safe location found nearby.");
    await goto(bot,safe.x,safe.y,safe.z,2); return true;
  }
  if(id==="chase_target"||id==="escort_player"||id==="protect_player") {
    const pl=findPlayer(bot,arg); const target=pl?.entity||findEntity(bot,arg);
    if(!target) throw new Error("Target not found.");
    for(let i=0;i<20;i++){ if(target.isValid===false) break; if(dist(bot.entity.position,target.position)>3) await goto(bot,target.position.x,target.position.y,target.position.z,2.5); await sleep(300); }
    return true;
  }
  if(id==="equip_best_weapon") { return equipMatching(bot,WEAPON_WORDS); }
  if(id==="use_shield") {
    const shield=findInventoryItem(bot,"shield"); if(!shield) throw new Error("Shield not found.");
    await bot.equip(shield,"off-hand"); bot.setControlState("sneak",true); await sleep(2000); bot.setControlState("sneak",false); return true;
  }
  if(id==="use_ranged_weapon") {
    const target=findPlayer(bot,arg)?.entity||findEntity(bot,arg); if(!target) throw new Error("Target not found.");
    const ranged=findInventoryItem(bot,"bow")||findInventoryItem(bot,"crossbow")||findInventoryItem(bot,"trident");
    if(!ranged) throw new Error("No ranged weapon found.");
    await bot.equip(ranged,"hand"); await bot.lookAt(target.position.offset(0,target.height||1,0),true);
    if(ranged.name==="bow") { const arrow=findInventoryItem(bot,"arrow"); if(!arrow) throw new Error("No arrows."); await bot.activateItem(); await sleep(1200); bot.deactivateItem(); }
    else bot.activateItem();
    return true;
  }
  if(id==="dig"||id==="break_block") {
    const p=arg?parseCoords(arg):bot.entity.position.offset(0,-1,0); const block=bot.blockAt(p);
    if(!block||block.name==="air") throw new Error("No breakable block at target.");
    await goto(bot,block.position.x,block.position.y,block.position.z,3);
    await bot.dig(block); return true;
  }
  if(id==="harvest_crops") {
    const crop=nearestBlock(bot,[...CROPS],24); if(!crop) throw new Error("No crop found nearby.");
    await goto(bot,crop.position.x,crop.position.y,crop.position.z,3); await bot.dig(crop); return true;
  }
  if(id==="fish") { if(typeof bot.fish!=="function") throw new Error("Fishing API unavailable."); await bot.fish(); return true; }
  if(id==="find_shelter") {
    const p=bot.entity.position; const block=nearestBlock(bot,["stone","dirt","grass_block"],10);
    if(block) { const q=block.position.offset(0,1,0); await goto(bot,q.x,q.y,q.z,2); return true; }
    throw new Error("No nearby shelter material/location found.");
  }
  if(id==="recover_after_death") {
    if(bot.health<=0 && typeof bot.respawn==="function") bot.respawn();
    await sleep(2000); return bot.health>0;
  }

  if(id==="check_inventory"){ log("[INVENTORY] "+(bot.inventory.items().map(i=>i.name+" x"+i.count).join(", ")||"empty")); return true; }
  if(id==="find_item"||id==="count_item"){ const n=inventoryCount(bot,arg); log("[INVENTORY] "+arg+" = "+n); return true; }
  if(id==="equip_item"){ const i=findInventoryItem(bot,arg); if(!i) throw new Error("Item not found."); await bot.equip(i,"hand"); return true; }
  if(id==="drop_item"){ const i=findInventoryItem(bot,arg); if(!i) throw new Error("Item not found."); await bot.tossStack(i); return true; }
  if(id==="sort_inventory"){
    const items=bot.inventory.items().slice().sort((a,b)=>a.name.localeCompare(b.name)); log("[INVENTORY] Sorted view: "+items.map(i=>i.name+" x"+i.count).join(", ")); return true;
  }
  if(id==="give_item"||id==="deliver_item"){
    const parts=String(arg||"").trim().split(/\s+/); const player=findPlayer(bot,parts.pop())?.entity; const item=findInventoryItem(bot,parts.join(" "));
    if(!player||!item) throw new Error("Need an online player and an inventory item.");
    await goto(bot,player.position.x,player.position.y,player.position.z,2.5); await bot.tossStack(item); return true;
  }
  if(id==="take_item") { const item=findEntity(bot,arg,e=>e.name==="item"); if(!item) throw new Error("Dropped item not found."); await goto(bot,item.position.x,item.position.y,item.position.z,1.5); return true; }
  if(id==="collect") {
    const item=findEntity(bot,arg,e=>e.name==="item"); if(!item) throw new Error("Dropped item not found."); await goto(bot,item.position.x,item.position.y,item.position.z,1.5); return true;
  }
  if(id==="find_item_world"){ const item=findEntity(bot,arg,e=>e.name==="item" || e.displayName?.toLowerCase().includes(String(arg||"").toLowerCase())); if(!item) throw new Error("World item not found."); log("[WORLD ITEM] "+JSON.stringify(item.position)); return true; }

  if(id==="open_chest"||id==="open_barrel"){
    const p=parseCoords(arg), b=bot.blockAt(p); if(!b||!String(b.name).includes(id==="open_chest"?"chest":"barrel")) throw new Error("Target container not found.");
    await goto(bot,p.x,p.y,p.z,3); const c=await bot.openContainer(b); log("[CONTAINER] Opened "+b.name+" with "+(c.containerItems?.().length||0)+" items."); c.close(); return true;
  }
  if(id==="deposit"||id==="retrieve"){
    const {prefix,...p}=parseCoordsFromEnd(arg); const b=bot.blockAt(p); if(!b||!["chest","barrel","shulker_box"].some(n=>b.name.includes(n))) throw new Error("Container not found.");
    await goto(bot,p.x,p.y,p.z,3); const c=await bot.openContainer(b); const name=prefix.trim();
    if(id==="deposit"){ const item=findInventoryItem(bot,name); if(!item) throw new Error("Item not in inventory."); await c.deposit(item.type,null,item.count); }
    else { const slot=c.containerItems().find(i=>i.name.toLowerCase().includes(name.toLowerCase())); if(!slot) throw new Error("Item not in container."); await c.withdraw(slot.type,null,Math.min(slot.count,slot.stackSize||slot.count)); }
    c.close(); return true;
  }
  if(id==="smelt"||id==="craft_furnace"){
    const itemName=String(arg||"").trim().toLowerCase(); const furnace=nearestBlock(bot,["furnace","blast_furnace","smoker"],24); if(!furnace) throw new Error("Furnace not found.");
    await goto(bot,furnace.position.x,furnace.position.y,furnace.position.z,3); const f=await bot.openFurnace(furnace);
    const input=findInventoryItem(bot,itemName); if(!input) throw new Error("Smelt input not found.");
    const fuel=findInventoryItem(bot,"coal")||findInventoryItem(bot,"charcoal")||findInventoryItem(bot,"wood");
    if(!fuel) throw new Error("Fuel not found.");
    await f.putFuel(fuel.type,null,Math.min(fuel.count,8)); await f.putInput(input.type,null,Math.min(input.count,8)); await sleep(1000); f.close(); return true;
  }
  if(id==="craft"||id==="craft_workbench"||id==="multi_step_craft"||id==="do_task"||id==="gather_missing_materials"){
    const target=id==="do_task"?String(arg||"").toLowerCase():String(arg||"").toLowerCase();
    if(id==="do_task"){
      if(/follow/.test(target)){ const m=target.match(/follow\s+(\w+)/); if(!m) throw new Error("Specify player."); return directCapability({bot,runtime,id:"follow_player",arg:m[1],log}); }
      if(/(wood|log|stone|cobblestone|resource)/.test(target)) return runtime.execute("gather_basic_resources",{permissionGranted:true});
      if(/craft|make/.test(target)){ const m=target.match(/(?:craft|make)\s+(?:me\s+)?([a-z_ ]+)/); if(m) return directCapability({bot,runtime,id:"craft",arg:m[1].trim(),log}); }
      throw new Error("Do Task tester understands follow/gather/craft tasks; add a concrete task.");
    }
    if(id==="gather_missing_materials"){ return runtime.execute("gather_basic_resources",{permissionGranted:true}); }
    const recipeItem=bot.registry.itemsByName[target.replace(/ /g,"_")]||bot.registry.itemsByName[target];
    if(!recipeItem) throw new Error("Unknown craft item: "+target);
    const recipes=bot.recipesFor(recipeItem.id,null,1,null);
    if(!recipes.length) throw new Error("No available recipe for "+target);
    if(id==="craft_workbench"){ const table=nearestBlock(bot,"crafting_table",16); if(!table) throw new Error("Crafting table not found."); await goto(bot,table.position.x,table.position.y,table.position.z,3); }
    await bot.craft(recipes[0],1,null); return true;
  }

  if(id==="place_block"){
    const {prefix,...p}=parseCoordsFromEnd(arg); const item=findInventoryItem(bot,prefix); if(!item) throw new Error("Block item not found.");
    const ref=bot.blockAt(new (bot.entity.position.constructor)(p.x,p.y-1,p.z)); if(!ref||ref.name==="air") throw new Error("No solid reference block below target.");
    await goto(bot,p.x,p.y,p.z,3); await bot.equip(item,"hand"); await bot.placeBlock(ref,{x:0,y:1,z:0}); return true;
  }
  if(["open_door","close_door","use_button","use_lever","use_block"].includes(id)){
    const p=parseCoords(arg),b=bot.blockAt(p); if(!b) throw new Error("Block not found."); await goto(bot,p.x,p.y,p.z,3); await bot.lookAt(b.position.offset(.5,.5,.5),true);
    if(id==="close_door"&&b.name.includes("door")&&b.getProperties?.().open) { await bot.activateBlock(b); return true; }
    await bot.activateBlock(b); return true;
  }
  if(id==="use_item"){
    const i=findInventoryItem(bot,arg); if(!i) throw new Error("Item not found."); await bot.equip(i,"hand"); bot.activateItem(); await sleep(500); bot.deactivateItem(); return true;
  }
  if(id==="sleep"){
    const bed=findEntity(bot,"",e=>String(e.name||"").includes("bed"))||nearestBlock(bot,["bed"],16); if(!bed) throw new Error("No bed found nearby.");
    if(bed.position) await goto(bot,bed.position.x,bed.position.y,bed.position.z,3); await bot.sleep(bed); return true;
  }

  if(id==="find_player"){ const p=findPlayer(bot,arg); if(!p?.entity) throw new Error("Player not found nearby."); log("[PLAYER] "+p.username+" at "+JSON.stringify(p.entity.position)); return true; }
  if(id==="find_entity"||id==="investigate_entity"){ const e=findEntity(bot,arg); if(!e) throw new Error("Entity not found."); log("[ENTITY] "+(e.username||e.name)+" pos="+JSON.stringify(e.position)+" health="+(e.health??"unknown")); if(id==="investigate_entity") await bot.lookAt(e.position.offset(0,e.height||1,0),true); return true; }
  if(id==="check_nearby"){ Object.values(bot.entities||{}).filter(e=>e?.position&&e!==bot.entity).sort((a,b)=>dist(a.position,bot.entity.position)-dist(b.position,bot.entity.position)).slice(0,20).forEach(e=>log("[NEARBY] "+(e.username||e.name||e.type)+" distance="+dist(e.position,bot.entity.position).toFixed(2))); return true; }
  if(id==="check_environment"){ const p=bot.entity.position,b=bot.blockAt(p.offset(0,-1,0)),h=bot.blockAt(p.offset(0,1,0)); log("[ENV] pos="+p.x.toFixed(2)+","+p.y.toFixed(2)+","+p.z.toFixed(2)+" below="+(b?.name||"unknown")+" head="+(h?.name||"unknown")); return true; }
  if(id==="detect_hostiles"){ const h=Object.values(bot.entities||{}).filter(e=>e?.position&&HOSTILES.has(String(e.name||"").toLowerCase())&&dist(e.position,bot.entity.position)<=24); log("[SAFETY] Hostiles="+h.length); h.forEach(e=>log("[SAFETY] "+e.name+" "+dist(e.position,bot.entity.position).toFixed(2)+"m")); return true; }
  if(id==="check_health"){ log("[STATUS] Health="+bot.health); return true; }
  if(id==="check_food"){ log("[STATUS] Food="+bot.food+" saturation="+bot.foodSaturation); return true; }
  if(id==="check_equipment"){ log("[EQUIPMENT] "+JSON.stringify(bot.inventory.slots?.slice(5,9).filter(Boolean).map(i=>i.name)||[])); return true; }
  if(id==="coordinate"){
    const p=findPlayer(bot,arg)?.entity; const q=p?.position||bot.entity.position; log("[COORDINATES] "+(p?"Player":"Zoya")+" = X="+q.x.toFixed(2)+" Y="+q.y.toFixed(2)+" Z="+q.z.toFixed(2)); return true;
  }
  if(id==="observe"){ log("[OBSERVE] dimension="+bot.game?.dimension+" time="+bot.time?.time+" entities="+Object.keys(bot.entities||{}).length+" health="+bot.health+" food="+bot.food); return true; }

  if(["ask_permission","whisper_player","remember_player","report_result","ask_clarification"].includes(id)){
    if(id==="whisper_player"){ const m=String(arg||"").trim().split(/\s+/),p=findPlayer(bot,m.shift()); if(!p) throw new Error("Player not found."); bot.whisper(p.username,m.join(" ")); return true; }
    if(id==="report_result"){ bot.chat(String(arg||"")); return true; }
    if(id==="ask_clarification"){ const m=String(arg||"").trim().split(/\s+/),p=findPlayer(bot,m.shift()); if(!p) throw new Error("Player not found."); bot.whisper(p.username,"I need clarification: "+m.join(" ")); return true; }
    if(id==="remember_player"){ const m=String(arg||"").trim().split(/\s+/); const name=m.shift(); log("[MEMORY] Tester cannot write production memory directly; player="+name+" fact="+m.join(" ")); return true; }
    if(id==="ask_permission"){ log("[PERMISSION] Use the existing Minecraft permission/chat flow for this capability."); return true; }
  }

  if(id==="retrieve_item"){ return directCapability({bot,runtime,id:"collect",arg,log}); }
  if(id==="watch"){ const e=findEntity(bot,arg)||findPlayer(bot,arg)?.entity; if(!e) throw new Error("Watch target not found."); await bot.lookAt(e.position.offset(0,e.height||1,0),true); await sleep(5000); return true; }
  if(id==="search"){ const e=findEntity(bot,arg); if(e){log("[SEARCH] Found entity "+(e.username||e.name)+" at "+JSON.stringify(e.position));return true;} const b=nearestBlock(bot,arg,32); if(b){log("[SEARCH] Found block "+b.name+" at "+JSON.stringify(b.position));return true;} const i=findInventoryItem(bot,arg); if(i){log("[SEARCH] Found inventory item "+i.name+" x"+i.count);return true;} throw new Error("Target not found in nearby world/inventory."); }
  if(id==="build"){
    const s=String(arg||"").toLowerCase(), m=s.match(/(?:pillar|tower|line)\s+(\w+)\s+(\d+)/); if(!m) throw new Error("Build tester syntax: pillar <block> <count> or line <block> <count>.");
    const item=findInventoryItem(bot,m[1]); if(!item) throw new Error("Build block not in inventory."); let n=Math.min(32,Number(m[2])); await bot.equip(item,"hand");
    for(let i=0;i<n;i++){ const p=bot.entity.position.floored().offset(0,i+1,0); const ref=bot.blockAt(p.offset(0,-1,0)); if(!ref) break; await bot.placeBlock(ref,{x:0,y:1,z:0}); await sleep(100); } return true;
  }
  if(id==="coordinate_with_player"){ const m=String(arg||"").trim().split(/\s+/),p=findPlayer(bot,m.shift()); if(!p?.entity) throw new Error("Player not found."); bot.chat("I am at "+Math.round(bot.entity.position.x)+" "+Math.round(bot.entity.position.y)+" "+Math.round(bot.entity.position.z)+"; task: "+m.join(" ")); return true; }
  if(id==="op_command"){ const c=String(arg||"").trim(); if(!c.startsWith("/")) throw new Error("Enter a slash command."); if(Number(bot.game?.permissionLevel??-1)<2) throw new Error("Zoya is not reported as OP."); bot.chat(c); return true; }

  throw new Error("Capability is registered but has no implementation.");
}

export function startCapabilityTester({bot,runtime,log=console.log}) {
  if(!process.stdin.isTTY||!process.stdout.isTTY){ log("[CAPABILITY TESTER] Interactive terminal unavailable."); return ()=>{}; }
  let stopped=false;
  const rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:true});
  const ask=q=>new Promise(resolve=>rl.question(q,resolve));
  async function menu(){
    while(!stopped&&bot&&bot.entity){
      log(""); log("========================================"); log("       ZOYA CAPABILITY DEBUGGER"); log("========================================");
      CAPABILITIES.forEach(([id,label,args],i)=>log((i+1)+". "+label+(args?" -> {"+args+"}":"")));
      log("0. Exit capability tester");
      const answer=String(await ask("Choose a capability to run (0-"+CAPABILITIES.length+"): ")).trim();
      if(answer==="0") break;
      const index=Number(answer)-1;
      if(!Number.isInteger(index)||index<0||index>=CAPABILITIES.length){log("[CAPABILITY TESTER] Invalid selection.");continue;}
      const [id,label,args]=CAPABILITIES[index]; log("[CAPABILITY] "+label+" selected.");
      const arg=args?String(await ask("Enter "+args+": ")).trim():"";
      try{
        if(runtime?.getActiveTask?.()) runtime.cancelCurrentTask("manual capability tester");
        log("[CAPABILITY] Starting "+label+"..."); const started=Date.now();
        const result=await directCapability({bot,runtime,id,arg,log});
        log("[CAPABILITY] "+label+" -> "+(result===false?"FAILED":"SUCCESS")+" ("+(Date.now()-started)+" ms)");
      }catch(error){log("[CAPABILITY] "+label+" -> FAILED: "+(error instanceof Error?error.message:String(error)));}
    }
    rl.close(); log("[CAPABILITY TESTER] Exited. No capability is selected automatically.");
  }
  void menu();
  return ()=>{stopped=true;try{rl.close();}catch{}};
}
export function getCapabilityRegistry(){return CAPABILITIES.map(([id,label,args])=>({id,label,args}));}
