const MODEL = "openai/gpt-oss-20b";
const MAX_CONTEXT_ENTITIES = 12;
const MIN_THINK_GAP_MS = 350;
const MAX_REASONING_TOKENS = 256;

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
    inventory: (state?.inventory || []).slice(0, 18),
    selectedItem: state?.selectedItem || null,
    nearbyEntities: nearby.slice(0, MAX_CONTEXT_ENTITIES).map(entity => ({
      type: entity.type,
      name: entity.name,
      username: entity.username,
      distance: entity.distance,
      health: entity.health
    }))
  };
}

export function createZoyaBrain({
  getMinecraftState,
  getConfig,
  isMovementEnabled,
  executeAction = null,
  getMemory = () => null,
  getActiveTask = () => null,
  log = () => {}
}) {
  let thinking = false;
  let started = false;
  let lastDecision = null;
  let lastGoal = null;
  let lastActionResult = null;
  let consecutiveFailures = 0;
  let queuedReason = null;
  let lastThinkAt = 0;

  function status() {
    const task = getActiveTask?.() || null;
    return {
      enabled: started,
      thinking,
      model: MODEL,
      lastDecision,
      lastGoal,
      activeTask: task,
      taskDriven: true,
      minThinkGapMs: MIN_THINK_GAP_MS
    };
  }

  function stop() {
    started = false;
    queuedReason = null;
    thinking = false;
  }

  function requestThink(reason = "event") {
    if (!started) return;
    queuedReason = reason;
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

  async function think() {
    if (!started || thinking) return;
    const reason = queuedReason || "task_complete";
    queuedReason = null;

    const config = getConfig() || {};
    const apiKey = typeof config.groqApiKey === "string" ? config.groqApiKey.trim() : "";
    const minecraftState = getMinecraftState();

    if (!apiKey) {
      log("[BRAIN] Groq API key is not available; Minecraft brain is idle.");
      return;
    }
    if (!minecraftState?.available || !minecraftState.player) return;

    // Never ask Groq to micromanage an active task. The local task engine owns
    // execution until the task completes, is cancelled, or needs a new decision.
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
      const system = [
        "You are Zoya's Minecraft decision brain.",
        "Choose exactly one next task from the current Minecraft situation.",
        "A task is executed locally until it completes, fails, or the player cancels it. Do not micromanage ticks, attacks, movement steps, or individual block interactions.",
        "Available tasks: idle, safe_roam, explore, gather_basic_resources, follow_player, look_at_player, investigate_entity, mine, chop_tree, craft, eat, collect, return_to_owner, pvp.",
        "Use pvp only when the user explicitly asks Zoya to fight/duel a player or a clearly identified PvP task is active.",
        "If nobody is nearby, choose a useful autonomous task based on the actual situation; do not use a fixed no-player routine.",
        "Survival has highest priority. If health is low or hostile mobs are nearby, choose safety/survival instead of exploration or gathering.",
        "Respect autonomous movement permission for autonomous tasks. An explicit owner command may start a task, but the runtime still enforces safety.",
        "If the previous task failed, choose a different or safer task rather than blindly repeating it.",
        "Return strict JSON only: {goal, action, priority, reasonSummary, targetUsername}.",
        "priority is a number from 0 to 1. targetUsername is required for follow_player, look_at_player, pvp when a player target exists; otherwise null.",
        "reasonSummary must be one short sentence and must not contain hidden chain-of-thought."
      ].join("\n");

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
            { role: "user", content: JSON.stringify({
              trigger: reason,
              autonomousMovementEnabled: isMovementEnabled(),
              activeTask: null,
              memory: getMemory(),
              minecraft: context,
              lastActionResult,
              consecutiveFailures
            }) }
          ],
          response_format: { type: "json_object" },
          temperature: 0.25,
          max_completion_tokens: MAX_REASONING_TOKENS
        })
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body || "Groq request failed with HTTP " + response.status);
      }

      const payload = await response.json();
      const raw = payload?.choices?.[0]?.message?.content;
      if (!raw) throw new Error("Groq returned an empty Minecraft decision.");

      const decision = JSON.parse(raw);
      const allowedActions = new Set([
        "idle", "safe_roam", "explore", "gather_basic_resources", "follow_player",
        "look_at_player", "investigate_entity", "mine", "chop_tree", "craft",
        "eat", "collect", "return_to_owner", "pvp"
      ]);
      const action = allowedActions.has(decision.action) ? decision.action : "idle";
      const normalized = {
        goal: typeof decision.goal === "string" && decision.goal.trim() ? decision.goal.trim().slice(0, 180) : "Stay aware of the surroundings",
        action,
        priority: Number.isFinite(Number(decision.priority)) ? Math.max(0, Math.min(1, Number(decision.priority))) : 0.5,
        reasonSummary: typeof decision.reasonSummary === "string" ? decision.reasonSummary.slice(0, 240) : "",
        targetUsername: typeof decision.targetUsername === "string" && decision.targetUsername.trim() ? decision.targetUsername.trim() : null
      };

      if (normalized.action === "safe_roam" && !isMovementEnabled()) {
        normalized.action = "idle";
        normalized.goal = "Remain idle because autonomous movement is disabled";
      }

      lastDecision = new Date().toISOString();
      lastGoal = normalized;
      log("[BRAIN] Decision: " + normalized.action + " | Goal: " + normalized.goal);

      if (executeAction && normalized.action !== "idle") {
        const executed = await executeAction(normalized.action, { targetUsername: normalized.targetUsername });
        lastActionResult = { action: normalized.action, success: executed, at: new Date().toISOString() };
        consecutiveFailures = executed ? 0 : consecutiveFailures + 1;
        log("[BRAIN] Task result: " + normalized.action + " -> " + (executed ? "completed" : "failed/stopped"));
      } else if (normalized.action === "idle") {
        lastActionResult = { action: "idle", success: true, at: new Date().toISOString() };
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
    log("[BRAIN] Zoya Minecraft brain started (task-driven mode).");
    requestThink("startup");
  }

  return {
    start,
    stop,
    thinkNow: () => requestThink("event"),
    requestThink,
    status
  };
}
