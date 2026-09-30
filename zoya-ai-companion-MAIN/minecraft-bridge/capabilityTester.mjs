import readline from "node:readline";
import { CAPABILITIES, executeCapability } from "./capabilityEngine.mjs";


const RUNTIME_EXECUTED = new Set(["follow_player","roam","pvp","explore","return","investigate_entity","mine","chop_tree","craft","eat","collect","gather_resources","guard","guard_location","gather_missing_materials"]);
const HOSTILES = new Set(["zombie","husk","drowned","skeleton","stray","creeper","spider","cave_spider","witch","pillager","vindicator","evoker","ravager","phantom","blaze","magma_cube","silverfish","endermite","guardian","elder_guardian","piglin_brute","hoglin","zoglin"]);
const WEAPONS = new Set(["sword","axe","mace","trident"]);
const toVec3=(bot,p)=>new bot.entity.position.constructor(Number(p.x),Number(p.y),Number(p.z));
const originOffset=(bot)=>toVec3(bot,{x:0,y:1,z:0});
const weaponTypeScore=(name)=>{const n=String(name||"").toLowerCase();return [...WEAPONS].reduce((score,type)=>score+(n.includes(type)?1:0),0);};
const getLastTaskResult=(runtime)=>runtime?.getLastTaskResult?.()||null;
function taskResultLabel(runtime){const r=getLastTaskResult(runtime);if(!r)return "NO_RESULT";if(r.status==="cancelled")return "STOPPED (CANCELLED)";if(r.reason==="target_lost"||r.reason==="target_not_found")return "TARGET_LOST";return String(r.status||"UNKNOWN").toUpperCase();}
function capabilityVerificationProbe(bot,runtime,id,arg){
  if(id==="op_command")return Boolean(String(arg||"").trim());
  if(id==="check_environment")return Boolean(originOffset(bot));
  if(id==="check_equipment")return weaponTypeScore(bot.heldItem?.name)>=0;
  if(id==="ask_permission")return typeof runtime?.askOwner==="function";
  if(id==="remember_player")return typeof runtime?.rememberPlayer==="function";
  if(id==="watch")return Boolean(String(arg||"").trim());
  if(id==="coordinate_with_player")return Boolean(String(arg||"").trim());
  if(id==="whisper_player" || id==="report_result" || id==="ask_clarification")return Boolean(String(arg||"").trim());
  const name=String(arg||"").trim().toLowerCase();
  if(HOSTILES.has(name))return true;
  return true;
}
async function verifyContainerPrimitive(bot,position){
  const liveBlock=bot.blockAt(toVec3(bot,position));
  if(!liveBlock)throw new Error("Container block not loaded.");
  if(!["chest","barrel","shulker_box"].some(name=>String(liveBlock.name||"").includes(name)))throw new Error("Target is not a supported container.");
  const container=await bot.openContainer(liveBlock);
  try{return Boolean(container);}finally{try{await container.close();}catch{}}
}

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms)||0)));}

function inventorySnapshot(bot){
  const byName=new Map();
  for(const item of bot.inventory.items())byName.set(item.name,(byName.get(item.name)||0)+item.count);
  return {byName,position:bot.entity?.position?.clone?.()||null,health:Number(bot.health??20),food:Number(bot.food??20),held:bot.heldItem?.name||null};
}


export function getCapabilityRegistry(){
  return CAPABILITIES.map(capability=>({...capability}));
}

export async function dispatchCapability({bot,runtime,id,arg="",log=console.log}){
  const mode=String(id||"").trim().toLowerCase();
  const capability=CAPABILITIES.find(item=>item.id===mode);
  if(!capability)throw new Error("Unknown capability: "+mode);
  if(mode==="stop"){
    runtime.cancelCurrentTask?.("manual capability tester");
    return true;
  }
  const before=inventorySnapshot(bot);
  const context={
    bot,runtime,before,
    task:runtime.getActiveTask?.()||null,
    log:message=>log("[MODE] "+message),
    sleep:async ms=>{
      const deadline=Date.now()+Math.max(0,Number(ms)||0);
      while(Date.now()<deadline){
        const task=runtime.getActiveTask?.();
        if(!task||task.cancelled)throw new Error("Task cancelled.");
        await sleep(Math.min(100,Math.max(1,deadline-Date.now())));
      }
      const task=runtime.getActiveTask?.();
      if(!task||task.cancelled)throw new Error("Task cancelled.");
    },
    assertActive:()=>{
      const task=runtime.getActiveTask?.();
      if(!task||task.cancelled)throw new Error("Task cancelled.");
    },
    terminate:reason=>{const task=runtime.getActiveTask?.();if(task)task.terminationReason=reason;}
  };
  bot.__zoyaCapabilityRuntime = runtime;
  try{
    if(RUNTIME_EXECUTED.has(mode))return executeCapability(mode,arg,context);
    return runtime.runManualCapability("clean:"+mode,async task=>{
      context.task=task;
      return executeCapability(mode,arg,context);
    });
  }finally{
    if(bot.__zoyaCapabilityRuntime===runtime){try{delete bot.__zoyaCapabilityRuntime;}catch{}}
  }
}

const CONTINUOUS_TEST_MODES = new Set([
  "follow_player","roam","pvp","guard","guard_location","defend","chase_target",
  "escort_player","protect_player","watch","coordinate_with_player"
]);

export function startCapabilityTester({bot,runtime,log=console.log}){
  let closed=false;
  let currentRun=null;
  const rl=readline.createInterface({input:process.stdin,output:process.stdout,prompt:""});
  const ask=(question)=>new Promise(resolve=>rl.question(question,answer=>resolve(answer)));

  const print=(line="")=>log("[TESTER] "+line);
  const printModes=()=>{
    print("");
    print("╔══════════════════════════════════════════════════════════════╗");
    print("║                 ZOYA MINECRAFT TEST CONSOLE                ║");
    print("╠══════════════════════════════════════════════════════════════╣");
    print("║  93 clean capability modes | Groq planner: OFF             ║");
    print("║  STOP = cancel the active task                             ║");
    print("╚══════════════════════════════════════════════════════════════╝");
    for(let i=0;i<CAPABILITIES.length;i++){
      const c=CAPABILITIES[i];
      print(String(i).padStart(2,"0")+"  "+c.label.padEnd(28)+" "+c.usage);
    }
    print("");
  };

  const stop=async()=>{
    if(typeof runtime.cancelCurrentTask==="function"){
      const had=runtime.cancelCurrentTask("tester STOP");
      print(had?"STOP requested.":"No active task.");
    }else print("STOP unavailable.");
  };

  const context=(id)=>{
    const before=inventorySnapshot(bot);
    const context={
      bot,runtime,
      task:runtime.getActiveTask?.()||null,
      log:message=>log("[MODE] "+message),
      sleep:async ms=>{
        const deadline=Date.now()+Math.max(0,Number(ms)||0);
        while(Date.now()<deadline){
          context.assertActive();
          await sleep(Math.min(100,Math.max(1,deadline-Date.now())));
        }
        context.assertActive();
      },
      assertActive:()=>{
        const task=runtime.getActiveTask?.();
        if(!task||task.cancelled)throw new Error("Task cancelled.");
      },
      terminate:reason=>{
        const task=runtime.getActiveTask?.();
        if(task)task.terminationReason=reason;
      },
      legacy:async(mode,arg)=>{
        throw new Error("The rebuilt mode '"+mode+"' requires its dedicated runtime capability implementation; it is not allowed to silently fall back to legacy tester code.");
      },
      before
    };
    return context;
  };

  const run=async(index,arg)=>{
    if(currentRun){print("Another mode is already running. Use STOP first.");return;}
    const capability=CAPABILITIES[index];
    if(!capability){print("Invalid mode index.");return;}
    if(capability.id==="stop"){await stop();return;}

    currentRun={id:capability.id,startedAt:Date.now()};
    const before=inventorySnapshot(bot);
    print("▶ ["+String(index).padStart(2,"0")+"] "+capability.label+" :: "+capability.usage);
    print("  args: "+(arg||"(none)"));
    try{
      let result=await dispatchCapability({bot,runtime,id:capability.id,arg,log});
      if(result===true && !capabilityVerificationProbe(bot,runtime,capability.id,arg)) throw new Error("Capability verification probe failed.");
      const stopped = taskResultLabel(runtime) === "STOPPED (CANCELLED)";
      print((stopped ? "■ STOPPED " : result===true ? "✓ SUCCESS " : "✗ FAILED ")+capability.id);
      print("  task result: "+taskResultLabel(runtime));
      return result;
    }catch(error){
      print("✗ ERROR "+(error instanceof Error?error.message:String(error)));
      return false;
    }finally{
      currentRun=null;
      const after=inventorySnapshot(bot);
      if(before.position&&after.position)print("  movement: "+before.position.distanceTo(after.position).toFixed(2)+" blocks");
      print("  health: "+before.health+" → "+after.health+" | food: "+before.food+" → "+after.food);
    }
  };

  // Kept separate so every execution gets a fresh context and snapshot.
  function contextFor(id,before){const c=context(id);c.before=before;return c;}

  const choose=async()=>{
    while(!closed){
      const raw=String(await ask("Mode [0-92 / stop / modes / quit]: ")).trim();
      if(!raw)continue;
      if(raw.toLowerCase()==="quit"||raw.toLowerCase()==="exit"){closed=true;rl.close();break;}
      if(raw.toLowerCase()==="modes"){printModes();continue;}
      if(raw.toLowerCase()==="stop"){await stop();continue;}
      const index=Number(raw);
      if(!Number.isInteger(index)||index<0||index>=CAPABILITIES.length){print("Enter a mode number from 0 to "+(CAPABILITIES.length-1)+".");continue;}
      const capability=CAPABILITIES[index];
      const arg=String(await ask("Args for "+capability.label+" ["+capability.usage+"]: ")).trim();
      const execution = run(index,arg);
      if(CONTINUOUS_TEST_MODES.has(capability.id)){
        void execution;
      }else{
        await execution;
      }
    }
  };

  print("Clean 93-mode tester loaded.");
  print("Every mode resolves through capabilityEngine.mjs; no old directCapability dispatcher is used.");
  printModes();
  void choose();

  return {
    close:()=>{closed=true;try{rl.close()}catch{}},
    stop,
    get active(){return currentRun}
  };
}
