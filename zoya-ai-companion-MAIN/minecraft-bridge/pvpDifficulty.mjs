/**
 * ZOYA PvP difficulty profiles.
 *
 * TheobaldTheBot is a closed implementation, so these are behavioral targets
 * based on its publicly observable practice-bot settings/mechanics rather than
 * copied source. No randomness or adaptive learning is used.
 */
export const PVP_DIFFICULTIES=Object.freeze({
  easy:Object.freeze({
    id:"easy",styleLockMs:1800,styleSwitchMargin:12,strafeMs:190,sprintResetMs:100,
    wTap:true,sTap:false,jumpReset:false,predictLead:.08,
    attackRange:3.05,critMinRange:2.45,aggression:1
  }),
  normal:Object.freeze({
    id:"normal",styleLockMs:1300,styleSwitchMargin:14,strafeMs:165,sprintResetMs:95,
    wTap:true,sTap:true,jumpReset:true,predictLead:.1,
    attackRange:3.05,critMinRange:2.45,aggression:1.05
  }),
  hard:Object.freeze({
    id:"hard",styleLockMs:850,styleSwitchMargin:16,strafeMs:145,sprintResetMs:90,
    wTap:true,sTap:true,jumpReset:true,predictLead:.12,
    attackRange:3.05,critMinRange:2.45,aggression:1.1
  }),
  impossible:Object.freeze({
    // Deliberately tighter decision/movement cadence than Hard. This controls
    // legitimate input timing and tactical switching; it never enlarges
    // Minecraft's actual hit reach or bypasses server attack cooldowns.
    id:"impossible",styleLockMs:500,styleSwitchMargin:10,strafeMs:95,sprintResetMs:62,
    wTap:true,sTap:true,jumpReset:true,predictLead:.18,
    attackRange:3.05,critMinRange:2.45,aggression:1.25
  })
});

export const THEO_PVP_DIFFICULTY=Object.freeze({
  ...PVP_DIFFICULTIES.impossible,
  id:"theobald-impossible"
});

export function resolvePvpDifficulty(value){
  const key=String(value||"impossible").toLowerCase();
  return PVP_DIFFICULTIES[key]||THEO_PVP_DIFFICULTY;
}
