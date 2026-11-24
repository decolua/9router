const SOURCE='https://himalayas.app/jobs/api/search';
function clean(s,n=350){return String(s||'').replace(/<[^>]*>/g,' ').replace(/&(?:amp|lt|gt|quot|#39);/g,' ').replace(/\s+/g,' ').trim().slice(0,n)}
export function score(job,keywords){const name=(job.title+' '+job.summary).toLowerCase();let score=25;const words=keywords.toLowerCase().split(/\s+/).filter(x=>x.length>2);if(words.some(w=>job.title.toLowerCase().includes(w)))score+=25;else if(words.some(w=>name.includes(w)))score+=12;if(/contract|part.time|temporary/i.test(job.type))score+=15;if(job.regions.some(x=>/South Africa|Worldwide|Anywhere/i.test(x)))score+=15;if(job.posted&&Date.now()-Date.parse(job.posted)<14*864e5)score+=12;if(job.applicationUrl)score+=8;return Math.min(100,score)}
export function normalize(j,q){const u=String(j.applicationLink||'');const detail=String(j.guid||'');if(!u.startsWith('https://himalayas.app/'))return null;const pub=typeof j.pubDate==='number'?new Date(j.pubDate*1000).toISOString():null;const item={id:detail||u,title:clean(j.title,140),company:clean(j.companyName,100),type:clean(j.employmentType,50),summary:clean(j.description,500),regions:Array.isArray(j.locationRestrictions)?j.locationRestrictions.map(x=>clean(x,60)):[],posted:pub,applicationUrl:u,sourceUrl:detail.startsWith('https://himalayas.app/')?detail:'https://himalayas.app',salary:(Number.isFinite(j.minSalary)&&Number.isFinite(j.maxSalary))?[j.minSalary,j.maxSalary]:null,source:'Himalayas'};item.score=score(item,q);return item}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, max-age=0, s-maxage=600');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'GET_ONLY'});
 const q=String(req.query?.q||'virtual assistant').trim().slice(0,80);
 const country=String(req.query?.country||'ZA').toUpperCase();
 if(!/^[A-Z]{2}$/.test(country)||!q||q.length<2)return res.status(400).json({error:'INVALID_QUERY'});
 try{
  const url=new URL(SOURCE);url.searchParams.set('q',q);url.searchParams.set('country',country);url.searchParams.set('sort','recent');url.searchParams.set('page','1');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),14000);
  let r;try{r=await fetch(url,{headers:{'Accept':'application/json','User-Agent':'Agent01-WorkCopilot/1.0'},signal:controller.signal})}finally{clearTimeout(timeout)}
  if(!r.ok)throw Error('PUBLIC_FEED_HTTP_'+r.status);
  const j=await r.json();
  const results=(Array.isArray(j.jobs)?j.jobs:[]).map(x=>normalize(x,q)).filter(Boolean).sort((a,b)=>b.score-a.score).slice(0,20);
  return res.status(200).json({source:'Himalayas',credit:'Jobs sourced from Himalayas — https://himalayas.app',updatedAt:new Date().toISOString(),query:q,country,coverage:'A bounded feed search, not all jobs or confirmed eligibility.',count:results.length,jobs:results});
 }catch(e){console.error('public lead feed failure',String(e.message).slice(0,100));return res.status(503).json({error:'JOB_FEED_TEMPORARILY_UNAVAILABLE',source:'Himalayas'})}
}