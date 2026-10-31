import {createScenario,deterministicFallback,searchReference,validatePlan} from './domain.mjs';
import {negotiate} from './agents.mjs';
const rows=[];
for(const id of ['weather','tug','fuel','infeasible'])for(const seed of [7,42,101]){
  const s=createScenario(id,seed),result=await negotiate({getScenario:()=>s}),baseline=deterministicFallback(s),reference=searchReference(s);
  rows.push({scenario:id,seed,status:result.status,rounds:result.rounds,mode:result.mode,committedViolations:result.plan?validatePlan(s,result.plan).issues.length:null,score:result.metrics?.score??null,baselineScore:baseline.metrics?.score??null,referenceScore:reference.metrics?.score??null,referenceOrders:reference.evaluated,optimalityProven:false});
}
console.log(JSON.stringify({generatedAt:new Date().toISOString(),method:'Local policy-agent benchmark. Identical modeled inputs and constraints. Bounded reference search, not a global optimum proof.',rows},null,2));
