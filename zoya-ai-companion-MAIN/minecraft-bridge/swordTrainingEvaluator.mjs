#!/usr/bin/env node
import fs from "node:fs";
const live="minecraft-training/sword/live";
const exp=process.env.ZOYA_SWORD_EXPERIENCE||live+"/sword-experience.jsonl";
const rounds=live+"/sword-rounds.jsonl";
const modelFile="minecraft-training/sword/swordPvpModel.json";
const parse=p=>fs.existsSync(p)?fs.readFileSync(p,"utf8").split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x)):[];
const events=parse(exp);
const roundRows=parse(rounds);
const keys=[...new Set(events.map(e=>String(e.roundStartedAt||"unknown")))];
function calc(rows){
 const attacks=rows.filter(e=>e.event==="attack"),hits=rows.filter(e=>e.event==="hit"),taken=rows.filter(e=>e.event==="taken"),decisions=rows.filter(e=>e.event==="decision");
 const dealt=hits.reduce((s,e)=>s+Number(e.damage||0),0),damageTaken=taken.reduce((s,e)=>s+Number(e.damage||0),0);
 const accuracy=attacks.length?hits.length/attacks.length:0;
 const valid=attacks.filter(e=>Number(e.distance)<=3.05).length;
 const far=attacks.length-valid;
 const spacing=attacks.length?valid/attacks.length:1;
 const damageRatio=damageTaken>0?dealt/damageTaken:dealt>0?2:0;
 const resets=decisions.filter(e=>e.action==="sprint_reset").length;
 const crits=attacks.filter(e=>e.kind==="falling_crit"||e.kind==="jump_crit").length;
 const score=Math.max(0,Math.min(100,accuracy*30+Math.min(1,damageRatio/1.5)*30+spacing*15+Math.min(1,resets/3)*10+Math.min(1,crits/2)*5+(damageTaken<=dealt?10:0)));
 return {attacks:attacks.length,hits:hits.length,attackAccuracy:accuracy,damageDealt:dealt,damageTaken,damageRatio,spacingQuality:spacing,farAttacks:far,decisions:decisions.length,sprintResets:resets,critAttempts:crits,score:Number(score.toFixed(2))};
}
const latestKey=keys.at(-1);
const latest=latestKey?calc(events.filter(e=>String(e.roundStartedAt||"unknown")===latestKey)):calc([]);
const cumulative=calc(events);
let model=null;try{model=JSON.parse(fs.readFileSync(modelFile,"utf8"));}catch{}
const pass=latest.attackAccuracy>=Number(process.env.ZOYA_TRAIN_MIN_ACCURACY||.55)&&latest.score>=Number(process.env.ZOYA_TRAIN_MIN_SCORE||55)&&latest.damageRatio>=Number(process.env.ZOYA_TRAIN_MIN_DAMAGE_RATIO||1.05);
const report={generatedAt:new Date().toISOString(),rounds:roundRows.length,latestRoundStartedAt:latestKey||null,latestRound:latest,cumulative,masteryRoundPassed:pass,trainingMode:model?.trainingMode||"unknown",trainingState:model?.trainingState||null,skillWeights:model?.skillWeights||null};
fs.mkdirSync(live,{recursive:true});fs.writeFileSync(live+"/sword-evaluation.json",JSON.stringify(report,null,2));
console.log("[SWORD-EVAL] round="+(roundRows.length||"?")+" attacks="+latest.attacks+" hits="+latest.hits+" accuracy="+(latest.attackAccuracy*100).toFixed(1)+"% dealt="+latest.damageDealt.toFixed(2)+" taken="+latest.damageTaken.toFixed(2)+" score="+latest.score+" ratio="+(Number.isFinite(latest.damageRatio)?latest.damageRatio.toFixed(2):"INF")+" masteryRound="+pass);
