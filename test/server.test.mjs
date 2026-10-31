import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {server} from '../src/server.mjs';
let origin;
before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
async function post(route,data,extra={}){return fetch(origin+route,{method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(data)});}
async function session(scenarioId='weather'){const r=await post('/api/sessions',{scenarioId});assert.equal(r.status,201);return r.json();}
test('config reveals capabilities and lookup counts, never keys',async()=>{const c=await(await fetch(origin+'/api/config')).json();assert.equal(c.lookups.airports,322);assert.equal(c.lookups.airlines,14);assert.ok(!JSON.stringify(c).includes('API_KEY'));});
test('API streams a committed version and exposes an audit export',async()=>{
  const s=await session();const r=await post(`/api/sessions/${s.id}/run`,{mode:'policy'});assert.equal(r.status,200);assert.ok(r.headers.get('content-type').includes('text/event-stream'));
  const text=await r.text();assert.ok(text.includes('event: result'));assert.ok(text.includes('"status":"consensus"'));
  const current=await(await fetch(`${origin}/api/sessions/${s.id}`)).json();assert.equal(current.running,false);assert.equal(current.result.validation.valid,true);
  const audit=await(await fetch(`${origin}/api/sessions/${s.id}/export`)).json();assert.equal(audit.runs.length,1);assert.equal(audit.runs[0].scenario.stateVersion,1);
});
test('API update invalidates result and preserves the old run snapshot',async()=>{
  const s=await session();await(await post(`/api/sessions/${s.id}/run`,{})).text();
  const response=await post(`/api/sessions/${s.id}/update`,{text:'Tug 2 unavailable for 14 minutes'});assert.equal(response.status,200);
  const updated=await response.json();assert.equal(updated.scenario.stateVersion,2);assert.equal(updated.result,null);
  const audit=await(await fetch(`${origin}/api/sessions/${s.id}/export`)).json();assert.equal(audit.runs[0].scenario.stateVersion,1);assert.equal(audit.audit[0].stateVersion,2);
});
test('malformed updates leave state untouched and cross-origin writes are rejected',async()=>{
  const s=await session();const r=await post(`/api/sessions/${s.id}/update`,{text:'Make the aircraft fly faster'});assert.equal(r.status,400);
  const unchanged=await(await fetch(`${origin}/api/sessions/${s.id}`)).json();assert.equal(unchanged.scenario.stateVersion,1);
  const cross=await post('/api/sessions',{}, {origin:'https://untrusted.example'});assert.equal(cross.status,403);
});
test('historical import uses exact qualification and does not fabricate operational state',async()=>{
  const s=await session();
  const csv='AIRLINE,FLIGHT_NUMBER,ORIGIN_AIRPORT,WEATHER_DELAY,LATE_AIRCRAFT_DELAY\nUA,007,JFK,16,0\nUA,008,ORD,15,20\n';
  const imported=await(await post(`/api/sessions/${s.id}/import`,{csv})).json();assert.equal(imported.qualifying,1);
  const selected=await(await post(`/api/sessions/${s.id}/trigger`,{index:0})).json();assert.equal(selected.scenario.airport.code,'JFK');assert.equal(selected.scenario.provenance.type,'historical_trigger');assert.deepEqual(selected.scenario.slots,s.scenario.slots);
  assert.equal(selected.scenario.flights[0].callsign,'UA 007');assert.equal(selected.result,null);
});
test('infeasible model returns handoff through SSE and no plan in the session',async()=>{
  const s=await session('infeasible');const text=await(await post(`/api/sessions/${s.id}/run`,{})).text();assert.ok(text.includes('"status":"handoff"'));
  const current=await(await fetch(`${origin}/api/sessions/${s.id}`)).json();assert.equal(current.result.plan,null);
});

test('linked airfield assets load and embedding is limited to same-origin map pages',async()=>{
  for(const path of ['/jfk-plan.html','/jfk-demo.html']){
    const r=await fetch(origin+path);assert.equal(r.status,200);
    assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'self'/);
    assert.match(await r.text(),/JFK/);
  }
  const main=await fetch(origin+'/');assert.match(main.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  for(const path of ['/jfk-plan.js','/jfk-demo.js','/jfk-replay.mjs','/jfk-base.css','/jfk-connected.css','/airfield-theme.css'])assert.equal((await fetch(origin+path)).status,200);
});
test('recovery API returns ranked options, map previews and a separate human choice',async()=>{
 const config=await(await fetch(origin+'/api/recovery')).json();assert.equal(config.dataset.rows,358774);assert.equal(config.flights.length,100);
 const created=await(await post('/api/recovery',{index:0})).json();assert.equal(created.portfolio,null);
 const result=await(await post(`/api/recovery/${created.id}/compare`,{})).json();assert.equal(result.selection,null);assert.equal(result.portfolio.options.length,3);assert.equal(result.portfolio.turns,2);assert.deepEqual(result.portfolio.options.map(o=>o.accepted),[3,2,2]);
 for(const o of result.portfolio.options){assert.equal(result.maps[o.id].recovery.hash,o.hash);assert.equal(o.assessments.length,3);assert.deepEqual(o.assessments.map(a=>a.role),['ATC','PILOT','GROUND']);}
 const o=result.portfolio.options.find(o=>o.id==='hold');
 const chosen=await(await post(`/api/recovery/${created.id}/choose`,{optionId:o.id,planHash:o.hash,stateVersion:1})).json();assert.equal(chosen.selection.source,'human_selected_validated_alternative');assert.equal(chosen.maps.hold.recovery.selected,true);
 const audit=await(await fetch(`${origin}/api/recovery/${created.id}/export`)).json();assert.equal(audit.audit.length,2);assert.equal(audit.scenario.source.sourceRow,340659);
 const stale=await post(`/api/recovery/${created.id}/choose`,{optionId:o.id,planHash:o.hash,stateVersion:2});assert.equal(stale.status,400);
});
test('recovery rejects a hard-constraint override and resets choice on new comparison',async()=>{
 const created=await(await post('/api/recovery',{closedStands:['G7','G8','G9']})).json();
 const result=await(await post(`/api/recovery/${created.id}/compare`,{})).json();assert.equal(result.portfolio.status,'fallback');
 const bad=result.portfolio.options.find(o=>o.id==='gate');assert.equal((await post(`/api/recovery/${created.id}/choose`,{optionId:bad.id,planHash:bad.hash,stateVersion:1})).status,400);
 const valid=result.portfolio.options[0];await post(`/api/recovery/${created.id}/choose`,{optionId:valid.id,planHash:valid.hash,stateVersion:1});
 const rerun=await(await post(`/api/recovery/${created.id}/compare`,{forceTimeout:true})).json();assert.equal(rerun.selection,null);assert.equal(rerun.portfolio.turns,0);assert.equal(rerun.portfolio.options[0].assessments.length,0);
});

test('airport catalog, per-airport examples and geographic map assets are served',async()=>{
 const airports=await(await fetch(origin+'/api/airports')).json();assert.equal(airports.airports.length,322);
 const lax=await(await fetch(origin+'/api/recovery?airport=LAX')).json();assert.equal(lax.airport.code,'LAX');assert.equal(lax.limits.IATA_CODE,'LAX');assert.ok(lax.flights.every(f=>f.DESTINATION_AIRPORT==='LAX'));
 const created=await(await post('/api/recovery',{airportCode:'LAX',index:0})).json();assert.equal(created.scenario.airport.code,'LAX');assert.equal(created.scenario.mapData.code,'LAX');
 assert.ok(created.scenario.mapData.gates.length>0);
 assert.deepEqual(created.scenario.mapData.gateBindings,lax.airport.gateBindings);
 assert.equal(created.scenario.mapData.gateCoverage.mappedStandCount,9);
 assert.equal(created.scenario.mapData.gateSource.license,'ODbL-1.0');
 const compared=await(await post(`/api/recovery/${created.id}/compare`,{})).json();assert.ok(compared.portfolio.recommendedId);
 for(const payload of Object.values(compared.maps))assert.deepEqual(payload.scenario.mapData.gateBindings,lax.airport.gateBindings);
 const missing=await(await fetch(origin+'/api/airports/ADK')).json();assert.equal(missing.gates.length,0);assert.equal(missing.gateBindings.G1,null);
 assert.equal((await fetch(origin+'/api/recovery?airport=ZZZ')).status,400);
 const ppg=await(await fetch(origin+'/api/recovery?airport=PPG')).json();assert.equal(ppg.flights.length,0);assert.ok(ppg.airport.latitude);
 for(const asset of ['/airport-map.html','/airport-map.js','/airport-map.css','/airport-geometry.mjs','/vendor/leaflet/leaflet.js','/vendor/leaflet/leaflet.css'])assert.equal((await fetch(origin+asset)).status,200);
 const html=await fetch(origin+'/airport-map.html');assert.match(html.headers.get('content-security-policy'),/https:\/\/tile.openstreetmap.org/);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'self'/);
 const home=await fetch(origin+'/');assert.ok(!home.headers.get('content-security-policy').includes('tile.openstreetmap.org'));
});

test('collision evaluation retains chain impact in previews, selection and audit exports',async()=>{
 const solo=await(await post('/api/recovery',{index:0})).json();assert.equal(solo.chain,null);
 const created=await(await post('/api/recovery',{index:36})).json();
 assert.deepEqual(created.chain.group.map(g=>g.id),['B6 717','B6 584']);assert.equal(created.chain.group.filter(g=>g.self).length,1);
 const result=await(await post(`/api/recovery/${created.id}/compare`,{})).json();
 for(const option of result.portfolio.options){assert.equal(option.chain.groupSize,2);assert.ok(option.chain.effects.some(effect=>effect.startsWith('B6 717: passes')));}
 assert.match(result.portfolio.events.at(-1).explanation,/Chain check/);
 const option=result.portfolio.options[0];
 const chosen=await(await post(`/api/recovery/${created.id}/choose`,{optionId:option.id,planHash:option.hash,stateVersion:1})).json();assert.deepEqual(chosen.selection.chain,option.chain);
 const audit=await(await fetch(`${origin}/api/recovery/${created.id}/export`)).json();assert.deepEqual(audit.selection.chain,option.chain);assert.equal(audit.chain.airportCode,'JFK');
});

test('collision stress mode is airport-scoped and invalidates old plan hashes',async()=>{
 const base=await(await post('/api/recovery',{airportCode:'LAX',index:0})).json();
 const old=await(await post(`/api/recovery/${base.id}/compare`,{})).json();
 const stress=await(await post('/api/recovery',{airportCode:'LAX',index:0,stress:true})).json();
 assert.equal(stress.chain.airportCode,'LAX');assert.ok(stress.chain.group.every(g=>g.airportCode==='LAX'));assert.equal(stress.chain.group.filter(g=>g.retimed).length,3);
 assert.match(stress.chain.note,/not a historical event/);assert.match(stress.chain.note,/simulated/);
 const result=await(await post(`/api/recovery/${stress.id}/compare`,{})).json();
 assert.ok(result.portfolio.options.some(option=>option.chain));assert.equal(result.scenario.mapData.code,'LAX');
 const stale=old.portfolio.options[0];assert.equal((await post(`/api/recovery/${stress.id}/choose`,{optionId:stale.id,planHash:stale.hash,stateVersion:1})).status,400);
 const html=await(await fetch(origin+'/')).text();assert.match(html,/id="stress-chain"/);assert.match(html,/id="collisions"/);assert.match(html,/id="airport-select"/);assert.match(html,/id="expand"/);
 assert.equal((await fetch(origin+'/collision-triage.css')).status,200);
});
