import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import mineflayer from "mineflayer";
import { createZoyaBrain } from "./zoyaBrain.mjs";
import { createMinecraftRuntime } from "./minecraftRuntime.mjs";

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
// Autonomous movement is a brain capability, not a second movement loop.
// Keeping one movement writer prevents natural-walk timers from fighting pathfinder actions.
let movementEnabled = false;
let currentConfig = null;
let zoyaBrain = null;
let minecraftRuntime = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
function setMovementEnabled(enabled) {
  movementEnabled = enabled === true;
  if (currentConfig) currentConfig.movementEnabled = movementEnabled;
  if (!movementEnabled && bot) { try { bot.clearControlStates(); } catch {} }
  debugLog("[MOVEMENT] Autonomous movement " + (movementEnabled ? "enabled." : "disabled."));
}
function ensureZoyaBrain() {
  if (zoyaBrain) return zoyaBrain;
  zoyaBrain = createZoyaBrain({
    getMinecraftState: () => latestMinecraftState,
    getConfig: () => currentConfig,
    isMovementEnabled: () => movementEnabled,
    roam: async () => minecraftRuntime ? minecraftRuntime.execute("safe_roam") : false,
    executeAction: async (action, options = {}) => minecraftRuntime ? minecraftRuntime.execute(action, options) : false,
    getMemory: () => minecraftRuntime ? { players: minecraftRuntime.memory.players, events: minecraftRuntime.memory.events.slice(-30) } : null,
    log: debugLog
  });
  return zoyaBrain;
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
      debugLog("[HEARTBEAT] Zoya online | Health=" + (p.health ?? "?") + " | Pos=(" + currentPosition.x + "," + currentPosition.y + "," + currentPosition.z + ") | Nearby=" + nearby.length + " | Rain=" + (current.world?.isRaining ? "YES" : "NO") + " | AutonomousMovement=" + (movementEnabled ? "ON" : "OFF"));
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
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempt = 0;
  if (zoyaBrain) zoyaBrain.stop();
  movementEnabled = false;
  if (bot) { try { bot.clearControlStates(); } catch {} }
  minecraftRuntime = null;
  lastLoggedState = null;
  lastEntityIds = new Set();
  lastHeartbeatAt = 0;
  if (bot) { try { bot.quit(); } catch {} bot = null; }
  setState("DISCONNECTED", { host: null, port: null, username: null, version: null, error: null });
}

function connect(config) {
  currentConfig = config;
  ensureZoyaBrain();
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
      reconnectAttempt = 0;
      setState("CONNECTED", { host, port, username: bot?.username || username, version: bot?.version || version || null, error: null });
      applyConfiguredSkin(config);
      setMovementEnabled(config.movementEnabled === true);
      minecraftRuntime = createMinecraftRuntime({ bot, config, stateDir: path.dirname(CONFIG_PATH), log: debugLog });
      ensureZoyaBrain().start();
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
      minecraftRuntime = null;
      const message = reason ? String(reason) : state.error;
      if (state.status === "ERROR" || state.error) {
        setState("ERROR", { error: state.error || message || "Minecraft connection ended." });
      } else {
        setState("DISCONNECTED", { error: message || null });
        if (currentConfig?.autoReconnect !== false) {
          const delay = Math.min(30000, 2000 * Math.max(1, 2 ** Math.min(reconnectAttempt, 4)));
          reconnectAttempt += 1;
          debugLog("[RECONNECT] Minecraft connection ended; retrying in " + Math.round(delay / 1000) + "s.");
          reconnectTimer = setTimeout(() => connect(currentConfig), delay);
        }
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
  if (req.method === "GET" && url.pathname === "/brain") return send(res, 200, ensureZoyaBrain().status());
  if (req.method === "POST" && url.pathname === "/brain/think") { void ensureZoyaBrain().thinkNow(); return send(res, 202, { ok: true }); }
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
    setMovementEnabled(true);
    return send(res, 200, { ...snapshot(), movementEnabled: true });
  }
  if (req.method === "POST" && url.pathname === "/movement/stop") {
    setMovementEnabled(false);
    return send(res, 200, { ...snapshot(), movementEnabled: false });
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
    autoConnect: true,
    autoReconnect: true
  };
  if (config.autoConnect === true) connect(config);
});
function shutdown() { clearInterval(stateTicker); disconnect(); server.close(() => process.exit(0)); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
