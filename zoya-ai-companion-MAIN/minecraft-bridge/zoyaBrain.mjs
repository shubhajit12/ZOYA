const BRAIN_INTERVAL_MS = 15000;
const MAX_CONTEXT_ENTITIES = 20;
const MODEL = "openai/gpt-oss-20b";

function compactState(state) {
  const players = (state?.nearbyEntities || [])
    .filter(entity => entity?.username || entity?.type === "player")
    .slice(0, MAX_CONTEXT_ENTITIES)
    .map(entity => ({
      username: entity.username || entity.name || "unknown",
      distance: entity.distance,
      position: entity.position
    }));

  const entities = (state?.nearbyEntities || [])
    .filter(entity => !(entity?.username || entity?.type === "player"))
    .slice(0, MAX_CONTEXT_ENTITIES)
    .map(entity => ({
      type: entity.type,
      name: entity.name,
      distance: entity.distance,
      health: entity.health
    }));

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
    players,
    entities
  };
}

export function createZoyaBrain({
  getMinecraftState,
  getConfig,
  isMovementEnabled,
  roam,
  log = () => {}
}) {
  let timer = null;
  let thinking = false;
  let lastDecision = null;
  let lastGoal = null;
  let started = false;

  function status() {
    return {
      enabled: started,
      thinking,
      lastDecision,
      lastGoal,
      model: MODEL,
      intervalMs: BRAIN_INTERVAL_MS
    };
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    started = false;
    thinking = false;
  }

  function schedule() {
    if (!started) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void think(), BRAIN_INTERVAL_MS);
  }

  async function think() {
    if (!started) return;
    if (thinking) return schedule();

    const config = getConfig() || {};
    const apiKey = typeof config.groqApiKey === "string" ? config.groqApiKey.trim() : "";
    const minecraftState = getMinecraftState();

    if (!apiKey) {
      log("[BRAIN] Groq API key is not available; Minecraft brain is idle.");
      return schedule();
    }
    if (!minecraftState?.available || !minecraftState.player) {
      return schedule();
    }

    thinking = true;
    log("[BRAIN] Thinking about the current Minecraft situation...");

    try {
      const context = compactState(minecraftState);
      const system = [
        "You are Zoya's Minecraft decision brain.",
        "You decide what Zoya should do next from the current Minecraft situation.",
        "Do not pretend an action was completed. Choose only one next goal.",
        "You have these current executable capabilities: idle, safe_roam, explore, gather_basic_resources, follow_player, return_to_owner, eat.",
        "Do not claim execution; choose one action and the runtime will report the result.",
        "If nobody is nearby, you may choose safe_roam or a future goal such as gather_basic_resources/explore.",
        "If a player is nearby, consider their presence and context before choosing a goal.",
        "Respect autonomous movement permission: safe_roam is forbidden when it is disabled.",
        "Return strict JSON with: goal, action, priority, reasonSummary.",
        "action must be one of: idle, safe_roam, explore, gather_basic_resources, follow_player, investigate_entity, mine, chop_tree, craft, eat, return_to_owner.",
        "reasonSummary must be one short sentence; do not output hidden chain-of-thought."
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
              autonomousMovementEnabled: isMovementEnabled(),
              minecraft: context
            }) }
          ],
          response_format: { type: "json_object" },
          temperature: 0.35
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
        "investigate_entity", "mine", "chop_tree", "craft", "eat", "return_to_owner"
      ]);

      const action = allowedActions.has(decision.action) ? decision.action : "idle";
      const normalized = {
        goal: typeof decision.goal === "string" && decision.goal.trim() ? decision.goal.trim() : "Stay aware of the surroundings",
        action,
        priority: Number.isFinite(Number(decision.priority)) ? Math.max(0, Math.min(1, Number(decision.priority))) : 0.5,
        reasonSummary: typeof decision.reasonSummary === "string" ? decision.reasonSummary.slice(0, 240) : ""
      };

      if (normalized.action === "safe_roam" && !isMovementEnabled()) {
        normalized.action = "idle";
        normalized.goal = "Remain idle because autonomous movement is disabled";
      }

      lastDecision = new Date().toISOString();
      lastGoal = normalized;
      log("[BRAIN] Decision: " + normalized.action + " | Goal: " + normalized.goal);

      if (normalized.action === "safe_roam" && isMovementEnabled()) {
        await roam();
      } else if (normalized.action !== "idle") {
        log("[BRAIN] Goal selected but execution is waiting for the Phase 5 Minecraft action system: " + normalized.action);
      }
    } catch (error) {
      log("[BRAIN] Decision failed: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      thinking = false;
      schedule();
    }
  }

  function start() {
    stop();
    started = true;
    log("[BRAIN] Zoya Minecraft brain started.");
    void think();
  }

  return { start, stop, thinkNow: think, status };
}
