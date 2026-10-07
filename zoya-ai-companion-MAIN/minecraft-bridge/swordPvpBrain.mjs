/**
 * ZOYA Sword PvP Brain
 * Pure decision layer. It never calls Mineflayer directly.
 *
 * This is a bounded, state-driven Sword policy. It uses fixed expert-derived
 * priorities and never bypasses the physical Sword reach cap.
 */
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
export const SWORD_BRAIN_VERSION="sword-brain-v3";

export function createSwordPvpBrain(model={}){
  let currentModel=model||{};

  function policy(){
    const p=currentModel.policy||{},s=p.spacing||{},c=p.combat||{},r=p.sprintReset||{},h=p.healing||{},w=currentModel.skillWeights||{};
    const weight=(name,fallback=1)=>clamp(num(w[name],fallback),0.5,1.5);
    return {p,s,c,r,h,weight};
  }

  function decide(state={}){
    const {s,c,r,h,weight}=policy();
    const d=num(state.distance,Infinity);
    const hp=num(state.health,20);
    const cd=clamp(num(state.attackCooldown,1),0,1);
    const targetHealth=num(state.targetHealth,20);
    const targetValid=state.targetValid!==false;
    const ground=state.onGround!==false;
    const falling=state.falling===true;
    const airborne=state.targetAirborne===true;
    const recentHit=state.recentHit===true;
    const damaged=state.recentlyDamaged===true;
    const gapple=state.hasGapple===true;
    const lineOfSight=state.lineOfSight!==false;
    const fallDistance=num(state.fallDistance,0);

    if(!targetValid)return{action:"idle",reason:"no_valid_target"};

    // The controller performs lookAt before every movement/attack action.
    // Keep the decision layer conservative if the target is not visible.
    if(!lineOfSight)return{action:"strafe",direction:state.strafeDirection||"left",durationMs:110,sprint:true,reason:"restore_target_tracking"};

    const hardReach=clamp(num(s.attackMax,3.05),2.70,3.05);
    const pressureMax=clamp(num(s.pressureMax,3.0),2.60,hardReach);
    const neutralMax=clamp(num(s.neutralMax,3.35),2.90,4.20);
    const critMax=clamp(num(c.critMaxDistance,2.8),2.30,hardReach);
    const attackReady=cd>=num(c.attackCooldown,0.95);

    // Survival always outranks pressure. Healing is only allowed after
    // creating a real gap so ZOYA does not eat while standing in melee range.
    if((state.emergency===true||hp<=num(h.emergencyHealth,5))&&gapple&&d>=num(h.minimumDistance,4.2))
      return{action:"heal",item:"golden_apple",reason:"emergency_heal_window"};
    if(hp<=num(h.lowHealth,8)&&gapple&&d>=num(h.minimumDistance,4))
      return{action:"heal",item:"golden_apple",reason:"low_health_disengagement"};

    // A fresh hit is a combo-control event: briefly reset sprint, then
    // re-enter while the opponent is still in the tracked engagement.
    if(recentHit&&d<=pressureMax*weight("sprint_reset")&&cd<0.82)
      return{action:"sprint_reset",durationMs:clamp(num(r.durationMs,100),num(r.minMs,60),num(r.maxMs,140)),resumeSprint:true,reason:"post_hit_reset"};

    // Damage received triggers defensive lateral pressure before another
    // blind swing. This is the recovery behavior seen in the demonstrations.
    if(damaged&&d<=neutralMax*weight("defense"))
      return{action:"defensive_strafe",direction:state.strafeDirection==="left"?"right":"left",durationMs:clamp(num(c.defensiveStrafeMs,150),100,240),sprint:true,reason:"damage_recovery"};

    // Falling crits are only attempted when the actual player is descending
    // and the attack is sufficiently charged. Java crits require falling and
    // a charged attack; the controller performs the final re-check immediately
    // before swinging.
    if(falling&&!ground&&fallDistance>=0.45&&attackReady&&d<=critMax*weight("crit_timing")&&(airborne||state.targetConstrained===true))
      return{action:"falling_crit",reason:"gated_falling_crit"};

    // Start a jump-crit only when there is a genuine close-range opportunity.
    // Do not jump merely because the cooldown is ready.
    if(!falling&&ground&&!airborne&&attackReady&&d<=critMax*weight("crit_timing")&&state.targetVerticalDelta===undefined)
      return{action:"jump_crit",reason:"prepare_falling_crit"};

    // If the target is airborne, lateral pressure is preferable to charging
    // directly through it.
    if(airborne&&d<=pressureMax*weight("combo_control"))
      return{action:"strafe_pressure",direction:state.strafeDirection==="left"?"right":"left",durationMs:clamp(num(c.strafeDurationMs,150),90,260),sprint:true,reason:"airborne_combo_pressure"};

    // Reach/spacing is a hard constraint. Never authorize a swing beyond
    // legitimate Sword reach, regardless of policy weights.
    if(d>hardReach)
      return{action:"approach",direction:state.strafeDirection||"left",sprint:true,reason:"outside_sword_reach"};

    // At valid range, fully charged attacks take priority. This is the core
    // damage loop; aim is handled by the controller immediately before attack.
    if(attackReady&&d<=hardReach)
      return{action:"attack",reason:"full_charge_attack_window"};

    // When waiting for cooldown, keep the opponent centered and continuously
    // vary lateral pressure rather than standing still.
    const duration=clamp(num(c.strafeDurationMs,140)/weight("movement"),80,260);
    return{action:"strafe",direction:state.strafeDirection||"left",durationMs:duration,sprint:true,reason:"maintain_spacing_and_tracking"};
  }

  return{
    version:SWORD_BRAIN_VERSION,
    decide,
    setModel:modelNext=>{if(modelNext&&typeof modelNext==="object")currentModel=modelNext;}
  };
}
export default createSwordPvpBrain;
