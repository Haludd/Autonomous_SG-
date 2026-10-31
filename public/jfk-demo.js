
(()=>{
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
S.push(`<g transform="translate(1000,80)"><line x1="0" y1="0" x2="104" y2="0" stroke="var(--muted)" stroke-width="1.5"/><line x1="0" y1="-4" x2="0" y2="4" stroke="var(--muted)"/><line x1="104" y1="-4" x2="104" y2="4" stroke="var(--muted)"/><text class="lbl" x="52" y="-6" font-size="9" text-anchor="middle">1 km</text></g>`);
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

/* ---------- Simulation state ---------- */
const SEP=24, M_PER_PX=9.6;
let simT=0, speed=1, paused=false, nextId=1, selId=null;
const lock={'4L':null,'13R':null,'4R':null,'13L':null,X:null};
const alarm={};
const lastDep={'4L':-99,'13R':-99};
const gateOcc={}; for(const k in GATES) gateOcc[k]=null;
const planes=[]; const byId=id=>planes.find(p=>p.id===id);
const respawn=[];
const counts={TWR:0,GND:0,SEN:0};
const AIRL=[['DAL','B739'],['JBU','A321'],['AAL','B738'],['BAW','B77W'],['SIA','A359'],['UAE','A388'],['AFR','A333'],['CPA','B77W'],['UAL','B752'],['QTR','A35K'],['DLH','B748'],['KAL','B789'],['VIR','A35K'],['ANA','B77W']];
const pick=a=>a[Math.floor(Math.random()*a.length)];
const newCs=()=>{const [c,t]=pick(AIRL); return {cs:c+(Math.floor(Math.random()*890)+11), type:t};};
const gl=k=>k.replace('-',' · ');
const PLANE='M0,-9 L1.5,-6.5 L1.5,-2 L8.5,2.2 L8.5,3.6 L1.5,2 L1.1,6 L3.6,8 L3.6,9.2 L0,8.4 L-3.6,9.2 L-3.6,8 L-1.1,6 L-1.5,2 L-8.5,3.6 L-8.5,2.2 L-1.5,-2 L-1.5,-6.5 Z';

const logEl=$('log');
function clockStr(){ const t=Math.floor(6*3600+40*60+simT*6); const h=Math.floor(t/3600)%24,m=Math.floor(t/60)%60,s=t%60; return [h,m,s].map(v=>String(v).padStart(2,'0')).join(':'); }
function log(agent,msg,lvl=''){
  counts[agent]++;
  const li=document.createElement('li'); li.className=`ev ${agent} ${lvl}`;
  li.innerHTML=`<time>${clockStr()}</time><b>${agent}</b><span>${msg}</span>`;
  logEl.prepend(li); while(logEl.children.length>70) logEl.lastChild.remove();
  const card=$('ag'+agent); if(card){ card.classList.add('flash'); clearTimeout(card._t); card._t=setTimeout(()=>card.classList.remove('flash'),500); }
}

/* ---------- Plane helpers ---------- */
const segLen=(p,i)=>{const a=p.path[i],b=p.path[i+1]; return b?Math.hypot(b[0]-a[0],b[1]-a[1]):0;};
function updPos(p){
  const a=p.path[p.i], b=p.path[p.i+1]||a; const L=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const f=L>0?Math.min(1,p.u/L):0; p.x=a[0]+(b[0]-a[0])*f; p.y=a[1]+(b[1]-a[1])*f;
  if(L>0.01) p.mdir=Math.atan2(b[0]-a[0],-(b[1]-a[1]));
}
function setPath(p,path,meta){ p.path=path; p.meta=meta||path.slice(1).map(()=>({cross:[]})); p.i=0; p.u=0; p.crossJ={}; updPos(p); }
function advance(p,d){
  while(d>1e-9 && p.i<p.path.length-1){
    const L=segLen(p,p.i);
    if(p.u+d<L){p.u+=d; d=0;}
    else { d-=L-p.u; if(p.i<p.path.length-2){p.i++; p.u=0;} else {p.u=L; break;} }
  }
  updPos(p);
}
const atEnd=p=>p.i>=p.path.length-2 && p.u>=segLen(p,p.path.length-2)-0.5;
function remaining(p){ let d=segLen(p,p.i)-p.u; for(let k=p.i+1;k<p.path.length-1;k++) d+=segLen(p,k); return d; }
function distToNode(p,j){ if(j<p.i) return -1; if(j===p.i) return p.u<1e-6?0:-1; let d=segLen(p,p.i)-p.u; for(let k=p.i+1;k<j;k++) d+=segLen(p,k); return d; }
const distThr=p=>Math.hypot(p.x-RWY[p.rwy].thr[0],p.y-RWY[p.rwy].thr[1])*(p.i===0?1:-1);
const onGround=p=>p.alt<0.08;

const gPlanes=$('gPlanes'), gRoutes=$('gRoutes'), gPred=$('gPred'), gConf=$('gConf');
function mkEl(p){
  const g=document.createElementNS(NS,'g'); g.setAttribute('class','ac'); g.dataset.id=p.id;
  g.innerHTML=`<path class="shadow" d="${PLANE}"/><circle class="ring" r="15"/><path class="body" d="${PLANE}"/><g class="tag"><text class="cs" x="13" y="-7"></text><text class="ph" x="13" y="3"></text></g>`;
  gPlanes.appendChild(g);
  const rt=document.createElementNS(NS,'polyline'); rt.setAttribute('class','route g'); gRoutes.appendChild(rt);
  const pr=document.createElementNS(NS,'line'); pr.setAttribute('class','pred'); gPred.appendChild(pr);
  p.el={g,shadow:g.children[0],ring:g.children[1],body:g.children[2],cs:g.querySelector('.cs'),ph:g.querySelector('.ph'),rt,pr};
}
function mkPlane(o){
  const p=Object.assign({id:nextId++,v:0,alt:0,hdg:0,mdir:0,locks:new Set(),sentinelHold:0,blockDist:Infinity,conf:-9,waitFor:'',flags:{}},o);
  setPath(p,o.path,o.meta); if(o.hdg!=null) p.hdg=o.hdg; else p.hdg=p.mdir;
  planes.push(p); mkEl(p); return p;
}
function removePlane(p){
  for(const k in lock) if(lock[k]===p.id) lock[k]=null;
  for(const k in gateOcc) if(gateOcc[k]===p.id) gateOcc[k]=null;
  p.el.g.remove(); p.el.rt.remove(); p.el.pr.remove();
  planes.splice(planes.indexOf(p),1); if(selId===p.id) selId=null;
}
function parkAt(p,gate){
  const n=NODES['G_'+gate]; setPath(p,[[n.x,n.y],[n.x,n.y]]);
  p.hdg=Math.atan2(CX-n.x,-(CY-n.y)); p.phase='gate'; p.gate=gate; gateOcc[gate]=p.id; p.v=0; p.alt=0;
}
const freeGates=()=>Object.keys(gateOcc).filter(k=>gateOcc[k]===null);

/* ---------- GROUND agent ---------- */
const ground={
  holds:0,
  depRunway(){ const q=r=>planes.filter(p=>p.kind==='dep'&&p.rwy===r&&['taxiOut','holding','lineup'].includes(p.phase)).length; return q('4L')<=q('13R')?'4L':'13R'; },
  requestPush(p){
    const ln=NODES['L'+GATES[p.gate].a];
    const busy=planes.some(q=>q!==p&&q.phase!=='gate'&&onGround(q)&&Math.hypot(q.x-ln.x,q.y-ln.y)<44);
    if(busy){ p.dwell=1.2; p.waitFor='pushback · traffic behind'; if(!p.flags.pushWait){p.flags.pushWait=1; log('GND',`${p.cs} pushback delayed, traffic passing ${gl(p.gate)}`);} return; }
    const out=planes.filter(q=>q.kind==='dep'&&['taxiOut','holding','lineup'].includes(q.phase)).length;
    if(out>=5){ p.dwell=2; p.waitFor='pushback · departure metering'; if(!p.flags.meter){p.flags.meter=1; log('GND',`${p.cs} expect pushback delay, departure queue full`);} return; }
    const rwy=this.depRunway(); const r=route('G_'+p.gate,'H'+rwy); if(!r) return;
    p.rwy=rwy; setPath(p,r.pts,r.meta); p.phase='taxiOut'; p.waitFor=''; gateOcc[p.gate]=null; p.v=0;
    if(pendingRogue){ p.rogueArmed=true; pendingRogue=false; }
    log('GND',`${p.cs} pushback approved from ${gl(p.gate)}, taxi to ${rwy} via ${r.via}`);
  },
  taxiIn(p){
    const r=route('X'+p.rwy,'G_'+p.gate);
    setPath(p,r.pts,r.meta); p.phase='taxiIn';
    log('GND',`${p.cs} vacated ${p.rwy}, taxi to gate ${gl(p.gate)} via ${r.via}`);
  },
  computeBlocks(){
    const TAX=new Set(['taxiIn','taxiOut','holding','lineup']);
    for(const p of planes){p.blockDist=Infinity; p.blocker=null;}
    for(const p of planes){
      if(p.phase!=='taxiIn'&&p.phase!=='taxiOut') continue;
      const ux=Math.sin(p.mdir), uy=-Math.cos(p.mdir);
      for(const q of planes){
        if(q===p||!TAX.has(q.phase)) continue;
        const dx=q.x-p.x, dy=q.y-p.y; if(Math.abs(dx)>80||Math.abs(dy)>80) continue;
        const along=dx*ux+dy*uy; if(along<=2) continue;
        const lat=Math.abs(dx*uy-dy*ux); if(lat>10) continue;
        if(along<p.blockDist){p.blockDist=along; p.blocker=q;}
      }
    }
    for(const p of planes){
      const q=p.blocker; if(!q||q.blocker!==p) continue;
      const y=(p.phase==='taxiOut'&&q.phase==='taxiIn')?p:(q.phase==='taxiOut'&&p.phase==='taxiIn')?q:(p.id>q.id?p:q);
      const go=y===p?q:p; go.blockDist=Infinity; go.blocker=null;
    }
  }
};

/* ---------- TOWER agent ---------- */
const tower={
  landing(p){
    const r=p.rwy;
    if(alarm[r]) return false;
    if(lock[r]===null||lock[r]===p.id){ if(lock[r]!==p.id){ lock[r]=p.id; log('TWR',`${p.cs} runway ${r}, cleared to land`);} return true; }
    return false;
  },
  cross(p,r,j){
    if(alarm[r]||lock[r]!==null) return;
    const queued=planes.find(q=>q.phase==='holding'&&q.rwy===r&&simT-lastDep[r]>8&&lock.X===null);
    if(queued&&simT-(queued.holdT||0)>14) return; // let a long-waiting departure go first
    lock[r]=p.id; p.locks.add(r); p.crossJ[r]=j; p.waitFor='';
    { const A=p.path[j],B=p.path[j+1],R=RWY[r]; const x=segX(A,B,R.thr,R.end); p.crossAt=p.crossAt||{}; p.crossAt[r]=(x?x.t:1)*Math.hypot(B[0]-A[0],B[1]-A[1]); }
    log('TWR',`${p.cs} cross runway ${r} at K, don't stop`);
  },
  release(r,p){ if(lock[r]===p.id) lock[r]=null; p.locks.delete(r); },
  arrivalOverDepPath(){ // 13L final passes over the departure end of 4L
    return planes.some(q=>q.rwy==='13L'&&q.phase==='final'&&distThr(q)>230&&distThr(q)<640);
  },
  update(){
    for(const r of ['4L','13R']){
      const q=planes.filter(p=>p.phase==='holding'&&p.rwy===r).sort((a,b)=>a.holdT-b.holdT)[0];
      if(!q) continue;
      let why='';
      if(alarm[r]) why='runway incursion';
      else if(lock[r]!==null){ const h=byId(lock[r]); why=h?`${h.cs} on runway`:'runway occupied'; }
      else if(lock.X!==null) why='intersection 4L/13R in use';
      else if(simT-lastDep[r]<8) why='wake spacing';
      else if(r==='4L'&&this.arrivalOverDepPath()) why='13L arrival crossing 4L climb-out';
      q.waitFor=why;
      if(why){ if(why.startsWith('13L')&&!q.flags.ovr){q.flags.ovr=1; log('TWR',`${q.cs} hold at 4L, 13L arrival crossing departure path`);} continue; }
      lock[r]=q.id; lock.X=q.id; q.phase='lineup'; q.waitFor='';
      setPath(q,[[q.x,q.y],RWY[r].thr.slice()]);
      log('TWR',`${q.cs} runway ${r}, line up and cleared for takeoff`);
    }
  },
  onIncursion(r,rogue){
    for(const p of planes){
      if(p.rwy===r&&(p.phase==='takeoff'||p.phase==='lineup')&&onGround(p)&&!p.abort){ p.abort=true; log('TWR',`${p.cs} STOP IMMEDIATELY, runway ${r} incursion`,'alert'); }
      if(p.rwy===r&&p.phase==='final'){ goAround(p,'runway incursion'); }
    }
  },
  onClear(r){
    for(const p of planes) if(p.abort&&p.rwy===r){ p.abort=false; log('TWR',`${p.cs} runway ${r} clear, resume takeoff`); }
  }
};

/* ---------- SENTINEL agent ---------- */
const sentinel={
  pairs:new Map(), active:[], spacingLogged:new Set(),
  scan(){
    this.active=[];
    const mov=planes.filter(p=>p.phase!=='gate');
    for(let a=0;a<mov.length;a++) for(let b=a+1;b<mov.length;b++){
      const p=mov[a], q=mov[b];
      const gp=onGround(p), gq=onGround(q); if(gp!==gq) continue;
      if(!gp&&Math.abs(p.alt-q.alt)>0.25) continue;
      const rx=q.x-p.x, ry=q.y-p.y, d=Math.hypot(rx,ry);
      const lim=gp?60:150; if(d>lim) continue;
      if(p.v<0.5&&q.v<0.5) continue;
      if(gp&&p.rwy&&p.rwy===q.rwy&&p.phase==='holding'&&q.phase==='holding') continue;
      const vx=q.v*Math.sin(q.mdir)-p.v*Math.sin(p.mdir), vy=-q.v*Math.cos(q.mdir)+p.v*Math.cos(p.mdir);
      const vv=vx*vx+vy*vy; const t=vv>1e-6?clamp(-(rx*vx+ry*vy)/vv,0,4):0;
      const cpa=Math.hypot(rx+vx*t,ry+vy*t);
      const thr=gp?15:40;
      if(cpa<thr&&(gp?d<55:true)){
        p.conf=q.conf=simT;
        const cx=(p.x+q.x)/2+(p.v*Math.sin(p.mdir)+q.v*Math.sin(q.mdir))*t/2;
        const cy=(p.y+q.y)/2-(p.v*Math.cos(p.mdir)+q.v*Math.cos(q.mdir))*t/2;
        this.active.push({p,q,t,cpa,cx,cy});
        const key=p.id<q.id?p.id+'-'+q.id:q.id+'-'+p.id;
        if(gp){
          // pick the aircraft that should yield: never the one on the runway or the one clearing it
          const rw=x=>['takeoff','lineup','rollout'].includes(x.phase)||x.rogue;
          let y;
          if(rw(p)&&!rw(q)) y=q; else if(rw(q)&&!rw(p)) y=p;
          else if(p.blocker===q) y=p; else if(q.blocker===p) y=q;
          else { const dp=Math.sin(p.mdir)*rx-Math.cos(p.mdir)*ry, dq=-(Math.sin(q.mdir)*rx-Math.cos(q.mdir)*ry); y=dp>dq?p:q; }
          if(!rw(y)) y.sentinelHold=Math.max(y.sentinelHold,2.2);
          if(simT-(this.pairs.get(key)||-99)>10){
            this.pairs.set(key,simT);
            const o=y===p?q:p;
            log('SEN',`Conflict predicted ${p.cs} / ${q.cs}: ${Math.round(cpa*M_PER_PX)} m in ${t.toFixed(1)} s → ${rw(y)?'alerting Tower':y.cs+' hold, '+o.cs+' continue'}`,'alert');
          }
        } else if(simT-(this.pairs.get(key)||-99)>10){
          this.pairs.set(key,simT); log('SEN',`Airborne proximity ${p.cs} / ${q.cs}, ${Math.round(cpa*M_PER_PX)} m predicted`,'alert');
        }
      }
    }
    // runway incursions
    for(const p of planes){
      if(!['taxiIn','taxiOut','holding'].includes(p.phase)) continue;
      for(const r of Object.values(RWY)){
        const on=distSeg([p.x,p.y],r.thr,r.end)<9;
        if(on&&lock[r.name]!==p.id&&!alarm[r.name]){
          alarm[r.name]=p.id;
          log('SEN',`RUNWAY INCURSION ${r.name}: ${p.cs} entered without clearance`,'alert');
          log('GND',`${p.cs} expedite across ${r.name} and contact Ground`,'alert');
          tower.onIncursion(r.name,p);
        } else if(!on&&alarm[r.name]===p.id){
          delete alarm[r.name];
          log('SEN',`Runway ${r.name} clear, incursion by ${p.cs} resolved`);
          tower.onClear(r.name);
        }
      }
    }
  }
};

/* ---------- Spawning ---------- */
function spawnArrival(rwy,keep){
  const fg=freeGates(); if(!fg.length||planes.length>=20) return null;
  const r=RWY[rwy]; const gate=pick(fg);
  const id=keep||newCs();
  const start=at(r,-r.spawn);
  const p=mkPlane({...id,kind:'arr',phase:'final',rwy,gate,path:[start,r.thr.slice(),at(r,r.exitS)],v:34,alt:1});
  gateOcc[gate]=p.id;
  log('GND',`${p.cs} (${p.type}) inbound ${rwy}, gate ${gl(gate)} reserved`);
  return p;
}
function goAround(p,why){
  if(p.phase!=='final') return;
  const r=RWY[p.rwy];
  if(lock[p.rwy]===p.id) lock[p.rwy]=null;
  if(gateOcc[p.gate]===p.id) gateOcc[p.gate]=null;
  setPath(p,[[p.x,p.y],at(r,r.len+700)]); p.phase='goaround';
  log('TWR',`${p.cs} GO AROUND, ${why}`,'alert');
  respawn.push({at:simT+22,cs:p.cs,type:p.type});
}

/* ---------- Plane motion ---------- */
function taxiMove(p,dt){
  let limit=remaining(p); p.waitFor=p.waitFor&&p.waitFor.startsWith('pushback')?'':p.waitFor;
  let reason='';
  if(!p.rogue){
    for(let j=(p.u<1e-6?p.i:p.i+1); j<p.meta.length; j++){
      const need=(p.meta[j].cross||[]).filter(r=>!p.locks.has(r));
      if(!need.length) continue;
      const d=distToNode(p,j);
      if(d<60&&!p.rogueArmed&&p.blockDist-SEP>=d-1&&p.sentinelHold<=0) for(const r of need) tower.cross(p,r,j);
      const still=(p.meta[j].cross||[]).filter(r=>!p.locks.has(r));
      if(still.length){ limit=Math.min(limit,d); if(d<3) reason=`hold short ${still.join('/')}`;
        if(p.rogueArmed&&d<1){
          p.rogueWait=(p.rogueWait||0)+dt;
          const r=still[0], h=byId(lock[r]);
          if((h&&(h.phase==='lineup'||(h.phase==='takeoff'&&onGround(h)&&h.v<20)))||p.rogueWait>9){ p.rogue=true; p.rogueJ=j; }
        }
      }
      break;
    }
  }
  if(p.blockDist<Infinity){ const l=p.blockDist-SEP; if(l<limit){limit=l; if(l<2) reason=reason||`traffic ahead · ${p.blocker.cs}`;} }
  if(p.sentinelHold>0){ p.sentinelHold-=p.rogue?99:dt; limit=0; reason='Sentinel hold'; }
  limit=Math.max(0,limit);
  const pushing=p.phase==='taxiOut'&&p.i===0;
  const vmax=p.rogue?24:pushing?6:16;
  const target=limit<0.5?0:Math.min(vmax,0.9*limit+2);
  p.v+=clamp(target-p.v,-40*dt,10*dt); if(p.v<0) p.v=0;
  advance(p,Math.min(p.v*dt,limit));
  for(const r of [...p.locks]){ const j=p.crossJ[r]; if(j==null) continue;
    if(p.i>j||(p.i===j&&p.u>(p.crossAt[r]||0)+14)) tower.release(r,p); }
  if(p.rogue&&(p.i>p.rogueJ||atEnd(p))){ p.rogue=false; p.rogueArmed=false; p.rogueWait=0; }
  if(reason) p.waitFor=reason; else if(!p.waitFor.startsWith('pushback')) p.waitFor='';
  return pushing;
}
function updatePlane(p,dt){
  let pushing=false;
  switch(p.phase){
    case 'gate':
      if(p.kind==='dep'){ p.dwell-=dt; if(p.dwell<=0) ground.requestPush(p); }
      break;
    case 'final':{
      const d=distThr(p); p.alt=clamp(d/320,0,1);
      const lead=planes.filter(q=>q!==p&&q.rwy===p.rwy&&q.phase==='final'&&distThr(q)<d).sort((a,b)=>distThr(b)-distThr(a))[0];
      p.slow=!!(lead&&d-distThr(lead)<130);
      if(p.slow&&!sentinel.spacingLogged.has(p.id)){ sentinel.spacingLogged.add(p.id); log('SEN',`${p.cs} closing on ${lead.cs} on final ${p.rwy}, gap ${(Math.round((d-distThr(lead))*M_PER_PX/100)/10)} km → reduce speed`); }
      const tgt=p.slow?20:34; p.v+=clamp(tgt-p.v,-6*dt,6*dt);
      if(d<320) p.cleared=tower.landing(p);
      p.waitFor=p.cleared?'':(d<320?'awaiting landing clearance':'');
      if(!p.cleared&&d<70){ goAround(p,`runway ${p.rwy} not clear`); break; }
      advance(p,p.v*dt);
      if(p.i>=1){ p.phase='rollout'; p.alt=0; }
      break;}
    case 'rollout':
      p.v=Math.max(9,p.v-2.4*dt); advance(p,p.v*dt);
      if(atEnd(p)) ground.taxiIn(p);
      break;
    case 'taxiIn':
      taxiMove(p,dt);
      if(lock[p.rwy]===p.id&&distSeg([p.x,p.y],RWY[p.rwy].thr,RWY[p.rwy].end)>14) lock[p.rwy]=null;
      if(atEnd(p)){
        if(lock[p.rwy]===p.id) lock[p.rwy]=null;
        const gate=p.gate; parkAt(p,gate);
        const n=newCs(); p.flags={}; p.kind='dep'; p.prev=p.cs; p.cs=p.cs.slice(0,3)+(Math.floor(Math.random()*890)+11); p.dwell=26+Math.random()*24; p.rwy=null;
        log('GND',`${p.prev} on blocks at ${gl(gate)}; turns as ${p.cs}`);
      }
      break;
    case 'taxiOut':
      pushing=taxiMove(p,dt);
      if(atEnd(p)){ p.phase='holding'; p.holdT=simT; p.v=0; }
      break;
    case 'holding': break;
    case 'lineup':
      p.v=Math.min(8,p.v+8*dt); if(p.abort) p.v=0; advance(p,p.v*dt);
      if(atEnd(p)){ const r=RWY[p.rwy]; setPath(p,[r.thr.slice(),r.end.slice(),at(r,r.len+800)]); p.phase='takeoff'; p.v=2; }
      break;
    case 'takeoff':{
      const r=RWY[p.rwy];
      if(p.abort) p.v=Math.max(0,p.v-32*dt); else p.v=Math.min(74,p.v+7*dt);
      advance(p,p.v*dt);
      const s=p.i===0?p.u:r.len+p.u;
      p.alt=clamp((s-0.55*r.len)/260,0,1);
      if(lock.X===p.id&&s>SX[p.rwy]+25) lock.X=null;
      if(lock[p.rwy]===p.id&&p.alt>0.25){ lock[p.rwy]=null; lastDep[p.rwy]=simT; }
      break;}
    case 'goaround':
      p.v=Math.min(55,p.v+6*dt); p.alt=Math.min(1,p.alt+0.35*dt); advance(p,p.v*dt);
      break;
  }
  // heading smoothing
  const want=pushing?p.mdir+Math.PI:(p.phase==='gate'?p.hdg:p.mdir);
  let dh=((want-p.hdg+Math.PI*3)%(Math.PI*2))-Math.PI;
  p.hdg+=dh*Math.min(1,dt*(pushing?10:5));
}

let nextArr=14, arrFlip=0, pendingRogue=false;
function step(dt){
  simT+=dt;
  tower.update();
  sentinel.scan();
  ground.computeBlocks();
  for(const p of [...planes]) updatePlane(p,dt);
  for(const p of [...planes]){
    if((p.phase==='takeoff'||p.phase==='goaround')&&(p.x<-80||p.x>1280||p.y<-80||p.y>880)) removePlane(p);
  }
  if(simT>nextArr){ spawnArrival(arrFlip++%2?'13L':'4R'); nextArr=simT+12+Math.random()*7; }
  for(let i=respawn.length-1;i>=0;i--) if(simT>respawn[i].at){ const o=respawn.splice(i,1)[0]; const p=spawnArrival('13L',{cs:o.cs,type:o.type}); if(p) log('TWR',`${p.cs} re-sequenced for 13L after go-around`); }
}

/* ---------- Render ---------- */
const ov={routes:true,pred:true,labels:true};
const PH={gate:'GATE',taxiOut:'TXO',holding:'HOLD',lineup:'LUAW',takeoff:'T/O',final:'FNL',rollout:'ROLL',taxiIn:'TXI',goaround:'G/A'};
function phaseText(p){
  switch(p.phase){
    case 'gate': return `${p.kind==='dep'?'▲':'▼'} gate ${gl(p.gate)}`;
    case 'taxiOut': return `▲ taxi → ${p.rwy}`;
    case 'holding': return `▲ hold ${p.rwy}`;
    case 'lineup': return `▲ line up ${p.rwy}`;
    case 'takeoff': return p.alt>0.05?`▲ climb ${p.rwy}`:`▲ roll ${p.rwy}`;
    case 'final': return `▼ final ${p.rwy}`;
    case 'rollout': return `▼ rollout ${p.rwy}`;
    case 'taxiIn': return `▼ taxi → ${gl(p.gate)}`;
    case 'goaround': return `go around`;
  }
  return p.phase;
}
function render(){
  for(const p of planes){
    const e=p.el, sc=0.95+0.6*p.alt, deg=p.hdg/rad;
    e.g.setAttribute('transform',`translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
    e.body.setAttribute('transform',`rotate(${deg.toFixed(1)}) scale(${sc.toFixed(2)})`);
    e.shadow.setAttribute('transform',`translate(${(p.alt*16).toFixed(1)},${(p.alt*16).toFixed(1)}) rotate(${deg.toFixed(1)}) scale(${(sc*0.95).toFixed(2)})`);
    e.shadow.style.display=p.alt>0.02?'':'none';
    const conf=simT-p.conf<0.6||(p.rogue)||Object.values(alarm).includes(p.id);
    const hold=!conf&&p.phase!=='gate'&&!!p.waitFor&&p.v<1;
    e.g.setAttribute('class',`ac ${p.kind}${conf?' conf':''}${hold?' hold':''}${selId===p.id?' sel':''}`);
    const showLbl=ov.labels&&(p.phase!=='gate'||selId===p.id);
    e.cs.textContent=showLbl?p.cs:''; e.ph.textContent=showLbl?phaseText(p):'';
    // routes
    const showR=(ov.routes&&p.phase!=='gate')||selId===p.id;
    if(showR&&p.phase!=='gate'){
      const pts=[[p.x,p.y],...p.path.slice(p.i+1)];
      e.rt.setAttribute('points',P(pts));
      e.rt.setAttribute('class',`route ${['taxiIn','taxiOut'].includes(p.phase)?'g':'t'}`);
      e.rt.style.opacity=selId===p.id?1:(selId?0.18:0.5);
      e.rt.style.display='';
    } else e.rt.style.display='none';
    // predictions
    if(ov.pred&&p.v>0.5){
      const k=4; e.pr.setAttribute('x1',p.x); e.pr.setAttribute('y1',p.y);
      e.pr.setAttribute('x2',p.x+Math.sin(p.mdir)*p.v*k); e.pr.setAttribute('y2',p.y-Math.cos(p.mdir)*p.v*k);
      e.pr.style.display='';
    } else e.pr.style.display='none';
  }
  let c='';
  for(const a of sentinel.active){
    c+=`<line class="conflink" x1="${a.p.x}" y1="${a.p.y}" x2="${a.q.x}" y2="${a.q.y}"/><circle class="cpa" cx="${a.cx.toFixed(1)}" cy="${a.cy.toFixed(1)}" r="5"/>`;
  }
  gConf.innerHTML=c;
  for(const r in LOCKEL) LOCKEL[r].setAttribute('class','rlock'+(alarm[r]?' alarm':lock[r]!==null?' on':''));
  xEl.setAttribute('class','xlock'+(lock.X!==null?' on':''));
}

/* ---------- Side panel ---------- */
function holderText(r){
  if(alarm[r]){ const p=byId(alarm[r]); return `INCURSION · ${p?p.cs:''}`; }
  const p=byId(lock[r]); if(!p) return 'CLEAR';
  const w={final:'landing',rollout:'rollout',lineup:'lining up',takeoff:'departing',taxiIn:'vacating',taxiOut:'crossing'}[p.phase]||p.phase;
  return `${w} · ${p.cs}`;
}
const ORDER={final:0,rollout:1,takeoff:2,lineup:3,holding:4,taxiIn:5,taxiOut:6,goaround:7,gate:8};
function chip(p){
  if(p.rogue||Object.values(alarm).includes(p.id)) return 'a';
  if(['final','rollout','lineup','takeoff','goaround','holding'].includes(p.phase)) return p.phase==='goaround'?'a':'t';
  if(p.phase==='gate') return 'm';
  return 'g';
}
function ui(){
  $('clock').textContent=clockStr();
  const qd=planes.filter(p=>p.phase==='holding').length;
  const active=Object.keys(RWY).filter(r=>lock[r]!==null).length;
  $('lTWR').textContent=`${active}/4 runways active · ${qd} awaiting takeoff`;
  const tx=planes.filter(p=>p.phase==='taxiIn'||p.phase==='taxiOut');
  const held=tx.filter(p=>p.v<1&&p.waitFor).length;
  $('lGND').textContent=`${tx.length} taxiing · ${held} holding · ${freeGates().length}/15 gates free`;
  $('lSEN').textContent=`${planes.filter(p=>p.phase!=='gate').length} tracked · ${sentinel.active.length} predicted conflict${sentinel.active.length===1?'':'s'}`;
  for(const k of ['TWR','GND','SEN']) $('n'+k).textContent=`${counts[k]} msg`;
  $('rwys').innerHTML=Object.values(RWY).map(r=>`<div class="rwy ${alarm[r.name]?'alarm':lock[r.name]!==null?'busy':'free'}"><div class="nm"><b>${r.name}-${r.opp}</b><span>${r.use==='arr'?'ARR':'DEP'} ${r.name}</span></div><div class="st">${holderText(r.name)}</div></div>`).join('');
  const list=[...planes].sort((a,b)=>(ORDER[a.phase]-ORDER[b.phase])||a.id-b.id);
  $('strips').innerHTML=list.map(p=>`<tr data-id="${p.id}" class="${selId===p.id?'sel':''}"><td class="cs">${p.cs}</td><td class="ty">${p.type}</td><td><span class="chip ${chip(p)}">${PH[p.phase]}</span></td><td class="wh">${p.phase==='gate'?gl(p.gate):p.rwy||''}${p.phase==='taxiIn'?' → '+gl(p.gate):''}${p.waitFor&&p.phase!=='gate'?`<span class="wait ${p.waitFor.startsWith('Sentinel')?'s':''}">${p.waitFor}</span>`:''}</td></tr>`).join('');
  const info=$('info'), p=byId(selId);
  if(p){
    info.hidden=false;
    info.innerHTML=`<div class="h"><b>${p.cs}</b><span class="chip ${chip(p)}">${PH[p.phase]}</span><button class="x" type="button" aria-label="Close" id="infoX">×</button></div>
    <dl><dt>Type</dt><dd>${p.type}</dd><dt>Status</dt><dd>${phaseText(p)}</dd>
    <dt>Runway</dt><dd>${p.rwy||'–'}</dd><dt>Gate</dt><dd>${p.gate?gl(p.gate):'–'}</dd>
    <dt>Waiting on</dt><dd>${p.waitFor||'–'}</dd><dt>Altitude</dt><dd>${p.alt>0.02?Math.round(p.alt*3000)+' ft':'ground'}</dd></dl>`;
    $('infoX').onclick=()=>{selId=null;};
  } else info.hidden=true;
}

/* ---------- Controls ---------- */
$('play').onclick=()=>{paused=!paused; $('play').textContent=paused?'Resume':'Pause';};
document.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{speed=+b.dataset.sp; document.querySelectorAll('.seg button').forEach(x=>x.setAttribute('aria-pressed',x===b));});
$('ovRoutes').onchange=e=>ov.routes=e.target.checked;
$('ovPred').onchange=e=>ov.pred=e.target.checked;
$('ovLabels').onchange=e=>ov.labels=e.target.checked;
$('surge').onclick=()=>{
  const r=RWY['13L']; let n=0;
  for(let k=0;k<3;k++){ const p=spawnArrival('13L'); if(p){ setPath(p,[at(r,-r.spawn-k*70),r.thr.slice(),at(r,r.exitS)]); n++; } }
  log('TWR',n?`Arrival surge: ${n} extra aircraft inbound 13L`:'Arrival surge refused, no gates free');
};
$('inject').onclick=()=>{
  const cands=planes.filter(p=>p.phase==='taxiOut'&&!p.rogueArmed&&p.meta.some((m,j)=>j>=p.i&&(m.cross||[]).some(r=>!p.locks.has(r))));
  if(cands.length){
    const p=cands.sort((a,b)=>(a.rwy==='4L'?0:1)-(b.rwy==='4L'?0:1)||remaining(a)-remaining(b))[0];
    p.rogueArmed=true; selId=p.id;
    log('SEN',`Scenario: ${p.cs} will miss its hold-short instruction at K`);
  } else { pendingRogue=true; log('SEN','Scenario armed: the next departure to push back will miss its hold-short'); }
};
$('map').addEventListener('click',e=>{
  const g=e.target.closest('.ac'); selId=g?+g.dataset.id:null; ui();
});
$('strips').addEventListener('click',e=>{const tr=e.target.closest('tr'); if(tr){selId=+tr.dataset.id; ui();}});

/* ---------- Initial state ---------- */
const gk=Object.keys(GATES).sort(()=>Math.random()-0.5);
for(let i=0;i<11;i++){
  const id=newCs(); const p=mkPlane({...id,kind:'dep',path:[[0,0],[0,0]]});
  parkAt(p,gk[i]); p.dwell=3+i*6+Math.random()*4;
}
{ const p=spawnArrival('4R'); if(p){ p.u=200; updPos(p);} }
{ const p=spawnArrival('13L'); if(p){ p.u=420; updPos(p);} }
for(let i=0;i<700;i++) step(0.05); // warm up so the field opens busy

window.airfield={planes,RWY,NODES,ADJ,lock,alarm,tower,ground,sentinel,route,log};

let last=performance.now(), uiAcc=0;
function frame(now){
  const dt=Math.min(0.1,(now-last)/1000); last=now;
  if(!paused){ let s=dt*speed; while(s>1e-6){ const h=Math.min(0.05,s); step(h); s-=h; } }
  render(); uiAcc+=dt; if(uiAcc>0.25){uiAcc=0; ui();}
  requestAnimationFrame(frame);
}
render(); ui(); requestAnimationFrame(frame);
})();
