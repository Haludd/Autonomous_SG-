import test from 'node:test';
import assert from 'node:assert/strict';
import {airportCatalog,gateCatalog,airportSummaries,getAirport,airportMapData} from '../src/airports.mjs';
import {createRecoveryScenario,negotiateRecovery,chooseRecovery,flightIndex} from '../src/recovery.mjs';
import {createAirportGeometry} from '../public/airport-geometry.mjs';
import {aircraftAt,recoveryArrivalAt} from '../public/jfk-replay.mjs';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

test('all 322 organizer airports have valid map coordinates and traceable sources',()=>{
  const airports=airportSummaries();assert.equal(airports.length,322);assert.equal(new Set(airports.map(airport=>airport.code)).size,322);
  assert.equal(airportCatalog.flightDatasetSha256,flightIndex.sha256);
  for(const airport of airports){
    assert.ok(Number.isFinite(airport.latitude)&&Math.abs(airport.latitude)<=90,airport.code);
    assert.ok(Number.isFinite(airport.longitude)&&Math.abs(airport.longitude)<=180,airport.code);
    assert.equal(airport.capacity.IATA_CODE,airport.code);
  }
  assert.equal(airportMapData('PBG').coordinateSource,'OurAirports');
  assert.ok(airportCatalog.sources.every(source=>source.license==='Public Domain'&&source.sha256.length===64));
});

test('airport examples remain qualifying arrivals at the selected destination',()=>{
  for(const airport of airportCatalog.airports)for(const {record,sourceRow} of airport.records){
    assert.equal(record.DESTINATION_AIRPORT,airport.code);
    assert.equal(record.CANCELLED,'0');assert.equal(record.DIVERTED,'0');
    assert.ok(Number(record.WEATHER_DELAY)>15||Number(record.LATE_AIRCRAFT_DELAY)>20);
    assert.ok(Number.isInteger(sourceRow)&&sourceRow>=2);
  }
  assert.equal(getAirport('JFK').records.length,100);
  assert.throws(()=>getAirport('ZZZ'),/organizer CSV/);
});

test('map-only airports do not fabricate eligible historical flights',()=>{
  for(const code of ['PPG','VEL']){
    assert.equal(getAirport(code).records.length,0);
    assert.ok(Number.isFinite(airportMapData(code).latitude));
    assert.throws(()=>createRecoveryScenario(0,{airportCode:code}),/indexed/);
  }
});

test('a small airport uses its own gate and runway limits instead of the JFK template',()=>{
  const scenario=createRecoveryScenario(0,{airportCode:'ABR'}),portfolio=negotiateRecovery(scenario);
  assert.equal(scenario.airport.code,'ABR');assert.equal(scenario.source.record.DESTINATION_AIRPORT,'ABR');
  assert.equal(scenario.capacity.gates,8);assert.equal(scenario.capacity.active_runways,1);
  assert.equal(scenario.stands.filter(stand=>stand.type==='gate').length,8);
  assert.equal(scenario.spareGateIds.length,2);assert.equal(scenario.activeRunways.length,1);
  assert.ok(portfolio.options.find(option=>option.id===portfolio.recommendedId).validation.valid);
});

test('all airports with eligible arrivals can produce a fully validated recommendation',()=>{
  for(const airport of airportCatalog.airports.filter(airport=>airport.records.length)){
    const scenario=createRecoveryScenario(0,{airportCode:airport.code}),portfolio=negotiateRecovery(scenario);
    assert.ok(portfolio.recommendedId,airport.code);
    assert.ok(portfolio.options.find(option=>option.id===portfolio.recommendedId).validation.valid,airport.code);
    assert.ok(scenario.activeRunways.length<=scenario.capacity.active_runways,airport.code);
  }
});

test('changing airports invalidates plan identity even when the state version is the same',()=>{
  const jfk=createRecoveryScenario(),ord=createRecoveryScenario(0,{airportCode:'ORD'});
  const portfolio=negotiateRecovery(jfk),option=portfolio.options[0];
  assert.throws(()=>chooseRecovery(ord,portfolio,{optionId:option.id,planHash:option.hash,stateVersion:1}),/hash/);
});

test('runway projection preserves real endpoint coordinates',()=>{
  for(const code of ['JFK','LAX','ORD','ANC','ADK']){
    const airport=airportMapData(code),geometry=createAirportGeometry(airport);
    for(const runway of airport.runways)for(const point of [runway.start,runway.end]){
      const roundtrip=geometry.unproject(geometry.project(point));
      assert.ok(Math.abs(point[0]-roundtrip[0])<1e-8);assert.ok(Math.abs(point[1]-roundtrip[1])<1e-8);
    }
  }
});

test('gate aliases at every airport preserve source coordinates with no duplicate node assignments',()=>{
  const ids=new Set();
  assert.equal(gateCatalog.source.license,'ODbL-1.0');
  assert.equal(gateCatalog.airportCatalogSha256,createHash('sha256').update(readFileSync(new URL('../data/airport-catalog.json',import.meta.url))).digest('hex'));
  for(const airport of airportCatalog.airports){
    const mapped=airportMapData(airport.code),geometry=createAirportGeometry(mapped);
    for(const gate of mapped.gates){
      assert.ok(!ids.has(gate.osmId));ids.add(gate.osmId);
      assert.ok(Number.isFinite(gate.latitude)&&Number.isFinite(gate.longitude));
      assert.ok(gate.distanceFromAirportM<=5000);
      assert.equal(gate.sourceUrl,`https://www.openstreetmap.org/${gate.osmId}`);
    }
    const bound=Object.values(mapped.gateBindings).filter(Boolean);
    assert.equal(new Set(bound.map(gate=>gate.osmId)).size,bound.length);
    assert.equal(mapped.gateCoverage.mappedStandCount,bound.length);
    for(const [alias,gate] of Object.entries(mapped.gateBindings)){
      if(!gate){assert.equal(geometry.stand(alias),null);continue;}
      assert.deepEqual(gate,mapped.gates.find(source=>source.osmId===gate.osmId));
      const [lat,lng]=geometry.unproject(geometry.stand(alias));
      assert.ok(Math.abs(lat-gate.latitude)<1e-10,`${airport.code} ${alias} latitude`);
      assert.ok(Math.abs(lng-gate.longitude)<1e-10,`${airport.code} ${alias} longitude`);
    }
  }
  assert.equal(ids.size,5851);
});

test('replay arrival and departure at a gate share the source marker anchor across airports',()=>{
  const anchors=[];
  for(const code of ['JFK','LAX','LAS','ORD','ANC']){
    const scenario=createRecoveryScenario(0,{airportCode:code}),portfolio=negotiateRecovery(scenario);
    const option=portfolio.options.find(item=>item.id==='gate');
    const geometry=createAirportGeometry(scenario.mapData),assignment=option.plan.arrivals[0];
    const shape=geometry.arrival({scenario,plan:option.plan});
    const arrival=recoveryArrivalAt({baselineLanding:0,landing:assignment.landing,gateIn:assignment.gateIn,ready:option.metrics.ready,nextDeparture:option.plan.nextDeparture},assignment.gateIn,shape);
    assert.equal(arrival.visible,true);assert.equal(arrival.phase,'TURNAROUND');
    assert.deepEqual([arrival.x,arrival.y],geometry.stand(assignment.standId));
    const flight=scenario.flights[0],departure=option.plan.departures.find(item=>item.flightId===flight.id);
    const parked=aircraftAt(flight,departure,0,geometry.departure(flight,departure));
    assert.deepEqual([parked.x,parked.y],geometry.stand(flight.gate));
    anchors.push(geometry.unproject(geometry.stand('G1')));
  }
  assert.equal(new Set(anchors.map(anchor=>JSON.stringify(anchor))).size,anchors.length);
});

test('missing gate and runway coordinates never generate guessed geographic positions',()=>{
  const empty=airportMapData('ADK'),geometry=createAirportGeometry(empty);
  assert.equal(empty.gates.length,0);assert.equal(geometry.stand('G1'),null);
  const shape=geometry.departure({gate:'G1'},null);
  assert.equal(shape.gate,null);assert.equal(shape.taxi,null);assert.equal(shape.remote,null);
  const parked=aircraftAt({gate:'G1'},null,0,shape);
  assert.equal(parked.visible,false);assert.equal(parked.x,null);assert.equal(parked.y,null);
  const partial=airportMapData('ECP');
  assert.ok(partial.gateCoverage.mappedStandCount>0);assert.ok(partial.gateCoverage.unmappedStandIds.length>0);
  assert.equal(createAirportGeometry(partial).runwayFor('1'),null);
  for(const id of partial.gateCoverage.unmappedStandIds)assert.equal(createAirportGeometry(partial).stand(id),null);
});

test('runway names with a leading zero and reciprocal directions bind the correct real geometry',()=>{
  const airport=airportMapData('JFK'),geometry=createAirportGeometry(airport);
  const source=airport.runways.find(runway=>runway.lowIdent==='04L');assert.ok(source);
  assert.deepEqual(geometry.unproject(geometry.runwayFor('4L').start),source.start);
  assert.deepEqual(geometry.unproject(geometry.runwayFor('22R').start),source.end);
});
