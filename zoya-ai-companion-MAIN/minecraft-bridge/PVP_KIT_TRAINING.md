# ZOYA PvP Kit Training

ZOYA's PvP is being split into explicit kits instead of one planner that
continuously changes weapons and tactics.

- Sword PvP — first training target
- Mace PvP — includes mace combat, wind charges, Elytra mace, rockets,
  height control and anti-mace behavior
- Crystal PvP — separate crystal/totem/obsidian discipline

Only the active kit will eventually own the combat action domain. A generic
melee fallback must not be allowed to overwrite the active kit's weapon.

## How video teaching works

The downloaded HT1 montage videos are reference demonstrations. We do not
want to copy a montage frame-for-frame. The learning pipeline should extract
reusable skills such as movement, strafing, spacing, sprint resets,
attack/crit timing, combo continuation and reset, target tracking,
repositioning, defense, disengagement, healing decisions, and recovery.

Those observations become structured skills for the Sword kit. The existing
trainingRuntime.mjs is the live-owner demonstration recorder; the next
video-training step is a local video-to-observation/extraction pipeline that
feeds the same training library.

## Do I have to join the server?

Not for studying/extracting the videos.

You only need the Minecraft server for the practice/evaluation stage:
video -> learned skill -> practice fight -> metrics -> adjustment -> repeat.

For practice, Zoya must be connected and you should join when you want to
fight her or provide a controlled training target. We should not require you
to sit in the server while a video is merely being processed.

## First Sword PvP training loop

1. Put the two sword montage files in a local training-video folder.
2. Run the video extraction tool (next step).
3. Review/label the extracted high-value sequences as Sword skills.
4. Store the resulting skill records in Zoya's training library.
5. Start a controlled Sword PvP practice session on the test server.
6. Measure hit rate, spacing, sprint-reset consistency, combo duration,
   damage dealt/taken, healing decisions and deaths.
7. Adjust the learned policy and repeat.
8. Promote a skill to the production Sword kit only after deterministic tests
   pass.

## Important

The videos must not directly control Mineflayer. They teach the kit what a
high-level decision pattern looks like. The runtime still needs a
deterministic action controller, explicit ownership/cancellation, and
Mineflayer-compatible movement/combat execution.

This prevents video learning from recreating the current competing action
writers problem.
