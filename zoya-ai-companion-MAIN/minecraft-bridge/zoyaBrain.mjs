import { getCapabilityRegistry } from "./capabilityTester.mjs";

const MODEL = "openai/gpt-oss-20b";
const MAX_CONTEXT_ENTITIES = 16;
const MIN_THINK_GAP_MS = 350;
const MAX_COMPLETION_TOKENS = 900;
const MAX_ACTIONS_PER_PLAN = 6;

function compactState(state) {
  const nearby = (state?.nearbyEntities || [])
    .slice()
    .sort((a, b) => Number(a.distance || 999) - Number(b.distance || 999));
  return {
    bot: state?.player ? {
      username: state.player.username,
      position: state.player.position,
      health: state.player.health,
      food: state.player.food,
      xpLevel: state.player.experience?.level ?? 0
    } : null,
    world: state?.world ? {
      dimension: state.world.dimension,
      timeOfDay: state.world.timeOfDay,
      day: state.world.day,
      raining: state.world.isRaining,
      thunder: state.world.thunderState
    } : null,
    environment: state?.environment || null,
    inventory: (state?.inventory || []).slice(0, 24),
    selectedItem: state?.selectedItem || null,
    nearbyEntities: nearby.slice(0, MAX_CONTEXT_ENTITIES).map(entity => ({
      type: entity.type,
      name: entity.name,
      username: entity.username,
      distance: entity.distance,
      health: entity.health,
      position: entity.position || null
    }))
  };
}

function cleanArgs(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim().slice(0, 1000);
  try { return JSON.stringify(value).slice(0, 1000); } catch { return String(value).slice(0, 1000); }
}

export function createZoyaBrain({
  getMinecraftState,
  getConfig,
  isMovementEnabled,
  executeAction = null,
  dispatchCapability = null,
  getMemory = () => null,
  getActiveTask = () => null,
  getOwnerUsername = () => "",
  askOwnerPermission = null,
  log = () => {}
}) {
  let thinking = false;
  let started = false;
  let lastDecision = null;
  let lastPlan = null;
  let lastGoal = null;
  let lastActionResult = null;
  let consecutiveFailures = 0;
  let queuedReason = null;
  let queuedRequest = null;
  let lastThinkAt = 0;
  let noApiKeyLogged = false;

  const registry = () => getCapabilityRegistry();
  const capabilityIds = () => registry().map(item => item.id);
  const capabilityById = mode => registry().find(item => item.id === mode);

  function ownerUsername() {
    return String(getOwnerUsername?.() || getConfig()?.ownerUsername || "").trim();
  }

  function isOwner(username) {
    const owner = ownerUsername();
    return Boolean(owner && String(username || "").trim().toLowerCase() === owner.toLowerCase());
  }

  function status() {
    return {
      enabled: started,
      thinking,
      model: MODEL,
      ownerUsername: ownerUsername() || null,
      lastDecision,
      lastPlan,
      lastGoal,
      lastActionResult,
      activeTask: getActiveTask?.() || null,
      taskDriven: true,
      capabilityCount: registry().length,
      minThinkGapMs: MIN_THINK_GAP_MS
    };
  }

  function stop() {
    started = false;
    queuedReason = null;
    queuedRequest = null;
    thinking = false;
  }

  function requestThink(reason = "event", request = null) {
    if (!started) return;
    queuedReason = reason;
    if (request) queuedRequest = request;
    if (thinking) return;
    const wait = Math.max(0, MIN_THINK_GAP_MS - (Date.now() - lastThinkAt));
    if (wait > 0) {
      setTimeout(() => {
        if (started && !thinking) void think();
      }, wait);
      return;
    }
    void think();
  }

  async function requestOwnerPermission({ requester, mode, args, reason }) {
    if (isOwner(requester)) return { allowed: true, source: "owner" };
    if (!ownerUsername()) {
      log("[PERMISSION] No ownerUsername is configured; non-owner request denied.");
      return { allowed: false, source: "owner-not-configured" };
    }
    if (typeof askOwnerPermission !== "function") {
      log("[PERMISSION] Owner permission service unavailable; request denied.");
      return { allowed: false, source: "permission-service-unavailable" };
    }
    const display = mode + (args ? " " + args : "");
    const accepted = askOwnerPermission(requester, mode + "|" + args, display, {
      mode, args, requester, reason
    });
    return accepted ? { allowed: "pending", source: "owner-pending" } : { allowed: false, source: "owner-unavailable" };
  }

  async function executePlannedAction(action, requester = "") {
    const mode = String(action?.mode || "").trim().toLowerCase();
    const args = cleanArgs(action?.args);
    const capability = capabilityById(mode);
    if (!capability) return { mode, args, success: false, error: "Unknown capability." };

    if (mode === "stop") {
      if (!requester) return { mode, args, success: false, error: "Autonomous planner cannot cancel an active task." };
      if (requester && !isOwner(requester)) {
        const permission = await requestOwnerPermission({ requester, mode, args, reason: "stop/cancel request" });
        if (permission.allowed !== true) return { mode, args, success: false, pendingPermission: permission.allowed === "pending", error: "Owner permission required to cancel Zoya's active task." };
      }
    }

    if (mode === "op_command") {
      if (!isOwner(requester)) {
        const permission = await requestOwnerPermission({ requester, mode, args, reason: "OP command request" });
        if (permission.allowed !== true) return { mode, args, success: false, pendingPermission: permission.allowed === "pending", error: "Owner permission required for OP commands." };
      }
    }

    // Non-owner players may ask for information/chat, but any physical task
    // or task performed for/on behalf of another player requires the owner.
    const observation = capability.execution === "observation";
    const controlOnly = capability.execution === "control";
    const safeNonPhysical = new Set([
      "chat", "private_chat", "whisper_player", "report_result", "ask_clarification",
      "check_inventory", "find_item", "count_item", "find_player", "find_entity",
      "find_item_world", "check_nearby", "check_environment", "detect_hostiles",
      "check_health", "check_food", "check_equipment", "ask_permission",
      "remember_player", "observe"
    ]);
    if (requester && !isOwner(requester) && !safeNonPhysical.has(mode) && !(observation && !controlOnly)) {
      const permission = await requestOwnerPermission({
        requester, mode, args,
        reason: "non-owner requested a Minecraft task"
      });
      if (permission.allowed !== true) {
        return {
          mode, args, success: false,
          pendingPermission: permission.allowed === "pending",
          error: "Owner permission required before I can perform that task."
        };
      }
    }

    if (mode === "follow_player" || mode === "escort_player" || mode === "protect_player" ||
        mode === "deliver_item" || mode === "give_item" || mode === "coordinate_with_player" ||
        mode === "private_chat" || mode === "whisper_player" || mode === "ask_clarification") {
      const target = args.split(/\s+/)[0] || "";
      if (target && !isOwner(target) && requester && !isOwner(requester)) {
        const permission = await requestOwnerPermission({
          requester,
          mode,
          args,
          reason: "task targets another player"
        });
        if (permission.allowed !== true) {
          return { mode, args, success: false, pendingPermission: permission.allowed === "pending", error: "Owner permission required for another-player task." };
        }
      }
    }

    if (mode === "safe_roam" && !isMovementEnabled()) {
      return { mode, args, success: false, error: "Autonomous movement is disabled." };
    }

    if (typeof dispatchCapability === "function") {
      try {
        const success = await dispatchCapability(mode, args);
        return { mode, args, success: success === true };
      } catch (error) {
        return { mode, args, success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    if (typeof executeAction === "function") {
      try {
        const success = await executeAction(mode, { args });
        return { mode, args, success: success === true };
      } catch (error) {
        return { mode, args, success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    return { mode, args, success: false, error: "No capability executor is connected." };
  }

  async function think() {
    if (!started || thinking) return;
    const reason = queuedReason || "event";
    const request = queuedRequest;
    queuedReason = null;
    queuedRequest = null;

    const config = getConfig() || {};
    if (config.capabilityDebugMode === true) {
      log("[BRAIN] Capability test mode is active; Groq request blocked.");
      return;
    }
    const apiKey = typeof config.groqApiKey === "string" ? config.groqApiKey.trim() : "";
    const minecraftState = getMinecraftState();
    if (!apiKey) {
      if (!noApiKeyLogged) {
        log("[BRAIN] Groq API key is not available; Minecraft brain is idle.");
        noApiKeyLogged = true;
      }
      return;
    }
    noApiKeyLogged = false;
    if (!minecraftState?.available || !minecraftState.player) return;

    const activeTask = getActiveTask?.() || null;
    if (activeTask) {
      log("[BRAIN] Active task '" + activeTask.action + "' is still running; no new Groq request.");
      return;
    }

    thinking = true;
    lastThinkAt = Date.now();
    log("[BRAIN] Thinking (" + reason + ")...");

    try {
      const context = compactState(minecraftState);
      const requester = String(request?.requester || "").trim();
      const capabilitySummary = registry().map(item => ({
        id: item.id,
        usage: item.usage,
        execution: item.execution,
        lifecycle: item.lifecycle
      }));

      const system = [
        "You are Zoya's Minecraft brain.",
        "Groq decides WHAT Zoya should do; the local capability engine decides HOW it is physically executed.",
        "You may select only one of the canonical capabilities supplied in the capability list.",
        "Return a short ordered plan of at most " + MAX_ACTIONS_PER_PLAN + " actions. Use the fewest actions needed.",
        "Each action has mode and a single string args field matching that capability's usage.",
        "Never invent a capability, never invent a player identity, and never issue raw Mineflayer/code/tool commands.",
        "The configured owner is the final permission authority. The owner is '" + (ownerUsername() || "NOT CONFIGURED") + "'.",
        "The current requester is '" + (requester || "AUTONOMOUS") + "'.",
        "If the requester is not the owner, do not assume permission. The local runtime will enforce owner approval for physical tasks and tasks involving other players.",
        "If a non-owner asks Zoya to follow them, help them, protect them, escort them, give/deliver items, build, mine, fight, use OP commands, or perform another physical task, select the appropriate capability only if it can be queued for owner approval; never treat the request as automatically authorized.",
        "Owner requests may be executed directly, subject to the capability engine's safety/cancellation/death rules.",
        "Autonomous actions are allowed only when autonomous movement is enabled. Never fabricate permission.",
        "Prioritize survival, active owner goals, explicit requests, and then useful autonomous work.",
        "If an action fails, use the failure result to choose a safer alternative or stop; do not blindly repeat the same failed action.",
        "Do not reveal hidden chain-of-thought. reasonSummary must be a brief operational explanation."
      ].join("\n");

      const userPayload = {
        trigger: reason,
        requester: requester || null,
        requesterIsOwner: isOwner(requester),
        ownerUsername: ownerUsername() || null,
        autonomousMovementEnabled: isMovementEnabled(),
        activeTask: null,
        memory: getMemory(),
        minecraft: context,
        lastActionResult,
        consecutiveFailures,
        request: request ? {
          username: request.requester || null,
          channel: request.channel || null,
          message: String(request.message || "").slice(0, 1200)
        } : null,
        capabilities: capabilitySummary
      };

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(userPayload) }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "zoya_minecraft_plan",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  goal: { type: "string" },
                  actions: {
                    type: "array",
                    minItems: 0,
                    maxItems: MAX_ACTIONS_PER_PLAN,
                    items: {
                      type: "object",
                      properties: {
                        mode: { type: "string", enum: capabilityIds() },
                        args: { type: "string" }
                      },
                      required: ["mode", "args"],
                      additionalProperties: false
                    }
                  },
                  priority: { type: "number", minimum: 0, maximum: 1 },
                  reasonSummary: { type: "string" }
                },
                required: ["goal", "actions", "priority", "reasonSummary"],
                additionalProperties: false
              }
            }
          },
          reasoning_format: "hidden",
          temperature: 0.15,
          max_completion_tokens: MAX_COMPLETION_TOKENS
        })
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body || "Groq request failed with HTTP " + response.status);
      }

      const payload = await response.json();
      const raw = payload?.choices?.[0]?.message?.content;
      if (!raw) throw new Error("Groq returned an empty Minecraft plan.");
      const plan = JSON.parse(raw);
      const allowed = new Set(capabilityIds());
      const actions = Array.isArray(plan.actions) ? plan.actions.slice(0, MAX_ACTIONS_PER_PLAN) : [];
      const normalized = {
        goal: typeof plan.goal === "string" && plan.goal.trim() ? plan.goal.trim().slice(0, 240) : "Stay safe and useful",
        actions: actions
          .map(item => ({
            mode: String(item?.mode || "").trim().toLowerCase(),
            args: cleanArgs(item?.args)
          }))
          .filter(item => allowed.has(item.mode)),
        priority: Number.isFinite(Number(plan.priority)) ? Math.max(0, Math.min(1, Number(plan.priority))) : 0.5,
        reasonSummary: typeof plan.reasonSummary === "string" ? plan.reasonSummary.slice(0, 300) : ""
      };

      lastDecision = new Date().toISOString();
      lastPlan = normalized;
      lastGoal = normalized.goal;
      log("[BRAIN] Plan: " + normalized.goal + " | actions=" + normalized.actions.map(item => item.mode).join(", ") + ".");

      if (!normalized.actions.length) {
        lastActionResult = { status: "idle", success: true, at: new Date().toISOString() };
        consecutiveFailures = 0;
        return;
      }

      for (const action of normalized.actions) {
        if (!started) break;
        if (getActiveTask?.()) {
          log("[BRAIN] Plan paused because another task became active.");
          break;
        }
        const result = await executePlannedAction(action, requester);
        lastActionResult = { ...result, at: new Date().toISOString() };
        if (result.pendingPermission) {
          log("[PERMISSION] Plan paused: owner approval required for " + action.mode + ".");
          break;
        }
        if (!result.success) {
          consecutiveFailures += 1;
          log("[BRAIN] Action failed: " + action.mode + (result.error ? " | " + result.error : ""));
          break;
        }
        consecutiveFailures = 0;
      }
    } catch (error) {
      log("[BRAIN] Decision failed: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      thinking = false;
      if (queuedReason && started) requestThink(queuedReason);
    }
  }

  function start() {
    stop();
    started = true;
    log("[BRAIN] Zoya Minecraft brain started (Groq planner, " + registry().length + " capabilities).");
    requestThink("startup");
  }

  function handlePlayerMessage(username, message, channel = "public") {
    const requester = String(username || "").trim();
    const text = String(message || "").trim();
    if (!requester || !text || !started) return false;
    requestThink("player_message", { requester, message: text, channel });
    return true;
  }

  return {
    start,
    stop,
    thinkNow: () => requestThink("event"),
    requestThink,
    handlePlayerMessage,
    status
  };
}
