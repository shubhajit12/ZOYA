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
  sword:Object.freeze({id:"sword",displayName:"Sword PvP",status:"active",skillGroups:Object.freeze(["spacing","sprint_reset","crit_timing","combo_control","tracking","repositioning","defense","healing","recovery"])}),
  axe:Object.freeze({id:"axe",displayName:"Axe PvP",status:"active",skillGroups:Object.freeze(["shield_break","spacing","crit_timing","combo_control","recovery"])}),
  mace:Object.freeze({id:"mace",displayName:"Mace PvP",status:"active",skillGroups:Object.freeze(["height_control","fall_prediction","wind_charge","elytra_counterplay","recovery"])}),
  spear:Object.freeze({id:"spear",displayName:"Spear PvP",status:"active",skillGroups:Object.freeze(["reach","charge","spacing","shield_counterplay","recovery"])}),
  crystal:Object.freeze({id:"crystal",displayName:"Crystal PvP",status:"active-gated",skillGroups:Object.freeze(["placement","breaking","totem_management","blast_safety","repositioning"])}),
  anchor:Object.freeze({id:"anchor",displayName:"Anchor PvP",status:"active-gated",skillGroups:Object.freeze(["placement","breaking","blast_safety","nether","recovery"])}),
  bow:Object.freeze({id:"bow",displayName:"Bow PvP",status:"active",skillGroups:Object.freeze(["trajectory","prediction","spacing","pressure"])}),
  crossbow:Object.freeze({id:"crossbow",displayName:"Crossbow PvP",status:"active",skillGroups:Object.freeze(["trajectory","prediction","burst","spacing"])}),
  shield:Object.freeze({id:"shield",displayName:"Shield Combat",status:"active",skillGroups:Object.freeze(["projectile_defense","melee_defense","timing"])}),
  elytra:Object.freeze({id:"elytra",displayName:"Elytra Combat",status:"planned-gated",skillGroups:Object.freeze(["flight","mace","rocket","trajectory","recovery"])}),
  utility:Object.freeze({id:"utility",displayName:"PvP Utility",status:"active",skillGroups:Object.freeze(["healing","pearls","totem","water","debuff","environment","recovery"])})
});
export function normalizePvpKit(value) {
  const wanted=String(value||"").trim().toLowerCase().replace(/\s+/g," ");
  if(!wanted)return null;
  return Object.values(PVP_KITS).find(k=>k.id===wanted||k.displayName.toLowerCase()===wanted)||null;
}
export function listPvpKits(){return Object.values(PVP_KITS).map(k=>({id:k.id,displayName:k.displayName,status:k.status,skillGroups:[...k.skillGroups]}));}
