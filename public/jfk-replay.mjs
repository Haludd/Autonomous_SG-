export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

export function samplePath(points,fraction){
  if(!points?.length)return {x:0,y:0,heading:0};
  const segments=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
  const total=segments.reduce((a,b)=>a+b,0);let distance=clamp(fraction,0,1)*total;
  for(let i=0;i<segments.length;i++){
    if(distance<=segments[i]||i===segments.length-1){const a=points[i],b=points[i+1],f=segments[i]?clamp(distance/segments[i],0,1):0;return {x:a[0]+(b[0]-a[0])*f,y:a[1]+(b[1]-a[1])*f,heading:Math.atan2(b[0]-a[0],-(b[1]-a[1]))*180/Math.PI};}
    distance-=segments[i];
  }
  return {x:points[0][0],y:points[0][1],heading:0};
}

function sourcePosition(points,fraction){
  if(!points?.length||points.some(point=>!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)))return {x:null,y:null,heading:0,visible:false,mapPositionUnavailable:true};
  return {...samplePath(points,fraction),visible:true};
}

export function aircraftAt(flight,departure,minute,geometry){
  const parked={...sourcePosition([geometry.gate],0),phase:'GATE',engineOn:0};
  if(!departure)return parked;
  let state;
  const towEnd=departure.towStart+geometry.towMinutes;
  if(departure.mode==='remote'&&minute>=departure.towStart&&minute<towEnd)state={...sourcePosition(geometry.tow,(minute-departure.towStart)/geometry.towMinutes),phase:'TOW'};
  else if(minute<departure.pushback)state=departure.mode==='remote'&&minute>=towEnd?{...sourcePosition([geometry.remote],0),phase:'REMOTE'}:parked;
  else if(minute<departure.takeoff){
    const movingDuration=flight.pushMinutes+flight.taxiMinutes;
    const elapsed=minute-departure.pushback;
    state={...sourcePosition(geometry.taxi,elapsed/movingDuration),phase:elapsed<flight.pushMinutes?'PUSHBACK':elapsed>=movingDuration?'HOLD':'TAXI'};
  }else {const position=sourcePosition(geometry.runway,(minute-departure.takeoff)/0.8);state={...position,phase:'DEPARTED',visible:position.visible&&minute<departure.takeoff+0.8};}
  const engineOn=clamp(minute-departure.pushback,0,departure.takeoff-departure.pushback);
  return {...state,visible:state.visible!==false,engineOn,fuelNow:flight.fuel-engineOn*flight.fuelRate,plannedMargin:flight.fuel-(departure.takeoff-departure.pushback)*flight.fuelRate-flight.requiredDepartureFuel};
}

// Counterfactual arrival/turnaround replay. Missing map anchors remain invisible.
export function recoveryArrivalAt(arrival,minute,geometry){
  const {baselineLanding,landing,gateIn,ready,nextDeparture}=arrival;
  if(minute<baselineLanding)return {...sourcePosition(geometry.approach,minute/Math.max(1,baselineLanding)),phase:'INBOUND'};
  if(minute<landing){if(!geometry.hold)return {...sourcePosition(null,0),phase:'HOLDING'};const a=(minute-baselineLanding)*Math.PI/2;return {x:geometry.hold[0]+28*Math.cos(a),y:geometry.hold[1]+18*Math.sin(a),heading:a*180/Math.PI+90,phase:'HOLDING',visible:true};}
  if(minute<gateIn)return {...sourcePosition(geometry.arrivalTaxi,(minute-landing)/Math.max(.1,gateIn-landing)),phase:'ARRIVAL_TAXI'};
  if(minute<ready)return {...sourcePosition([geometry.gate],0),phase:'TURNAROUND'};
  if(minute<nextDeparture)return {...sourcePosition(geometry.departureTaxi,(minute-ready)/Math.max(.1,nextDeparture-ready)),phase:minute<ready+2?'PUSHBACK':'TAXI'};
  const position=sourcePosition(geometry.runway,(minute-nextDeparture)/.8);
  return {...position,phase:'DEPARTED',visible:position.visible&&minute<nextDeparture+.8};
}

export function standIntervals(scenario,plan){
  if(!plan)return scenario.flights.map(f=>({id:f.id,stand:f.gate,start:0,end:scenario.horizon}));
  const result=[];
  for(const f of scenario.flights){const d=plan.departures.find(d=>d.flightId===f.id);if(!d)continue;
    result.push({id:f.id,stand:f.gate,start:0,end:d.mode==='remote'?d.towStart+f.pushMinutes:d.pushback+f.pushMinutes});
    if(d.mode==='remote')result.push({id:f.id,stand:d.standId,start:d.towStart+scenario.towMinutes,end:d.pushback+f.pushMinutes});
  }
  for(const a of scenario.arrivals){const assignment=plan.arrivals.find(p=>p.flightId===a.id);if(assignment)result.push({id:a.id,stand:assignment.standId,start:a.gateIn,end:a.clearAt});}
  return result;
}

export function gateConflicts(scenario,plan){
  const intervals=standIntervals(scenario,plan),result=[];
  for(let i=0;i<intervals.length;i++)for(let j=i+1;j<intervals.length;j++){const a=intervals[i],b=intervals[j];if(a.stand===b.stand&&a.start<b.end&&b.start<a.end)result.push({stand:a.stand,first:a.id,second:b.id,start:Math.max(a.start,b.start),end:Math.min(a.end,b.end)});}
  return result;
}
