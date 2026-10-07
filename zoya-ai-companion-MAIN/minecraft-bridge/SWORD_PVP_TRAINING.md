# ZOYA Sword PvP Brain Training

This is a dedicated Sword PvP decision brain. It is separate from the generic
planner and is intended to become the sole owner of Sword PvP combat decisions.

## Offline training

1. Expert video analysis supplies demonstrations.
2. The trainer compiles those demonstrations into a deterministic policy.
3. The pure Sword Brain is tested against known combat-state scenarios.
4. Only after the offline gate passes is a Minecraft server needed for live
   execution and evaluation.

Video analysis cannot prove hidden keyboard inputs. A visible post-hit braking
maneuver is stored as an observed outcome; calling it an S-tap is an inference.
The brain reproduces observable behavior and keeps timing configurable.

The brain itself never calls Mineflayer. A runtime adapter must enforce target
validity, task ownership, cancellation, death/recovery, and one active PvP kit
owning equipment before executing an intent.

The protect_player internal combat logic is not part of this system and must
remain frozen.

## Completion gate

npm run train:sword:brain prints TRAINING COMPLETED only when every required
expert category is present and every deterministic offline test passes.

This does not claim live Minecraft mastery. Live combat validation is a later
stage after the user joins the test server.


## Live Sword training run

After the Sword controller verification is green and a fresh Minecraft Bridge build is available:

1. Start the Minecraft server.
2. Start the new `MinecraftBridge.exe` and connect ZOYA.
3. From the bridge directory, run:
   `node swordTrainingSession.mjs`
   or the bundled runtime:
   `.
ode.exe swordTrainingSession.mjs`
4. The session starts a separate Mineflayer opponent (`ZoyaTrainer`) and dispatches Sword PvP rounds against it.
5. Telemetry is written to `minecraft-training/sword/live/sword-rounds.jsonl`.
6. Run `node swordTrainingEvaluator.mjs` (or `npm run eval:sword`) to produce `minecraft-training/sword/live/sword-evaluation.json`.

Useful environment controls:
- `ZOYA_TRAIN_HOST`, `ZOYA_TRAIN_PORT`: training server
- `ZOYA_TRAIN_OPPONENT`: opponent username (default `ZoyaTrainer`)
- `ZOYA_TRAIN_TARGET`: ZOYA username
- `ZOYA_TRAIN_OPPONENT_MODE`: `strafe`, `stationary`, or `retreat`
- `ZOYA_TRAIN_ROUNDS`: number of rounds (default 5)

The live loop is evaluation/training against a controlled opponent; it is not a claim of autonomous high-tier PvP mastery. The offline `TRAINING COMPLETED` gate remains separate from live combat performance.
