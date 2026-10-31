import {readFileSync} from 'node:fs';

export const airportCatalog=JSON.parse(readFileSync(new URL('../data/airport-catalog.json',import.meta.url)));
export const gateCatalog=JSON.parse(readFileSync(new URL('../data/airport-gates.json',import.meta.url)));
const byCode=new Map(airportCatalog.airports.map(airport=>[airport.code,airport]));

export function getAirport(code='JFK'){
  const airport=byCode.get(code);
  if(!airport)throw new Error('Select an airport listed in the organizer CSV.');
  return airport;
}

export function airportSummaries(){
  return airportCatalog.airports.map(({records,runways,...airport})=>({
    ...airport,indexedFlights:records.length,runwayCount:runways.length,
  })).sort((a,b)=>a.code.localeCompare(b.code));
}

export function airportMapData(code){
  const {records,...airport}=getAirport(code);
  const gates=gateCatalog.airports[code]??[];
  const standIds=Array.from({length:6+airport.capacity.spare_gates_at_any_time},(_,index)=>`G${index+1}`);
  const gateBindings=Object.fromEntries(standIds.map((id,index)=>[id,gates[index]??null]));
  const unmappedStandIds=standIds.filter(id=>!gateBindings[id]);
  return {...airport,gates,gateBindings,
    gateCoverage:{mappedStandCount:standIds.length-unmappedStandIds.length,totalStandCount:standIds.length,unmappedStandIds},
    gateSource:{...gateCatalog.source,retrievedAt:gateCatalog.retrievedAt,osmTimestamp:gateCatalog.osmTimestamp,association:gateCatalog.association},
    sources:[...airportCatalog.sources,gateCatalog.source],retrievedAt:airportCatalog.retrievedAt,
    sourceNote:'Source-mapped passenger gate locations; scenario aliases, occupancy and assignments are simulated. Unmapped gate positions are omitted. Replay taxi paths are illustrative.'};
}
