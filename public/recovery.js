import {renderConversation} from '/agent-conversation.mjs';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog=null,snapshot=null,previewId=null,busy=false,toastTimer,hasMapData=false,liveEvents=[],conversationRound=null;
const roleNames={ATC:'ATC',PILOT:'Pilot',GROUND:'Ground'};
const time=minute=>{if(!snapshot||!Number.isFinite(minute))return '—';const n=snapshot.scenario.clock.hour*60+snapshot.scenario.clock.minute+minute;return `${String(Math.floor(n/60)%24).padStart(2,'0')}:${String(Math.floor(n%60)).padStart(2,'0')}`;};
const historicalTime=value=>String(value||'').padStart(4,'0').replace(/^(..)(..)$/,'$1:$2');
const api=async(path,data)=>{const r=await fetch(path,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw new Error(body.error||'Request failed.');return body;};
function toast(text,error=false){$('toast').textContent=text;$('toast').className=`toast show${error?' error':''}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4500);}
function setBusy(value){busy=value;for(const id of ['compare','apply-inputs','timeout','flight-select','arrival-fuel','close-spares','execution-mode'])$(id).disabled=value;$('compare').disabled=value||!snapshot;$('compare').textContent=value?'Assessing options…':'Evaluate three plans';document.querySelectorAll('[data-choose]').forEach(b=>b.disabled=value||!snapshot?.portfolio?.options.find(o=>o.id===b.dataset.choose)?.validation.valid||snapshot?.selection?.optionId===b.dataset.choose);}
function facts(){
 const s=snapshot.scenario,r=s.source.record,date=`${r.YEAR}-${r.MONTH.padStart(2,'0')}-${r.DAY.padStart(2,'0')}`;
 $('flight-label').textContent=`${r.AIRLINE} ${r.FLIGHT_NUMBER} · ${r.ORIGIN_AIRPORT} → JFK`;
 $('source-label').textContent=`${date} · source row ${s.source.sourceRow} · weather +${r.WEATHER_DELAY||0} min / late aircraft +${r.LATE_AIRCRAFT_DELAY||0} min`;
 $('limits').innerHTML=[[s.capacity.active_runways,'Active runways'],[s.capacity.gates,'Total gates · 3 spare'],[s.capacity.max_runway_ops_per_hour,'Operations / hour'],[`${s.capacity.min_turnaround_min} min`,'Minimum turnaround'],[`${s.target.gateNotice} min`,'Gate-change notice']].map(([v,k])=>`<div class="limit"><b>${v}</b><span>${k}</span></div>`).join('');
 $('facts').innerHTML=[['Historical scheduled arrival',historicalTime(r.SCHEDULED_ARRIVAL)],['Historical actual arrival',historicalTime(r.ARRIVAL_TIME)],['Historical departure delay',`${r.DEPARTURE_DELAY} min`],['Historical arrival delay',`${r.ARRIVAL_DELAY} min`],['Scenario baseline ETA',time(s.baselineETA)],['Scenario decision time',time(0)],['Protected fuel',`${s.target.finalReserve+s.target.contingency} kg`],['Reserve / contingency',`${s.target.finalReserve} / ${s.target.contingency} kg`]].map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
 $('assumptions').innerHTML=s.assumptions.map(a=>`<li>${esc(a)}</li>`).join('');$('source-row').textContent=JSON.stringify(s.source,null,2);
 $('dataset-details').textContent=`Organizer CSV: ${catalog.dataset.rows.toLocaleString()} rows, all qualifying; ${catalog.dataset.jfkArrivals.toLocaleString()} non-cancelled, non-diverted JFK arrivals. Workbook limits are synthetic. Background demand is simulated because this filtered dataset omits unaffected flights.`;
}
function inspectorPanel(name){
 document.querySelectorAll('[data-panel]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.panel===name)));
 document.querySelectorAll('.inspector-pane').forEach(p=>p.classList.toggle('hidden',p.id!==`inspector-${name}`));
}
function renderInspector(){
 const p=snapshot?.portfolio,o=p?.options.find(o=>o.id===previewId),target=$('preview-assessments');
 if(!o){target.innerHTML='<div class="empty">Evaluate three options to compare the agents’ assessments here while keeping the map in view.</div>';return;}
 const m=o.metrics;
 target.innerHTML=`<h2 class="preview-title">${esc(o.title)}</h2><p class="preview-strategy">${esc(o.strategy)}</p><div class="preview-state"><span class="tag ${!o.validation.valid?'red':snapshot.selection?.optionId===o.id?'green':'amber'}">${!o.validation.valid?'BLOCKED':snapshot.selection?.optionId===o.id?'HUMAN CHOSEN':'PREVIEW ONLY'}</span><span>${o.assessments.length?o.accepted+'/3 agents accept':'No agent reviews'}</span></div><div class="detail-metrics"><div>${time(m.gateIn)} · ${o.plan.arrivals[0].standId}<small>ARRIVAL / GATE</small></div><div>${time(m.ready)}<small>TURNAROUND READY</small></div><div>${Math.round(m.fuelMargin)} kg<small>PROTECTED FUEL MARGIN</small></div><div>${m.crewMargin} min<small>ONWARD CREW MARGIN</small></div></div><div class="agent-assessments">${o.assessments.length?o.assessments.map(a=>`<article class="review"><div class="review-top"><strong class="role ${a.role.toLowerCase()}">${roleNames[a.role]}</strong><span class="efficiency">${a.efficiency}/100</span><span class="tag ${a.decision==='ACCEPT'?'green':a.decision==='VETO'?'red':'amber'}">${a.decision}</span></div><div class="score-track role ${a.role.toLowerCase()}"><i style="width:${a.efficiency}%"></i></div><p>${esc(a.explanation)}</p></article>`).join(''):'<div class="empty">No agent assessments were obtained. This is a deterministic fallback recommendation.</div>'}</div><details class="preview-checks"><summary>${o.validation.valid?'8 / 8 hard-check groups pass':`${o.validation.issues.length} hard findings`}</summary><ul>${o.validation.checks.map(c=>`<li class="${c.passed?'pass':'fail'}">${c.passed?'PASS':'FAIL'} · ${esc(c.name)}</li>`).join('')}</ul>${o.validation.issues.map(i=>`<p>${esc(i.detail)}</p>`).join('')}<p>${m.overtime} min overtime · ${m.overtimeCost} normalized wage-min<br>Plan ${esc(o.hash)}</p></details>`;
}
function render(){
 if(!snapshot)return;facts();const p=snapshot.portfolio;updateEngine(p?.mode||$('execution-mode').value);
 $('export').disabled=!p;$('options').innerHTML=p?p.options.map(o=>{
  const m=o.metrics,selected=snapshot.selection?.optionId===o.id,preview=o.id===previewId;
  return `<article class="option${preview?' preview':''}${selected?' chosen':''}${!o.validation.valid?' blocked':''}" data-option="${o.id}"><div class="rank-row"><b>RANK ${o.rank} / 3</b><span class="tag ${!o.validation.valid?'red':selected?'green':o.id===p.recommendedId?'green':'amber'}">${!o.validation.valid?'BLOCKED':selected?'HUMAN CHOSEN':o.id===p.recommendedId?(p.status==='fallback'?'FALLBACK PICK':'RECOMMENDED'):'ALTERNATIVE'}</span></div><h3>${esc(o.title)}</h3><p class="strategy">${esc(o.strategy)}</p><div class="agreement"><strong>${o.assessments.length?o.accepted:'—'}<span> / 3</span></strong><span>${o.assessments.length?'agents accept':'no agent review'}</span></div><div class="mini-metrics"><div>${time(m.gateIn)}<small>ARRIVAL · ${o.plan.arrivals[0].standId}</small></div><div>+${m.arrivalDelay} min<small>ADDITIONAL DELAY</small></div><div>${m.holdingFuel} kg<small>EXTRA HOLDING FUEL</small></div><div>${time(m.ready)}<small>TURNAROUND READY</small></div></div><div class="role-reviews">${o.assessments.length?o.assessments.map(a=>`<div class="review"><div class="review-top"><span class="role ${a.role.toLowerCase()}">${roleNames[a.role]}</span><span class="efficiency">${a.efficiency}/100</span><span class="tag ${a.decision==='ACCEPT'?'green':a.decision==='VETO'?'red':'amber'}">${a.decision}</span></div><div class="score-track role ${a.role.toLowerCase()}"><i style="width:${a.efficiency}%"></i></div><p>${esc(a.explanation)}</p></div>`).join(''):'<p class="strategy">No agent assessments were obtained for this evaluation. A deterministic cost rule recommends a hard-valid option.</p>'}</div>${!o.validation.valid?`<p class="strategy">${o.validation.issues.map(i=>esc(i.detail)).join(' ')}</p>`:''}<div class="option-actions"><button class="secondary" data-preview="${o.id}" aria-pressed="${preview}">${preview?'Showing on map':'Preview on map'}</button><button class="primary" data-choose="${o.id}" ${!o.validation.valid||selected||busy?'disabled':''}>${selected?'Chosen':'Choose plan'}</button></div><div class="option-footer">${o.validation.valid?'All 8 hard-check groups pass':`${o.validation.issues.length} hard findings`} · ${o.consensus?'Unanimous acceptance':o.validation.valid?(o.assessments.length?'Efficiency objections remain':'No agent consensus'):'Selection disabled'}<br>Plan ${esc(o.hash)} · ${m.overtime} min overtime</div></article>`;
 }).join(''):'<div class="empty">Ready to compare three distinct strategies against the same flight, airport limits and scenario state. No plan is selected.</div>';
 if(p)for(const o of p.options){const card=document.querySelector(`[data-option="${o.id}"]`),chips=document.createElement('div');chips.className='compact-roles';chips.innerHTML=o.assessments.map(a=>`<div class="compact-role ${a.decision.toLowerCase()}" title="${esc(roleNames[a.role]+': '+a.decision+' · '+a.efficiency+'/100')}"><b class="role ${a.role.toLowerCase()}">${roleNames[a.role]}</b><small>${a.efficiency} ${a.decision==='ACCEPT'?'✓':a.decision==='VETO'?'×':'↔'}</small></div>`).join('');card.querySelector('.option-actions').before(chips);}
 if(p){
  const selected=snapshot.selection&&p.options.find(o=>o.id===snapshot.selection.optionId),rec=p.options.find(o=>o.id===p.recommendedId);
  $('outcome').className=`result-banner${p.status==='handoff'?' error':p.status==='fallback'?' warn':''}`;
  $('outcome').textContent=selected?`Human selected “${selected.title}”. ${selected.consensus?'All three agents accepted this exact plan.':'Hard constraints pass; preference objections are retained in the audit.'} No movements executed.`:p.status==='handoff'?'No hard-valid recovery option was found. All three strategies remain inspectable, with selection blocked.':`${p.status==='consensus'?'Unanimous recommendation':'Deterministic fallback recommendation'}: “${rec.title}”. ${p.turns} of 3 turns used. Preview any option, then choose a plan.`;
  $('score-policy').innerHTML=Object.entries(p.scorePolicy).filter(([k])=>k!=='acceptThreshold').map(([k,v])=>`<strong class="role ${k.toLowerCase()}">${roleNames[k]}:</strong> <code>${esc(v)}</code>`).join('<br>');
 }else{$('outcome').className='result-banner';$('outcome').textContent='Inputs loaded. Evaluate all three options before choosing a plan.';}
 $('map-tabs').innerHTML=p?p.options.map(o=>`<button data-preview="${o.id}" aria-label="#${o.rank} ${esc(o.title)} · ${o.assessments.length?o.accepted+'/3':'no reviews'}" aria-pressed="${o.id===previewId}">${String(o.rank).padStart(2,'0')} · ${{gate:'Spare gate',sequence:'Resequence',hold:'Hold'}[o.id]} ${o.assessments.length?'· '+o.accepted+'/3':''}</button>`).join(''):'';
 $('map-empty').classList.toggle('hidden',Boolean(p));$('recovery-map-frame').classList.remove('hidden');
 $('selection-footer').textContent=snapshot.selection?`Human choice: ${snapshot.selection.optionId} · ${snapshot.selection.planHash.slice(0,8)}`:'No plan selected';
 renderInspector();renderLog();syncMap();renderConversationView();
}
function renderLog(){
 const p=snapshot.portfolio,messages=p?.events.filter(e=>e.type==='agent_message')||liveEvents.filter(e=>e.type==='agent_message');
 $('message-count').textContent=`${messages.length} agent messages · ${p?.turns||0}/3 turns`;
 if(!p){$('log').innerHTML=liveEvents.filter(e=>e.type==='agent_message').map(e=>`<article class="live-message"><b>${esc(roleNames[e.role])} · turn ${e.turn}</b><p>${e.assessments.map(a=>`${esc(a.optionId)}: ${esc(a.decision)} — ${esc(a.explanation)}`).join('<br>')}</p></article>`).join('')||'<div class="empty">No agent messages yet.</div>';return;}
 const turns=[...new Set(messages.map(m=>m.turn))];
 $('log').innerHTML=turns.map(turn=>`<div class="turn"><header>TURN ${turn} · ${messages.filter(m=>m.turn===turn).length} STRUCTURED MESSAGES</header><div class="turn-grid">${messages.filter(m=>m.turn===turn).map(m=>`<article><b class="role ${m.role.toLowerCase()}">${roleNames[m.role]}</b><p>${m.assessments.map(a=>`${esc(p.options.find(o=>o.id===a.optionId).title)}: ${a.decision} · ${a.efficiency}/100`).join('<br>')}</p><details><summary>Inspect structured message</summary><pre>${esc(JSON.stringify(m,null,2))}</pre></details></article>`).join('')}</div></div>`).join('')+`<div class="result-banner${p.status==='fallback'?' warn':p.status==='handoff'?' error':''}">${esc(p.events.at(-1).explanation)}</div>`+(snapshot.selection?`<div class="turn"><header>HUMAN SELECTION · ${esc(snapshot.selection.optionId.toUpperCase())}</header><pre>${esc(JSON.stringify(snapshot.selection,null,2))}</pre></div>`:'');
}
function syncMap(){
 const payload=snapshot?.maps?.[previewId];if(!payload){$('map-status').textContent='JFK AIRFIELD · AWAITING EVALUATION';if(hasMapData){hasMapData=false;$('recovery-map-frame').src='/jfk-plan.html?layout=canvas';}return;}hasMapData=true;
 $('map-status').textContent=`${payload.recovery.selected?'HUMAN CHOSEN':'PREVIEW ONLY'} · ${payload.recovery.validated?'HARD CHECKS PASS':'BLOCKED'} · ${payload.recovery.hash.slice(0,8)}`;
 $('recovery-map-frame').contentWindow?.postMessage({type:'clearance:state',payload},location.origin);
}
async function load(){
 liveEvents=[];conversationRound=null;$('agent-progress').textContent='';
 setBusy(true);if(snapshot){snapshot={...snapshot,portfolio:null,selection:null,maps:null};previewId=null;render();}
 try{snapshot=await api('/api/recovery',{index:Number($('flight-select').value||0),arrivalFuel:Number($('arrival-fuel').value),closedStands:$('close-spares').checked?['G7','G8','G9']:[]});previewId=null;render();}catch(e){snapshot=null;previewId=null;$('options').innerHTML='<div class="empty">Correct the scenario inputs before evaluating or choosing a plan.</div>';$('outcome').className='result-banner error';$('outcome').textContent=e.message;$('export').disabled=true;$('recovery-map-frame').classList.remove('hidden');$('map-empty').classList.remove('hidden');toast(e.message,true);}finally{setBusy(false);render();}
}
async function compare(forceTimeout=false){
 if(busy||!snapshot)return;setBusy(true);if(forceTimeout||$('execution-mode').value==='policy'){liveEvents=[];$('agent-progress').textContent='';}
 try{snapshot=$('execution-mode').value==='live'&&!forceTimeout?await runLive():await api(`/api/recovery/${snapshot.id}/compare`,{forceTimeout});previewId=snapshot.portfolio.recommendedId||snapshot.portfolio.options[0].id;render();inspectorPanel('agents');toast('Three options evaluated. Human selection is pending.');}catch(e){if($('execution-mode').value==='live')$('agent-progress').textContent='Live evaluation interrupted. Evaluate again before selecting a plan.';toast(e.message,true);}finally{setBusy(false);render();}
}
document.addEventListener('click',async e=>{
 const panel=e.target.closest('[data-panel]');if(panel){inspectorPanel(panel.dataset.panel);return;}
 const preview=e.target.closest('[data-preview]');if(preview&&!busy){previewId=preview.dataset.preview;render();inspectorPanel('agents');if(window.innerWidth<=850)$('map-section').scrollIntoView({behavior:'smooth',block:'start'});return;}
 const choose=e.target.closest('[data-choose]');if(choose&&!busy){setBusy(true);try{const option=snapshot.portfolio.options.find(o=>o.id===choose.dataset.choose);snapshot=await api(`/api/recovery/${snapshot.id}/choose`,{optionId:option.id,planHash:option.hash,stateVersion:snapshot.scenario.stateVersion});previewId=option.id;render();toast(`Selected ${option.title}. Recorded as a human planning choice.`);}catch(error){toast(error.message,true);}finally{setBusy(false);render();}}
});
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==$('recovery-map-frame').contentWindow)return;if(e.data?.type==='clearance:ready')syncMap();if(e.data?.type==='clearance:run')compare();});
$('recovery-map-frame').addEventListener('load',syncMap);
$('compare').addEventListener('click',()=>compare());$('timeout').addEventListener('click',()=>compare(true));$('apply-inputs').addEventListener('click',()=>load());
for(const id of ['arrival-fuel','close-spares','flight-select'])$(id).addEventListener('change',()=>load());
$('export').addEventListener('click',()=>{if(!snapshot)return;const a=document.createElement('a');a.href=`/api/recovery/${snapshot.id}/export`;a.download='clearance-recovery-audit.json';a.click();});
function focus(value){document.body.classList.toggle('focus-map',value);$('exit-expand').classList.toggle('hidden',!value);if(value)window.scrollTo({top:0});}
$('expand').addEventListener('click',()=>focus(true));$('exit-expand').addEventListener('click',()=>focus(false));document.addEventListener('keydown',e=>{if(e.key==='Escape')focus(false);});
try{catalog=await api('/api/recovery');configureLive();$('flight-select').innerHTML=catalog.flights.map(f=>`<option value="${f.index}">${esc(`${f.AIRLINE} ${f.FLIGHT_NUMBER} · ${f.ORIGIN_AIRPORT} → JFK · ${f.YEAR}-${f.MONTH.padStart(2,'0')}-${f.DAY.padStart(2,'0')} · row ${f.sourceRow}`)}</option>`).join('');await load();}catch(e){toast(e.message,true);$('options').innerHTML='<div class="empty">The recovery service could not load. Start the local server and reload.</div>';}

function updateEngine(mode){
 const live=mode==='live';$('engine-label').textContent=live?'LIVE CLAUDE AGENTS':'LOCAL POLICY AGENTS · NO LLM CALLS';
 $('engine-footer').textContent=live?'Historical trigger · simulated operational state. Live Claude assessments; calculated efficiency scores.':'Historical trigger · simulated operational state. Local policy assessments · no LLM calls';
}
function configureLive(){
 const cfg=catalog.live;$('execution-mode').querySelector('[value=live]').disabled=!cfg?.available;
 $('execution-mode').value=cfg?.available?'live':'policy';
 $('agent-config').textContent=Object.entries(cfg?.agents||{}).map(([role,a])=>`${roleNames[role]}: ${a.configured?a.model:'key and model required on server'}`).join(' · ');
 updateEngine($('execution-mode').value);
}
$('execution-mode').addEventListener('change',()=>{liveEvents=[];$('agent-progress').textContent='';updateEngine($('execution-mode').value);load();});
async function runLive(){
 liveEvents=[];conversationRound=null;setWorkspaceView('conversation');snapshot={...snapshot,portfolio:null,selection:null,maps:null};previewId=null;render();
 $('agent-progress').innerHTML=Object.values(roleNames).map(name=>`<p>${name}: pending</p>`).join('');
 const response=await fetch(`/api/recovery/${snapshot.id}/run`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 if(!response.ok){const error=await response.json();throw new Error(error.error||'Live evaluation could not start.');}
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result;
 function event(block){
  const type=block.split('\n').find(l=>l.startsWith('event:'))?.slice(6).trim();
  const raw=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!raw)return;
  const data=JSON.parse(raw);
  if(type==='failure')throw new Error(data.error);
  if(type==='result'){result=data;return;}
  if(type==='progress'){
   liveEvents.push(data);
   $('agent-progress').innerHTML=Object.entries(roleNames).map(([role,name])=>{const last=liveEvents.filter(e=>e.type==='agent_status'&&e.role===role).at(-1);return `<p><strong>${name}</strong>: ${esc(last?.status||'pending')}${last?` · round ${last.turn}`:''}${last?.reason?` · ${esc(last.reason)}`:''}</p>`;}).join('');
   renderLog();renderConversationView();
  }
 }
 try{while(true){const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let end;while((end=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,end));buffer=buffer.slice(end+2);}if(done){if(buffer.trim())event(buffer);break;}}}
 catch(error){await reader.cancel();throw error;}
 finally{reader.releaseLock();}
 if(!result)throw new Error('Live connection ended before a result. Evaluate again.');return result;
}

function setWorkspaceView(view){
 const conversation=view==='conversation';$('map-section').classList.toggle('show-conversation',conversation);
 $('conversation-view').hidden=!conversation;
 document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===view)));
 if(conversation)renderConversationView();
}
function renderConversationView(){
 const events=snapshot?.portfolio?.events||liveEvents;
 const focused=document.activeElement?.id==='conversation-round';
 $('conversation-view').innerHTML=renderConversation({events,optionId:previewId||snapshot?.portfolio?.recommendedId||'gate',round:conversationRound,busy,selection:snapshot?.selection});
 if(focused)$('conversation-round')?.focus();
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-view]');if(button)setWorkspaceView(button.dataset.view);});
document.addEventListener('change',event=>{if(event.target.id==='conversation-round'){conversationRound=event.target.value==='latest'?null:Number(event.target.value);renderConversationView();}});
