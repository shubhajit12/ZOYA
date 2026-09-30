// ZOYA Minecraft — clean 93-mode registry.
// Every manual capability has one explicit handler and one lifecycle contract.
// Handlers receive only the primitives they need; cross-capability arbitration
// remains owned by the runtime task executor.

export const CAPABILITY_IDS = [
  "follow_player","roam","pvp","hit","gather_resources","do_task","coordinate","explore","observe","return",
  "investigate_entity","mine","chop_tree","craft","eat","collect","look_at_player","chat","private_chat","go_to",
  "look_at_coordinates","stop","wait","return_to_coordinates","sprint","sneak","jump","enter_exit_vehicle",
  "attack_mob","defend","guard","escape","chase_target","equip_best_weapon","use_shield","use_ranged_weapon",
  "dig","harvest_crops","fish","hunt","find_shelter","recover_after_death","find_safe_location","check_inventory",
  "find_item","count_item","equip_item","drop_item","give_item","take_item","deposit","retrieve","sort_inventory",
  "smelt","craft_workbench","craft_furnace","gather_missing_materials","multi_step_craft","place_block","break_block",
  "open_chest","open_barrel","open_door","close_door","use_button","use_lever","use_block","use_item","sleep",
  "find_player","find_entity","find_item_world","check_nearby","check_environment","detect_hostiles","check_health",
  "check_food","check_equipment","ask_permission","whisper_player","remember_player","report_result","ask_clarification",
  "retrieve_item","deliver_item","escort_player","protect_player","guard_location","build","search","watch",
  "coordinate_with_player","op_command"
];

const RUNTIME_MODES = new Set([
  "follow_player","roam","pvp","explore","return","investigate_entity","mine","chop_tree","craft","eat","collect",
  "look_at_player","gather_resources","guard","guard_location","gather_missing_materials"
]);

function argParts(arg) { return String(arg ?? "").trim().split(/\\s+/).filter(Boolean); }
function requireArg(arg, message) { const value=String(arg ?? "").trim(); if (!value) throw new Error(message); return value; }

export function createCapabilityHandlers(ctx) {
  const {
    bot, runtime, log,
    runtimeExecute,
    primitive,
    findPlayer,
    findEntity,
    parseCoords,
    goto,
    taskSleep,
    inventoryCount,
    findInventoryItem,
    findWorldItem
  } = ctx;

  const handlers = Object.create(null);

  const runtimeHandler = id => async arg => {
    if (id === "follow_player" || id === "pvp" || id === "look_at_player") requireArg(arg, "A player username is required.");
    return runtimeExecute(id, arg);
  };

  for (const id of RUNTIME_MODES) handlers[id] = runtimeHandler(id);

  handlers.stop = async () => { runtime.cancelCurrentTask("manual capability tester"); return true; };

  handlers.go_to = async arg => { const p=parseCoords(arg); return goto(p.x,p.y,p.z,1.5,30000,runtime); };
  handlers.return_to_coordinates = handlers.go_to;
  handlers.look_at_coordinates = async arg => { const p=parseCoords(arg); await bot.lookAt(new bot.entity.position.constructor(p.x,p.y,p.z),true); return true; };
  handlers.wait = async arg => { const seconds=Number(requireArg(arg,"Seconds are required.")); if(!Number.isFinite(seconds)||seconds<0) throw new Error("Seconds must be a non-negative number."); await taskSleep(seconds*1000); return true; };
  handlers.sprint = async arg => { const seconds=Math.max(0,Number(requireArg(arg,"Seconds are required."))); if(!Number.isFinite(seconds)) throw new Error("Seconds must be numeric."); bot.setControlState("sprint",true); try { await taskSleep(seconds*1000); } finally { bot.setControlState("sprint",false); } return true; };
  handlers.sneak = async arg => { const seconds=Math.max(0,Number(requireArg(arg,"Seconds are required."))); if(!Number.isFinite(seconds)) throw new Error("Seconds must be numeric."); bot.setControlState("sneak",true); try { await taskSleep(seconds*1000); } finally { bot.setControlState("sneak",false); } return true; };
  handlers.jump = async () => { bot.setControlState("jump",true); await taskSleep(250); bot.setControlState("jump",false); return true; };
  handlers.chat = async arg => { const message=requireArg(arg,"Message is required.").slice(0,256); bot.chat(message); return true; };
  handlers.private_chat = async arg => { const p=argParts(arg), username=p.shift(); const message=p.join(" "); if(!username||!message) throw new Error("Username and message are required."); bot.whisper(username,message.slice(0,256)); return true; };
  handlers.whisper_player = handlers.private_chat;
  handlers.report_result = async arg => { const message=requireArg(arg,"Message is required.").slice(0,256); bot.chat(message); return true; };
  handlers.ask_clarification = handlers.private_chat;
  handlers.find_player = async arg => { const p=findPlayer(bot,requireArg(arg,"Username is required.")); if(!p) throw new Error("Player not found."); log("[PLAYER] "+p.username); return true; };
  handlers.find_entity = async arg => { const e=findEntity(bot,requireArg(arg,"Entity name is required.")); if(!e) throw new Error("Entity not found."); log("[ENTITY] "+(e.name||e.displayName||e.username)); return true; };
  handlers.find_item_world = async arg => { const e=findWorldItem(bot,requireArg(arg,"Item name is required.")); if(!e) throw new Error("World item not found."); log("[WORLD ITEM] "+e.position.x+" "+e.position.y+" "+e.position.z); return true; };
  handlers.count_item = async arg => { const name=requireArg(arg,"Item name is required."); log("[INVENTORY] "+name+" = "+inventoryCount(bot,name)); return true; };
  handlers.find_item = handlers.count_item;
  handlers.check_inventory = async () => { log("[INVENTORY] "+(bot.inventory.items().map(i=>i.name+" x"+i.count).join(", ")||"empty")); return true; };
  handlers.check_equipment = async () => { log("[EQUIPMENT] held="+(bot.heldItem?.name||"empty")); return true; };
  handlers.check_health = async () => { log("[HEALTH] "+bot.health); return true; };
  handlers.check_food = async () => { log("[FOOD] "+bot.food); return true; };
  handlers.check_nearby = async () => { log("[NEARBY] "+Object.values(bot.entities||{}).filter(e=>e?.position).length+" tracked entities."); return true; };
  handlers.check_environment = async () => { log("[ENV] time="+bot.time?.time+" raining="+Boolean(bot.isRaining)+" thunder="+Boolean(bot.thunderState)); return true; };
  handlers.detect_hostiles = async () => { const hostiles=Object.values(bot.entities||{}).filter(e=>ctx.isHostile?.(e)); log("[HOSTILES] "+hostiles.length); return true; };
  handlers.equip_item = async arg => { const item=findInventoryItem(bot,requireArg(arg,"Item name is required.")); if(!item) throw new Error("Item not found."); await bot.equip(item,"hand"); return true; };
  handlers.equip_best_weapon = async () => primitive("equip_best_weapon",""); 
  handlers.drop_item = async arg => primitive("drop_item",requireArg(arg,"Item name is required."));
  handlers.give_item = async arg => primitive("give_item",requireArg(arg,"Item and username are required."));
  handlers.deliver_item = handlers.give_item;
  handlers.take_item = async arg => primitive("take_item",requireArg(arg,"Item name is required."));
  handlers.retrieve_item = async arg => primitive("retrieve_item",requireArg(arg,"Item name is required."));
  handlers.deposit = async arg => primitive("deposit",requireArg(arg,"Item and coordinates are required."));
  handlers.retrieve = async arg => primitive("retrieve",requireArg(arg,"Item and coordinates are required."));
  handlers.sort_inventory = async () => primitive("sort_inventory","");
  handlers.smelt = async arg => primitive("smelt",requireArg(arg,"Item name is required."));
  handlers.craft_workbench = async arg => primitive("craft_workbench",requireArg(arg,"Item is required."));
  handlers.craft_furnace = async arg => primitive("craft_furnace",requireArg(arg,"Item is required."));
  handlers.multi_step_craft = async arg => primitive("multi_step_craft",requireArg(arg,"Item is required."));
  handlers.gather_missing_materials = async arg => runtimeExecute("gather_missing_materials",arg);
  handlers.place_block = async arg => primitive("place_block",requireArg(arg,"Block and coordinates are required."));
  handlers.break_block = async arg => primitive("break_block",requireArg(arg,"Coordinates are required."));
  handlers.open_chest = async arg => primitive("open_chest",requireArg(arg,"Coordinates are required."));
  handlers.open_barrel = async arg => primitive("open_barrel",requireArg(arg,"Coordinates are required."));
  handlers.open_door = async arg => primitive("open_door",requireArg(arg,"Coordinates are required."));
  handlers.close_door = async arg => primitive("close_door",requireArg(arg,"Coordinates are required."));
  handlers.use_button = async arg => primitive("use_button",requireArg(arg,"Coordinates are required."));
  handlers.use_lever = async arg => primitive("use_lever",requireArg(arg,"Coordinates are required."));
  handlers.use_block = async arg => primitive("use_block",requireArg(arg,"Coordinates are required."));
  handlers.use_item = async arg => primitive("use_item",requireArg(arg,"Item is required."));
  handlers.sleep = async () => primitive("sleep","");
  handlers.enter_exit_vehicle = async () => { if(bot.vehicle) bot.dismount(); else { const vehicle=Object.values(bot.entities||{}).find(e=>e?.position&&typeof e.name==="string"&&/boat|minecart|horse|donkey|mule|camel|pig|strider/.test(e.name)); if(!vehicle) throw new Error("No nearby vehicle found."); await bot.mount(vehicle); } return true; };
  handlers.use_shield = async () => primitive("use_shield","");
  handlers.use_ranged_weapon = async arg => primitive("use_ranged_weapon",requireArg(arg,"Target is required."));
  handlers.attack_mob = async arg => primitive("attack_mob",String(arg||""));
  handlers.defend = async () => primitive("defend","");
  handlers.guard = async arg => primitive("guard",requireArg(arg,"Guard coordinates are required."));
  handlers.escape = async () => primitive("escape","");
  handlers.chase_target = async arg => primitive("chase_target",requireArg(arg,"Target is required."));
  handlers.hit = async arg => primitive("hit",requireArg(arg,"Player username is required."));
  handlers.harvest_crops = async () => primitive("harvest_crops","");
  handlers.fish = async () => primitive("fish","");
  handlers.hunt = async () => primitive("hunt","");
  handlers.find_shelter = async () => primitive("find_shelter","");
  handlers.recover_after_death = async () => primitive("recover_after_death","");
  handlers.find_safe_location = async () => primitive("find_safe_location","");
  handlers.ask_permission = async arg => primitive("ask_permission",requireArg(arg,"Username and action are required."));
  handlers.remember_player = async arg => primitive("remember_player",requireArg(arg,"Username and fact are required."));
  handlers.escort_player = async arg => primitive("escort_player",requireArg(arg,"Username is required."));
  handlers.protect_player = async arg => primitive("protect_player",requireArg(arg,"Username is required."));
  handlers.guard_location = async arg => primitive("guard_location",requireArg(arg,"Coordinates are required."));
  handlers.build = async arg => primitive("build",requireArg(arg,"Build plan is required."));
  handlers.search = async arg => primitive("search",requireArg(arg,"Search target is required."));
  handlers.watch = async arg => primitive("watch",requireArg(arg,"Watch target is required."));
  handlers.coordinate = async arg => primitive("coordinate",requireArg(arg,"Username is required."));
  handlers.coordinate_with_player = async arg => primitive("coordinate_with_player",requireArg(arg,"Username and task are required."));
  handlers.op_command = async arg => primitive("op_command",requireArg(arg,"Command is required."));
  handlers.observe = async () => primitive("observe","");
  handlers.do_task = async arg => primitive("do_task",requireArg(arg,"Task is required."));

  for (const id of CAPABILITY_IDS) {
    if (typeof handlers[id] !== "function") throw new Error("Capability handler missing: "+id);
  }
  return Object.freeze(handlers);
}

export function assertCapabilityRegistry(handlers) {
  if (CAPABILITY_IDS.length !== 93) throw new Error("Expected exactly 93 capability IDs.");
  if (new Set(CAPABILITY_IDS).size !== 93) throw new Error("Capability IDs must be unique.");
  for (const id of CAPABILITY_IDS) if (typeof handlers[id] !== "function") throw new Error("Missing handler: "+id);
}
