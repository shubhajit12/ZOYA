#!/usr/bin/env node
/**
 * ZOYA Sword PvP Adaptive Trainer
 * Learns bounded policy parameters from live combat outcomes.
 * This is online policy optimization, not LLM token training.
 */
import fs from "node:fs";
import path from "node:path";
const ROOT=path.resolve(process.env.ZOYA_PVP_TRAINING_DIR||"./minecraft-training");
const MODEL=path.join(ROOT,"sword","swordPvpModel.json");
const EXPERIENCE=path.join(ROOT,"sword","live","sword-experience.jsonl");
const HISTORY=path.join(ROOT,"sword","live","sword-learning-history.jsonl");
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
if(!fs.existsSync(MODEL)) throw new Error("Sword model does not exist. Run npm run train:sword:brain first.");
if(!fs.existsSync(EXPERIENCE)) throw new Error("No live Sword experience exists yet.");
const model=JSON.parse(fs.readFileSync(MODEL,"utf8"));
const allRows=fs.readFileSync(EXPERIENCE,"utf8").split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
const offset=num(model.trainingState?.experienceLines,0);
const rows=allRows.slice(offset);
const attacks=rows.filter(r=>r.event==="attack").length;
const hits=rows.filter(r=>r.event==="hit");
const taken=rows.filter(r=>r.event==="taken");
const decisions=rows.filter(r=>r.event==="decision");
const accuracy=attacks?hits.length/attacks:0;
const hitDamage=hits.reduce((s,r)=>s+num(r.damage),0);
const takenDamage=taken.reduce((s,r)=>s+num(r.damage),0);
const attackRows=rows.filter(r=>r.event==="decision" && r.action==="attack");
const farAttacks=attackRows.filter(r=>num(r.distance)>3.05).length;
const closeAttacks=attackRows.filter(r=>num(r.distance)<=2.6).length;
const totalAttackDecisions=attackRows.length;
const resetDecisions=decisions.filter(r=>r.action==="sprint_reset").length;
const critDecisions=decisions.filter(r=>r.action==="falling_crit").length;
model.skillWeights=model.skillWeights||{};
for(const k of ["movement","spacing","sprint_reset","attack_timing","crit_timing","combo_control","defense","healing"]) model.skillWeights[k]=clamp(num(model.skillWeights[k],1),0.5,1.5);
// Conservative updates: reward measured hit quality, penalize misses/excess incoming damage.
// Each update is bounded so a bad round cannot radically change behavior.
const reward=accuracy>=0.65?0.035:accuracy>=0.45?0.015:-0.02;
model.skillWeights.spacing=clamp(model.skillWeights.spacing+(farAttacks? -0.04:reward),0.5,1.5);
if(model.policy?.spacing && totalAttackDecisions){
  // Learn the attack-distance ceiling from observed outcomes, but keep the
  // policy inside legitimate sword reach so a single noisy round cannot
  // create impossible attacks.
  const farRate=farAttacks/totalAttackDecisions;
  const currentCeiling=num(model.policy.spacing.attackMax,3.05);
  model.policy.spacing.attackMax=clamp(currentCeiling-(farRate*0.08)+(accuracy>=0.65?0.01:0),2.70,3.05);
}
model.skillWeights.attack_timing=clamp(model.skillWeights.attack_timing+(accuracy>=0.6?0.03:-0.025),0.5,1.5);
model.skillWeights.sprint_reset=clamp(model.skillWeights.sprint_reset+(hits.length>=2?0.025:-0.015),0.5,1.5);
if(model.policy?.sprintReset){
  const oldReset=num(model.policy.sprintReset.durationMs,100);
  model.policy.sprintReset.durationMs=clamp(oldReset+(hits.length>=2?3:-4),60,160);
}
model.skillWeights.combo_control=clamp(model.skillWeights.combo_control+(hits.length>=3?0.025:-0.01),0.5,1.5);
if(model.policy?.combat){
  const oldStrafe=num(model.policy.combat.strafeDurationMs,160);
  model.policy.combat.strafeDurationMs=clamp(oldStrafe+(hits.length>=3?5:-3),80,260);
}
model.skillWeights.crit_timing=clamp(model.skillWeights.crit_timing+(critDecisions&&accuracy>=0.55?0.02:-0.005),0.5,1.5);
model.skillWeights.defense=clamp(model.skillWeights.defense+(takenDamage>hitDamage&&takenDamage>4?0.035:-0.005),0.5,1.5);
if(model.policy?.healing && takenDamage>hitDamage&&takenDamage>4){
  model.policy.healing.minimumDistance=clamp(num(model.policy.healing.minimumDistance,4)+0.2,3.5,7);
}
model.skillWeights.movement=clamp(model.skillWeights.movement+(closeAttacks>farAttacks?0.02:-0.015),0.5,1.5);
model.trainingState={roundsCompleted:num(model.trainingState?.roundsCompleted,0)+1,experienceLines:allRows.length,lastAccuracy:accuracy,lastDamageDealt:hitDamage,lastDamageTaken:takenDamage,lastUpdatedAt:new Date().toISOString()};
model.trainingMode="adaptive-online-policy";
model.trainedAt=new Date().toISOString();
model.learning={accuracy,damageDealt:hitDamage,damageTaken:takenDamage,attacks,hits:hits.length,decisions:decisions.length,farAttacks,farAttackRate:totalAttackDecisions?farAttacks/totalAttackDecisions:0,resetDecisions,critDecisions,policyAdaptation:"bounded"};
fs.writeFileSync(MODEL,JSON.stringify(model,null,2));
fs.mkdirSync(path.dirname(HISTORY),{recursive:true});
fs.appendFileSync(HISTORY,JSON.stringify({at:new Date().toISOString(),trainingState:model.trainingState,learning:model.learning,skillWeights:model.skillWeights})+"\n");
console.log("[SWORD-LEARN] round="+model.trainingState.roundsCompleted+" accuracy="+(accuracy*100).toFixed(1)+"% dealt="+hitDamage.toFixed(2)+" taken="+takenDamage.toFixed(2));
console.log("[SWORD-LEARN] skillWeights="+JSON.stringify(model.skillWeights));
console.log("[SWORD-LEARN] model updated="+MODEL);
