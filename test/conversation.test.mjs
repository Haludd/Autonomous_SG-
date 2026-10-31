import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationState,renderConversation} from '../public/agent-conversation.mjs';
import {createRecoveryScenario,negotiateRecovery} from '../src/recovery.mjs';
import {negotiateLiveRecovery,LIVE_ROLES} from '../src/live-recovery.mjs';
const portfolio=negotiateRecovery(createRecoveryScenario());
test('conversation follows actual round messages and records who heard whom',()=>{
 const first=conversationState({events:portfolio.events,round:1});assert.equal(first.participants.length,3);assert.ok(first.participants.every(p=>p.heard.length===0));
 const last=conversationState({events:portfolio.events});assert.equal(last.turn,2);assert.ok(last.participants.every(p=>p.heard.length===2));assert.equal(last.participants[0].assessment.explanation,portfolio.events.find(e=>e.type==='agent_message'&&e.turn===2&&e.role==='ATC').assessments[0].explanation);
});
test('missing or failed agents are shown without invented speech or votes',()=>{
 const events=[{type:'agent_status',role:'PILOT',turn:1,status:'failed',reason:'authentication'}];const state=conversationState({events});assert.equal(state.participants[1].assessment,undefined);assert.equal(state.participants[1].status,'failed');assert.match(renderConversation({events}),/This agent has no recorded vote/);assert.ok(!renderConversation({events}).includes('I can accept this'));
});
test('round comparison shows actual changes and selected option explanations',()=>{
 const events=structuredClone(portfolio.events);const m=events.find(e=>e.type==='agent_message'&&e.role==='ATC'&&e.turn===2);m.assessments.find(a=>a.optionId==='sequence').decision='ACCEPT';
 assert.match(renderConversation({events,optionId:'sequence'}),/Changed position: COUNTER → ACCEPT/);assert.match(renderConversation({events,optionId:'sequence'}),/Resequence departures/);
});
test('conversation escapes model content and distinguishes fallback, policy and human choice',()=>{
 const events=structuredClone(portfolio.events);events.find(e=>e.type==='agent_message'&&e.turn===2).assessments[0].explanation='<img src=x onerror=alert(1)>';
 const html=renderConversation({events});assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);assert.match(html,/Local policy assessment/);
 assert.match(renderConversation({events:[{type:'fallback',explanation:'No agreement.'}]}),/Fallback · no agent agreement/);
 assert.match(renderConversation({events,selection:{optionId:'hold'}}),/You selected Keep the original gate/);
});

test('earlier-round replay labels the final outcome separately and diagram labels use HTML',()=>{
 const html=renderConversation({events:portfolio.events,round:1});assert.match(html,/Final evaluation result · round 2/);assert.match(html,/<div class="relay-hub"><strong>Shared planning table/);
});

test('live conversation quotes the received peer messages and explains enforced decisions',async()=>{
 const env=Object.fromEntries(LIVE_ROLES.flatMap(role=>[[`${role}_ANTHROPIC_API_KEY`,'test-private'],[`${role}_ANTHROPIC_MODEL`,'test-model']]));
 const result=await negotiateLiveRecovery(createRecoveryScenario(),{env,transport:async({payload})=>({decision:{stateVersion:payload.stateVersion,preferredOptionId:'gate',assessments:payload.options.map(option=>({optionId:option.id,planHash:option.hash,decision:'ACCEPT',explanation:`${payload.role} turn ${payload.turn} reviewed ${option.id} <safely>.`}))}})});
 const html=renderConversation({events:result.events,optionId:'sequence'});
 assert.match(html,/ATC turn 1 reviewed sequence &lt;safely&gt;/);assert.match(html,/Pilot · round 1/);
 assert.match(html,/App recorded COUNTER after Claude proposed ACCEPT/);assert.match(html,/Live Claude responses/);
 assert.ok(!html.includes('<safely>'));assert.ok(!html.includes('test-private'));
});
