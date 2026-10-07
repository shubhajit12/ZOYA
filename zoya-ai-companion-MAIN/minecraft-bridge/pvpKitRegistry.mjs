/**
 * ZOYA PvP kit registry.
 *
 * A kit is a complete PvP discipline. The active kit owns combat decisions
 * and, once wired into the runtime, the main-hand/equipment action domain.
 *
 * This file intentionally contains no live combat behavior yet. It is the
 * stable contract that video-derived skills will plug into.
 */
export const PVP_KITS = Object.freeze({
  sword: Object.freeze({
    id: "sword",
    displayName: "Sword PvP",
    commandAliases: Object.freeze(["sword pvp","sword","sharpness sword pvp","sharpness sword"]),
    sourceType: "video_reference",
    status: "training",
    skillGroups: Object.freeze(["movement","spacing","sprint_reset","attack_timing","crit_timing","combo_control","target_tracking","repositioning","defense","healing","disengagement","recovery"])
  }),
  mace: Object.freeze({
    id: "mace",
    displayName: "Mace PvP",
    commandAliases: Object.freeze(["mace pvp","mace"]),
    sourceType: "video_reference",
    status: "planned",
    skillGroups: Object.freeze(["mace_combat","wind_charge","elytra_mace","rocket_control","height_control","anti_mace","healing","disengagement","recovery"])
  }),
  crystal: Object.freeze({
    id: "crystal",
    displayName: "Crystal PvP",
    commandAliases: Object.freeze(["crystal pvp","crystal"]),
    sourceType: "video_reference",
    status: "planned",
    skillGroups: Object.freeze(["crystal_placement","crystal_breaking","obsidian","totem_management","positioning","healing","disengagement","recovery"])
  })
});
export function normalizePvpKit(value) {
  const wanted = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!wanted) return null;
  for (const kit of Object.values(PVP_KITS)) {
    if (kit.id === wanted || kit.displayName.toLowerCase() === wanted || kit.commandAliases.includes(wanted)) return kit;
  }
  return null;
}
export function listPvpKits() {
  return Object.values(PVP_KITS).map(kit => ({id:kit.id,displayName:kit.displayName,status:kit.status,skillGroups:[...kit.skillGroups]}));
}
