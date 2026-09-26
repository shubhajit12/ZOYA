import pathfinderPackage from "mineflayer-pathfinder";
import readline from "node:readline";

const { goals } = pathfinderPackage;

const CAPABILITIES = [
  ["follow_player", "Follow Player", "player username"],
  ["roam", "Roam", null],
  ["pvp", "PvP", "player username"],
  ["hit", "Hit", "player username"],
  ["gather_resources", "Gather Resources", null],
  ["do_task", "Do Task", "task description"],
  ["coordinate", "Coordinate", null],
  ["explore", "Explore", null],
  ["observe", "Observe", null],
  ["return", "Return", null],
  ["investigate_entity", "Investigate Entity", null],
  ["mine", "Mine", null],
  ["chop_tree", "Chop Tree", null],
  ["craft", "Craft", "item"],
  ["eat", "Eat", null],
  ["collect", "Collect", null],
  ["look_at_player", "Look At Player", "player username"],
  ["go_to", "Go To", "x y z"],
  ["look_at_coordinates", "Look At Coordinates", "x y z"],
  ["stop", "Stop / Cancel", null],
  ["wait", "Wait", "seconds"],
  ["return_to_coordinates", "Return To Coordinates", "x y z"],
  ["sprint", "Sprint", "seconds"],
  ["sneak", "Sneak", "seconds"],
  ["jump", "Jump", null],
  ["enter_exit_vehicle", "Enter / Exit Vehicle", null],
  ["attack_mob", "Attack Mob", "mob name"],
  ["defend", "Defend", null],
  ["guard", "Guard", "x y z"],
  ["escape", "Escape", null],
  ["chase_target", "Chase Target", "player/entity name"],
  ["equip_best_weapon", "Equip Best Weapon", null],
  ["use_shield", "Use Shield", null],
  ["use_ranged_weapon", "Use Ranged Weapon", "target name"],
  ["dig", "Dig", null],
  ["harvest_crops", "Harvest Crops", null],
  ["fish", "Fish", null],
  ["hunt", "Hunt Animals", null],
  ["find_shelter", "Find Shelter", null],
  ["recover_after_death", "Recover After Death", null],
  ["find_safe_location", "Find Safe Location", null],
  ["check_inventory", "Check Inventory", null],
  ["find_item", "Find Item", "item"],
  ["count_item", "Count Item", "item"],
  ["equip_item", "Equip Item", "item"],
  ["drop_item", "Drop Item", "item"],
  ["give_item", "Give Item", "item + player"],
  ["take_item", "Take Item", "item"],
  ["deposit", "Deposit", "item/container"],
  ["retrieve", "Retrieve", "item/container"],
  ["sort_inventory", "Sort Inventory", null],
  ["smelt", "Smelt", "item"],
  ["craft_workbench", "Craft With Workbench", "item"],
  ["craft_furnace", "Craft With Furnace", "item"],
  ["gather_missing_materials", "Gather Missing Materials", "item"],
  ["multi_step_craft", "Multi-Step Craft", "item"],
  ["place_block", "Place Block", "block + x y z"],
  ["break_block", "Break Block", "x y z"],
  ["open_chest", "Open Chest", "x y z"],
  ["open_barrel", "Open Barrel", "x y z"],
  ["open_door", "Open Door", "x y z"],
  ["close_door", "Close Door", "x y z"],
  ["use_button", "Use Button", "x y z"],
  ["use_lever", "Use Lever", "x y z"],
  ["use_block", "Use Block", "x y z"],
  ["use_item", "Use Item", "item"],
  ["sleep", "Sleep", null],
  ["find_player", "Find Player", "player username"],
  ["find_entity", "Find Entity", "entity name"],
  ["find_item_world", "Find Item In World", "item"],
  ["check_nearby", "Check Nearby Area", null],
  ["check_environment", "Check Environment", null],
  ["detect_hostiles", "Detect Hostiles", null],
  ["check_health", "Check Health", null],
  ["check_food", "Check Food", null],
  ["check_equipment", "Check Equipment", null],
  ["ask_permission", "Ask Permission", "player + action"],
  ["whisper_player", "Whisper Player", "player + message"],
  ["remember_player", "Remember Player", "player + fact"],
  ["report_result", "Report Result", "message"],
  ["ask_clarification", "Ask Clarification", "player + question"],
  ["retrieve_item", "Retrieve Item", "item"],
  ["deliver_item", "Deliver Item", "item + player"],
  ["escort_player", "Escort Player", "player"],
  ["protect_player", "Protect Player", "player"],
  ["guard_location", "Guard Location", "x y z"],
  ["build", "Build", "plan"],
  ["search", "Search For Something", "target"],
  ["watch", "Watch", "target"],
  ["coordinate_with_player", "Coordinate With Player", "player + task"],
  ["op_command", "Use OP Command", "validated command"]
];

const DELEGATED = new Map([
  ["follow_player", "follow_player"],
  ["roam", "safe_roam"],
  ["pvp", "pvp"],
  ["gather_resources", "gather_basic_resources"],
  ["explore", "explore"],
  ["return", "return_to_owner"],
  ["investigate_entity", "investigate_entity"],
  ["mine", "mine"],
  ["chop_tree", "chop_tree"],
  ["craft", "craft"],
  ["eat", "eat"],
  ["collect", "collect"],
  ["look_at_player", "look_at_player"]
]);

function parseCoords(value) {
  const parts = String(value || "").trim().split(/\\s+/).map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) {
    throw new Error("Expected coordinates as: x y z");
  }
  return { x: parts[0], y: parts[1], z: parts[2] };
}

function distance(bot, x, y, z) {
  return bot.entity?.position ? bot.entity.position.distanceTo({ x, y, z }) : Infinity;
}

async function directCapability({ bot, runtime, id, arg, log }) {
  if (DELEGATED.has(id)) {
    if (id === "pvp" || id === "follow_player" || id === "look_at_player") {
      if (!arg) throw new Error("A player username is required.");
      return runtime.execute(DELEGATED.get(id), { targetUsername: arg, permissionGranted: true });
    }
    return runtime.execute(DELEGATED.get(id), { permissionGranted: true });
  }

  if (id === "hit") {
    const target = Object.values(bot.players || {}).find(p => p?.username?.toLowerCase() === String(arg).toLowerCase())?.entity;
    if (!target) throw new Error("Player not found.");
    await bot.lookAt(target.position.offset(0, target.height || 1.5, 0), true);
    bot.attack(target);
    return true;
  }

  if (id === "go_to" || id === "return_to_coordinates") {
    const { x, y, z } = parseCoords(arg);
    log("[CAPABILITY] Target: X=" + x + " Y=" + y + " Z=" + z);
    if (!goals?.GoalNear) throw new Error("mineflayer-pathfinder GoalNear is unavailable.");
    await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1.5));
    return distance(bot, x, y, z) <= 2.5;
  }

  if (id === "look_at_coordinates") {
    const { x, y, z } = parseCoords(arg);
    await bot.lookAt({ x, y, z }, true);
    return true;
  }

  if (id === "stop") {
    runtime.cancelCurrentTask("manual capability tester");
    try { bot.pathfinder.setGoal(null); } catch {}
    try { bot.clearControlStates(); } catch {}
    return true;
  }

  if (id === "wait") {
    const seconds = Math.max(0, Math.min(300, Number(arg || 1)));
    if (!Number.isFinite(seconds)) throw new Error("Seconds must be a number.");
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    return true;
  }

  if (id === "jump" || id === "sprint" || id === "sneak") {
    const seconds = id === "jump" ? 0.15 : Math.max(0.1, Math.min(30, Number(arg || 1)));
    if (!Number.isFinite(seconds)) throw new Error("Duration must be a number.");
    const state = id === "sprint" ? "sprint" : "sneak";
    if (id === "jump") bot.setControlState("jump", true);
    else bot.setControlState(state, true);
    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    if (id === "jump") bot.setControlState("jump", false);
    else bot.setControlState(state, false);
    return true;
  }

  if (id === "check_inventory") {
    log("[INVENTORY] " + (bot.inventory.items().map(i => i.name + " x" + i.count).join(", ") || "empty"));
    return true;
  }

  if (id === "find_item" || id === "count_item") {
    const name = String(arg || "").trim().toLowerCase();
    const count = bot.inventory.items().filter(i => i.name.toLowerCase().includes(name)).reduce((sum, i) => sum + i.count, 0);
    log("[INVENTORY] " + name + " = " + count);
    return true;
  }

  if (id === "equip_item") {
    const name = String(arg || "").trim().toLowerCase();
    const item = bot.inventory.items().find(i => i.name.toLowerCase().includes(name));
    if (!item) throw new Error("Item not found in inventory.");
    await bot.equip(item, "hand");
    return true;
  }

  if (id === "drop_item") {
    const name = String(arg || "").trim().toLowerCase();
    const item = bot.inventory.items().find(i => i.name.toLowerCase().includes(name));
    if (!item) throw new Error("Item not found in inventory.");
    await bot.tossStack(item);
    return true;
  }

  if (id === "find_player") {
    const wanted = String(arg || "").trim().toLowerCase();
    const player = Object.values(bot.players || {}).find(p => p?.username?.toLowerCase() === wanted);
    if (!player?.entity) throw new Error("Player not found nearby.");
    log("[PLAYER] " + player.username + " at " + JSON.stringify(player.entity.position));
    return true;
  }

  if (id === "find_entity" || id === "find_item_world") {
    const wanted = String(arg || "").trim().toLowerCase();
    const entity = Object.values(bot.entities || {}).find(e => e?.name?.toLowerCase().includes(wanted));
    if (!entity) throw new Error("Entity/item not found.");
    log("[ENTITY] " + (entity.name || "unknown") + " at " + JSON.stringify(entity.position));
    return true;
  }

  if (id === "check_nearby") {
    const nearby = Object.values(bot.entities || {}).filter(e => e?.position && e !== bot.entity).sort((a,b) => a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position)).slice(0, 20);
    for (const e of nearby) log("[NEARBY] " + (e.username || e.name || e.type || "unknown") + " distance=" + e.position.distanceTo(bot.entity.position).toFixed(2));
    return true;
  }

  if (id === "check_environment") {
    const p = bot.entity.position;
    const below = bot.blockAt(p.offset(0,-1,0));
    const head = bot.blockAt(p.offset(0,1,0));
    log("[ENV] Position=" + p.x.toFixed(2) + "," + p.y.toFixed(2) + "," + p.z.toFixed(2) + " below=" + (below?.name || "unknown") + " head=" + (head?.name || "unknown"));
    return true;
  }

  if (id === "detect_hostiles") {
    const hostile = new Set(["zombie","husk","drowned","skeleton","stray","creeper","spider","cave_spider","witch","pillager","vindicator","evoker","ravager","phantom","blaze","magma_cube","silverfish","endermite","guardian","elder_guardian","piglin_brute","hoglin","zoglin"]);
    const list = Object.values(bot.entities || {}).filter(e => e?.position && hostile.has(String(e.name || "").toLowerCase()) && e.position.distanceTo(bot.entity.position) <= 24);
    log("[SAFETY] Hostiles nearby: " + list.length);
    for (const e of list) log("[SAFETY] " + e.name + " distance=" + e.position.distanceTo(bot.entity.position).toFixed(2));
    return true;
  }

  if (id === "check_health") { log("[STATUS] Health=" + bot.health); return true; }
  if (id === "check_food") { log("[STATUS] Food=" + bot.food + " saturation=" + bot.foodSaturation); return true; }
  if (id === "check_equipment") {
    log("[EQUIPMENT] " + JSON.stringify(bot.inventory.items().filter(i => i.slot >= 5 && i.slot <= 8).map(i => i.name)));
    return true;
  }

  if (id === "coordinate") {
    const p = bot.entity.position;
    log("[COORDINATES] Zoya = X=" + p.x.toFixed(2) + " Y=" + p.y.toFixed(2) + " Z=" + p.z.toFixed(2));
    return true;
  }

  if (id === "observe") {
    log("[OBSERVE] Nearby entities=" + Object.values(bot.entities || {}).filter(e => e?.position && e !== bot.entity).length);
    return true;
  }

  if (id === "ask_permission" || id === "whisper_player" || id === "remember_player" || id === "report_result" || id === "ask_clarification") {
    throw new Error("Communication capabilities are exercised through the Minecraft chat layer; use in-game chat for this test.");
  }

  if (id === "op_command") {
    const command = String(arg || "").trim();
    if (!command.startsWith("/")) throw new Error("Enter a slash command.");
    const permissionLevel = Number(bot.game?.permissionLevel ?? -1);
    if (permissionLevel < 2) throw new Error("Zoya's OP permission level was not reported as level 2+ by Mineflayer.");
    bot.chat(command);
    return true;
  }

  throw new Error("Capability is registered but its runtime implementation has not been added yet.");
}

export function startCapabilityTester({ bot, runtime, log = console.log }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    log("[CAPABILITY TESTER] Interactive terminal unavailable; tester not started.");
    return () => {};
  }

  let stopped = false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  const ask = question => new Promise(resolve => rl.question(question, resolve));

  async function menu() {
    while (!stopped && bot && bot.entity) {
      log("");
      log("========================================");
      log("       ZOYA CAPABILITY DEBUGGER");
      log("========================================");
      CAPABILITIES.forEach(([id, label, args], index) => {
        log((index + 1) + ". " + label + (args ? " -> {" + args + "}" : ""));
      });
      log("0. Exit capability tester");
      const answer = String(await ask("Choose a capability to run (0-" + CAPABILITIES.length + "): ")).trim();
      if (answer === "0") break;
      const index = Number(answer) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= CAPABILITIES.length) {
        log("[CAPABILITY TESTER] Invalid selection.");
        continue;
      }

      const [id, label, args] = CAPABILITIES[index];
      log("[CAPABILITY] " + label + " selected.");
      let arg = "";
      if (args) arg = String(await ask("Enter " + args + ": ")).trim();

      try {
        if (runtime?.getActiveTask?.()) runtime.cancelCurrentTask("manual capability tester");
        log("[CAPABILITY] Starting " + label + "...");
        const startedAt = Date.now();
        const result = await directCapability({ bot, runtime, id, arg, log });
        log("[CAPABILITY] " + label + " -> " + (result ? "SUCCESS" : "FAILED") + " (" + (Date.now() - startedAt) + " ms)");
      } catch (error) {
        log("[CAPABILITY] " + label + " -> FAILED: " + (error instanceof Error ? error.message : String(error)));
      }
    }

    rl.close();
    log("[CAPABILITY TESTER] Exited. No capability is selected automatically.");
  }

  void menu();

  return () => {
    stopped = true;
    try { rl.close(); } catch {}
  };
}

export function getCapabilityRegistry() {
  return CAPABILITIES.map(([id, label, args]) => ({ id, label, args }));
}
