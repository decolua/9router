const SOURCE='https://himalayas.app/jobs/api/search';
const COUNTRIES=new Set(['ZA','US','GB','AU','CA']);
const clean=(value,max=500)=>String(value||'').replace(/<[^>]+>/g,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim().slice(0,max);
function safeLink(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='himalayas.app'||u.username||u.password||u.toString().length>1800)return null;return u.toString()}catch{return null}}
export function normalize(job,query){
 const url=safeLink(job?.applicationLink);
 if(!url)return null;
 const title=clean(job.title,130),company=clean(job.companyName,100);
 if(!title||!company)return null;
 const pub=Number(job.pubDate);
 const posted=Number.isFinite(pub)&&pub>0&&pub<1e10?new Date(pub*1000).toISOString():null;
 const regions=Array.isArray(job.locationRestrictions)?job.locationRestrictions.map(x=>clean(x,60)).slice(0,9):[];
 const type=clean(job.employmentType,65),description=clean(job.description,440);
 const terms=query.toLowerCase().split(/\s+/).filter(x=>x.length>2);
 let score=30;
 if(terms.some(x=>title.toLowerCase().includes(x)))score+=25;
 if(terms.some(x=>description.toLowerCase().includes(x)))score+=10;
 if(regions.some(x=>/worldwide|south africa|anywhere/i.test(x)))score+=12;
 if(/contract|part.time|freelance/i.test(type))score+=9;
 if(posted&&Date.now()-new Date(posted).getTime()<14*86400000)score+=12;
 return {id:clean(job.guid||url,200),title,company,description,type,regions,posted,applicationUrl:url,score:Math.min(score,100),source:'Himalayas'};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','public, max-age=0, s-maxage=240, stale-while-revalidate=900');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'GET_ONLY'});
 const query=String(req.query?.q||'customer support').trim().replace(/\s+/g,' ').slice(0,64);
 const country=String(req.query?.country||'ZA').toUpperCase();
 if(query.length<2||!/^[\w .,+\-]+$/.test(query)||!COUNTRIES.has(country))return res.status(400).json({error:'INVALID_SEARCH'});
 try{
  const endpoint=new URL(SOURCE);endpoint.searchParams.set('q',query);endpoint.searchParams.set('country',country);endpoint.searchParams.set('sort','recent');endpoint.searchParams.set('page','1');
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),14500);
  let result;
  try{result=await fetch(endpoint,{headers:{'Accept':'application/json','User-Agent':'NexusRemote-Opportunities/2.0'},signal:ctrl.signal})}
  finally{clearTimeout(timer)}
  if(!result.ok)throw Error('HTTP_'+result.status);
  const data=await result.json();
  const jobs=(Array.isArray(data.jobs)?data.jobs:[]).slice(0,60).map(x=>normalize(x,query)).filter(Boolean);
  const unique=[...new Map(jobs.map(x=>[x.applicationUrl,x])).values()].sort((a,b)=>b.score-a.score).slice(0,18);
  return res.status(200).json({source:'Himalayas',sourceUrl:'https://himalayas.app',query,country,fetchedAt:new Date().toISOString(),jobs:unique,count:unique.length,note:'Public third-party job listings. No agency affiliation, current vacancy or candidate eligibility is independently confirmed. Always verify on the original listing.'});
 }catch(e){console.error('opportunity feed',String(e?.message||e).slice(0,90));return res.status(503).json({error:'PUBLIC_OPPORTUNITY_FEED_UNAVAILABLE',message:'Public job listings could not be retrieved. Try again shortly.'})}
}
