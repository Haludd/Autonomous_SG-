import test from 'node:test';
import assert from 'node:assert/strict';
import {simulate,searchChains,chainContext,chainImpact,retime} from '../src/chain.mjs';
import {createRecoveryScenario} from '../src/recovery.mjs';

const opt=(id,o={})=>({id,title:id,valid:true,standId:o.spare?'G7':'G1',spare:false,landing:10,gateIn:14,clear:51,onward:57,cost:0,fuelMargin:500,crewMargin:100,...o});
const flight=(id,priority,options,o={})=>({id,index:0,tier:4,priority,holdingRate:40,options,onward:null,...o});

test('a taken landing minute slips the later flight and the slip costs delay plus holding fuel',()=>{
 const r=simulate([flight('A',1,[opt('only')]),flight('B',2,[opt('only')])]);
 assert.equal(r.plans[0].slip,0);assert.equal(r.plans[1].slip,1);assert.equal(r.plans[1].gateIn,15);assert.equal(r.total,2);
});
test('a slipped flight that cannot afford the extra hold is handed to a human',()=>{
 const r=simulate([flight('A',1,[opt('only')]),flight('B',2,[opt('only',{fuelMargin:30})])]);
 assert.equal(r.plans[1].option,null);assert.equal(r.plans[1].cost,1000);
});
test('an onward flight on the same tail inherits the delay past its scheduled departure',()=>{
 const r=simulate([flight('A',1,[opt('only')],{onward:{id:'X 1',to:'BOS',sched:50}})]);
 assert.equal(r.plans[0].onwardDelay,7);assert.equal(r.plans[0].onwardFlight,'X 1');assert.equal(r.total,7);
 assert.equal(simulate([flight('A',1,[opt('only')],{onward:{id:'X 1',to:'BOS',sched:90}})]).plans[0].onwardDelay,0);
});
test('serving the other flight first is chosen when a scarce spare gate would otherwise cascade',()=>{
 const A=flight('A',1,[opt('gate',{spare:true}),opt('hold',{cost:14})]),B=flight('B',2,[opt('gate',{spare:true,landing:20,gateIn:24,clear:61,onward:67}),opt('hold',{cost:30,landing:20,gateIn:24,clear:61,onward:67})]);
 const r=searchChains([A,B],{spareGates:1});
 assert.deepEqual(r.urgencyOrder,['A','B']);assert.deepEqual(r.order,['B','A']);assert.equal(r.reordered,true);assert.equal(r.urgencyTotal,30);assert.equal(r.total,14);assert.equal(r.saved,16);
 assert.ok(r.effects.some(e=>e.startsWith('A: spare gates were already taken')));
 assert.equal(searchChains([A,B],{spareGates:2}).reordered,false);
});
test('safety tiers are never reordered to save cost',()=>{
 const A=flight('A',1,[opt('gate',{spare:true}),opt('hold',{cost:14})],{tier:1}),B=flight('B',2,[opt('gate',{spare:true,landing:20,gateIn:24,clear:61,onward:67}),opt('hold',{cost:30,landing:20,gateIn:24,clear:61,onward:67})]);
 const r=searchChains([A,B],{spareGates:1});assert.deepEqual(r.order,['A','B']);assert.equal(r.reordered,false);assert.equal(r.saved,0);
});
test('retiming moves a whole timeline, including the onward flight, by the same amount',()=>{
 const e={eta:100,options:[opt('o',{landing:90,gateIn:94,clear:131,onward:137})],onward:{id:'X',to:'Y',sched:120}},r=retime(e,130);
 assert.deepEqual([r.eta,r.retimed,r.options[0].landing,r.options[0].onward,r.onward.sched],[130,30,120,167,150]);
});
test('a chain follows overlapping claims, not an hour bucket',()=>{
 const ctx=chainContext(36,createRecoveryScenario(36));assert.deepEqual(ctx.entries.map(e=>e.id),['B6 717','B6 584']);assert.equal(ctx.spareGates,3);
 assert.equal(chainContext(0,createRecoveryScenario(0)),null);
 const far=chainContext(0,createRecoveryScenario(0),{stress:true});assert.equal(far.entries.length,4);assert.ok(far.entries.filter(e=>e.retimed).length===3);
});
test('per-option impact carries the order, the knock-on and who is left without an option',()=>{
 const s=createRecoveryScenario(36),impact=chainImpact(chainContext(36,s));
 assert.deepEqual(Object.keys(impact),['gate','sequence','hold']);assert.ok(impact.gate.effects.includes('B6 717: passes 22 min to B6 1501 to FLL.'));assert.equal(impact.gate.servePosition,1);assert.equal(impact.gate.blocked,0);
 const closed=createRecoveryScenario(0,{closedStands:['G7','G8','G9']}),none=chainImpact(chainContext(0,closed,{stress:true}));
 assert.equal(none.gate,undefined);assert.ok(none.sequence.groupSize===4);
});
test('the stress test makes spare gates scarce, so the serving order is reordered',()=>{
 const s=createRecoveryScenario(0,{closedStands:['G7','G8']}),ctx=chainContext(0,s,{stress:true});assert.equal(ctx.spareGates,1);
 const gate=chainImpact(ctx).gate;assert.ok(gate.effects.some(e=>e.includes('spare gates were already taken')));
});
