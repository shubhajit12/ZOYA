import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import mineflayer from "mineflayer";

const PORT = Number(process.env.ZOYA_MINECRAFT_BRIDGE_PORT || 32123);
const CONFIG_PATH = process.env.ZOYA_MINECRAFT_CONFIG ||
  path.join(process.env.APPDATA || process.cwd(), "com.zoya.aicompanion", "minecraft", "config.json");

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
    console.warn("[ZOYA Minecraft Bridge] Skin command ignored: template must contain %URL%.");
    return;
  }

  const escapedUrl = skinUrl.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const command = template
    .replace(/%URL%/g, escapedUrl)
    .replace(/%USERNAME%/g, bot.username || "Zoya");

  console.log(`[ZOYA Minecraft Bridge] Applying configured skin using provider mode: ${provider}`);
  console.log(`[ZOYA Minecraft Bridge] Skin command: ${command.replace(escapedUrl, "<skin-url>")}`);

  setTimeout(() => {
    try {
      if (bot) bot.chat(command);
    } catch (error) {
      console.error(`[ZOYA Minecraft Bridge] Skin command failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, 750);
}

function disconnect() {
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
      console.log(`[ZOYA Minecraft Bridge] Mineflayer login: ${bot?.username || username}`);
      setState("CONNECTED", { host, port, username: bot?.username || username, version: bot?.version || version || null, error: null });
      applyConfiguredSkin(config);
    });
    bot.once("kicked", reason => {
      const message = typeof reason === "string" ? reason : JSON.stringify(reason);
      console.error(`[ZOYA Minecraft Bridge] Bot kicked: ${message}`);
      state.error = `Kicked by Minecraft server: ${message}`;
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
      console.error(`[ZOYA Minecraft Bridge] Mineflayer error: ${message}`);
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
  if (req.method === "POST" && url.pathname === "/shutdown") {
    disconnect();
    send(res, 200, { ...snapshot(), shuttingDown: true });
    setTimeout(() => server.close(() => process.exit(0)), 50);
    return;
  }
  send(res, 404, { error: "Not found" });
});

server.on("clientError", (error, socket) => {
  console.error(`[ZOYA Minecraft Bridge] HTTP client error: ${error.message}`);
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\\r\\nConnection: close\\r\\n\\r\\n");
});

const stateTicker = setInterval(() => collectMinecraftState(), 500);\n\nserver.listen(PORT, "127.0.0.1", () => {
  console.log(`[ZOYA Minecraft Bridge] Listening on http://127.0.0.1:${PORT}`);
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
