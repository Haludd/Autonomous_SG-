import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryScenario,chooseRecovery} from '../src/recovery.mjs';
import {negotiateLiveRecovery,callRecoveryClaude,liveRecoveryConfig,LIVE_ROLES} from '../src/live-recovery.mjs';
import {chainContext,chainImpact} from '../src/chain.mjs';
const env=Object.fromEntries(LIVE_ROLES.flatMap(r=>[[`${r}_ANTHROPIC_API_KEY`,`${r}-private`],[`${r}_ANTHROPIC_MODEL`,'test-model']]));
function response(payload){return {decision:{stateVersion:payload.stateVersion,preferredOptionId:'gate',assessments:payload.options.map(o=>({optionId:o.id,planHash:o.hash,decision:'ACCEPT',explanation:`${payload.role} independently reviewed ${o.id}.`}))},usage:{input_tokens:100,output_tokens:80}};}
test('role credentials and histories remain isolated; peers arrive only from previous rounds',async()=>{
 const seen=[];const result=await negotiateLiveRecovery(createRecoveryScenario(),{env,transport:async request=>{seen.push(structuredClone({...request,signal:undefined}));return response(request.payload);}});
 assert.equal(result.status,'consensus');assert.equal(result.mode,'live');assert.equal(seen.length,6);
 for(const role of LIVE_ROLES){const calls=seen.filter(c=>c.role===role);assert.ok(calls.every(c=>c.key===`${role}-private`));assert.equal(calls[0].payload.history.length,0);assert.equal(calls[1].payload.history.length,1);assert.equal(calls[1].payload.peerMessages.length,2);assert.ok(calls[1].payload.peerMessages.every(m=>m.role!==role));}
 assert.deepEqual(result.options.map(o=>o.accepted),[3,2,2]);assert.ok(result.events.filter(e=>e.type==='agent_message').every(e=>e.provider==='anthropic'&&e.usage.output_tokens===80));assert.ok(!JSON.stringify(result).includes('private'));
});
test('three-round disagreement stops at nine requests and uses deterministic fallback',async()=>{
 let calls=0;const p=await negotiateLiveRecovery(createRecoveryScenario(),{env,transport:async({payload})=>{calls++;const r=response(payload);r.decision.preferredOptionId=null;r.decision.assessments.forEach(a=>a.decision='COUNTER');return r;}});
 assert.equal(calls,9);assert.equal(p.status,'fallback');assert.ok(p.options.every(o=>!o.consensus));
});
test('provider errors retain real partial votes, sanitize errors and never create consensus',async()=>{
 const p=await negotiateLiveRecovery(createRecoveryScenario(),{env,transport:async({role,payload})=>{if(role==='PILOT')throw new Error('PILOT-private');return response(payload);}});
 assert.equal(p.status,'fallback');assert.equal(p.events.filter(e=>e.type==='agent_message').length,2);assert.ok(p.options.every(o=>o.assessments.length===2&&!o.consensus));assert.ok(!JSON.stringify(p).includes('private'));
});
test('malformed and stale responses are rejected rather than counted as acceptance',async()=>{
 for(const mutate of [d=>d.stateVersion++,d=>d.assessments[0].planHash='wrong',d=>d.assessments.pop(),d=>d.assessments[1]=d.assessments[0],d=>d.assessments[0].decision='INVALID']){
 const p=await negotiateLiveRecovery(createRecoveryScenario(),{env,transport:async({payload})=>{const r=response(payload);mutate(r.decision);return r;}});assert.equal(p.status,'fallback');assert.equal(p.events.filter(e=>e.type==='agent_message').length,0);
 }
});
test('model ACCEPT cannot override hard limits or efficiency threshold',async()=>{
 const s=createRecoveryScenario(0,{closedStands:['G7','G8','G9']}),p=await negotiateLiveRecovery(s,{env,transport:async({payload})=>response(payload)});
 const gate=p.options.find(o=>o.id==='gate');assert.equal(gate.validation.valid,false);assert.ok(gate.assessments.some(a=>a.decision==='VETO'));assert.throws(()=>chooseRecovery(s,p,{optionId:gate.id,planHash:gate.hash,stateVersion:s.stateVersion}),/hard constraint/);
});
test('timeouts bound even an unresponsive transport; external cancellation does not return selectable plans',async()=>{
 const keepAlive=setInterval(()=>{},100);
 try{const p=await negotiateLiveRecovery(createRecoveryScenario(),{env,requestTimeoutMs:10,transport:()=>new Promise(()=>{})});assert.equal(p.status,'fallback');assert.equal(p.events.filter(e=>e.type==='agent_message').length,0);
 const c=new AbortController();c.abort();await assert.rejects(negotiateLiveRecovery(createRecoveryScenario(),{env,signal:c.signal}),{name:'AbortError'});
 }finally{clearInterval(keepAlive);}
});
test('all roles need explicit credentials; public configuration contains no secrets',async()=>{
 assert.equal(liveRecoveryConfig({ANTHROPIC_API_KEY:'shared',ANTHROPIC_MODEL:'shared'}).available,false);
 await assert.rejects(negotiateLiveRecovery(createRecoveryScenario(),{env:{...env,PILOT_ANTHROPIC_API_KEY:''}}),/separate API key/);
 assert.ok(!JSON.stringify(liveRecoveryConfig(env)).includes('private'));
});
test('Claude transport sends role-specific auth and structured schema; validates provider stop reasons',async()=>{
 let request;const r=await callRecoveryClaude({role:'ATC',model:'test',key:'secret',payload:{},signal:AbortSignal.timeout(1000),fetchImpl:async(url,init)=>{request={url,...init};return {ok:true,json:async()=>({stop_reason:'end_turn',content:[{type:'text',text:'{"assessments":[]}'}],usage:{input_tokens:1}})};}});
 assert.equal(request.headers['x-api-key'],'secret');assert.equal(JSON.parse(request.body).output_config.format.type,'json_schema');assert.ok(r.decision.assessments);
 for(const status of [401,429,500])await assert.rejects(callRecoveryClaude({role:'ATC',fetchImpl:async()=>({ok:false,status})}),/authentication|rate_limit|provider_error/);
 await assert.rejects(callRecoveryClaude({role:'ATC',fetchImpl:async()=>({ok:true,json:async()=>({stop_reason:'max_tokens'})})}),/incomplete_response/);
});

test('live reviews preserve airport-scoped collisions, peer quotes and bounded fallback ranking',async()=>{
 const scenario=createRecoveryScenario(0,{airportCode:'LAX'}),context=chainContext(0,scenario,{stress:true}),chain=chainImpact(context),seen=[];
 const portfolio=await negotiateLiveRecovery(scenario,{env,chain,chainSummary:context.summary,transport:async({payload})=>{seen.push(payload);return response(payload);}});
 assert.ok(seen.length<=9);
 for(const payload of seen){
  assert.equal(payload.scenario.airport.code,'LAX');assert.equal(payload.scenario.source.record.DESTINATION_AIRPORT,'LAX');
  assert.equal(payload.chainSummary.airportCode,'LAX');assert.equal(payload.scenario.mapData,undefined);
  for(const option of payload.options)assert.deepEqual(option.chain,chain[option.id]??null);
 }
 for(const option of portfolio.options)assert.deepEqual(option.chain,chain[option.id]??null);
 const later=portfolio.events.filter(event=>event.type==='agent_message'&&event.turn>1);
 assert.ok(later.length>0);
 for(const message of later){assert.equal(message.receivedMessages.length,2);assert.ok(message.receivedMessages.every(peer=>peer.role!==message.role&&peer.turn===message.turn-1));}
 const blockedChain=Object.fromEntries(['gate','sequence','hold'].map(id=>[id,{...chain[id],othersCost:id==='gate'?1000:6,blocked:id==='gate'?1:0,selfBlocked:false}]));
 const blocked=await negotiateLiveRecovery(scenario,{env,chain:blockedChain,transport:async({payload})=>response(payload)});
 assert.equal(blocked.options.find(option=>option.id==='gate').consensus,false);assert.notEqual(blocked.recommendedId,'gate');assert.equal(blocked.status,'fallback');
});
