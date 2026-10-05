import { getCapabilityRegistry } from "./capabilityTester.mjs";

const MODEL = "openai/gpt-oss-20b";
const MAX_CONTEXT_ENTITIES = 12;
const MAX_CONTEXT_INVENTORY = 16;
const MIN_THINK_GAP_MS = 5000;
const EVENT_COALESCE_MS = 1500;
const MAX_COMPLETION_TOKENS = 300;
const MAX_ACTIONS_PER_PLAN = 4;
const RATE_LIMIT_FALLBACK_MS = 15000;

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
    inventory: (state?.inventory || []).slice(0, MAX_CONTEXT_INVENTORY),
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
  cancelActiveTask = () => false,
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

  // Real FIFO request arbitration. Player messages must never overwrite one
  // another while Zoya is thinking, performing a task, or rate-limited.
  const MAX_REQUEST_QUEUE = 32;
  const requestQueue = [];
  let lastThinkAt = 0;
  let eventTimer = null;
  let rateLimitedUntil = 0;
  let noApiKeyLogged = false;

  function requestPriority(item) {
    if (item.reason === "player_message" && isOwner(item.request?.requester)) return 0;
    if (item.reason === "player_message") return 1;
    if (item.reason === "owner_control") return 0;
    return 2;
  }

  function enqueueRequest(reason = "event", request = null) {
    const item = { reason, request };
    // Coalesce autonomous/event notifications, but never coalesce player
    // messages or explicit owner controls.
    if (reason !== "player_message" && reason !== "owner_control") {
      const existing = requestQueue.find(q => q.reason === reason);
      if (existing) {
        existing.request = request || existing.request;
        return;
      }
    }

    if (requestQueue.length >= MAX_REQUEST_QUEUE) {
      // Preserve explicit player/owner requests by evicting the oldest
      // autonomous event first.
      const evict = requestQueue.findIndex(q =>
        q.reason !== "player_message" && q.reason !== "owner_control"
      );
      if (evict >= 0) requestQueue.splice(evict, 1);
      else requestQueue.shift();
    }

    requestQueue.push(item);
    requestQueue.sort((a, b) => requestPriority(a) - requestPriority(b));
  }

  function dequeueRequest() {
    return requestQueue.shift() || { reason: "event", request: null };
  }

  function requeueFront(reason, request) {
    requestQueue.unshift({ reason, request });
    if (requestQueue.length > MAX_REQUEST_QUEUE) requestQueue.pop();
  }

  function stop() {
    started = false;
    requestQueue.length = 0;
    thinking = false;
    if (eventTimer) {
      clearTimeout(eventTimer);
      eventTimer = null;
    }
  }

  function scheduleThink() {
    if (!started || thinking || eventTimer || !requestQueue.length) return;
    const now = Date.now();
    const waitForRateLimit = Math.max(0, rateLimitedUntil - now);
    const waitForGap = Math.max(0, MIN_THINK_GAP_MS - (now - lastThinkAt));
    const wait = Math.max(EVENT_COALESCE_MS, waitForRateLimit, waitForGap);
    eventTimer = setTimeout(() => {
      eventTimer = null;
      if (started && !thinking && requestQueue.length) void think();
    }, wait);
  }

  function requestThink(reason = "event", request = null) {
    if (!started) return;
    enqueueRequest(reason, request);
    scheduleThink();
  }

  const registry = () => getCapabilityRegistry();
  const capabilityIds = () => registry().map(item => item.id);
  const capabilityById = mode => registry().find(item => item.id === mode);

  function capabilityHintsForRequest(message = "") {
    const text = String(message || "").toLowerCase();
    const hints = [];
    const add = (mode, usage, reason) => {
      if (!hints.some(item => item.mode === mode)) hints.push({ mode, usage, reason });
    };

    if (/\b(?:time|day|night|weather|difficulty|gamemode|game mode|teleport|\btp\b|\bset\b.*time)/i.test(text)) {
      add("op_command", "op_command {command}", "server/world administrative command; for time use args like: time set 1000");
    }
    if (/(?:give|drop|hand|deliver|bring).*(?:shield|sword|pickaxe|axe|food|item|bread|porkchop|diamond|iron|gold)/i.test(text) ||
        /(?:shield|sword|pickaxe|axe|food|bread|porkchop|diamond|iron|gold).*(?:give|drop|hand|deliver|bring)/i.test(text)) {
      if (/\b(?:me|owner|shubh|shubhthegoat)\b/i.test(text) || /drop me|give me|hand me|bring me/i.test(text)) {
        add("give_item", "give_item {item} {username}", "give the requested item directly to the requester/owner");
      } else {
        add("drop_item", "drop_item {item}", "drop the requested item into the world");
      }
    }
    if (/\b(?:hit me|attack me|fight me|pvp|spar with me)\b/i.test(text)) {
      add("pvp", "pvp {username}", "owner explicitly requested combat against the named requester");
    }
    if (/\b(?:follow|come with me|stay with me|escort)\b/i.test(text)) {
      add("follow_player", "follow_player {username}", "follow the requester");
    }
    if (/\b(?:eat|consume)\b/i.test(text)) {
      add("eat", "eat {item}", "explicit eating request");
    }
    if (/\b(?:stop|cancel|wait here|stay here|don't move|do not move)\b/i.test(text)) {
      add("stop", "stop", "explicit cancellation/control request");
    }
    if (text.trim()) {
      add("chat", "chat {message}", "respond to the player in public chat when the message is conversational or does not require a physical task");
    }
    return hints.slice(0, 6);
  }

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
      minThinkGapMs: MIN_THINK_GAP_MS,
      eventCoalesceMs: EVENT_COALESCE_MS,
      rateLimitedUntil: rateLimitedUntil || null
    };
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
    const { reason, request } = dequeueRequest();

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
    if (!minecraftState?.available || !minecraftState.player) {
      if (request) requeueFront(reason, request);
      return;
    }

    if (Date.now() < rateLimitedUntil) {
      // Preserve the exact request that triggered this think. The previous
      // implementation cleared queuedRequest before checking the backoff,
      // which could permanently lose player messages during a Groq 429.
      requeueFront(reason, request);
      log("[BRAIN] Groq rate-limit backoff active; request preserved for retry.");
      scheduleThink();
      return;
    }

    const activeTask = getActiveTask?.() || null;
    if (activeTask) {
      // A cancelled Mineflayer task may need a few ticks to unwind its async
      // handler. Never discard the owner request while that happens; keep it
      // queued and retry once the task lifecycle is actually idle.
      requeueFront(reason, request);
      if (activeTask.cancelled) {
        log("[BRAIN] Waiting for cancelled task '" + activeTask.action + "' to finish before planning the queued request.");
        setTimeout(() => {
          if (started && !thinking && !getActiveTask?.()) void think();
        }, 100);
      } else {
        log("[BRAIN] Active task '" + activeTask.action + "' is still running; queued request will wait.");
      }
      return;
    }

    thinking = true;
    lastThinkAt = Date.now();
    log("[BRAIN] Thinking (" + reason + ")...");

    try {
      const context = compactState(minecraftState);
      const requester = String(request?.requester || "").trim();
      const system = [
        "You are Zoya's Minecraft brain.",
        "Groq decides WHAT Zoya should do; the local capability engine decides HOW it is physically executed.",
        "You may select only canonical capabilities known to the local engine. The local engine validates every mode; do not invent modes.",
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
        "Survival eating is handled locally by the runtime. Do not select eat/use_item just to maintain survival unless food is <= 10, or health is <= 14 with food < 18; explicit player requests to eat are still valid.",
        "For administrative/world commands such as setting time, select op_command and put the actual Minecraft command in args (example: request 'set the time to 1000' -> mode op_command, args 'time set 1000').",
        "For 'give me/drop me/hand me' an item, prefer give_item with args '<item> <requester username>'; use drop_item only when the user explicitly wants the item dropped into the world.",
        "If capabilityHints are supplied, treat them as trusted local candidate guidance for matching natural-language intent; still output only canonical modes.",
        "Every player_message must receive a response. For a conversational message, greeting, question, thanks, clarification, or request that does not require a physical task, use the chat capability with a natural concise reply in args. For a whisper request, use private_chat/whisper_player as appropriate. Do not return an empty actions array for a player_message unless the message is purely a control event already handled locally.",
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
        capabilityHints: capabilityHintsForRequest(request?.message || ""),
        capabilities: "Validated locally; do not enumerate capabilities in the response."
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
                    items: {
                      type: "object",
                      properties: {
                        mode: { type: "string" },
                        args: { type: "string" }
                      },
                      required: ["mode", "args"],
                      additionalProperties: false
                    }
                  },
                  priority: { type: "number" },
                  reasonSummary: { type: "string" }
                },
                required: ["goal", "actions", "priority", "reasonSummary"],
                additionalProperties: false
              }
            }
          },
          reasoning_format: "hidden",
          reasoning_effort: "low",
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

      // A player message must never disappear silently. If Groq returns an
      // empty plan (or an empty chat action), provide a deterministic fallback
      // response so the player always gets an acknowledgement.
      if (reason === "player_message") {
        const chatAction = normalized.actions.find(item => item.mode === "chat" || item.mode === "private_chat" || item.mode === "whisper_player");
        if (chatAction && !chatAction.args) {
          chatAction.mode = request?.channel === "whisper" ? "private_chat" : "chat";
          chatAction.args = request?.channel === "whisper"
            ? requester + " I'm listening. Tell me what you need."
            : "I'm listening. Tell me what you need.";
        } else if (!normalized.actions.length) {
          normalized.actions = [{
            mode: request?.channel === "whisper" ? "private_chat" : "chat",
            args: request?.channel === "whisper"
              ? requester + " I'm listening. Tell me what you need."
              : "I'm listening. Tell me what you need."
          }];
          normalized.goal = "Respond to the player";
          normalized.reasonSummary = "Groq returned no action for a player message, so Zoya sent a deterministic acknowledgement.";
          log("[BRAIN] Groq returned no action for player_message; using chat acknowledgement fallback.");
        }
      }

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
      const message = error instanceof Error ? error.message : String(error);
      const rateMatch = message.match(/try again in ([0-9]+(?:\.[0-9]+)?)s/i);
      if (/rate_limit_exceeded|rate limit reached/i.test(message)) {
        // Never lose a player message just because Groq is temporarily rate-limited.
        queuedReason = reason;
        queuedRequest = request;
        const retryMs = rateMatch
          ? Math.ceil(Number(rateMatch[1]) * 1000) + 1000
          : RATE_LIMIT_FALLBACK_MS;
        rateLimitedUntil = Date.now() + retryMs;
        log("[BRAIN] Groq rate limit; backing off for " + Math.ceil(retryMs / 1000) + "s and coalescing events.");
      } else {
        log("[BRAIN] Decision failed: " + message);
      }
    } finally {
      thinking = false;
      scheduleThink();
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

    // Defensive owner cancellation path. The runtime normally handles this
    // before reaching Groq, but keeping it here guarantees an owner stop can
    // never be blocked behind the planner's active-task gate.
    const owner = isOwner(requester);
    const stopMatch = owner && text.match(/^(?:(?:ok|okay|please|can you|could you|would you)[\s]+)*(?:stop|cancel)\b[\s]*(.*)$/i);
    if (stopMatch) {
      let remainder = String(stopMatch[1] || "").trim();
      remainder = remainder
        .replace(/^(?:here|now|the mode|this mode|the task|this task|the task you are doing|what you are doing)\b[\s]*/i, "")
        .replace(/^and\b[\s]*/i, "")
        .trim();
      cancelActiveTask("owner command");
      if (!remainder) {
        return true;
      }
      requestThink("player_message", { requester, message: remainder, channel });
      return true;
    }

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
