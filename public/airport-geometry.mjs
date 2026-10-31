// Runway and gate anchors use source coordinates. Missing anchors stay null.
// Local x/y coordinates are metres east/south of the airport reference point.
export function createAirportGeometry(airport){
  const latitude=airport.latitude,longitude=airport.longitude;
  const eastScale=111320*Math.cos(latitude*Math.PI/180);
  const project=([lat,lng])=>[(lng-longitude)*eastScale,(latitude-lat)*111320];
  const unproject=([x,y])=>[latitude-y/111320,longitude+x/eastScale];
  const sourceRunways=airport.runways.filter(runway=>!runway.closedInSource);
  const runwayName=value=>String(value??'').replace(/^0+(?=\d)/,'');
  const runwayFor=id=>{
    const source=sourceRunways.find(runway=>runwayName(runway.lowIdent)===runwayName(id)||runwayName(runway.highIdent)===runwayName(id))??sourceRunways[0];
    if(!source)return null;
    const reverse=runwayName(source.highIdent)===runwayName(id);
    return {start:project(reverse?source.end:source.start),end:project(reverse?source.start:source.end),simulated:false};
  };
  const gateFor=id=>airport.gateBindings?.[id]??null;
  const stand=id=>{const gate=gateFor(id);return gate?project([gate.latitude,gate.longitude]):null;};
  const extend=(start,end,distance)=>{
    const dx=end[0]-start[0],dy=end[1]-start[1],length=Math.hypot(dx,dy)||1;
    return [end[0]+distance*dx/length,end[1]+distance*dy/length];
  };
  function departure(flight,assignment){
    const gate=stand(assignment?.standId??flight.gate),runway=runwayFor(assignment?.runway);
    return {gate,remote:null,taxi:gate&&runway?[gate,runway.start]:null,tow:null,towMinutes:4,runway:runway?[runway.start,runway.end,extend(runway.start,runway.end,500)]:null};
  }
  function arrival(data){
    const assignment=data.plan.arrivals[0],runway=runwayFor(assignment.runway),gate=stand(assignment.standId);
    const approach=runway?extend(runway.end,runway.start,3000):null,holding=runway?extend(runway.end,runway.start,1800):null;
    const onward=runwayFor(data.scenario.runwayRoles.departure);
    return {gate,hold:holding,approach:runway?[approach,runway.start]:null,arrivalTaxi:runway&&gate?[runway.start,runway.end,gate]:null,departureTaxi:gate&&onward?[gate,onward.start]:null,runway:onward?[onward.start,onward.end,extend(onward.start,onward.end,500)]:null};
  }
  return {project,unproject,gateFor,stand,runwayFor,departure,arrival};
}
