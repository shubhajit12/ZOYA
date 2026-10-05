import fs from "node:fs";
import path from "node:path";
import { Vec3 } from "vec3";

const VERSION = 1;
const FILE = "minecraft-training.json";
const SAMPLE_MS = 100;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}
function clean(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}
function round(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
}

const DEFAULT_LIBRARY = {
  schemaVersion: VERSION,
  type: "zoya-minecraft-training-library",
  updatedAt: null,
  modes: {
    pvp: { techniques: [] }
  }
};

function emptySession() {
  return {
    mode: "pvp",
    instructor: null,
    instruction: "",
    startedAt: null,
    instructionStartedAt: null,
    samples: [],
    lastSample: null
  };
}

export function createTrainingRuntime({ bot, stateDir, ownerUsername = "", log = () => {} }) {
  const file = path.join(stateDir, FILE);
  const library = readJson(file, DEFAULT_LIBRARY);
  if (!library.modes) library.modes = {};
  if (!library.modes.pvp) library.modes.pvp = { techniques: [] };

  let session = emptySession();
  let timer = null;
  const listeners = [];

  function observeEvent(type, entity = null, extra = {}) {
    if (!session.instructor) return;
    if (entity && String(entity.username || "").toLowerCase() !== String(session.instructor).toLowerCase()) return;
    session.samples.push({
      at: Date.now(),
      instructor: session.instructor,
      event: { type, ...extra }
    });
  }

  function attachListeners() {
    const add = (event, handler) => {
      if (typeof bot.on !== "function") return;
      bot.on(event, handler);
      listeners.push([event, handler]);
    };
    add("entitySwingArm", entity => observeEvent("attack_or_swing", entity));
    add("entityCrouch", entity => observeEvent("sneak_start", entity));
    add("entityUncrouch", entity => observeEvent("sneak_stop", entity));
    add("entityHurt", entity => observeEvent("hurt", entity));
    add("entityCriticalEffect", entity => observeEvent("critical_effect", entity));
    add("entityHandSwap", entity => observeEvent("hand_swap", entity));
    add("blockUpdate", (oldBlock, newBlock) => {
      if (!session.instructor) return;
      const p = findPlayer(session.instructor)?.entity;
      const pos = p?.position;
      const np = newBlock?.position;
      if (!pos || !np || Math.hypot(np.x - pos.x, np.y - pos.y, np.z - pos.z) > 4) return;
      observeEvent("nearby_block_change", null, {
        position: { x: Number(np.x), y: Number(np.y), z: Number(np.z) },
        from: oldBlock?.name || null,
        to: newBlock?.name || null
      });
    });
  }

  function detachListeners() {
    for (const [event, handler] of listeners.splice(0)) {
      try { bot.removeListener?.(event, handler); } catch {}
    }
  }

  attachListeners();

  function save() {
    library.updatedAt = new Date().toISOString();
    writeJson(file, library);
  }

  function owner(name) {
    return String(name || "").trim().toLowerCase() === String(ownerUsername || "").trim().toLowerCase();
  }

  function findPlayer(username) {
    const wanted = String(username || "").trim().toLowerCase();
    if (!wanted) return null;
    return Object.values(bot.players || {}).find(p =>
      String(p?.username || "").toLowerCase() === wanted
    ) || null;
  }

  function snapshot() {
    const p = session.instructor ? findPlayer(session.instructor) : null;
    const e = p?.entity;
    const held = e?.equipment?.[0] || null;
    const position = e?.position;
    const velocity = e?.velocity;
    let blockBelow = null;
    try {
      if (position) {
        const b = bot.blockAt(position.offset(0, -1, 0));
        blockBelow = b?.name || null;
      }
    } catch {}
    return {
      at: Date.now(),
      instructor: session.instructor,
      position: position ? { x: round(position.x), y: round(position.y), z: round(position.z) } : null,
      yaw: round(e?.yaw),
      pitch: round(e?.pitch),
      velocity: velocity ? { x: round(velocity.x), y: round(velocity.y), z: round(velocity.z) } : null,
      onGround: e?.onGround === true,
      sneaking: e?.isSneaking === true,
      sprinting: e?.isSprinting === true,
      heldItem: held ? { name: clean(held.name, 80), type: Number(held.type ?? 0), count: Number(held.count ?? 0) } : null,
      blockBelow,
      entityHealth: Number(e?.health ?? 0) || null
    };
  }

  function start(instructor, mode = "pvp") {
    if (!owner(instructor)) return { ok: false, error: "Only the configured owner can teach Zoya." };
    if (timer) clearInterval(timer);
    timer = null;
    const normalizedMode = clean(mode, 60).toLowerCase().replace(/\s+/g, "_") || "pvp";
    if (!library.modes[normalizedMode]) library.modes[normalizedMode] = { techniques: [] };
    session = {
      ...emptySession(),
      mode: normalizedMode,
      instructor: String(instructor).trim(),
      startedAt: new Date().toISOString()
    };
    timer = setInterval(() => {
      if (!session.instructor) return;
      const sample = snapshot();
      if (sample.position || sample.heldItem || sample.yaw != null || sample.pitch != null) {
        session.samples.push(sample);
        if (session.samples.length > 5000) session.samples.shift();
        session.lastSample = sample;
      }
    }, SAMPLE_MS);
    log("[TRAINING] Training started: mode=" + normalizedMode + " instructor=" + instructor + ".");
    return { ok: true, mode: normalizedMode, instructor: session.instructor };
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    session = emptySession();
    return true;
  }

  function setInstruction(instructor, instruction) {
    if (!owner(instructor)) return { ok: false, error: "Only the configured owner can teach Zoya." };
    if (!session.instructor) {
      const started = start(instructor, "pvp");
      if (!started.ok) return started;
    }
    if (String(session.instructor).toLowerCase() !== String(instructor).toLowerCase()) {
      return { ok: false, error: "Another instructor session is active." };
    }
    session.instruction = clean(instruction, 500);
    session.instructionStartedAt = Date.now();
    session.samples = [];
    session.lastSample = null;
    log("[TRAINING] Instruction: " + session.instruction);
    return { ok: true, instruction: session.instruction };
  }

  function inferEvents(samples) {
    const events = [];
    let previous = null;
    for (const s of samples) {
      if (s.event) {
        events.push({ ...s.event, at: s.at });
        continue;
      }
      if (previous) {
        if (s.heldItem?.name !== previous.heldItem?.name && (s.heldItem?.name || previous.heldItem?.name)) {
          events.push({ type: "equip_change", item: s.heldItem?.name || "empty", at: s.at });
        }
        if (s.onGround !== previous.onGround) {
          events.push({ type: s.onGround ? "land" : "airborne", at: s.at });
        }
        if (s.sprinting !== previous.sprinting) {
          events.push({ type: s.sprinting ? "sprint_start" : "sprint_stop", at: s.at });
        }
        if (s.sneaking !== previous.sneaking) {
          events.push({ type: s.sneaking ? "sneak_start" : "sneak_stop", at: s.at });
        }
        if (s.blockBelow !== previous.blockBelow && (s.blockBelow || previous.blockBelow)) {
          events.push({ type: "block_below_change", from: previous.blockBelow, to: s.blockBelow, at: s.at });
        }
        if (s.position && previous.position) {
          const dx = s.position.x - previous.position.x;
          const dy = s.position.y - previous.position.y;
          const dz = s.position.z - previous.position.z;
          const distance = Math.hypot(dx, dy, dz);
          if (distance >= 0.18) {
            events.push({
              type: "move",
              dx: round(dx), dy: round(dy), dz: round(dz),
              distance: round(distance), at: s.at
            });
          }
        }
      }
      previous = s;
    }
    return events.slice(0, 500);
  }

  function saveSegment(instructor, name = "") {
    if (!owner(instructor)) return { ok: false, error: "Only the configured owner can save training." };
    if (!session.instructor || String(session.instructor).toLowerCase() !== String(instructor).toLowerCase()) {
      return { ok: false, error: "No active training session for this instructor." };
    }
    if (!session.instruction) return { ok: false, error: "Give Zoya an instruction before saving the demonstration." };
    if (session.samples.length < 2) return { ok: false, error: "Not enough demonstration data yet." };

    const techniqueName = clean(name, 100)
      .toLowerCase()
      .replace(/[^a-z0-9_ -]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || ("technique_" + (library.modes[session.mode].techniques.length + 1));

    const samples = session.samples.slice();
    const technique = {
      id: techniqueName + "_" + Date.now(),
      name: techniqueName,
      mode: session.mode,
      instructor: session.instructor,
      instruction: session.instruction,
      recordedAt: new Date().toISOString(),
      source: "owner_demonstration",
      schemaVersion: VERSION,
      startState: samples[0],
      endState: samples[samples.length - 1],
      durationMs: Math.max(0, samples[samples.length - 1].at - samples[0].at),
      events: inferEvents(samples),
      samples
    };

    library.modes[session.mode].techniques.push(technique);
    save();
    log("[TRAINING] Saved technique '" + technique.name + "' with " + technique.events.length + " inferred events.");
    session.instruction = "";
    session.instructionStartedAt = null;
    session.samples = [];
    session.lastSample = null;
    return { ok: true, technique };
  }

  function getTechniques(mode = "pvp") {
    return Array.isArray(library.modes?.[mode]?.techniques)
      ? library.modes[mode].techniques.slice()
      : [];
  }

  function findTechnique(name, mode = "pvp") {
    const wanted = clean(name, 120).toLowerCase().replace(/\s+/g, "_");
    return getTechniques(mode).find(t => String(t.name || "").toLowerCase() === wanted ||
      String(t.id || "").toLowerCase() === wanted) || null;
  }

  function techniqueMatches(technique, context = "") {
    const text = String(technique?.instruction || "").toLowerCase();
    const c = String(context || "").toLowerCase();
    if (!text) return false;
    if (c === "shield") return /shield|block(?:ing|ed|up)/.test(text);
    if (c === "clutch") return /clutch|water bucket|lava bucket|mlg/.test(text);
    if (c === "combo") return /combo|sword|axe|attack|pvp/.test(text);
    return false;
  }

  async function executeTechnique(name, { target = null, context = "", ctx = null } = {}) {
    const technique = findTechnique(name) || getTechniques("pvp").find(t => techniqueMatches(t, context));
    if (!technique) return { ok: false, error: "Learned technique not found." };
    const bot = ctx?.bot || null;
    if (!bot) return { ok: false, error: "Training execution requires a bot context." };
    const active = () => {
      ctx?.assertActive?.();
    };
    const targetEntity = target?.entity || target || null;
    if (context === "clutch" && /water_bucket|water bucket|mlg/.test(String(technique.instruction || "").toLowerCase())) {
      const bucket = bot.inventory?.items?.().find(x => /^(?:water_bucket|lava_bucket)$/.test(String(x.name || "").toLowerCase()));
      if (bucket) {
        await bot.equip(bucket, "hand");
        const deadline = Date.now() + 3500;
        while (Date.now() < deadline) {
          active();
          const vy = Number(bot.entity?.velocity?.y ?? 0);
          if (vy < -0.18 && bot.entity?.position) {
            const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
            if (below && below.name !== "air" && !/water|lava/.test(String(below.name))) {
              await bot.lookAt(below.position.offset(0.5, 1, 0.5), true);
              try {
                await bot.placeBlock(below, new Vec3(0, 1, 0));
                return { ok: true, technique: technique.name, action: "clutch" };
              } catch {}
            }
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }
    const events = Array.isArray(technique.events) ? technique.events : [];
    const started = Date.now();

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      active();
      const nextAt = Number(events[i + 1]?.at ?? event.at);
      const recordedDelta = Math.max(0, Math.min(1200, nextAt - Number(event.at || nextAt)));
      if (event.type === "equip_change" && event.item && event.item !== "empty") {
        const item = bot.inventory?.items?.().find(x => String(x.name).toLowerCase() === String(event.item).toLowerCase());
        if (item) await bot.equip(item, "hand");
      } else if (event.type === "attack_or_swing" && targetEntity) {
        const live = targetEntity.uuid
          ? Object.values(bot.entities || {}).find(e => e?.uuid === targetEntity.uuid && e !== bot.entity && e.isValid !== false)
          : targetEntity;
        if (live && live.isValid !== false && (live.health == null || live.health > 0)) {
          await bot.lookAt(live.position.offset(0, live.height || 1.2, 0), true);
          active();
          bot.attack(live);
        }
      } else if (event.type === "sprint_start") {
        bot.setControlState?.("sprint", true);
      } else if (event.type === "sprint_stop") {
        bot.setControlState?.("sprint", false);
      } else if (event.type === "sneak_start") {
        bot.setControlState?.("sneak", true);
      } else if (event.type === "sneak_stop") {
        bot.setControlState?.("sneak", false);
      }
      if (recordedDelta > 0) {
        await new Promise(resolve => setTimeout(resolve, recordedDelta));
      }
      if (Date.now() - started > 15000) break;
    }

    bot.setControlState?.("sprint", false);
    bot.setControlState?.("sneak", false);
    return { ok: true, technique: technique.name };
  }

  function findApplicable(context = "combo") {
    return getTechniques("pvp").find(t => techniqueMatches(t, context)) || null;
  }

  function status() {
    return {
      active: Boolean(session.instructor),
      mode: session.mode,
      instructor: session.instructor,
      instruction: session.instruction || null,
      startedAt: session.startedAt,
      samples: session.samples.length,
      libraryFile: file,
      modes: Object.fromEntries(Object.entries(library.modes).map(([name, value]) => [
        name,
        { techniques: Array.isArray(value.techniques) ? value.techniques.length : 0 }
      ]))
    };
  }

  function exportLibrary() {
    return JSON.parse(JSON.stringify(library));
  }

  function importLibrary(incoming, requester = "") {
    if (!owner(requester)) return { ok: false, error: "Only the configured owner can import training." };
    if (!incoming || incoming.type !== "zoya-minecraft-training-library") {
      return { ok: false, error: "Invalid Zoya training package." };
    }
    if (Number(incoming.schemaVersion) !== VERSION) {
      return { ok: false, error: "Unsupported training package schema version." };
    }
    library.modes = incoming.modes || {};
    save();
    return { ok: true, modes: Object.keys(library.modes) };
  }

  return {
    start,
    stop,
    setInstruction,
    saveSegment,
    status,
    exportLibrary,
    importLibrary,
    getTechniques,
    findTechnique,
    findApplicable,
    executeTechnique
  };
}
