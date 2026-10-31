import {createRecoveryScenario,hhmm} from './recovery.mjs';

// Disclosed product choices, not organizer constraints. Tiers are checked in order; a flight takes the first tier it meets.
export const triagePolicy={
  fuelUrgentMin:10,crewUrgentMin:30,
  tiers:[
    {id:0,name:'EMERGENCY',rule:'Discretionary holding fuel is exhausted. Priority handling, outside the optimisation.'},
    {id:1,name:'FUEL',rule:'Discretionary holding fuel is below the urgent threshold.'},
    {id:2,name:'CREW',rule:'Same-crew onward departure would finish within the urgent margin of the duty limit.'},
    {id:3,name:'GATE',rule:'Cannot afford to wait for its own gate, so it needs a scarce spare gate.'},
    {id:4,name:'ROUTINE',rule:'Can absorb a hold or a resequence. Served first-come, first-served.'}
  ],
  within:'Least slack first (the smaller of fuel and crew minutes), then earliest baseline ETA, then source row.'
};

export const dayMinute=r=>Date.UTC(Number(r.YEAR),Number(r.MONTH)-1,Number(r.DAY))/60000;

export function triageTarget(index,facts={}){
  const s=createRecoveryScenario(index,facts),r=s.source.record,t={...s.target,...facts};
  const gate=s.arrivals[0].gate,gateFreeAt=Math.max(0,...s.flights.filter(f=>f.gate===gate).map(f=>f.scheduled-6+2));
  const fuelSlack=(t.arrivalFuel-t.finalReserve-t.contingency)/t.holdingRate;
  const crewSlack=t.crewDutyMax-t.crewDutyElapsed-(s.baselineETA+s.capacity.min_turnaround_min+6);
  const gateWait=Math.max(0,gateFreeAt-s.baselineETA);
  return {index,airportCode:s.airport.code,id:`${r.AIRLINE} ${r.FLIGHT_NUMBER}`,sourceRow:s.source.sourceRow,eta:dayMinute(r)+hhmm(r.SCHEDULED_ARRIVAL)+Math.max(0,Number(r.DEPARTURE_DELAY)||0),fuelSlack,crewSlack,gateWait,needsSpareGate:fuelSlack<gateWait};
}

export function triageTier(t,policy=triagePolicy){
  return t.fuelSlack<=0?0:t.fuelSlack<policy.fuelUrgentMin?1:t.crewSlack<policy.crewUrgentMin?2:t.needsSpareGate?3:4;
}

export function prioritiseCollisions(targets,{spareGates=3,policy=triagePolicy}={}){
  const ranked=targets.map(t=>({...t,tier:triageTier(t,policy),slack:Math.min(t.fuelSlack,t.crewSlack)}))
    .sort((a,b)=>a.tier-b.tier||a.slack-b.slack||a.eta-b.eta||a.sourceRow-b.sourceRow);
  let spare=spareGates;
  return ranked.map((t,i)=>{
    const wantsSpare=t.needsSpareGate||t.tier<=1,granted=wantsSpare&&spare>0;if(granted)spare--;
    return {...t,priority:i+1,tierName:policy.tiers[t.tier].name,spareGate:granted?'granted':wantsSpare?'denied':'not needed',reason:policy.tiers[t.tier].rule};
  });
}
