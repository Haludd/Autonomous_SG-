import {readFileSync} from 'node:fs';
import {createRecoveryScenario,buildRecoveryCandidates,validateRecovery,recoveryCost,flightIndex,hhmm} from './recovery.mjs';
import {triageTarget,prioritiseCollisions,dayMinute} from './triage.mjs';

const onwardIndex=JSON.parse(readFileSync(new URL('../data/onward-index.json',import.meta.url))).onward;

// Disclosed product choices. Cost is the recovery fallback cost plus knock-on minutes, so chains compete on the same scale.
export const chainPolicy={
  maxFlights:6,handoffCost:1000,
  rule:'Serve flights in every order that keeps safety tiers in sequence. Each flight takes its cheapest option that still fits what earlier flights already claimed. The order with the lowest total cost wins, and ties keep the urgency order.',
  cost:'Delay minutes + holding fuel ÷ 40 + 4 per gate change + 3 per resequenced departure + 2 per overtime minute, plus minutes a slipped slot or onward flight inherits.',
  claims:['Spare gates held from arrival to turnaround clear','One landing per minute on runway 4R','One departure per minute on runway 4L','Same-tail onward JFK departure that day (partial: the CSV lists delayed flights only)']
};

const free=(taken,minute)=>{while(taken.has(minute))minute++;return minute;};
const clock=m=>`${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(Math.floor(m%60)).padStart(2,'0')}`;

export function chainEntry(target,facts={}){
  const s=createRecoveryScenario(target.index,facts),rec=flightIndex.records[target.index].record,at=m=>target.eta+m-s.baselineETA,next=onwardIndex[String(target.sourceRow)];
  const options=buildRecoveryCandidates(s).map(c=>{const a=c.plan.arrivals[0],m=c.metrics;return {id:c.id,title:c.title,valid:validateRecovery(s,c).valid,standId:a.standId,spare:/^G[789]$/.test(a.standId),gateIn:at(a.gateIn),landing:at(a.landing),clear:at(a.clearAt),onward:at(c.plan.nextDeparture),cost:recoveryCost(c),fuelMargin:m.fuelMargin,crewMargin:m.crewMargin};});
  return {...target,holdingRate:s.target.holdingRate,options,onward:next?{id:`${next.AIRLINE} ${next.FLIGHT_NUMBER}`,to:next.DESTINATION_AIRPORT,sched:dayMinute(rec)+hhmm(next.SCHEDULED_DEPARTURE)}:null};
}

export function simulate(order,{spareGates=3}={}){
  const spare=[],landings=new Set(),departures=new Set(),plans=[];
  for(const e of order){
    let best=null;const blocked=[];
    for(const o of e.options){
      if(!o.valid)continue;
      const land=free(landings,o.landing),slip=land-o.landing,gateIn=o.gateIn+slip,clear=o.clear+slip;
      if(o.spare&&spare.filter(iv=>iv.start<clear&&gateIn<iv.end).length>=spareGates){blocked.push(o.id);continue;}
      const ready=o.onward+slip,want=e.onward?Math.max(ready,e.onward.sched):ready,dep=free(departures,want),depSlip=dep-want;
      if(o.fuelMargin-slip*e.holdingRate<0||o.crewMargin-slip-(want===ready?depSlip:0)<0)continue;
      const onwardDelay=e.onward?Math.max(0,dep-e.onward.sched):0,cost=o.cost+slip*(1+e.holdingRate/40)+onwardDelay;
      if(!best||cost<best.cost)best={flight:e.id,index:e.index,tier:e.tier,option:o.id,title:o.title,standId:o.standId,spare:o.spare,landing:land,gateIn,clear,departure:dep,slip,depSlip,onwardFlight:e.onward?.id??null,onwardTo:e.onward?.to??null,onwardDelay,cost};
    }
    if(!best){plans.push({flight:e.id,index:e.index,tier:e.tier,option:null,blocked,cost:chainPolicy.handoffCost});continue;}
    landings.add(best.landing);departures.add(best.departure);if(best.spare)spare.push({start:best.gateIn,end:best.clear});
    plans.push({...best,blocked});
  }
  return {plans,total:plans.reduce((n,p)=>n+p.cost,0)};
}

function* permutations(n,prefix=[]){
  if(prefix.length===n){yield prefix;return;}
  for(let i=0;i<n;i++)if(!prefix.includes(i))yield* permutations(n,[...prefix,i]);
}

const effects=plans=>plans.flatMap(p=>p.option===null?[`${p.flight}: no option fits what earlier flights claimed. Human review.`]:[
  ...p.blocked.includes('gate')?[`${p.flight}: spare gates were already taken, so it uses “${p.title}”.`]:[],
  ...p.slip?[`${p.flight}: landing slot was taken, so it lands ${p.slip} min later (${clock(p.landing)}).`]:[],
  ...p.depSlip?[`${p.flight}: onward departure slot was taken, so it leaves ${p.depSlip} min later (${clock(p.departure)}).`]:[],
  ...p.onwardDelay?[`${p.flight}: passes ${p.onwardDelay} min to ${p.onwardFlight} to ${p.onwardTo}.`]:[]
]);

export function searchChains(entries,{spareGates=3}={}){
  const list=[...entries].sort((a,b)=>a.priority-b.priority),urgency=simulate(list,{spareGates});
  let best={...urgency,order:list};
  if(list.length>=2&&list.length<=chainPolicy.maxFlights)for(const p of permutations(list.length)){
    const order=p.map(i=>list[i]);if(order.some((e,i)=>i&&order[i-1].tier>e.tier))continue;
    const r=simulate(order,{spareGates});if(r.total<best.total-1e-9)best={...r,order};
  }
  const order=best.order.map(e=>e.id);
  return {spareGates,searched:list.length>=2&&list.length<=chainPolicy.maxFlights,order,urgencyOrder:list.map(e=>e.id),reordered:order.some((id,i)=>id!==list[i].id),plans:best.plans,total:best.total,urgencyTotal:urgency.total,saved:urgency.total-best.total,effects:effects(best.plans),policy:chainPolicy};
}

// Shifts a flight's whole timeline (and its onward flight) to a new baseline ETA. Used only by the stress test, never presented as history.
export function retime(entry,eta){
  const dt=eta-entry.eta,shift=o=>({...o,gateIn:o.gateIn+dt,landing:o.landing+dt,clear:o.clear+dt,onward:o.onward+dt});
  return {...entry,eta,retimed:(entry.retimed||0)+dt,options:entry.options.map(shift),onward:entry.onward&&{...entry.onward,sched:entry.onward.sched+dt}};
}

export const stressPool=[46,64,68,84];
export const stressNote='Stress test: three real arrivals re-timed to land 1–3 minutes after this flight. Their fuel, crew and onward-flight facts are real; the collision is not a historical event.';

const baseEntries=new Map();
const baseEntry=index=>{if(!baseEntries.has(index))baseEntries.set(index,chainEntry(triageTarget(index)));return baseEntries.get(index);};
// The span of time over which a flight could claim a landing slot, a spare gate or an onward departure.
const claimWindow=e=>{const o=e.options.some(o=>o.valid)?e.options.filter(o=>o.valid):e.options;return [Math.min(...o.map(x=>x.landing)),Math.max(...o.map(x=>Math.max(x.clear,x.onward)))];};
const overlaps=(a,b)=>a[0]<b[1]&&b[0]<a[1];

// A chain is every arrival reachable from this flight through overlapping claims, not an hour bucket: A clashes with B, B with C.
export function chainContext(index,scenario,{stress=false}={}){
  const facts={arrivalFuel:scenario.target.arrivalFuel,closedStands:scenario.closedStands};
  const spareGates=Math.max(0,scenario.capacity.spare_gates_at_any_time-scenario.closedStands.filter(id=>/^G[789]$/.test(id)).length);
  const self=chainEntry(triageTarget(index,facts),facts);
  const stressed=stress?stressPool.filter(i=>i!==index).slice(0,3).map((i,k)=>retime(baseEntry(i),self.eta+k+1)):[];
  const taken=new Set([index,...stressed.map(e=>e.index)]);
  const pool=[...stressed,...flightIndex.records.map((_,i)=>i).filter(i=>!taken.has(i)).map(baseEntry)];
  let group=[self],grew=true;
  while(grew){grew=false;for(const e of pool)if(!group.includes(e)&&group.some(g=>overlaps(claimWindow(g),claimWindow(e)))){group.push(e);grew=true;}}
  if(group.length<2)return null;
  if(group.length>chainPolicy.maxFlights)group=[self,...group.filter(e=>e!==self).sort((a,b)=>Math.abs(a.eta-self.eta)-Math.abs(b.eta-self.eta)).slice(0,chainPolicy.maxFlights-1)];
  const entries=prioritiseCollisions(group,{spareGates});
  return {index,spareGates,stress,entries,summary:{index,spareGates,stress,note:stress?stressNote:null,policy:chainPolicy,group:entries.map(e=>({index:e.index,id:e.id,sourceRow:e.sourceRow,eta:e.eta,priority:e.priority,tierName:e.tierName,fuelSlack:e.fuelSlack,crewSlack:e.crewSlack,spareGate:e.spareGate,retimed:Boolean(e.retimed),onwardFlight:e.onward?.id??null,self:e.index===index}))}};
}

// For each option this flight could take, serve the whole chain in the cheapest order that keeps safety tiers in sequence.
export function chainImpact(ctx){
  const self=ctx.entries.find(e=>e.index===ctx.index);
  return Object.fromEntries(self.options.filter(o=>o.valid).map(o=>{
    const r=searchChains(ctx.entries.map(e=>e===self?{...e,options:[o]}:e),{spareGates:ctx.spareGates}),mine=r.plans.find(p=>p.index===ctx.index);
    return [o.id,{groupSize:r.order.length,order:r.order,urgencyOrder:r.urgencyOrder,reordered:r.reordered,saved:r.saved,servePosition:r.order.indexOf(self.id)+1,total:r.total,othersCost:r.total-mine.cost,blocked:r.plans.filter(p=>p.option===null&&p.index!==ctx.index).length,selfBlocked:mine.option===null,effects:r.effects}];
  }));
}
