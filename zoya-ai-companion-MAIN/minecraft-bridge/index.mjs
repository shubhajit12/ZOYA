import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import mineflayer from "mineflayer";

const PORT = Number(process.env.ZOYA_MINECRAFT_BRIDGE_PORT || 32123);
const CONFIG_PATH = process.env.ZOYA_MINECRAFT_CONFIG ||
  path.join(process.env.APPDATA || process.cwd(), "com.zoya.aicompanion", "minecraft", "config.json");

function debugTimestamp() { return new Date().toISOString(); }
function debugLog(message) { process.stdout.write("[" + debugTimestamp() + "] " + message + "\n"); }
function debugWarn(message) { process.stderr.write("[" + debugTimestamp() + "] " + message + "\n"); }
function debugError(message) { process.stderr.write("[" + debugTimestamp() + "] " + message + "\n"); }

const state = { status: "DISCONNECTED", connected: false, host: null, port: null, username: null, version: null, error: null, startedAt: new Date().toISOString() };
let bot = null;
let latestMinecraftState = {
  available: false,
  timestamp: new Date().toISOString(),
  player: null,
  world: null,
  environment: null,
  nearbyEntities: [],
  inventory: [],
  selectedItem: null,
  game: null
};

let lastLoggedState = null;
let lastHeartbeatAt = 0;
let lastEntityIds = new Set();
const POSITION_LOG_THRESHOLD = 0.5;
const HEARTBEAT_INTERVAL_MS = 30000;
const MOVEMENT_MIN_DELAY_MS = 7000;
const MOVEMENT_MAX_DELAY_MS = 14000;
const MOVEMENT_MIN_DURATION_MS = 1200;
const MOVEMENT_MAX_DURATION_MS = 3500;
let movementEnabled = false;
let movementTimer = null;
let movementStopTimer = null;
let movementAction = "idle";

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function stopMovement(reason = "stopped") {
  if (movementTimer) { clearTimeout(movementTimer); movementTimer = null; }
  if (movementStopTimer) { clearTimeout(movementStopTimer); movementStopTimer = null; }
  if (bot) {
    try {
      bot.clearControlStates();
      movementAction = "idle";
    } catch {}
  }
  if (reason) debugLog("[MOVEMENT] " + reason);
}

function scheduleNaturalMovement() {
  if (!movementEnabled || !bot || state.status !== "CONNECTED") return;
  if (movementTimer) clearTimeout(movementTimer);
  movementTimer = setTimeout(() => performNaturalMovement(), randomBetween(MOVEMENT_MIN_DELAY_MS, MOVEMENT_MAX_DELAY_MS));
}

async function performNaturalMovement() {
  if (!movementEnabled || !bot || state.status !== "CONNECTED") return;

  const yawDelta = (randomBetween(-90, 90) * Math.PI) / 180;
  const currentYaw = bot.entity?.yaw ?? 0;
  const targetYaw = currentYaw + yawDelta;
  const pitch = Math.max(-0.35, Math.min(0.35, (bot.entity?.pitch ?? 0) + ((randomBetween(-12, 12) * Math.PI) / 180)));
  const duration = randomBetween(MOVEMENT_MIN_DURATION_MS, MOVEMENT_MAX_DURATION_MS);

  try {
    await bot.look(targetYaw, pitch, true);
    bot.setControlState("forward", true);
    movementAction = "walking";
    debugLog("[MOVEMENT] Walking naturally for " + (duration / 1000).toFixed(1) + "s after looking in a new direction.");

    if (movementStopTimer) clearTimeout(movementStopTimer);
    movementStopTimer = setTimeout(() => {
      if (!bot) return;
      try {
        bot.clearControlStates();
        movementAction = "idle";
        debugLog("[MOVEMENT] Stopped walking.");
      } catch {}
      scheduleNaturalMovement();
    }, duration);
  } catch (error) {
    debugWarn("[MOVEMENT] Natural movement skipped: " + (error instanceof Error ? error.message : String(error)));
    scheduleNaturalMovement();
  }
}

function configureMovement(config) {
  movementEnabled = config.movementEnabled === true;
  stopMovement(null);
  if (movementEnabled) {
    debugLog("[MOVEMENT] Natural movement enabled.");
    scheduleNaturalMovement();
  } else {
    debugLog("[MOVEMENT] Natural movement disabled.");
  }
}

function distance3d(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function inventorySignature(inventory) {
  return (inventory || [])
    .map(item => [item.slot, item.name, item.count, item.durabilityUsed, item.maxDurability].join(":"))
    .sort()
    .join("|");
}

function logMinecraftState() {
  const current = latestMinecraftState;
  if (!current?.available || !current.player) return;

  const now = Date.now();
  const p = current.player;
  const nearby = current.nearbyEntities || [];
  const nearbyIds = new Set(
    nearby.map(entity => String(entity.id ?? (entity.type + ":" + (entity.username || entity.name || "unknown"))))
  );
  const currentInventorySignature = inventorySignature(current.inventory);
  const currentPosition = p.position;

  if (!lastLoggedState) {
    debugLog("[STATE] Position: X=" + currentPosition.x + " Y=" + currentPosition.y + " Z=" + currentPosition.z);
    debugLog("[STATE] Health: " + (p.health ?? "?") + " | Hunger: " + (p.food ?? "?") + " | XP: Lv." + (p.experience?.level ?? 0) + " (" + Math.round((p.experience?.progress ?? 0) * 100) + "%)");
    debugLog("[STATE] Dimension: " + (current.world?.dimension || "unknown") + " | Time: " + (current.world?.timeOfDay ?? "?") + " | Day: " + (current.world?.day ?? "?") + " | Rain=" + (current.world?.isRaining ? "YES" : "NO") + " | Thunder=" + (current.world?.thunderState ?? "?"));
    debugLog("[STATE] Held: " + (current.selectedItem?.displayName || "empty") + " | Nearby: " + nearby.length);
    if (current.environment) {
      debugLog("[STATE] Below: " + (current.environment.blockBelowDisplayName || current.environment.blockBelow || "unknown") + " | Light=" + (current.environment.light ?? "?") + " | Sky Light=" + (current.environment.skyLight ?? "?"));
    }
    lastHeartbeatAt = now;
  } else {
    if (distance3d(currentPosition, lastLoggedState.position) >= POSITION_LOG_THRESHOLD) {
      debugLog("[EVENT] Position changed → X=" + currentPosition.x + " Y=" + currentPosition.y + " Z=" + currentPosition.z);
      lastLoggedState.position = { ...currentPosition };
    }

    if (p.health !== lastLoggedState.health) {
      debugLog("[EVENT] Health changed: " + lastLoggedState.health + " -> " + p.health);
      if (lastLoggedState.health > 0 && p.health <= 0) debugLog("[EVENT] Zoya died (health reached 0).");
      if (lastLoggedState.health <= 0 && p.health > 0) debugLog("[EVENT] Zoya respawned (health restored).");
    }

    if (p.food !== lastLoggedState.food) {
      debugLog("[EVENT] Hunger changed: " + lastLoggedState.food + " -> " + p.food);
    }

    const currentHeld = current.selectedItem?.name || null;
    if (currentHeld !== lastLoggedState.held) {
      debugLog("[EVENT] Held item changed: " + (lastLoggedState.held || "empty") + " -> " + (currentHeld || "empty"));
    }

    const currentXp = p.experience || {};
    if (currentXp.level !== lastLoggedState.xpLevel || currentXp.points !== lastLoggedState.xpPoints) {
      debugLog("[EVENT] XP changed: Lv." + (lastLoggedState.xpLevel ?? 0) + " (" + (lastLoggedState.xpPoints ?? 0) + " pts) -> Lv." + (currentXp.level ?? 0) + " (" + (currentXp.points ?? 0) + " pts)");
    }

    if (currentInventorySignature !== lastLoggedState.inventorySignature) {
      debugLog("[EVENT] Inventory changed.");
    }

    const currentBlockBelow = current.environment?.blockBelow || null;
    if (currentBlockBelow !== lastLoggedState.blockBelow) {
      debugLog("[EVENT] Block below changed: " + (lastLoggedState.blockBelow || "unknown") + " -> " + (currentBlockBelow || "unknown"));
    }

    for (const entity of nearby) {
      const id = String(entity.id ?? (entity.type + ":" + (entity.username || entity.name || "unknown")));
      if (!lastEntityIds.has(id)) {
        debugLog("[EVENT] Entity detected: " + (entity.username || entity.displayName || entity.name || entity.type || "unknown") + " (distance " + entity.distance + "m)");
      }
    }

    for (const id of lastEntityIds) {
      if (!nearbyIds.has(id)) {
        debugLog("[EVENT] Entity left nearby range: " + id);
      }
    }

    if (lastLoggedState.isRaining !== current.world?.isRaining) {
      debugLog("[EVENT] Rain changed: " + (lastLoggedState.isRaining ? "ON" : "OFF") + " -> " + (current.world?.isRaining ? "ON" : "OFF"));
    }

    if (lastLoggedState.thunderState !== current.world?.thunderState) {
      debugLog("[EVENT] Thunder changed: " + (lastLoggedState.thunderState ?? "?") + " -> " + (current.world?.thunderState ?? "?"));
    }

    if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
      debugLog("[HEARTBEAT] Zoya online | Health=" + (p.health ?? "?") + " | Pos=(" + currentPosition.x + "," + currentPosition.y + "," + currentPosition.z + ") | Nearby=" + nearby.length + " | Rain=" + (current.world?.isRaining ? "YES" : "NO") + " | Movement=" + movementAction);
      lastHeartbeatAt = now;
    }
  }

  lastLoggedState = {
    health: p.health,
    food: p.food,
    held: current.selectedItem?.name || null,
    isRaining: current.world?.isRaining ?? null,
    thunderState: current.world?.thunderState ?? null,
    position: { ...currentPosition },
    xpLevel: p.experience?.level ?? 0,
    xpPoints: p.experience?.points ?? 0,
    inventorySignature: currentInventorySignature,
    blockBelow: current.environment?.blockBelow || null
  };
  lastEntityIds = nearbyIds;
}

function serializeItem(item) {
  if (!item) return null;
  return { name: item.name || null, displayName: item.displayName || item.name || null, type: item.type ?? null, count: item.count ?? 0, slot: item.slot ?? null, stackSize: item.stackSize ?? null, durabilityUsed: item.durabilityUsed ?? null, maxDurability: item.maxDurability ?? null };
}

function collectMinecraftState() {
  if (!bot || !bot.entity) {
    latestMinecraftState = { available: false, timestamp: new Date().toISOString(), player: null, world: null, environment: null, nearbyEntities: [], inventory: [], selectedItem: null, game: null };
    return latestMinecraftState;
  }
  const position = bot.entity.position;
  const inventory = Array.isArray(bot.inventory?.slots) ? bot.inventory.slots.filter(Boolean).map(serializeItem) : [];
  const nearbyEntities = Object.values(bot.entities || {})
    .filter(entity => entity && entity !== bot.entity && entity.position && entity.position.distanceTo(position) <= 16)
    .slice(0, 32)
    .map(entity => ({ id: entity.id ?? null, type: entity.type || null, name: entity.name || entity.displayName || null, username: entity.username || null, position: { x: Number(entity.position.x.toFixed(3)), y: Number(entity.position.y.toFixed(3)), z: Number(entity.position.z.toFixed(3)) }, distance: Number(entity.position.distanceTo(position).toFixed(2)), health: entity.health ?? null }));

  let environment = null;
  try {
    const block = bot.blockAt(position.offset(0, -1, 0));
    environment = { blockBelow: block?.name || null, blockBelowDisplayName: block?.displayName || block?.name || null, light: block?.light ?? null, skyLight: block?.skyLight ?? null };
  } catch {}

  latestMinecraftState = {
    available: true,
    timestamp: new Date().toISOString(),
    player: {
      username: bot.username || "Zoya",
      position: { x: Number(position.x.toFixed(3)), y: Number(position.y.toFixed(3)), z: Number(position.z.toFixed(3)) },
      yaw: bot.entity.yaw ?? null,
      pitch: bot.entity.pitch ?? null,
      health: bot.health ?? bot.entity.health ?? null,
      food: bot.food ?? null,
      saturation: bot.foodSaturation ?? null,
      experience: bot.experience ? { level: bot.experience.level ?? 0, points: bot.experience.points ?? 0, progress: bot.experience.progress ?? 0 } : null
    },
    world: {
      dimension: bot.game?.dimension || bot.game?.levelType || null,
      serverHost: state.host,
      serverPort: state.port,
      version: bot.version || state.version || null,
      timeOfDay: bot.time?.time ?? null,
      day: bot.time?.day ?? null,
      isRaining: bot.isRaining ?? null,
      thunderState: bot.thunderState ?? null
    },
    environment,
    nearbyEntities,
    inventory,
    selectedItem: serializeItem(bot.heldItem),
    game: { gameMode: bot.game?.gameMode ?? null, difficulty: bot.game?.difficulty ?? null, hardcore: bot.game?.hardcore ?? null, levelType: bot.game?.levelType ?? null }
  };
  logMinecraftState();
  return latestMinecraftState;
}

function writeConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch { return null; }
}
function snapshot() { return { ...state, configPath: CONFIG_PATH }; }
function setState(status, patch = {}) { Object.assign(state, { status, ...patch, connected: status === "CONNECTED" }); }

function applyConfiguredSkin(config) {
  const skinUrl = String(config.skinUrl || "").trim();
  const provider = config.skinProvider || "auto";
  if (!skinUrl || provider === "disabled" || !bot) return;

  const defaultCommand = '/skin url "%URL%"';
  const template = provider === "custom"
    ? String(config.skinCommand || defaultCommand)
    : defaultCommand;

  if (!template.includes("%URL%")) {
    debugWarn("[ZOYA Minecraft Bridge] Skin command ignored: template must contain %URL%.");
    return;
  }

  const escapedUrl = skinUrl.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const command = template
    .replace(/%URL%/g, escapedUrl)
    .replace(/%USERNAME%/g, bot.username || "Zoya");

  debugLog(`[ZOYA Minecraft Bridge] Applying configured skin using provider mode: ${provider}`);
  debugLog(`[ZOYA Minecraft Bridge] Skin command: ${command.replace(escapedUrl, "<skin-url>")}`);

  setTimeout(() => {
    try {
      if (bot) bot.chat(command);
    } catch (error) {
      debugError(`[ZOYA Minecraft Bridge] Skin command failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, 750);
}

function disconnect() {
  lastLoggedState = null;
  lastEntityIds = new Set();
  lastHeartbeatAt = 0;
  stopMovement(null);
  if (bot) { try { bot.quit(); } catch {} bot = null; }
  setState("DISCONNECTED", { host: null, port: null, username: null, version: null, error: null });
}

function connect(config) {
  disconnect();
  const host = String(config.host || "127.0.0.1");
  const port = Number(config.port || 25565);
  const username = String(config.username || "Zoya");
  const auth = config.auth === "microsoft" ? "microsoft" : "offline";
  const version = config.version ? String(config.version) : false;
  setState("CONNECTING", { host, port, username, version: version || null, error: null });
  try {
    bot = mineflayer.createBot({ host, port, username, auth, ...(version ? { version } : {}) });
    bot.once("login", () => {
      debugLog("[EVENT] Zoya joined the Minecraft world.");
      debugLog(`[ZOYA Minecraft Bridge] Mineflayer login: ${bot?.username || username}`);
      setState("CONNECTED", { host, port, username: bot?.username || username, version: bot?.version || version || null, error: null });
      applyConfiguredSkin(config);
      configureMovement(config);
    });
    bot.once("kicked", reason => {
      const message = typeof reason === "string" ? reason : JSON.stringify(reason);
      debugError(`[ZOYA Minecraft Bridge] Bot kicked: ${message}`);
      state.error = `Kicked by Minecraft server: ${message}`;
    });
    bot.once("death", () => {
      debugLog("[EVENT] Zoya died. Waiting for respawn/state recovery.");
    });
    bot.once("respawn", () => {
      debugLog("[EVENT] Zoya respawned.");
      collectMinecraftState();
    });
    bot.once("end", reason => {
      bot = null;
      const message = reason ? String(reason) : state.error;
      if (state.status === "ERROR" || state.error) {
        setState("ERROR", { error: state.error || message || "Minecraft connection ended." });
      } else {
        setState("DISCONNECTED", { error: message || null });
      }
    });
    bot.once("error", error => {
      const message = error instanceof Error ? error.message : String(error);
      debugError(`[ZOYA Minecraft Bridge] Mineflayer error: ${message}`);
      setState("ERROR", { error: message });
    });
  } catch (error) {
    setState("ERROR", { error: error instanceof Error ? error.message : String(error) });
  }
}

function send(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/status") return send(res, 200, snapshot());
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, service: "zoya-minecraft-bridge", ...snapshot() });
  if (req.method === "GET" && url.pathname === "/state") return send(res, 200, collectMinecraftState());
  if (req.method === "POST" && url.pathname === "/connect") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try { const config = JSON.parse(body || "{}"); writeConfig(config); connect(config); send(res, 202, snapshot()); }
      catch (error) { send(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/disconnect") { disconnect(); return send(res, 200, snapshot()); }
  if (req.method === "POST" && url.pathname === "/movement/start") {
    movementEnabled = true;
    scheduleNaturalMovement();
    debugLog("[MOVEMENT] Natural movement started by command.");
    return send(res, 200, { ...snapshot(), movementEnabled: true, movementAction });
  }
  if (req.method === "POST" && url.pathname === "/movement/stop") {
    movementEnabled = false;
    stopMovement("Natural movement stopped by command.");
    return send(res, 200, { ...snapshot(), movementEnabled: false, movementAction });
  }
  if (req.method === "POST" && url.pathname === "/shutdown") {
    disconnect();
    send(res, 200, { ...snapshot(), shuttingDown: true });
    setTimeout(() => server.close(() => process.exit(0)), 50);
    return;
  }
  send(res, 404, { error: "Not found" });
});

server.on("clientError", (error, socket) => {
  debugError(`[ZOYA Minecraft Bridge] HTTP client error: ${error.message}`);
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\\r\\nConnection: close\\r\\n\\r\\n");
});

const stateTicker = setInterval(() => collectMinecraftState(), 500);

server.listen(PORT, "127.0.0.1", () => {
  debugLog(`[ZOYA Minecraft Bridge] Listening on http://127.0.0.1:${PORT}`);
  const config = readConfig() || {
    host: "127.0.0.1",
    port: 25565,
    username: "Zoya",
    auth: "offline",
    autoConnect: true
  };
  if (config.autoConnect === true) connect(config);
});
function shutdown() { clearInterval(stateTicker); disconnect(); server.close(() => process.exit(0)); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
