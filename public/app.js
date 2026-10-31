const paths={
  layers:'M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
  sliders:'M4 7h16M4 17h16M8 4v6M16 14v6',
  chart:'M4 4v16h16M8 15v-4M13 15V7M18 15V9',
  list:'M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1',
  plane:'m22 2-7 20-4-9-9-4 20-7ZM11 13l6-6',
  info:'M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  clock:'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  play:'m8 5 11 7-11 7V5Z',flask:'M9 3h6M10 3v6L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M8 15h8',
  arrow:'M5 12h14m-5-5 5 5-5 5',shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  bolt:'m13 2-9 12h7l-1 8 10-13h-8l1-7Z',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  check:'m5 12 4 4L19 6',x:'m6 6 12 12M6 18 18 6',alert:'m12 3 10 18H2L12 3ZM12 9v5M12 17h.01',
  tower:'M12 11v10M7 21h10M8 11h8l2-8H6l2 8ZM5 7H2M22 7h-3M9 6h6',
  pilot:'M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v6h4v-6H4Zm16 0h2v6h-4v-6h2ZM18 18c0 3-2 3-6 3',
  ground:'m14 6 4-4 4 4-4 4M14 6 4 16v4h4l10-10M3 3l5 5M16 16l5 5',
  arrowUp:'m7 14 5-5 5 5M12 9v11M5 3h14',refresh:'M20 7a9 9 0 1 0 1 9M20 3v5h-5',
  hash:'M10 3 8 21M16 3l-2 18M4 8h17M3 16h17',file:'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8M8 16h8',
};
const icon=(name,cls='')=>`<svg ${cls?`class="${cls}"`:''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.info}"/></svg>`;
const $=(id)=>document.getElementById(id);
const esc=(value)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function icons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));}
let config,session,plan,validation,result=null,busy=false,events=[],reviews={},proposals={},mode='policy',view='airfield',evaluation=null,auditFilter='all',round=0,needsReplan=false;
let toastTimer;
function toast(message,error=false){$('toast').textContent=message;$('toast').className=`toast show${error?' error':''}`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),5500);}
async function api(route,data){const response=await fetch(route,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const json=await response.json();if(!response.ok)throw new Error(json.error||`Request failed (${response.status}).`);return json;}
function time(minute){if(!Number.isFinite(minute))return '—';const s=session?.scenario;const n=(s?.clock.hour??14)*60+(s?.clock.minute??0)+minute;return `${String(Math.floor(n/60)%24).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
function setSnapshot(s,{keepTrace=false}={}){session=s;result=s.result;plan=s.result?.plan||s.initialPlan;validation=s.validation;evaluation=null;if(!keepTrace){events=[];reviews={};proposals={};round=0;}render();}
async function loadScenario(id='weather',seed=42){if(busy)return toast('Finish the current run before changing scenarios.');try{setSnapshot(await api('/api/sessions',{scenarioId:id,seed}));showView('airfield');}catch(e){toast(e.message,true);}}
function showView(next){if(next!=='airfield')document.body.classList.remove('map-focus');window.scrollTo({top:0,behavior:'instant'});view=next;document.querySelectorAll('.view').forEach(el=>el.classList.toggle('hidden',el.id!==`${view}-view`));document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===view));$('breadcrumb').textContent=view.toUpperCase();const title={airfield:['JFK airfield','Track the plan across the airfield. Inspect aircraft, routes and each agent’s decisions.'],operations:['Departure recovery','Coordinate gates, fuel and runway slots. Reach a plan everyone can accept.'],scenarios:['Scenario lab','Explore resource failures, fuel constraints and cases that require human review.'],evaluation:['Measure the outcome','Compare identical inputs, constraints and objective weights across methods.'],audit:['The decision trail','Inspect every proposal, objection, validation and plan commitment.']}[view];$('page-title').innerHTML=`${title[0]}<span class="title-period">.</span>`;$('page-description').textContent=title[1];if(view==='scenarios')renderScenarios();if(view==='evaluation')renderEvaluation();if(view==='audit')renderAudit();}
function currentMetrics(){return result?.metrics||null;}
function renderMetrics(){
  const m=currentMetrics(),b=session.baseline?.metrics;
  const accepts=Object.values(reviews).filter(r=>r.decision==='ACCEPT'&&r.planVersion===plan?.version&&r.stateVersion===session.scenario.stateVersion).length;
  let status=busy?'Negotiating':result?.status==='consensus'?'Committed':result?.status==='fallback'?'Fallback':result?.status==='handoff'?'Unresolved':'Draft';
  const delta=(value,base)=>value==null?'Available after commitment':base==null?'No feasible baseline':value===base?'Matches deterministic baseline':`${Math.abs(value-base)} min ${value<base?'less':'more'} than baseline`;
  const cards=[
    {label:'TOTAL DEPARTURE DELAY',value:m?.totalDelay??'—',unit:'min',foot:delta(m?.totalDelay,b?.totalDelay),icon:'clock'},
    {label:'ENGINE-ON TIME',value:m?.engineOn??'—',unit:'min',foot:delta(m?.engineOn,b?.engineOn),icon:'plane'},
    {label:'PLAN STATE',value:status,word:true,foot:result?.status==='consensus'?`Plan v${plan.version} · state v${session.scenario.stateVersion}`:result?.status==='fallback'?'Validated deterministic plan':result?.status==='handoff'?'No plan committed':busy?`Round ${round||1} of 3`:'Awaiting independent reviews',icon:'shield'},
    {label:'AGENT AGREEMENT',value:`${accepts}<span style="font-size:20px;color:var(--muted)"> / 3</span>`,raw:true,foot:result?.status==='consensus'?'Same plan. Same state. Same hash.':result?.status==='fallback'?'Fallback is not agent consensus':'Unanimous acceptance required',icon:'layers'},
  ];
  $('metrics').innerHTML=cards.map(c=>`<div class="metric"><div class="metric-label">${c.label}${icon(c.icon)}</div><div class="metric-main"><span class="metric-value${c.word?' word':''}">${c.raw?c.value:esc(c.value)}</span>${c.unit?`<span class="metric-unit">${c.unit}</span>`:''}</div><div class="metric-foot">${c.label==='PLAN STATE'?'<span class="status-dot"></span>':''}${esc(c.foot)}</div></div>`).join('');
}
function renderTimeline(){
  const s=session.scenario,p=plan;
  $('state-label').textContent=`State v${s.stateVersion}`;
  $('plan-pill').textContent=result?.status==='consensus'?`PLAN v${p.version} · COMMITTED`:result?.status==='fallback'?'FALLBACK':result?.status==='handoff'?'NO COMMIT':busy?`PLAN v${p?.version??1} · REVIEW`:'DRAFT';
  $('plan-pill').className=`pill ${result?.status==='consensus'?'committed':result?.status==='handoff'?'failed':busy?'warn':''}`;
  const pct=n=>Math.max(0,Math.min(100,n/s.horizon*100));
  const bar=(start,end,label,cls,title)=>`<div class="flight-bar ${cls}" style="left:${pct(start)}%;width:${Math.max(.6,pct(end)-pct(start))}%" title="${esc(title)}">${esc(label)}</div>`;
  const rows=s.flights.map(f=>{
    const d=p?.departures.find(d=>d.flightId===f.id);
    return `<div class="timeline-row"><div class="lane-label">${esc(f.callsign)}<small>${esc(d?.mode==='remote'?d.standId:f.gate)}</small></div><div class="lane-track"><span class="ready-mark" style="left:${pct(f.ready)}%" title="Ready ${time(f.ready)}"></span>${d?.mode==='remote'?bar(d.towStart,d.towStart+s.towMinutes,'','tow',`${f.callsign}: engine-off tow ${time(d.towStart)}–${time(d.towStart+s.towMinutes)}`):''}${d?bar(d.pushback,d.takeoff,`${d.takeoff-d.pushback}m`,'',`${f.callsign}: pushback ${time(d.pushback)}, takeoff ${time(d.takeoff)}`):''}</div></div>`;
  });
  const arr=s.arrivals.map(a=>{
    const assigned=p?.arrivals.find(x=>x.flightId===a.id)?.standId||a.gate;
    const conflict=validation?.issues.some(i=>i.code==='GATE_CONFLICT'&&i.detail.includes(a.id));
    return `<div class="timeline-row"><div class="lane-label">${esc(a.callsign)}<small>${esc(assigned)}</small></div><div class="lane-track">${bar(a.gateIn,a.clearAt,`${assigned} · ${assigned==='R1'?'remote stand':'gate demand'}`,`inbound${conflict?' conflict':''}`,`${a.callsign}: ${assigned} occupied ${time(a.gateIn)}–${time(a.clearAt)}`)}</div></div>`;
  });
  $('timeline').innerHTML=`<div class="timeline-head"><div class="timeline-head-label">AIRCRAFT / STAND</div><div class="time-axis">${[0,10,20,30,40,50,60].map(t=>`<span>${time(t)}</span>`).join('')}</div></div><div class="capacity-row"><span class="capacity-title">Runway slots</span><div class="capacity-track"><div class="capacity-block" style="width:${pct(s.slots[0])}%">CAPACITY REDUCED</div>${s.slots.map(t=>`<span class="slot-marker" style="left:${pct(t)}%" title="Available ${time(t)}"></span>`).join('')}</div></div>${rows.join('')}<div class="inbound-divider">INBOUND GATE DEMAND</div>${arr.join('')}`;
  $('timeline-note').textContent=result?.status==='consensus'?'All three agents accepted this version. Modeled constraints pass.':result?.status==='fallback'?'Validated fallback schedule. Agent consensus was not reached.':result?.status==='handoff'?'No movement plan committed. Review the unresolved constraints.':busy?'Candidate under review. It is not a committed movement plan.':'Initial runway candidate. Agent review is required before commitment.';
}
const roleInfo={ATC:{name:'Air traffic control',domain:'Runway slots · surface capacity',icon:'tower',cls:'atc',empty:'Assign a departure sequence within the available runway windows.'},PILOT:{name:'Pilot',domain:'Departure fuel · flight readiness',icon:'pilot',cls:'pilot',empty:'Protect flight-specific fuel requirements and operating limits.'},GROUND:{name:'Ground operations',domain:'Gates · stands · equipment',icon:'ground',cls:'ground',empty:'Release gates and coordinate compatible stands and available tugs.'}};
function renderAgents(){
  $('agent-cards').innerHTML=Object.entries(roleInfo).map(([role,info])=>{
    const review=reviews[role],proposal=proposals[role];
    const validReview=review&&review.planVersion===plan?.version&&review.stateVersion===session.scenario.stateVersion;
    const state=validReview?review.decision:proposal?'PROPOSED':busy?'WAITING':'STANDBY';
    const message=validReview&&review.decision==='COUNTER'?review.explanation:proposal?.explanation||review?.explanation||info.empty;
    const engine=review?.engine||proposal?.engine||(mode==='mixed'?(role==='PILOT'?'gemini':'claude'):mode);
    const engineText=engine==='policy'?'LOCAL POLICY':engine.toUpperCase();
    return `<article class="agent-card ${state==='ACCEPT'?'accept':state==='COUNTER'?'counter':''}"><div class="agent-header"><div class="agent-avatar ${info.cls}">${icon(info.icon)}</div><div><div class="agent-name">${info.name}</div><div class="agent-domain">${info.domain}</div></div><span class="pill ${state==='COUNTER'?'warn':state==='ACCEPT'?'committed':''}">${state}</span></div><p class="agent-message">${esc(message)}</p><div class="agent-engine"><span>${engineText}</span><span>${validReview?`v${review.planVersion} · ${esc(review.planHash?.slice(0,6))}`:proposal?`PROPOSAL v${proposal.plan.version}`:'INDEPENDENT SESSION'}</span></div></article>`;
  }).join('');
  $('room-status').textContent=busy?'Negotiating':result?.status==='consensus'?'Agreed':result?.status==='handoff'?'Unresolved':'Ready';
  $('room-dot').className=`status-dot${busy?' loading-dot':''}${result?.status==='handoff'?' amber':''}`;
  const current=Object.values(reviews).filter(r=>r.planVersion===plan?.version&&r.stateVersion===session.scenario.stateVersion);
  $('agreement-dots').innerHTML=['ATC','PILOT','GROUND'].map(r=>{const review=current.find(x=>x.role===r);return `<i class="${review?.decision==='ACCEPT'?'accept':review?.decision==='COUNTER'?'counter':''}"></i>`;}).join('');
  $('agreement-text').textContent=result?.status==='consensus'?'Unanimous, versioned acceptance':result?.status==='fallback'?'Deterministic fallback applied':result?.status==='handoff'?'Human review required':busy?'Reviewing shared candidate':'Waiting for a shared plan';
  $('round-count').textContent=`${round} / 3 rounds`;
}
function renderChecks(){
  const checks=validation?.checks||[];
  $('constraint-summary').textContent=checks.length?`${checks.filter(c=>c.passed).length} / ${checks.length} passing`:'No plan to validate';
  $('constraint-checks').innerHTML=checks.map((c,i)=>`<button class="check-row${c.passed?'':' failed'}" data-check="${i}">${icon(c.passed?'check':'alert')}<span>${esc(c.name)}</span><span>${c.passed?'PASS':'REVIEW'}</span></button>`).join('');
}
function renderFlights(){
  const s=session.scenario;
  $('flight-count').textContent=`${s.flights.length} aircraft`;
  $('flight-rows').innerHTML=s.flights.map(f=>{
    const d=plan?.departures.find(d=>d.flightId===f.id),margin=d?f.fuel-f.fuelRate*(d.takeoff-d.pushback)-f.requiredDepartureFuel:null;
    const low=margin!=null&&margin<=60;
    const valid=d&&!validation?.issues.some(i=>i.flightId===f.id);
    const status=result?.status==='handoff'?'NO COMMIT':result?.plan&&valid?'CHECKED':busy?'REVIEW':'DRAFT';
    return `<tr><td>${esc(f.callsign)}<small>${esc(d?.mode==='remote'?`${f.gate} → ${d.standId}`:f.gate)}</small></td><td>${time(f.ready)}</td><td>${time(d?.pushback)}</td><td>${time(d?.takeoff)}</td><td>${d?`+${Math.max(0,d.takeoff-f.scheduled)} min`:'—'}</td><td><div class="fuel-cell${low?' low':''}"><div class="fuel-track"><i style="width:${margin==null?0:Math.max(0,Math.min(100,margin/(f.fuel-f.requiredDepartureFuel)*100))}%"></i></div><span>${margin==null?'—':`${Math.round(margin)} kg`}</span></div></td><td><span class="table-state ${status==='DRAFT'?'draft':status==='NO COMMIT'?'failed':''}">${status}</span></td></tr>`;
  }).join('');
}
function render(){
  if(!session)return;
  const s=session.scenario;
  $('scenario-eyebrow').textContent=s.name.toUpperCase();$('airport-crumb').textContent=`${s.airport.code} · ${s.airport.name.toUpperCase()}`;$('clock').textContent=time(s.now);$('provenance-label').textContent=s.provenance.label;$('footer-seed').textContent=`SEED ${s.seed} · STATE v${s.stateVersion}`;
  const shownMode=busy?mode:result?.mode||mode;
  $('engine-label').textContent=(shownMode==='policy'?'Local policy agents · no LLM calls':shownMode==='mixed'?'Live APIs · Claude + Gemini':`Live API · ${shownMode==='claude'?'Claude':'Gemini'}`)+(result&&result.mode!==mode&&!busy?` · next run: ${mode}`:'');
  $('run-button').disabled=busy;$('run-button').innerHTML=busy?`${icon('refresh','spin')}<span>Negotiating…</span>`:`${icon('play')}<span>${result?'Run again':'Run negotiation'}</span>`;
  $('scenario-button').disabled=busy;$('timeout-button').disabled=busy;$('audit-count').textContent=events.length;
  renderMetrics();renderTimeline();renderAgents();renderChecks();renderFlights();syncAirfield();
  if(view==='audit')renderAudit();if(view==='evaluation')renderEvaluation();
  const old=$('failure-notice');if(old)old.remove();
  if(result?.status==='handoff'){
    const notice=document.createElement('div');notice.id='failure-notice';notice.className='failure-notice';notice.innerHTML=`${icon('alert')}<div><strong>No validated plan found. Human review required.</strong><p>The bounded negotiation and fallback could not resolve this scenario. No movement plan was committed. This is not a proof of mathematical infeasibility.</p></div>`;$('operations-view').prepend(notice);
  }
}
function recordEvent(event){
  events.push(event);$('audit-count').textContent=events.length;
  if(event.stateVersion!==session.scenario.stateVersion){if(view==='audit')renderAudit();return;}
  if(event.round)round=event.round;
  if(event.type==='proposal'){plan=event.plan;proposals[event.agent]=event;reviews={};}
  if(event.type==='validation')validation=event.validation;
  if(event.type==='review')reviews[event.role]=event;
  if(event.type==='committed'){plan=event.plan;validation=event.validation;result={status:event.source==='consensus'?'consensus':'fallback',metrics:event.metrics,plan:event.plan};}
  render();
}
async function run(forceTimeout=false){
  if(busy)return;
  busy=true;result=null;reviews={};proposals={};round=0;evaluation=null;render();
  try{
    const response=await fetch(`/api/sessions/${session.id}/run`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode,maxRounds:3,forceTimeout})});
    if(!response.ok){const b=await response.json();throw new Error(b.error||'Negotiation failed.');}
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const part=buffer.slice(0,end);buffer=buffer.slice(end+2);if(part.startsWith(':'))continue;const type=part.match(/^event: (.+)$/m)?.[1],data=part.match(/^data: (.+)$/m)?.[1];if(!data)continue;const event=JSON.parse(data);if(type==='trace')recordEvent(event);else if(type==='result'){session=event.snapshot;result=event.result;if(result.status!=='invalidated'){plan=result.plan||session.initialPlan;validation=result.validation||session.validation;}else needsReplan=true;}else if(type==='failure')throw new Error(event.error);}}
    if(!result)throw new Error('Negotiation stream ended without a result.');
    if(result.status==='consensus')toast(`Agreement reached in ${result.rounds} rounds. Plan v${result.plan.version} committed.`);
    else if(result.status==='fallback')toast('Deterministic fallback committed a validated plan.');
    else if(result.status==='handoff')toast('No validated plan found. Review the unresolved constraints.',true);
  }catch(error){toast(error.message,true);try{const current=await api(`/api/sessions/${session.id}`);session=current;result=current.result;plan=current.result?.plan||current.initialPlan;validation=current.validation;}catch{}}
  finally{busy=false;render();if(needsReplan&&$('auto-replan').checked){needsReplan=false;run();}else needsReplan=false;}
}
async function inject(updateOrText){
  try{
    const payload=typeof updateOrText==='string'?{text:updateOrText}:{update:updateOrText};
    const next=await api(`/api/sessions/${session.id}/update`,payload);
    session=next;result=null;plan=next.initialPlan;validation=next.validation;reviews={};proposals={};evaluation=null;
    events.push({type:'state_updated',stateVersion:next.scenario.stateVersion,time:new Date().toISOString(),explanation:'Previous acceptances invalidated.',update:payload});
    $('update-input').value='';render();toast(`State v${session.scenario.stateVersion}. Previous acceptances invalidated.`);
    if($('auto-replan').checked){if(busy)needsReplan=true;else run();}
  }catch(error){toast(error.message,true);}
}
function dialog(title,html){$('dialog-title').textContent=title;$('dialog-content').innerHTML=html;icons($('detail-dialog'));if(!$('detail-dialog').open)$('detail-dialog').showModal();}
function assumptions(){
  const s=session.scenario;
  dialog('What is real. What is simulated.',`<p>${esc(s.provenance.label)}.</p><div class="dialog-note">This prototype coordinates a simplified airport model. It does not issue operational clearances or establish real-world aviation safety.</div><ul>${s.assumptions.map(a=>`<li>${esc(a)}</li>`).join('')}</ul><p>The supplied lookup tables contain <strong>${config.lookups.airports} airports</strong> and <strong>${config.lookups.airlines} airlines</strong>. They provide identities, not gate, fuel, capacity or cost data.</p>${s.provenance.source?`<p>Selected historical trigger:</p><pre>${esc(JSON.stringify(s.provenance.source,null,2))}</pre>`:'<p>Historical flight-level data is not loaded. Import a CSV subset in Scenario lab to select a qualifying trigger.</p>'}<p>Objective weights are explicit simulation preferences:</p><pre>${esc(JSON.stringify(s.weights,null,2))}</pre><p>Fuel quantities and burn rates are illustrative. Engine-on time is measured directly inside this model.</p>`);
}
function renderScenarios(){
  $('scenarios-view').innerHTML=`<div class="view-heading"><div><h2>Choose the operational challenge</h2><p>All operational states are simulated. Each scenario exercises a different constraint.</p></div><label class="seed-control">SCENARIO SEED <input id="seed-input" type="number" min="0" max="999999" value="${session.scenario.seed}"></label></div><div class="scenario-grid">${config.scenarios.map((s,i)=>`<button class="scenario-card${session.scenario.id===s.id?' selected':''}" data-scenario="${s.id}" ${busy?'disabled':''}><span class="scenario-icon">${icon(['plane','ground','shield','alert'][i])}</span><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><span class="pill">${esc(s.tag)}</span></button>`).join('')}</div><section class="panel import-panel"><h2>Bring a historical trigger</h2><p>Upload a flight-level CSV subset (up to 2 MB). We select records where <code>WEATHER_DELAY &gt; 15 OR LATE_AIRCRAFT_DELAY &gt; 20</code>. Selection changes the trigger identity and provenance; operational state remains simulated.</p><input id="flight-import" type="file" accept=".csv,text/csv" aria-label="Import flight CSV"><div id="import-results" class="import-results"></div><p class="tiny-muted">Airport and airline lookup files are bundled. They do not contain qualifying flight records.</p></section>`;
}
async function importFlights(file){
  if(!file)return;if(file.size>2_000_000)return toast('Upload a CSV subset smaller than 2 MB.',true);
  try{const imported=await api(`/api/sessions/${session.id}/import`,{csv:await file.text()});$('import-results').innerHTML=`<div class="${imported.qualifying?'success':'error'}-banner">${imported.qualifying} qualifying records out of ${imported.total}.${imported.truncated?' Showing the first 100.':''}</div>${imported.rows.map((r,i)=>`<div class="import-row"><strong>${esc(r.airline)} ${esc(r.flightNumber)}</strong><span>${esc(r.origin)} → ${esc(r.destination)}</span><span>Weather ${r.weatherDelay??'unknown'}m / late aircraft ${r.lateAircraftDelay??'unknown'}m</span><button data-trigger="${i}">Use trigger ↗</button></div>`).join('')}`;}catch(e){toast(e.message,true);}
}
function renderEvaluation(){
  if(!evaluation){$('evaluation-view').innerHTML=`<div class="view-heading"><div><h2>Benchmark the current state</h2><p>Each method receives the same operational inputs and hard constraints.</p></div><button class="secondary-button" id="evaluate-button" ${busy?'disabled':''}>${icon('chart')}Evaluate scenario</button></div><div class="empty-state">${icon('chart')}<h3>Evidence before claims.</h3><p>Compare the agent result with a deterministic fallback and a bounded search reference.<br>Run a negotiation first to include an agent result.</p></div><div class="method-note"><strong>Two separate questions:</strong> Did the agents communicate and reach agreement? How good is the resulting schedule? A superior schedule is not presumed. Local policy mode is not an LLM evaluation.</div>`;return;}
  const methods=[{name:result?.status==='fallback'?'Negotiation → fallback':'Agent negotiation',tag:result?.status==='fallback'?'FALLBACK OUTCOME':(result?.mode||mode)==='policy'?'LOCAL POLICY AGENTS':'LIVE API AGENTS',m:evaluation.negotiated,explanation:result?.status==='fallback'?'Negotiation did not reach agreement. These are deterministic fallback metrics, not agent-consensus results.':'The latest agent-consensus result for this scenario state. Uncommitted runs have no outcome metrics.'},{name:'Deterministic fallback',tag:'FIXED ORDERS + REPAIR',m:evaluation.baseline.metrics,explanation:evaluation.baseline.method},{name:'Search reference',tag:`${evaluation.reference.evaluated} ORDERS SEARCHED`,m:evaluation.reference.metrics,explanation:evaluation.reference.method}];
  $('evaluation-view').innerHTML=`<div class="view-heading"><div><h2>Identical inputs. Comparable outcomes.</h2><p>Scenario state v${evaluation.stateVersion} · weighted score is lower-is-better, not a currency estimate.</p></div><button class="secondary-button" id="evaluate-button">${icon('refresh')}Re-evaluate</button></div><div class="evaluation-grid">${methods.map(method=>`<article class="panel evaluation-card"><span class="pill">${esc(method.tag)}</span><h3>${method.name}</h3><div class="evaluation-number">${method.m?.score??'—'}</div><div class="evaluation-label">WEIGHTED SIMULATION SCORE</div><div class="evaluation-stats">${[['Departure delay',method.m?`${method.m.totalDelay} min`:'Unavailable'],['Engine-on time',method.m?`${method.m.engineOn} min`:'Unavailable'],['Inbound remote stands',method.m?.remoteArrivals??'—'],['Tow movements',method.m?.tows??'—'],['Worst-flight delay',method.m?`${method.m.worstDelay} min`:'Unavailable']].map(([k,v])=>`<div class="evaluation-stat"><span>${k}</span><strong>${v}</strong></div>`).join('')}</div><p class="evaluation-explanation">${esc(method.explanation)}</p></article>`).join('')}</div><div class="method-note"><strong>No global-optimum claim.</strong> The reference enumerates departure orders but uses earliest-slot assignment and local stand/tug repair; it does not exhaust all scheduling decisions. Identical validators apply to all methods. An unresolved search result is not a proof of infeasibility.<br><br><strong>Objective:</strong> ${Object.entries(session.scenario.weights).map(([key,v])=>`${esc(key)} × ${v}`).join(' + ')}. These are configurable simulation preferences. All outcomes describe this simplified model.</div>`;
}
async function evaluate(){const button=$('evaluate-button');if(button){button.disabled=true;button.textContent='Evaluating…';}try{evaluation=await api(`/api/sessions/${session.id}/evaluate`,{});renderEvaluation();}catch(e){toast(e.message,true);renderEvaluation();}}
function renderAudit(){
  const filter=(e)=>auditFilter==='all'||auditFilter==='reviews'&&e.type==='review'||auditFilter==='plans'&&['proposal','committed','invalidated','state_updated'].includes(e.type)||auditFilter==='failures'&&['fallback','handoff','agent_error','no_candidate'].includes(e.type);
  $('audit-view').innerHTML=`<div class="view-heading"><div><h2>An inspectable record</h2><p>${events.length} events in this browser session. Export includes server-side run snapshots.</p></div><button class="secondary-button" data-export>${icon('download')}Export JSON</button></div><div class="audit-toolbar">${[['all','All events'],['reviews','Agent reviews'],['plans','Plan changes'],['failures','Fallback & failures']].map(([id,label])=>`<button class="filter-button${auditFilter===id?' selected':''}" data-filter="${id}">${label}</button>`).join('')}</div>${events.filter(filter).length?`<div class="audit-events">${events.map((e,i)=>({e,i})).filter(({e})=>filter(e)).map(({e,i})=>`<details class="audit-event"><summary><span class="event-seq">${String(i+1).padStart(2,'0')}</span><span class="event-type">${esc(e.type.replaceAll('_',' ').toUpperCase())}</span><span class="event-desc">${esc(e.agent||e.role||'Coordinator')}${e.explanation?` · ${esc(e.explanation)}`:e.type==='validation'?` · ${e.validation.valid?'All modeled checks pass':`${e.validation.issues.length} constraint findings`}`:''}</span><span class="event-meta">STATE v${e.stateVersion}${e.round?` · R${e.round}`:''}</span></summary><pre>${esc(JSON.stringify(e,null,2))}</pre></details>`).join('')}</div>`:`<div class="empty-state">${icon('list')}<h3>${events.length?'No events match this filter.':'The record begins with a decision.'}</h3><p>Run a negotiation to inspect structured proposals, independent reviews and constraint results.</p></div>`}`;
}
function providersDialog(){
  const available={policy:true,claude:config.providers.claude.available,gemini:config.providers.gemini.available,mixed:config.providers.claude.available&&config.providers.gemini.available};
  dialog('Choose the agent engine',`<p>Three separate domain agents review the same plan. Local mode uses deterministic policies. Live modes make independent provider API calls; they never silently masquerade as local runs.</p><div class="provider-grid">${[['policy','Local policy agents','Works offline. Independent rules and tools; no LLM calls.'],['claude','Claude','Three independent Claude domain sessions.'],['gemini','Gemini','Three independent Gemini domain sessions.'],['mixed','Claude + Gemini','ATC and Ground use Claude. Pilot uses Gemini.']].map(([id,name,desc])=>`<button class="provider-option${mode===id?' active':''}" data-mode="${id}" ${!available[id]||busy?'disabled':''}><h3>${name}</h3><p>${desc}</p><small>${available[id]?(mode===id?'SELECTED':'AVAILABLE'):'SERVER CONFIG REQUIRED'}</small></button>`).join('')}</div><div class="dialog-note">To enable live mode, copy <code>.env.example</code> to <code>.env</code> in the project folder, set your provider API key and a supported model ID, then restart the server. Keys stay server-side and are excluded from audit exports. No API key is bundled.</div><p>Live requests transmit this scenario and agent history to the selected provider. This prototype defaults to synthetic data.</p><p>Provider adapters are included; live requests require configured credentials and have not been exercised without them.</p>`);
}
let airfieldMode='plan';
function syncAirfield(){
  const frame=$('airfield-frame');if(!session||!frame?.contentWindow)return;
  const text=result?.status==='consensus'?`Consensus · plan v${plan.version} · state v${session.scenario.stateVersion}`:result?.status==='fallback'?`Validated fallback · state v${session.scenario.stateVersion}`:result?.status==='handoff'?'Unresolved · no movements':busy?'Agents negotiating…':`Draft · state v${session.scenario.stateVersion}`;
  $('airfield-status').textContent=text;
  if(airfieldMode==='plan')frame.contentWindow.postMessage({type:'clearance:state',payload:{scenario:session.scenario,plan,validation,result,reviews,proposals,events:events.slice(-70),busy,mode}},location.origin);
}
window.addEventListener('message',event=>{
  const frame=$('airfield-frame');if(event.origin!==location.origin||event.source!==frame?.contentWindow)return;
  if(event.data?.type==='clearance:ready')syncAirfield();
  if(event.data?.type==='clearance:run'&&!busy)run();
  if(event.data?.type==='clearance:tug-outage')inject({kind:'resource_outage',resourceId:'TUG2',start:0,end:14});
});
function exportAudit(){const link=document.createElement('a');link.href=`/api/sessions/${session.id}/export`;link.download='clearance-audit.json';link.click();}

document.addEventListener('click',async event=>{
  const mapMode=event.target.closest('[data-map-mode]');if(mapMode){airfieldMode=mapMode.dataset.mapMode;document.querySelectorAll('[data-map-mode]').forEach(b=>b.setAttribute('aria-pressed',b===mapMode));$('airfield-frame').src=airfieldMode==='plan'?'/jfk-plan.html':'/jfk-demo.html';$('airfield-mode-note').textContent=airfieldMode==='plan'?'Connected to the current Clearance plan. Replay is available after consensus or validated fallback.':'Original standalone rule-based simulation from your HTML. Its random traffic and Tower/Ground/Sentinel controllers run separately from Clearance plans; no LLM calls.';return;}
  const nav=event.target.closest('[data-view]');if(nav)return showView(nav.dataset.view);
  const scenario=event.target.closest('[data-scenario]');if(scenario){const seed=Number($('seed-input')?.value??42);return loadScenario(scenario.dataset.scenario,seed);}
  const check=event.target.closest('[data-check]');if(check){const c=validation.checks[Number(check.dataset.check)];return dialog(c.name,`<span class="pill ${c.passed?'committed':'warn'}">${c.passed?'PASS':'REVIEW REQUIRED'}</span><p>Domain owner: ${esc(c.owner)}. This check evaluates the current modeled plan.</p>${c.issues.length?`<ul>${c.issues.map(i=>`<li><strong>${esc(i.code)}</strong><br>${esc(i.detail)}</li>`).join('')}</ul>`:'<p>No violations of this modeled constraint were found.</p>'}`);}
  const preset=event.target.closest('[data-update]');if(preset){const kind=preset.dataset.update;return inject(kind==='tug'?{kind:'resource_outage',resourceId:'TUG2',start:0,end:14}:kind==='runway'?{kind:'capacity',until:26}:{kind:'stand_closed',standId:'R1'});}
  const provider=event.target.closest('[data-mode]');if(provider&&!provider.disabled){mode=provider.dataset.mode;$('detail-dialog').close();render();toast(`Agent engine: ${mode==='policy'?'local policies (no LLM calls)':mode}.`);return;}
  const filter=event.target.closest('[data-filter]');if(filter){auditFilter=filter.dataset.filter;return renderAudit();}
  const trigger=event.target.closest('[data-trigger]');if(trigger){try{setSnapshot(await api(`/api/sessions/${session.id}/trigger`,{index:Number(trigger.dataset.trigger)}));showView('operations');toast('Historical trigger selected. Operational state remains simulated.');}catch(e){toast(e.message,true);}return;}
  if(event.target.closest('[data-export]'))return exportAudit();
  if(event.target.closest('#evaluate-button'))return evaluate();
});
$('run-button').addEventListener('click',()=>run());$('timeout-button').addEventListener('click',()=>run(true));$('scenario-button').addEventListener('click',()=>showView('scenarios'));$('settings-button').addEventListener('click',providersDialog);$('provenance-button').addEventListener('click',assumptions);$('close-dialog').addEventListener('click',()=>$('detail-dialog').close());$('export-button').addEventListener('click',exportAudit);
$('update-form').addEventListener('submit',e=>{e.preventDefault();const text=$('update-input').value.trim();if(text)inject(text);else toast('Enter a disruption or choose a preset.');});
document.addEventListener('change',e=>{if(e.target.id==='flight-import')importFlights(e.target.files[0]);});
$('plan-details').addEventListener('click',()=>dialog('Current plan',`<p>${result?.status==='consensus'?'Unanimous agent agreement.':result?.status==='fallback'?'Deterministic fallback, not agent consensus.':'Candidate only. No agent consensus committed.'} State v${session.scenario.stateVersion}.</p><pre>${esc(JSON.stringify(plan,null,2))}</pre>`));
$('about-button').addEventListener('click',()=>dialog('How Clearance works',`<p>Clearance coordinates a shared departure-recovery plan across three independent domain agents.</p><ol><li><strong>ATC proposes</strong> a departure sequence.</li><li><strong>Pilot and Ground review</strong> their own constraints and counter-propose when needed.</li><li><strong>Code validates</strong> the plan. Agents cannot waive hard limits.</li><li><strong>All three accept</strong> the same plan hash and scenario version before commitment.</li><li><strong>Updates invalidate agreement.</strong> A round limit and request deadline trigger deterministic fallback; unresolved cases require human review.</li></ol><p>The initial demo uses synthetic operational state. Policy-agent mode runs without credentials. Optional Claude and Gemini adapters use separate requests and domain prompts.</p><p>All movement decisions are simulated. No elapsed movement is executed by this prototype.</p>`));
$('map-focus-button').addEventListener('click',()=>{const active=document.body.classList.toggle('map-focus');$('map-focus-button').textContent=active?'Exit expanded view':'Expand map';});
$('map-audit-button').addEventListener('click',()=>showView('audit'));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('map-focus')){document.body.classList.remove('map-focus');$('map-focus-button').textContent='Expand map';}});
$('airfield-frame').addEventListener('load',syncAirfield);
icons();
try{config=await api('/api/config');await loadScenario();}catch(e){$('page-description').textContent='The local server could not be reached. Start the project server and reload.';toast(e.message,true);}
