
// ZOYA Minecraft — canonical 109-capability contract registry.
// This file is the single source of truth for mode identity, arguments,
// execution class, lifecycle, cancellation and safety metadata.

const defs = [
["follow_player","Follow Player","follow_player {username}","username","continuous"],
["roam","Roam","roam","none","continuous"],
["pvp","PvP","pvp {username}","username","continuous"],
["hit","Hit","hit {username}","username","finite"],
["gather_resources","Gather Resources","gather_resources {item} {amount}","item amount","finite"],
["do_task","Do Task","do_task {task}","task","finite"],
["coordinate","Coordinate","coordinate {username}","username","finite"],
["explore","Explore","explore","none","continuous"],
["observe","Observe","observe","optional_target","finite"],
["return","Return","return","none","finite"],
["investigate_entity","Investigate Entity","investigate_entity {name}","entity_name","finite"],
["mine","Mine","mine {block}","block_name","finite"],
["chop_tree","Chop Tree","chop_tree","none","finite"],
["craft","Craft","craft {item} {amount}","item amount","finite"],
["eat","Eat","eat {item}","optional_item","finite"],
["collect","Collect","collect {item} {amount}","item amount","finite"],
["look_at_player","Look At Player","look_at_player {username}","username","finite"],
["chat","Public Chat","chat {message}","message","finite"],
["private_chat","Private Chat","private_chat {username} {message}","username message","finite"],
["go_to","Go To","go_to {x} {y} {z}","coordinates","finite"],
["look_at_coordinates","Look At Coordinates","look_at_coordinates {x} {y} {z}","coordinates","finite"],
["stop","Stop / Cancel","stop","none","control"],
["wait","Wait","wait {seconds}","seconds","finite"],
["return_to_coordinates","Return To Coordinates","return_to_coordinates {x} {y} {z}","coordinates","finite"],
["sprint","Sprint","sprint {seconds}","seconds","finite"],
["sneak","Sneak","sneak {seconds}","seconds","finite"],
["jump","Jump","jump","none","finite"],
["enter_exit_vehicle","Enter / Exit Vehicle","enter_exit_vehicle","none","finite"],
["attack_mob","Attack Mob","attack_mob {mob}","optional_mob","finite"],
["defend","Defend","defend","none","continuous"],
["guard","Guard","guard {x} {y} {z}","coordinates","continuous"],
["escape","Escape","escape","none","finite"],
["chase_target","Chase Target","chase_target {target}","target","continuous"],
["equip_best_weapon","Equip Best Weapon","equip_best_weapon","none","finite"],
["use_shield","Use Shield","use_shield","none","finite"],
["use_ranged_weapon","Use Ranged Weapon","use_ranged_weapon {target}","target","finite"],
["dig","Dig","dig {x} {y} {z}","coordinates","finite"],
["harvest_crops","Harvest Crops","harvest_crops","none","finite"],
["fish","Fish","fish","none","finite"],
["hunt","Hunt Animals","hunt","optional_target","finite"],
["find_shelter","Find Shelter","find_shelter","none","finite"],
["recover_after_death","Recover After Death","recover_after_death","none","finite"],
["find_safe_location","Find Safe Location","find_safe_location","none","finite"],
["check_inventory","Check Inventory","check_inventory","none","observation"],
["find_item","Find Item","find_item {item}","item","observation"],
["count_item","Count Item","count_item {item}","item","observation"],
["equip_item","Equip Item","equip_item {item}","item","finite"],
["drop_item","Drop Item","drop_item {item}","item","finite"],
["give_item","Give Item","give_item {item} {username}","item username","finite"],
["take_item","Take Item","take_item {item}","item","finite"],
["deposit","Deposit","deposit {item} {x} {y} {z}","item coordinates","finite"],
["retrieve","Retrieve","retrieve {item} {x} {y} {z}","item coordinates","finite"],
["sort_inventory","Sort Inventory","sort_inventory","none","finite"],
["smelt","Smelt","smelt {item}","item","finite"],
["craft_workbench","Craft With Workbench","craft_workbench {item}","item","finite"],
["craft_furnace","Craft With Furnace","craft_furnace {item}","item","finite"],
["gather_missing_materials","Gather Missing Materials","gather_missing_materials {item}","item","finite"],
["multi_step_craft","Multi-Step Craft","multi_step_craft {item}","item","finite"],
["place_block","Place Block","place_block {block} {x} {y} {z}","block coordinates","finite"],
["break_block","Break Block","break_block {x} {y} {z}","coordinates","finite"],
["open_chest","Open Chest","open_chest {x} {y} {z}","coordinates","finite"],
["open_barrel","Open Barrel","open_barrel {x} {y} {z}","coordinates","finite"],
["open_door","Open Door","open_door {x} {y} {z}","coordinates","finite"],
["close_door","Close Door","close_door {x} {y} {z}","coordinates","finite"],
["use_button","Use Button","use_button {x} {y} {z}","coordinates","finite"],
["use_lever","Use Lever","use_lever {x} {y} {z}","coordinates","finite"],
["use_block","Use Block","use_block {x} {y} {z}","coordinates","finite"],
["use_item","Use Item","use_item {item}","item","finite"],
["sleep","Sleep","sleep","none","finite"],
["find_player","Find Player","find_player {username}","username","observation"],
["find_entity","Find Entity","find_entity {name}","entity_name","observation"],
["find_item_world","Find Item In World","find_item_world {item}","item","observation"],
["check_nearby","Check Nearby Area","check_nearby","none","observation"],
["check_environment","Check Environment","check_environment","none","observation"],
["detect_hostiles","Detect Hostiles","detect_hostiles","none","observation"],
["check_health","Check Health","check_health","none","observation"],
["check_food","Check Food","check_food","none","observation"],
["check_equipment","Check Equipment","check_equipment","none","observation"],
["ask_permission","Ask Permission","ask_permission {username} {action}","username action","control"],
["whisper_player","Whisper Player","whisper_player {username} {message}","username message","finite"],
["remember_player","Remember Player","remember_player {username} {fact}","username fact","control"],
["report_result","Report Result","report_result {message}","message","finite"],
["ask_clarification","Ask Clarification","ask_clarification {username} {question}","username question","finite"],
["retrieve_item","Retrieve Item","retrieve_item {item}","item","finite"],
["deliver_item","Deliver Item","deliver_item {item} {username}","item username","finite"],
["escort_player","Escort Player","escort_player {username}","username","continuous"],
["protect_player","Protect Player","protect_player {username}","username","continuous"],
["guard_location","Guard Location","guard_location {x} {y} {z}","coordinates","continuous"],
["build","Build","build {plan}","plan","finite"],
["search","Search For Something","search {target}","target","finite"],
["watch","Watch","watch {target}","target","continuous"],
["coordinate_with_player","Coordinate With Player","coordinate_with_player {username} {task}","username task","continuous"],
["op_command","Use OP Command","op_command {command}","command","finite"],
["equip_best_armor","Equip Best Armor","equip_best_armor","none","finite"],
["remember_home","Remember Home","remember_home {x} {y} {z}","coordinates","control"],
["return_home","Return Home","return_home","none","finite"],
["forget_home","Forget Home","forget_home","none","control"],
["remember_location","Remember Location","remember_location {name} {x} {y} {z}","name coordinates","control"],
["return_to_location","Return To Location","return_to_location {name}","name","finite"],
["find_structure","Find Structure","find_structure {structure}","structure","finite"],
["find_biome","Find Biome","find_biome {biome}","biome","finite"],
["recover_items_after_death","Recover Items After Death","recover_items_after_death","none","finite"],
["repair_equipment","Repair Equipment","repair_equipment {item}","item","finite"],
["breed_animals","Breed Animals","breed_animals {animal}","animal","finite"],
["enchant_item","Enchant Item","enchant_item {item}","item","finite"],
["milk_animal","Milk Animal","milk_animal {animal}","animal","finite"],
["shear_animal","Shear Animal","shear_animal {animal}","animal","finite"],
["extinguish_fire","Extinguish Fire","extinguish_fire","none","finite"],
["clear_hostiles","Clear Hostiles","clear_hostiles [radius]","optional_radius","finite"]
];

export const CAPABILITY_MODES = Object.freeze(defs.map(([id,label,usage,argSchema,execution]) => Object.freeze({
  id, label, usage, argSchema, execution,
  cancellation: execution === "continuous" ? "explicit_stop_or_target_loss" : "explicit_stop_or_completion",
  safety: ["op_command","pvp","attack_mob","hit","guard","guard_location","defend","escort_player","protect_player","chase_target","clear_hostiles"].includes(id)
    ? "combat_or_privileged"
    : "standard"
})));

export const CAPABILITY_IDS = Object.freeze(CAPABILITY_MODES.map(m => m.id));
export const CAPABILITY_BY_ID = Object.freeze(Object.fromEntries(CAPABILITY_MODES.map(m => [m.id,m])));

export function assertCapabilityRegistry(handlers) {
  if (CAPABILITY_MODES.length !== 109) throw new Error("Expected exactly 109 capability modes.");
  if (new Set(CAPABILITY_IDS).size !== 105) throw new Error("Capability IDs must be unique.");
  for (const mode of CAPABILITY_MODES) {
    if (!mode.id || !mode.label || !mode.usage || !mode.argSchema || !mode.execution) {
      throw new Error("Incomplete capability contract: " + String(mode.id));
    }
    if (typeof handlers?.[mode.id] !== "function") {
      throw new Error("Missing handler: " + mode.id);
    }
  }
}
