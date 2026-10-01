import pathfinderPackage from "mineflayer-pathfinder";
const { goals } = pathfinderPackage;

import { CAPABILITY_MODES, assertCapabilityRegistry } from "./capabilityModes.mjs";

export const CAPABILITIES = CAPABILITY_MODES;

const HOSTILES = new Set(["zombie","husk","drowned","skeleton","stray","creeper","spider","cave_spider","witch","pillager","vindicator","evoker","ravager","phantom","blaze","magma_cube","silverfish","endermite","guardian","elder_guardian","piglin_brute","hoglin","zoglin"]);
export const RUNTIME_ACTIONS = new Set(["follow_player","roam","pvp","explore","return","investigate_entity","mine","chop_tree","craft","eat","collect","gather_resources","guard","guard_location","gather_missing_materials"]);

const required=(value,message="Argument is required.")=>{const v=String(value??"").trim();if(!v)throw new Error(message);return v;};
const split=(value)=>String(value??"").trim().split(/\s+/).filter(Boolean);
const coords=(value)=>{const p=split(value).map(Number);if(p.length!==3||p.some(n=>!Number.isFinite(n)))throw new Error("Expected x y z.");return{x:p[0],y:p[1],z:p[2]};};
const vec=(bot,p)=>{const C=bot.entity?.position?.constructor;if(typeof C!=="function")throw new Error("Mineflayer Vec3 unavailable.");return new C(Number(p.x),Number(p.y),Number(p.z));};
const findPlayer=(bot,name)=>{const w=required(name,"Username is required.").toLowerCase();return Object.values(bot.players||{}).find(p=>String(p?.username||"").toLowerCase()===w)||null;};
const findEntity=(bot,name="")=>{const w=String(name).trim().toLowerCase();return Object.values(bot.entities||{}).filter(e=>e?.position&&e!==bot.entity&&(!w||String(e.username||e.name||e.displayName||"").toLowerCase().includes(w))).sort((x,y)=>x.position.distanceTo(bot.entity.position)-y.position.distanceTo(bot.entity.position))[0]||null;};
const item=(bot,name)=>{const w=required(name,"Item is required.").toLowerCase();return bot.inventory.items().find(i=>i.name.toLowerCase()===w)||bot.inventory.items().find(i=>i.name.toLowerCase().includes(w));};
const weaponScore=(name)=>{const n=String(name).toLowerCase();const m=n.includes("netherite")?7:n.includes("diamond")?6:n.includes("iron")?5:n.includes("stone")?4:n.includes("golden")?3:n.includes("wooden")?2:0;const t=n.includes("mace")?4:n.includes("sword")?3:n.includes("axe")?2:n.includes("trident")?1:0;return m*10+t;};

async function navigate(ctx,position,range=2,label="navigation"){
  const target=vec(ctx.bot,position);const goal=new goals.GoalNear(target.x,target.y,target.z,range);ctx.bot.pathfinder.setGoal(goal);
  const deadline=Date.now()+30000;
  try{while(Date.now()<deadline){ctx.assertActive();if(ctx.bot.entity.position.distanceTo(target)<=range)return true;await ctx.sleep(100);}throw new Error(label+" timed out.");}
  finally{try{ctx.bot.pathfinder.setGoal(null)}catch{}}
}

async function followPlayer(ctx,username,range=2){
  const player=findPlayer(ctx.bot,username);
  const target=player?.entity;
  if(!target)throw new Error("Player not found.");
  const targetUsername=player.username;
  const goal=new goals.GoalFollow(target,range);
  ctx.bot.pathfinder.setGoal(goal,true);
  try{
    while(true){
      ctx.assertActive();
      if(!target.isValid || !ctx.bot.players[targetUsername]?.entity)throw new Error("Follow target is no longer available.");
      await ctx.sleep(150);
    }
  }finally{
    try{ctx.bot.pathfinder.setGoal(null);}catch{}
  }
}

async function lookAtBlockGoal(ctx,position,reach=4.5,label="block interaction"){
  const target=vec(ctx.bot,position);
  const goal=new goals.GoalLookAtBlock(target,ctx.bot.world,{reach});
  ctx.bot.pathfinder.setGoal(goal);
  const deadline=Date.now()+30000;
  try{
    while(Date.now()<deadline){
      ctx.assertActive();
      if(ctx.bot.entity.position.distanceTo(target)<=reach+1)return true;
      await ctx.sleep(100);
    }
    throw new Error(label+" timed out.");
  }finally{try{ctx.bot.pathfinder.setGoal(null)}catch{}}
}
async function combatHit(ctx,target){
  if(target.position.distanceTo(ctx.bot.entity.position)>3.1)await navigate(ctx,target.position,2.6,"combat navigation");
  ctx.assertActive();await ctx.bot.lookAt(target.position.offset(0,target.height||1.4,0),true);ctx.bot.attack(target);return true;
}
async function nativeCraft(ctx,itemName,amount=1){
  const {bot}=ctx;
  const requested=required(itemName,"Item is required.").toLowerCase().replace(/\\s+/g,"_");
  const targetItem=bot.registry?.itemsByName?.[requested];
  if(!targetItem)throw new Error("Craft item not found: "+requested);
  const targetAmount=Math.max(1,Math.floor(Number(amount)||1));
  let table=null;
  let recipes=bot.recipesFor(targetItem.id,null,targetAmount,null);
  if(!recipes.length){
    const tableId=bot.registry?.blocksByName?.crafting_table?.id;
    table=tableId!=null?bot.findBlock?.({matching:tableId,maxDistance:16})||null:null;
    if(!table)throw new Error("No crafting recipe available nearby.");
    recipes=bot.recipesFor(targetItem.id,null,targetAmount,table);
  }
  if(!recipes.length)throw new Error("No crafting recipe available for "+requested+".");
  const recipe=recipes[0];
  const resultPerCraft=Math.max(1,Number(recipe.result?.count||1));
  const craftsNeeded=Math.max(1,Math.ceil(targetAmount/resultPerCraft));
  if(recipe.requiresTable&&!table){
    const tableId=bot.registry?.blocksByName?.crafting_table?.id;
    table=tableId!=null?bot.findBlock?.({matching:tableId,maxDistance:16})||null:null;
    if(!table)throw new Error("Crafting table required but none is nearby.");
  }
  if(table&&bot.entity.position.distanceTo(table.position)>3.5){
    await navigate(ctx,table.position,3,"crafting-table navigation");
  }
  const before=bot.inventory.items().filter(i=>i.name===targetItem.name).reduce((n,i)=>n+i.count,0);
  ctx.assertActive();
  await bot.craft(recipe,craftsNeeded,table);
  ctx.assertActive();
  const after=bot.inventory.items().filter(i=>i.name===targetItem.name).reduce((n,i)=>n+i.count,0);
  if(after<before+targetAmount)throw new Error("Craft completed without producing the requested amount.");
  return true;
}

async function runtimeAction(ctx,id,arg){
  const options={permissionGranted:true};
  const p=split(arg);
  if(id==="pvp"||id==="look_at_player"||id==="follow_player")options.targetUsername=required(arg,"Username is required.");
  if(id==="follow_player"){
    return ctx.runtime.runManualCapability("clean:follow_player",async task=>{
      ctx.task=task;
      return followPlayer(ctx,options.targetUsername);
    });
  }
  if(id==="mine")options.blockName=required(arg,"Block is required.");
  if(id==="eat")options.itemName=String(arg||"").trim();
  if(id==="collect"||id==="gather_resources"){options.itemName=p[0]||"";options.amount=Math.max(1,Number(p[1])||1);}
  if(id==="gather_missing_materials"){options.itemName=required(arg,"Item is required.");options.amount=1;}
  if(id==="craft"){
    const amount=Math.max(1,Number(p.at(-1))||1);
    const itemName=p.slice(0,-1).join("_")||p[0]||"";
    return ctx.runtime.runManualCapability("clean:craft",async task=>{
      ctx.task=task;
      return nativeCraft(ctx,itemName,amount);
    });
  }
  if(id==="investigate_entity")options.entityName=required(arg,"Entity name is required.");
  if(id==="guard"||id==="guard_location")options.position=coords(arg);
  const mapped=id==="roam"?"safe_roam"
    :id==="return"?"return_to_owner"
    :id==="gather_resources"?"gather_basic_resources"
    :id==="gather_missing_materials"?"gather_basic_resources"
    :id;
  const continuous=id==="roam";
  return ctx.runtime.runManualCapability("clean:"+mapped,async task=>{
    ctx.task=task;
    return ctx.runtime.execute(mapped,{...options,continuous,__task:task});
  });
}

async function lowLevel(ctx,id,arg){
  const {bot}=ctx;
  if(RUNTIME_ACTIONS.has(id))return runtimeAction(ctx,id,arg);
  switch(id){
    case "stop": ctx.runtime.cancelCurrentTask?.("manual stop"); return true;
    case "hit":{const t=findPlayer(bot,arg)?.entity;if(!t)throw new Error("Player not found.");return combatHit(ctx,t);}
    case "go_to":return navigate(ctx,coords(arg),2,"go_to");
    case "return_to_coordinates":return navigate(ctx,coords(arg),2,"return_to_coordinates");
    case "look_at_coordinates":await bot.lookAt(vec(bot,coords(arg)),true);return true;
    case "look_at_player":{const p=findPlayer(bot,arg)?.entity;if(!p)throw new Error("Player not found.");await bot.lookAt(p.position.offset(0,p.height||1.4,0),true);return true;}
    case "chat":bot.chat(required(arg,"Message is required.").slice(0,256));return true;
    case "private_chat":case "whisper_player":{const a=split(arg),u=required(a.shift(),"Username is required."),m=required(a.join(" "),"Message is required.");if(!findPlayer(bot,u))throw new Error("Player not found.");bot.whisper(u,m.slice(0,256));return true;}
    case "report_result":case "ask_clarification":bot.chat(required(arg,"Message is required.").slice(0,256));return true;
    case "wait":await ctx.sleep(Math.max(0,Number(required(arg,"Seconds are required."))*1000));return true;
    case "sprint":bot.setControlState("sprint",true);try{await ctx.sleep(Math.max(0,Number(required(arg))*1000));}finally{bot.setControlState("sprint",false);}return true;
    case "sneak":bot.setControlState("sneak",true);try{await ctx.sleep(Math.max(0,Number(required(arg))*1000));}finally{bot.setControlState("sneak",false);}return true;
    case "jump":bot.setControlState("jump",true);await ctx.sleep(250);bot.setControlState("jump",false);return true;
    case "enter_exit_vehicle":if(bot.vehicle){bot.dismount();return true;}throw new Error("Vehicle target selection requires a specific nearby vehicle.");
    case "attack_mob":{const t=findEntity(bot,arg)||Object.values(bot.entities||{}).find(e=>e?.position&&HOSTILES.has(String(e.name||"").toLowerCase()));if(!t)throw new Error("Target mob not found.");return combatHit(ctx,t);}
    case "hunt":{
      const requested=String(arg||"").trim().toLowerCase();
      const target=Object.values(bot.entities||{})
        .filter(e=>e?.position&&e!==bot.entity&&HOSTILES.has(String(e.name||"").toLowerCase())&&(!requested||String(e.name||"").toLowerCase().includes(requested)))
        .sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0];
      if(!target)throw new Error("Target hostile mob not found.");
      let attacked=false;
      const deadline=Date.now()+30000;
      while(Date.now()<deadline&&target.isValid!==false&&(target.health==null||target.health>0)){
        ctx.assertActive();
        if(target.position.distanceTo(bot.entity.position)>3.1){
          bot.pathfinder.setGoal(new goals.GoalFollow(target,2.7),true);
          await ctx.sleep(150);
          continue;
        }
        try{bot.pathfinder.setGoal(null)}catch{}
        await bot.lookAt(target.position.offset(0,target.height||1,0),true);
        bot.attack(target);
        attacked=true;
        await ctx.sleep(450);
      }
      try{bot.pathfinder.setGoal(null)}catch{}
      if(!attacked)throw new Error("Hunt could not reach the target.");
      return true;
    }
    case "retrieve_item":{
      const a=split(arg);
      const itemName=required(a.shift(),"Item is required.");
      const p=coords(a.splice(0,3).join(" "));
      const amount=Math.max(1,Number(a[0])||1);
      return executeCapability("retrieve",itemName+" "+p.x+" "+p.y+" "+p.z+" "+amount,ctx);
    }
    case "equip_best_weapon":{const xs=bot.inventory.items().filter(i=>/sword|axe|mace|trident/.test(i.name)).sort((a,b)=>weaponScore(b.name)-weaponScore(a.name));if(!xs[0])throw new Error("No weapon found.");await bot.equip(xs[0],"hand");return true;}
    case "equip_item":{const i=item(bot,arg);if(!i)throw new Error("Item not found.");await bot.equip(i,"hand");return true;}
    case "use_shield":{const i=item(bot,"shield");if(!i)throw new Error("Shield not found.");await bot.equip(i,"off-hand");bot.activateItem(true);await ctx.sleep(750);bot.deactivateItem();return true;}
    case "use_item":{const i=item(bot,arg);if(!i)throw new Error("Item not found.");await bot.equip(i,"hand");bot.activateItem();await ctx.sleep(500);bot.deactivateItem();return true;}
    case "fish":await bot.fish();return true;
    case "eat":{const i=item(bot,arg);if(!i)throw new Error("Food item not found.");await bot.equip(i,"hand");await bot.consume();return true;}
    case "drop_item":{const i=item(bot,arg);if(!i)throw new Error("Item not found.");await bot.tossStack(i);return true;}
    case "count_item":{const w=required(arg).toLowerCase();const n=bot.inventory.items().filter(i=>i.name.toLowerCase().includes(w)).reduce((s,i)=>s+i.count,0);ctx.log("[INVENTORY] "+w+" = "+n);return true;}
    case "find_item":{const i=item(bot,arg);if(!i)throw new Error("Item not found.");ctx.log("[INVENTORY] "+i.name+" x"+i.count);return true;}
    case "check_inventory":ctx.log("[INVENTORY] "+bot.inventory.items().map(i=>i.name+" x"+i.count).join(", ")||"empty");return true;
    case "check_health":ctx.log("[HEALTH] "+bot.health+" / 20");return true;
    case "check_food":ctx.log("[FOOD] "+bot.food+" / 20");return true;
    case "check_equipment":ctx.log("[EQUIPMENT] held="+(bot.heldItem?.name||"empty")+" armor="+bot.inventory.items().filter(i=>i.slot>=5&&i.slot<=8).map(i=>i.name).join(", "));return true;
    case "find_player":{const p=findPlayer(bot,arg);if(!p)throw new Error("Player not found.");ctx.log("[PLAYER] "+p.username);return true;}
    case "find_entity":{const e=findEntity(bot,arg);if(!e)throw new Error("Entity not found.");ctx.log("[ENTITY] "+(e.name||e.displayName||e.username));return true;}
    case "find_item_world":{const e=findEntity(bot,arg);if(!e)throw new Error("World target not found.");ctx.log("[WORLD] "+(e.name||e.displayName));return true;}
    case "check_nearby":ctx.log("[NEARBY] "+Object.values(bot.entities||{}).filter(e=>e?.position&&e!==bot.entity&&e.position.distanceTo(bot.entity.position)<=16).map(e=>e.name||e.username||"entity").join(", "));return true;
    case "check_environment":ctx.log("[ENV] "+bot.entity.position.x.toFixed(2)+" "+bot.entity.position.y.toFixed(2)+" "+bot.entity.position.z.toFixed(2)+" | dimension="+bot.game?.dimension);return true;
    case "detect_hostiles":{const h=Object.values(bot.entities||{}).filter(e=>e?.position&&HOSTILES.has(String(e.name||"").toLowerCase())&&e.position.distanceTo(bot.entity.position)<=16);ctx.log("[HOSTILES] "+h.length+" -> "+h.map(e=>e.name).join(", "));return true;}
    case "sort_inventory":ctx.log("[SORT] "+bot.inventory.items().sort((a,b)=>a.name.localeCompare(b.name)).map(i=>i.name+" x"+i.count).join(", "));return true;
    case "coordinate":case "coordinate_with_player":{const a=split(arg),u=required(a.shift(),"Username is required."),p=findPlayer(bot,u)?.entity;if(!p)throw new Error("Player not found.");await navigate(ctx,p.position,3,"coordinate");bot.whisper(u,a.join(" ")||"I am here. Ready.");return true;}
    case "ask_permission":{const a=split(arg),u=required(a.shift(),"Username is required."),action=required(a.join(" "),"Action is required.");return ctx.runtime.askOwner?.(u,action,action)===true;}
    case "remember_player":{const a=split(arg),u=required(a.shift(),"Username is required."),fact=required(a.join(" "),"Fact is required.");if(!ctx.runtime.rememberPlayer)throw new Error("Memory service unavailable.");ctx.runtime.rememberPlayer(u,{facts:[fact]});return true;}
    case "watch":{const target=required(arg,"Watch target is required.");while(true){ctx.assertActive();const e=findPlayer(bot,target)?.entity||findEntity(bot,target);if(!e){ctx.terminate("target_lost");return false;}await bot.lookAt(e.position.offset(0,e.height||1.4,0),true);await ctx.sleep(250);}}
    case "op_command":{const c=required(arg,"Command is required.");bot.chat(c.startsWith("/")?c:"/"+c);return true;}
    case "use_ranged_weapon":{const t=findPlayer(bot,arg)?.entity||findEntity(bot,arg);if(!t)throw new Error("Target not found.");const i=item(bot,"bow")||item(bot,"crossbow");if(!i)throw new Error("Bow/crossbow not found.");await bot.equip(i,"hand");await bot.lookAt(t.position.offset(0,t.height||1.4,0),true);bot.activateItem();await ctx.sleep(1200);bot.deactivateItem();return true;}
    case "dig":case "break_block":{const p=coords(arg),b=bot.blockAt(vec(bot,p));if(!b||b.name==="air")throw new Error("Target block is air.");await navigate(ctx,p,3.5,id);await bot.dig(b);return true;}
    case "open_chest":case "open_barrel":{const p=coords(arg),b=bot.blockAt(vec(bot,p)),name=id==="open_chest"?"chest":"barrel";if(!b||!b.name.includes(name))throw new Error("Expected "+name+".");await lookAtBlockGoal(ctx,p,4.5,id);await bot.openContainer(b);return true;}
    case "open_door":case "close_door":case "use_button":case "use_lever":case "use_block":{const p=coords(arg),b=bot.blockAt(vec(bot,p));if(!b)throw new Error("Block not found.");await lookAtBlockGoal(ctx,p,4.5,id);await bot.activateBlock(b);return true;}
    case "place_block":{const a=split(arg),name=required(a.shift(),"Block is required."),p=coords(a.join(" ")),i=item(bot,name),target=bot.blockAt(vec(bot,p)),ref=bot.blockAt(vec(bot,{x:p.x,y:p.y-1,z:p.z}));if(!i)throw new Error("Placement item not found.");if(!target||target.name!=="air"||!ref)throw new Error("Placement target is not empty/valid.");const V=bot.entity.position.constructor;
    const faces=[new V(0,1,0),new V(0,-1,0),new V(1,0,0),new V(-1,0,0),new V(0,0,1),new V(0,0,-1)];
    const placeGoal=new goals.GoalPlaceBlock(vec(bot,p),bot.world,{range:4.5,LOS:true,faces});
    bot.pathfinder.setGoal(placeGoal);
    try{
      const deadline=Date.now()+30000;
      while(Date.now()<deadline){ctx.assertActive();if(bot.entity.position.distanceTo(vec(bot,p))<=4.5)break;await ctx.sleep(100);}
      if(Date.now()>=deadline)throw new Error("place_block navigation timed out.");
    }finally{try{bot.pathfinder.setGoal(null)}catch{}}
    await bot.equip(i,"hand");await bot.placeBlock(ref,new V(0,1,0));return true;}
    case "sleep":{const bed=bot.findBlock?.({matching:b=>String(b.name||"").endsWith("_bed"),maxDistance:16});if(!bed)throw new Error("No nearby bed found.");await navigate(ctx,bed.position,3.5,"sleep");await bot.sleep(bed);return true;}
    case "recover_after_death":await ctx.sleep(750);return true;
    case "observe":case "search":{const e=findEntity(bot,arg);if(e)await bot.lookAt(e.position.offset(0,e.height||1.4,0),true);ctx.log("[OBSERVE] "+(e?(e.name||e.username||"target"):"No matching target in loaded entities."));return true;}
    case "find_safe_location":case "find_shelter":ctx.log("[SAFETY] Current location="+bot.entity.position.x.toFixed(1)+" "+bot.entity.position.y.toFixed(1)+" "+bot.entity.position.z.toFixed(1));return true;
    case "harvest_crops":{const cropNames=new Set(["wheat","carrots","potatoes","beetroots","nether_wart"]);const b=bot.findBlock?.({matching:x=>cropNames.has(String(x.name||"")),maxDistance:16});if(!b)throw new Error("No mature crop found nearby.");await navigate(ctx,b.position,3.5,"crop navigation");await bot.dig(b);return true;}
    case "take_item":{const e=findEntity(bot,arg);if(!e||e.name!=="item")throw new Error("Dropped item not found.");await navigate(ctx,e.position,1.5,"item pickup");await ctx.sleep(400);return true;}
    case "give_item":case "deliver_item":{const a=split(arg),itemName=required(a.shift(),"Item is required."),u=required(a.shift(),"Username is required."),p=findPlayer(bot,u)?.entity,i=item(bot,itemName);if(!p)throw new Error("Player not found.");if(!i)throw new Error("Item not found.");await navigate(ctx,p.position,3,"delivery");await bot.equip(i,"hand");await bot.tossStack(i);ctx.log("[DELIVERY] Dropped "+itemName+" for "+u+".");return true;}
    case "deposit":case "retrieve":{const a=split(arg),itemName=required(a.shift(),"Item is required."),p=coords(a.join(" ")),b=bot.blockAt(vec(bot,p));if(!b||!["chest","barrel","shulker_box"].some(n=>b.name.includes(n)))throw new Error("Storage container not found.");await navigate(ctx,p,3.5,id);const c=await bot.openContainer(b);const data=bot.registry.itemsByName[itemName.toLowerCase()];if(!data)throw new Error("Unknown item: "+itemName);const amount=id==="deposit"?(bot.inventory.items().find(x=>x.name===data.name)?.count||0):Math.max(1,Number(a.at(-1))||1);if(amount<=0)throw new Error("Item not available.");if(id==="deposit")await c.deposit(data.id,null,amount,null);else await c.withdraw(data.id,null,amount,null);await c.close();return true;}
    case "craft_workbench":case "multi_step_craft":case "craft_furnace":{const name=required(arg,"Item is required.");return ctx.runtime.execute("craft",{itemName:name.replace(/\\s+/g,"_"),amount:1,permissionGranted:true});}
    case "gather_missing_materials":return ctx.runtime.execute("gather_missing_materials",{itemName:required(arg,"Item is required."),permissionGranted:true});
    case "smelt":{const wanted=required(arg,"Item is required.").toLowerCase();const furnace=bot.findBlock?.({matching:b=>String(b.name||"").includes("furnace"),maxDistance:16});if(!furnace)throw new Error("No nearby furnace.");await navigate(ctx,furnace.position,3.5,"furnace navigation");const f=await bot.openFurnace(furnace);const input=item(bot,wanted);if(!input)throw new Error("Smelting input not found.");const fuel=item(bot,"coal")||item(bot,"charcoal")||item(bot,"planks");if(!fuel)throw new Error("No furnace fuel found.");await f.putInput(input.type??input.itemId??input.id,null,input.count);await f.putFuel(fuel.type??fuel.itemId??fuel.id, null, Math.min(fuel.count,8));await ctx.sleep(1000);await f.takeOutput();await f.close();return true;}
    case "do_task":{const task=required(arg,"Task is required.");const lower=task.toLowerCase();if(lower.startsWith("mine "))return executeCapability("mine",task.slice(5),ctx);if(lower.startsWith("chop"))return executeCapability("chop_tree","",ctx);if(lower.startsWith("gather "))return executeCapability("gather_resources",task.slice(7),ctx);if(lower.startsWith("craft "))return executeCapability("craft",task.slice(6),ctx);throw new Error("do_task requires a concrete supported task: mine, chop, gather, or craft.");}
    case "build":{const m=required(arg,"Build plan is required.").match(/^(pillar|tower|line)\\s+(\\w+)\\s+(\\d+)$/i);if(!m)throw new Error("Build plan must be: pillar|tower|line <block> <count>.");const name=m[2].toLowerCase(),count=Math.max(1,Number(m[3]));const place=item(bot,name);if(!place)throw new Error("Build material not found: "+name);for(let n=0;n<count;n++){ctx.assertActive();const p=bot.entity.position.floored().offset(m[1].toLowerCase()==="line"?n:0,m[1].toLowerCase()==="line"?0:n,0);const target=bot.blockAt(p),ref=bot.blockAt(p.offset(0,-1,0));if(target?.name!=="air"||!ref)continue;await navigate(ctx,p,3.5,"build navigation");await bot.equip(place,"hand");await bot.placeBlock(ref,new (bot.entity.position.constructor)(0,1,0));}return true;}
    case "defend":case "escape":case "chase_target":case "escort_player":case "protect_player":return ctx.runtime.execute(id,{permissionGranted:true,targetUsername:split(arg)[0]});
    default:throw new Error("Clean handler missing for "+id);
  }
}

export const HANDLERS = {
  "follow_player": async (ctx, arg) => ctx.run("follow_player", arg),
  "roam": async (ctx, arg) => ctx.run("roam", arg),
  "pvp": async (ctx, arg) => ctx.run("pvp", arg),
  "hit": async (ctx, arg) => ctx.run("hit", arg),
  "gather_resources": async (ctx, arg) => ctx.run("gather_resources", arg),
  "do_task": async (ctx, arg) => ctx.run("do_task", arg),
  "coordinate": async (ctx, arg) => ctx.run("coordinate", arg),
  "explore": async (ctx, arg) => ctx.run("explore", arg),
  "observe": async (ctx, arg) => ctx.run("observe", arg),
  "return": async (ctx, arg) => ctx.run("return", arg),
  "investigate_entity": async (ctx, arg) => ctx.run("investigate_entity", arg),
  "mine": async (ctx, arg) => ctx.run("mine", arg),
  "chop_tree": async (ctx, arg) => ctx.run("chop_tree", arg),
  "craft": async (ctx, arg) => ctx.run("craft", arg),
  "eat": async (ctx, arg) => ctx.run("eat", arg),
  "collect": async (ctx, arg) => ctx.run("collect", arg),
  "look_at_player": async (ctx, arg) => ctx.run("look_at_player", arg),
  "chat": async (ctx, arg) => ctx.run("chat", arg),
  "private_chat": async (ctx, arg) => ctx.run("private_chat", arg),
  "go_to": async (ctx, arg) => ctx.run("go_to", arg),
  "look_at_coordinates": async (ctx, arg) => ctx.run("look_at_coordinates", arg),
  "stop": async (ctx, arg) => ctx.run("stop", arg),
  "wait": async (ctx, arg) => ctx.run("wait", arg),
  "return_to_coordinates": async (ctx, arg) => ctx.run("return_to_coordinates", arg),
  "sprint": async (ctx, arg) => ctx.run("sprint", arg),
  "sneak": async (ctx, arg) => ctx.run("sneak", arg),
  "jump": async (ctx, arg) => ctx.run("jump", arg),
  "enter_exit_vehicle": async (ctx, arg) => ctx.run("enter_exit_vehicle", arg),
  "attack_mob": async (ctx, arg) => ctx.run("attack_mob", arg),
  "defend": async (ctx, arg) => ctx.run("defend", arg),
  "guard": async (ctx, arg) => ctx.run("guard", arg),
  "escape": async (ctx, arg) => ctx.run("escape", arg),
  "chase_target": async (ctx, arg) => ctx.run("chase_target", arg),
  "equip_best_weapon": async (ctx, arg) => ctx.run("equip_best_weapon", arg),
  "use_shield": async (ctx, arg) => ctx.run("use_shield", arg),
  "use_ranged_weapon": async (ctx, arg) => ctx.run("use_ranged_weapon", arg),
  "dig": async (ctx, arg) => ctx.run("dig", arg),
  "harvest_crops": async (ctx, arg) => ctx.run("harvest_crops", arg),
  "fish": async (ctx, arg) => ctx.run("fish", arg),
  "hunt": async (ctx, arg) => ctx.run("hunt", arg),
  "find_shelter": async (ctx, arg) => ctx.run("find_shelter", arg),
  "recover_after_death": async (ctx, arg) => ctx.run("recover_after_death", arg),
  "find_safe_location": async (ctx, arg) => ctx.run("find_safe_location", arg),
  "check_inventory": async (ctx, arg) => ctx.run("check_inventory", arg),
  "find_item": async (ctx, arg) => ctx.run("find_item", arg),
  "count_item": async (ctx, arg) => ctx.run("count_item", arg),
  "equip_item": async (ctx, arg) => ctx.run("equip_item", arg),
  "drop_item": async (ctx, arg) => ctx.run("drop_item", arg),
  "give_item": async (ctx, arg) => ctx.run("give_item", arg),
  "take_item": async (ctx, arg) => ctx.run("take_item", arg),
  "deposit": async (ctx, arg) => ctx.run("deposit", arg),
  "retrieve": async (ctx, arg) => ctx.run("retrieve", arg),
  "sort_inventory": async (ctx, arg) => ctx.run("sort_inventory", arg),
  "smelt": async (ctx, arg) => ctx.run("smelt", arg),
  "craft_workbench": async (ctx, arg) => ctx.run("craft_workbench", arg),
  "craft_furnace": async (ctx, arg) => ctx.run("craft_furnace", arg),
  "gather_missing_materials": async (ctx, arg) => ctx.run("gather_missing_materials", arg),
  "multi_step_craft": async (ctx, arg) => ctx.run("multi_step_craft", arg),
  "place_block": async (ctx, arg) => ctx.run("place_block", arg),
  "break_block": async (ctx, arg) => ctx.run("break_block", arg),
  "open_chest": async (ctx, arg) => ctx.run("open_chest", arg),
  "open_barrel": async (ctx, arg) => ctx.run("open_barrel", arg),
  "open_door": async (ctx, arg) => ctx.run("open_door", arg),
  "close_door": async (ctx, arg) => ctx.run("close_door", arg),
  "use_button": async (ctx, arg) => ctx.run("use_button", arg),
  "use_lever": async (ctx, arg) => ctx.run("use_lever", arg),
  "use_block": async (ctx, arg) => ctx.run("use_block", arg),
  "use_item": async (ctx, arg) => ctx.run("use_item", arg),
  "sleep": async (ctx, arg) => ctx.run("sleep", arg),
  "find_player": async (ctx, arg) => ctx.run("find_player", arg),
  "find_entity": async (ctx, arg) => ctx.run("find_entity", arg),
  "find_item_world": async (ctx, arg) => ctx.run("find_item_world", arg),
  "check_nearby": async (ctx, arg) => ctx.run("check_nearby", arg),
  "check_environment": async (ctx, arg) => ctx.run("check_environment", arg),
  "detect_hostiles": async (ctx, arg) => ctx.run("detect_hostiles", arg),
  "check_health": async (ctx, arg) => ctx.run("check_health", arg),
  "check_food": async (ctx, arg) => ctx.run("check_food", arg),
  "check_equipment": async (ctx, arg) => ctx.run("check_equipment", arg),
  "ask_permission": async (ctx, arg) => ctx.run("ask_permission", arg),
  "whisper_player": async (ctx, arg) => ctx.run("whisper_player", arg),
  "remember_player": async (ctx, arg) => ctx.run("remember_player", arg),
  "report_result": async (ctx, arg) => ctx.run("report_result", arg),
  "ask_clarification": async (ctx, arg) => ctx.run("ask_clarification", arg),
  "retrieve_item": async (ctx, arg) => ctx.run("retrieve_item", arg),
  "deliver_item": async (ctx, arg) => ctx.run("deliver_item", arg),
  "escort_player": async (ctx, arg) => ctx.run("escort_player", arg),
  "protect_player": async (ctx, arg) => ctx.run("protect_player", arg),
  "guard_location": async (ctx, arg) => ctx.run("guard_location", arg),
  "build": async (ctx, arg) => ctx.run("build", arg),
  "search": async (ctx, arg) => ctx.run("search", arg),
  "watch": async (ctx, arg) => ctx.run("watch", arg),
  "coordinate_with_player": async (ctx, arg) => ctx.run("coordinate_with_player", arg),
  "op_command": async (ctx, arg) => ctx.run("op_command", arg),
};
assertCapabilityRegistry(HANDLERS);
export async function executeCapability(id,arg,ctx){
  const mode=CAPABILITY_MODES.find(item=>item.id===id);
  if(!mode)throw new Error("Unknown capability: "+id);
  const h=HANDLERS[id];
  if(!h)throw new Error("Capability has no handler: "+id);
  ctx.run=ctx.run||((modeId,value)=>lowLevel(ctx,modeId,value));
  return h(ctx,arg);
}
