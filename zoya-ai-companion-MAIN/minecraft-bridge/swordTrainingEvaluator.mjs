#!/usr/bin/env node
import fs from "node:fs";
const file=process.env.ZOYA_SWORD_TELEMETRY||"minecraft-training/sword/live/sword-rounds.jsonl";
if(!fs.existsSync(file)){console.log("[SWORD-EVAL] No live rounds yet.");process.exit(0);}
const rows=fs.readFileSync(file,"utf8").split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
const n=rows.length,attacks=rows.reduce((s,r)=>s+Number(r.attacks||0),0),hits=rows.reduce((s,r)=>s+Number(r.hits||0),0),dealt=rows.reduce((s,r)=>s+Number(r.damageDealt||0),0),taken=rows.reduce((s,r)=>s+Number(r.damageTaken||0),0);
const accuracy=attacks?hits/attacks:0;
const score=Math.max(0,Math.min(100,accuracy*45+Math.min(1,dealt/Math.max(1,taken+1))*35+Math.min(1,n/10)*20));
const report={generatedAt:new Date().toISOString(),rounds:n,attacks,hits,attackAccuracy:accuracy,damageDealt:dealt,damageTaken:taken,score:Number(score.toFixed(2))};
fs.mkdirSync("minecraft-training/sword/live",{recursive:true});fs.writeFileSync("minecraft-training/sword/live/sword-evaluation.json",JSON.stringify(report,null,2));
console.log("[SWORD-EVAL] rounds="+n+" attacks="+attacks+" hits="+hits+" accuracy="+(accuracy*100).toFixed(1)+"% damage="+dealt.toFixed(2)+"/"+taken.toFixed(2)+" score="+report.score);
