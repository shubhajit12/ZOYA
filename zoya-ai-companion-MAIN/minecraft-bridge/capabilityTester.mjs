import pathfinderPackage from "mineflayer-pathfinder";
import readline from "node:readline";

const { goals } = pathfinderPackage;

const CAPABILITIES = [
  { id: "follow_player", label: "Follow Player", usage: "follow_player {username}" },
  { id: "roam", label: "Roam", usage: "roam" },
  { id: "pvp", label: "PvP", usage: "pvp {username}" },
  { id: "hit", label: "Hit", usage: "hit {username}" },
  { id: "gather_resources", label: "Gather Resources", usage: "gather_resources {item} {amount}" },
  { id: "do_task", label: "Do Task", usage: "do_task {task}" },
  { id: "coordinate", label: "Coordinate", usage: "coordinate {username}" },
  { id: "explore", label: "Explore", usage: "explore" },
  { id: "observe", label: "Observe", usage: "observe" },
  { id: "return", label: "Return", usage: "return" },
  { id: "investigate_entity", label: "Investigate Entity", usage: "investigate_entity {name}" },
  { id: "mine", label: "Mine", usage: "mine {block}" },
  { id: "chop_tree", label: "Chop Tree", usage: "chop_tree" },
  { id: "craft", label: "Craft", usage: "craft {item} {amount}" },
  { id: "eat", label: "Eat", usage: "eat {item}" },
  { id: "collect", label: "Collect", usage: "collect {item} {amount}" },
  { id: "look_at_player", label: "Look At Player", usage: "look_at_player {username}" },
  { id: "chat", label: "Public Chat", usage: "chat {message}" },
  { id: "private_chat", label: "Private Chat", usage: "private_chat {username} {message}" },
  { id: "go_to", label: "Go To", usage: "go_to {x} {y} {z}" },
  { id: "look_at_coordinates", label: "Look At Coordinates", usage: "look_at_coordinates {x} {y} {z}" },
  { id: "stop", label: "Stop / Cancel", usage: "stop" },
  { id: "wait", label: "Wait", usage: "wait {seconds}" },
  { id: "return_to_coordinates", label: "Return To Coordinates", usage: "return_to_coordinates {x} {y} {z}" },
  { id: "sprint", label: "Sprint", usage: "sprint {seconds}" },
  { id: "sneak", label: "Sneak", usage: "sneak {seconds}" },
  { id: "jump", label: "Jump", usage: "jump" },
  { id: "enter_exit_vehicle", label: "Enter / Exit Vehicle", usage: "enter_exit_vehicle" },
  { id: "attack_mob", label: "Attack Mob", usage: "attack_mob {mob}" },
  { id: "defend", label: "Defend", usage: "defend" },
  { id: "guard", label: "Guard", usage: "guard {x} {y} {z}" },
  { id: "escape", label: "Escape", usage: "escape" },
  { id: "chase_target", label: "Chase Target", usage: "chase_target {target}" },
  { id: "equip_best_weapon", label: "Equip Best Weapon", usage: "equip_best_weapon" },
  { id: "use_shield", label: "Use Shield", usage: "use_shield" },
  { id: "use_ranged_weapon", label: "Use Ranged Weapon", usage: "use_ranged_weapon {target}" },
  { id: "dig", label: "Dig", usage: "dig {x} {y} {z}" },
  { id: "harvest_crops", label: "Harvest Crops", usage: "harvest_crops" },
  { id: "fish", label: "Fish", usage: "fish" },
  { id: "hunt", label: "Hunt Animals", usage: "hunt" },
  { id: "find_shelter", label: "Find Shelter", usage: "find_shelter" },
  { id: "recover_after_death", label: "Recover After Death", usage: "recover_after_death" },
  { id: "find_safe_location", label: "Find Safe Location", usage: "find_safe_location" },
  { id: "check_inventory", label: "Check Inventory", usage: "check_inventory" },
  { id: "find_item", label: "Find Item", usage: "find_item {item}" },
  { id: "count_item", label: "Count Item", usage: "count_item {item}" },
  { id: "equip_item", label: "Equip Item", usage: "equip_item {item}" },
  { id: "drop_item", label: "Drop Item", usage: "drop_item {item}" },
  { id: "give_item", label: "Give Item", usage: "give_item {item} {username}" },
  { id: "take_item", label: "Take Item", usage: "take_item {item}" },
  { id: "deposit", label: "Deposit", usage: "deposit {item} {x} {y} {z}" },
  { id: "retrieve", label: "Retrieve", usage: "retrieve {item} {x} {y} {z}" },
  { id: "sort_inventory", label: "Sort Inventory", usage: "sort_inventory" },
  { id: "smelt", label: "Smelt", usage: "smelt {item}" },
  { id: "craft_workbench", label: "Craft With Workbench", usage: "craft_workbench {item}" },
  { id: "craft_furnace", label: "Craft With Furnace", usage: "craft_furnace {item}" },
  { id: "gather_missing_materials", label: "Gather Missing Materials", usage: "gather_missing_materials {item}" },
  { id: "multi_step_craft", label: "Multi-Step Craft", usage: "multi_step_craft {item}" },
  { id: "place_block", label: "Place Block", usage: "place_block {block} {x} {y} {z}" },
  { id: "break_block", label: "Break Block", usage: "break_block {x} {y} {z}" },
  { id: "open_chest", label: "Open Chest", usage: "open_chest {x} {y} {z}" },
  { id: "open_barrel", label: "Open Barrel", usage: "open_barrel {x} {y} {z}" },
  { id: "open_door", label: "Open Door", usage: "open_door {x} {y} {z}" },
  { id: "close_door", label: "Close Door", usage: "close_door {x} {y} {z}" },
  { id: "use_button", label: "Use Button", usage: "use_button {x} {y} {z}" },
  { id: "use_lever", label: "Use Lever", usage: "use_lever {x} {y} {z}" },
  { id: "use_block", label: "Use Block", usage: "use_block {x} {y} {z}" },
  { id: "use_item", label: "Use Item", usage: "use_item {item}" },
  { id: "sleep", label: "Sleep", usage: "sleep" },
  { id: "find_player", label: "Find Player", usage: "find_player {username}" },
  { id: "find_entity", label: "Find Entity", usage: "find_entity {name}" },
  { id: "find_item_world", label: "Find Item In World", usage: "find_item_world {item}" },
  { id: "check_nearby", label: "Check Nearby Area", usage: "check_nearby" },
  { id: "check_environment", label: "Check Environment", usage: "check_environment" },
  { id: "detect_hostiles", label: "Detect Hostiles", usage: "detect_hostiles" },
  { id: "check_health", label: "Check Health", usage: "check_health" },
  { id: "check_food", label: "Check Food", usage: "check_food" },
  { id: "check_equipment", label: "Check Equipment", usage: "check_equipment" },
  { id: "ask_permission", label: "Ask Permission", usage: "ask_permission {username} {action}" },
  { id: "whisper_player", label: "Whisper Player", usage: "whisper_player {username} {message}" },
  { id: "remember_player", label: "Remember Player", usage: "remember_player {username} {fact}" },
  { id: "report_result", label: "Report Result", usage: "report_result {message}" },
  { id: "ask_clarification", label: "Ask Clarification", usage: "ask_clarification {username} {question}" },
  { id: "retrieve_item", label: "Retrieve Item", usage: "retrieve_item {item}" },
  { id: "deliver_item", label: "Deliver Item", usage: "deliver_item {item} {username}" },
  { id: "escort_player", label: "Escort Player", usage: "escort_player {username}" },
  { id: "protect_player", label: "Protect Player", usage: "protect_player {username}" },
  { id: "guard_location", label: "Guard Location", usage: "guard_location {x} {y} {z}" },
  { id: "build", label: "Build", usage: "build {plan}" },
  { id: "search", label: "Search For Something", usage: "search {target}" },
  { id: "watch", label: "Watch", usage: "watch {target}" },
  { id: "coordinate_with_player", label: "Coordinate With Player", usage: "coordinate_with_player {username} {task}" },
  { id: "op_command", label: "Use OP Command", usage: "op_command {command}" }
];

const DELEGATED = new Map([
  ["follow_player","follow_player"],["roam","safe_roam"],["pvp","pvp"],
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
function inventorySnapshot(bot) {
  const items = bot.inventory.items();
  const byName = new Map();
  for (const item of items) byName.set(item.name, (byName.get(item.name) || 0) + item.count);
  return {
    byName,
    held: bot.heldItem?.name || null,
    food: Number(bot.food ?? 20),
    health: Number(bot.health ?? 20),
    position: bot.entity?.position?.clone?.() || null,
    yaw: Number(bot.entity?.yaw ?? 0),
    pitch: Number(bot.entity?.pitch ?? 0),
    vehicle: bot.vehicle || null,
    slotOrder: items.filter(i=>i.slot>=9 && i.slot<=44).sort((a,b)=>a.slot-b.slot).map(i=>i.name)
  };
}
function inventoryDelta(before, after, name) {
  const wanted = String(name || "").toLowerCase();
  if (!wanted) return 0;
  let total = 0;
  for (const [n, count] of after.byName.entries()) {
    if (n.toLowerCase() === wanted || n.toLowerCase().includes(wanted)) total += count;
  }
  let old = 0;
  for (const [n, count] of before.byName.entries()) {
    if (n.toLowerCase() === wanted || n.toLowerCase().includes(wanted)) old += count;
  }
  return total - old;
}
function angleDelta(a,b) {
  let d=Math.abs(a-b)%(Math.PI*2);
  return d>Math.PI ? Math.PI*2-d : d;
}
function runtimeMemoryFactAvailable(bot,name,fact) {
  const key=String(name||"").trim().toLowerCase();
  const players=bot.__zoyaRuntimeMemoryPlayers;
  return Boolean(players?.[key]?.facts?.some(value=>String(value)===String(fact)));
}
async function verifyCapability({bot,id,arg,before,log,result,ask,runtime}) {
  if (result === false) return false;
  const after = inventorySnapshot(bot);
  const moved = before.position && after.position ? before.position.distanceTo(after.position) : 0;
  const turned = angleDelta(before.yaw,after.yaw) > 0.15 || Math.abs(before.pitch-after.pitch) > 0.15;
  const parts = String(arg || "").trim().split(/\s+/);
  const targetName = parts[0] || "";

  if (["go_to","return_to_coordinates"].includes(id)) {
    const p=parseCoords(arg);
    const remaining=after.position ? Math.hypot(after.position.x-p.x, after.position.y-p.y, after.position.z-p.z) : Infinity;
    if (remaining <= 3.0) return true;
    log("[VERIFY] " + id + " did not reach the requested coordinates; remaining distance=" + remaining.toFixed(2));
    return false;
  }

  if (["roam","explore","follow_player","return","investigate_entity","mine","chop_tree","escape","find_safe_location","chase_target","escort_player","protect_player","guard","guard_location","harvest_crops","hunt"].includes(id)) {
    if (moved >= 0.35) return true;
    const answer = ask ? String(await ask("[VERIFY] Did you visibly see Zoya perform the requested movement/world action? (y/n): ")).trim().toLowerCase() : "n";
    return answer === "y" || answer === "yes";
  }

  if (["collect","take_item","retrieve_item"].includes(id)) {
    if (after.byName.size > before.byName.size || [...after.byName.entries()].some(([name,count]) => count > (before.byName.get(name)||0))) return true;
    const answer = ask ? String(await ask("[VERIFY] Did Zoya visibly pick up the requested item? (y/n): ")).trim().toLowerCase() : "n";
    return answer === "y" || answer === "yes";
  }

  if (["dig","break_block"].includes(id)) {
    const p=parseCoords(arg), block=bot.blockAt(p);
    if (!block || block.name==="air") return true;
    const answer = ask ? String(await ask("[VERIFY] Did the target block visibly break? (y/n): ")).trim().toLowerCase() : "n";
    return answer === "y" || answer === "yes";
  }

  if (["attack_mob","defend","pvp","hit","use_ranged_weapon"].includes(id)) {
    // Movement toward a target is not proof of a hit. Combat is PASS only
    // when the target's health/entity state changed or the tester confirms
    // the visible hit.
    const target = findPlayer(bot, targetName)?.entity || findEntity(bot,targetName);
    if (target?.health != null && target.health <= 0) return true;
    const answer = ask ? String(await ask("[VERIFY] Did you visibly see the attack hit the target? (y/n): ")).trim().toLowerCase() : "n";
    return answer === "y" || answer === "yes";
  }

  if (["look_at_player","look_at_coordinates","watch","investigate_entity"].includes(id)) {
    if (turned) return true;
    log("[VERIFY] " + id + " did not produce a measurable camera rotation.");
    return false;
  }

  if (["chat","private_chat","whisper_player","report_result","ask_clarification","coordinate_with_player","coordinate"].includes(id)) {
    const answer = ask ? String(await ask("[VERIFY] Confirm the message was visible in Minecraft? (y/n): ")).trim().toLowerCase() : "n";
    if (answer === "y" || answer === "yes") return true;
    log("[VERIFY] Human confirmation was negative; capability marked FAIL.");
    return false;
  }

  if (["craft","craft_workbench","multi_step_craft","gather_missing_materials"].includes(id)) {
    const requested = parts.slice(0,-1).join("_") || parts[0] || "";
    if (requested && inventoryDelta(before,after,requested) > 0) return true;
    log("[VERIFY] " + id + " did not increase the requested inventory item.");
    return false;
  }
  if (id==="do_task") {
    const answer=ask ? String(await ask("[VERIFY] Did the requested task visibly complete in Minecraft? (y/n): ")).trim().toLowerCase() : "n";
    return answer==="y" || answer==="yes";
  }

  if (["eat"].includes(id)) {
    if (after.food > before.food) return true;
    log("[VERIFY] eat did not increase hunger.");
    return false;
  }

  if (["equip_item","equip_best_weapon"].includes(id)) {
    if (after.held && after.held !== before.held) return true;
    log("[VERIFY] equip did not change the held item.");
    return false;
  }

  if (["drop_item","give_item","deliver_item"].includes(id)) {
    if (inventoryDelta(before,after,targetName) < 0) return true;
    log("[VERIFY] " + id + " did not reduce the source inventory item.");
    return false;
  }

  if (id==="enter_exit_vehicle") {
    if (Boolean(before.vehicle) !== Boolean(after.vehicle)) return true;
    log("[VERIFY] vehicle state did not change.");
    return false;
  }

  if (["jump","sprint"].includes(id)) {
    if (moved >= 0.1 || id==="jump" && !bot.entity.onGround) return true;
    log("[VERIFY] " + id + " produced no observable movement/state change.");
    return false;
  }

  if (id==="sneak") {
    const sneaking = bot.entity?.metadata?.some?.(v => v === 0 || v === true);
    if (moved >= 0.1 || sneaking) return true;
    const answer=ask ? String(await ask("[VERIFY] Did Zoya visibly crouch/sneak? (y/n): ")).trim().toLowerCase() : "n";
    return answer==="y" || answer==="yes";
  }

  if (id==="stop") {
    const answer=ask ? String(await ask("[VERIFY] Did Zoya visibly stop moving immediately? (y/n): ")).trim().toLowerCase() : "n";
    return answer==="y" || answer==="yes";
  }
  if (id==="wait") return true;
  if (id==="find_shelter") {
    if (moved >= 0.35) return true;
    const answer=ask ? String(await ask("[VERIFY] Did Zoya visibly move to the selected shelter location? (y/n): ")).trim().toLowerCase() : "n";
    return answer==="y" || answer==="yes";
  }
  if (id==="recover_after_death") {
    if (Number(bot.health??0)>0) return true;
    return false;
  }
  if (id==="fish") {
    const answer=ask ? String(await ask("[VERIFY] Did Zoya visibly perform the fishing action and get a catch? (y/n): ")).trim().toLowerCase() : "n";
    return answer==="y" || answer==="yes";
  }

  if (["check_inventory","find_item","count_item","find_item_world","find_player","find_entity","check_nearby","check_environment","detect_hostiles","check_health","check_food","check_equipment","observe","search"].includes(id)) return true;

  if (["open_chest","open_barrel"].includes(id)) {
    const answer = ask ? String(await ask("[VERIFY] Confirm the container opened in Minecraft? (y/n): ")).trim().toLowerCase() : "n";
    return answer === "y" || answer === "yes";
  }
  if (["deposit","retrieve"].includes(id)) {
    if (inventoryDelta(before,after,targetName) !== 0) return true;
    const answer = ask ? String(await ask("[VERIFY] Confirm the requested container inventory change is visible? (y/n): ")).trim().toLowerCase() : "n";
    return answer === "y" || answer === "yes";
  }
  if (id==="smelt") {
    const requested = String(arg || "").trim().toLowerCase();
    if (requested && inventoryDelta(before, after, requested) < 0) {
      // The input is expected to decrease, while the output is checked by
      // the action itself. A visible confirmation remains required because
      // the output name is not necessarily derivable from the input string.
    }
    const answer=ask ? String(await ask("[VERIFY] Confirm the furnace produced and collected the requested output? (y/n): ")).trim().toLowerCase() : "n";
    return answer==="y" || answer==="yes";
  }
  if (id==="craft_furnace") {
    if (inventoryDelta(before,after,"furnace") > 0) return true;
    log("[VERIFY] craft_furnace did not add a furnace to inventory.");
    return false;
  }

  if (id==="place_block") {
    const {prefix,...p}=parseCoordsFromEnd(arg);
    const block=bot.blockAt(p);
    if (block && block.name.toLowerCase().includes(prefix.trim().toLowerCase().replace(/ /g,"_"))) return true;
    const answer=ask ? String(await ask("[VERIFY] Did the requested block visibly appear at the target location? (y/n): ")).trim().toLowerCase() : "n";
    return answer==="y" || answer==="yes";
  }

  if (id==="build") {
    const m=String(arg||"").toLowerCase().match(/(?:pillar|tower|line)\s+(\w+)\s+(\d+)/);
    if(m && inventoryDelta(before,after,m[1])<0) return true;
    const answer=ask ? String(await ask("[VERIFY] Did the requested build visibly appear in Minecraft? (y/n): ")).trim().toLowerCase() : "n";
    return answer==="y" || answer==="yes";
  }

  if (id==="open_door" || id==="close_door") {
    const p=parseCoords(arg), block=bot.blockAt(p), open=block?.getProperties?.().open;
    const expected=id==="open_door";
    if (open===expected) return true;
    const answer=ask ? String(await ask("[VERIFY] Did the door visibly " + (expected?"open":"close") + "? (y/n): ")).trim().toLowerCase() : "n";
    return answer==="y" || answer==="yes";
  }

  if (id==="sleep") {
    if (bot.isSleeping===true) return true;
    const answer=ask ? String(await ask("[VERIFY] Did Zoya visibly enter the bed/sleep state? (y/n): ")).trim().toLowerCase() : "n";
    return answer==="y" || answer==="yes";
  }

  if (["use_button","use_lever","use_block","use_item","use_shield","use_ranged_weapon"].includes(id)) {
    const answer = ask ? String(await ask("[VERIFY] Confirm the requested Minecraft action visibly happened? (y/n): ")).trim().toLowerCase() : "n";
    return answer === "y" || answer === "yes";
  }

  if (id==="remember_player") {
    const m=String(arg||"").trim().split(/\s+/), name=m.shift(), fact=m.join(" ").trim();
    const saved=runtimeMemoryFactAvailable(bot,name,fact);
    if (saved) return true;
    log("[VERIFY] remember_player did not persist the requested fact.");
    return false;
  }
  if (id==="ask_permission") {
    const answer = ask ? String(await ask("[VERIFY] Confirm the permission request was visibly delivered to the owner? (y/n): ")).trim().toLowerCase() : "n";
    return answer === "y" || answer === "yes";
  }
  if (id==="op_command") {
    const answer = ask ? String(await ask("[VERIFY] Confirm the OP command produced the intended visible server result? (y/n): ")).trim().toLowerCase() : "n";
    return answer === "y" || answer === "yes";
  }
  if (id==="sort_inventory") {
    const order=after.slotOrder || [];
    const sorted=order.every((name,i)=>i===0 || String(order[i-1]).localeCompare(String(name))<=0);
    if (sorted) return true;
    log("[VERIFY] Inventory slot order is not sorted.");
    return false;
  }

  return false;
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
  if(id==="gather_resources") {
    const parts=String(arg||"").trim().split(/\s+/);
    const resourceName=parts[0] || "oak_log";
    const amount=Math.max(1, Math.floor(Number(parts[1]) || 1));
    log("[GATHER] Requested resource=" + resourceName + " amount=" + amount);
    return runtime.execute("gather_basic_resources",{resourceName,amount,permissionGranted:true});
  }

  if(DELEGATED.has(id)) {
    if(["pvp","follow_player","look_at_player"].includes(id) && !arg) throw new Error("A player username is required.");
    if (["follow_player","pvp"].includes(id)) {
      const target=String(arg||"").trim();
      if(!target) throw new Error("A player username is required.");
      log("[CAPABILITY] "+id+" will run for 15 seconds in the manual tester.");
      const run=runtime.execute(DELEGATED.get(id),{targetUsername:target,permissionGranted:true});
      let timedOut=false;
      const timeout=sleep(15000).then(()=>{ timedOut=true; return "__CAPABILITY_TIMEOUT__"; });
      const result=await Promise.race([run,timeout]);
      if (result === "__CAPABILITY_TIMEOUT__") {
        if(runtime.getActiveTask?.()) runtime.cancelCurrentTask("manual capability test duration complete");
        log("[CAPABILITY] "+id+" remained active for the full 15-second test window.");
        return true;
      }
      if (result !== true) {
        log("[CAPABILITY] "+id+" FAILED before the 15-second window completed. Check target/player availability and runtime logs.");
        return false;
      }
      return true;
    }
    const options={permissionGranted:true};
    if (id==="mine") options.blockName=String(arg||"").trim();
    if (id==="eat") options.itemName=String(arg||"").trim();
    if (id==="collect") {
      const parts=String(arg||"").trim().split(/\s+/);
      options.itemName=parts[0] || "";
      options.amount=Math.max(1,Math.floor(Number(parts[1])||1));
    }
    if (id==="investigate_entity") options.entityName=String(arg||"").trim();
    if (id==="craft") {
      const parts=String(arg||"").trim().split(/\s+/);
      options.itemName=parts.slice(0,-1).join("_") || parts[0] || "";
      options.amount=Math.max(1,Math.floor(Number(parts.at(-1))||1));
    }
    if (["follow_player","pvp","look_at_player"].includes(id)) options.targetUsername=String(arg||"").trim();
    const result=await runtime.execute(DELEGATED.get(id),options);
    return result === true;
  }

  if(id==="hit") {
    const target=findPlayer(bot,arg)?.entity; if(!target) throw new Error("Player not found.");
    await bot.lookAt(target.position.offset(0,target.height||1.5,0),true); bot.attack(target); return true;
  }
  if(id==="chat") {
    const message=String(arg||"").trim();
    if(!message) throw new Error("Message is required.");
    bot.chat(message.slice(0,256));
    log("[CHAT] Public chat sent: " + message.slice(0,256));
    return true;
  }
  if(id==="private_chat") {
    const parts=String(arg||"").trim().split(/\s+/);
    const username=parts.shift();
    const message=parts.join(" ").trim();
    if(!username) throw new Error("Username is required.");
    if(!message) throw new Error("Message is required.");
    const target=findPlayer(bot,username);
    if(!target?.username) throw new Error("Player not found.");
    bot.whisper(target.username,message.slice(0,256));
    log("[CHAT] Private chat sent to " + target.username + ": " + message.slice(0,256));
    return true;
  }
  if(id==="go_to"||id==="return_to_coordinates") { const p=parseCoords(arg); log("[CAPABILITY] Target "+JSON.stringify(p)); return goto(bot,p.x,p.y,p.z); }
  if(id==="look_at_coordinates") { const p=parseCoords(arg); await bot.lookAt(p,true); return true; }
  if(id==="stop") { runtime.cancelCurrentTask("manual capability tester"); bot.pathfinder.setGoal(null); bot.clearControlStates(); return true; }
  if(id==="wait") { const n=Number(arg||1); if(!Number.isFinite(n)||n<0) throw new Error("Seconds must be a positive number."); await sleep(Math.min(n,300)*1000); return true; }
  if(["jump","sprint","sneak"].includes(id)) {
    const n=id==="jump"?0.35:Number(arg||1); if(!Number.isFinite(n)||n<0) throw new Error("Invalid duration.");
    const state=id==="jump"?"jump":id;
    bot.setControlState(state,true);
    if(id!=="jump") bot.setControlState("forward",true);
    await sleep(Math.min(n,id==="jump"?1:30)*1000);
    bot.setControlState(state,false);
    if(id!=="jump") bot.setControlState("forward",false);
    return true;
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
    await bot.equip(shield,"off-hand");
    // Mineflayer uses activateItem(true) for the off-hand; calling the
    // default main-hand activation does not actually raise the shield.
    bot.activateItem(true);
    await sleep(2000);
    bot.deactivateItem();
    return true;
  }
  if(id==="use_ranged_weapon") {
    const target=findPlayer(bot,arg)?.entity||findEntity(bot,arg); if(!target) throw new Error("Target not found.");
    const ranged=findInventoryItem(bot,"bow")||findInventoryItem(bot,"crossbow")||findInventoryItem(bot,"trident");
    if(!ranged) throw new Error("No ranged weapon found.");
    await bot.equip(ranged,"hand");
    await bot.lookAt(target.position.offset(0,target.height||1,0),true);
    if(ranged.name==="bow") {
      const arrow=findInventoryItem(bot,"arrow"); if(!arrow) throw new Error("No arrows.");
      bot.activateItem();
      await sleep(1200);
      bot.deactivateItem();
    } else if(ranged.name==="crossbow") {
      bot.activateItem();
      await sleep(1200);
      bot.deactivateItem();
      await sleep(150);
      bot.activateItem();
      await sleep(150);
      bot.deactivateItem();
    } else {
      bot.activateItem();
      await sleep(600);
      bot.deactivateItem();
    }
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
    if(typeof bot.moveSlotItem!=="function") throw new Error("Mineflayer inventory moveSlotItem API is unavailable.");
    const slots=bot.inventory.items().filter(i=>i.slot>=9&&i.slot<=44).sort((a,b)=>a.slot-b.slot);
    if(slots.length<2) return true;
    const empty=[];
    for(let slot=9;slot<=44;slot++) if(!bot.inventory.slots?.[slot]) empty.push(slot);
    if(!empty.length) throw new Error("Inventory is full; safe slot-by-slot sorting requires at least one empty storage slot.");
    const temp=empty[0];
    const targets=slots.map(i=>({slot:i.slot,name:i.name,count:i.count})).sort((a,b)=>a.name.localeCompare(b.name)||a.count-b.count);
    for(let index=0;index<targets.length;index++){
      const dest=slots[index].slot;
      const desired=targets[index];
      const current=bot.inventory.slots?.[dest];
      if(current?.name===desired.name && current.count===desired.count) continue;
      const source=slots.find(i=>bot.inventory.slots?.[i.slot]?.name===desired.name && bot.inventory.slots?.[i.slot]?.count===desired.count && i.slot!==dest)?.slot;
      if(source==null) continue;
      await bot.moveSlotItem(source,temp);
      const displaced=bot.inventory.slots?.[dest];
      if(displaced) await bot.moveSlotItem(dest,source);
      await bot.moveSlotItem(temp,dest);
    }
    return true;
  }
  if(id==="give_item"||id==="deliver_item"){
    const parts=String(arg||"").trim().split(/\s+/); const player=findPlayer(bot,parts.pop())?.entity; const item=findInventoryItem(bot,parts.join(" "));
    if(!player||!item) throw new Error("Need an online player and an inventory item.");
    await goto(bot,player.position.x,player.position.y,player.position.z,2.5); await bot.tossStack(item); return true;
  }
  if(id==="take_item" || id==="collect") {
    const item=findEntity(bot,arg,e=>e.name==="item");
    if(!item) throw new Error("Dropped item not found.");
    if(typeof bot.collectBlock?.collect !== "function") throw new Error("Mineflayer collect-block item API is unavailable.");
    const before = inventorySnapshot(bot);
    await bot.collectBlock.collect(item);
    const after = inventorySnapshot(bot);
    const requested = String(arg || "").trim();
    if (requested && inventoryDelta(before, after, requested) <= 0) {
      throw new Error("Reached the dropped item but did not confirm the requested inventory increase.");
    }
    if (!requested && after.byName.size <= before.byName.size &&
        ![...after.byName.entries()].some(([name,count])=>count>(before.byName.get(name)||0))) {
      throw new Error("Dropped item was not confirmed as collected.");
    }
    return true;
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
  if(id==="smelt"){
    const itemName=String(arg||"").trim().toLowerCase();
    const furnace=nearestBlock(bot,["furnace","blast_furnace","smoker"],24);
    if(!furnace) throw new Error("Furnace not found.");
    await goto(bot,furnace.position.x,furnace.position.y,furnace.position.z,3);
    const f=await bot.openFurnace(furnace);
    const input=findInventoryItem(bot,itemName); if(!input) { await f.close(); throw new Error("Smelt input not found."); }
    const fuel=findInventoryItem(bot,"coal")||findInventoryItem(bot,"charcoal")||findInventoryItem(bot,"wood");
    if(!fuel) { await f.close(); throw new Error("Fuel not found."); }

    // Clear an old output first so this run can prove it produced a fresh one.
    if (f.outputItem?.()) await f.takeOutput();

    const before=inventorySnapshot(bot);
    await f.putFuel(fuel.type,null,Math.min(fuel.count,8));
    await f.putInput(input.type,null,Math.min(input.count,8));

    const deadline=Date.now()+30000;
    while(!f.outputItem?.() && Date.now()<deadline) await sleep(500);
    if(!f.outputItem?.()) { await f.close(); throw new Error("Furnace did not produce output within 30 seconds."); }

    await f.takeOutput();
    await f.close();
    const after=inventorySnapshot(bot);
    const totalBefore=[...before.byName.values()].reduce((n,c)=>n+c,0);
    const totalAfter=[...after.byName.values()].reduce((n,c)=>n+c,0);
    if(totalAfter<=totalBefore) throw new Error("Furnace output was not collected into inventory.");
    return true;
  }
  if(id==="craft_furnace"){
    const furnaceItem=bot.registry.itemsByName.furnace;
    if(!furnaceItem) throw new Error("Furnace item is unavailable in this Minecraft version.");
    const before=inventoryCount(bot,"furnace");
    const recipes=bot.recipesFor(furnaceItem.id,null,1,null);
    if(!recipes.length) throw new Error("No furnace recipe available.");
    const table=nearestBlock(bot,"crafting_table",16);
    if(!table) throw new Error("Crafting table not found; furnace crafting requires a table.");
    await goto(bot,table.position.x,table.position.y,table.position.z,3);
    await bot.craft(recipes[0],1,table);
    return inventoryCount(bot,"furnace")>=before+1;
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
    let craftingTable=null;
    if(id==="craft_workbench" || recipes[0].requiresTable) {
      craftingTable=nearestBlock(bot,"crafting_table",16);
      if(!craftingTable) throw new Error("Crafting table not found.");
      await goto(bot,craftingTable.position.x,craftingTable.position.y,craftingTable.position.z,3);
    }
    await bot.craft(recipes[0],1,craftingTable);
    return true;
  }

  if(id==="place_block"){
    const {prefix,...p}=parseCoordsFromEnd(arg); const item=findInventoryItem(bot,prefix); if(!item) throw new Error("Block item not found.");
    const ref=bot.blockAt(new (bot.entity.position.constructor)(p.x,p.y-1,p.z)); if(!ref||ref.name==="air") throw new Error("No solid reference block below target.");
    await goto(bot,p.x,p.y,p.z,3); await bot.equip(item,"hand"); await bot.placeBlock(ref,{x:0,y:1,z:0}); return true;
  }
  if(["open_door","close_door","use_button","use_lever","use_block"].includes(id)){
    const p=parseCoords(arg),b=bot.blockAt(p); if(!b) throw new Error("Block not found."); await goto(bot,p.x,p.y,p.z,3); await bot.lookAt(b.position.offset(.5,.5,.5),true);
    if((id==="open_door"||id==="close_door") && !b.name.includes("door")) throw new Error("Target is not a door.");
    if(id==="open_door" && b.getProperties?.().open===true) return true;
    if(id==="close_door" && b.getProperties?.().open===false) return true;
    await bot.activateBlock(b);
    return true;
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
    if(id==="remember_player"){
      const m=String(arg||"").trim().split(/\s+/); const name=m.shift(); const fact=m.join(" ").trim();
      if(!name||!fact) throw new Error("Usage: remember_player <username> <fact>");
      if(typeof runtime?.rememberPlayer!=="function") throw new Error("Runtime memory API unavailable.");
      const key=name.toLowerCase();
      const existing=runtime.memory?.players?.[key] || {};
      const facts=Array.isArray(existing.facts)?existing.facts.slice():[];
      if(!facts.includes(fact)) facts.push(fact);
      runtime.rememberPlayer(name,{facts});
      log("[MEMORY] Remembered fact for "+name+": "+fact);
      return true;
    }
    if(id==="ask_permission"){
      const m=String(arg||"").trim().split(/\s+/); const name=m.shift(); const action=m.join(" ").trim();
      if(!name||!action) throw new Error("Usage: ask_permission <username> <action>");
      if(typeof runtime?.askOwner!=="function") throw new Error("Permission API unavailable.");
      return runtime.askOwner(name,action,action);
    }
  }

  if(id==="retrieve_item"){ return directCapability({bot,runtime,id:"collect",arg,log}); }
  if(id==="watch"){ const e=findEntity(bot,arg)||findPlayer(bot,arg)?.entity; if(!e) throw new Error("Watch target not found."); await bot.lookAt(e.position.offset(0,e.height||1,0),true); await sleep(5000); return true; }
  if(id==="search"){ const e=findEntity(bot,arg); if(e){log("[SEARCH] Found entity "+(e.username||e.name)+" at "+JSON.stringify(e.position));return true;} const b=nearestBlock(bot,arg,32); if(b){log("[SEARCH] Found block "+b.name+" at "+JSON.stringify(b.position));return true;} const i=findInventoryItem(bot,arg); if(i){log("[SEARCH] Found inventory item "+i.name+" x"+i.count);return true;} throw new Error("Target not found in nearby world/inventory."); }
  if(id==="build"){
    const s=String(arg||"").toLowerCase(), m=s.match(/(pillar|tower|line)\s+(\w+)\s+(\d+)/);
    if(!m) throw new Error("Build tester syntax: pillar <block> <count> or line <block> <count>.");
    const item=findInventoryItem(bot,m[2]); if(!item) throw new Error("Build block not in inventory.");
    const n=Math.min(32,Math.max(1,Number(m[3]))); await bot.equip(item,"hand");
    let placed=0;
    for(let i=0;i<n;i++){
      const base=bot.entity.position.floored();
      const p=m[1]==="line" ? base.offset(i+1,0,0) : base.offset(0,i+1,0);
      const ref=bot.blockAt(p.offset(0,-1,0));
      if(!ref || ref.name==="air") break;
      try { await bot.placeBlock(ref,{x:0,y:1,z:0}); placed++; } catch { break; }
      await sleep(100);
    }
    if(placed<1) throw new Error("No blocks were placed.");
    return true;
  }
  if(id==="coordinate_with_player"){ const m=String(arg||"").trim().split(/\s+/),p=findPlayer(bot,m.shift()); if(!p?.entity) throw new Error("Player not found."); bot.chat("I am at "+Math.round(bot.entity.position.x)+" "+Math.round(bot.entity.position.y)+" "+Math.round(bot.entity.position.z)+"; task: "+m.join(" ")); return true; }
  if(id==="op_command"){ const c=String(arg||"").trim(); if(!c.startsWith("/")) throw new Error("Enter a slash command."); if(Number(bot.game?.permissionLevel??-1)<2) throw new Error("Zoya is not reported as OP."); bot.chat(c); return true; }

  throw new Error("Capability is registered but has no implementation.");
}

export function startCapabilityTester({bot,runtime,log=console.log}) {
  log("[CAPABILITY TESTER] Local-only mode: no Groq calls are made.");
  const preflight = [
    ["bot.entity", !!bot?.entity],
    ["bot.pathfinder.goto", typeof bot?.pathfinder?.goto === "function"],
    ["bot.lookAt", typeof bot?.lookAt === "function"],
    ["bot.setControlState", typeof bot?.setControlState === "function"],
    ["bot.chat", typeof bot?.chat === "function"],
    ["runtime.execute", typeof runtime?.execute === "function"],
    ["runtime.cancelCurrentTask", typeof runtime?.cancelCurrentTask === "function"]
  ];
  const failed = preflight.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) {
    log("[CAPABILITY TESTER] PREFLIGHT FAIL: " + failed.join(", "));
    return ()=>{};
  }
  log("[CAPABILITY TESTER] PREFLIGHT PASS: required Mineflayer/runtime APIs are available.");
  log("[CAPABILITY TESTER] IMPORTANT: API availability is not a capability PASS; every action is post-verified.");
  if(!process.stdin.isTTY||!process.stdout.isTTY){ log("[CAPABILITY TESTER] Interactive terminal unavailable."); return ()=>{}; }
  let stopped=false;
  const rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:true});
  const ask=q=>new Promise(resolve=>rl.question(q,resolve));

  async function menu(){
    let menuShown = false;
    while(!stopped&&bot&&bot.entity){
      if (!menuShown) {
        log("");
        log("========================================");
        log("       ZOYA CAPABILITY DEBUGGER");
        log("========================================");
        log("Groq: DISABLED | Manual mode execution: ENABLED");
        log("Registered modes: " + CAPABILITIES.length);
        CAPABILITIES.forEach((cap,i)=>log(String(i+1).padStart(2," ") + ". " + cap.label));
        log("0. Exit capability tester");
        menuShown = true;
      }

      const answer=String(await ask("Choose a capability (0-"+CAPABILITIES.length+"): ")).trim();
      if(answer==="0") break;

      const index=Number(answer)-1;
      if(!Number.isInteger(index)||index<0||index>=CAPABILITIES.length){
        log("[CAPABILITY TESTER] Invalid selection.");
        continue;
      }

      const cap=CAPABILITIES[index];
      log("");
      log("[CAPABILITY] " + cap.label + " selected.");
      log("Usage: " + cap.usage);

      const arg=String(await ask("Enter arguments: ")).trim();

      try{
        if(runtime?.getActiveTask?.()) {
          runtime.cancelCurrentTask("manual capability tester");
          const idle = await runtime.waitForTaskIdle?.(5000);
          if (idle === false) throw new Error("Previous task did not finish cancellation within 5 seconds.");
        }
        log("[CAPABILITY] Mode: " + cap.id);
        log("[CAPABILITY] Status: RUNNING");
        const started=Date.now();
        const before=inventorySnapshot(bot);
        const result=await directCapability({bot,runtime,id:cap.id,arg,log});
        if (cap.id==="remember_player" && runtime?.memory?.players) bot.__zoyaRuntimeMemoryPlayers=runtime.memory.players;
        const verified=await verifyCapability({bot,id:cap.id,arg,before,log,result,ask,runtime});
        const status=verified?"PASS":"FAIL";
        log("[CAPABILITY] Mode: " + cap.id + " | Status: " + status + " | Duration: " + (Date.now()-started) + " ms");
      }catch(error){
        log("[CAPABILITY] Mode: " + cap.id + " | Status: FAIL | Error: " + (error instanceof Error?error.message:String(error)));
      }
    }
    rl.close();
    log("[CAPABILITY TESTER] Exited. No capability is selected automatically.");
  }

  void menu();
  return ()=>{stopped=true;try{rl.close();}catch{}};
}
export function getCapabilityRegistry(){return CAPABILITIES.map(cap=>({...cap}));}
