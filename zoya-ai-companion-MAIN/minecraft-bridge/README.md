# ZOYA Minecraft Companion

The Minecraft integration is one persistent companion runtime launched from ZOYA's Launch Bot button.

## Architecture

Minecraft perception -> player memory -> permissions -> Zoya/Groq decision loop -> action/pathfinding runtime -> Minecraft -> perception again.

The terminal remains a debugging surface; it is not the normal launch workflow.

## Roadmap

1. Foundation — Mineflayer bridge, configuration, Launch Bot, bundled runtime, lifecycle and logs.
2. State & awareness — players, entities, position, health, hunger, inventory, world/environment and events.
3. Zoya brain — Groq-powered decision loop that evaluates live Minecraft state and chooses a goal instead of using a fixed behavior script.
4. Permissions & player memory — owner identity, private /w permission requests, accept/decline handling, persistent player/event memory.
5. Minecraft skills — pathfinding, navigation, follow/approach, exploration, basic resource gathering, mining, basic crafting, eating and action-result feedback.
6. Autonomous companion — repeated perceive/remember/think/act/re-evaluate behavior when the owner is present or absent.
7. Advanced intelligence — longer-term planning, richer survival/building skills, deeper memory and personality integration.

## Current runtime behavior

- mineflayer-pathfinder is loaded by the Minecraft runtime.
- The Groq brain receives the existing perception payload plus persisted Minecraft memory.
- The brain chooses one next action and the runtime validates/executes it.
- Autonomous movement is controlled by the user's Minecraft movement setting.
- A non-owner asking Zoya to follow them triggers a private owner permission request through /w.
- The owner can answer accept or decline; accepted requests are executed.
- Player interactions and action outcomes are persisted in player-memory.json beside the Minecraft configuration.
- The bridge automatically reconnects after an unexpected connection end unless autoReconnect is explicitly disabled.
- Actions that are not implemented are rejected/logged rather than falsely reported as completed.

## Safety boundaries

The brain does not receive hidden chain-of-thought. It returns a compact structured goal/action decision. The action layer is the authority that performs or rejects the action.

User permissions remain authoritative. The brain cannot bypass a disabled autonomous-movement setting, and other-player follow requests require owner approval.
