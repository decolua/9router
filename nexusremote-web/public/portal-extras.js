(()=>{
'use strict';
if(document.body.dataset.page!=='portal')return;
const $=id=>document.getElementById(id);
const filter=$('candidateSearch'),status=$('candidateStatus'),counter=$('candidateFilterCount'),table=$('applicantsBody'),exportButton=$('candidateExport'),timeline=$('activityItems');
if(!filter||!table||!timeline)return;
let isOwner=false,busy=false;
function text(v){return String(v==null?'':v)}
function date(v){const d=new Date(v);return Number.isNaN(d.getTime())?'Date unavailable':d.toLocaleString('en-ZA',{dateStyle:'medium',timeStyle:'short'})}
function amount(minor,currency){
 const code=String(currency||'').toUpperCase(),value=Number(minor);
 if(!/^[A-Z]{3}$/.test(code)||!Number.isFinite(value))return 'Unverified amount';
 const divisor=['JPY','KRW','VND','XOF','XAF','CLP','GNF','ISK','PYG','RWF','UGX'].includes(code)?1:['BHD','JOD','KWD','OMR','TND'].includes(code)?1000:100;
 try{return new Intl.NumberFormat('en-ZA',{style:'currency',currency:code,currencyDisplay:'code'}).format(value/divisor)}catch{return code+' '+(value/divisor).toFixed(2)}
}
async function ownerData(){
 const response=await fetch('/api/portal',{credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw Error('Authorized owner session required');
 const body=await response.json();
 if(body.role!=='owner')throw Error('Owner-only data');
 return body;
}
function filterTable(){
 const query=filter.value.trim().toLocaleLowerCase();
 const mode=status.value;
 const rows=[...table.querySelectorAll('tr')];
 let visible=0,total=0;
 for(const row of rows){
  if(row.children.length<5)continue;
  total++;
  const content=row.textContent.toLowerCase();
  const approved=Boolean(row.querySelector('.pill.good'));
  const matches=(!query||content.includes(query))&&(mode==='all'||(mode==='approved'?approved:!approved));
  row.hidden=!matches;
  if(matches)visible++;
 }
 counter.textContent=total?(visible+' of '+total+' shown · private review queue'):'No applications recorded yet';
}
filter.addEventListener('input',filterTable);
status.addEventListener('change',filterTable);
new MutationObserver(filterTable).observe(table,{childList:true});
const csvCell=value=>{
 let s=text(value);
 if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;
 return '"'+s.replace(/"/g,'""')+'"';
};
exportButton.addEventListener('click',async()=>{
 if(busy)return;busy=true;exportButton.disabled=true;exportButton.textContent='Preparing authorized CSV…';
 try{
  const data=await ownerData();
  const columns=['Application ID','Name','Email','Submitted','Experience','Workspace','Headset','Mbps','Review State','Worker ID'];
  const rows=[columns,...(data.applications||[]).map(a=>[a.id,a.name,a.email,a.createdAt,a.experience,a.workspace,a.headset,a.internetMbps,a.state,a.agentId||''])];
  const blob=new Blob([rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='NexusRemote-Private-Applications.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  counter.textContent='Exported '+Math.max(0,rows.length-1)+' authorized records. Do not redistribute personal information.';
 }catch(e){counter.textContent='Export unavailable: '+e.message}
 finally{busy=false;exportButton.disabled=false;exportButton.textContent='Export reviewed applications ↓'}
});
function eventCard(type,name,time,detail){
 const div=document.createElement('div');div.className='status-item';
 const strong=document.createElement('strong');strong.textContent=type+' · '+name;
 const small=document.createElement('small');small.textContent=date(time)+' · '+detail;
 div.append(strong,small);return div;
}
async function loadActivity(){
 try{
  const s=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json());
  if(!s.authenticated||s.role!=='owner')return;
  isOwner=true;
  const data=await ownerData();
  const events=[
   ...(data.applications||[]).map(x=>({type:'Application received',name:x.name||'Applicant',time:x.createdAt,detail:x.state==='approved'?'Portal approved · no job assumed':'Awaiting human review'})),
   ...(data.recentVerifiedPayments||[]).map(x=>({type:'Stripe-verified payment',name:x.agentId||'Agent',time:x.recordedAt,detail:amount(x.grossMinor,x.currency)+' gross · bank payout not confirmed'}))
  ].filter(x=>x.time&&!Number.isNaN(new Date(x.time).getTime())).sort((a,b)=>new Date(b.time)-new Date(a.time)).slice(0,12);
  timeline.replaceChildren();
  if(!events.length){const div=document.createElement('div');div.className='empty';div.textContent='No applications or verified financial events have been recorded yet.';timeline.append(div)}
  else events.forEach(x=>timeline.append(eventCard(x.type,x.name,x.time,x.detail)));
  filterTable();
 }catch(e){
  if(isOwner){timeline.replaceChildren();const div=document.createElement('div');div.className='empty';div.textContent='Unable to retrieve the activity feed. Use Refresh to retry.';timeline.append(div)}
 }
}
document.getElementById('refreshTop')?.addEventListener('click',()=>setTimeout(loadActivity,250));
document.getElementById('refreshButton')?.addEventListener('click',()=>setTimeout(loadActivity,250));
window.addEventListener('focus',()=>{if(isOwner)loadActivity()});
loadActivity();
})();