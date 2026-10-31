import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createScenario,SCENARIOS,clone,buildRunwayPlan,validatePlan,deterministicFallback,searchReference,applyUpdate,parseUpdate,scenarioErrors} from './domain.mjs';
import {negotiate} from './agents.mjs';
import {providerConfig} from './providers.mjs';
import {parseCSV,qualifyingFlights} from './import.mjs';
import {constraints,flightIndex,createRecoveryScenario,negotiateRecovery,chooseRecovery,recoveryMapPayload} from './recovery.mjs';
import {airportCatalog,getAirport,airportSummaries,airportMapData} from './airports.mjs';
import {chainContext,chainImpact} from './chain.mjs';
import {liveRecoveryConfig,negotiateLiveRecovery} from './live-recovery.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{const env=await readFile(path.join(root,'.env'),'utf8');for(const line of env.split(/\r?\n/)){const m=line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}}catch{}
const sessions=new Map();
const recoveries=new Map();
function recoverySnapshot(s){return {id:s.id,scenario:s.scenario,chain:s.chain?.summary??null,running:Boolean(s.running),portfolio:s.portfolio,selection:s.selection,audit:s.audit,maps:s.portfolio?Object.fromEntries(s.portfolio.options.map(o=>[o.id,recoveryMapPayload(s.scenario,o,s.portfolio,s.selection)])):null};}
let catalog={airports:[],airlines:[]};
for(const type of ['airports','airlines'])try{catalog[type]=parseCSV(await readFile(path.join(root,'data',`${type}.csv`),'utf8'));}catch{}
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>2_100_000){throw new Error('Request exceeds 2 MB. Upload a flight-data subset.');}}try{return JSON.parse(text||'{}');}catch{throw new Error('Request must be valid JSON.');}}
function snapshot(session){const initialPlan=session.result?.plan||session.result?.lastCandidate||buildRunwayPlan(session.scenario);return {id:session.id,scenario:session.scenario,result:session.result,initialPlan,validation:initialPlan?validatePlan(session.scenario,initialPlan):null,baseline:deterministicFallback(session.scenario),running:session.running};}
function current(id){const s=sessions.get(id);if(!s)throw new Error('Session expired. Choose a scenario to start again.');return s;}
function newSession(scenario){if(sessions.size>=100)sessions.delete(sessions.keys().next().value);const id=randomUUID();const s={id,scenario,result:null,running:false,runs:[],audit:[],importRows:[]};sessions.set(id,s);return s;}
function updateSession(session,update,sourceText=null){const previous=session.scenario.stateVersion;session.scenario=applyUpdate(session.scenario,update);session.result=null;session.audit.push({type:'state_updated',time:new Date().toISOString(),previousVersion:previous,stateVersion:session.scenario.stateVersion,update,sourceText,explanation:'All previous plan acceptances invalidated.'});return snapshot(session);}

export const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method==='POST'){
      const origin=req.headers.origin;
      if(origin&&origin!==`http://${req.headers.host}`){json(res,403,{error:'Cross-origin mutations are not allowed.'});return;}
      if(!String(req.headers['content-type']||'').startsWith('application/json')){json(res,415,{error:'Use application/json.'});return;}
    }
    if(req.method==='GET'&&url.pathname==='/api/recovery'){
      const airport=getAirport(url.searchParams.get('airport')||'JFK'),records=airport.code==='JFK'?flightIndex.records:airport.records;
      json(res,200,{live:liveRecoveryConfig(),dataset:{rows:flightIndex.totalRows,qualifying:flightIndex.qualifyingRows,jfkArrivals:flightIndex.jfkArrivalCount,airportArrivals:airport.arrivalCount,sha256:flightIndex.sha256,sourceUrl:flightIndex.sourceUrl},workbook:constraints.source,airport:airportMapData(airport.code),airports:airportSummaries(),flights:records.map((r,index)=>({index,sourceRow:r.sourceRow,...r.record})),limits:airport.capacity});return;
    }
    if(req.method==='GET'&&url.pathname==='/api/airports'){
      json(res,200,{airports:airportSummaries(),sources:airportCatalog.sources,retrievedAt:airportCatalog.retrievedAt});return;
    }
    const airportRoute=url.pathname.match(/^\/api\/airports\/([A-Z]{3})$/);
    if(req.method==='GET'&&airportRoute){
      json(res,200,airportMapData(airportRoute[1]));return;
    }
    if(req.method==='POST'&&url.pathname==='/api/recovery'){
      const b=await body(req),scenario=createRecoveryScenario(b.index??0,{airportCode:b.airportCode??'JFK',closedStands:b.closedStands||[],arrivalFuel:b.arrivalFuel});
      if(scenario.closedStands.some(id=>!scenario.stands.some(s=>s.id===id))||!Number.isFinite(scenario.target.arrivalFuel)||scenario.target.arrivalFuel<0)throw new Error('Invalid recovery inputs.');
      if(recoveries.size>=100)recoveries.delete(recoveries.keys().next().value);
      const chain=chainContext(b.index??0,scenario,{stress:Boolean(b.stress)});
      scenario.collisionContext={stress:Boolean(b.stress),sourceRows:chain?.entries.map(e=>e.sourceRow)??[scenario.source.sourceRow]};
      const s={id:randomUUID(),scenario,chain,portfolio:null,selection:null,audit:[]};recoveries.set(s.id,s);json(res,201,recoverySnapshot(s));return;
    }
    const recoveryRoute=url.pathname.match(/^\/api\/recovery\/([a-f0-9-]+)(?:\/(\w+))?$/);
    if(recoveryRoute){
      const s=recoveries.get(recoveryRoute[1]);if(!s)throw new Error('Recovery session expired. Reload the flight.');
      const action=recoveryRoute[2];
      if(req.method==='GET'&&!action){json(res,200,recoverySnapshot(s));return;}
      if(req.method==='POST'&&['run','compare','choose'].includes(action)&&s.running){json(res,409,{error:'Wait for the current recovery evaluation to finish.'});return;}
      if(req.method==='POST'&&action==='run'){
        await body(req);
        if(s.running){json(res,409,{error:'Wait for the current recovery evaluation to finish.'});return;}
        if(!liveRecoveryConfig().available){json(res,400,{error:'Configure a separate Claude API key and model for each role.'});return;}
        s.running=true;s.portfolio=null;s.selection=null;
        const controller=new AbortController();
        const disconnected=()=>controller.abort();res.on('close',disconnected);
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','x-accel-buffering':'no'});
        const write=(type,data)=>{if(!res.destroyed)res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);};
        const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},10000);
        try{
          const portfolio=await negotiateLiveRecovery(clone(s.scenario),{signal:controller.signal,chain:s.chain?chainImpact(s.chain):null,chainSummary:s.chain?.summary??null,onEvent:event=>write('progress',event)});
          controller.signal.throwIfAborted();s.portfolio=portfolio;s.audit.push({type:'comparison',time:new Date().toISOString(),portfolio:clone(portfolio)});
          s.running=false;write('result',recoverySnapshot(s));
        }catch{if(!res.destroyed)write('failure',{error:'Live evaluation was interrupted. Evaluate again before selecting a plan.'});}
        finally{s.running=false;clearInterval(heartbeat);res.off('close',disconnected);res.end();}return;
      }
      if(req.method==='POST'&&action==='compare'){
        const b=await body(req);if(s.running){json(res,409,{error:'Wait for the current recovery evaluation to finish.'});return;}s.portfolio=negotiateRecovery(s.scenario,{forceTimeout:Boolean(b.forceTimeout),chain:s.chain?chainImpact(s.chain):null});s.selection=null;s.audit.push({type:'comparison',time:new Date().toISOString(),portfolio:clone(s.portfolio)});json(res,200,recoverySnapshot(s));return;
      }
      if(req.method==='POST'&&action==='choose'){
        const request=await body(req);if(s.running){json(res,409,{error:'Wait for the current recovery evaluation to finish.'});return;}s.selection=chooseRecovery(s.scenario,s.portfolio,request);s.portfolio.selectedId=s.selection.optionId;s.audit.push({type:'human_selection',...s.selection});json(res,200,recoverySnapshot(s));return;
      }
      if(req.method==='GET'&&action==='export'){
        res.writeHead(200,{'content-type':'application/json','content-disposition':'attachment; filename="clearance-recovery-audit.json"','cache-control':'no-store'});res.end(JSON.stringify({schemaVersion:2,dataset:{sourceUrl:flightIndex.sourceUrl,sha256:flightIndex.sha256,rows:flightIndex.totalRows},workbook:constraints.source,...recoverySnapshot(s)},null,2));return;
      }
    }
    if(req.method==='GET'&&url.pathname==='/api/config'){json(res,200,{providers:providerConfig(),scenarios:SCENARIOS,lookups:{airports:catalog.airports.length,airlines:catalog.airlines.length},version:'0.1.0'});return;}
    if(req.method==='POST'&&url.pathname==='/api/sessions'){const b=await body(req);const session=newSession(createScenario(b.scenarioId||'weather',b.seed??42));json(res,201,snapshot(session));return;}
    const route=url.pathname.match(/^\/api\/sessions\/([a-f0-9-]+)(?:\/(\w+))?$/);
    if(route){
      const session=current(route[1]),action=route[2];
      if(req.method==='GET'&&!action){json(res,200,snapshot(session));return;}
      if(req.method==='GET'&&action==='export'){
        res.writeHead(200,{'content-type':'application/json','content-disposition':'attachment; filename="clearance-audit.json"','cache-control':'no-store'});
        res.end(JSON.stringify({schemaVersion:1,exportedAt:new Date().toISOString(),scenario:session.scenario,runs:session.runs,audit:session.audit,limitations:['Synthetic operational state. No operational certification.','Local policy agents are deterministic; live API runs are labelled separately.','Reference search is bounded and does not prove global optimality.']},null,2));return;
      }
      if(req.method==='POST'&&action==='update'){const b=await body(req);const update=b.text?parseUpdate(b.text,session.scenario):b.update;json(res,200,updateSession(session,update,b.text||null));return;}
      if(req.method==='POST'&&action==='import'){
        const b=await body(req);const result=qualifyingFlights(b.csv);session.importRows=result.rows;json(res,200,result);return;
      }
      if(req.method==='POST'&&action==='trigger'){
        const b=await body(req);if(session.running)throw new Error('Wait for the current negotiation before changing the historical trigger.');
        if(!Number.isInteger(b.index)||!session.importRows[b.index])throw new Error('Select an imported qualifying record.');
        const row=session.importRows[b.index],s=clone(session.scenario),airport=catalog.airports.find(a=>a.IATA_CODE===row.origin);
        s.stateVersion++;s.provenance={type:'historical_trigger',label:'Historical trigger · simulated operational state',source:row};
        if(airport)s.airport={code:airport.IATA_CODE,name:airport.AIRPORT,timezone:null};
        if(/^[A-Z0-9]{2,3}$/.test(row.airline)&&/^[A-Z0-9]{1,6}$/.test(row.flightNumber))s.flights[0].callsign=`${row.airline} ${row.flightNumber}`;
        // Import changes identity/provenance only. It never fabricates operational capacity from delay minutes.
        session.scenario=s;session.result=null;session.audit.push({type:'historical_trigger_selected',time:new Date().toISOString(),stateVersion:s.stateVersion,source:row});json(res,200,snapshot(session));return;
      }
      if(req.method==='POST'&&action==='run'){
        if(session.running){json(res,409,{error:'A negotiation is already running in this session.'});return;}
        const b=await body(req);
        const mode=b.mode||'policy',cfg=providerConfig();
        if(!['policy','claude','gemini','mixed'].includes(mode))throw new Error('Unknown agent mode.');
        if((mode==='claude'&&!cfg.claude.available)||(mode==='gemini'&&!cfg.gemini.available)||(mode==='mixed'&&(!cfg.claude.available||!cfg.gemini.available)))throw new Error('Live mode needs server-side keys and model IDs.');
        const maxRounds=b.maxRounds??3;if(!Number.isInteger(maxRounds)||maxRounds<1||maxRounds>5)throw new Error('Round limit must be 1–5.');
        session.running=true;const scenarioAtStart=clone(session.scenario);
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','x-accel-buffering':'no'});
        const write=(type,data)=>{if(!res.destroyed)res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);};
        const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(': heartbeat\n\n');},10000);
        try{
          const result=await negotiate({getScenario:()=>session.scenario,mode,maxRounds,forceTimeout:Boolean(b.forceTimeout),onEvent:event=>write('trace',event)});
          if(session.scenario.stateVersion===result.stateVersion)session.result=result;
          session.runs.push({scenario:scenarioAtStart,result});session.runs=session.runs.slice(-20);
          session.running=false;write('result',{result,snapshot:snapshot(session)});
        }catch(error){write('failure',{error:error.message});}
        finally{session.running=false;clearInterval(heartbeat);res.end();}return;
      }
      if(req.method==='POST'&&action==='evaluate'){
        if(session.running)throw new Error('Wait for negotiation to finish before evaluating.');
        const baseline=deterministicFallback(session.scenario),reference=searchReference(session.scenario);
        json(res,200,{baseline,reference,negotiated:session.result?.metrics??null,stateVersion:session.scenario.stateVersion});return;
      }
    }
    const files={'/':'recovery.html','/index.html':'recovery.html','/operations.html':'operations.html','/recovery.js':'recovery.js','/recovery.css':'recovery.css','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg','/airfield-theme.css':'airfield-theme.css','/jfk-plan.html':'jfk-plan.html','/jfk-plan.js':'jfk-plan.js','/jfk-demo.html':'jfk-demo.html','/jfk-demo.js':'jfk-demo.js','/jfk-base.css':'jfk-base.css','/jfk-connected.css':'jfk-connected.css','/jfk-replay.mjs':'jfk-replay.mjs'};
    Object.assign(files,{'/airport-map.html':'airport-map.html','/airport-map.js':'airport-map.js','/airport-map.css':'airport-map.css','/airport-geometry.mjs':'airport-geometry.mjs','/vendor/leaflet/leaflet.js':'vendor/leaflet/leaflet.js','/vendor/leaflet/leaflet.css':'vendor/leaflet/leaflet.css','/collision-triage.css':'collision-triage.css','/live-recovery.css':'live-recovery.css','/agent-conversation.mjs':'agent-conversation.mjs'});
    if(req.method==='GET'&&files[url.pathname]){
      const file=files[url.pathname],mime=file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/javascript';
      const framePolicy=['jfk-plan.html','jfk-demo.html','airport-map.html'].includes(file)?"'self'":"'none'";
      const tileOrigin=file==='airport-map.html'?' https://tile.openstreetmap.org':'';
      res.writeHead(200,{'content-type':`${mime}; charset=utf-8`,'cache-control':'no-store','referrer-policy':'strict-origin-when-cross-origin','x-content-type-options':'nosniff','content-security-policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:${tileOrigin}; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors ${framePolicy}`});res.end(await readFile(path.join(root,'public',file)));return;
    }
    json(res,404,{error:'Not found.'});
  }catch(error){if(!res.headersSent)json(res,400,{error:error.message});else res.end();}
});

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4173);
  server.listen(port,'127.0.0.1',()=>console.log(`Clearance running at http://127.0.0.1:${port}`));
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is in use. Set PORT to another port.`:error.message);process.exitCode=1;});
}
