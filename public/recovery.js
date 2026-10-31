const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog=null,snapshot=null,previewId=null,busy=false,toastTimer;
const compactViewport=window.matchMedia('(max-width: 900px)');
let railState={left:true,right:!compactViewport.matches};
let restoreRails={...railState},activeInspector='agents';

function syncPanelControls(){
 for(const [side,id] of [['left','options-panel'],['right','inspector-panel']]){
  const open=railState[side],panel=$(id);
  document.body.classList.toggle(`${side}-panel-hidden`,!open);
  panel.inert=!open;panel.setAttribute('aria-hidden',String(!open));
  document.querySelectorAll(`[data-toggle-rail="${side}"]`).forEach(button=>button.setAttribute('aria-expanded',String(open)));
 }
 $('open-options').classList.toggle('hidden',railState.left);
 $('open-inspector').classList.toggle('hidden',railState.right);
 $('toggle-options').setAttribute('aria-pressed',String(railState.left));
 document.querySelectorAll('[data-open-panel]').forEach(button=>button.setAttribute('aria-pressed',String(railState.right&&button.dataset.openPanel===activeInspector)));
 const mapOnly=!railState.left&&!railState.right;
 $('expand').setAttribute('aria-pressed',String(mapOnly));
 $('expand').title=mapOnly?'Restore side panels':'Hide both side panels';
 $('map-only-label').textContent=mapOnly?'Show panels':'Map only';
 $('recovery-map-frame').contentWindow?.postMessage({type:'clearance:layout',panels:railState},location.origin);
}
function setRail(side,open){
 const id=side==='left'?'options-panel':'inspector-panel';
 const moveFocus=!open&&$(id).contains(document.activeElement);
 railState={...railState,[side]:open};
 if(open&&compactViewport.matches)railState[side==='left'?'right':'left']=false;
 syncPanelControls();
 if(moveFocus)$(side==='left'?'toggle-options':`dock-${activeInspector}`).focus();
}
function toggleMapOnly(){
 if(railState.left||railState.right){restoreRails={...railState};railState={left:false,right:false};}
 else{railState={...restoreRails};if(compactViewport.matches&&railState.left&&railState.right)railState.right=false;}
 syncPanelControls();
}
compactViewport.addEventListener('change',()=>{if(compactViewport.matches&&railState.left&&railState.right)setRail('right',false);});
syncPanelControls();
const roleNames={ATC:'ATC',PILOT:'Pilot',GROUND:'Ground'};
const time=minute=>{if(!snapshot||!Number.isFinite(minute))return '—';const n=snapshot.scenario.clock.hour*60+snapshot.scenario.clock.minute+minute;return `${String(Math.floor(n/60)%24).padStart(2,'0')}:${String(Math.floor(n%60)).padStart(2,'0')}`;};
const historicalTime=value=>String(value||'').padStart(4,'0').replace(/^(..)(..)$/,'$1:$2');
function gateLabel(id){
 const gate=snapshot?.scenario.mapData.gateBindings?.[id];
 return gate?`${id} → ${gate.ref?`Gate ${gate.ref}`:gate.name||'mapped gate'}`:`${id} · unmapped`;
}
function mapProvenance(airport){
 const coverage=airport.gateCoverage;
 const bindings=Object.entries(airport.gateBindings??{}).map(([alias,gate])=>`${alias} → ${gate?gate.ref?`Gate ${gate.ref}`:gate.name||gate.osmId:'unmapped'}`).join('; ');
 return `${airport.name} (${airport.ident??airport.code}); ${airport.latitude.toFixed(5)}, ${airport.longitude.toFixed(5)}. ${airport.runways.length} runway outlines from OurAirports. Coordinates: ${airport.coordinateSource}. ${airport.gates?.length??0} passenger gate points from OpenStreetMap (${airport.gateSource?.osmTimestamp??'snapshot'}); ${coverage?.mappedStandCount??0}/${coverage?.totalStandCount??0} scenario aliases have source coordinates. ${bindings}. Missing positions are hidden. Gate assignments and occupancy are simulated; passenger gate points are not aircraft parking positions. Dashed taxi paths are illustrative. Map context is current; flights are from 2015. The street map needs internet; downloaded runways and gate points remain available locally.`;
}
const api=async(path,data)=>{const r=await fetch(path,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw new Error(body.error||'Request failed.');return body;};
function toast(text,error=false){$('toast').textContent=text;$('toast').className=`toast show${error?' error':''}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4500);}
function setBusy(value){busy=value;for(const id of ['compare','apply-inputs','timeout','flight-select','arrival-fuel','close-spares','airport-select'])$(id).disabled=value||(id!=='airport-select'&&!catalog?.flights.length);$('compare').disabled=value||!snapshot;$('compare').textContent=value?'Assessing options…':'Evaluate three plans';}
function airportFacts(airport){
 const code=airport.code;
 $('airport-kicker').textContent=`${code} / RECOVERY DESK`;
 for(const id of ['airport-badge','airport-limits-label','map-empty-code'])$(id).textContent=code;
 $('coordination-label').textContent=`${code} surface coordination`;
 $('map-section').setAttribute('aria-label',`${code} recovery map`);
 const c=airport.capacity;
 $('limits').innerHTML=[[c.active_runways,'Workbook runway limit'],[c.gates,`Total gates · ${c.spare_gates_at_any_time} spare`],[c.max_runway_ops_per_hour,'Operations / hour'],[`${c.min_turnaround_min} min`,'Minimum turnaround']].map(([v,k])=>`<div class="limit"><b>${v}</b><span>${k}</span></div>`).join('');
}
function facts(){
 const s=snapshot.scenario,r=s.source.record,date=`${r.YEAR}-${r.MONTH.padStart(2,'0')}-${r.DAY.padStart(2,'0')}`;
 const code=s.airport.code;
 airportFacts(s.mapData);
 $('flight-label').textContent=`${r.AIRLINE} ${r.FLIGHT_NUMBER} · ${r.ORIGIN_AIRPORT} → ${code}`;
 $('airport-kicker').textContent=`${code} / RECOVERY DESK`;
 for(const id of ['airport-badge','airport-limits-label','map-empty-code'])$(id).textContent=code;
 $('coordination-label').textContent=`${code} surface coordination`;
 $('map-section').setAttribute('aria-label',`${code} recovery map`);
 $('flight-select-label').textContent=`Historical disruption · ${catalog.flights.length} indexed ${code} arrivals`;
 $('spare-gate-label').textContent=`Make spare gates ${s.spareGateIds.join(', ')} unavailable`;
 $('map-empty-copy').textContent='Evaluate three plans to preview routes and timing.';
 $('source-label').textContent=`${date} · source row ${s.source.sourceRow} · weather +${r.WEATHER_DELAY||0} min / late aircraft +${r.LATE_AIRCRAFT_DELAY||0} min`;
 $('limits').innerHTML=[[s.capacity.active_runways,'Workbook runway limit'],[s.capacity.gates,`Total gates · ${s.capacity.spare_gates_at_any_time} spare`],[s.capacity.max_runway_ops_per_hour,'Operations / hour'],[`${s.capacity.min_turnaround_min} min`,'Minimum turnaround'],[`${s.target.gateNotice} min`,'Gate-change notice']].map(([v,k])=>`<div class="limit"><b>${v}</b><span>${k}</span></div>`).join('');
 $('facts').innerHTML=[['Historical scheduled arrival',historicalTime(r.SCHEDULED_ARRIVAL)],['Historical actual arrival',historicalTime(r.ARRIVAL_TIME)],['Historical departure delay',`${r.DEPARTURE_DELAY} min`],['Historical arrival delay',`${r.ARRIVAL_DELAY} min`],['Scenario baseline ETA',time(s.baselineETA)],['Scenario decision time',time(0)],['Protected fuel',`${s.target.finalReserve+s.target.contingency} kg`],['Reserve / contingency',`${s.target.finalReserve} / ${s.target.contingency} kg`]].map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
 $('assumptions').innerHTML=s.assumptions.map(a=>`<li>${esc(a)}</li>`).join('');$('source-row').textContent=JSON.stringify(s.source,null,2);
 $('dataset-details').textContent=`Organizer CSV: ${catalog.dataset.rows.toLocaleString()} rows, all qualifying; ${catalog.dataset.airportArrivals.toLocaleString()} non-cancelled, non-diverted ${code} arrivals. Workbook limits are synthetic. Background demand is simulated because this filtered dataset omits unaffected flights.`;
 $('map-provenance').textContent=mapProvenance(s.mapData);
}
function inspectorPanel(name){
 activeInspector=name;
 document.querySelectorAll('[data-panel]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.panel===name));b.tabIndex=b.dataset.panel===name?0:-1;});
 document.querySelectorAll('.inspector-pane').forEach(p=>p.classList.toggle('hidden',p.id!==`inspector-${name}`));
 syncPanelControls();
}
function renderInspector(){
 const p=snapshot?.portfolio,o=p?.options.find(o=>o.id===previewId),target=$('preview-assessments');
 if(!o){target.innerHTML='<div class="empty">Evaluate three options to compare the agents’ assessments here while keeping the map in view.</div>';return;}
 const m=o.metrics;
 target.innerHTML=`<h2 class="preview-title">${esc(o.title)}</h2><p class="preview-strategy">${esc(o.strategy)}</p><div class="preview-state"><span class="tag ${!o.validation.valid?'red':snapshot.selection?.optionId===o.id?'green':'amber'}">${!o.validation.valid?'BLOCKED':snapshot.selection?.optionId===o.id?'HUMAN CHOSEN':'PREVIEW ONLY'}</span><span>${o.assessments.length?o.accepted+'/3 agents accept':'No agent reviews'}</span></div><div class="detail-metrics"><div>${time(m.gateIn)} · ${esc(gateLabel(o.plan.arrivals[0].standId))}<small>ARRIVAL / GATE</small></div><div>${time(m.ready)}<small>TURNAROUND READY</small></div><div>${Math.round(m.fuelMargin)} kg<small>PROTECTED FUEL MARGIN</small></div><div>${m.crewMargin} min<small>ONWARD CREW MARGIN</small></div></div><div class="agent-assessments">${o.assessments.length?o.assessments.map(a=>`<article class="review"><div class="review-top"><strong class="role ${a.role.toLowerCase()}">${roleNames[a.role]}</strong><span class="efficiency">${a.efficiency}/100</span><span class="tag ${a.decision==='ACCEPT'?'green':a.decision==='VETO'?'red':'amber'}">${a.decision}</span></div><div class="score-track role ${a.role.toLowerCase()}"><i style="width:${a.efficiency}%"></i></div><p>${esc(a.explanation)}</p></article>`).join(''):'<div class="empty">The timeout drill obtained no agent assessments. This is a deterministic fallback recommendation.</div>'}</div><details class="preview-checks"><summary>${o.validation.valid?'8 / 8 hard-check groups pass':`${o.validation.issues.length} hard findings`}</summary><ul>${o.validation.checks.map(c=>`<li class="${c.passed?'pass':'fail'}">${c.passed?'PASS':'FAIL'} · ${esc(c.name)}</li>`).join('')}</ul>${o.validation.issues.map(i=>`<p>${esc(i.detail)}</p>`).join('')}<p>${m.overtime} min overtime · ${m.overtimeCost} normalized wage-min<br>Plan ${esc(o.hash)}</p></details>`;
}
function render(){
 if(!snapshot)return;facts();const p=snapshot.portfolio;
 $('export').disabled=!p;$('options').innerHTML=p?p.options.map(o=>{
  const m=o.metrics,selected=snapshot.selection?.optionId===o.id,preview=o.id===previewId;
  return `<article class="option${preview?' preview':''}${selected?' chosen':''}${!o.validation.valid?' blocked':''}" data-option="${o.id}"><div class="rank-row"><b>RANK ${o.rank} / 3</b><span class="tag ${!o.validation.valid?'red':selected?'green':o.id===p.recommendedId?'green':'amber'}">${!o.validation.valid?'BLOCKED':selected?'HUMAN CHOSEN':o.id===p.recommendedId?(p.status==='fallback'?'FALLBACK PICK':'RECOMMENDED'):'ALTERNATIVE'}</span></div><h3>${esc(o.title)}</h3><p class="strategy">${esc(o.strategy)}</p><div class="agreement"><strong>${o.assessments.length?o.accepted:'—'}<span> / 3</span></strong><span>${o.assessments.length?'agents accept':'no agent review'}</span></div><div class="mini-metrics"><div>${time(m.gateIn)}<small>ARRIVAL · ${esc(gateLabel(o.plan.arrivals[0].standId))}</small></div><div>+${m.arrivalDelay} min<small>ADDITIONAL DELAY</small></div><div>${m.holdingFuel} kg<small>EXTRA HOLDING FUEL</small></div><div>${time(m.ready)}<small>TURNAROUND READY</small></div></div><div class="role-reviews">${o.assessments.length?o.assessments.map(a=>`<div class="review"><div class="review-top"><span class="role ${a.role.toLowerCase()}">${roleNames[a.role]}</span><span class="efficiency">${a.efficiency}/100</span><span class="tag ${a.decision==='ACCEPT'?'green':a.decision==='VETO'?'red':'amber'}">${a.decision}</span></div><div class="score-track role ${a.role.toLowerCase()}"><i style="width:${a.efficiency}%"></i></div><p>${esc(a.explanation)}</p></div>`).join(''):'<p class="strategy">No agent assessments were obtained in the timeout drill. A deterministic cost rule recommends a hard-valid option.</p>'}</div>${!o.validation.valid?`<p class="strategy">${o.validation.issues.map(i=>esc(i.detail)).join(' ')}</p>`:''}<div class="option-actions"><button class="secondary" data-preview="${o.id}" aria-pressed="${preview}">${preview?'Showing on map':'Preview on map'}</button><button class="primary" data-choose="${o.id}" ${!o.validation.valid||selected||busy?'disabled':''}>${selected?'Chosen':'Choose plan'}</button></div><div class="option-footer">${o.validation.valid?'All 8 hard-check groups pass':`${o.validation.issues.length} hard findings`} · ${o.consensus?'Unanimous acceptance':o.validation.valid?(o.assessments.length?'Efficiency objections remain':'No agent consensus'):'Selection disabled'}<br>Plan ${esc(o.hash)} · ${m.overtime} min overtime</div></article>`;
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
 renderInspector();renderLog();syncMap();
}
function renderLog(){
 const p=snapshot.portfolio,messages=p?.events.filter(e=>e.type==='agent_message')||[];
 $('message-count').textContent=`${messages.length} agent messages · ${p?.turns||0}/3 turns`;
 if(!p){$('log').innerHTML='<div class="empty">No agent messages yet.</div>';return;}
 const turns=[...new Set(messages.map(m=>m.turn))];
 $('log').innerHTML=turns.map(turn=>`<div class="turn"><header>TURN ${turn} · THREE STRUCTURED MESSAGES</header><div class="turn-grid">${messages.filter(m=>m.turn===turn).map(m=>`<article><b class="role ${m.role.toLowerCase()}">${roleNames[m.role]}</b><p>${m.assessments.map(a=>`${esc(p.options.find(o=>o.id===a.optionId).title)}: ${a.decision} · ${a.efficiency}/100`).join('<br>')}</p><details><summary>Inspect structured message</summary><pre>${esc(JSON.stringify(m,null,2))}</pre></details></article>`).join('')}</div></div>`).join('')+`<div class="result-banner${p.status==='fallback'?' warn':p.status==='handoff'?' error':''}">${esc(p.events.at(-1).explanation)}</div>`+(snapshot.selection?`<div class="turn"><header>HUMAN SELECTION · ${esc(snapshot.selection.optionId.toUpperCase())}</header><pre>${esc(JSON.stringify(snapshot.selection,null,2))}</pre></div>`:'');
}
function syncMap(){
 const payload=snapshot?.maps?.[previewId];if(!payload){const airport=snapshot?.scenario.mapData??catalog?.airport;$('map-status').textContent=`${airport?.code??'AIRPORT'} · ${catalog?.flights.length?'AWAITING EVALUATION':'MAP VIEW'}`;if(airport)$('recovery-map-frame').contentWindow?.postMessage({type:'clearance:airport',payload:airport,clock:snapshot?.scenario.clock},location.origin);return;}
 $('map-status').textContent=`${payload.recovery.selected?'HUMAN CHOSEN':'PREVIEW ONLY'} · ${payload.recovery.validated?'HARD CHECKS PASS':'BLOCKED'} · ${payload.recovery.hash.slice(0,8)}`;
 $('recovery-map-frame').contentWindow?.postMessage({type:'clearance:state',payload},location.origin);
}
async function load(){
 setBusy(true);if(snapshot){snapshot={...snapshot,portfolio:null,selection:null,maps:null};previewId=null;render();}
 try{const spareCount=catalog?.limits.spare_gates_at_any_time??3;const closedStands=$('close-spares').checked?Array.from({length:spareCount},(_,i)=>`G${i+7}`):[];snapshot=await api('/api/recovery',{airportCode:$('airport-select').value,index:Number($('flight-select').value||0),arrivalFuel:Number($('arrival-fuel').value),closedStands});previewId=null;render();}catch(e){snapshot=null;previewId=null;$('options').innerHTML='<div class="empty">Correct the scenario inputs before evaluating or choosing a plan.</div>';$('outcome').className='result-banner error';$('outcome').textContent=e.message;$('export').disabled=true;$('recovery-map-frame').classList.remove('hidden');$('map-empty').classList.remove('hidden');toast(e.message,true);}finally{setBusy(false);render();}
}
async function compare(forceTimeout=false){
 if(busy||!snapshot)return;setBusy(true);
 try{snapshot=await api(`/api/recovery/${snapshot.id}/compare`,{forceTimeout});previewId=snapshot.portfolio.recommendedId||snapshot.portfolio.options[0].id;render();inspectorPanel('agents');setRail('left',true);toast('Three options evaluated. Human selection is pending.');}catch(e){toast(e.message,true);}finally{setBusy(false);render();}
}
document.addEventListener('click',async e=>{
 const rail=e.target.closest('[data-toggle-rail]');if(rail){setRail(rail.dataset.toggleRail,!railState[rail.dataset.toggleRail]);return;}
 const openPanel=e.target.closest('[data-open-panel]');if(openPanel){const name=openPanel.dataset.openPanel,close=railState.right&&activeInspector===name;inspectorPanel(name);setRail('right',!close);return;}
 const panel=e.target.closest('[data-panel]');if(panel){inspectorPanel(panel.dataset.panel);return;}
 const preview=e.target.closest('[data-preview]');if(preview&&!busy){previewId=preview.dataset.preview;render();inspectorPanel('agents');return;}
 const choose=e.target.closest('[data-choose]');if(choose&&!busy){setBusy(true);try{const option=snapshot.portfolio.options.find(o=>o.id===choose.dataset.choose);snapshot=await api(`/api/recovery/${snapshot.id}/choose`,{optionId:option.id,planHash:option.hash,stateVersion:snapshot.scenario.stateVersion});previewId=option.id;render();toast(`Selected ${option.title}. Recorded as a human planning choice.`);}catch(error){toast(error.message,true);}finally{setBusy(false);render();}}
});
window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==$('recovery-map-frame').contentWindow)return;if(e.data?.type==='clearance:ready'){syncMap();syncPanelControls();}if(e.data?.type==='clearance:run')compare();if(e.data?.type==='clearance:map-only')toggleMapOnly();});
$('recovery-map-frame').addEventListener('load',()=>{syncMap();syncPanelControls();});
$('compare').addEventListener('click',()=>compare());$('timeout').addEventListener('click',()=>compare(true));$('apply-inputs').addEventListener('click',()=>load());
for(const id of ['arrival-fuel','close-spares','flight-select'])$(id).addEventListener('change',()=>load());
$('export').addEventListener('click',()=>{if(!snapshot)return;const a=document.createElement('a');a.href=`/api/recovery/${snapshot.id}/export`;a.download='clearance-recovery-audit.json';a.click();});
$('expand').addEventListener('click',toggleMapOnly);
document.addEventListener('keydown',e=>{
 if(e.target.closest('input,select,textarea')||e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.key.toLowerCase()==='m'){e.preventDefault();toggleMapOnly();}
 const tab=e.target.closest('[data-panel]');
 if(tab&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
  e.preventDefault();const tabs=[...document.querySelectorAll('[data-panel]')],index=tabs.indexOf(tab);
  const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  inspectorPanel(tabs[next].dataset.panel);tabs[next].focus();
 }
});
async function loadAirport(code){
 setBusy(true);
 try{
  catalog=await api(`/api/recovery?airport=${encodeURIComponent(code)}`);
  $('airport-select').innerHTML=catalog.airports.map(airport=>`<option value="${airport.code}" ${airport.code===code?'selected':''}>${esc(`${airport.code} · ${airport.city}, ${airport.state}`)}</option>`).join('');
  $('flight-select').innerHTML=catalog.flights.map(f=>`<option value="${f.index}">${esc(`${f.AIRLINE} ${f.FLIGHT_NUMBER} · ${f.ORIGIN_AIRPORT} → ${code} · ${f.YEAR}-${f.MONTH.padStart(2,'0')}-${f.DAY.padStart(2,'0')} · row ${f.sourceRow}`)}</option>`).join('');
  $('close-spares').checked=false;
  if(catalog.flights.length){await load();}
  else{
   snapshot=null;previewId=null;airportFacts(catalog.airport);
   $('flight-label').textContent=`${code} · ${catalog.airport.city}`;$('source-label').textContent='No eligible arrival records; airport map available.';
   $('options').innerHTML='<div class="empty">No qualifying non-cancelled, non-diverted arrivals at this airport appear in the CSV. You can still browse its map.</div>';
   $('outcome').className='result-banner warn';$('outcome').textContent='Map browsing available. Recovery evaluation needs a qualifying arrival record.';
   $('preview-assessments').innerHTML='<div class="empty">Select an airport with eligible arrival examples to evaluate recovery plans.</div>';
   $('log').innerHTML='<div class="empty">No recovery session for this airport.</div>';$('message-count').textContent='0 agent messages';$('export').disabled=true;
   $('flight-select-label').textContent=`No qualifying ${code} arrivals`;
   $('facts').innerHTML='';$('assumptions').innerHTML='';$('source-row').textContent='No eligible arrival source row.';
   $('dataset-details').textContent=`${code} is present in the CSV but has no eligible non-cancelled, non-diverted arrival record.`;
   $('map-provenance').textContent=mapProvenance(catalog.airport);
   $('map-empty').classList.remove('hidden');$('map-empty-copy').textContent='Map view · no qualifying arrival records.';
   $('selection-footer').textContent='No plan selected';syncMap();
  }
 }catch(error){snapshot=null;previewId=null;toast(error.message,true);$('options').innerHTML='<div class="empty">The selected airport could not load. Choose another airport or reload.</div>';}
 finally{setBusy(false);}
}
$('airport-select').addEventListener('change',()=>loadAirport($('airport-select').value));
await loadAirport('JFK');
