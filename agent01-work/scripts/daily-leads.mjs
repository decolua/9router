import {mkdirSync,writeFileSync} from 'node:fs';
import{normalize,score}from'../lib/lead-score.mjs';
const phrases=['virtual assistant','customer support','data entry','sales representative'];
let combined=[],failures=[];
for(const q of phrases){try{const u=new URL('https://himalayas.app/jobs/api/search');u.searchParams.set('q',q);u.searchParams.set('country','ZA');u.searchParams.set('sort','recent');u.searchParams.set('page','1');const resp=await fetch(u,{headers:{'Accept':'application/json','User-Agent':'Agent01-WorkResearch/1.0'},signal:AbortSignal.timeout(22000)});if(!resp.ok)throw Error('HTTP '+resp.status);const json=await resp.json();const jobs=(Array.isArray(json.jobs)?json.jobs:[]).map(x=>normalize(x,q)).filter(Boolean);combined.push(...jobs);console.log('SEARCH',q,'MATCHES',jobs.length);}catch(e){failures.push(q+': '+String(e.message).slice(0,90));console.log('SOURCE_ERROR',q,String(e.message).slice(0,100))}}
const map=new Map();for(const j of combined){if(!map.has(j.id)||map.get(j.id).score<j.score)map.set(j.id,j)}
const leads=[...map.values()].sort((a,b)=>b.score-a.score).slice(0,35);
mkdirSync('agent01-work/output',{recursive:true});
const stamp=new Date().toISOString();
writeFileSync('agent01-work/output/leads.json',JSON.stringify({date:stamp,source:'Himalayas',queries:phrases,country:'South Africa',count:leads.length,errors:failures,disclaimer:'Public job listings, not confirmed applications or commercial sales contracts.',leads},null,2));
const md=['# Agent 01 — Daily work opportunity scan','', 'Date: '+stamp,'Source: https://himalayas.app (Himalayas)','Region: South Africa or compatible worldwide jobs','Total unique items: '+leads.length,'',...leads.slice(0,20).flatMap(x=>['- **'+x.title+'** — '+x.company+' | score '+x.score+'/100 | [Apply]('+x.applicationUrl+') | [Himalayas source]('+x.sourceUrl+')']), '', 'No job application, outreach, payment, or real income created.',...failures.map(x=>'Source warning: '+x),''];
writeFileSync('agent01-work/output/lead-report.md',md.join('\n'));
if(process.env.GITHUB_STEP_SUMMARY)writeFileSync(process.env.GITHUB_STEP_SUMMARY,md.join('\n'));
if(combined.length===0&&failures.length===phrases.length)throw Error('Every lead source request failed, no current data.');
console.log('LEAD_SCAN_OK',leads.length,'jobs,',failures.length,'failed searches');
