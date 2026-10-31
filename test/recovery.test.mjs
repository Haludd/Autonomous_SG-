import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryScenario,buildRecoveryCandidates,validateRecovery,negotiateRecovery,chooseRecovery,recoveryMapPayload,wakeSeconds,flightIndex} from '../src/recovery.mjs';
import {recoveryArrivalAt,standIntervals} from '../public/jfk-replay.mjs';

test('historical trigger, synthetic limits and additional assumptions stay distinct',()=>{
 const s=createRecoveryScenario();assert.equal(flightIndex.totalRows,358774);assert.equal(flightIndex.jfkArrivalCount,6524);assert.equal(s.source.record.DESTINATION_AIRPORT,'JFK');assert.equal(s.capacity.gates,70);assert.equal(s.capacity.active_runways,3);assert.equal(s.capacity.max_runway_ops_per_hour,60);assert.equal(s.capacity.min_turnaround_min,35);assert.equal(s.target.finalReserve,1200);assert.equal(s.target.contingency,300);assert.ok(s.assumptions.some(a=>a.includes('baseline')||a.includes('Baseline')));
});
test('option identity binds the source row and assumptions, and a closed spare is replaced',()=>{
 const a=buildRecoveryCandidates(createRecoveryScenario()),b=buildRecoveryCandidates(createRecoveryScenario(1)),c=buildRecoveryCandidates(createRecoveryScenario(0,{arrivalFuel:2200}));assert.notEqual(a[0].hash,b[0].hash);assert.notEqual(a[0].hash,c[0].hash);
 const s=createRecoveryScenario(0,{closedStands:['G7']}),o=buildRecoveryCandidates(s)[0];assert.equal(o.plan.arrivals[0].standId,'G8');assert.ok(validateRecovery(s,o).valid);
});
test('three distinct validated strategies are ranked by actual independent acceptance',()=>{
 const p=negotiateRecovery(createRecoveryScenario());assert.equal(p.options.length,3);assert.equal(new Set(p.options.map(o=>o.hash)).size,3);assert.deepEqual(p.options.map(o=>o.id),['gate','sequence','hold']);assert.deepEqual(p.options.map(o=>o.accepted),[3,2,2]);assert.ok(p.options.every(o=>o.validation.valid));assert.equal(p.recommendedId,'gate');assert.equal(p.selectedId,null);assert.equal(p.options[1].consensus,false);
});
test('each turn has exactly one structured message per role, covering all options',()=>{
 const p=negotiateRecovery(createRecoveryScenario());assert.equal(p.turns,2);const messages=p.events.filter(e=>e.type==='agent_message');assert.equal(messages.length,6);
 for(let turn=1;turn<=p.turns;turn++){const group=messages.filter(m=>m.turn===turn);assert.equal(group.length,3);assert.equal(new Set(group.map(m=>m.role)).size,3);assert.equal(new Set(group.map(m=>m.portfolioHash)).size,1);for(const m of group){assert.equal(m.assessments.length,3);assert.ok(m.assessments.every(a=>a.stateVersion===p.stateVersion&&a.planHash));if(turn===2)assert.equal(m.peerPreferences.length,2);}}
});
test('fuel protects final reserve and contingency, including exact equality',()=>{
 for(const [fuel,valid] of [[2060,true],[2059,false]]){const s=createRecoveryScenario(0,{arrivalFuel:fuel}),o=buildRecoveryCandidates(s).find(o=>o.id==='hold');assert.equal(validateRecovery(s,o).issues.some(i=>i.code==='FUEL_RESERVE'),!valid);}
});
test('gate-change notice and minimum turnaround enforce their boundaries',()=>{
 const s=createRecoveryScenario(),o=buildRecoveryCandidates(s)[0];o.plan.arrivals[0].noticeAt=10;assert.ok(validateRecovery(s,o).valid);o.plan.arrivals[0].noticeAt=11;assert.ok(validateRecovery(s,o).issues.some(i=>i.code==='GATE_NOTICE'));o.plan.arrivals[0].noticeAt=0;o.plan.arrivals[0].clearAt=64;assert.ok(validateRecovery(s,o).issues.some(i=>i.code==='TURNAROUND'));
});
test('wake lookup uses both leader and follower with workbook fallback',()=>{
 assert.equal(wakeSeconds('H','M'),120);assert.equal(wakeSeconds('S','L'),180);assert.equal(wakeSeconds('M','L'),60);assert.equal(wakeSeconds('M','M'),60);
});
test('capacity, inactive runways, gate clashes and crew limits cannot be waived',()=>{
 const s=createRecoveryScenario(),o=buildRecoveryCandidates(s)[2];s.capacity={...s.capacity,max_runway_ops_per_hour:1};assert.ok(validateRecovery(s,o).issues.some(i=>i.code==='RUNWAY_CAPACITY'));
 const s2=createRecoveryScenario(),o2=buildRecoveryCandidates(s2)[0];o2.plan.arrivals[0].runway='13L';assert.ok(validateRecovery(s2,o2).issues.some(i=>i.code==='RUNWAY_CLOSED'));o2.plan.arrivals[0].runway='4R';o2.plan.arrivals[0].standId='G1';assert.ok(validateRecovery(s2,o2).issues.some(i=>i.code==='GATE_CONFLICT'));
 const s3=createRecoveryScenario();s3.target.crewDutyElapsed=780;assert.ok(validateRecovery(s3,buildRecoveryCandidates(s3)[0]).issues.some(i=>i.code==='CREW_DUTY'));
});
test('no consensus stops at nine messages, falls back explicitly, and blocks hard failures',()=>{
 const s=createRecoveryScenario(0,{closedStands:['G7','G8','G9']}),p=negotiateRecovery(s);assert.equal(p.status,'fallback');assert.equal(p.turns,3);assert.equal(p.events.filter(e=>e.type==='agent_message').length,9);assert.equal(p.recommendedId,'sequence');assert.throws(()=>chooseRecovery(s,p,{optionId:'gate',planHash:p.options.find(o=>o.id==='gate').hash,stateVersion:1}),/hard constraint/);
 const blocked=negotiateRecovery(createRecoveryScenario(0,{closedStands:['G7','G8','G9'],arrivalFuel:1500}));assert.equal(blocked.status,'handoff');assert.equal(blocked.recommendedId,null);
});
test('human choice records preference objections and rejects stale or altered plans',()=>{
 const s=createRecoveryScenario(),p=negotiateRecovery(s),o=p.options.find(o=>o.id==='hold'),request={optionId:o.id,planHash:o.hash,stateVersion:1};const chosen=chooseRecovery(s,p,request);assert.equal(chosen.source,'human_selected_validated_alternative');assert.equal(chosen.preferenceObjections.length,1);assert.throws(()=>chooseRecovery(s,p,{...request,stateVersion:2}),/outdated/);assert.throws(()=>chooseRecovery(s,p,{...request,planHash:'fake'}),/hash/);o.plan.arrivals[0].gateIn++;assert.throws(()=>chooseRecovery(s,p,request),/hash/);
});
test('timeout fallback does not invent agent acceptance or efficiency assessments',()=>{
 const p=negotiateRecovery(createRecoveryScenario(),{forceTimeout:true});assert.equal(p.status,'fallback');assert.equal(p.turns,0);assert.equal(p.events.filter(e=>e.type==='agent_message').length,0);assert.ok(p.options.every(o=>o.accepted===0&&o.assessments.length===0&&!o.consensus));
});
test('every map preview uses its option timings, route destination and exact occupancy',()=>{
 const s=createRecoveryScenario(),p=negotiateRecovery(s);for(const o of p.options){const data=recoveryMapPayload(s,o,p);assert.equal(data.recovery.hash,o.hash);assert.equal(data.scenario.arrivals[0].gateIn,o.plan.arrivals[0].gateIn);assert.equal(data.recovery.selected,false);const occ=standIntervals(data.scenario,data.plan).find(i=>i.id==='IN1');assert.equal(occ.stand,o.plan.arrivals[0].standId);assert.equal(occ.start,o.metrics.gateIn);assert.equal(occ.end,o.metrics.ready+2);}
});
test('arrival replay shows holding, gate taxi, turnaround and onward movement boundaries',()=>{
 const a={baselineLanding:26,landing:40,gateIn:44,ready:79,nextDeparture:85},g={approach:[[0,0],[10,10]],hold:[10,10],arrivalTaxi:[[10,10],[20,20]],gate:[20,20],departureTaxi:[[20,20],[30,30]],runway:[[30,30],[40,40]]};
 for(const [minute,phase] of [[0,'INBOUND'],[26,'HOLDING'],[39,'HOLDING'],[40,'ARRIVAL_TAXI'],[44,'TURNAROUND'],[79,'PUSHBACK'],[81,'TAXI'],[85,'DEPARTED']])assert.equal(recoveryArrivalAt(a,minute,g).phase,phase);assert.equal(recoveryArrivalAt(a,86,g).visible,false);
});

test('an option that strands a chained arrival is neither consensus nor ranked above one that does not',()=>{
 const s=createRecoveryScenario(),chain={gate:{groupSize:2,servePosition:1,blocked:1,selfBlocked:false,othersCost:1000,effects:[],order:['A','B']},sequence:{groupSize:2,servePosition:1,blocked:0,selfBlocked:false,othersCost:6,effects:[],order:['A','B']},hold:{groupSize:2,servePosition:1,blocked:0,selfBlocked:false,othersCost:6,effects:[],order:['A','B']}};
 const p=negotiateRecovery(s,{chain});assert.equal(p.options.find(o=>o.id==='gate').consensus,false);assert.notEqual(p.recommendedId,'gate');assert.equal(p.options.at(-1).id,'gate');assert.ok(p.events.at(-1).explanation.includes('Chain check'));
 assert.equal(negotiateRecovery(s).recommendedId,'gate');
});
