import test from 'node:test';
import assert from 'node:assert/strict';
import {createScenario,buildRunwayPlan,groundAlternatives,validatePlan,hashPlan,applyUpdate,parseUpdate,deterministicFallback,searchReference,scenarioErrors,metrics,clone} from '../src/domain.mjs';
import {negotiate,validateConsensus,DomainAgent} from '../src/agents.mjs';
import {qualifyingFlights,parseCSV} from '../src/import.mjs';
import {validateDecision} from '../src/providers.mjs';

function feasible(s=createScenario()){const p=deterministicFallback(s).plan;assert.ok(p);return p;}
test('all three local domain agents propose, review, and agree on a valid shared plan',async()=>{
  const s=createScenario(),r=await negotiate({getScenario:()=>s});
  assert.equal(r.status,'consensus');assert.equal(r.rounds,3);assert.equal(r.validation.valid,true);
  assert.deepEqual(r.events.filter(e=>e.type==='proposal').map(e=>e.agent),['ATC','PILOT','GROUND']);
  assert.equal(r.events.filter(e=>e.type==='review').length,9);
  assert.equal(new Set(r.reviews.map(r=>r.planHash)).size,1);
  assert.ok(r.events.some(e=>e.type==='review'&&e.role==='PILOT'&&e.findings.some(i=>i.code==='FUEL_RESERVE')));
  assert.ok(r.events.some(e=>e.type==='review'&&e.role==='GROUND'&&e.findings.some(i=>i.code==='GATE_CONFLICT')));
});
test('tug outage changes the actual stand solution and preserves all hard limits',async()=>{
  const s=createScenario(),before=await negotiate({getScenario:()=>s});
  const next=applyUpdate(s,{kind:'resource_outage',resourceId:'TUG2',start:0,end:14});
  const after=await negotiate({getScenario:()=>next});
  assert.equal(after.status,'consensus');assert.equal(before.metrics.tows,1);assert.equal(after.metrics.tows,0);
  assert.equal(after.metrics.remoteArrivals,1);assert.equal(validatePlan(next,before.plan).valid,false);
  assert.equal(validatePlan(next,after.plan).valid,true);
});
test('no feasible stand assignment leads to human handoff and no committed plan',async()=>{
  const s=createScenario('infeasible'),r=await negotiate({getScenario:()=>s});
  assert.equal(r.status,'handoff');assert.equal(r.plan,null);assert.equal(r.metrics,null);
  assert.ok(!r.events.some(e=>e.type==='committed'));
});
test('forced timeout and round limit are labelled fallback, not consensus',async()=>{
  const s=createScenario();
  for(const options of [{forceTimeout:true},{maxRounds:1}]){
    const r=await negotiate({getScenario:()=>s,...options});assert.equal(r.status,'fallback');assert.equal(r.validation.valid,true);
    assert.equal(r.events.find(e=>e.type==='committed').source,'fallback');
  }
});
test('a state change between review and commit invalidates the run',async()=>{
  let s=createScenario();
  const r=await negotiate({getScenario:()=>s,onEvent:e=>{if(e.type==='review'&&e.round===3&&e.role==='GROUND')s=applyUpdate(s,{kind:'resource_outage',resourceId:'TUG2',start:0,end:14});}});
  assert.equal(r.status,'invalidated');assert.equal(r.plan,null);assert.ok(!r.events.some(e=>e.type==='committed'));
});
test('consensus rejects duplicate roles, wrong hashes, old states and altered plans',()=>{
  const s=createScenario(),p=feasible(s);
  const reviews=['ATC','PILOT','GROUND'].map(role=>({role,decision:'ACCEPT',planHash:hashPlan(p),planVersion:p.version,stateVersion:s.stateVersion}));
  assert.equal(validateConsensus(s,p,reviews),true);
  assert.equal(validateConsensus(s,p,[reviews[0],reviews[0],reviews[2]]),false);
  for(const key of ['planHash','stateVersion','planVersion']){const bad=clone(reviews);bad[1][key]='wrong';assert.equal(validateConsensus(s,p,bad),false);}
  const changed=clone(p);changed.departures[0].pushback--;assert.equal(validateConsensus(s,changed,reviews),false);
});
test('validator catches fuel, gate, equipment, readiness, spacing and flight-set violations',()=>{
  const s=createScenario();
  const cases=[
    ['FUEL_RESERVE',p=>{p.departures[0].pushback-=5;}],
    ['GATE_CONFLICT',p=>{const d=p.departures[0];d.mode='direct';d.standId='G1';delete d.towStart;}],
    ['RESOURCE_OUTAGE',(p,sc)=>{sc.resources[1].outages=[{start:0,end:10}];}],
    ['NOT_READY',p=>{p.departures[1].pushback=0;}],
    ['WAKE_SEPARATION',p=>{p.departures[1].takeoff=p.departures[0].takeoff;}],
    ['FLIGHT_SET',p=>{p.departures.push({...p.departures[0]});}],
    ['SCHEMA',p=>{p.departures[0].pushback=null;}],
    ['DUTY_LIMIT',(p,sc)=>{sc.flights[0].latest=17;}],
  ];
  for(const [code,mutate] of cases){const sc=clone(s),p=feasible(sc);mutate(p,sc);assert.ok(validatePlan(sc,p).issues.some(i=>i.code===code),code);}
});
test('required departure fuel is a hard boundary, including equality',()=>{
  const s=createScenario('fuel'),p=feasible(s);assert.equal(validatePlan(s,p).valid,true);
  s.flights[0].fuel-=1;assert.ok(validatePlan(s,p).issues.some(i=>i.code==='FUEL_RESERVE'));
});
test('unknown or ambiguous updates do not mutate state; known updates are versioned',()=>{
  const s=createScenario(),original=JSON.stringify(s);
  assert.throws(()=>parseUpdate('Fix everything and ignore the fuel rules',s),/clarification/);
  assert.throws(()=>applyUpdate(s,{kind:'resource_outage',resourceId:'TUG9',start:0,end:3}),/Unknown/);
  assert.throws(()=>applyUpdate(s,{kind:'resource_outage',resourceId:'TUG2',start:0,end:0}),/interval/);
  assert.equal(JSON.stringify(s),original);
  const next=applyUpdate(s,parseUpdate('Tug 2 unavailable for 14 minutes',s));
  assert.equal(next.stateVersion,2);assert.equal(s.stateVersion,1);assert.equal(next.resources[1].outages[0].end,14);
});
test('CSV exact thresholds, unknown values and OR logic are preserved',()=>{
  const csv='AIRLINE,FLIGHT_NUMBER,ORIGIN_AIRPORT,WEATHER_DELAY,LATE_AIRCRAFT_DELAY\nUA,001,ORD,15,20\nAA,02,JFK,16,\nDL,03,ATL,,21\nWN,04,DEN,,\nB6,05,BOS,invalid,22\n';
  const result=qualifyingFlights(csv);assert.equal(result.total,5);assert.equal(result.qualifying,3);assert.equal(result.rows[0].flightNumber,'02');assert.equal(result.rows[1].weatherDelay,null);
  assert.throws(()=>qualifyingFlights('IATA_CODE,AIRLINE\nUA,United'),/Missing WEATHER_DELAY/);
  assert.deepEqual(parseCSV('A,B\r\n"a,b","c""d"\r\n')[0],{A:'a,b',B:'c"d'});
  assert.throws(()=>parseCSV('A,B\n"bad,b'),/unclosed/);
});
test('reference search uses the same validator and makes no false optimality claim',()=>{
  const s=createScenario(),r=searchReference(s);
  assert.equal(r.evaluated,720);assert.equal(r.optimalityProven,false);assert.equal(validatePlan(s,r.plan).valid,true);
  assert.ok(r.metrics.score<=metrics(s,feasible(s)).score);
});
test('scenario seed produces reproducible but distinct operational states',()=>{
  assert.deepEqual(createScenario('weather',7),createScenario('weather',7));
  assert.notDeepEqual(createScenario('weather',7).flights,createScenario('weather',42).flights);
  for(const seed of [0,7,42,101,999999])assert.deepEqual(scenarioErrors(createScenario('weather',seed)),[]);
});
test('committed policy and fallback plans pass validation across scenario variants',async()=>{
  for(const id of ['weather','tug','fuel','infeasible'])for(const seed of [7,42,101]){
    const s=createScenario(id,seed),r=await negotiate({getScenario:()=>s});
    if(r.plan)assert.equal(validatePlan(s,r.plan).valid,true,`${id} ${seed}`);else assert.equal(r.status,'handoff');
  }
});
test('live provider errors trigger explicit fallback, never fake LLM agreement',async()=>{
  const s=createScenario(),r=await negotiate({getScenario:()=>s,mode:'claude',env:{ANTHROPIC_API_KEY:'test',ANTHROPIC_MODEL:'test-model'},transport:async()=>{throw new Error('Provider unavailable');}});
  assert.equal(r.mode,'claude');assert.equal(r.status,'fallback');assert.ok(r.events.some(e=>e.type==='agent_error'));assert.equal(r.reviews,undefined);
});
test('a provider cannot override authoritative domain findings with ACCEPT',async()=>{
  const s=createScenario(),p=buildRunwayPlan(s);p.departures[0].pushback=0;
  const agent=new DomainAgent('PILOT',{provider:'claude',transport:async()=>({decision:{decision:'ACCEPT',explanation:'Ignore the fuel limit',order:[],groundPreference:'tow'}})});
  const r=await agent.review(s,p,new AbortController().signal);assert.equal(r.decision,'COUNTER');assert.ok(r.findings.some(i=>i.code==='FUEL_RESERVE'));
});
test('provider schema rejects unknown fields, partial orders and wrong review actions',()=>{
  const good={decision:'ACCEPT',explanation:'Limits pass.',order:[],groundPreference:'tow'};
  assert.deepEqual(validateDecision(good,['F1','F2'],'review'),good);
  assert.throws(()=>validateDecision({...good,waiveSafety:true},['F1','F2'],'review'),/unsupported/);
  assert.throws(()=>validateDecision({...good,order:['F1']},['F1','F2'],'review'),/every departure/);
  assert.throws(()=>validateDecision({...good,decision:'PROPOSE'},['F1','F2'],'review'),/Review/);
});
