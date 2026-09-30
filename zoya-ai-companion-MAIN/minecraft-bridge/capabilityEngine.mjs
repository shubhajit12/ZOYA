import pathfinderPackage from "mineflayer-pathfinder";
const { goals } = pathfinderPackage;

export const CAPABILITIES = [
  {
    "id": "follow_player",
    "label": "Follow Player",
    "usage": "follow_player {username}"
  },
  {
    "id": "roam",
    "label": "Roam",
    "usage": "roam"
  },
  {
    "id": "pvp",
    "label": "PvP",
    "usage": "pvp {username}"
  },
  {
    "id": "hit",
    "label": "Hit",
    "usage": "hit {username}"
  },
  {
    "id": "gather_resources",
    "label": "Gather Resources",
    "usage": "gather_resources {item} {amount}"
  },
  {
    "id": "do_task",
    "label": "Do Task",
    "usage": "do_task {task}"
  },
  {
    "id": "coordinate",
    "label": "Coordinate",
    "usage": "coordinate {username}"
  },
  {
    "id": "explore",
    "label": "Explore",
    "usage": "explore"
  },
  {
    "id": "observe",
    "label": "Observe",
    "usage": "observe"
  },
  {
    "id": "return",
    "label": "Return",
    "usage": "return"
  },
  {
    "id": "investigate_entity",
    "label": "Investigate Entity",
    "usage": "investigate_entity {name}"
  },
  {
    "id": "mine",
    "label": "Mine",
    "usage": "mine {block}"
  },
  {
    "id": "chop_tree",
    "label": "Chop Tree",
    "usage": "chop_tree"
  },
  {
    "id": "craft",
    "label": "Craft",
    "usage": "craft {item} {amount}"
  },
  {
    "id": "eat",
    "label": "Eat",
    "usage": "eat {item}"
  },
  {
    "id": "collect",
    "label": "Collect",
    "usage": "collect {item} {amount}"
  },
  {
    "id": "look_at_player",
    "label": "Look At Player",
    "usage": "look_at_player {username}"
  },
  {
    "id": "chat",
    "label": "Public Chat",
    "usage": "chat {message}"
  },
  {
    "id": "private_chat",
    "label": "Private Chat",
    "usage": "private_chat {username} {message}"
  },
  {
    "id": "go_to",
    "label": "Go To",
    "usage": "go_to {x} {y} {z}"
  },
  {
    "id": "look_at_coordinates",
    "label": "Look At Coordinates",
    "usage": "look_at_coordinates {x} {y} {z}"
  },
  {
    "id": "stop",
    "label": "Stop / Cancel",
    "usage": "stop"
  },
  {
    "id": "wait",
    "label": "Wait",
    "usage": "wait {seconds}"
  },
  {
    "id": "return_to_coordinates",
    "label": "Return To Coordinates",
    "usage": "return_to_coordinates {x} {y} {z}"
  },
  {
    "id": "sprint",
    "label": "Sprint",
    "usage": "sprint {seconds}"
  },
  {
    "id": "sneak",
    "label": "Sneak",
    "usage": "sneak {seconds}"
  },
  {
    "id": "jump",
    "label": "Jump",
    "usage": "jump"
  },
  {
    "id": "enter_exit_vehicle",
    "label": "Enter / Exit Vehicle",
    "usage": "enter_exit_vehicle"
  },
  {
    "id": "attack_mob",
    "label": "Attack Mob",
    "usage": "attack_mob {mob}"
  },
  {
    "id": "defend",
    "label": "Defend",
    "usage": "defend"
  },
  {
    "id": "guard",
    "label": "Guard",
    "usage": "guard {x} {y} {z}"
  },
  {
    "id": "escape",
    "label": "Escape",
    "usage": "escape"
  },
  {
    "id": "chase_target",
    "label": "Chase Target",
    "usage": "chase_target {target}"
  },
  {
    "id": "equip_best_weapon",
    "label": "Equip Best Weapon",
    "usage": "equip_best_weapon"
  },
  {
    "id": "use_shield",
    "label": "Use Shield",
    "usage": "use_shield"
  },
  {
    "id": "use_ranged_weapon",
    "label": "Use Ranged Weapon",
    "usage": "use_ranged_weapon {target}"
  },
  {
    "id": "dig",
    "label": "Dig",
    "usage": "dig {x} {y} {z}"
  },
  {
    "id": "harvest_crops",
    "label": "Harvest Crops",
    "usage": "harvest_crops"
  },
  {
    "id": "fish",
    "label": "Fish",
    "usage": "fish"
  },
  {
    "id": "hunt",
    "label": "Hunt Animals",
    "usage": "hunt"
  },
  {
    "id": "find_shelter",
    "label": "Find Shelter",
    "usage": "find_shelter"
  },
  {
    "id": "recover_after_death",
    "label": "Recover After Death",
    "usage": "recover_after_death"
  },
  {
    "id": "find_safe_location",
    "label": "Find Safe Location",
    "usage": "find_safe_location"
  },
  {
    "id": "check_inventory",
    "label": "Check Inventory",
    "usage": "check_inventory"
  },
  {
    "id": "find_item",
    "label": "Find Item",
    "usage": "find_item {item}"
  },
  {
    "id": "count_item",
    "label": "Count Item",
    "usage": "count_item {item}"
  },
  {
    "id": "equip_item",
    "label": "Equip Item",
    "usage": "equip_item {item}"
  },
  {
    "id": "drop_item",
    "label": "Drop Item",
    "usage": "drop_item {item}"
  },
  {
    "id": "give_item",
    "label": "Give Item",
    "usage": "give_item {item} {username}"
  },
  {
    "id": "take_item",
    "label": "Take Item",
    "usage": "take_item {item}"
  },
  {
    "id": "deposit",
    "label": "Deposit",
    "usage": "deposit {item} {x} {y} {z}"
  },
  {
    "id": "retrieve",
    "label": "Retrieve",
    "usage": "retrieve {item} {x} {y} {z}"
  },
  {
    "id": "sort_inventory",
    "label": "Sort Inventory",
    "usage": "sort_inventory"
  },
  {
    "id": "smelt",
    "label": "Smelt",
    "usage": "smelt {item}"
  },
  {
    "id": "craft_workbench",
    "label": "Craft With Workbench",
    "usage": "craft_workbench {item}"
  },
  {
    "id": "craft_furnace",
    "label": "Craft With Furnace",
    "usage": "craft_furnace {item}"
  },
  {
    "id": "gather_missing_materials",
    "label": "Gather Missing Materials",
    "usage": "gather_missing_materials {item}"
  },
  {
    "id": "multi_step_craft",
    "label": "Multi-Step Craft",
    "usage": "multi_step_craft {item}"
  },
  {
    "id": "place_block",
    "label": "Place Block",
    "usage": "place_block {block} {x} {y} {z}"
  },
  {
    "id": "break_block",
    "label": "Break Block",
    "usage": "break_block {x} {y} {z}"
  },
  {
    "id": "open_chest",
    "label": "Open Chest",
    "usage": "open_chest {x} {y} {z}"
  },
  {
    "id": "open_barrel",
    "label": "Open Barrel",
    "usage": "open_barrel {x} {y} {z}"
  },
  {
    "id": "open_door",
    "label": "Open Door",
    "usage": "open_door {x} {y} {z}"
  },
  {
    "id": "close_door",
    "label": "Close Door",
    "usage": "close_door {x} {y} {z}"
  },
  {
    "id": "use_button",
    "label": "Use Button",
    "usage": "use_button {x} {y} {z}"
  },
  {
    "id": "use_lever",
    "label": "Use Lever",
    "usage": "use_lever {x} {y} {z}"
  },
  {
    "id": "use_block",
    "label": "Use Block",
    "usage": "use_block {x} {y} {z}"
  },
  {
    "id": "use_item",
    "label": "Use Item",
    "usage": "use_item {item}"
  },
  {
    "id": "sleep",
    "label": "Sleep",
    "usage": "sleep"
  },
  {
    "id": "find_player",
    "label": "Find Player",
    "usage": "find_player {username}"
  },
  {
    "id": "find_entity",
    "label": "Find Entity",
    "usage": "find_entity {name}"
  },
  {
    "id": "find_item_world",
    "label": "Find Item In World",
    "usage": "find_item_world {item}"
  },
  {
    "id": "check_nearby",
    "label": "Check Nearby Area",
    "usage": "check_nearby"
  },
  {
    "id": "check_environment",
    "label": "Check Environment",
    "usage": "check_environment"
  },
  {
    "id": "detect_hostiles",
    "label": "Detect Hostiles",
    "usage": "detect_hostiles"
  },
  {
    "id": "check_health",
    "label": "Check Health",
    "usage": "check_health"
  },
  {
    "id": "check_food",
    "label": "Check Food",
    "usage": "check_food"
  },
  {
    "id": "check_equipment",
    "label": "Check Equipment",
    "usage": "check_equipment"
  },
  {
    "id": "ask_permission",
    "label": "Ask Permission",
    "usage": "ask_permission {username} {action}"
  },
  {
    "id": "whisper_player",
    "label": "Whisper Player",
    "usage": "whisper_player {username} {message}"
  },
  {
    "id": "remember_player",
    "label": "Remember Player",
    "usage": "remember_player {username} {fact}"
  },
  {
    "id": "report_result",
    "label": "Report Result",
    "usage": "report_result {message}"
  },
  {
    "id": "ask_clarification",
    "label": "Ask Clarification",
    "usage": "ask_clarification {username} {question}"
  },
  {
    "id": "retrieve_item",
    "label": "Retrieve Item",
    "usage": "retrieve_item {item}"
  },
  {
    "id": "deliver_item",
    "label": "Deliver Item",
    "usage": "deliver_item {item} {username}"
  },
  {
    "id": "escort_player",
    "label": "Escort Player",
    "usage": "escort_player {username}"
  },
  {
    "id": "protect_player",
    "label": "Protect Player",
    "usage": "protect_player {username}"
  },
  {
    "id": "guard_location",
    "label": "Guard Location",
    "usage": "guard_location {x} {y} {z}"
  },
  {
    "id": "build",
    "label": "Build",
    "usage": "build {plan}"
  },
  {
    "id": "search",
    "label": "Search For Something",
    "usage": "search {target}"
  },
  {
    "id": "watch",
    "label": "Watch",
    "usage": "watch {target}"
  },
  {
    "id": "coordinate_with_player",
    "label": "Coordinate With Player",
    "usage": "coordinate_with_player {username} {task}"
  },
  {
    "id": "op_command",
    "label": "Use OP Command",
    "usage": "op_command {command}"
  }
];
const HOSTILES = new Set(["zombie","husk","drowned","skeleton","stray","creeper","spider","cave_spider","witch","pillager","vindicator","evoker","ravager","phantom","blaze","magma_cube","silverfish","endermite","guardian","elder_guardian","piglin_brute","hoglin","zoglin"]);
const RUNTIME_ACTIONS = new Set(["follow_player","roam","pvp","explore","return","investigate_entity","mine","chop_tree","craft","eat","collect","gather_resources","guard","guard_location","gather_missing_materials"]);

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
async function combatHit(ctx,target){
  if(target.position.distanceTo(ctx.bot.entity.position)>3.1)await navigate(ctx,target.position,2.6,"combat navigation");
  ctx.assertActive();await ctx.bot.lookAt(target.position.offset(0,target.height||1.4,0),true);ctx.bot.attack(target);return true;
}
async function runtimeAction(ctx,id,arg){
  const options={permissionGranted:true};const p=split(arg);
  if(id==="follow_player"||id==="pvp"||id==="look_at_player")options.targetUsername=required(arg,"Username is required.");
  if(id==="mine")options.blockName=required(arg,"Block is required.");
  if(id==="eat")options.itemName=String(arg||"").trim();
  if(id==="collect"||id==="gather_resources"){options.itemName=p[0]||"";options.amount=Math.max(1,Number(p[1])||1);}
  if(id==="craft"){options.itemName=p.slice(0,-1).join("_")||p[0]||"";options.amount=Math.max(1,Number(p.at(-1))||1);}
  if(id==="investigate_entity")options.entityName=required(arg,"Entity name is required.");
  if(id==="guard"||id==="guard_location")options.position=coords(arg);
  const mapped=id==="roam"?"safe_roam":id==="return"?"return_to_owner":id;
  return ctx.runtime.execute(mapped,options);
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
    case "open_chest":case "open_barrel":{const p=coords(arg),b=bot.blockAt(vec(bot,p)),name=id==="open_chest"?"chest":"barrel";if(!b||!b.name.includes(name))throw new Error("Expected "+name+".");await navigate(ctx,p,3.5,id);await bot.openContainer(b);return true;}
    case "open_door":case "close_door":case "use_button":case "use_lever":case "use_block":{const p=coords(arg),b=bot.blockAt(vec(bot,p));if(!b)throw new Error("Block not found.");await navigate(ctx,p,3.5,id);await bot.activateBlock(b);return true;}
    case "place_block":{const a=split(arg),name=required(a.shift(),"Block is required."),p=coords(a.join(" ")),i=item(bot,name),target=bot.blockAt(vec(bot,p)),ref=bot.blockAt(vec(bot,{x:p.x,y:p.y-1,z:p.z}));if(!i)throw new Error("Placement item not found.");if(!target||target.name!=="air"||!ref)throw new Error("Placement target is not empty/valid.");await navigate(ctx,p,3.5,"place_block");await bot.equip(i,"hand");await bot.placeBlock(ref,new (bot.entity.position.constructor)(0,1,0));return true;}
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
export async function executeCapability(id,arg,ctx){\n  const h=HANDLERS[id];\n  if(!h)throw new Error("Capability has no handler: "+id);\n  ctx.run=ctx.run||((mode,value)=>lowLevel(ctx,mode,value));\n  return h(ctx,arg);\n}
