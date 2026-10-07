/**
 * ZOYA Sword PvP Brain
 * Pure decision layer. It never calls Mineflayer directly.
 */
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
export const SWORD_BRAIN_VERSION="sword-brain-v2";
export function createSwordPvpBrain(model={}){
  let currentModel=model||{};
  function policy(){
    const p=currentModel.policy||{},s=p.spacing||{},c=p.combat||{},r=p.sprintReset||{},h=p.healing||{},w=currentModel.skillWeights||{};
    const weight=(name,fallback=1)=>clamp(num(w[name],fallback),0.5,1.5);
    return {p,s,c,r,h,weight};
  }
  function decide(state={}){
    const {s,c,r,h,weight}=policy();
    const d=num(state.distance,Infinity), hp=num(state.health,20), cd=clamp(num(state.attackCooldown,1),0,1);
    const valid=state.targetValid!==false, ground=state.onGround!==false, falling=state.falling===true;
    const recentHit=state.recentHit===true, damaged=state.recentlyDamaged===true;
    const airborne=state.targetAirborne===true, constrained=state.targetConstrained===true;
    const gapple=state.hasGapple===true;
    if(!valid)return{action:"idle",reason:"no_valid_target"};
    if((state.emergency===true||hp<=num(h.emergencyHealth,5))&&gapple&&d>=num(h.minimumDistance,4.2))return{action:"heal",item:"golden_apple",reason:"emergency_heal_window"};
    if(hp<=num(h.lowHealth,8)&&gapple&&d>=num(h.minimumDistance,4))return{action:"heal",item:"golden_apple",reason:"low_health_disengagement"};
    if(recentHit&&cd<0.8&&d<=num(s.pressureMax,3.2)*weight("sprint_reset"))return{action:"sprint_reset",durationMs:clamp(num(r.durationMs,100),num(r.minMs,60),num(r.maxMs,140)),resumeSprint:true,reason:"post_hit_reset"};
    if(airborne&&d<=num(c.comboMaxDistance,2.9)*weight("combo_control"))return{action:"strafe_pressure",direction:state.strafeDirection==="left"?"right":"left",durationMs:num(c.strafeDurationMs,180),sprint:true,reason:"combo_pressure"};
    if(falling&&!ground&&d<=num(c.critMaxDistance,2.8)*weight("crit_timing")&&cd>=num(c.critCooldown,0.95)&&(airborne||constrained))return{action:"falling_crit",reason:"gated_crit_window"};
    if(damaged&&d<=num(s.neutralMax,3.8)*weight("defense"))return{action:"defensive_strafe",direction:state.strafeDirection==="left"?"right":"left",durationMs:160,sprint:true,reason:"damage_recovery"};
    if(d>num(s.attackMax,3.2)*weight("spacing"))return{action:"approach",direction:state.strafeDirection||"left",sprint:true,reason:"outside_attack_window"};
    if(cd>=num(c.attackCooldown,0.95)&&d<=num(s.attackMax,3.2)*weight("attack_timing"))return{action:"attack",reason:"valid_attack_window"};
    return{action:"strafe",direction:state.strafeDirection||"left",durationMs:clamp(num(c.strafeDurationMs,120)/weight("movement"),80,260),sprint:true,reason:"maintain_spacing"};
  }
  return{version:SWORD_BRAIN_VERSION,decide,setModel:modelNext=>{if(modelNext&&typeof modelNext==="object")currentModel=modelNext;}};
}
export default createSwordPvpBrain;

// Training gate workflow: offline policy validation runs automatically on minecraft branch.
