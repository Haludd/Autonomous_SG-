import test from 'node:test';
import assert from 'node:assert/strict';
import {samplePath,aircraftAt,recoveryArrivalAt,standIntervals,gateConflicts} from '../public/jfk-replay.mjs';
import {createScenario,buildRunwayPlan,deterministicFallback,validatePlan} from '../src/domain.mjs';

const geometry={gate:[0,0],remote:[10,10],tow:[[0,0],[10,0],[10,10]],taxi:[[10,10],[20,10],[20,30]],runway:[[20,30],[50,30]],towMinutes:4};
test('route sampling handles endpoints and follows accumulated path length',()=>{
  assert.deepEqual(samplePath([[0,0],[10,0],[10,10]],0),{x:0,y:0,heading:90});
  assert.equal(samplePath([[0,0],[10,0],[10,10]],.75).y,5);
  assert.equal(samplePath([[0,0],[10,0],[10,10]],2).y,10);
  assert.deepEqual(samplePath([[3,4]],.5),{x:3,y:4,heading:0});
});
test('replay phases follow the accepted tow, pushback and takeoff times',()=>{
  const s=createScenario(),p=deterministicFallback(s).plan,f=s.flights[0],d=p.departures[0];
  assert.equal(d.mode,'remote');
  assert.equal(aircraftAt(f,d,1,geometry).phase,'TOW');
  assert.equal(aircraftAt(f,d,5,geometry).phase,'REMOTE');
  assert.equal(aircraftAt(f,d,d.pushback+.5,geometry).phase,'PUSHBACK');
  assert.equal(aircraftAt(f,d,d.pushback+3,geometry).phase,'TAXI');
  assert.equal(aircraftAt(f,d,d.takeoff,geometry).phase,'DEPARTED');
  assert.equal(aircraftAt(f,d,d.takeoff+1,geometry).visible,false);
});
test('replay does not burn taxi fuel during an engine-off tow or remote hold',()=>{
  const s=createScenario(),p=deterministicFallback(s).plan,f=s.flights[0],d=p.departures[0];
  const tow=aircraftAt(f,d,2,geometry),hold=aircraftAt(f,d,5,geometry),taxi=aircraftAt(f,d,d.pushback+1,geometry);
  assert.equal(tow.fuelNow,f.fuel);assert.equal(hold.engineOn,0);assert.equal(taxi.fuelNow,f.fuel-f.fuelRate);
  assert.equal(aircraftAt(f,d,d.takeoff+20,geometry).fuelNow,f.fuel-(d.takeoff-d.pushback)*f.fuelRate);
});
test('draft rendering without an accepted departure stays at the gate',()=>{
  const s=createScenario(),f=s.flights[0];
  assert.equal(aircraftAt(f,null,40,geometry).phase,'GATE');
  assert.equal(aircraftAt(f,null,40,geometry).engineOn,0);
});
test('map occupancy and conflicts agree with authoritative plan checks',()=>{
  const s=createScenario(),draft=buildRunwayPlan(s),accepted=deterministicFallback(s).plan;
  assert.equal(gateConflicts(s,draft).length,1);assert.equal(gateConflicts(s,accepted).length,0);
  const mapped=standIntervals(s,accepted).map(i=>({stand:i.stand,start:i.start,end:i.end,flightId:i.id}));
  const checked=validatePlan(s,accepted).occupancy.map(({stand,start,end,flightId})=>({stand,start,end,flightId}));
  assert.deepEqual(mapped,checked);
});
test('default planning airport matches the displayed JFK schematic',()=>{
  assert.equal(createScenario().airport.code,'JFK');
});

test('missing map anchors hide replay positions while retaining operational phases and fuel',()=>{
  const s=createScenario(),p=deterministicFallback(s).plan,f=s.flights[0],d={...p.departures[0],mode:'direct'};
  const missing={gate:null,remote:null,tow:null,taxi:null,runway:geometry.runway,towMinutes:4};
  for(const minute of [0,d.pushback+.5,d.takeoff-.1]){
    const state=aircraftAt(f,d,minute,missing);
    assert.equal(state.visible,false);assert.equal(state.x,null);assert.equal(state.y,null);
    assert.equal(state.fuelNow,f.fuel-state.engineOn*f.fuelRate);
  }
  assert.equal(aircraftAt(f,d,d.takeoff,missing).visible,true);
  const arrival={baselineLanding:10,landing:12,gateIn:16,ready:50,nextDeparture:56};
  const phases=[[1,'INBOUND'],[11,'HOLDING'],[13,'ARRIVAL_TAXI'],[16,'TURNAROUND'],[51,'PUSHBACK'],[53,'TAXI'],[56,'DEPARTED']];
  for(const [minute,phase] of phases){
    const state=recoveryArrivalAt(arrival,minute,{approach:null,hold:null,arrivalTaxi:null,gate:null,departureTaxi:null,runway:null});
    assert.equal(state.phase,phase);assert.equal(state.visible,false);assert.equal(state.x,null);assert.equal(state.y,null);
  }
});
