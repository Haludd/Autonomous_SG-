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

test('live recovery streams real role responses, locks mutations and exports no credentials',async()=>{
 const roles=['ATC','PILOT','GROUND'],saved={};
 for(const role of roles)for(const suffix of ['API_KEY','MODEL']){const name=`${role}_ANTHROPIC_${suffix}`;saved[name]=process.env[name];process.env[name]=suffix==='API_KEY'?`${role}-private`:'test-model';}
 const nativeFetch=globalThis.fetch;let unlock;const gate=new Promise(resolve=>unlock=resolve);const keys=[];
 globalThis.fetch=async(url,init)=>{
  if(url!=='https://api.anthropic.com/v1/messages')return nativeFetch(url,init);
  keys.push(init.headers['x-api-key']);await gate;
  const payload=JSON.parse(JSON.parse(init.body).messages[0].content);
  return new Response(JSON.stringify({stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:20},content:[{type:'text',text:JSON.stringify({stateVersion:payload.stateVersion,preferredOptionId:'gate',assessments:payload.options.map(o=>({optionId:o.id,planHash:o.hash,decision:'ACCEPT',explanation:'Reviewed independently.'}))})}]}),{status:200});
 };
 try{
  const cfg=await(await fetch(origin+'/api/recovery')).json();assert.equal(cfg.live.available,true);assert.ok(!JSON.stringify(cfg).includes('private'));
  const s=await(await post('/api/recovery',{})).json();const response=await post(`/api/recovery/${s.id}/run`,{});
  assert.match(response.headers.get('content-type'),/text\/event-stream/);
  assert.equal((await post(`/api/recovery/${s.id}/compare`,{})).status,409);assert.equal((await post(`/api/recovery/${s.id}/choose`,{})).status,409);assert.equal((await post(`/api/recovery/${s.id}/run`,{})).status,409);
  unlock();const stream=await response.text();assert.match(stream,/event: progress/);assert.match(stream,/event: result/);assert.ok(!stream.includes('private'));
  assert.equal(keys.length,6);assert.equal(new Set(keys).size,3);
  const current=await(await fetch(`${origin}/api/recovery/${s.id}`)).json();assert.equal(current.running,false);assert.equal(current.portfolio.mode,'live');assert.equal(current.portfolio.status,'consensus');
  const o=current.portfolio.options[0];assert.equal((await post(`/api/recovery/${s.id}/choose`,{optionId:o.id,planHash:o.hash,stateVersion:1})).status,200);
  const audit=await(await fetch(`${origin}/api/recovery/${s.id}/export`)).text();assert.ok(audit.includes('test-model'));assert.ok(!audit.includes('private'));
 }finally{unlock();globalThis.fetch=nativeFetch;for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
