const decisionSchema={type:'object',properties:{decision:{type:'string',enum:['PROPOSE','ACCEPT','COUNTER']},explanation:{type:'string'},order:{type:'array',items:{type:'string'}},groundPreference:{type:'string',enum:['tow','remote_arrival']}},required:['decision','explanation','order','groundPreference'],additionalProperties:false};

export function providerConfig(env=process.env){
  return {claude:{available:Boolean(env.ANTHROPIC_API_KEY&&env.ANTHROPIC_MODEL),model:env.ANTHROPIC_MODEL||null},gemini:{available:Boolean(env.GEMINI_API_KEY&&env.GEMINI_MODEL),model:env.GEMINI_MODEL||null}};
}

export function validateDecision(d, flightIds, stage){
  if(!d||typeof d!=='object'||Array.isArray(d)||!['PROPOSE','ACCEPT','COUNTER'].includes(d.decision)||typeof d.explanation!=='string'||d.explanation.length<1||d.explanation.length>2400||!Array.isArray(d.order)||!['tow','remote_arrival'].includes(d.groundPreference))throw new Error('Provider returned a malformed agent decision.');
  if(Object.keys(d).some(k=>!['decision','explanation','order','groundPreference'].includes(k)))throw new Error('Provider returned unsupported fields.');
  if(d.order.length&&(d.order.length!==flightIds.length||new Set(d.order).size!==flightIds.length||d.order.some(id=>!flightIds.includes(id))))throw new Error('Provider order must contain every departure exactly once.');
  if(stage==='review'&&d.decision==='PROPOSE')throw new Error('Review must ACCEPT or COUNTER.');
  if(stage==='propose'&&d.decision!=='PROPOSE')throw new Error('A proposer must submit PROPOSE.');
  return d;
}

export async function callProvider(provider, system, payload, signal, env=process.env){
  const cfg=providerConfig(env)[provider];
  if(!cfg?.available)throw new Error(`${provider} requires a server-side API key and model ID. Local policy mode remains available.`);
  let response,decision,usage;
  if(provider==='claude'){
    response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal,headers:{'content-type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:cfg.model,max_tokens:1600,system,messages:[{role:'user',content:JSON.stringify(payload)}],tools:[{name:'submit_agent_decision',description:'Submit only your domain proposal or review. The coordinator validates all effects.',input_schema:decisionSchema}],tool_choice:{type:'tool',name:'submit_agent_decision'}})});
    if(!response.ok)throw new Error(`Claude API returned HTTP ${response.status}. Check the server-side model, quota and credentials.`);
    const result=await response.json();decision=result.content?.find(c=>c.type==='tool_use'&&c.name==='submit_agent_decision')?.input;usage=result.usage;
  }else if(provider==='gemini'){
    const model=encodeURIComponent(cfg.model.replace(/^models\//,''));
    response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',signal,headers:{'content-type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:JSON.stringify(payload)}]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:decisionSchema,maxOutputTokens:1800}})});
    if(!response.ok)throw new Error(`Gemini API returned HTTP ${response.status}. Check the server-side model, quota and credentials.`);
    const result=await response.json();const raw=result.candidates?.[0]?.content?.parts?.filter(p=>p.text).map(p=>p.text).join('');
    try{decision=JSON.parse(raw);}catch{throw new Error('Gemini did not return a JSON decision.');}usage=result.usageMetadata;
  }else throw new Error('Unknown provider.');
  return {decision:validateDecision(decision,payload.flightIds,payload.stage),usage,provider,model:cfg.model};
}
