import fs from "node:fs";
import path from "node:path";
import pathfinderPackage from "mineflayer-pathfinder";
import toolPackage from "mineflayer-tool";
import collectBlockPackage from "mineflayer-collectblock";
import craftingUtilPackage from "mineflayer-crafting-util";

const { pathfinder, Movements, goals } = pathfinderPackage;
const { plugin: toolPlugin } = toolPackage;
const { plugin: collectBlockPlugin } = collectBlockPackage;
const craftingUtilPlugin = craftingUtilPackage.plugin || craftingUtilPackage.default;

const MEMORY_FILE = "player-memory.json";
const DEFAULT_MEMORY = { players: {}, events: [], updatedAt: null };
const ACCEPT_WORDS = new Set(["accept", "accepted", "allow", "allowed", "yes", "y"]);
const DECLINE_WORDS = new Set(["decline", "declined", "deny", "denied", "no", "n"]);
const PERMISSION_TIMEOUT_MS = 60000;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

export function createMinecraftRuntime({ bot, config, stateDir, wakeBrain = () => {}, log = () => {} }) {
  if (typeof pathfinder !== "function" || typeof Movements !== "function" || !goals?.GoalNear) {
    throw new Error("mineflayer-pathfinder loaded without the expected CommonJS exports.");
  }
  if (typeof toolPlugin !== "function") throw new Error("mineflayer-tool plugin export is unavailable.");
  if (typeof collectBlockPlugin !== "function") throw new Error("mineflayer-collectblock plugin export is unavailable.");
  if (typeof craftingUtilPlugin !== "function") throw new Error("mineflayer-crafting-util plugin export is unavailable.");

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(toolPlugin);
  bot.loadPlugin(collectBlockPlugin);
  bot.loadPlugin(craftingUtilPlugin());
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
  const ownerKey = owner.toLowerCase();
  const pending = new Map();
  let nextPermissionId = 1;
  let currentGoal = null;
  let busy = false;
  let chatBusy = false;
  let lastPermissionAt = new Map();

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
      facts: Array.isArray(memory.players[key]?.facts) ? memory.players[key].facts : [],
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
    if (String(username).toLowerCase() === ownerKey) return { allowed: true, source: "owner" };
    if (action === "safe_roam") return { allowed: config.movementEnabled === true, source: "autonomous-movement" };
    return { allowed: false, source: "owner-required" };
  }

  function askOwner(requester, action, displayAction = action) {
    const requesterKey = String(requester).toLowerCase();
    const pendingKey = requesterKey + ":" + action;
    const existing = [...pending.values()].find(request => request.requester.toLowerCase() === requesterKey && request.action === action);
    if (existing) {
      log("[PERMISSION] Existing request #" + existing.id + " is still pending; not sending another request.");
      return true;
    }
    if (!owner) {
      log("[PERMISSION] No ownerUsername configured; request denied safely.");
      try { bot.whisper(requester, "[ZOYA] I cannot request permission because no owner is configured."); } catch {}
      return false;
    }
    const id = String(nextPermissionId++);
    const key = id;
    pending.set(key, { id, requester, action, createdAt: Date.now() });
    setTimeout(() => {
      const request = pending.get(key);
      if (request && Date.now() - request.createdAt >= PERMISSION_TIMEOUT_MS) {
        pending.delete(key);
        log("[PERMISSION] Request expired: " + requester + " -> " + action + ".");
      }
    }, PERMISSION_TIMEOUT_MS);
    try {
      bot.whisper(owner, "[ZOYA PERMISSION #" + id + "] " + requester + " asks me to " + displayAction + ". Reply \"accept " + id + "\" or \"decline " + id + "\".");
      log("[PERMISSION] Asked owner " + owner + " to allow " + requester + " -> " + action + ".");
      return true;
    } catch (error) {
      log("[PERMISSION] Failed to contact owner: " + (error instanceof Error ? error.message : String(error)));
      return false;
    }
  }

  async function handleWhisper(username, message) {
    const sender = String(username || "").trim();
    const text = String(message || "").trim();
    if (!sender || !text) return;
    rememberPlayer(sender, { interactions: (memory.players[sender.toLowerCase()]?.interactions || 0) + 1 });

    // Mineflayer's whisper event normally contains only the message body, but
    // accept a full "/w Zoya ..." payload too so owner replies work either way.
    const normalized = text.replace(/^\\/(?:w|msg|tell|whisper)\\s+\\S+\\s*/i, "").trim();
    const tokens = normalized.toLowerCase().split(/\\s+/).filter(Boolean);
    const decisionWord = tokens.find(token => ACCEPT_WORDS.has(token) || DECLINE_WORDS.has(token));
    if (!decisionWord) {
      if (sender.toLowerCase() !== ownerKey) void answerPlayer(sender, text);
      return;
    }

    if (sender.toLowerCase() !== ownerKey) {
      void answerPlayer(sender, text);
      return;
    }

    // The owner can reply naturally ("yes", "yes you can follow ...",
    // "accept 12", etc.). If no request id is supplied, use the oldest
    // pending request rather than interpreting the next word as an id.
    const requestId = tokens.find(token => /^\\d+$/.test(token));
    const request = requestId
      ? pending.get(requestId)
      : [...pending.values()].sort((x, y) => x.createdAt - y.createdAt)[0];
    if (!request) {
      log("[PERMISSION] Owner reply received but no pending permission request exists.");
      return;
    }

    pending.delete(request.id);
    if (DECLINE_WORDS.has(decisionWord)) {
      log("[PERMISSION] Owner declined #" + request.id + " " + request.requester + " -> " + request.action + ".");
      try { bot.whisper(request.requester, "[ZOYA] Your request was declined."); } catch {}
      return;
    }

    log("[PERMISSION] Owner accepted #" + request.id + " " + request.requester + " -> " + request.action + ".");
    try { bot.whisper(request.requester, "[ZOYA] Permission granted. I will try that now."); } catch {}
    const result = await execute(request.action, { targetUsername: request.requester, permissionGranted: true });
    try { bot.whisper(request.requester, result ? "[ZOYA] Done." : "[ZOYA] Action could not be completed."); } catch {}
  }

  async function lookAtPlayer(username) {
    const target = bot.players[username]?.entity;
    if (!target) return false;
    await bot.lookAt(target.position.offset(0, target.height ? target.height * 0.75 : 1.5, 0), true);
    return true;
  }

  function nearbyHostileCount(maxDistance = 12) {
    if (!bot.entity?.position) return 0;
    const hostileNames = new Set([
      "zombie","husk","drowned","skeleton","stray","creeper","spider","cave_spider",
      "witch","pillager","vindicator","evoker","ravager","phantom","blaze","magma_cube",
      "silverfish","endermite","guardian","elder_guardian","piglin_brute","hoglin","zoglin"
    ]);
    return Object.values(bot.entities || {}).filter(entity =>
      entity && entity !== bot.entity && entity.position &&
      entity.position.distanceTo(bot.entity.position) <= maxDistance &&
      hostileNames.has(String(entity.name || "").toLowerCase())
    ).length;
  }

  function interruptMovement(reason) {
    try { bot.pathfinder?.setGoal(null); } catch {}
    try { bot.clearControlStates(); } catch {}
    currentGoal = null;
    log("[MOVEMENT] Movement interrupted: " + reason);
    wakeBrain();
  }

  async function moveToPlayer(username, distance = 3) {
    const target = bot.players[username]?.entity;
    if (!target) return false;
    bot.setControlState("sprint", true);
    try {
      await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, distance));
      return true;
    } finally {
      bot.setControlState("sprint", false);
    }
  }

  async function explore() {
    const p = bot.entity.position;
    const angle = Math.random() * Math.PI * 2;
    const radius = 16;
    bot.setControlState("sprint", true);
    try {
      await bot.pathfinder.goto(new goals.GoalNear(p.x + Math.cos(angle) * radius, p.y, p.z + Math.sin(angle) * radius, 2));
      return true;
    } finally {
      bot.setControlState("sprint", false);
    }
  }

  async function collectBlock(block) {
    if (!block || !bot.collectBlock?.collect) return false;
    await bot.collectBlock.collect(block);
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
    await collectBlock(best);
    return true;
  }

  async function investigateEntity() {
    const p = bot.entity.position;
    const entities = Object.values(bot.entities || {}).filter(e => e && e !== bot.entity && e.position && e.position.distanceTo(p) <= 16);
    entities.sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p));
    const target = entities[0];
    if (!target) return false;
    bot.setControlState("sprint", true);
    try {
      await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3));
      return true;
    } finally {
      bot.setControlState("sprint", false);
    }
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
    await collectBlock(best);
    return true;
  }

  async function craftBasic() {
    const logs = bot.inventory.items().find(i => /_log$/.test(i.name));
    if (!logs) return false;
    const plankName = logs.name.replace(/_log$/, "_planks");
    const plankId = bot.registry.itemsByName[plankName]?.id;
    if (!plankId) return false;

    if (typeof bot.craftItem === "function") {
      const plan = await bot.craftItem(plankId, 4, null, { includeRecursion: true, multipleRecipes: true }, { strict: true });
      return plan?.success === true;
    }

    const recipe = bot.recipesFor(plankId, null, 1, null)[0];
    if (!recipe) return false;
    await bot.craft(recipe, 1, null);
    return true;
  }

  async function collectNearestDrop() {
    const p = bot.entity.position;
    const target = Object.values(bot.entities || {})
      .filter(e => e && e.position && e !== bot.entity && (e.name === "item" || e.type === "object"))
      .sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p))[0];
    if (!target || target.position.distanceTo(p) > 24) return false;
    bot.setControlState("sprint", true);
    try {
      await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 1.5));
      return true;
    } finally {
      bot.setControlState("sprint", false);
    }
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
    if (action === "safe_roam" && bot.health != null && (bot.health < 10 || nearbyHostileCount(12) > 0)) {
      log("[SAFETY] Refusing safe_roam: health=" + bot.health + ", hostileMobs=" + nearbyHostileCount(12) + ".");
      wakeBrain();
      return false;
    }
    const movementActions = new Set(["safe_roam","explore","gather_basic_resources","follow_player","return_to_owner","collect","investigate_entity","mine","chop_tree"]);
    if (movementActions.has(action) && config.movementEnabled !== true && !options.permissionGranted) {
      log("[PERMISSION] Autonomous movement is disabled; action blocked: " + action);
      return false;
    }
    busy = true;
    currentGoal = action;
    try {
      let result = false;
      if (action === "safe_roam" || action === "explore") result = await explore();
      else if (action === "look_at_player") result = await lookAtPlayer(options.targetUsername || owner);
      else if (action === "gather_basic_resources" || action === "chop_tree") result = await gatherWood();
      else if (action === "follow_player") result = await moveToPlayer(options.targetUsername || owner, 3);
      else if (action === "return_to_owner") result = owner ? await moveToPlayer(owner, 5) : false;
      else if (action === "eat") result = await eat();
      else if (action === "collect") result = await collectNearestDrop();
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

  async function answerPlayer(username, message) {
    const apiKey = String(config.groqApiKey || "").trim();
    if (!apiKey || chatBusy) return false;
    chatBusy = true;
    try {
      const player = memory.players[String(username).toLowerCase()] || null;
      const nearby = Object.values(bot.players || {}).filter(p => p?.entity && p.username !== bot.username).slice(0, 12)
        .map(p => ({ username: p.username, distance: p.entity.position.distanceTo(bot.entity.position) }));
      const prompt = [
        "You are Zoya, an AI Minecraft companion. Reply naturally and briefly to the player.",
        "Stay in character. Do not claim you performed an action unless the action runtime did it.",
        "If the player asks for an action, return JSON with reply and action.",
        "Allowed actions: idle, safe_roam, explore, gather_basic_resources, follow_player, look_at_player, investigate_entity, mine, chop_tree, craft, eat, collect, return_to_owner.",
        "The runtime enforces permissions. Never tell the player permission was granted unless it was actually granted.",
        "If no action is requested, use action idle.",
        "JSON only: {reply:string, action:string, memoryFacts:string[]}."
      ].join("\\n");
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: JSON.stringify({ player: username, memory: player, nearby, message }) }
          ],
          response_format: { type: "json_object" },
          temperature: 0.5
        })
      });
      if (!response.ok) throw new Error("Groq HTTP " + response.status);
      const payload = await response.json();
      const raw = payload?.choices?.[0]?.message?.content;
      const decision = JSON.parse(raw || "{}");
      const reply = typeof decision.reply === "string" ? decision.reply.slice(0, 350) : "I'm here.";
      const action = typeof decision.action === "string" ? decision.action : "idle";
      const facts = Array.isArray(decision.memoryFacts) ? decision.memoryFacts.filter(x => typeof x === "string").map(x => x.slice(0, 240)).slice(0, 5) : [];
      if (facts.length) {
        const existing = memory.players[String(username).toLowerCase()]?.facts || [];
        rememberPlayer(username, { facts: [...new Set([...existing, ...facts])].slice(-20) });
      }
      bot.whisper(username, reply);
      if (action !== "idle") {
        const ownerAllowed = String(username).toLowerCase() === ownerKey;
        const movement = new Set(["safe_roam","explore","gather_basic_resources","follow_player","look_at_player","return_to_owner","mine","chop_tree","craft","eat","investigate_entity","collect"]);
        if (ownerAllowed) {
          await execute(action, { targetUsername: username, permissionGranted: true });
        } else if (movement.has(action)) {
          askOwner(username, action, action === "follow_player" ? "follow you" : action);
        }
      }
      rememberEvent("chat", { username, message: String(message).slice(0, 500), action });
      return true;
    } catch (error) {
      log("[CHAT] Groq response failed: " + (error instanceof Error ? error.message : String(error)));
      return false;
    } finally {
      chatBusy = false;
    }
  }

  bot.on("death", () => rememberEvent("death", { username: bot.username || "Zoya" }));
  bot.on("respawn", () => rememberEvent("respawn", { username: bot.username || "Zoya" }));
  bot.on("kicked", reason => rememberEvent("kicked", { reason: String(reason || "unknown").slice(0, 300) }));
  let previousHealth = bot.health ?? 20;
  bot.on("health", () => {
    const health = bot.health ?? 0;
    const drop = previousHealth - health;
    rememberEvent("health", { health, food: bot.food ?? null });
    if (drop >= 1) interruptMovement("damage received (" + drop + " health)");
    if (health <= 0) wakeBrain();
    else if (health < 10) wakeBrain();
    previousHealth = health;
  });
  bot.on("whisper", handleWhisper);
  bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    rememberPlayer(username, { lastMessage: String(message).slice(0, 500), interactions: (memory.players[String(username).toLowerCase()]?.interactions || 0) + 1 });
    void answerPlayer(username, message);
  });

  return {
    memory,
    rememberPlayer,
    rememberEvent,
    permissionFor,
    askOwner,
    execute,
    answerPlayer,
    getStatus: () => ({ ownerUsername: owner || null, pendingPermissions: pending.size, currentGoal, busy, memoryPlayers: Object.keys(memory.players).length, memoryEvents: memory.events.length })
  };
}
