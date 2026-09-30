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
  let lastTaskResult = null;

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
    const fromPlayers = Object.values(bot.players || {}).find(player =>
      String(player?.username || "").toLowerCase() === wanted
    );
    if (fromPlayers) return fromPlayers;
    const entity = Object.values(bot.entities || {}).find(candidate =>
      String(candidate?.username || "").toLowerCase() === wanted
    );
    return entity ? { username: entity.username, entity } : null;
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
    const requestId = tokens.find(token => /^\d+$/.test(token));
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
    try { bot.stopDigging?.(); } catch {}
    try { bot.deactivateItem?.(); } catch {}
    // bot.wake() throws synchronously when the bot is already awake on
    // Mineflayer versions that enforce the bed state. Cancellation can happen
    // from a health event at any time, so never call wake() unless the bot is
    // actually sleeping. If the state changes between the check and the call,
    // swallow both synchronous and Promise rejection paths so a safety event
    // can never terminate the bridge process.
    if (bot.isSleeping === true && typeof bot.wake === "function") {
      try {
        void Promise.resolve(bot.wake()).catch(error => {
          log("[SAFETY] Wake during task cancellation was ignored: " +
            (error instanceof Error ? error.message : String(error)));
        });
      } catch (error) {
        log("[SAFETY] Wake during task cancellation was ignored: " +
          (error instanceof Error ? error.message : String(error)));
      }
    }
    try { bot.collectBlock?.cancelTask?.().catch?.(() => {}); } catch {}
    try { void Promise.resolve(bot.currentWindow?.close?.()).catch(() => {}); } catch {}
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
    return activeTask === task && !task.cancelled && activeTask.token === task.token;
  }

  function assertTaskActive(task, stage = "operation") {
    if (!taskIsActive(task)) {
      throw new Error("Task cancelled or superseded during " + stage + ".");
    }
  }

  async function waitTask(task, ms) {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
    assertTaskActive(task, "wait");
  }

  // Task-owned navigation must not depend on pathfinder.goto() resolving after
  // cancellation. goto() can remain pending while Pathfinder is being stopped,
  // which leaves activeTask alive and blocks the next manual capability. Drive
  // the same GoalNear through setGoal() and poll the task token so cancellation
  // becomes an immediate, deterministic lifecycle transition.
  async function gotoTask(task, goal, targetPosition, reachDistance = 2, timeoutMs = 30000, label = "navigation") {
    assertTaskActive(task, label + " start");
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 30000);
    bot.pathfinder.setGoal(goal);
    try {
      while (taskIsActive(task) && Date.now() < deadline) {
        const target = targetPosition?.clone?.() || targetPosition;
        if (target && bot.entity?.position?.distanceTo(target) <= reachDistance) return true;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!taskIsActive(task)) return false;
      task.terminationReason = "path_timeout";
      return false;
    } finally {
      if (activeTask === task) {
        try { bot.pathfinder.setGoal(null); } catch {}
      }
    }
  }

  async function moveToPlayer(username, distance = 3, task = activeTask, continuous = false) {
    if (!task) return false;
    let target = null;
    const lookupDeadline = Date.now() + (continuous ? 3000 : 1500);
    while (Date.now() < lookupDeadline && taskIsActive(task)) {
      target = findPlayerByUsername(username)?.entity || null;
      if (target) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (!target) {
      if (taskIsActive(task)) task.terminationReason = "target_not_found";
      log("[TASK] follow_player target not found after retry window: " + String(username || "unknown"));
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
          if (taskIsActive(task)) task.terminationReason = "target_lost";
          log("[TASK] follow_player target lost: " + String(username || "unknown"));
          return false;
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
      return await gotoTask(
        task,
        new goals.GoalNear(targetPosition.x, targetPosition.y, targetPosition.z, distance),
        targetPosition,
        distance,
        30000,
        "follow navigation"
      );
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
      return await gotoTask(
        task,
        new goals.GoalNear(p.x + Math.cos(angle) * radius, p.y, p.z + Math.sin(angle) * radius, 2),
        new p.constructor(p.x + Math.cos(angle) * radius, p.y, p.z + Math.sin(angle) * radius),
        2,
        30000,
        "explore navigation"
      );
    } finally {
      bot.setControlState("sprint", false);
    }
  }

  async function collectBlock(block, task = activeTask) {
    if (!block || !bot.collectBlock?.collect) return false;
    if (task) assertTaskActive(task, "collect");
    const before = bot.inventory.items().reduce((n, item) => n + item.count, 0);
    try {
      await bot.collectBlock.collect(block);
      if (task) assertTaskActive(task, "collect completion");
    } catch (error) {
      if (task && !taskIsActive(task)) return false;
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
          maxDistance: 32,
          count: 48
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
      const collected = await collectBlock(best, task);
      const after = countMatching();
      if (!collected || after <= before) break;
      gathered += after - before;
    }
    log("[GATHER] Requested " + targetAmount + " " + (wanted || "wood log") + "; gathered approximately " + gathered + ".");
    return gathered >= targetAmount; 
  }

  async function gatherWood(task = activeTask) {
    if (!task) return false;
    const logNames = new Set(["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log","mangrove_log","cherry_log"]);
    const ids = [...logNames].map(name => bot.registry?.blocksByName?.[name]?.id).filter(Number.isInteger);
    if (!ids.length) return false;
    const origin = bot.entity.position;
    const positions = typeof bot.findBlocks === "function"
      ? bot.findBlocks({ matching: ids, maxDistance: 32, count: 64 })
      : [];
    if (!positions.length) {
      log("[GATHER] No nearby tree logs found within 32 blocks.");
      return false;
    }
    let seed = null;
    let best = Infinity;
    for (const position of positions) {
      const block = bot.blockAt(position);
      if (!block || !logNames.has(block.name)) continue;
      const d = block.position.distanceTo(origin);
      if (d < best) { seed = block; best = d; }
    }
    if (!seed) return false;

    const treeBlocks = [];
    const queue = [seed.position.clone()];
    const seen = new Set();
    while (queue.length && treeBlocks.length < 16) {
      const p = queue.shift();
      const key = p.x + "," + p.y + "," + p.z;
      if (seen.has(key)) continue;
      seen.add(key);
      const block = bot.blockAt(p);
      if (!block || !logNames.has(block.name)) continue;
      treeBlocks.push(block);
      for (const d of [
        [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]
      ]) {
        const next = p.offset(d[0],d[1],d[2]);
        if (!seen.has(next.x + "," + next.y + "," + next.z)) queue.push(next);
      }
    }

    if (!treeBlocks.length) return false;
    log("[GATHER] Chopping tree: " + treeBlocks.length + " connected log block(s).");
    for (const block of treeBlocks) {
      assertTaskActive(task, "tree chopping");
      const collected = await collectBlock(block, task);
      if (!collected) return false;
    }
    return true;
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
      return await gotoTask(
        task,
        new goals.GoalNear(target.position.x, target.position.y, target.position.z, 3),
        target.position,
        3,
        30000,
        "entity investigation navigation"
      );
    } finally {
      bot.setControlState("sprint", false);
    }
  }

  async function mineNearest(blockName = "", task = activeTask) {
    if (task) assertTaskActive(task, "mine");
    const origin = bot.entity.position;
    const requested = String(blockName || "").trim().toLowerCase();
    const names = requested
      ? new Set([requested])
      : new Set(["stone","cobblestone","coal_ore","deepslate_coal_ore","iron_ore","deepslate_iron_ore","copper_ore","deepslate_copper_ore"]);
    let best = null;
    let bestDistance = Infinity;
    const ids = [...names].map(name => bot.registry?.blocksByName?.[name]?.id).filter(Number.isInteger);
    if (ids.length && typeof bot.findBlocks === "function") {
      for (const position of bot.findBlocks({ matching: ids, maxDistance: 32, count: 64 })) {
        const block = bot.blockAt(position);
        if (!block || !names.has(block.name)) continue;
        const d = block.position.distanceTo(origin);
        if (d < bestDistance) { best = block; bestDistance = d; }
      }
    }
    if (!best) return false;
    const before = bot.inventory.items().reduce((n, item) => n + item.count, 0);
    const collected = await collectBlock(best, task);
    if (task) assertTaskActive(task, "mine completion");
    const after = bot.inventory.items().reduce((n, item) => n + item.count, 0);
    return collected && after > before;
  }

  async function craftBasic(itemName = "", amount = 1, task = activeTask) {
    if (task) assertTaskActive(task, "craft");
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
    const resultPerCraft = Math.max(1, Number(recipe.result?.count || 1));
    const craftsNeeded = Math.max(1, Math.ceil(targetAmount / resultPerCraft));

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
        const reachedTable = await gotoTask(
          task,
          new goals.GoalNear(
            craftingTable.position.x,
            craftingTable.position.y,
            craftingTable.position.z,
            3
          ),
          craftingTable.position,
          3,
          30000,
          "crafting-table navigation"
        );
        if (!reachedTable) return false;
      }
    }

    const before = bot.inventory.items()
      .filter(i => i.name === item.name)
      .reduce((n, i) => n + i.count, 0);

    // Mineflayer's documented craft() API completes only after the inventory
    // has been updated. Keep this as the single crafting primitive so the
    // runtime does not depend on an optional/non-core craftItem API.
    if (task) assertTaskActive(task, "craft start");
    await bot.craft(recipe, craftsNeeded, craftingTable);
    if (task) assertTaskActive(task, "craft completion");

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
        const reachedDrop = await gotoTask(
          task,
          new goals.GoalNear(target.position.x, target.position.y, target.position.z, 1.5),
          target.position,
          1.5,
          30000,
          "item collection navigation"
        );
        if (!reachedDrop) return false;
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

  async function eat(itemName = "", task = activeTask) {
    if (task) assertTaskActive(task, "eat");
    const wanted = String(itemName || "").trim().toLowerCase();
    const item = bot.inventory.items().find(i =>
      wanted ? (i.name.toLowerCase() === wanted || i.name.toLowerCase().includes(wanted)) :
      /bread|apple|carrot|potato|beef|porkchop|chicken|mutton|salmon|cod|steak|cooked|melon|berries|stew/.test(i.name)
    );
    if (!item || (bot.food ?? 20) >= 20) return false;
    const beforeFood = Number(bot.food ?? 20);
    if (task) assertTaskActive(task, "eat start");
    await bot.equip(item, "hand");
    if (task) assertTaskActive(task, "eat equipped");
    await bot.consume();
    if (task) assertTaskActive(task, "eat completion");
    return Number(bot.food ?? beforeFood) > beforeFood;
  }

  async function guardLocation(position, task) {
    if (!task) return false;
    assertTaskActive(task, "guard navigation");
    const reachedGuard = await gotoTask(
      task,
      new goals.GoalNear(position.x, position.y, position.z, 2),
      position,
      2,
      30000,
      "guard navigation"
    );
    if (!reachedGuard) return false;
    assertTaskActive(task, "guard navigation completion");
    await equipMatchingForGuard();

    const guardHostiles = new Set([
      "zombie","husk","drowned","skeleton","stray","creeper","spider","cave_spider",
      "witch","pillager","vindicator","evoker","ravager","phantom","blaze","magma_cube",
      "silverfish","endermite","guardian","elder_guardian","piglin_brute","hoglin","zoglin"
    ]);

    while (taskIsActive(task)) {
      const hostile = Object.values(bot.entities || {})
        .filter(entity =>
          entity?.position &&
          guardHostiles.has(String(entity.name || "").toLowerCase()) &&
          entity.position.distanceTo(bot.entity.position) <= 12
        )
        .sort((a, b) =>
          a.position.distanceTo(bot.entity.position) -
          b.position.distanceTo(bot.entity.position)
        )[0];

      if (hostile) {
        await equipMatchingForGuard();
        const beforeHealth = Number(hostile.health ?? 1);
        await attackLoopForGuard(hostile);
        if (hostile.health != null && hostile.health >= beforeHealth && taskIsActive(task)) {
          log("[GUARD] Attack attempt did not reduce target health; continuing guard.");
        }

        // Re-establish the guard position after combat if knockback/pathing
        // moved Zoya away from the post. This uses the same task-owned
        // Pathfinder controller and never creates a second movement loop.
        if (taskIsActive(task) &&
            bot.entity.position.distanceTo(position) > 3) {
          await gotoTask(
            task,
            new goals.GoalNear(position.x, position.y, position.z, 2),
            position,
            2,
            15000,
            "guard position recovery"
          );
          if (taskIsActive(task)) await equipMatchingForGuard();
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
    try { bot.pathfinder.setGoal(null); } catch {}
    return false;
  }

  async function equipMatchingForGuard() {
    const materialRank = [
      ["netherite", 7],
      ["diamond", 6],
      ["iron", 5],
      ["stone", 4],
      ["golden", 3],
      ["wooden", 2]
    ];
    const weaponRank = [
      ["mace", 4],
      ["sword", 3],
      ["axe", 2],
      ["trident", 1]
    ];
    const candidates = bot.inventory.items().filter(item => {
      const name = String(item.name || "").toLowerCase();
      return weaponRank.some(([weapon]) => name.includes(weapon));
    });
    candidates.sort((a, b) => {
      const score = item => {
        const name = String(item.name || "").toLowerCase();
        const material = materialRank.find(([prefix]) => name.includes(prefix))?.[1] || 0;
        const weapon = weaponRank.find(([kind]) => name.includes(kind))?.[1] || 0;
        return material * 10 + weapon;
      };
      return score(b) - score(a);
    });
    const best = candidates[0];
    if (!best) return false;
    await bot.equip(best, "hand");
    log("[GUARD] Equipped best available weapon: " + best.name + ".");
    return true;
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
      if (!target) {
        if (hadTarget && taskIsActive(task)) {
          task.terminationReason = "target_lost";
          log("[TASK] pvp target lost: " + String(targetUsername || "unknown"));
        } else if (taskIsActive(task)) {
          task.terminationReason = "target_not_found";
        }
        return false;
      }
      if (target.health != null && target.health <= 0) {
        task.terminationReason = "target_defeated";
        return hadTarget;
      }
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
      if (!liveTarget) {
        if (hadTarget && taskIsActive(task)) task.terminationReason = "target_lost";
        return false;
      }
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
      if (!taskIsActive(task)) return false;
      const postTarget = findPlayerByUsername(targetUsername)?.entity;
      if (postTarget?.health != null && postTarget.health <= 0) {
        task.terminationReason = "target_defeated";
        return true;
      }
      if ((bot.health ?? 20) <= 0) {
        task.terminationReason = "zoya_died";
        return false;
      }
    }

    try { bot.pathfinder.setGoal(null); } catch {}
    return false;
  }

  async function runManualCapability(action, operation) {
    if (busy || activeTask) {
      throw new Error("Another Minecraft task is already active.");
    }
    const task = {
      id: ++taskSequence,
      action: "manual:" + String(action || "capability"),
      targetUsername: null,
      startedAt: Date.now(),
      cancelled: false,
      token: 0,
      terminationReason: null
    };
    activeTask = task;
    busy = true;
    currentGoal = task.action;
    log("[TASK] Started #" + task.id + " " + task.action + ".");
    let result = false;
    try {
      result = await operation(task);
      if (!taskIsActive(task)) return false;
      return result === true;
    } catch (error) {
      if (taskIsActive(task)) {
        log("[TASK] Manual capability failed: " + (error instanceof Error ? error.message : String(error)));
      }
      return false;
    } finally {
      const wasActive = activeTask === task;
      if (wasActive) {
        activeTask = null;
        currentGoal = null;
      }
      busy = false;
      lastTaskResult = {
        id: task.id,
        action: task.action,
        targetUsername: null,
        status: task.cancelled ? "cancelled" : (result === true ? "completed" : "failed"),
        reason: task.cancelReason || task.terminationReason || null,
        startedAt: task.startedAt,
        finishedAt: Date.now()
      };
      log("[TASK] Finished #" + task.id + " " + task.action + " -> " + lastTaskResult.status + (lastTaskResult.reason ? " (" + lastTaskResult.reason + ")" : "") + ".");
      if (wasActive) wakeBrain();
    }
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
    const task = { id: ++taskSequence, action, targetUsername: options.targetUsername || null, startedAt: Date.now(), cancelled: false, token: 0, terminationReason: null };
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
      else if (action === "eat") result = await eat(options.itemName || "", task);
      else if (action === "collect") result = await collectNearestDrop(task, options.itemName || "", options.amount || 1);
      else if (action === "investigate_entity") result = await investigateEntity(task, options.entityName || "");
      else if (action === "mine") result = await mineNearest(options.blockName || "", task);
      else if (action === "craft") result = await craftBasic(options.itemName || "", options.amount || 1, task);
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
      lastTaskResult = {
        id: task.id,
        action: task.action,
        targetUsername: task.targetUsername,
        status: task.cancelled ? "cancelled" : (result === true ? "completed" : "failed"),
        reason: task.cancelReason || task.terminationReason || null,
        startedAt: task.startedAt,
        finishedAt: Date.now()
      };
      log("[TASK] Finished #" + task.id + " " + action + " -> " + lastTaskResult.status +
        (lastTaskResult.reason ? " (" + lastTaskResult.reason + ")" : "") + ".");
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
      // Taking a hit is a normal Minecraft event, not a task cancellation.
      // In particular PvP, guard, defend, escort and protection tasks are
      // expected to receive damage while their task is active. The previous
      // global interrupt here cancelled the active task on every health drop,
      // which made PvP stop as soon as the opponent hit Zoya.
      //
      // Mineflayer remains the sole owner of physics/knockback. We only record
      // the event and let the active task's own safety/termination rules decide
      // whether it should continue or end. Death still cancels through the
      // dedicated death handler above.
      log("[SAFETY] Damage observed; preserving active task ownership.");
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
    runManualCapability,
    cancelCurrentTask,
    answerPlayer,
    getActiveTask: () => activeTask,
    getLastTaskResult: () => lastTaskResult,
    waitForTaskIdle,
    getStatus: () => ({ ownerUsername: owner || null, pendingPermissions: pending.size, currentGoal, busy, activeTask: activeTask ? { id: activeTask.id, action: activeTask.action, targetUsername: activeTask.targetUsername, startedAt: activeTask.startedAt } : null, memoryPlayers: Object.keys(memory.players).length, memoryEvents: memory.events.length })
  };
}
