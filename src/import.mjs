// RFC 4180-style parser; preserves identifiers as strings and handles quoted commas/newlines.
export function parseCSV(text){
  if(typeof text!=='string'||text.length>2_000_000)throw new Error('Upload a CSV subset under 2 MB.');
  const rows=[];let row=[],field='',quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field);field='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw new Error('CSV has an unclosed quoted field.');
  if(field||row.length){row.push(field);if(row.some(x=>x.trim()))rows.push(row);}
  if(rows.length<2)throw new Error('CSV needs headers and at least one data row.');
  const headers=rows.shift().map(x=>x.trim().toUpperCase());
  if(new Set(headers).size!==headers.length||headers.some(x=>!x))throw new Error('CSV headers must be unique and nonempty.');
  return rows.map((r,i)=>{if(r.length!==headers.length)throw new Error(`CSV row ${i+2} has ${r.length} columns; expected ${headers.length}.`);return Object.fromEntries(headers.map((h,j)=>[h,r[j].trim()]));});
}
export function qualifyingFlights(text){
  const rows=parseCSV(text);
  for(const key of ['WEATHER_DELAY','LATE_AIRCRAFT_DELAY'])if(!(key in rows[0]))throw new Error(`Missing ${key}. Airport and airline lookup tables are not flight records.`);
  const value=(s)=>s===''?null:Number.isFinite(Number(s))&&Number(s)>=0?Number(s):null;
  const qualifying=rows.filter(r=>(value(r.WEATHER_DELAY)??-1)>15||(value(r.LATE_AIRCRAFT_DELAY)??-1)>20);
  return {total:rows.length,qualifying:qualifying.length,rows:qualifying.slice(0,100).map(r=>({airline:r.AIRLINE||r.OP_UNIQUE_CARRIER||'',flightNumber:r.FLIGHT_NUMBER||r.OP_CARRIER_FL_NUM||'',origin:r.ORIGIN_AIRPORT||r.ORIGIN||'',destination:r.DESTINATION_AIRPORT||r.DEST||'',weatherDelay:value(r.WEATHER_DELAY),lateAircraftDelay:value(r.LATE_AIRCRAFT_DELAY),year:r.YEAR||'',month:r.MONTH||'',day:r.DAY||''})),rule:'WEATHER_DELAY > 15 OR LATE_AIRCRAFT_DELAY > 20',truncated:qualifying.length>100};
}
