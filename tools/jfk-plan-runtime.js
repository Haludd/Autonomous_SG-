
/* Clearance bridge. The supplied map geometry is preserved; its independent
   random traffic controller is replaced by a replay of the accepted plan. */
const canvasLayout=new URLSearchParams(location.search).get('layout')==='canvas';
document.documentElement.classList.toggle('canvas-layout',canvasLayout);
const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gateAlias={G1:'T8-8',G2:'T8-12',G3:'T4-B24',G4:'T4-B27',G5:'T5-9',G6:'T7-G7',G7:'T4-A5',G8:'T5-14',G9:'T1-3'};
node('G_R1',345,320);edge('G_R1','L165','remote',true);
const position=id=>{const n=NODES[id==='R1'?'G_R1':'G_'+gateAlias[id]];return n?[n.x,n.y]:[CX,CY];};
const displayStand=id=>id==='R1'?'R1 · remote apron':`${id} · ${gateAlias[id]?.replace('-',' / ')||'unmapped'}`;
const PLANE='M0,-9 L1.5,-6.5 L1.5,-2 L8.5,2.2 L8.5,3.6 L1.5,2 L1.1,6 L3.6,8 L3.6,9.2 L0,8.4 L-3.6,9.2 L-3.6,8 L-1.1,6 L-1.5,2 L-8.5,3.6 L-8.5,2.2 L-1.5,-2 L-1.5,-6.5 Z';
const map=$('map');
map.insertBefore($('gStands'),$('gPlanes'));
map.insertBefore($('gResources'),$('gPlanes'));
const remote=document.createElementNS(NS,'g');
remote.innerHTML='<rect x="325" y="303" width="40" height="34" rx="3" fill="var(--apron)" stroke="var(--gnd)" stroke-dasharray="4 3"/><text x="345" y="295" text-anchor="middle" class="remote-label">REMOTE R1</text>';
$('static').appendChild(remote);
let data=null,minute=0,playing=false,speed=2,selected=canvasLayout?null:{kind:'flight',id:'F1'},signature='',lastFrame=performance.now(),lastUI=0,zoom={x:0,y:0,w:1200,h:800},drag=null,moved=false;
const overlay={routes:true,gates:true,labels:true};
const phaseNames={GATE:'At gate',TOW:'Engine-off tow',REMOTE:'Remote stand',PUSHBACK:'Pushback',TAXI:'Taxiing',HOLD:'Holding short',DEPARTED:'Departed',EXPECTED:'Inbound gate demand',ON_STAND:'On stand',INBOUND:'Inbound approach',HOLDING:'Holding pattern',ARRIVAL_TAXI:'Taxi to assigned gate',TURNAROUND:'Turnaround'};
function time(t=minute,seconds=false){const total=(data?.scenario.clock.hour??14)*3600+(data?.scenario.clock.minute??0)*60+Math.round(t*60);return [Math.floor(total/3600)%24,Math.floor(total/60)%60,...(seconds?[total%60]:[])].map(v=>String(v).padStart(2,'0')).join(':');}
const send=(type,payload={})=>{if(window.parent!==window)window.parent.postMessage({type,...payload},location.origin);};
const committed=()=>Boolean(data?.recovery?data.recovery.validated&&data.result.stateVersion===data.scenario.stateVersion:data?.result?.plan&&['consensus','fallback'].includes(data.result.status)&&data.result.stateVersion===data.scenario.stateVersion);
function geometry(f,d){
  const from=d?.mode==='remote'?'G_R1':'G_'+gateAlias[f.gate];
  const taxi=route(from,'H4L')?.pts||[position(f.gate),H4L];
  const tow=route('G_'+gateAlias[f.gate],'G_R1')?.pts||[position(f.gate),position('R1')];
  return {gate:position(f.gate),remote:position('R1'),taxi,tow,towMinutes:data.scenario.towMinutes,runway:[H4L,RWY['4L'].thr,RWY['4L'].end,at(RWY['4L'],RWY['4L'].len+100)]};
}
function records(){
  if(!data)return [];
  const s=data.scenario,p=data.plan;
  return s.flights.map(f=>{const d=p?.departures.find(d=>d.flightId===f.id);const g=geometry(f,d);const state=aircraftAt(f,committed()?d:null,minute,g);return {id:f.id,callsign:f.callsign,kind:'dep',flight:f,departure:d,geometry:g,...state};});
}
function inboundRecords(){
  if(!data)return [];
  if(data.recovery){
    const a=data.scenario.arrivals[0],assignment=data.plan.arrivals[0],gate=position(assignment.standId);
    const taxi=route('X4R','G_'+gateAlias[assignment.standId])?.pts||[RWY['4R'].thr,gate];
    const departureTaxi=route('G_'+gateAlias[assignment.standId],'H4L')?.pts||[gate,H4L];
    const geometry={gate,hold:[1020,160],approach:data.recovery.metrics.arrivalDelay?[[1160,90],[1020,160]]:[[1160,90],[1020,160],RWY['4R'].thr],arrivalTaxi:[RWY['4R'].thr,...taxi],departureTaxi,runway:[H4L,RWY['4L'].thr,RWY['4L'].end,at(RWY['4L'],RWY['4L'].len+100)]};
    const state=recoveryArrivalAt({baselineLanding:data.recovery.baselineETA-data.scenario.target.arrivalTaxi,landing:assignment.landing,gateIn:assignment.gateIn,ready:data.recovery.metrics.ready,nextDeparture:data.plan.nextDeparture},minute,geometry);
    return [{...state,id:a.id,callsign:a.callsign,kind:'arr',stand:assignment.standId,arrival:a,geometry}];
  }
  return data.scenario.arrivals.map((a,i)=>{
    const assignment=data.plan?.arrivals.find(x=>x.flightId===a.id),stand=assignment?.standId||a.gate;
    const arrived=committed()&&minute>=a.gateIn;
    const [x,y]=arrived?position(stand):[960+i*95,220+i*55];
    return {id:a.id,callsign:a.callsign,kind:'arr',phase:arrived?'ON_STAND':'EXPECTED',x,y,heading:230,visible:!committed()||minute<a.clearAt,stand,arrival:a};
  });
}
function planFinding(id){return data?.validation?.issues.some(i=>i.flightId===id)||false;}
function renderPlanes(all){
  $('gPlanes').innerHTML=all.filter(p=>p.visible).map(p=>{
    const sel=selected?.kind==='flight'&&selected.id===p.id,conf=planFinding(p.id),hold=['GATE','REMOTE','HOLD'].includes(p.phase);
    return `<g class="ac ${p.kind}${sel?' sel':''}${conf?' conf':''}${hold?' hold':''}" data-flight="${escapeHTML(p.id)}" role="button" tabindex="0" aria-label="Select ${escapeHTML(p.callsign)}" transform="translate(${p.x.toFixed(2)},${p.y.toFixed(2)})"><title>${escapeHTML(p.callsign)} · ${phaseNames[p.phase]}</title><circle class="ring" r="19"/><path class="body" d="${PLANE}" transform="rotate(${p.heading}) scale(1.25)"/>${overlay.labels?`<text class="cs" x="17" y="-8">${escapeHTML(p.callsign)}</text><text class="ph" x="17" y="6">${escapeHTML(p.phase==='EXPECTED'?`DUE ${time(p.arrival.gateIn)}`:phaseNames[p.phase])}</text>`:''}</g>`;
  }).join('');
}
function renderRoutes(all){
  $('gRoutes').innerHTML=all.filter(p=>p.kind==='dep'&&p.departure&&(overlay.routes||selected?.id===p.id)).map(p=>{
    const sel=selected?.id===p.id;
    let markup=`<polyline class="route g" points="${P(p.geometry.taxi)}" style="opacity:${sel ? 0.95 : selected?.kind==='flight' ? 0.15 : 0.3};stroke-width:${sel?3:1.5};stroke-dasharray:${committed()?'none':'5 5'}"/>`;
    if(p.departure.mode==='remote')markup+=`<polyline class="route tow-route" points="${P(p.geometry.tow)}" style="opacity:${sel?1:.3}"/>`;
    return markup;
  }).join('');
  if(data.recovery&&overlay.routes){const a=all.find(p=>p.kind==='arr');if(a){$('gRoutes').innerHTML+=`<polyline class="route g recovery-arrival-route" points="${P(a.geometry.arrivalTaxi)}"/><polyline class="route t" points="${P(a.geometry.approach)}" style="opacity:.35"/>${data.recovery.metrics.arrivalDelay?'<ellipse cx="1020" cy="160" rx="28" ry="18" fill="none" stroke="var(--sen)" stroke-width="2" stroke-dasharray="4 3"/>':''}`;}}
}
function renderStands(){
  const s=data.scenario,intervals=standIntervals(s,data.plan),conflicts=gateConflicts(s,data.plan);
  $('gStands').innerHTML=overlay.gates?s.stands.map(stand=>{
    const [x,y]=position(stand.id),occupied=intervals.filter(i=>i.stand===stand.id&&i.start<=minute&&minute<i.end),conflict=conflicts.some(c=>c.stand===stand.id),closed=stand.compatible.length===0;
    return `<g class="map-stand${conflict?' conflict':''}${closed?' closed':''}${occupied.length?' occupied':''}" data-stand="${stand.id}" role="button" tabindex="0" aria-label="Inspect stand ${stand.id}"><circle cx="${x}" cy="${y}" r="13"/><text x="${x}" y="${y+27}" text-anchor="middle">${stand.id}${closed?' ×':''}</text><title>${displayStand(stand.id)} · ${closed?'unavailable':occupied.length?'occupied':'free'}${conflict?' · planned occupancy conflict':''}</title></g>`;
  }).join(''):'';
  const tug2=s.resources.find(r=>r.id==='TUG2'),outage=tug2.outages.find(o=>o.start<=minute&&minute<o.end);
  $('gResources').innerHTML=data.recovery?'':`<g class="map-tug${outage?' unavailable':''}" transform="translate(309,345)"><rect x="-7" y="-5" width="14" height="10" rx="2"/><circle cx="-4" cy="6" r="2"/><circle cx="4" cy="6" r="2"/><text x="-7" y="24">TUG 2${outage?' OFFLINE':''}</text></g>`;
  $('gConf').innerHTML=conflicts.map(c=>{const [x,y]=position(c.stand);return `<circle class="planned-conflict" cx="${x}" cy="${y}" r="23"><title>${c.stand} overlap ${time(c.start)}–${time(c.end)}</title></circle>`;}).join('');
}
function renderLocks(all){
  for(const id in LOCKEL)LOCKEL[id].setAttribute('class','rlock');
  if(data.recovery){xEl.setAttribute('class','xlock');return;}
  const restriction=minute<data.scenario.slots[0];
  const active=all.find(p=>p.kind==='dep'&&p.phase==='DEPARTED'&&p.visible);
  LOCKEL['4L'].setAttribute('class',`rlock${restriction?' restricted':active?' on':''}`);
  xEl.setAttribute('class','xlock');
}
function renderInspector(all){
  const info=$('info');
  if(!selected){info.hidden=true;return;}
  const close='<button class="x" type="button" aria-label="Close aircraft details" id="infoX">×</button>';
  if(selected.kind==='stand'){
    const id=selected.id,intervals=standIntervals(data.scenario,data.plan).filter(i=>i.stand===id),findings=gateConflicts(data.scenario,data.plan).filter(c=>c.stand===id);
    info.innerHTML=`<div class="h"><b>${displayStand(id)}</b>${close}</div><dl><dt>Mapped location</dt><dd>Simulated assignment</dd>${intervals.map(i=>`<dt>${escapeHTML(i.id)}</dt><dd>${time(i.start)}–${time(i.end)}</dd>`).join('')}</dl>${findings.length?'<p class="inspector-alert">Planned occupancy overlap. No accepted movement plan.</p>':''}`;
  }else{
    const p=all.find(p=>p.id===selected.id);if(!p){info.hidden=true;return;}
    const d=p.departure,f=p.flight;
    info.innerHTML=`<div class="h"><b>${escapeHTML(p.callsign)}</b><span class="chip ${p.kind==='arr'?'m':p.plannedMargin<0?'a':'g'}">${p.phase}</span>${close}</div><dl><dt>Status</dt><dd>${phaseNames[p.phase]}</dd><dt>Stand</dt><dd>${escapeHTML(displayStand(p.stand||(d?.mode==='remote'?'R1':f.gate)))}</dd>${d?`<dt>ATC slot</dt><dd>${time(d.takeoff)} · 4L depiction</dd><dt>Pilot fuel margin</dt><dd class="pilot-value">${Math.round(p.plannedMargin??(f.fuel-(d.takeoff-d.pushback)*f.fuelRate-f.requiredDepartureFuel))} kg at departure</dd><dt>Ground plan</dt><dd>${d.mode==='remote'?'Tow → remote stand → taxi':'Gate hold → pushback → taxi'}</dd>`:p.arrival?`<dt>Gate demand</dt><dd>${time(p.arrival.gateIn)}</dd>`:'<dt>Schedule</dt><dd>No complete candidate available</dd>'}<dt>Plan</dt><dd>${committed()?`${data.result.status} · v${data.plan.version}`:'Draft only'}</dd></dl>`;
  }
    if(data.recovery&&selected.kind==='flight'&&selected.id==='IN1'){
      const m=data.recovery.metrics,a=data.plan.arrivals[0];
      info.innerHTML=`<div class="h"><b>${escapeHTML(data.scenario.arrivals[0].callsign)}</b><span class="chip g">${data.recovery.selected?'CHOSEN':'PREVIEW'}</span>${close}</div><dl><dt>Option</dt><dd>${escapeHTML(data.recovery.title)}</dd><dt>Arrival / gate</dt><dd>${time(a.gateIn)} · ${a.standId}</dd><dt>Extra hold / burn</dt><dd>${m.arrivalDelay} min · ${m.holdingFuel} kg</dd><dt>Protected fuel margin</dt><dd class="pilot-value">${Math.round(m.fuelMargin)} kg</dd><dt>Turnaround ready</dt><dd>${time(m.ready)}</dd><dt>Onward crew margin</dt><dd>${m.crewMargin} min</dd></dl>`;
    }
    info.hidden=false;$('infoX').onclick=()=>{selected=null;render();};
}
function renderPanel(all){
  $('clock').textContent=time(minute,true);$('replayClock').textContent=time();$('replayTime').value=minute;
  $('replayEnd').textContent=time(data.scenario.horizon);
  const roles={TWR:'ATC',GND:'GROUND',PILOT:'PILOT'};
  for(const [key,role] of Object.entries(roles)){
    const review=data.reviews?.[role],proposal=data.proposals?.[role],events=data.events||[];
    $('n'+key).textContent=`${events.filter(e=>e.agent===role||e.role===role).length} msg`;
    $('l'+key).textContent=(data.recovery&&review?`${review.efficiency}/100 · ${review.decision}. `:'')+(review?.explanation||proposal?.explanation||({ATC:'Available slots and modeled surface capacity.',GROUND:'Gate occupancy, stand compatibility and tugs.',PILOT:'Required departure fuel and readiness.'}[role]));
    $('ag'+key).classList.toggle('flash',review?.decision==='COUNTER');
  }
  const active=all.find(p=>p.kind==='dep'&&p.phase==='DEPARTED'&&p.visible);
  $('rwys').innerHTML=Object.values(RWY).map(r=>`<div class="rwy ${r.name==='4L'?'busy':'context'}"><div class="nm"><b>${r.name}–${r.opp}</b><span>${r.name==='4L'?'PLAN':'CONTEXT'}</span></div><div class="st">${r.name==='4L'?(minute<data.scenario.slots[0]?`Slots resume ${time(data.scenario.slots[0])}`:active?escapeHTML(active.callsign)+' replay':'Departure stream'):'Geographic context only'}</div></div>`).join('');
  if(data.recovery)$('rwys').innerHTML=Object.values(RWY).map(r=>`<div class="rwy ${data.recovery.activeRunways.includes(r.name)?'busy':'context'}"><div class="nm"><b>${r.name}–${r.opp}</b><span>${data.recovery.activeRunways.includes(r.name)?'ACTIVE':'INACTIVE'}</span></div><div class="st">${r.name==='4L'?'Departures + onward flight':r.name==='4R'?'Selected arrival':r.name==='13R'?'Modeled background traffic':'Map context only'}</div></div>`).join('');
  $('strips').innerHTML=all.map(p=>`<tr role="button" tabindex="0" data-flight="${p.id}" class="${selected?.id===p.id?'sel':''}" aria-label="Select ${escapeHTML(p.callsign)}"><td class="cs">${escapeHTML(p.callsign)}</td><td><span class="chip ${p.phase==='EXPECTED'?'m':p.phase==='TOW'?'t':p.phase==='DEPARTED'?'t':'g'}">${p.phase}</span></td><td class="wh">${escapeHTML(p.stand||(p.departure?.mode==='remote'?'R1':p.flight?.gate))}</td></tr>`).join('');
  renderInspector(all);
}
function render(){if(!data)return;const all=[...records(),...inboundRecords()];renderRoutes(all);renderStands();renderPlanes(all);renderLocks(all);renderPanel(all);}
function showEvents(){
  const events=data.events||[];
  $('log').innerHTML=events.slice(-45).reverse().map(e=>`<li class="ev ${e.role==='PILOT'||e.agent==='PILOT'?'SEN':e.role==='GROUND'||e.agent==='GROUND'?'GND':'TWR'}${e.type==='handoff'||e.type==='agent_error'?' alert':''}"><time>${e.turn?'T'+e.turn:'R'+(e.round||'–')}</time><b>${escapeHTML(e.agent||e.role||'SYS')}</b><span>${escapeHTML(e.assessments?.find(a=>a.optionId===data.recovery?.optionId)?.explanation||e.explanation||e.type.replaceAll('_',' '))}</span></li>`).join('')||'<li class="empty-log">No negotiation events yet. Run the agents to inspect their decisions.</li>';
}
function receive(message){
  if(message.origin!==location.origin||message.source!==window.parent||message.data?.type!=='clearance:state')return;
  const incoming=message.data.payload;if(!incoming?.scenario||!Array.isArray(incoming.scenario.flights))return;
  data=incoming;
  const newSignature=`${data.scenario.stateVersion}:${data.plan?.version}:${data.result?.status}:${data.scenario.seed}:${data.recovery?.hash||''}:${data.scenario.source?.sourceRow||''}`;
  if(newSignature!==signature){signature=newSignature;playing=false;minute=0;}
  $('play').disabled=!committed();$('replayTime').disabled=!committed();$('replayTime').max=data.scenario.horizon;$('play').textContent=playing?'Pause':data?.recovery?'Play preview':'Play plan';
  $('surge').disabled=Boolean(data.busy);$('surge').textContent=data.busy?'Negotiating…':'Run negotiation';
  $('planState').textContent=data.busy?'NEGOTIATING':committed()?`${data.result.status.toUpperCase()} · PLAN v${data.plan.version}`:data.result?.status==='handoff'?'UNRESOLVED · NO MOVEMENTS':'DRAFT · NO MOVEMENTS';
  $('planSummary').textContent=data.scenario.airport.code!=='JFK'?`JFK template shown; trigger airport is ${data.scenario.airport.code}. Mapped positions remain illustrative.`:committed()?`State v${data.scenario.stateVersion} / plan v${data.plan.version}. Replay depicts the accepted timings. Routes and runway allocation are illustrative and do not feed the validator.`:'Run the three agents. Only accepted consensus or validated fallback plans can be replayed. Gate markers show planned conflicts.';
  $('inject').hidden=Boolean(data.recovery);
  if(data.recovery){$('agPILOT').querySelector('small').textContent='arrival reserves & crew duty';$('agGND').querySelector('small').textContent='gates, turnaround & shifts';$('agTWR').querySelector('small').textContent='capacity & leader/follower wake';}
  if(data.recovery){
    if(newSignature!==signature||selected?.id==='F1')selected={kind:'flight',id:'IN1'};
    $('planState').textContent=`${data.recovery.selected?'HUMAN CHOSEN':'OPTION PREVIEW'} · ${data.recovery.title.toUpperCase()}`;
    $('surge').textContent='Re-evaluate options';
    $('planSummary').textContent=`${data.recovery.validated?'Hard constraints pass.':'Blocked by hard constraints.'} ${data.recovery.selected?'Human selected this option.':'Preview only; human selection is pending.'} Gate ${data.plan.arrivals[0].standId}; arrival ${time(data.plan.arrivals[0].gateIn)}. Geometry and background state are simulated.`;
    $('play').textContent=playing?'Pause':'Play preview';
  }
  showEvents();render();
}
window.addEventListener('message',receive);
$('surge').onclick=()=>send('clearance:run');
$('inject').onclick=()=>send('clearance:tug-outage');
$('play').onclick=()=>{if(!committed())return;if(minute>=data.scenario.horizon)minute=0;playing=!playing;$('play').textContent=playing?'Pause':data?.recovery?'Play preview':'Play plan';};
$('rewind').onclick=()=>{playing=false;minute=0;$('play').textContent=data?.recovery?'Play preview':'Play plan';render();};
$('replayTime').oninput=e=>{playing=false;minute=Number(e.target.value);$('play').textContent=data?.recovery?'Play preview':'Play plan';render();};
document.querySelectorAll('[data-sp]').forEach(button=>{button.setAttribute('aria-pressed',Number(button.dataset.sp)===speed);button.onclick=()=>{speed=Number(button.dataset.sp);document.querySelectorAll('[data-sp]').forEach(b=>b.setAttribute('aria-pressed',b===button));};});
$('ovRoutes').onchange=e=>{overlay.routes=e.target.checked;render();};$('ovPred').onchange=e=>{overlay.gates=e.target.checked;render();};$('ovLabels').onchange=e=>{overlay.labels=e.target.checked;render();};
function select(event){if(moved){moved=false;return;}const flight=event.target.closest('[data-flight]'),stand=event.target.closest('[data-stand]');if(flight)selected={kind:'flight',id:flight.dataset.flight};else if(stand)selected={kind:'stand',id:stand.dataset.stand};else return;render();}
map.addEventListener('click',select);$('strips').addEventListener('click',select);
for(const el of [map,$('strips')])el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select(event);}});
function viewBox(){map.setAttribute('viewBox',`${zoom.x} ${zoom.y} ${zoom.w} ${zoom.h}`);}
function changeZoom(factor){const width=clamp(zoom.w*factor,400,1400),height=width*2/3;zoom={x:zoom.x+(zoom.w-width)/2,y:zoom.y+(zoom.h-height)/2,w:width,h:height};viewBox();}
$('zoomIn').onclick=()=>changeZoom(.8);$('zoomOut').onclick=()=>changeZoom(1.25);$('zoomFit').onclick=()=>{zoom={x:0,y:0,w:1200,h:800};viewBox();};
map.addEventListener('pointerdown',event=>{if(event.target.closest('[data-flight],[data-stand]'))return;drag={x:event.clientX,y:event.clientY,bx:zoom.x,by:zoom.y};moved=false;map.setPointerCapture(event.pointerId);});
map.addEventListener('pointermove',event=>{if(!drag)return;const b=map.getBoundingClientRect(),dx=(event.clientX-drag.x)*zoom.w/b.width,dy=(event.clientY-drag.y)*zoom.h/b.height;if(Math.abs(dx)+Math.abs(dy)>3)moved=true;zoom.x=drag.bx-dx;zoom.y=drag.by-dy;viewBox();});
map.addEventListener('pointerup',()=>drag=null);map.addEventListener('pointercancel',()=>drag=null);
function frame(now){const dt=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;if(playing&&committed()){minute=Math.min(data.scenario.horizon,minute+dt*speed);if(now-lastUI>90){lastUI=now;render();}if(minute>=data.scenario.horizon){playing=false;$('play').textContent=data?.recovery?'Play preview':'Play plan';render();}}requestAnimationFrame(frame);}
requestAnimationFrame(frame);
if(window.parent===window){$('planSummary').innerHTML='Open this map inside <a href="/">Clearance</a> to load a plan.';}
send('clearance:ready');
