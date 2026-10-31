import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createScenario,clone} from './domain.mjs';

export const constraints=JSON.parse(readFileSync(new URL('../data/operational-constraints.json',import.meta.url)));
export const flightIndex=JSON.parse(readFileSync(new URL('../data/flights-index.json',import.meta.url)));
const roles=['ATC','PILOT','GROUND'];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,16);
export const recoveryPlanHash=(scenario,plan)=>digest({scenario,plan});
export const hhmm=value=>{const t=String(value).padStart(4,'0');return Number(t.slice(0,2))*60+Number(t.slice(2));};
const num=(row,key)=>row[key]===''||row[key]==null?null:Number(row[key]);
const ruleNumber=name=>{const row=constraints.fuel_and_crew.find(r=>r.rule===name);const token=String(row?.value).replaceAll(',','').match(/\d+(?:\.\d+)?/);const n=token?Number(token[0]):NaN;if(!Number.isFinite(n))throw new Error(`Missing numeric workbook rule: ${name}`);return n;};
export const wakeName=w=>({S:'Super (A380)',H:'Heavy',M:'Large',L:'Small'}[w]||w);
export function wakeSeconds(leader,follower){
  return (constraints.wake_separation.find(r=>r.leader===wakeName(leader)&&r.follower===wakeName(follower))??constraints.wake_separation.find(r=>r.leader==='Any other pair'))['min_time_s (same runway departures)'];
}

export function createRecoveryScenario(index=0,overrides={}){
  if(!Number.isInteger(index)||!flightIndex.records[index])throw new Error('Select an indexed JFK arrival.');
  const source=clone(flightIndex.records[index]),r=source.record;
  if(r.DESTINATION_AIRPORT!=='JFK'||!((num(r,'WEATHER_DELAY')??0)>15||(num(r,'LATE_AIRCRAFT_DELAY')??0)>20))throw new Error('The selected flight must qualify and arrive at JFK.');
  const airport=constraints.airport_capacity.find(a=>a.IATA_CODE==='JFK');
  const baseline=hhmm(r.SCHEDULED_ARRIVAL)+Math.max(0,num(r,'DEPARTURE_DELAY')??0),start=baseline-30;
  const s=createScenario('weather');
  Object.assign(s,{id:'recovery',name:'JFK arrival recovery',clock:{hour:Math.floor(((start%1440)+1440)%1440/60),minute:((start%60)+60)%60},horizon:90,airport:{code:'JFK',name:'John F. Kennedy',timezone:'America/New_York'},capacity:clone(airport),source,baselineETA:30});
  const slots=[48,38,42,54,58,62];
  s.flights.forEach((f,i)=>Object.assign(f,{ready:20,scheduled:slots[i],latest:90,wake:i===2?'H':'M',fuel:7000,requiredDepartureFuel:4000,fuelRate:60,taxiMinutes:4,pushMinutes:2}));
  s.stands=[...Array.from({length:9},(_,i)=>({id:`G${i+1}`,type:'gate',compatible:['M','H']})),{id:'R1',type:'remote',compatible:[]}];
  s.arrivals=[{id:'IN1',callsign:`${r.AIRLINE} ${r.FLIGHT_NUMBER}`,gate:'G1',gateIn:30,clearAt:65,wake:'M',provenance:'historical_trigger'}];
  const holdingRate=ruleNumber('Holding fuel burn (narrowbody)')/60,tripFuel=6000,contingency=tripFuel*ruleNumber('Contingency fuel')/100;
  s.target={flightId:'IN1',aircraftClass:'narrowbody',holdingRate,tripFuel,finalReserve:holdingRate*ruleNumber('Final fuel reserve'),contingency,arrivalFuel:holdingRate*ruleNumber('Assumed spare fuel on arrival')+contingency,crewDutyElapsed:690,crewDutyMax:ruleNumber('Flight crew max duty')*60,groundShiftElapsed:410,groundShiftMax:ruleNumber('Ground crew shift')*60,gateNotice:ruleNumber('Gate change notice'),arrivalTaxi:4};
  s.background=Array.from({length:31},(_,i)=>({id:`BG${i+1}`,time:i*3,runway:'13R',wake:'M',kind:'background'}));
  s.activeRunways=['4L','4R','13R'];s.backgroundOccupiedGates=airport.gates-airport.spare_gates_at_any_time-6;
  s.closedStands=[];
  s.provenance={type:'historical_trigger',source:{...r,sourceRow:source.sourceRow},label:`DOT flight row ${source.sourceRow} · organizer limits · simulated current state`};
  s.assumptions=[
    'One historical JFK arrival is the disruption. Other aircraft, gate occupancy, runway configuration and crew status are explicit scenario assumptions.',
    'Baseline ETA = scheduled arrival + nonnegative departure delay. This is a simple scenario estimate, not a prediction of the historical outcome. Arrival delay is not added again.',
    'Aircraft type is absent. The target uses an assumed narrowbody, Large wake class, 6,000 kg trip fuel and 2,400 kg/hour holding burn.',
    'The workbook 45-minute arrival holding allowance includes the protected 30-minute final reserve. The 5% trip-fuel contingency is carried separately and remains protected. That leaves 15 minutes of discretionary holding.',
    'Target crew has already worked 690 minutes. The same crew is assumed to operate the onward departure after turnaround plus six minutes of pushback/taxi. Ground crew has worked 410 minutes.',
    'Three active runway aliases and background operations are simulated. The airport movement cap is treated as an aggregate cap over each rolling 60-minute window.',
    'The three spare gates are G7–G9 at decision time. Six other gates and 61 background occupied gates represent 67 occupied gates out of 70.',
    'Routes are illustrative. No taxiway blockage, turbulence or passenger-connection data was supplied; these are not claimed as validated constraints.',
    'Ground overtime is allowed at 1.5 times a normalized wage per minute. Preference scores and the acceptance threshold of 70/100 are disclosed product choices, not workbook rules.',
    'All choices are planning and replay only. No airport instruction or physical movement is executed.'
  ];
  if(overrides.closedStands)s.closedStands=[...overrides.closedStands];
  if(overrides.arrivalFuel!=null)s.target.arrivalFuel=Number(overrides.arrivalFuel);
  return s;
}

export function buildRecoveryCandidates(s){
  const spare=s.stands.find(g=>/^G[789]$/.test(g.id)&&!s.closedStands.includes(g.id))?.id||'G7';
  return [
    {id:'gate',title:'Use a spare gate',strategy:`Preserve the arrival time and move to ${spare}.`,gate:spare,delay:0,resequenced:0},
    {id:'sequence',title:'Resequence departures',strategy:'Release G1 sooner by swapping two departures. Arrive four minutes later.',gate:'G1',delay:4,resequenced:2},
    {id:'hold',title:'Keep the original gate',strategy:'Hold for fourteen minutes while G1 clears. Preserve the departure sequence.',gate:'G1',delay:14,resequenced:0}
  ].map((choice,i)=>{
    const departures=s.flights.map(f=>({flightId:f.id,pushback:f.scheduled-6,takeoff:f.scheduled,mode:'direct',standId:f.gate,runway:'4L'}));
    if(choice.id==='sequence')for(const d of departures)if(d.flightId==='F1'||d.flightId==='F2'){d.takeoff=d.flightId==='F1'?38:48;d.pushback=d.takeoff-6;}
    const gateIn=s.baselineETA+choice.delay,turnaround=s.capacity.min_turnaround_min,ready=gateIn+turnaround,nextDeparture=ready+6;
    const plan={version:i+1,stateVersion:s.stateVersion,departures,arrivals:[{flightId:'IN1',standId:choice.gate,gateIn,clearAt:ready+2,landing:gateIn-s.target.arrivalTaxi,runway:'4R',noticeAt:s.now}],nextDeparture};
    const fuelBurn=choice.delay*s.target.holdingRate,remainingFuel=s.target.arrivalFuel-fuelBurn,protectedFuel=s.target.finalReserve+s.target.contingency;
    const overtime=Math.max(0,s.target.groundShiftElapsed+ready-s.target.groundShiftMax);
    return {...choice,plan,hash:recoveryPlanHash(s,plan),metrics:{arrivalDelay:choice.delay,gateChanges:choice.gate==='G1'?0:1,resequenced:choice.resequenced,holdingFuel:Math.round(fuelBurn),remainingFuel,protectedFuel,fuelMargin:remainingFuel-protectedFuel,crewMargin:s.target.crewDutyMax-s.target.crewDutyElapsed-nextDeparture,overtime,overtimeCost:overtime*1.5,turnaround,gateIn,ready,nextDeparture}};
  });
}

export function validateRecovery(s,option){
  const issues=[],add=(owner,code,detail)=>issues.push({owner,code,detail});
  const p=option.plan,a=p.arrivals[0],t=s.target;
  if(p.stateVersion!==s.stateVersion)add('SYSTEM','STALE_STATE','This option belongs to an earlier state.');
  if(!Number.isInteger(p.version)||p.version<1||p.departures.length!==s.flights.length||new Set(p.departures.map(d=>d.flightId)).size!==s.flights.length||p.departures.some(d=>!s.flights.some(f=>f.id===d.flightId))||p.arrivals.length!==1||a?.flightId!=='IN1')add('SYSTEM','SCHEMA','The plan must contain each known flight exactly once.');
  if(!a||![a.gateIn,a.clearAt,a.landing,a.noticeAt,p.nextDeparture].every(Number.isFinite)||a.landing<s.now||a.gateIn<s.baselineETA||a.clearAt>s.horizon||a.landing>a.gateIn)add('SYSTEM','TIME','Invalid arrival or turnaround timing.');
  if(!a)return {valid:false,issues,checks:[]};
  if(!s.stands.some(g=>g.id===a.standId&&g.type==='gate')||s.closedStands.includes(a.standId))add('GROUND','GATE_AVAILABLE','The assigned gate is unavailable.');
  if(a.standId!=='G1'&&a.gateIn-a.noticeAt<t.gateNotice)add('GROUND','GATE_NOTICE','A changed gate needs at least 20 minutes notice before revised arrival.');
  if(a.clearAt-a.gateIn<s.capacity.min_turnaround_min+2||p.nextDeparture<a.gateIn+s.capacity.min_turnaround_min+6)add('GROUND','TURNAROUND','Minimum turnaround and onward movement time must be preserved.');
  const occupancy=p.departures.map(d=>({id:d.flightId,stand:d.standId,start:0,end:d.pushback+2}));
  occupancy.push({id:a.flightId,stand:a.standId,start:a.gateIn,end:a.clearAt});
  for(let i=0;i<occupancy.length;i++)for(let j=i+1;j<occupancy.length;j++)if(occupancy[i].stand===occupancy[j].stand&&occupancy[i].start<occupancy[j].end&&occupancy[j].start<occupancy[i].end)add('GROUND','GATE_CONFLICT',`${occupancy[i].stand} has overlapping occupancy.`);
  if(s.stands.filter(g=>/^G[789]$/.test(g.id)&&!s.closedStands.includes(g.id)).length>s.capacity.spare_gates_at_any_time)add('GROUND','SPARE_GATES','More spare gates were introduced than the workbook permits.');
  for(const minute of occupancy.flatMap(o=>[o.start,o.end]))if(s.backgroundOccupiedGates+occupancy.filter(o=>o.start<=minute&&minute<o.end).length>s.capacity.gates)add('GROUND','GATE_CAPACITY','Airport-wide gate capacity exceeded.');
  const movements=[...s.background,...p.departures.map(d=>({id:d.flightId,time:d.takeoff,runway:d.runway,wake:s.flights.find(f=>f.id===d.flightId)?.wake})),{id:a.flightId,time:a.landing,runway:a.runway,wake:'M'},{id:'ONWARD',time:p.nextDeparture,runway:'4L',wake:'M'}];
  if(s.activeRunways.length>s.capacity.active_runways||new Set(s.activeRunways).size!==s.activeRunways.length)add('ATC','ACTIVE_RUNWAYS','Active runway count exceeds the workbook limit.');
  if(movements.some(m=>!s.activeRunways.includes(m.runway)))add('ATC','RUNWAY_CLOSED','A movement uses an inactive runway.');
  for(const m of movements)if(movements.filter(n=>n.time>=m.time&&n.time<m.time+60).length>s.capacity.max_runway_ops_per_hour)add('ATC','RUNWAY_CAPACITY','Aggregate rolling-hour runway movements exceed the airport limit.');
  for(const runway of s.activeRunways){const ordered=movements.filter(m=>m.runway===runway).sort((a,b)=>a.time-b.time);for(let i=1;i<ordered.length;i++)if((ordered[i].time-ordered[i-1].time)*60<wakeSeconds(ordered[i-1].wake,ordered[i].wake))add('ATC','WAKE_SEPARATION',`${ordered[i].id} violates the workbook leader/follower spacing.`);}
  const depTasks=[];
  for(const d of p.departures){const f=s.flights.find(f=>f.id===d.flightId);if(!f)continue;if(d.pushback<f.ready||d.takeoff-d.pushback<6||d.takeoff>f.latest)add('ATC','DEPARTURE_TIMING',`${f.callsign} cannot use its proposed departure timing.`);if(f.fuel-(d.takeoff-d.pushback)*f.fuelRate<f.requiredDepartureFuel)add('PILOT','DEPARTURE_FUEL',`${f.callsign} breaks its simulated departure fuel limit.`);depTasks.push({start:d.pushback,end:d.pushback+2});}
  for(let i=0;i<depTasks.length;i++)for(let j=i+1;j<depTasks.length;j++)if(depTasks[i].start<depTasks[j].end&&depTasks[j].start<depTasks[i].end)add('GROUND','TUG_CONFLICT','The single modeled pushback tug is double-booked.');
  const holding=Math.max(0,a.gateIn-s.baselineETA),fuel=t.arrivalFuel-holding*t.holdingRate;
  if(fuel+1e-8<t.finalReserve+t.contingency)add('PILOT','FUEL_RESERVE','Holding consumes protected final reserve or contingency fuel.');
  if(t.crewDutyElapsed+p.nextDeparture>t.crewDutyMax)add('PILOT','CREW_DUTY','The assumed same-crew onward departure exceeds 13 hours from report.');
  const groups=[['Runway capacity & active runways','ATC',['ACTIVE_RUNWAYS','RUNWAY_CLOSED','RUNWAY_CAPACITY']],['Leader/follower wake separation','ATC',['WAKE_SEPARATION']],['Arrival reserve & contingency','PILOT',['FUEL_RESERVE','DEPARTURE_FUEL']],['Flight crew duty','PILOT',['CREW_DUTY']],['Gate occupancy & capacity','GROUND',['GATE_AVAILABLE','GATE_CONFLICT','GATE_CAPACITY','SPARE_GATES']],['Gate-change notice & turnaround','GROUND',['GATE_NOTICE','TURNAROUND']],['Readiness & equipment','GROUND',['DEPARTURE_TIMING','TUG_CONFLICT']],['Plan schema & state','SYSTEM',['SCHEMA','STALE_STATE','TIME']]];
  return {valid:issues.length===0,issues,occupancy,movements,checks:groups.map(([name,owner,codes])=>({name,owner,passed:!issues.some(i=>codes.includes(i.code))}))};
}

export class RecoveryAgent{
  constructor(role){this.role=role;this.history=[];}
  message(s,options,turn,peerMessages=[]){
    const assessments=options.map(o=>{
      const m=o.metrics,findings=validateRecovery(s,o).issues.filter(i=>i.owner===this.role||i.owner==='SYSTEM');
      const score=Math.max(0,Math.round(this.role==='ATC'?100-2*m.arrivalDelay-14*m.resequenced:this.role==='PILOT'?100-4*m.arrivalDelay:100-26*m.gateChanges-2*m.overtime));
      const explanation=this.role==='ATC'?`${m.arrivalDelay} min arrival shift; ${m.resequenced} departures resequenced. Capacity and wake limits ${findings.length?'need repair':'pass'}.`:this.role==='PILOT'?`${m.holdingFuel} kg extra holding burn; ${Math.round(m.fuelMargin)} kg above protected fuel; ${m.crewMargin} min onward crew margin.`:`${m.gateChanges} gate change; ${m.turnaround} min turnaround; ${m.overtime} min overtime (${m.overtimeCost} normalized wage-min).`;
      return {role:this.role,optionId:o.id,planHash:o.hash,stateVersion:s.stateVersion,decision:findings.length?'VETO':score>=70?'ACCEPT':'COUNTER',efficiency:score,explanation,findings,reason:findings.length?'Hard constraint breach':score>=70?'Meets this agent’s efficiency target':'Preference objection; hard constraints pass'};
    });
    const preferred=assessments.filter(a=>a.decision!=='VETO').sort((a,b)=>b.efficiency-a.efficiency)[0];
    const message={type:'agent_message',role:this.role,turn,stage:turn===1?'PROPOSE_AND_ASSESS':'CONFIRM_SHARED_OPTIONS',stateVersion:s.stateVersion,engine:'policy',portfolioHash:digest(options.map(o=>o.hash)),preferredOptionId:preferred?.optionId??null,peerPreferences:peerMessages.filter(m=>m.role!==this.role).map(m=>({role:m.role,preferredOptionId:m.preferredOptionId})),assessments,acceptedHashes:assessments.filter(a=>a.decision==='ACCEPT').map(a=>a.planHash)};
    this.history.push(clone(message));return message;
  }
}

export function rankRecovery(options,messages){
  return options.map(o=>{
    const assessments=roles.map(role=>messages.find(m=>m.role===role)?.assessments.find(a=>a.optionId===o.id&&a.planHash===o.hash&&a.stateVersion===o.plan.stateVersion)).filter(Boolean);
    const accepted=assessments.filter(a=>a.decision==='ACCEPT').length;
    return {...o,assessments,accepted,consensus:o.validation.valid&&stranded(o)===0&&assessments.length===3&&accepted===3,minEfficiency:Math.min(...assessments.map(a=>a.efficiency)),meanEfficiency:Math.round(assessments.reduce((n,a)=>n+a.efficiency,0)/Math.max(1,assessments.length))};
  }).sort((a,b)=>Number(b.validation.valid)-Number(a.validation.valid)||stranded(a)-stranded(b)||b.accepted-a.accepted||b.minEfficiency-a.minEfficiency||b.meanEfficiency-a.meanEfficiency||(a.chain?.othersCost??0)-(b.chain?.othersCost??0)||a.metrics.arrivalDelay-b.metrics.arrivalDelay||a.id.localeCompare(b.id)).map((o,i)=>({...o,rank:i+1}));
}

export const recoveryCost=o=>o.metrics.arrivalDelay+o.metrics.holdingFuel/40+4*o.metrics.gateChanges+3*o.metrics.resequenced+2*o.metrics.overtime+(o.chain?.othersCost??0);
const stranded=o=>(o.chain?.blocked??0)+(o.chain?.selfBlocked?1:0);
export function recoveryFallback(options){
  return options.filter(o=>o.validation.valid).sort((a,b)=>recoveryCost(a)-recoveryCost(b)||a.id.localeCompare(b.id))[0]??null;
}

export function negotiateRecovery(s,{forceTimeout=false,chain=null}={}){
  const options=buildRecoveryCandidates(s).map(o=>({...o,validation:validateRecovery(s,o),chain:chain?.[o.id]??null})),agents=roles.map(role=>new RecoveryAgent(role)),events=[];
  let ranked=options,messages=[],turns=0;
  if(!forceTimeout)for(let turn=1;turn<=3;turn++){
    turns=turn;const previous=messages;messages=agents.map(a=>a.message(s,options,turn,previous));events.push(...messages);
    ranked=rankRecovery(options,messages);
    if(turn>=2&&ranked.some(o=>o.consensus))break;
  }
  if(forceTimeout){ranked=options.map((o,i)=>({...o,rank:i+1,assessments:[],accepted:0,consensus:false,minEfficiency:null,meanEfficiency:null}));}
  const consensus=forceTimeout?null:ranked.find(o=>o.consensus),fallback=consensus?null:recoveryFallback(ranked),recommended=consensus??fallback;
  const status=consensus?'consensus':fallback?'fallback':'handoff',c=recommended?.chain,note=c?` Chain check: ${c.blocked?`${c.blocked} chained arrival(s) would be left without an option`:'no chained arrival is left without an option'}; this flight is served ${c.servePosition} of ${c.groupSize}.`:'';
  events.push({type:status,turn:turns,stateVersion:s.stateVersion,optionId:recommended?.id??null,explanation:(consensus?`All three independent policy agents accepted “${consensus.title}” (${consensus.hash}). This consensus applies to that recommendation; other options retain their own assessments. Human selection is pending.`:forceTimeout?'Timeout drill. Deterministic cost rule selected a validated alternative without agent messages.':fallback?`No unanimous acceptance after three turns. Deterministic cost rule recommends “${fallback.title}”.`:'No hard-valid alternative exists in the three-strategy search. Human review required.')+note});
  return {stateVersion:s.stateVersion,status,turns,mode:'policy',options:ranked,recommendedId:recommended?.id??null,selectedId:null,events,ranking:'Hard-valid first, then options that strand no chained arrival, then ACCEPT count, then lowest agent efficiency, mean efficiency, knock-on cost to chained arrivals and arrival delay. Scores are policy assessments, not model confidence or probabilities.',scorePolicy:{acceptThreshold:70,ATC:'max(0, 100 − 2 × arrival delay − 14 × resequenced departures)',PILOT:'max(0, 100 − 4 × holding minutes)',GROUND:'max(0, 100 − 26 × gate changes − 2 × overtime minutes)'}};
}

export function chooseRecovery(s,portfolio,{optionId,planHash,stateVersion}){
  if(!portfolio||stateVersion!==s.stateVersion||portfolio.stateVersion!==s.stateVersion)throw new Error('Options are outdated. Generate a fresh comparison.');
  const option=portfolio.options.find(o=>o.id===optionId);
  if(!option||option.hash!==planHash||recoveryPlanHash(s,option.plan)!==planHash)throw new Error('Option identity or plan hash does not match.');
  const validation=validateRecovery(s,option);if(!validation.valid)throw new Error('A hard constraint blocks this option. Human selection cannot waive it.');
  return {optionId,planHash,stateVersion,source:option.consensus?'human_selected_consensus':'human_selected_validated_alternative',preferenceObjections:option.assessments.filter(a=>a.decision==='COUNTER'),chain:option.chain??null,time:new Date().toISOString(),explanation:'Human selected a planning option. No movement was executed.'};
}

export function recoveryMapPayload(s,option,portfolio,selection=null){
  const scenario=clone(s),a=option.plan.arrivals[0];
  scenario.arrivals[0]={...scenario.arrivals[0],gateIn:a.gateIn,clearAt:a.clearAt};
  scenario.slots=option.plan.departures.map(d=>d.takeoff).sort((a,b)=>a-b);
  scenario.stands=scenario.stands.map(g=>({...g,compatible:s.closedStands.includes(g.id)?[]:g.compatible}));
  return {scenario,plan:option.plan,validation:option.validation,result:{status:'preview',stateVersion:s.stateVersion,plan:option.plan},recovery:{optionId:option.id,title:option.title,hash:option.hash,validated:option.validation.valid,selected:selection?.optionId===option.id,metrics:option.metrics,baselineETA:s.baselineETA,activeRunways:s.activeRunways},reviews:Object.fromEntries(option.assessments.map(a=>[a.role,a])),proposals:{},events:portfolio.events,busy:false,mode:'policy'};
}
