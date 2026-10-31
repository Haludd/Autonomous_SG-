import test from 'node:test';
import assert from 'node:assert/strict';
import {triageTarget,triageTier,prioritiseCollisions} from '../src/triage.mjs';

test('default assumptions give every flight the same slack, so ETA decides',()=>{
 const t=triageTarget(0);assert.equal(t.fuelSlack,15);assert.equal(t.crewSlack,19);assert.equal(t.gateWait,14);assert.equal(t.needsSpareGate,false);assert.equal(triageTier(t),2);
});
test('tiers: exhausted fuel, then fuel, crew, forced spare gate, routine',()=>{
 const base={fuelSlack:15,crewSlack:60,gateWait:14,needsSpareGate:false};
 assert.equal(triageTier({...base,fuelSlack:0}),0);assert.equal(triageTier({...base,fuelSlack:9.9}),1);assert.equal(triageTier({...base,fuelSlack:10}),4);
 assert.equal(triageTier({...base,crewSlack:29}),2);assert.equal(triageTier({...base,needsSpareGate:true}),3);assert.equal(triageTier(base),4);
});
test('safety outranks arrival order, and slack breaks ties inside a tier',()=>{
 const mk=(sourceRow,eta,o)=>({sourceRow,eta,id:`F${sourceRow}`,fuelSlack:15,crewSlack:60,gateWait:14,needsSpareGate:false,...o});
 const ranked=prioritiseCollisions([mk(1,0),mk(2,5,{fuelSlack:8}),mk(3,10,{fuelSlack:3}),mk(4,2,{crewSlack:20})]);
 assert.deepEqual(ranked.map(r=>r.sourceRow),[3,2,4,1]);assert.deepEqual(ranked.map(r=>r.tierName),['FUEL','FUEL','CREW','ROUTINE']);
 assert.deepEqual(prioritiseCollisions([mk(1,5),mk(2,0)]).map(r=>r.sourceRow),[2,1]);
});
test('scarce spare gates go in priority order and run out',()=>{
 const mk=(sourceRow,fuelSlack)=>({sourceRow,eta:sourceRow,id:`F${sourceRow}`,fuelSlack,crewSlack:60,gateWait:14,needsSpareGate:fuelSlack<14});
 const ranked=prioritiseCollisions([mk(1,12),mk(2,5),mk(3,11),mk(4,13),mk(5,20)],{spareGates:3});
 assert.deepEqual(ranked.map(r=>[r.sourceRow,r.spareGate]),[[2,'granted'],[3,'granted'],[1,'granted'],[4,'denied'],[5,'not needed']]);
 assert.ok(ranked.every((r,i)=>r.priority===i+1));
});
