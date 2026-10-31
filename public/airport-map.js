import {createAirportGeometry} from '/airport-geometry.mjs';
import {aircraftAt,recoveryArrivalAt,standIntervals} from '/jfk-replay.mjs';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const L=window.L;
const map=L.map('geo-map',{zoomControl:false,attributionControl:false,minZoom:3,maxZoom:19,zoomSnap:.25});
map.setView([40.64,-73.78],14);
const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,updateWhenIdle:true,keepBuffer:1,detectRetina:false,
  attribution:'© OpenStreetMap contributors',
});
const runwayLayer=L.layerGroup().addTo(map),gateLayer=L.layerGroup().addTo(map),routeLayer=L.layerGroup().addTo(map),standLayer=L.layerGroup().addTo(map),planeLayer=L.layerGroup().addTo(map);
const markers=new Map();
let airport=null,geometry=null,data=null,minute=0,playing=false,speed=2,signature='',selected=null;
let lastFrame=performance.now(),lastRender=0,tileCount=0,streetMode=true;
const overlay={routes:true,gates:true,labels:true};
const phaseNames={GATE:'At gate',PUSHBACK:'Pushback',TAXI:'Taxiing',HOLD:'Holding short',DEPARTED:'Departed',INBOUND:'Inbound approach',HOLDING:'Holding pattern',ARRIVAL_TAXI:'Taxi to assigned gate',TURNAROUND:'Turnaround'};
const planePath='M0,-9 L1.5,-6.5 L1.5,-2 L8.5,2.2 L8.5,3.6 L1.5,2 L1.1,6 L3.6,8 L3.6,9.2 L0,8.4 L-3.6,9.2 L-3.6,8 L-1.1,6 L-1.5,2 L-8.5,3.6 L-8.5,2.2 L-1.5,-2 L-1.5,-6.5 Z';
const send=type=>window.parent.postMessage({type},location.origin);
const replayable=()=>Boolean(data?.validation?.valid&&data?.plan&&data?.scenario.stateVersion===data.plan.stateVersion);

function time(value=minute,seconds=false){
  const clock=data?.scenario.clock??airport?.clock??{hour:14,minute:0};
  const total=clock.hour*3600+clock.minute*60+Math.round(value*60);
  return [Math.floor(total/3600)%24,Math.floor(total/60)%60,...(seconds?[total%60]:[])].map(part=>String(part).padStart(2,'0')).join(':');
}
function mapStatus(text){
  const coverage=airport?.gateCoverage;
  const missing=coverage?.unmappedStandIds.length;
  $('basemap-status').textContent=text+(missing?` · ${coverage.mappedStandCount}/${coverage.totalStandCount} scenario gates mapped; ${missing} hidden`:'');
}
const gateName=gate=>gate.ref?`Gate ${gate.ref}`:gate.name||'Mapped gate';
function gateDescription(gate){return `${gateName(gate)}${gate.terminal?` · terminal ${gate.terminal}`:''}. Source passenger gate at ${gate.latitude.toFixed(6)}, ${gate.longitude.toFixed(6)}. Occupancy and flight assignments are simulated.`;}
tiles.on('tileload',()=>{tileCount++;if(airport&&streetMode)mapStatus(`${airport.code} · geographic map · simulated movements`);});
tiles.on('tileerror',()=>{if(airport&&streetMode&&!tileCount)mapStatus('Street tiles unavailable · local runway outlines remain visible');});

function fitAirport(){
  if(!airport)return;
  const points=airport.runways.flatMap(runway=>[runway.start,runway.end]);
  points.push(...(airport.gates??[]).map(gate=>[gate.latitude,gate.longitude]));
  points.push([airport.latitude,airport.longitude]);
  if(points.length>1)map.fitBounds(L.latLngBounds(points).pad(.24),{maxZoom:15,animate:false,padding:[45,70]});
  else map.setView([airport.latitude,airport.longitude],15,{animate:false});
}
function drawRunways(){
  runwayLayer.clearLayers();
  if(!airport)return;
  for(const runway of airport.runways){
    const points=[runway.start,runway.end],color=runway.closedInSource?'#a36c6c':'#7c9aaa';
    L.polyline(points,{color,weight:11,opacity:.82,lineCap:'butt'}).bindTooltip(`${esc(runway.lowIdent)} / ${esc(runway.highIdent)} · ${Math.round(runway.lengthFt??0).toLocaleString()} ft · OurAirports${runway.closedInSource?' · source marks closed':''}`).addTo(runwayLayer);
    L.polyline(points,{color:'#d8e5ec',weight:1,dashArray:'7 8',opacity:.8,interactive:false}).addTo(runwayLayer);
    L.marker(runway.start,{interactive:false,icon:L.divIcon({className:'runway-label',html:esc(`${runway.lowIdent} / ${runway.highIdent}`),iconAnchor:[0,-8]})}).addTo(runwayLayer);
  }
  if(!airport.runways.length){
    L.circleMarker([airport.latitude,airport.longitude],{radius:9,color:'#3ec6d0',fillOpacity:.2}).addTo(runwayLayer);
    L.marker([airport.latitude,airport.longitude],{interactive:false,icon:L.divIcon({className:'airport-center-label',html:esc(`${airport.code} · airport reference point`),iconAnchor:[-15,5]})}).addTo(runwayLayer);
  }
}
function drawMappedGates(){
  gateLayer.clearLayers();
  for(const gate of airport.gates??[]){
    L.circleMarker([gate.latitude,gate.longitude],{radius:2.5,color:'#91b9c5',weight:1,fillColor:'#91b9c5',fillOpacity:.7})
      .bindTooltip(esc(`${gateName(gate)} · OpenStreetMap`))
      .on('click',()=>showInfo(gateName(gate),gateDescription(gate),gate.sourceUrl))
      .addTo(gateLayer);
  }
}
function setAirport(next){
  const changed=airport?.code!==next.code;
  airport=next;geometry=createAirportGeometry(airport);
  $('geo-map').setAttribute('aria-label',`${airport.code} — ${airport.name} geographic map`);
  const coverage=airport.gateCoverage;
  $('map-source-note').textContent=`${airport.code} · ${airport.gates?.length??0} source passenger gates · ${coverage?.mappedStandCount??0}/${coverage?.totalStandCount??0} scenario aliases mapped${airport.runways.length?'':' · no source runway endpoints'}`;
  if(changed){tileCount=0;drawRunways();drawMappedGates();fitAirport();}
  if(streetMode&&!map.hasLayer(tiles))tiles.addTo(map);
  if(!tileCount)mapStatus(`${airport.code} · ${streetMode?'loading street tiles':'local runway outlines'}`);
}
function records(){
  if(!data||!geometry)return [];
  const departures=data.scenario.flights.map(flight=>{
    const assignment=data.plan.departures.find(item=>item.flightId===flight.id);
    const shape=geometry.departure(flight,assignment);
    return {...aircraftAt(flight,replayable()?assignment:null,minute,shape),id:flight.id,callsign:flight.callsign,kind:'dep',flight,assignment,shape};
  });
  const arrival=data.plan.arrivals[0],shape=geometry.arrival(data);
  const state=recoveryArrivalAt({baselineLanding:data.recovery.baselineETA-data.scenario.target.arrivalTaxi,landing:arrival.landing,gateIn:arrival.gateIn,ready:data.recovery.metrics.ready,nextDeparture:data.plan.nextDeparture},replayable()?minute:0,shape);
  return [...departures,{...state,id:'IN1',callsign:data.scenario.arrivals[0].callsign,kind:'arr',assignment:arrival,shape}];
}
function drawRoutes(all){
  routeLayer.clearLayers();
  if(!overlay.routes||!geometry)return;
  for(const plane of all){
    const paths=plane.kind==='arr'?[plane.shape.approach,plane.shape.arrivalTaxi,plane.shape.departureTaxi]:[plane.shape.taxi];
    for(const path of paths.filter(path=>path?.length))L.polyline(path.map(geometry.unproject),{color:plane.kind==='arr'?'#b48cff':'#3ec6d0',weight:plane.id===selected?3:1.5,opacity:plane.id===selected?0.9:0.4,dashArray:'5 6',interactive:false}).addTo(routeLayer);
  }
}
function drawStands(){
  standLayer.clearLayers();
  if(!data||!overlay.gates)return;
  const occupancy=standIntervals(data.scenario,data.plan);
  for(const stand of data.scenario.stands.filter(item=>item.type==='gate')){
    const gate=geometry.gateFor(stand.id);
    if(!gate)continue;
    const occupied=occupancy.some(interval=>interval.stand===stand.id&&interval.start<=minute&&minute<interval.end);
    const closed=data.scenario.closedStands.includes(stand.id);
    L.marker([gate.latitude,gate.longitude],{icon:L.divIcon({className:`scenario-stand${occupied?' occupied':''}${closed?' closed':''}`,html:`<span class="gate-ref">${esc(gate.ref||gate.name||stand.id)}</span>`,iconSize:[10,10],iconAnchor:[5,5]}),title:`${gateName(gate)} · scenario ${stand.id}`})
      .bindTooltip(esc(`${gateName(gate)} · scenario ${stand.id} · ${closed?'unavailable':occupied?'occupied':'free'} (simulated)`))
      .on('click',()=>showInfo(`${gateName(gate)} · scenario ${stand.id}`,gateDescription(gate),gate.sourceUrl))
      .addTo(standLayer);
  }
}
function aircraftIcon(plane){
  const labels=overlay.labels?`<span class="aircraft-label">${esc(plane.callsign)}<small>${esc(phaseNames[plane.phase]??plane.phase)}</small></span>`:'';
  return L.divIcon({className:`geo-aircraft${plane.kind==='arr'?' arrival':''}${plane.id===selected?' selected':''}`,iconSize:[28,28],iconAnchor:[14,14],html:`<svg class="aircraft-body" viewBox="-14 -14 28 28" style="transform:rotate(${Number(plane.heading)||0}deg)" aria-hidden="true"><path d="${planePath}" fill="currentColor" stroke="#091720" stroke-width=".7"/></svg>${labels}`});
}
function showInfo(title,description,sourceUrl){
  $('info').hidden=false;
  const sourceLink=/^https:\/\/www\.openstreetmap\.org\/node\/\d+$/.test(sourceUrl??'')?`<p><a href="${esc(sourceUrl)}" target="_blank" rel="noopener">View source gate ↗</a></p>`:'';
  $('info').innerHTML=`<div class="h"><b>${esc(title)}</b><button id="info-close" aria-label="Close map details">×</button></div><p>${esc(description)}</p>${sourceLink}`;
  $('info-close').onclick=()=>{selected=null;$('info').hidden=true;render();};
}
function drawPlanes(all){
  const visible=new Set();
  for(const plane of all.filter(item=>item.visible)){
    visible.add(plane.id);
    let marker=markers.get(plane.id);
    if(!marker){marker=L.marker(geometry.unproject([plane.x,plane.y]),{title:plane.callsign,icon:aircraftIcon(plane)}).addTo(planeLayer);markers.set(plane.id,marker);marker.on('click',()=>{
      const current=records().find(item=>item.id===plane.id);
      if(!current)return;
      const alias=current.assignment?.standId??current.flight?.gate,gate=geometry.gateFor(alias);
      selected=current.id;
      showInfo(current.callsign,`${data.recovery.title}. ${phaseNames[current.phase]??current.phase}. ${gate?`${gateName(gate)} (scenario ${alias})`:`${alias} has no mapped position`}. Flight assignments and taxi paths are illustrative.`,gate?.sourceUrl);render();
    });}
    marker.setLatLng(geometry.unproject([plane.x,plane.y]));marker.setIcon(aircraftIcon(plane));
  }
  for(const [id,marker] of markers)if(!visible.has(id)){planeLayer.removeLayer(marker);markers.delete(id);}
}
function render(){
  $('clock').textContent=time(minute,true);$('replayClock').textContent=time();$('replayTime').value=minute;
  if(!data)return;
  $('replayEnd').textContent=time(data.scenario.horizon);
  const all=records();drawRoutes(all);drawStands();drawPlanes(all);
}
function clearPreview(){
  data=null;minute=0;playing=false;signature='';selected=null;
  routeLayer.clearLayers();standLayer.clearLayers();planeLayer.clearLayers();markers.clear();
  $('info').hidden=true;$('play').disabled=true;$('play').textContent='Play preview';$('replayTime').disabled=true;
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.parent)return;
  const message=event.data;
  if(message?.type==='clearance:layout')document.documentElement.classList.toggle('right-rail-open',Boolean(message.panels?.right));
  if(message?.type==='clearance:airport'&&message.payload){clearPreview();setAirport({...message.payload,clock:message.clock});render();}
  if(message?.type==='clearance:state'&&message.payload?.scenario?.mapData){
    data=message.payload;setAirport(data.scenario.mapData);
    const nextSignature=`${airport.code}:${data.recovery.hash}`;
    if(nextSignature!==signature){signature=nextSignature;minute=0;playing=false;selected=null;$('info').hidden=true;}
    $('play').disabled=!replayable();$('replayTime').disabled=!replayable();$('replayTime').max=data.scenario.horizon;
    $('play').textContent=playing?'Pause':'Play preview';render();
  }
});
$('play').onclick=()=>{if(!replayable())return;if(minute>=data.scenario.horizon)minute=0;playing=!playing;$('play').textContent=playing?'Pause':'Play preview';};
$('rewind').onclick=()=>{minute=0;playing=false;$('play').textContent='Play preview';render();};
$('replayTime').oninput=event=>{minute=Number(event.target.value);playing=false;$('play').textContent='Play preview';render();};
document.querySelectorAll('[data-sp]').forEach(button=>button.onclick=()=>{speed=Number(button.dataset.sp);document.querySelectorAll('[data-sp]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));});
for(const [id,key] of [['ovRoutes','routes'],['ovPred','gates'],['ovLabels','labels']])$(id).onchange=event=>{
  overlay[key]=event.target.checked;
  if(key==='gates'){if(overlay.gates)gateLayer.addTo(map);else map.removeLayer(gateLayer);}
  render();
};
map.on('zoomend',()=>document.documentElement.classList.toggle('gate-labels-visible',map.getZoom()>=16));
$('zoomIn').onclick=()=>map.zoomIn();$('zoomOut').onclick=()=>map.zoomOut();$('zoomFit').onclick=fitAirport;
function setStreet(value){
  streetMode=value;$('street-mode').setAttribute('aria-pressed',String(value));$('outline-mode').setAttribute('aria-pressed',String(!value));
  if(value){tiles.addTo(map);mapStatus(`${airport?.code??''} · geographic street map`);}else{map.removeLayer(tiles);mapStatus(`${airport?.code??''} · local runway outlines · no street tiles`);}
}
$('street-mode').onclick=()=>setStreet(true);$('outline-mode').onclick=()=>setStreet(false);
document.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='m'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target.closest('input,select,textarea')){event.preventDefault();send('clearance:map-only');}});
function frame(now){
  const elapsed=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;
  if(playing&&replayable()){
    minute=Math.min(data.scenario.horizon,minute+elapsed*speed);
    if(now-lastRender>150){lastRender=now;render();}
    if(minute>=data.scenario.horizon){playing=false;$('play').textContent='Play preview';render();}
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
send('clearance:ready');
