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
  const capabilityDebugMode = config?.capabilityDebugMode === true;
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

  // One movement configuration is shared by every movement-capable plugin.
  // collectblock otherwise creates/uses its own Movements instance, which can
  // silently disagree with the main Pathfinder configuration.
  const movements = new Movements(bot);
  movements.canDig = true;
  movements.allow1by1towers = false;
  movements.allowParkour = false;
  movements.allowSprinting = true;
  // Never bypass Pathfinder's planned nodes during normal navigation.
  // allowFreeMotion=true can replace the planned jump/step transition with a
  // raw "forward" control when the target appears line-of-sight reachable.
  // On 1.21.x this is exactly the failure mode where follow walks into a
  // one-block obstacle instead of executing the planned jump.
  movements.allowFreeMotion = false;
  movements.allowEntityDetection = true;
  movements.maxDropDown = 3;
  bot.pathfinder.setMovements(movements);
  if (bot.collectBlock) bot.collectBlock.movements = movements;

  const memoryPath = path.join(stateDir, MEMORY_FILE);
  const memory = readJson(memoryPath, DEFAULT_MEMORY);
  if (!memory.players) memory.players = {};
  if (!Array.isArray(memory.events)) memory.events = [];
  const owner = String(config.ownerUsername || "").trim();
  const ownerKey = owner.toLowerCase();
  const pending = new Map();
  let nextPermissionId = 1;
  let currentGoal = null;
  let activeTask = null;
  let taskSequence = 0;
  let busy = false;
  let chatBusy = false;

  // Combat physics must remain authoritative to Minecraft/Mineflayer.
  // We only observe the server velocity for diagnostics; we never write a
  // second velocity into bot.entity. Re-applying the same velocity after a
  // damage event can amplify knockback and is especially unsafe on 1.21.x.
  let lastServerVelocity = null;

  function packetVelocity(packet) {
    const value = packet?.velocity || packet;
    const x = Number(value?.x ?? packet?.velocityX);
    const y = Number(value?.y ?? packet?.velocityY);
    const z = Number(value?.z ?? packet?.velocityZ);
    if (![x, y, z].every(Number.isFinite)) return null;
    const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 2 ? 1 / 8000 : 1;
    return { x: x * scale, y: y * scale, z: z * scale, at: Date.now() };
  }

  if (bot._client?.on) {
    bot._client.on("entity_velocity", packet => {
      if (!bot.entity || Number(packet?.entityId) !== Number(bot.entity.id)) return;
      const velocity = packetVelocity(packet);
      if (!velocity) return;
      lastServerVelocity = velocity;
      log("[PHYSICS] Server knockback velocity: x=" + velocity.x.toFixed(4) +
        " y=" + velocity.y.toFixed(4) + " z=" + velocity.z.toFixed(4));
    });
  }

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

  function findPlayerByUsername(username) {
    const wanted = String(username || "").trim().toLowerCase();
    if (!wanted) return null;
    return Object.values(bot.players || {}).find(player =>
      String(player?.username || "").toLowerCase() === wanted
    ) || null;
  }

  function permissionFor(username, action) {
    if (String(username).toLowerCase() === ownerKey) return { allowed: true, source: "owner" };
    if (action === "safe_roam") return { allowed: config.movementEnabled === true, source: "autonomous-movement" };
    return { allowed: false, source: "owner-required" };
  }

  function askOwner(requester, action, displayAction = action) {
    const requesterKey = String(requester).toLowerCase();
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
      const ownerPlayer = findPlayerByUsername(owner);
      if (!ownerPlayer) {
        pending.delete(key);
        log("[PERMISSION] Owner " + owner + " is not currently online; permission request #" + id + " was not delivered.");
        try { bot.whisper(requester, "[ZOYA] My owner is not online right now, so I cannot request permission."); } catch {}
        return false;
      }
      bot.whisper(ownerPlayer.username, "[ZOYA PERMISSION #" + id + "] " + requester + " asks me to " + displayAction + ". Reply \"accept " + id + "\" or \"decline " + id + "\".");
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
    const normalized = text.replace(/^\/(?:w|msg|tell|whisper)\s+\S+\s*/i, "").trim();
    const tokens = normalized.toLowerCase().split(/\s+/).filter(Boolean);
    const decisionWord = tokens.find(token => ACCEPT_WORDS.has(token) || DECLINE_WORDS.has(token));
    if (!decisionWord) {
      void answerPlayer(sender, text, "whisper");
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
    try { bot.chat("[ZOYA] Permission granted. I will try that now."); } catch {}
    const result = await execute(request.action, { targetUsername: request.requester, permissionGranted: true });
    try { bot.chat(result ? "[ZOYA] Done." : "[ZOYA] Action could not be completed."); } catch {}
  }

  async function lookAtPlayer(username) {
    const target = findPlayerByUsername(username)?.entity;
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

  function interruptMovement(reason = "interrupted") {
    // Damage/death must immediately yield control without throwing from the
    // Mineflayer health/death event. The previous implementation called this
    // function but did not define it, so the first real hit caused a
    // ReferenceError and could terminate the bridge process.
    const hadTask = Boolean(activeTask);
    if (hadTask) {
      cancelCurrentTask(reason);
    } else {
      try { bot.pathfinder?.setGoal(null); } catch {}
      try { bot.clearControlStates(); } catch {}
      currentGoal = null;
    }
    log("[SAFETY] Movement interrupted: " + reason);
    if (hadTask) {
      // The cancelled task's finally block will wake the brain. Avoid issuing
      // a second request here.
      return;
    }
    wakeBrain();
  }

  function cancelCurrentTask(reason = "cancelled") {
    if (!activeTask) {
      try { bot.pathfinder?.setGoal(null); } catch {}
      try { bot.clearControlStates(); } catch {}
      return false;
    }
    activeTask.cancelled = true;
    activeTask.cancelReason = reason;
    activeTask.token += 1;
    try { bot.pathfinder?.setGoal(null); } catch {}
    try { bot.clearControlStates(); } catch {}
    currentGoal = null;
    log("[TASK] Cancelled #" + activeTask.id + " " + activeTask.action + ": " + reason);
    return true;
  }

  async function waitForTaskIdle(timeoutMs = 5000) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (activeTask && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return !activeTask;
  }

  function taskIsActive(task) {
    return activeTask === task && !task.cancelled;
  }

  async function moveToPlayer(username, distance = 3, task = activeTask, continuous = false) {
    if (!task) return false;
    const targetPlayer = findPlayerByUsername(username);
    const target = targetPlayer?.entity;
    if (!target) {
      log("[TASK] follow_player target not found: " + String(username || "unknown"));
      return false;
    }

    // Continuous follow must use GoalFollow + dynamic=true. Repeated GoalNear
    // snapshots chase stale coordinates and are the main cause of stop/start
    // behavior, same-level dependence, and getting stuck one block behind.
    if (continuous) {
      const goal = new goals.GoalFollow(target, distance);
      currentGoal = "follow_player";
      bot.pathfinder.setGoal(goal, true);

      let lastBotPosition = bot.entity.position.clone();
      let lastTargetPosition = target.position.clone();
      let lastProgressAt = Date.now();
      let lastRecoveryAt = 0;

      while (taskIsActive(task)) {
        const liveTarget = findPlayerByUsername(username)?.entity;
        if (!liveTarget) {
          try { bot.pathfinder.setGoal(null); } catch {}
          return true;
        }

        const now = Date.now();
        const botPosition = bot.entity.position;
        const targetPosition = liveTarget.position;
        const botMoved = botPosition.distanceTo(lastBotPosition);
        const targetMoved = targetPosition.distanceTo(lastTargetPosition);
        const remaining = botPosition.distanceTo(targetPosition);

        if (botMoved >= 0.12 || targetMoved >= 0.12 || remaining <= distance + 0.5) {
          lastProgressAt = now;
          lastBotPosition = botPosition.clone();
          lastTargetPosition = targetPosition.clone();
        }

        // A bounded recovery for genuine stalls. Do not spam jumps or create a
        // second movement controller: briefly reset the same dynamic GoalFollow
        // so Pathfinder rebuilds from the bot's actual current position.
        if (
          now - lastProgressAt >= 2500 &&
          now - lastRecoveryAt >= 2500 &&
          remaining > distance + 1
        ) {
          lastRecoveryAt = now;
          log("[TASK] follow_player stuck recovery: replanning from current position.");
          try { bot.pathfinder.setGoal(null); } catch {}
          if (!taskIsActive(task)) return false;
          bot.pathfinder.setGoal(new goals.GoalFollow(liveTarget, distance), true);
          lastProgressAt = now;
          lastBotPosition = botPosition.clone();
          lastTargetPosition = targetPosition.clone();
        }

        await new Promise(resolve => setTimeout(resolve, 150));
      }

      try { bot.pathfinder.setGoal(null); } catch {}
      return false;
    }

    // One-shot follow/return uses GoalNear deliberately: it has a fixed
    // destination and should resolve when the bot reaches the requested range.
    const targetPosition = target.position.clone();
    try {
      await bot.pathfinder.goto(new goals.GoalNear(
        targetPosition.x,
        targetPosition.y,
        targetPosition.z,
        distance
      ));
      return taskIsActive(task);
    } catch (error) {
      if (taskIsActive(task)) {
        log("[TASK] follow_player pathing failed: " + (error instanceof Error ? error.message : String(error)));
      }
      return false;
    } finally {
      try { bot.pathfinder.setGoal(null); } catch {}
    }
  }

  async function explore(task = activeTask) {
    if (!task) return false;
    const p = bot.entity.position;
    const angle = Math.random() * Math.PI * 2;
    const radius = 16;
    bot.setControlState("sprint", true);
    try {
      if (!taskIsActive(task)) return false;
      await bot.pathfinder.goto(new goals.GoalNear(p.x + Math.cos(angle) * radius, p.y, p.z + Math.sin(angle) * radius, 2));
      return taskIsActive(task);
    } finally {
      bot.setControlState("sprint", false);
    }
  }

  async function collectBlock(block) {
    if (!block || !bot.collectBlock?.collect) return false;
    const before = bot.inventory.items().reduce((n, item) => n + item.count, 0);
    try {
      await bot.collectBlock.collect(block);
    } catch (error) {
      log("[ACTION] collectBlock failed: " + (error instanceof Error ? error.message : String(error)));
      return false;
    }
    const after = bot.inventory.items().reduce((n, item) => n + item.count, 0);
    const remaining = bot.blockAt(block.position);
    return after > before || !remaining || remaining.name === "air";
  }

  async function gatherResources(resourceName = "oak_log", amount = 1, task = activeTask) {
    if (!task) return false;
    const wanted = String(resourceName || "").trim().toLowerCase();
    const targetAmount = Math.max(1, Math.floor(Number(amount) || 1));
    const allowedLogs = new Set(["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log","mangrove_log","cherry_log"]);
    const names = wanted ? new Set([wanted]) : allowedLogs;
    let gathered = 0;

    while (taskIsActive(task) && gathered < targetAmount) {
      const origin = bot.entity.position;
      let best = null;
      let bestDistance = Infinity;

      // Use Mineflayer's indexed block search instead of scanning tens of
      // thousands of block coordinates every iteration.
      const matchingIds = [...names]
        .map(name => bot.registry?.blocksByName?.[name]?.id)
        .filter(id => Number.isInteger(id));
      if (matchingIds.length && typeof bot.findBlocks === "function") {
        const found = bot.findBlocks({
          matching: matchingIds,
          maxDistance: 24,
          count: 32
        });
        for (const position of found) {
          const block = bot.blockAt(position);
          if (!block || !names.has(block.name)) continue;
          const d = block.position.distanceTo(origin);
          if (d < bestDistance) { best = block; bestDistance = d; }
        }
      } else {
        // Fallback for an older/incomplete Mineflayer build.
        for (let dx = -24; dx <= 24; dx++) for (let dy = -8; dy <= 12; dy++) for (let dz = -24; dz <= 24; dz++) {
          const block = bot.blockAt(origin.offset(dx, dy, dz));
          if (!block || !names.has(block.name)) continue;
          const d = block.position.distanceTo(origin);
          if (d < bestDistance) { best = block; bestDistance = d; }
        }
      }
      if (!best) break;
      if (!taskIsActive(task)) return false;
      const countMatching = () => bot.inventory.items()
        .filter(i => wanted ? i.name === wanted : allowedLogs.has(i.name))
        .reduce((n, i) => n + i.count, 0);
      const before = countMatching();
      const collected = await collectBlock(best);
      const after = countMatching();
      if (!collected || after <= before) break;
      gathered += after - before;
    }
    log("[GATHER] Requested " + targetAmount + " " + (wanted || "wood log") + "; gathered approximately " + gathered + ".");
    return gathered >= targetAmount; 
  }

  async function gatherWood(task = activeTask) {
    return gatherResources("", 1, task);
  }

  async function investigateEntity(task = activeTask, entityName = "") {
    if (!task) return false;
    const wanted = String(entityName || "").trim().toLowerCase();
    const p = bot.entity.position;
    const entities = Object.values(bot.entities || {}).filter(e => e && e !== bot.entity && e.position && e.position.distanceTo(p) <= 16 &&
      (!wanted || String(e.username || e.name || e.displayName || "").toLowerCase().includes(wanted)));
    entities.sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p));
    const target = entities[0];
    if (!target) return false;
    bot.setControlState("sprint", true);
    try {
      if (!taskIsActive(task)) return false;
      await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3));
      return taskIsActive(task);
    } finally {
      bot.setControlState("sprint", false);
    }
  }

  async function mineNearest(blockName = "") {
    const origin = bot.entity.position;
    const requested = String(blockName || "").trim().toLowerCase();
    const names = requested
      ? new Set([requested])
      : new Set(["stone","cobblestone","coal_ore","deepslate_coal_ore","iron_ore","deepslate_iron_ore","copper_ore","deepslate_copper_ore"]);
    let best = null;
    let bestDistance = Infinity;
    for (let dx = -8; dx <= 8; dx++) for (let dy = -4; dy <= 6; dy++) for (let dz = -8; dz <= 8; dz++) {
      const block = bot.blockAt(origin.offset(dx, dy, dz));
      if (!block || !names.has(block.name)) continue;
      const d = block.position.distanceTo(origin);
      if (d < bestDistance) { best = block; bestDistance = d; }
    }
    if (!best) return false;
    const before = bot.inventory.items().reduce((n, item) => n + item.count, 0);
    const collected = await collectBlock(best);
    const after = bot.inventory.items().reduce((n, item) => n + item.count, 0);
    return collected && after > before;
  }

  async function craftBasic(itemName = "", amount = 1) {
    const requested = String(itemName || "").trim().toLowerCase().replace(/ /g, "_");
    let item = requested ? bot.registry.itemsByName[requested] : null;
    if (!item) {
      const logs = bot.inventory.items().find(i => /_log$/.test(i.name));
      if (!logs) return false;
      const plankName = logs.name.replace(/_log$/, "_planks");
      item = bot.registry.itemsByName[plankName];
    }
    if (!item) return false;
    const targetAmount = Math.max(1, Math.floor(Number(amount) || 1));
    let craftingTable = null;
    let recipes = bot.recipesFor(item.id, null, targetAmount, null);

    // Some Mineflayer versions only return table recipes when a crafting
    // table is supplied to recipesFor(). Retry with a real nearby table
    // instead of treating a valid table recipe as unavailable.
    if (!recipes.length) {
      const tableId = bot.registry?.blocksByName?.crafting_table?.id;
      craftingTable = tableId != null
        ? bot.findBlock?.({ matching: tableId, maxDistance: 16 }) || null
        : null;
      if (!craftingTable) return false;
      recipes = bot.recipesFor(item.id, null, targetAmount, craftingTable);
    }

    if (!recipes.length) return false;
    const recipe = recipes[0];

    if (recipe.requiresTable && !craftingTable) {
      const tableId = bot.registry?.blocksByName?.crafting_table?.id;
      craftingTable = tableId != null
        ? bot.findBlock?.({ matching: tableId, maxDistance: 16 }) || null
        : null;
      if (!craftingTable) return false;
    }

    if (craftingTable) {
      const distance = craftingTable.position.distanceTo(bot.entity.position);
      if (distance > 3.5) {
        await bot.pathfinder.goto(new goals.GoalNear(
          craftingTable.position.x,
          craftingTable.position.y,
          craftingTable.position.z,
          3
        ));
      }
    }

    const before = bot.inventory.items()
      .filter(i => i.name === item.name)
      .reduce((n, i) => n + i.count, 0);

    // Mineflayer's documented craft() API completes only after the inventory
    // has been updated. Keep this as the single crafting primitive so the
    // runtime does not depend on an optional/non-core craftItem API.
    await bot.craft(recipe, targetAmount, craftingTable);

    const after = bot.inventory.items()
      .filter(i => i.name === item.name)
      .reduce((n, i) => n + i.count, 0);
    return after >= before + targetAmount;
  }

  async function collectNearestDrop(task = activeTask, itemName = "", amount = 1) {
    if (!task) return false;
    const wanted = String(itemName || "").trim().toLowerCase();
    const targetAmount = Math.max(1, Math.floor(Number(amount) || 1));
    let collected = 0;

    while (taskIsActive(task) && collected < targetAmount) {
      const p = bot.entity.position;
      const targets = Object.values(bot.entities || {})
        .filter(e => {
          if (!e || !e.position || e === bot.entity || (e.name !== "item" && e.type !== "object")) return false;
          if (!wanted) return true;
          const dropped = typeof e.getDroppedItem === "function" ? e.getDroppedItem() : null;
          const itemStackName = String(dropped?.name || dropped?.displayName || e.itemStack?.name || e.displayName || "").toLowerCase();
          return itemStackName === wanted || itemStackName.includes(wanted);
        })
        .sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p));
      const target = targets[0];
      if (!target || target.position.distanceTo(p) > 24) break;

      const before = bot.inventory.items().reduce((n, item) => n + item.count, 0);
      bot.setControlState("sprint", true);
      try {
        if (!taskIsActive(task)) return false;
        await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 1.5));
      } catch (error) {
        if (taskIsActive(task)) log("[ACTION] collect pathing failed: " + (error instanceof Error ? error.message : String(error)));
        return false;
      } finally {
        bot.setControlState("sprint", false);
      }
      if (!taskIsActive(task)) return false;
      await new Promise(resolve => setTimeout(resolve, 350));
      const after = bot.inventory.items().reduce((n, item) => n + item.count, 0);
      if (after <= before) break;
      collected += after - before;
    }

    return collected >= targetAmount;
  }

  async function eat(itemName = "") {
    const wanted = String(itemName || "").trim().toLowerCase();
    const item = bot.inventory.items().find(i =>
      wanted ? (i.name.toLowerCase() === wanted || i.name.toLowerCase().includes(wanted)) :
      /bread|apple|carrot|potato|beef|porkchop|chicken|mutton|salmon|cod|steak|cooked|melon|berries|stew/.test(i.name)
    );
    if (!item || (bot.food ?? 20) >= 20) return false;
    const beforeFood = Number(bot.food ?? 20);
    await bot.equip(item, "hand");
    await bot.consume();
    return Number(bot.food ?? beforeFood) > beforeFood;
  }

  async function guardLocation(position, task) {
    if (!task) return false;
    await bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, 2));
    while (taskIsActive(task)) {
      const hostile = Object.values(bot.entities || {})
        .filter(entity => entity?.position &&
          new Set(["zombie","husk","drowned","skeleton","stray","creeper","spider","cave_spider","witch","pillager","vindicator","evoker","ravager","phantom","blaze","magma_cube","silverfish","endermite","guardian","elder_guardian","piglin_brute","hoglin","zoglin"]).has(String(entity.name || "").toLowerCase()) &&
          entity.position.distanceTo(bot.entity.position) <= 12)
        .sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0];

      if (hostile) {
        await equipMatchingForGuard();
        const beforeHealth=Number(hostile.health ?? 1);
        await attackLoopForGuard(hostile);
        if (hostile.health != null && hostile.health >= beforeHealth && taskIsActive(task)) {
          log("[GUARD] Attack attempt did not reduce target health; continuing guard.");
        }
      } else {
        await new Promise(resolve=>setTimeout(resolve,300));
      }
    }
    try { bot.pathfinder.setGoal(null); } catch {}
    return false;
  }

  async function equipMatchingForGuard() {
    const item=bot.inventory.items().find(i=>["sword","axe","trident","mace"].some(word=>i.name.toLowerCase().includes(word)));
    if (item) await bot.equip(item,"hand");
  }

  async function attackLoopForGuard(target) {
    const deadline=Date.now()+5000;
    while (taskIsActive(activeTask) && target && target.isValid!==false && (target.health==null || target.health>0) && Date.now()<deadline) {
      while (taskIsActive(activeTask) && target.isValid!==false && dist(bot.entity.position,target.position)>3.1 && Date.now()<deadline) {
        bot.pathfinder.setGoal(new goals.GoalFollow(target,2.7),true);
        await new Promise(resolve=>setTimeout(resolve,150));
      }
      try { bot.pathfinder.setGoal(null); } catch {}
      if (!taskIsActive(activeTask) || !target.isValid || dist(bot.entity.position,target.position)>3.2) break;
      await bot.lookAt(target.position.offset(0,target.height||1,0),true);
      bot.attack(target);
      await new Promise(resolve=>setTimeout(resolve,450));
    }
    try { bot.pathfinder.setGoal(null); } catch {}
  }

  async function pvp(targetUsername, task) {
    if (!targetUsername) return false;
    let hadTarget = false;

    while (taskIsActive(task)) {
      const target = findPlayerByUsername(targetUsername)?.entity;
      if (!target) return hadTarget;
      if (target.health != null && target.health <= 0) return hadTarget;
      hadTarget = true;

      let distance = target.position.distanceTo(bot.entity.position);
      if (distance > 3.1) {
        // A moving player is a dynamic target. GoalFollow avoids chasing stale
        // coordinate snapshots and lets Pathfinder continuously track them.
        bot.pathfinder.setGoal(new goals.GoalFollow(target, 2.7), true);
        const deadline = Date.now() + 5000;
        while (taskIsActive(task) && Date.now() < deadline) {
          const liveTarget = findPlayerByUsername(targetUsername)?.entity;
          if (!liveTarget) break;
          distance = liveTarget.position.distanceTo(bot.entity.position);
          if (distance <= 3.1) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        try { bot.pathfinder.setGoal(null); } catch {}
        if (!taskIsActive(task)) return false;
      }

      const liveTarget = findPlayerByUsername(targetUsername)?.entity;
      if (!liveTarget) return hadTarget;
      try {
        await bot.lookAt(
          liveTarget.position.offset(0, liveTarget.height ? liveTarget.height * 0.75 : 1.4, 0),
          true
        );
        bot.attack(liveTarget);
      } catch (error) {
        log("[PVP] Attack failed: " + (error instanceof Error ? error.message : String(error)));
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      if ((bot.health ?? 20) <= 0) return false;
    }

    try { bot.pathfinder.setGoal(null); } catch {}
    return false;
  }

  async function execute(action, options = {}) {
    if (busy) {
      log("[TASK] Ignoring new task while '" + (currentGoal || "unknown") + "' is active.");
      return false;
    }
    const unsafeActions = new Set(["safe_roam","explore","gather_basic_resources","mine","chop_tree","investigate_entity","pvp"]);
    if (unsafeActions.has(action) && bot.health != null && (bot.health < 10 || nearbyHostileCount(12) > 0)) {
      log("[SAFETY] Refusing " + action + ": health=" + bot.health + ", hostileMobs=" + nearbyHostileCount(12) + ".");
      wakeBrain();
      return false;
    }
    const movementActions = new Set(["safe_roam","explore","gather_basic_resources","follow_player","return_to_owner","collect","investigate_entity","mine","chop_tree","pvp"]);
    if (movementActions.has(action) && config.movementEnabled !== true && !options.permissionGranted) {
      log("[PERMISSION] Autonomous movement is disabled; action blocked: " + action);
      return false;
    }
    busy = true;
    const task = { id: ++taskSequence, action, targetUsername: options.targetUsername || null, startedAt: Date.now(), cancelled: false, token: 0 };
    activeTask = task;
    currentGoal = action;
    let result = false;
    log("[TASK] Started #" + task.id + " " + action + (task.targetUsername ? " -> " + task.targetUsername : "") + ".");
    try {
      if (action === "safe_roam" || action === "explore") result = await explore(task);
      else if (action === "look_at_player") result = await lookAtPlayer(options.targetUsername || owner);
      else if (action === "gather_basic_resources") result = await gatherResources(options.resourceName || "oak_log", options.amount || 1, task);
       else if (action === "chop_tree") result = await gatherWood(task);
      else if (action === "follow_player") result = await moveToPlayer(options.targetUsername || owner, 3, task, true);
      else if (action === "return_to_owner") result = owner ? await moveToPlayer(owner, 5, task, false) : false;
      else if (action === "eat") result = await eat(options.itemName || "");
      else if (action === "collect") result = await collectNearestDrop(task, options.itemName || "", options.amount || 1);
      else if (action === "investigate_entity") result = await investigateEntity(task, options.entityName || "");
      else if (action === "mine") result = await mineNearest(options.blockName || "");
      else if (action === "craft") result = await craftBasic(options.itemName || "", options.amount || 1);
      else if (action === "pvp") result = await pvp(options.targetUsername, task);
      else if (action === "guard" || action === "guard_location") {
        const position=options.position || bot.entity.position;
        result = await guardLocation(position, task);
      }
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
      const wasActive = activeTask === task;
      if (wasActive) {
        activeTask = null;
        currentGoal = null;
      }
      busy = false;
      log("[TASK] Finished #" + task.id + " " + action + " -> " + (task.cancelled ? "cancelled" : (result === true ? "completed" : "failed")) + ".");
      if (wasActive) wakeBrain();
    }
  }

  async function answerPlayer(username, message, channel = "public") {
    const rawMessage = String(message || "").trim();
    if (!rawMessage) return false;

    // Capability testing is deliberately local-only. Player chat is recorded
    // as input for later planner integration, but it must never call Groq or
    // execute a Groq-selected action in this phase.
    if (capabilityDebugMode) {
      rememberEvent("chat_input", {
        username: String(username || ""),
        channel,
        message: rawMessage.slice(0, 500)
      });
      log("[CHAT] Capability mode: received " + channel + " message from " + String(username || "unknown") + "; Groq/action routing disabled.");
      return false;
    }

    const normalizedMessage = rawMessage.toLowerCase().replace(/[!?.,]+$/g, "").trim();
    const localStop = /^(stop|stop here|wait here|stay here|cancel|cancel task|hold here|don't move|do not move)$/.test(normalizedMessage);
    if (localStop) {
      const cancelled = cancelCurrentTask("player command");
      const reply = cancelled ? "Okay, I'll stop here." : "Okay, I'm staying here.";
      if (channel === "whisper") bot.whisper(username, reply);
      else bot.chat(reply);
      rememberEvent("chat_command", { username, message: rawMessage, command: "stop", cancelled });
      wakeBrain();
      return true;
    }

    // Normal player chat is intentionally left to the future high-level
    // planner architecture. There is no direct Groq call from the runtime.
    rememberEvent("chat_input", { username: String(username || ""), channel, message: rawMessage.slice(0, 500) });
    log("[CHAT] Message recorded for planner: " + String(username || "unknown") + " -> " + rawMessage.slice(0, 180));
    return false;
  }

  bot.on("death", () => { rememberEvent("death", { username: bot.username || "Zoya" }); interruptMovement("death"); });
  bot.on("respawn", () => { rememberEvent("respawn", { username: bot.username || "Zoya" }); wakeBrain(); });
  bot.on("kicked", reason => rememberEvent("kicked", { reason: String(reason || "unknown").slice(0, 300) }));
  let previousHealth = bot.health ?? 20;
  bot.on("health", () => {
    const health = bot.health ?? 0;
    const drop = previousHealth - health;
    rememberEvent("health", { health, food: bot.food ?? null });
    if (drop >= 1) {
      if (lastServerVelocity) {
        const v = lastServerVelocity;
        log("[PHYSICS] Damage " + drop + " health; observed server velocity = (" +
          v.x.toFixed(4) + ", " + v.y.toFixed(4) + ", " + v.z.toFixed(4) + ").");
      } else {
        log("[PHYSICS] Damage " + drop + " health; no server velocity packet observed yet.");
      }
      // Do not modify bot.entity.velocity here. Mineflayer owns the physics
      // integration and must consume exactly the velocity supplied by the server.
      interruptMovement("damage received (" + drop + " health)");
    }
    if (health <= 0) wakeBrain();
    else if (health < 10) wakeBrain();
    previousHealth = health;
  });
  bot.on("whisper", handleWhisper);
  bot.on("chat", (username, message) => {
    if (username === bot.username) return;
    rememberPlayer(username, { lastMessage: String(message).slice(0, 500), interactions: (memory.players[String(username).toLowerCase()]?.interactions || 0) + 1 });
    void answerPlayer(username, message, "public");
  });

  return {
    memory,
    rememberPlayer,
    rememberEvent,
    permissionFor,
    askOwner,
    execute,
    cancelCurrentTask,
    answerPlayer,
    getActiveTask: () => activeTask,
    waitForTaskIdle,
    getStatus: () => ({ ownerUsername: owner || null, pendingPermissions: pending.size, currentGoal, busy, activeTask: activeTask ? { id: activeTask.id, action: activeTask.action, targetUsername: activeTask.targetUsername, startedAt: activeTask.startedAt } : null, memoryPlayers: Object.keys(memory.players).length, memoryEvents: memory.events.length })
  };
}
