#!/usr/bin/env node
import mineflayer from "mineflayer";
const host=process.env.ZOYA_TRAIN_HOST||"127.0.0.1",port=Number(process.env.ZOYA_TRAIN_PORT||25565),username=process.env.ZOYA_TRAIN_OPPONENT||"ZoyaTrainer",mode=String(process.env.ZOYA_TRAIN_OPPONENT_MODE||"strafe").toLowerCase(),targetName=String(process.env.ZOYA_TRAIN_TARGET||"ZOYA"),durationMs=Math.max(10000,Number(process.env.ZOYA_TRAIN_ROUND_MS||120000));
const bot=mineflayer.createBot({host,port,username});let target=null,started=0,sign=1,attacks=0,hits=0;
const log=m=>console.log("[SWORD-OPPONENT] "+m);
const find=()=>Object.values(bot.players||{}).find(p=>String(p?.username||"").toLowerCase()===targetName.toLowerCase())?.entity||null;
const equip=async()=>{const i=bot.inventory.items().find(x=>String(x.name).endsWith("_sword"));if(i&&bot.heldItem?.name!==i.name)await bot.equip(i,"hand");};
async function act(){if(!bot.entity||!target)return;const d=bot.entity.position.distanceTo(target.position);if(mode==="stationary")bot.clearControlStates();else if(mode==="retreat"){bot.setControlState("back",true);bot.setControlState("sprint",true);}else{bot.setControlState("forward",true);bot.setControlState(sign>0?"left":"right",true);bot.setControlState("sprint",true);}await bot.lookAt(target.position.offset(0,target.height||1.2,0),true);if(d<=3.05){await equip();bot.attack(target);attacks++;}sign*=-1;}
bot.once("spawn",()=>{started=Date.now();log("connected mode="+mode+" target="+targetName);});
bot.on("entityHurt",e=>{if(e===target)hits++;});
const timer=setInterval(async()=>{if(Date.now()-started>durationMs){clearInterval(timer);bot.quit("training round complete");return;}target=find();if(!target){bot.clearControlStates();return;}try{await act();}catch(e){log("action error: "+(e?.message||String(e)));}},180);
bot.on("kicked",r=>log("kicked: "+JSON.stringify(r)));bot.on("error",e=>log("error: "+(e?.message||String(e))));bot.on("end",()=>{clearInterval(timer);log("round ended attacks="+attacks+" hits="+hits);});
