import { createHash } from 'node:crypto';

export const ROLES = ['ATC', 'PILOT', 'GROUND'];
export const SCENARIOS = [
  { id: 'weather', name: 'Weather bottleneck', description: 'Reduced departure capacity. An inbound needs an occupied gate.', tag: 'Start here' },
  { id: 'tug', name: 'Tug unavailable', description: 'Tug 2 is offline. Ground must find another way to accommodate the inbound.', tag: 'Resource failure' },
  { id: 'fuel', name: 'Fuel margin', description: 'A tighter taxi-fuel allowance changes the acceptable departure plan.', tag: 'Pilot constraint' },
  { id: 'infeasible', name: 'No feasible plan', description: 'An inbound arrives before its gate can clear, with no compatible remote stand.', tag: 'Human handoff' },
];
export const clone = value => structuredClone(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const integer = value => Number.isInteger(value);
export const overlaps = (a, b) => a.start < b.end && b.start < a.end;
export const hashPlan = plan => createHash('sha256').update(JSON.stringify({ stateVersion: plan.stateVersion, version: plan.version, departures: [...plan.departures].sort((a,b)=>a.flightId.localeCompare(b.flightId)), arrivals: [...plan.arrivals].sort((a,b)=>a.flightId.localeCompare(b.flightId)) })).digest('hex').slice(0, 16);

function rng(seed) {
  let x = Number(seed) >>> 0;
  return () => { x += 0x6D2B79F5; let t=x; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; };
}

export function createScenario(id='weather', seed=42) {
  if (!SCENARIOS.some(s=>s.id===id)) throw new Error('Unknown scenario.');
  if (!integer(Number(seed)) || Number(seed)<0 || Number(seed)>999999) throw new Error('Seed must be an integer between 0 and 999999.');
  const random=rng(seed);
  const names = ['UA 218','AA 742','DL 386','WN 126','B6 239','AS 614'];
  const flights=names.map((name,i)=>{
    const maxEngineOn = [8,10,9,11,10,12][i];
    return { id: `F${i+1}`, callsign:name, airline:name.split(' ')[0], gate:`G${i+1}`, wake:i===2?'H':'M', ready:i*2, scheduled:10+i*3, latest:48+i*2, taxiMinutes:4, pushMinutes:2, fuelRate:60, requiredDepartureFuel:3200+i*180, fuel:3200+i*180+60*maxEngineOn, preferenceWeight:1+Math.floor(random()*3), provenance:'simulated' };
  });
  const scenario = {
    id, seed:Number(seed), stateVersion:1, name:SCENARIOS.find(s=>s.id===id).name,
    airport:{ code:'JFK', name:'John F. Kennedy', timezone:'America/New_York' },
    clock:{ hour:14, minute:0, label:'Airport local time' }, now:0, horizon:60,
    flights, arrivals:[
      {id:'IN1', callsign:'UA 905', gate:'G1', gateIn:10, clearAt:60, wake:'M', provenance:'simulated'},
      {id:'IN2', callsign:'AA 319', gate:'G2', gateIn:20, clearAt:60, wake:'M', provenance:'simulated'},
    ],
    slots:[18,22,26,30,33,36,39,42,45,48,51,54,57,60],
    separation:{ M:3, H:4 }, taxiCapacity:3,
    stands:[...Array.from({length:6},(_,i)=>({id:`G${i+1}`, type:'gate', compatible:['M','H']})),{id:'R1',type:'remote',compatible:['M']}],
    resources:[{id:'TUG1',name:'Pushback tug',outages:[]},{id:'TUG2',name:'Tow tug',outages:[]}],
    towMinutes:4, groundShiftEnd:24,
    weights:{ delay:1, engineOn:0.5, tow:2, remoteArrival:12, overtime:0.2, worstDelay:0.5 },
    provenance:{ type:'synthetic', label:'Synthetic scenario · historical flight data not loaded', source:null },
    assumptions:[
      'All flights, schedules, gate assignments, fuel quantities and operational limits are simulated.',
      'Slots, wake-spacing intervals and fuel burn are simplified model inputs, not operational minima.',
      'Inbound gate demand is fixed; this model does not issue landing, diversion or aircraft-control instructions.',
      'Tow movements use Tug 2 with engines off. Pushbacks use Tug 1; engine-on time includes pushback and taxi.',
      'The simulation has not advanced: replanning changes future actions only.',
      'The JFK map replays plan timings on the user-supplied schematic. Gate aliases, taxi paths and runway depiction are illustrative and are not part of the scheduling validator.',
    ], updates:[],
  };
  if(Number(seed)!==42){
    for(const f of scenario.flights){
      f.ready=Math.max(0,f.ready+Math.floor(random()*3)-1);
      const allowance=Math.max(6,(f.fuel-f.requiredDepartureFuel)/f.fuelRate+Math.floor(random()*3)-1);
      f.fuel=f.requiredDepartureFuel+f.fuelRate*allowance;
      f.latest=Math.min(scenario.horizon,f.latest+Math.floor(random()*3));
    }
    const shift=Math.floor(random()*3);
    scenario.slots=scenario.slots.map(t=>t+shift).filter(t=>t<=scenario.horizon);
    scenario.arrivals[0].gateIn+=Math.floor(random()*5)-2;
    scenario.arrivals[1].gateIn+=Math.floor(random()*5)-2;
  }
  if(id==='tug') scenario.resources[1].outages=[{start:0,end:14}];
  if(id==='fuel') {
    scenario.flights[0].fuel=scenario.flights[0].requiredDepartureFuel+60*6;
    scenario.flights[0].latest=30;
  }
  if(id==='infeasible') { scenario.arrivals[0].gateIn=1; scenario.stands.find(s=>s.id==='R1').compatible=[]; }
  return scenario;
}

export function scenarioErrors(s) {
  const errors=[];
  const err=m=>errors.push(m);
  if(!s || typeof s!=='object') return ['Scenario must be an object.'];
  if(!integer(s.stateVersion)||s.stateVersion<1)err('Invalid state version.');
  if(s.now!==0)err('This prototype only replans before simulation execution (now = 0).');
  if(!integer(s.horizon)||s.horizon<20||s.horizon>180)err('Horizon must be 20–180 minutes.');
  if(!Array.isArray(s.flights)||s.flights.length<1||s.flights.length>8)return [...errors,'Provide 1–8 departure flights.'];
  if(!Array.isArray(s.arrivals)||s.arrivals.length>4)return [...errors,'Provide at most four inbound gate events.'];
  if(!Array.isArray(s.slots)||!s.slots.length||s.slots.some(t=>!integer(t)||t<0||t>s.horizon)||new Set(s.slots).size!==s.slots.length)err('Slots must be unique integer minutes within the horizon.');
  if(!Array.isArray(s.stands)||!Array.isArray(s.resources))return [...errors,'Missing stands or resources.'];
  const ids=s.flights.map(f=>f.id);
  if(new Set(ids).size!==ids.length)err('Duplicate departure ID.');
  if(new Set(s.stands.map(x=>x.id)).size!==s.stands.length)err('Duplicate stand ID.');
  if(!integer(s.taxiCapacity)||s.taxiCapacity<1)err('Taxi capacity must be positive.');
  for(const f of s.flights){
    for(const k of ['ready','scheduled','latest','taxiMinutes','pushMinutes','fuelRate','requiredDepartureFuel','fuel'])if(!finite(f[k])||f[k]<0)err(`${f.id}: invalid ${k}.`);
    if(!integer(f.ready)||!integer(f.scheduled)||!integer(f.latest))err(`${f.id}: timestamps must be integer minutes.`);
    if(f.latest>s.horizon||f.ready>f.latest)err(`${f.id}: invalid readiness / latest departure window.`);
    if(!s.stands.some(x=>x.id===f.gate)||!['M','H'].includes(f.wake))err(`${f.id}: unknown gate or wake class.`);
    if(f.fuelRate<=0||f.pushMinutes<=0||f.taxiMinutes<=0)err(`${f.id}: invalid movement model.`);
  }
  for(const a of s.arrivals)if(!integer(a.gateIn)||!integer(a.clearAt)||a.gateIn<0||a.gateIn>=a.clearAt||a.clearAt>s.horizon||!s.stands.some(x=>x.id===a.gate))err(`${a.id}: invalid inbound gate event.`);
  if(new Set([...ids,...s.arrivals.map(a=>a.id)]).size!==ids.length+s.arrivals.length)err('Duplicate flight ID across arrivals and departures.');
  for(const r of s.resources)if(!Array.isArray(r.outages)||r.outages.some(o=>!integer(o.start)||!integer(o.end)||o.start<0||o.start>=o.end||o.end>s.horizon))err(`${r.id}: invalid outage.`);
  if(!integer(s.towMinutes)||s.towMinutes<1||!finite(s.groundShiftEnd))err('Invalid ground timing.');
  if(!s.resources.some(r=>r.id==='TUG1')||!s.resources.some(r=>r.id==='TUG2'))err('Tug resources missing.');
  for(const k of ['M','H'])if(!integer(s.separation?.[k])||s.separation[k]<1)err('Invalid modeled separation.');
  for(const k of ['delay','engineOn','tow','remoteArrival','overtime','worstDelay'])if(!finite(s.weights?.[k])||s.weights[k]<0)err(`Invalid objective weight: ${k}.`);
  return errors;
}

export function validatePlan(s, p) {
  const issues=[];
  const add=(owner,code,flightId,detail)=>issues.push({owner,code,flightId,detail});
  const se=scenarioErrors(s);
  if(se.length)return {valid:false,issues:se.map(detail=>({owner:'SYSTEM',code:'INVALID_SCENARIO',detail})),checks:[]};
  if(!p||!Array.isArray(p.departures)||!Array.isArray(p.arrivals))return {valid:false,issues:[{owner:'SYSTEM',code:'SCHEMA',detail:'A plan must contain departure and arrival arrays.'}],checks:[]};
  if(p.stateVersion!==s.stateVersion)add('SYSTEM','STALE_STATE',null,`Plan references state ${p.stateVersion}; current state is ${s.stateVersion}.`);
  if(!integer(p.version)||p.version<1)add('SYSTEM','SCHEMA',null,'Plan version must be a positive integer.');
  const deps=new Map(), arrs=new Map();
  for(const d of p.departures){
    if(!d||!s.flights.some(f=>f.id===d.flightId)||deps.has(d.flightId)){add('SYSTEM','FLIGHT_SET',d?.flightId,'Unknown or duplicate departure.');continue;}
    deps.set(d.flightId,d);
  }
  for(const a of p.arrivals){
    if(!a||!s.arrivals.some(f=>f.id===a.flightId)||arrs.has(a.flightId)){add('SYSTEM','FLIGHT_SET',a?.flightId,'Unknown or duplicate arrival.');continue;}
    arrs.set(a.flightId,a);
  }
  for(const f of s.flights)if(!deps.has(f.id))add('SYSTEM','FLIGHT_SET',f.id,'Departure missing from plan.');
  for(const a of s.arrivals)if(!arrs.has(a.id))add('SYSTEM','FLIGHT_SET',a.id,'Arrival missing from plan.');
  const movements=[],occupancy=[],tugTasks=[];
  for(const f of s.flights){
    const d=deps.get(f.id);if(!d)continue;
    if(!integer(d.pushback)||!integer(d.takeoff)||!['direct','remote'].includes(d.mode)) {add('SYSTEM','SCHEMA',f.id,'Pushback / takeoff must be integer minutes; mode must be direct or remote.');continue;}
    if(d.pushback<0||d.takeoff>s.horizon||d.pushback>=d.takeoff)add('ATC','TIME_WINDOW',f.id,'Movement falls outside the planning horizon or time order.');
    if(d.pushback<f.ready)add('PILOT','NOT_READY',f.id,`Aircraft is ready at +${f.ready}; proposed pushback is +${d.pushback}.`);
    if(d.takeoff>f.latest)add('PILOT','DUTY_LIMIT',f.id,`Departure +${d.takeoff} exceeds modeled latest departure +${f.latest}.`);
    if(d.takeoff-d.pushback<f.pushMinutes+f.taxiMinutes)add('ATC','TAXI_DURATION',f.id,'Insufficient time for pushback and taxi.');
    if(!s.slots.includes(d.takeoff))add('ATC','SLOT',f.id,`Departure +${d.takeoff} is not an available runway slot.`);
    const fuelAtTakeoff=f.fuel-f.fuelRate*(d.takeoff-d.pushback);
    if(fuelAtTakeoff+1e-8<f.requiredDepartureFuel)add('PILOT','FUEL_RESERVE',f.id,`Projected departure fuel ${Math.round(fuelAtTakeoff)} kg is below required ${f.requiredDepartureFuel} kg.`);
    movements.push({start:d.pushback,end:d.takeoff,flightId:f.id,wake:f.wake,takeoff:d.takeoff});
    tugTasks.push({start:d.pushback,end:d.pushback+f.pushMinutes,resource:'TUG1',flightId:f.id});
    if(d.mode==='direct'){
      if(d.standId!==f.gate)add('GROUND','STAND',f.id,'A direct departure must start at its assigned gate.');
      occupancy.push({stand:f.gate,start:0,end:d.pushback+f.pushMinutes,flightId:f.id,wake:f.wake});
    }else{
      if(!integer(d.towStart)||d.towStart<f.ready||d.towStart+s.towMinutes>d.pushback){add('GROUND','TOW_TIMING',f.id,'Tow must start after readiness and finish before remote pushback.');continue;}
      if(s.stands.find(x=>x.id===d.standId)?.type!=='remote')add('GROUND','STAND',f.id,'Remote departure requires a known remote stand.');
      occupancy.push({stand:f.gate,start:0,end:d.towStart+f.pushMinutes,flightId:f.id,wake:f.wake});
      occupancy.push({stand:d.standId,start:d.towStart+s.towMinutes,end:d.pushback+f.pushMinutes,flightId:f.id,wake:f.wake});
      tugTasks.push({start:d.towStart,end:d.towStart+s.towMinutes,resource:'TUG2',flightId:f.id});
    }
  }
  for(const a of s.arrivals){const pA=arrs.get(a.id);if(pA)occupancy.push({stand:pA.standId,start:a.gateIn,end:a.clearAt,flightId:a.id,wake:a.wake});}
  for(const o of occupancy){const stand=s.stands.find(x=>x.id===o.stand);if(!stand||!stand.compatible.includes(o.wake))add('GROUND','COMPATIBILITY',o.flightId,`Stand ${o.stand??'missing'} is incompatible or unavailable.`);}
  for(let i=0;i<occupancy.length;i++)for(let j=i+1;j<occupancy.length;j++)if(occupancy[i].stand===occupancy[j].stand&&overlaps(occupancy[i],occupancy[j]))add('GROUND','GATE_CONFLICT',occupancy[i].flightId,`${occupancy[i].stand} overlaps ${occupancy[j].flightId} from +${Math.max(occupancy[i].start,occupancy[j].start)}.`);
  for(const t of tugTasks){const r=s.resources.find(x=>x.id===t.resource);if(!r||r.outages.some(o=>overlaps(t,o)))add('GROUND','RESOURCE_OUTAGE',t.flightId,`${t.resource} is unavailable during +${t.start}–${t.end}.`);}
  for(let i=0;i<tugTasks.length;i++)for(let j=i+1;j<tugTasks.length;j++)if(tugTasks[i].resource===tugTasks[j].resource&&overlaps(tugTasks[i],tugTasks[j]))add('GROUND','RESOURCE_CONFLICT',tugTasks[j].flightId,`${tugTasks[i].resource} overlaps ${tugTasks[i].flightId}.`);
  const ordered=movements.toSorted((a,b)=>a.takeoff-b.takeoff);
  for(let i=1;i<ordered.length;i++)if(ordered[i].takeoff-ordered[i-1].takeoff<s.separation[ordered[i-1].wake])add('ATC','WAKE_SEPARATION',ordered[i].flightId,`Modeled ${s.separation[ordered[i-1].wake]}-minute spacing required after ${ordered[i-1].flightId}.`);
  for(let t=0;t<s.horizon;t++){const active=movements.filter(m=>m.start<=t&&t<m.end);if(active.length>s.taxiCapacity){add('ATC','TAXI_CAPACITY',null,`${active.length} aircraft exceed surface capacity ${s.taxiCapacity} at +${t}.`);break;}}
  const groups=[['Runway slots & spacing','ATC',['SLOT','WAKE_SEPARATION','TAXI_DURATION','TIME_WINDOW']],['Surface capacity','ATC',['TAXI_CAPACITY']],['Readiness & duty','PILOT',['NOT_READY','DUTY_LIMIT']],['Departure fuel','PILOT',['FUEL_RESERVE']],['Gate & stand occupancy','GROUND',['GATE_CONFLICT','COMPATIBILITY','STAND']],['Ground equipment','GROUND',['TOW_TIMING','RESOURCE_OUTAGE','RESOURCE_CONFLICT']],['Plan completeness & version','SYSTEM',['SCHEMA','FLIGHT_SET','STALE_STATE','INVALID_SCENARIO']]];
  return {valid:issues.length===0,issues,occupancy,tugTasks,checks:groups.map(([name,owner,codes])=>({name,owner,passed:!issues.some(i=>codes.includes(i.code)),issues:issues.filter(i=>codes.includes(i.code))}))};
}

export function metrics(s,p){
  if(!p||!Array.isArray(p.departures))return null;
  const delays=p.departures.map(d=>Math.max(0,d.takeoff-s.flights.find(f=>f.id===d.flightId).scheduled));
  const engineOn=p.departures.reduce((n,d)=>n+d.takeoff-d.pushback,0);
  const fuelBurn=p.departures.reduce((n,d)=>n+(d.takeoff-d.pushback)*s.flights.find(f=>f.id===d.flightId).fuelRate,0);
  const tows=p.departures.filter(d=>d.mode==='remote').length;
  const remoteArrivals=p.arrivals.filter(a=>s.stands.find(x=>x.id===a.standId)?.type==='remote').length;
  const overtime=p.departures.reduce((n,d)=>n+Math.max(0,(d.mode==='remote'?d.towStart+s.towMinutes:d.pushback+s.flights.find(f=>f.id===d.flightId).pushMinutes)-s.groundShiftEnd),0);
  const totalDelay=delays.reduce((a,b)=>a+b,0),worstDelay=Math.max(0,...delays);
  const w=s.weights;
  return {totalDelay,worstDelay,engineOn,fuelBurn,tows,remoteArrivals,overtime,score:Number((totalDelay*w.delay+engineOn*w.engineOn+tows*w.tow+remoteArrivals*w.remoteArrival+overtime*w.overtime+worstDelay*w.worstDelay).toFixed(2))};
}

export function gateClear(s,d){const f=s.flights.find(f=>f.id===d.flightId);return d.mode==='remote'?d.towStart+f.pushMinutes:d.pushback+f.pushMinutes;}

function freeInterval(s,resource,start,duration,tasks=[]){
  const outages=s.resources.find(x=>x.id===resource)?.outages??[];
  return ![...outages,...tasks.filter(t=>t.resource===resource)].some(o=>overlaps({start,end:start+duration},o));
}

// ATC's tool assigns earliest allowed slots for a requested departure order.
// Other domains subsequently review gate and fuel constraints independently.
export function buildRunwayPlan(s,order=s.flights.toSorted((a,b)=>a.scheduled-b.scheduled).map(f=>f.id),version=1){
  const departures=[];let last=null;
  for(const id of order){
    const f=s.flights.find(f=>f.id===id);if(!f)throw new Error('Unknown flight in order.');
    const slot=s.slots.find(t=>t>=f.ready+f.taxiMinutes+f.pushMinutes&&(!last||t-last.takeoff>=s.separation[last.wake]));
    if(slot===undefined)return null;
    const d={flightId:f.id,pushback:slot-f.taxiMinutes-f.pushMinutes,takeoff:slot,mode:'direct',standId:f.gate};
    departures.push(d);last={takeoff:slot,wake:f.wake};
  }
  return {version,stateVersion:s.stateVersion,departures,arrivals:s.arrivals.map(a=>({flightId:a.id,standId:a.gate}))};
}

// Ground's tool enumerates local stand / tow alternatives for a fixed runway plan.
// It does not choose runway slots or alter protected pilot fuel requirements.
export function groundAlternatives(s,plan,preference='tow'){
  if(!plan)return [];
  let options=[clone(plan)];
  for(const inbound of s.arrivals){
    const next=[];
    for(const p of options){
      const assignment=p.arrivals.find(a=>a.flightId===inbound.id);
      const dep=p.departures.find(d=>s.flights.find(f=>f.id===d.flightId).gate===assignment.standId&&gateClear(s,d)>inbound.gateIn);
      if(!dep){next.push(p);continue;}
      const f=s.flights.find(f=>f.id===dep.flightId);
      for(const remote of s.stands.filter(x=>x.type==='remote')){
        if(remote.compatible.includes(f.wake)){
          // Candidate tow start boundaries include every integer minute in the tiny model.
          // Keep the earliest non-conflicting local placement for each stand.
          for(let start=f.ready;start+s.towMinutes<=dep.pushback&&start+f.pushMinutes<=inbound.gateIn;start++){
            const towTasks=p.departures.filter(d=>d.mode==='remote').map(d=>({start:d.towStart,end:d.towStart+s.towMinutes,resource:'TUG2'}));
            if(!freeInterval(s,'TUG2',start,s.towMinutes,towTasks))continue;
            const q=clone(p),d=q.departures.find(d=>d.flightId===f.id);Object.assign(d,{mode:'remote',standId:remote.id,towStart:start});
            const check=validatePlan(s,q);
            if(!check.issues.some(i=>['RESOURCE_CONFLICT','RESOURCE_OUTAGE','COMPATIBILITY','STAND'].includes(i.code)&&i.flightId===f.id)&&!check.issues.some(i=>i.code==='GATE_CONFLICT'&&i.detail.startsWith(remote.id))){next.push(q);break;}
          }
        }
        if(remote.compatible.includes(inbound.wake)){
          const q=clone(p);q.arrivals.find(a=>a.flightId===inbound.id).standId=remote.id;
          if(!validatePlan(s,q).issues.some(i=>i.code==='GATE_CONFLICT'&&i.detail.startsWith(remote.id)))next.push(q);
        }
      }
    }
    options=next;
  }
  const candidates=options.filter(p=>!validatePlan(s,p).issues.some(i=>i.owner==='GROUND'));
  return candidates.toSorted((a,b)=>{
    const am=metrics(s,a),bm=metrics(s,b);
    const ac=preference==='remote_arrival'?am.tows*20+am.remoteArrivals:am.tows*2+am.remoteArrivals*12;
    const bc=preference==='remote_arrival'?bm.tows*20+bm.remoteArrivals:bm.tows*2+bm.remoteArrivals*12;
    return ac-bc||am.score-bm.score;
  });
}

export function pilotAlternative(s,p){
  const q=clone(p);
  for(const d of q.departures){const f=s.flights.find(f=>f.id===d.flightId);d.pushback=Math.max(f.ready,d.takeoff-f.pushMinutes-f.taxiMinutes);}
  return q;
}

export function deterministicFallback(s){
  // Fixed order, no LLM. Identical information and validators as negotiation.
  const orders=[s.flights.toSorted((a,b)=>a.scheduled-b.scheduled).map(f=>f.id),s.flights.toSorted((a,b)=>a.latest-b.latest||a.scheduled-b.scheduled).map(f=>f.id)];
  const plans=[];
  for(const order of orders){const p=buildRunwayPlan(s,order);if(!p)continue;for(const q of groundAlternatives(s,p,'tow'))if(validatePlan(s,q).valid)plans.push(q);}
  const best=plans.toSorted((a,b)=>metrics(s,a).score-metrics(s,b).score)[0];
  return best?{status:'feasible',plan:best,metrics:metrics(s,best),method:'Two fixed departure orders + stand/tug repair; all constraints validated.'}:{status:'unresolved',plan:null,metrics:null,method:'Bounded fallback found no validated plan. This is not a proof of infeasibility.'};
}

function* permutations(a){if(a.length===0){yield [];return;}for(let i=0;i<a.length;i++)for(const p of permutations([...a.slice(0,i),...a.slice(i+1)]))yield[a[i],...p];}
export function searchReference(s,maxOrders=720){
  let best=null,evaluated=0,feasible=0;
  for(const order of permutations(s.flights.map(f=>f.id))){
    if(evaluated>=maxOrders)break;evaluated++;
    const p=buildRunwayPlan(s,order);if(!p)continue;
    for(const q of groundAlternatives(s,p))if(validatePlan(s,q).valid){feasible++;if(!best||metrics(s,q).score<metrics(s,best).score)best=q;}
  }
  return {status:best?'feasible':'unresolved',plan:best,metrics:best?metrics(s,best):null,evaluated,feasible,optimalityProven:false,method:'Bounded order search; earliest-slot assignment and local stand repair. No global optimality claim.'};
}

export function applyUpdate(s, update){
  if(!update||typeof update!=='object')throw new Error('A structured update is required.');
  const next=clone(s);
  if(update.kind==='resource_outage'){
    const r=next.resources.find(r=>r.id===update.resourceId);
    if(!r)throw new Error('Unknown resource.');
    if(!integer(update.start)||!integer(update.end)||update.start<next.now||update.start>=update.end||update.end>next.horizon)throw new Error('Outage must be an integer interval inside the planning horizon.');
    r.outages.push({start:update.start,end:update.end});
  }else if(update.kind==='capacity'){
    if(!integer(update.until)||update.until<0||update.until>=next.horizon)throw new Error('Capacity restriction must end inside the horizon.');
    next.slots=next.slots.filter(t=>t>=update.until);
    if(!next.slots.length)throw new Error('No runway slots remain.');
  }else if(update.kind==='fuel'){
    const f=next.flights.find(f=>f.id===update.flightId);
    if(!f||!integer(update.maxEngineOn)||update.maxEngineOn<0||update.maxEngineOn>60)throw new Error('Select a known flight and 0–60 engine-on minutes.');
    f.fuel=f.requiredDepartureFuel+f.fuelRate*update.maxEngineOn;
  }else if(update.kind==='stand_closed'){
    const stand=next.stands.find(x=>x.id===update.standId);
    if(!stand)throw new Error('Unknown stand.');stand.compatible=[];
  }else throw new Error('Unsupported update.');
  next.stateVersion++;next.updates.push({...clone(update),stateVersion:next.stateVersion});
  const errors=scenarioErrors(next);if(errors.length)throw new Error(errors.join(' '));return next;
}

// Deliberately narrow offline parser: unknown / ambiguous prose is never guessed.
export function parseUpdate(text,s){
  if(typeof text!=='string'||text.length>500)throw new Error('Enter an update of at most 500 characters.');
  const clean=text.trim().toLowerCase();
  let m=clean.match(/^tug\s*([12])\s+(?:is\s+)?(?:offline|unavailable|out of service)(?:\s+for)?\s+(?:the\s+)?(?:next\s+)?(\d+)\s*(?:minutes?|mins?)\.?$/);
  if(m)return {kind:'resource_outage',resourceId:`TUG${m[1]}`,start:s.now,end:s.now+Number(m[2])};
  m=clean.match(/^(?:runway\s+)?(?:closed|no departures)(?:\s+for)?\s+(?:the\s+)?(?:next\s+)?(\d+)\s*(?:minutes?|mins?)\.?$/);
  if(m)return {kind:'capacity',until:s.now+Number(m[1])};
  m=clean.match(/^(?:close|stand closed)\s+(r1|g[1-6])\.?$/);
  if(m)return {kind:'stand_closed',standId:m[1].toUpperCase()};
  throw new Error('Update needs clarification. Try “Tug 2 unavailable for 14 minutes”, “No departures for 26 minutes”, or use the structured controls.');
}
