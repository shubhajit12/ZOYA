import fs from "node:fs";
import path from "node:path";
import { pathfinder, Movements, goals } from "mineflayer-pathfinder";

const MEMORY_FILE = "player-memory.json";
const DEFAULT_MEMORY = { players: {}, events: [], updatedAt: null };
const ACCEPT_WORDS = new Set(["accept", "accepted", "allow", "allowed", "yes", "y"]);
const DECLINE_WORDS = new Set(["decline", "declined", "deny", "denied", "no", "n"]);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

export function createMinecraftRuntime({ bot, config, stateDir, log = () => {} }) {
  bot.loadPlugin(pathfinder);
  const movements = new Movements(bot);
  movements.canDig = true;
  movements.allow1by1towers = false;
  movements.allowParkour = false;
  movements.allowSprinting = true;
  bot.pathfinder.setMovements(movements);

  const memoryPath = path.join(stateDir, MEMORY_FILE);
  const memory = readJson(memoryPath, DEFAULT_MEMORY);
  if (!memory.players) memory.players = {};
  if (!Array.isArray(memory.events)) memory.events = [];
  const owner = String(config.ownerUsername || "").trim();
  const pending = new Map();
  let currentGoal = null;
  let busy = false;

  function saveMemory() {
    memory.updatedAt = new Date().toISOString();
    memory.events = memory.events.slice(-200);
    writeJson(memoryPath, memory);
  }
  function rememberPlayer(username, patch = {}) {
    if (!username || username === bot.username) return;
    const key = String(username).toLowerCase();
    memory.players[key] = {
      username,
      firstSeenAt: memory.players[key]?.firstSeenAt || new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      interactions: memory.players[key]?.interactions || 0,
      ...memory.players[key],
      ...patch
    };
    saveMemory();
  }
  function rememberEvent(type, data) {
    memory.events.push({ at: new Date().toISOString(), type, ...data });
    saveMemory();
  }

  function permissionFor(username, action) {
    if (username === owner) return { allowed: true, source: "owner" };
    if (action === "safe_roam") return { allowed: config.movementEnabled === true, source: "autonomous-movement" };
    return { allowed: false, source: "owner-required" };
  }

  function askOwner(requester, action) {
    if (!owner) {
      log("[PERMISSION] No ownerUsername configured; request denied safely.");
      return false;
    }
    const key = requester.toLowerCase() + ":" + action;
    pending.set(key, { requester, action, createdAt: Date.now() });
    try {
      bot.whisper(owner, "[ZOYA PERMISSION] " + requester + " asks me to " + action + ". Reply \"accept\" or \"decline\".");
      log("[PERMISSION] Asked owner " + owner + " to allow " + requester + " -> " + action + ".");
      return true;
    } catch (error) {
      log("[PERMISSION] Failed to contact owner: " + (error instanceof Error ? error.message : String(error)));
      return false;
    }
  }

  function handleWhisper(username, message) {
    const sender = String(username || "").trim();
    const text = String(message || "").trim();
    if (!sender || !text) return;
    rememberPlayer(sender, { interactions: (memory.players[sender.toLowerCase()]?.interactions || 0) + 1 });
    if (sender !== owner) return;
    const word = text.toLowerCase().split(/\s+/)[0];
    if (!ACCEPT_WORDS.has(word) && !DECLINE_WORDS.has(word)) return;
    const first = pending.values().next();
    if (first.done) return;
    const request = first.value;
    pending.delete(request.requester.toLowerCase() + ":" + request.action);
    if (DECLINE_WORDS.has(word)) {
      log("[PERMISSION] Owner declined " + request.requester + " -> " + request.action + ".");
      return;
    }
    log("[PERMISSION] Owner accepted " + request.requester + " -> " + request.action + ".");
    void execute(request.action, { targetUsername: request.requester, permissionGranted: true });
  }

  async function moveToPlayer(username, distance = 3) {
    const target = bot.players[username]?.entity;
    if (!target) return false;
    await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, distance));
    return true;
  }

  async function explore() {
    const p = bot.entity.position;
    const angle = Math.random() * Math.PI * 2;
    const radius = 12;
    await bot.pathfinder.goto(new goals.GoalNear(p.x + Math.cos(angle) * radius, p.y, p.z + Math.sin(angle) * radius, 2));
    return true;
  }

  async function gatherWood() {
    const origin = bot.entity.position;
    const names = new Set(["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log","mangrove_log","cherry_log"]);
    let best = null;
    let bestDistance = Infinity;
    for (let dx = -16; dx <= 16; dx++) for (let dy = -4; dy <= 8; dy++) for (let dz = -16; dz <= 16; dz++) {
      const block = bot.blockAt(origin.offset(dx, dy, dz));
      if (!block || !names.has(block.name)) continue;
      const d = block.position.distanceTo(origin);
      if (d < bestDistance) { best = block; bestDistance = d; }
    }
    if (!best) return false;
    await bot.pathfinder.goto(new goals.GoalGetToBlock(best.position.x, best.position.y, best.position.z));
    if (bot.canDigBlock(best)) await bot.dig(best);
    return true;
  }

  async function investigateEntity() {
    const p = bot.entity.position;
    const entities = Object.values(bot.entities || {}).filter(e => e && e !== bot.entity && e.position && e.position.distanceTo(p) <= 16);
    entities.sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p));
    const target = entities[0];
    if (!target) return false;
    await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3));
    return true;
  }

  async function mineNearest() {
    const origin = bot.entity.position;
    const names = new Set(["stone","cobblestone","coal_ore","deepslate_coal_ore","iron_ore","deepslate_iron_ore","copper_ore","deepslate_copper_ore"]);
    let best = null;
    let bestDistance = Infinity;
    for (let dx = -8; dx <= 8; dx++) for (let dy = -4; dy <= 6; dy++) for (let dz = -8; dz <= 8; dz++) {
      const block = bot.blockAt(origin.offset(dx, dy, dz));
      if (!block || !names.has(block.name)) continue;
      const d = block.position.distanceTo(origin);
      if (d < bestDistance) { best = block; bestDistance = d; }
    }
    if (!best) return false;
    await bot.pathfinder.goto(new goals.GoalGetToBlock(best.position.x, best.position.y, best.position.z));
    if (!bot.canDigBlock(best)) return false;
    await bot.dig(best);
    return true;
  }

  async function craftBasic() {
    const logs = bot.inventory.items().find(i => /_log$/.test(i.name));
    if (!logs) return false;
    const plankName = logs.name.replace(/_log$/, "_planks");
    const plankId = bot.registry.itemsByName[plankName]?.id;
    if (!plankId) return false;
    const recipe = bot.recipesFor(plankId, null, 1, null)[0];
    if (!recipe) return false;
    await bot.craft(recipe, 1, null);
    return true;
  }

  async function eat() {
    const item = bot.inventory.items().find(i => /bread|apple|carrot|potato|beef|porkchop|chicken|mutton|salmon|cod|steak|cooked/.test(i.name));
    if (!item || (bot.food ?? 20) >= 16) return false;
    await bot.equip(item, "hand");
    await bot.consume();
    return true;
  }

  async function execute(action, options = {}) {
    if (busy) return false;
    const movementActions = new Set(["safe_roam","explore","gather_basic_resources","follow_player","return_to_owner"]);
    if (movementActions.has(action) && config.movementEnabled !== true && !options.permissionGranted) {
      log("[PERMISSION] Autonomous movement is disabled; action blocked: " + action);
      return false;
    }
    busy = true;
    currentGoal = action;
    try {
      let result = false;
      if (action === "safe_roam" || action === "explore") result = await explore();
      else if (action === "gather_basic_resources" || action === "chop_tree") result = await gatherWood();
      else if (action === "follow_player") result = await moveToPlayer(options.targetUsername || owner, 3);
      else if (action === "return_to_owner") result = await moveToPlayer(owner, 5);
      else if (action === "eat") result = await eat();
      else if (action === "investigate_entity") result = await investigateEntity();
      else if (action === "mine") result = await mineNearest();
      else if (action === "craft") result = await craftBasic();
      else if (action === "idle") result = true;
      else {
        log("[ACTION] Capability not implemented yet: " + action);
        result = false;
      }
      rememberEvent("action", { action, success: result, target: options.targetUsername || null });
      return result;
    } catch (error) {
      log("[ACTION] " + action + " failed: " + (error instanceof Error ? error.message : String(error)));
      rememberEvent("action_error", { action, error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      currentGoal = null;
      busy = false;
    }
  }

  bot.on("whisper", handleWhisper);
  bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    rememberPlayer(username, { lastMessage: String(message).slice(0, 500), interactions: (memory.players[String(username).toLowerCase()]?.interactions || 0) + 1 });
    const text = String(message || "").toLowerCase();
    if (/\bfollow me\b/.test(text)) {
      if (username === owner) void execute("follow_player", { targetUsername: username, permissionGranted: true });
      else askOwner(username, "follow you");
    }
  });

  return {
    memory,
    rememberPlayer,
    rememberEvent,
    permissionFor,
    askOwner,
    execute,
    getStatus: () => ({ ownerUsername: owner || null, pendingPermissions: pending.size, currentGoal, busy, memoryPlayers: Object.keys(memory.players).length, memoryEvents: memory.events.length })
  };
}
