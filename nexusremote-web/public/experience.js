(()=>{
'use strict';
const $=id=>document.getElementById(id);
const stage=$('spiralStage'),world=$('spiralWorld'),section=$('spiral');
if(!stage||!world||!section)return;
const nodes=[...stage.querySelectorAll('[data-spiral-index]')];
const details=[
{label:'Division A · The Hunter',title:'Discover genuine opportunities',copy:'Search public remote roles and guide potential applicants toward transparent, legitimate openings. External listings are never presented as guaranteed NexusRemote campaigns.',status:'Third-party public job search available',cta:'Explore opportunities',url:'#opportunities'},
{label:'Division B · The Gatekeeper',title:'Review every candidate fairly',copy:'Consent-based applications enter private storage for human review. Hardware readiness is assessed without automatic hiring or rejection.',status:'Private application intake and manual review active',cta:'Begin an application',url:'/apply'},
{label:'Division C · The Placer',title:'Secure onboarding, minus shortcuts',copy:'After human approval, applicants receive a private portal invitation. Real campaign matching and dialer access require separately verified employers and providers.',status:'Portal invitations supported; live campaigns pending',cta:'Worker sign in',url:'/login?role=worker'},
{label:'Division D · The Monitor',title:'Track evidence, not estimates',copy:'Designed for independently authorized calling-platform metrics. Until that connection is active, the portal clearly shows the dialer as unavailable.',status:'Live dialer and call KPIs not yet connected',cta:'View operations portal',url:'/login?role=owner'},
{label:'Division E · The Treasurer',title:'Only verified revenue reaches the ledger',copy:'Signature-checked, paid Stripe events are the basis for recorded gross receipts. That figure is not automatically a salary, commission payment or bank deposit.',status:'Signed Stripe webhook prepared; live payments not enabled',cta:'Open financial overview',url:'/login?role=owner'}
];
const infoName=$('spiralInfoName'),infoKicker=$('spiralInfoKicker'),infoCopy=$('spiralInfoCopy'),infoStatus=$('spiralInfoStatus'),infoLink=$('spiralInfoLink'),counter=$('spiralCounter'),progress=$('spiralProgress');
const prefersReduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
let depth=0,scrollAngle=0,userOffset=0,targetAngle=0,currentAngle=0,selected=-1,frame=0,drag=null,lastDrag=0,inside=false;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function dimension(){
 const width=stage.clientWidth;
 depth=window.innerWidth<=485?139:window.innerWidth<=740?165:window.innerWidth<=1050?214:270;
 nodes.forEach((n,i)=>{
  n.style.transform='rotateY('+(i*72)+'deg) translateZ('+depth+'px)';
 });
}
function indexFromAngle(a){return ((Math.round(a/72)%5)+5)%5}
function select(i){
 if(i===selected)return;
 selected=i;const d=details[i];
 if(infoName)infoName.textContent=d.title;
 if(infoKicker)infoKicker.textContent=d.label;
 if(infoCopy)infoCopy.textContent=d.copy;
 if(infoStatus)infoStatus.textContent=d.status;
 if(infoLink){infoLink.href=d.url;infoLink.textContent=d.cta+' ↗'}
 if(counter)counter.textContent=String(i+1).padStart(2,'0')+' / 05';
 if(progress)progress.style.width=((i+1)/5*100)+'%';
 nodes.forEach((node,index)=>{node.setAttribute('aria-current',String(index===i));node.tabIndex=index===i?0:-1});
}
function updateScroll(){
 const rect=section.getBoundingClientRect(),h=window.innerHeight||720;
 const range=Math.max(1,rect.height-h*.6);
 const p=clamp((h*.45-rect.top)/range,0,1);
 scrollAngle=p*288;
 targetAngle=scrollAngle+userOffset;
 select(indexFromAngle(targetAngle));
}
function paint(){
 frame=0;
 const delta=targetAngle-currentAngle;
 currentAngle=prefersReduced?targetAngle:currentAngle+delta*.19;
 world.style.transform='rotateX(-10deg) rotateY('+-currentAngle+'deg)';
 if(Math.abs(delta)>.07&&!prefersReduced)frame=requestAnimationFrame(paint);
}
function render(){if(!frame)frame=requestAnimationFrame(paint)}
function rotateTo(index){
 const absolute=Math.round(targetAngle/360)*360+index*72;
 const options=[absolute-360,absolute,absolute+360];
 const value=options.reduce((best,x)=>Math.abs(x-targetAngle)<Math.abs(best-targetAngle)?x:best);
 userOffset+=value-targetAngle;
 targetAngle=value;
 select(indexFromAngle(targetAngle));render();
}
function step(value){
 userOffset+=value*72;
 targetAngle=scrollAngle+userOffset;
 select(indexFromAngle(targetAngle));render();
}
nodes.forEach((node,i)=>node.addEventListener('click',()=>{
 if(Date.now()-lastDrag<250)return;
 rotateTo(i);
}));
$('spiralPrev')?.addEventListener('click',()=>step(-1));
$('spiralNext')?.addEventListener('click',()=>step(1));
stage.addEventListener('keydown',ev=>{
 if(ev.key==='ArrowRight'||ev.key==='ArrowDown'){ev.preventDefault();step(1)}
 else if(ev.key==='ArrowLeft'||ev.key==='ArrowUp'){ev.preventDefault();step(-1)}
 else if(ev.key==='Home'){ev.preventDefault();rotateTo(0)}
 else if(ev.key==='End'){ev.preventDefault();rotateTo(4)}
});
stage.addEventListener('wheel',ev=>{
 if(ev.ctrlKey||Math.abs(ev.deltaY)<1)return;
 ev.preventDefault();
 const sign=Math.sign(ev.deltaY);
 userOffset+=sign*clamp(Math.abs(ev.deltaY)*.3,6,38);
 targetAngle=scrollAngle+userOffset;
 select(indexFromAngle(targetAngle));render();
},{passive:false});
stage.addEventListener('pointerdown',ev=>{
 if(ev.button!==0&&ev.pointerType==='mouse')return;
 drag={id:ev.pointerId,x:ev.clientX,y:ev.clientY,offset:userOffset,active:false};
});
stage.addEventListener('pointermove',ev=>{
 if(!drag||drag.id!==ev.pointerId)return;
 const dx=ev.clientX-drag.x,dy=ev.clientY-drag.y;
 if(!drag.active){
  if(Math.abs(dx)<12||Math.abs(dx)<Math.abs(dy)*1.1)return;
  drag.active=true;
  try{stage.setPointerCapture(ev.pointerId)}catch{}
  stage.classList.add('touch-active');
 }
 userOffset=drag.offset-dx*.48;
 targetAngle=scrollAngle+userOffset;
 select(indexFromAngle(targetAngle));render();
});
function donePointer(ev){
 if(!drag||ev.pointerId!==drag.id)return;
 if(drag.active){
  lastDrag=Date.now();
  userOffset=Math.round((scrollAngle+userOffset)/72)*72-scrollAngle;
  targetAngle=scrollAngle+userOffset;
  select(indexFromAngle(targetAngle));render();
 }
 stage.classList.remove('touch-active');
 drag=null;
}
stage.addEventListener('pointerup',donePointer);
stage.addEventListener('pointercancel',donePointer);
window.addEventListener('resize',()=>{dimension();updateScroll();render()},{passive:true});
let scheduled=false;
window.addEventListener('scroll',()=>{
 if(scheduled)return;scheduled=true;
 requestAnimationFrame(()=>{scheduled=false;updateScroll();render()});
},{passive:true});
dimension();updateScroll();render();
if(prefersReduced){const helper=$('spiralHelper');if(helper)helper.textContent='Motion reduced. Select a division or use the arrow buttons.'}

/* Honest public-work opportunity explorer. No automatic messages, applications, or invented salaries. */
const results=$('opportunityResults'),feedback=$('opportunityFeedback'),count=$('opportunityCount'),form=$('opportunitySearch');
let activeJobs=[],saved=[];
try{const parsed=JSON.parse(localStorage.getItem('nexus-opportunities-v1')||'[]');if(Array.isArray(parsed))saved=parsed.filter(x=>x&&typeof x.applicationUrl==='string'&&x.applicationUrl.startsWith('https://himalayas.app/')).slice(0,40)}catch{}
function isSaved(url){return saved.some(x=>x.applicationUrl===url)}
function store(){try{localStorage.setItem('nexus-opportunities-v1',JSON.stringify(saved.slice(0,40)))}catch{}}
function element(type,cls,text){const node=document.createElement(type);if(cls)node.className=cls;if(text!=null)node.textContent=String(text);return node}
function createJobCard(job){
 const card=element('article','opportunity-card');
 const header=element('header');
 header.append(element('span','job-company',job.company));
 header.append(element('span','job-score',job.score==='—'?'Saved':'Match '+job.score+'/100'));
 card.append(header);
 card.append(element('h3','',job.title));
 card.append(element('p','',job.description||'View the original listing for full details and eligibility.'));
 const meta=element('div','job-meta');
 meta.append(element('span','',job.type||'Type not specified'));
 meta.append(element('span','',job.regions?.length?job.regions.slice(0,2).join(' / '):'Check location'));
 if(job.posted&&!Number.isNaN(Date.parse(job.posted)))meta.append(element('span','',new Date(job.posted).toLocaleDateString('en-ZA',{dateStyle:'medium'})));
 card.append(meta);
 const actions=element('div','job-actions');
 const open=element('a','btn btn-primary','View listing ↗');open.href=job.applicationUrl;open.target='_blank';open.rel='noopener noreferrer';open.setAttribute('aria-label','Open original '+job.title+' listing');actions.append(open);
 const bookmark=element('button','btn bookmark',isSaved(job.applicationUrl)?'♥':'♡');
 bookmark.type='button';bookmark.dataset.saved=String(isSaved(job.applicationUrl));bookmark.title='Save or remove public listing on this device';bookmark.setAttribute('aria-label','Save job listing '+job.title);
 bookmark.onclick=()=>{
  if(isSaved(job.applicationUrl))saved=saved.filter(x=>x.applicationUrl!==job.applicationUrl);
  else saved.unshift({applicationUrl:job.applicationUrl,title:job.title,company:job.company,posted:job.posted||null});
  store();bookmark.dataset.saved=String(isSaved(job.applicationUrl));bookmark.textContent=isSaved(job.applicationUrl)?'♥':'♡';updateSaved();
 };
 actions.append(bookmark);card.append(actions);return card;
}
function renderJobs(data){results.replaceChildren();if(!data.length){const box=element('div','tool-status','No matching listings were returned. Try another role or country.');results.append(box);return}data.forEach(job=>results.append(createJobCard(job)))}
async function searchJobs(){
 if(!results||!form)return;
 const query=$('opportunityQuery')?.value.trim().slice(0,64)||'customer support',country=$('opportunityCountry')?.value||'ZA',submit=$('opportunitySubmit');
 if(query.length<2){feedback.textContent='Enter at least two characters to search.';return}
 submit.disabled=true;feedback.classList.remove('error');feedback.textContent='Searching public remote job listings…';
 results.replaceChildren();results.append(element('div','tool-status','Searching Himalayas public listings. Results and applicant eligibility must be independently verified.'));
 try{
  const response=await fetch('/api/opportunities?q='+encodeURIComponent(query)+'&country='+encodeURIComponent(country),{cache:'no-store'});
  const body=await response.json();
  if(!response.ok)throw Error(body.message||body.error||'Search temporarily unavailable');
  activeJobs=Array.isArray(body.jobs)?body.jobs:[];
  count.textContent=activeJobs.length+' public listings';
  renderJobs(activeJobs);
  feedback.textContent='Source: Himalayas · '+new Date(body.fetchedAt).toLocaleString('en-ZA',{dateStyle:'medium',timeStyle:'short'})+'. These are third-party vacancies, not NexusRemote placements.';
 }catch(e){results.replaceChildren();results.append(element('div','tool-status error','Could not retrieve the public feed right now. Search again, or visit Himalayas directly.'));feedback.textContent=String(e.message||'Source unavailable');feedback.classList.add('error')}
 finally{submit.disabled=false}
}
if(form)form.addEventListener('submit',ev=>{ev.preventDefault();searchJobs()});
document.querySelectorAll('[data-quick-search]').forEach(button=>button.addEventListener('click',()=>{
 document.querySelectorAll('[data-quick-search]').forEach(x=>x.classList.remove('active'));
 button.classList.add('active');
 if($('opportunityQuery'))$('opportunityQuery').value=button.dataset.quickSearch;
 searchJobs();
}));
function updateSaved(){
 const el=$('savedCount');if(el)el.textContent=saved.length+' saved';
 const button=$('savedView');if(button)button.textContent='Saved ('+saved.length+')';
}
$('savedView')?.addEventListener('click',()=>{
 activeJobs=[];
 const items=saved.map(x=>({...x,id:x.applicationUrl,description:'Saved public job listing. Open the original source to verify that it remains available.',regions:[],score:'—',type:'Saved'}));
 renderJobs(items);
 count.textContent='Saved on this browser';
 feedback.textContent='Saved public listings are kept only on this device. They may no longer be open.';
});
function safeCsv(x){let s=String(x??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
$('downloadJobs')?.addEventListener('click',()=>{
 if(!saved.length){feedback.textContent='Save a listing before exporting.';return}
 const rows=[['Company','Role','Source URL','Posted'],...saved.map(x=>[x.company,x.title,x.applicationUrl,x.posted||''])];
 const csv=rows.map(x=>x.map(safeCsv).join(',')).join('\r\n');
 const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=url;a.download='NexusRemote-Saved-Public-Opportunities.csv';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
});
updateSaved();
if(form){
 const explorer=$('opportunities');
 if('IntersectionObserver'in window&&explorer){
  const watcher=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){watcher.disconnect();searchJobs()}},{rootMargin:'180px 0px'});
  watcher.observe(explorer);
 }else searchJobs();
}

/* Local-only equipment guidance; not automatic candidate eligibility decisions. */
const checker=$('readinessChecker');
function checkReadiness(){
 const speed=Number($('readinessSpeed')?.value||0),headset=$('readinessHeadset')?.value,space=$('readinessSpace')?.value,box=$('readinessResult');
 if(!box)return;
 const tips=[];
 if(!Number.isFinite(speed)||speed<10)tips.push('Check the internet reliability required by each employer.');
 if(headset==='none')tips.push('Some voice roles require a headset, but equipment requirements vary.');
 if(space!=='quiet')tips.push('Confirm privacy/noise expectations for the specific campaign.');
 if(!tips.length)tips.push('Your self-reported setup may be suitable for review, subject to each employer’s criteria and an actual connection test.');
 box.replaceChildren();box.append(element('strong','',tips.length===1&&speed>=10&&headset!=='none'&&space==='quiet'?'Ready to submit for review':'Your preparation checklist'));
 tips.forEach(x=>box.append(element('p','',x)));
 const small=element('p','','This is private, browser-only guidance. It does not submit, accept or reject an application.');small.style.opacity='.75';box.append(small);
}
checker?.addEventListener('change',checkReadiness);checker?.addEventListener('input',checkReadiness);checkReadiness();

/* Small page-progress indicator and accessible reveal animations. */
const meter=document.createElement('div');
meter.setAttribute('aria-hidden','true');
meter.style.cssText='position:fixed;left:0;top:0;height:3px;width:0;z-index:120;pointer-events:none;background:linear-gradient(90deg,#9985ff,#69ecd4);box-shadow:0 1px 12px rgba(88,215,202,.4);transition:width .05s linear';
document.body.append(meter);
let pageTick=false;
function pageProgress(){
 const distance=Math.max(1,document.documentElement.scrollHeight-innerHeight);
 meter.style.width=(Math.min(100,Math.max(0,scrollY/distance*100)))+'%';
}
window.addEventListener('scroll',()=>{if(pageTick)return;pageTick=true;requestAnimationFrame(()=>{pageTick=false;pageProgress()})},{passive:true});
pageProgress();
if(!prefersReduced&&'IntersectionObserver'in window){
 document.documentElement.classList.add('js-enhanced');
 const observer=new IntersectionObserver(entries=>{
  for(const e of entries)if(e.isIntersecting){e.target.classList.add('is-visible');observer.unobserve(e.target)}
 },{threshold:.05,rootMargin:'0px 0px -36px 0px'});
 document.querySelectorAll('.section-header,.division-card,.workflow-card,.readiness-card').forEach(x=>{x.classList.add('reveal-motion');observer.observe(x)});
}

/* Progressive-web-app capability: static assets only, never cache applicant or financial records. */
if('serviceWorker'in navigator){
 window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(()=>{}),{once:true});
}
let installEvent=null;
const installButton=$('installNexusButton');
window.addEventListener('beforeinstallprompt',ev=>{
 ev.preventDefault();installEvent=ev;
 if(installButton)installButton.classList.remove('hidden');
});
installButton?.addEventListener('click',async()=>{
 if(!installEvent)return;
 installEvent.prompt();
 try{await installEvent.userChoice}catch{}
 installEvent=null;installButton.classList.add('hidden');
});
window.addEventListener('appinstalled',()=>{installEvent=null;installButton?.classList.add('hidden')});
})();