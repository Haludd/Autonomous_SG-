import {samplePath, aircraftAt, standIntervals, gateConflicts, recoveryArrivalAt} from '/jfk-replay.mjs';

const NS='http://www.w3.org/2000/svg';
const rad=Math.PI/180;
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dirOf=deg=>[Math.sin(deg*rad),-Math.cos(deg*rad)];
const D40=dirOf(40), D130=dirOf(130);

/* ---------- Runways ---------- */
const RWY={
  '4L': {name:'4L', opp:'22R',thr:[90,620], dir:D40, len:360,use:'dep'},
  '13R':{name:'13R',opp:'31L',thr:[180,440],dir:D130,len:460,use:'dep'},
  '4R': {name:'4R', opp:'22L',thr:[840,700],dir:D40, len:420,use:'arr',exitS:300,spawn:380},
  '13L':{name:'13L',opp:'31R',thr:[520,540],dir:D130,len:310,use:'arr',exitS:220,spawn:720},
};
const at=(r,s)=>[r.thr[0]+r.dir[0]*s, r.thr[1]+r.dir[1]*s];
for(const r of Object.values(RWY)){ r.end=at(r,r.len); r.ang=Math.atan2(r.dir[1],r.dir[0])/rad; }

function segX(a,b,c,d){
  const r=[b[0]-a[0],b[1]-a[1]], s=[d[0]-c[0],d[1]-c[1]];
  const den=r[0]*s[1]-r[1]*s[0]; if(Math.abs(den)<1e-9) return null;
  const t=((c[0]-a[0])*s[1]-(c[1]-a[1])*s[0])/den;
  const u=((c[0]-a[0])*r[1]-(c[1]-a[1])*r[0])/den;
  return (t>0&&t<1&&u>0&&u<1)?{t,u}:null;
}
function distSeg(p,a,b){
  const dx=b[0]-a[0], dy=b[1]-a[1]; const L2=dx*dx+dy*dy;
  const t=clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L2,0,1);
  return Math.hypot(p[0]-(a[0]+t*dx), p[1]-(a[1]+t*dy));
}
// 4L / 13R intersection
const ix=segX(RWY['4L'].thr,RWY['4L'].end,RWY['13R'].thr,RWY['13R'].end);
const SX={'4L':ix.t*RWY['4L'].len,'13R':ix.u*RWY['13R'].len};
const XPT=at(RWY['4L'],SX['4L']);

/* ---------- Taxi graph ---------- */
const CX=590, CY=320, RX=200, RY=145;
const ring=(a,f=1)=>[CX+RX*f*Math.cos(a*rad), CY+RY*f*Math.sin(a*rad)];
const norm=a=>((a%360)+360)%360;
const TERMS=[
  {id:'T5',a0:-22,a1:24, gates:[['5',-12],['9',2],['14',16]]},
  {id:'T4',a0:40,a1:84,  gates:[['B24',48],['B27',62],['A5',76]]},
  {id:'T1',a0:110,a1:154,gates:[['3',118],['6',132],['9',146]]},
  {id:'T8',a0:190,a1:234,gates:[['8',198],['12',212],['16',226]]},
  {id:'T7',a0:254,a1:298,gates:[['G3',262],['G7',276],['G11',290]]},
];
const NODES={}, ADJ={};
function node(id,x,y){NODES[id]={id,x,y}; ADJ[id]=ADJ[id]||[];}
function edge(a,b,name,two){
  const add=(u,v)=>{const A=NODES[u],B=NODES[v]; ADJ[u].push({from:u,to:v,len:Math.hypot(B.x-A.x,B.y-A.y),name,cross:[]});};
  add(a,b); if(two) add(b,a);
}
const special=[10,55,165];
const GATES={};
for(const t of TERMS) for(const [g,a] of t.gates){ special.push(norm(a)); GATES[`${t.id}-${g}`]={key:`${t.id}-${g}`,term:t.id,name:g,a:norm(a)}; }
const loopA=new Set(special.map(norm));
for(let a=0;a<360;a+=20){
  const near=special.some(s=>{const d=Math.abs(norm(s)-a); return Math.min(d,360-d)<6;});
  if(!near) loopA.add(a);
}
const LOOP=[...loopA].sort((a,b)=>a-b);
for(const a of LOOP){ const [x,y]=ring(a); node('L'+a,x,y); }
for(let i=0;i<LOOP.length;i++) edge('L'+LOOP[i],'L'+LOOP[(i+1)%LOOP.length],'A',false); // one-way clockwise
for(const g of Object.values(GATES)){ const [x,y]=ring(g.a,0.8); node('G_'+g.key,x,y); edge('G_'+g.key,'L'+g.a,'gate',true); }
const H4L=[RWY['4L'].thr[0]+25*D130[0]+10*D40[0], RWY['4L'].thr[1]+25*D130[1]+10*D40[1]];
const H13R=[RWY['13R'].thr[0]+25*D40[0]+10*D130[0], RWY['13R'].thr[1]+25*D40[1]+10*D130[1]];
node('W1',300,420); node('H4L',...H4L); node('H13R',...H13R);
edge('L165','W1','K'); edge('W1','H4L','K'); edge('W1','H13R','K');
node('X4R',...at(RWY['4R'],RWY['4R'].exitS)); node('E1',880,430);
edge('X4R','E1','J'); edge('E1','L10','J');
node('X13L',...at(RWY['13L'],RWY['13L'].exitS)); node('S1',700,560);
edge('X13L','S1','H'); edge('S1','L55','H');
// detect runway crossings
for(const list of Object.values(ADJ)) for(const e of list){
  const A=[NODES[e.from].x,NODES[e.from].y], B=[NODES[e.to].x,NODES[e.to].y];
  for(const r of Object.values(RWY)){
    if(distSeg(A,r.thr,r.end)<4||distSeg(B,r.thr,r.end)<4) continue;
    if(segX(A,B,r.thr,r.end)) e.cross.push(r.name);
  }
}
function route(from,to){
  const dist={},prev={},Q=new Set(Object.keys(NODES));
  for(const k of Q) dist[k]=Infinity; dist[from]=0;
  while(Q.size){
    let u=null; for(const k of Q) if(u===null||dist[k]<dist[u]) u=k;
    if(dist[u]===Infinity) break; Q.delete(u); if(u===to) break;
    for(const e of ADJ[u]){ const nd=dist[u]+e.len; if(nd<dist[e.to]){dist[e.to]=nd; prev[e.to]=e;} }
  }
  if(dist[to]===Infinity) return null;
  const edges=[]; let c=to; while(c!==from){ const e=prev[c]; edges.unshift(e); c=e.from; }
  const pts=[[NODES[from].x,NODES[from].y],...edges.map(e=>[NODES[e.to].x,NODES[e.to].y])];
  const via=[]; for(const e of edges){ if(e.name!=='gate'&&via[via.length-1]!==e.name) via.push(e.name); }
  return {pts,meta:edges.map(e=>({cross:e.cross.slice(),name:e.name})),via:via.join(' ')};
}

/* ---------- Static map ---------- */
const S=[];
const P=a=>a.map(p=>p.map(v=>v.toFixed(1)).join(',')).join(' ');
S.push(`<rect x="-400" y="-400" width="2000" height="1600" fill="var(--ground)"/>`);
S.push(`<path d="M-400,1200 L-400,770 C40,750 160,790 330,782 C470,776 560,800 700,786 C840,772 960,760 1040,720 C1110,684 1160,640 1600,600 L1600,1200 Z" fill="var(--water)" stroke="var(--waterline)" stroke-width="1.5"/>`);
S.push(`<text class="lbl" x="420" y="800" font-size="13" fill-opacity=".7" style="fill:var(--waterline);letter-spacing:.3em">JAMAICA BAY</text>`);
S.push(`<polygon points="${P([[30,400],[160,320],[320,240],[420,110],[580,80],[780,100],[960,190],[1150,320],[1190,420],[1150,560],[1010,740],[860,766],[640,790],[400,778],[220,784],[40,740]])}" fill="var(--grass)"/>`);
// landside road
S.push(`<path d="M610,-20 C606,60 596,120 590,${CY-RY+8}" fill="none" stroke="#273644" stroke-width="7"/>`);
S.push(`<text class="lbl" x="618" y="40" font-size="10">VAN WYCK EXPY</text>`);
// apron + core
S.push(`<ellipse cx="${CX}" cy="${CY}" rx="${RX*0.92}" ry="${RY*0.92}" fill="var(--apron)"/>`);
S.push(`<ellipse cx="${CX}" cy="${CY}" rx="${RX*0.47}" ry="${RY*0.47}" fill="var(--core)"/>`);
S.push(`<ellipse cx="${CX}" cy="${CY}" rx="${RX*0.3}" ry="${RY*0.3}" fill="none" stroke="#3a6a9a" stroke-width="1.4" stroke-dasharray="5 4" opacity=".7"/>`);
S.push(`<text class="lbl" x="${CX}" y="${CY+RY*0.3+11}" font-size="8" text-anchor="middle" style="fill:#5b86b0">AIRTRAIN</text>`);
// approach / departure extended centerlines
for(const r of Object.values(RWY)){
  if(r.use==='arr'){ const a=at(r,-r.spawn-200); S.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${r.thr[0]}" y2="${r.thr[1]}" stroke="var(--faint)" stroke-width="1" stroke-dasharray="1 6" opacity=".8"/>`); }
  else { const a=at(r,r.len+520); S.push(`<line x1="${r.end[0]}" y1="${r.end[1]}" x2="${a[0]}" y2="${a[1]}" stroke="var(--faint)" stroke-width="1" stroke-dasharray="6 6" opacity=".45"/>`); }
}
// taxiways
const drawn=new Set(), twy=[], twl=[];
for(const list of Object.values(ADJ)) for(const e of list){
  const k=[e.from,e.to].sort().join('|'); if(drawn.has(k)) continue; drawn.add(k);
  const A=NODES[e.from],B=NODES[e.to];
  const w=e.name==='gate'?7:10;
  twy.push(`<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="var(--taxi)" stroke-width="${w}" stroke-linecap="round"/>`);
  twl.push(`<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="var(--taxiline)" stroke-width=".9" opacity=".6"/>`);
}
S.push(twy.join(''),twl.join(''));
// runways
for(const r of Object.values(RWY)){
  const W=16;
  let g=`<g transform="translate(${r.thr[0]},${r.thr[1]}) rotate(${r.ang})">`;
  g+=`<rect x="-6" y="${-W/2}" width="${r.len+12}" height="${W}" fill="var(--rwy)" rx="1"/>`;
  g+=`<line x1="44" y1="0" x2="${r.len-44}" y2="0" stroke="var(--paint)" stroke-width="1" stroke-dasharray="8 7" opacity=".85"/>`;
  for(let k=-3;k<=3;k++){ if(!k) continue; const y=k*2.1;
    g+=`<line x1="2" y1="${y}" x2="14" y2="${y}" stroke="var(--paint)" stroke-width="1.1"/>`;
    g+=`<line x1="${r.len-14}" y1="${y}" x2="${r.len-2}" y2="${y}" stroke="var(--paint)" stroke-width="1.1"/>`; }
  g+=`<rect x="70" y="-4.5" width="12" height="2.2" fill="var(--paint)" opacity=".8"/><rect x="70" y="2.3" width="12" height="2.2" fill="var(--paint)" opacity=".8"/>`;
  g+=`<rect x="${r.len-82}" y="-4.5" width="12" height="2.2" fill="var(--paint)" opacity=".8"/><rect x="${r.len-82}" y="2.3" width="12" height="2.2" fill="var(--paint)" opacity=".8"/>`;
  g+=`<text class="rnum" transform="translate(28,0) rotate(90)" text-anchor="middle" dy="4.5">${r.name}</text>`;
  g+=`<text class="rnum" transform="translate(${r.len-28},0) rotate(-90)" text-anchor="middle" dy="4.5">${r.opp}</text>`;
  g+='</g>'; S.push(g);
}
// terminals
function arc(a0,a1,f0,f1){ const pts=[]; for(let a=a0;a<=a1;a+=3) pts.push(ring(a,f1)); for(let a=a1;a>=a0;a-=3) pts.push(ring(a,f0)); return P(pts); }
for(const t of TERMS){
  S.push(`<polygon points="${arc(t.a0,t.a1,0.5,0.66)}" fill="var(--terminal)" stroke="#4a6175" stroke-width=".8"/>`);
  for(const [g,a] of t.gates){
    const A=ring(a,0.64),B=ring(a,0.76),L=ring(a,0.58);
    S.push(`<line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" stroke="var(--terminal)" stroke-width="5" stroke-linecap="round"/>`);
    S.push(`<text class="gname" x="${L[0]}" y="${L[1]}" text-anchor="middle" dy="2.3">${g}</text>`);
  }
  const m=ring((t.a0+t.a1)/2,0.4);
  S.push(`<text class="tname" x="${m[0]}" y="${m[1]}" text-anchor="middle" dy="6">${t.id}</text>`);
}
// tower
S.push(`<g transform="translate(${CX},${CY})"><circle r="9" fill="var(--panel2)" stroke="var(--twr)" stroke-width="1.4"/><circle r="3" fill="var(--twr)"/><text class="lbl" y="21" font-size="9" text-anchor="middle" style="fill:var(--twr)">TWR</text></g>`);
// signs
function sign(x,y,t,kind){
  const w=t.length*5.2+8, bg=kind==='hold'?'#c4221b':'#000', fg=kind==='hold'?'#fff':'var(--taxiline)';
  return `<g transform="translate(${x},${y})"><rect x="${-w/2}" y="-7" width="${w}" height="13" fill="${bg}" stroke="${kind==='hold'?'#fff':'var(--taxiline)'}" stroke-width=".6"/><text class="sign" text-anchor="middle" dy="3" fill="${fg}">${t}</text></g>`;
}
S.push(sign(H4L[0]+30,H4L[1]+10,'4L-22R','hold'));
S.push(sign(H13R[0]-6,H13R[1]-16,'13R-31L','hold'));
S.push(sign(318,404,'13R · 4L','hold'));
S.push(sign(...ring(270,1.1),'A'), sign(...ring(90,1.1),'A'));
S.push(sign(350,380,'K'), sign(925,450,'J'), sign(720,520,'H'));
// north + scale
S.push(`<g transform="translate(1150,60)"><path d="M0,-18 L6,4 L0,0 L-6,4 Z" fill="var(--muted)"/><text class="lbl" y="18" font-size="11" text-anchor="middle">N</text></g>`);
S.push(`<g transform="translate(1000,80)"><line x1="0" y1="0" x2="104" y2="0" stroke="var(--muted)" stroke-width="1.5"/><line x1="0" y1="-4" x2="0" y2="4" stroke="var(--muted)"/><line x1="104" y1="-4" x2="104" y2="4" stroke="var(--muted)"/><text class="lbl" x="52" y="-6" font-size="9" text-anchor="middle">SCHEMATIC</text></g>`);
$('static').innerHTML=S.join('');

// runway lock overlays
const gLocks=$('gLocks'), LOCKEL={};
for(const r of Object.values(RWY)){
  const el=document.createElementNS(NS,'rect');
  el.setAttribute('transform',`translate(${r.thr[0]},${r.thr[1]}) rotate(${r.ang})`);
  el.setAttribute('x',-6); el.setAttribute('y',-11); el.setAttribute('width',r.len+12); el.setAttribute('height',22); el.setAttribute('rx',2);
  el.setAttribute('class','rlock'); gLocks.appendChild(el); LOCKEL[r.name]=el;
}
const xEl=document.createElementNS(NS,'circle'); xEl.setAttribute('cx',XPT[0]); xEl.setAttribute('cy',XPT[1]); xEl.setAttribute('r',14); xEl.setAttribute('class','xlock'); gLocks.appendChild(xEl);


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
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='clearance:layout')return;
  document.documentElement.classList.toggle('right-rail-open',Boolean(event.data.panels?.right));
});
document.addEventListener('keydown',event=>{
  if(!canvasLayout||event.target.closest('input,select,textarea')||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.key.toLowerCase()==='m'){event.preventDefault();send('clearance:map-only');}
});
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
