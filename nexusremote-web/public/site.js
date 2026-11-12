(()=>{
'use strict';
const $=id=>document.getElementById(id);
const page=document.body?.dataset?.page||'';
const menu=$('navToggle');const nav=$('navLinks');
if(menu&&nav){menu.addEventListener('click',()=>{const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(open))});nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false')}))}
const safeText=v=>String(v==null?'':v);
function notice(node,message,kind=''){if(!node)return;node.textContent=message;node.className='notice '+kind;node.classList.remove('hidden')}
function clearNotice(node){if(node){node.textContent='';node.className='notice hidden'}}
async function request(path,options={}){
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
 let body;try{body=await response.json()}catch{throw Error('Unexpected server response ('+response.status+')')}
 if(!response.ok)throw Error(safeText(body.error||body.message||'Request failed')+' ('+response.status+')');
 return body;
}
function jsonPost(path,payload){return request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})}
function dateString(value){if(!value)return 'Not recorded';const date=new Date(value);return Number.isNaN(date.getTime())?'Unknown':new Intl.DateTimeFormat('en-ZA',{dateStyle:'medium',timeStyle:'short'}).format(date)}
function cash(minor,currency){
 const m=Number(minor);
 const code=safeText(currency).toUpperCase();
 if(!Number.isFinite(m)||!(/^[A-Z]{3}$/).test(code))return 'Unverified';
 const zero=['JPY','KRW','VND','XOF','XAF','CLP','GNF','ISK','PYG','RWF','UGX'].includes(code);
 const three=['BHD','JOD','KWD','OMR','TND'].includes(code);
 const n=m/(zero?1:three?1000:100);
 try{return new Intl.NumberFormat('en-ZA',{style:'currency',currency:code,currencyDisplay:'code'}).format(n)}catch{return code+' '+n.toFixed(zero?0:three?3:2)}
}
function make(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=safeText(text);return e}
function add(parent,tag,cls,text){const el=make(tag,cls,text);parent.appendChild(el);return el}
const homeReady=async()=>{const node=$('homeSystemLabel');if(!node)return;try{const j=await request('/api/health');node.textContent=j.privateStorage==='reachable'?'Applicant intake available · Private storage reachable':'Intake currently unavailable';}catch{node.textContent='Service status unavailable · Try again later'}};
if(page==='home')homeReady();
if(page==='login'){
 const worker=$('chooseWorker'),owner=$('chooseOwner'),wf=$('workerFields'),of=$('ownerFields'),form=$('loginForm'),submit=$('loginSubmit'),status=$('loginMessage');
 let role=new URLSearchParams(location.search).get('role')==='owner'?'owner':'worker';
 function roleView(next){role=next;worker.setAttribute('aria-selected',String(role==='worker'));owner.setAttribute('aria-selected',String(role==='owner'));wf.classList.toggle('hidden',role!=='worker');of.classList.toggle('hidden',role!=='owner');clearNotice(status);submit.textContent=role==='owner'?'Open operations dashboard →':'Open worker workspace →'}
 worker.onclick=()=>roleView('worker');owner.onclick=()=>roleView('owner');roleView(role);
 request('/api/session').then(j=>{if(j.authenticated)location.replace('/portal')}).catch(()=>{});
 form?.addEventListener('submit',async event=>{
  event.preventDefault();clearNotice(status);
  const payload=role==='owner'?{role,token:$('ownerSecret').value.trim()}:{role,agentId:$('agentId').value.trim().toUpperCase(),token:$('workerSecret').value.trim()};
  if(role==='owner'&&!payload.token){notice(status,'Enter your owner access token.','error');return}
  if(role==='worker'&&(!payload.agentId||!payload.token)){notice(status,'Enter both your worker ID and private invitation token.','error');return}
  submit.disabled=true;submit.textContent='Verifying credentials…';
  try{
   const j=await jsonPost('/api/session',payload);
   if(j.authenticated){$('workerSecret').value='';$('ownerSecret').value='';location.replace('/portal');return}
   throw Error('Could not establish a session');
  }catch(e){notice(status,e.message==='INVALID_CREDENTIALS (401)'?'The credentials could not be verified. Check the owner key or worker invitation.':e.message,'error')}
  finally{submit.disabled=false;submit.textContent='Secure sign in →'}
 });
}
if(page==='apply'){
 const form=$('applicationForm'),submit=$('applySubmit'),result=$('applicationMessage');
 form?.addEventListener('submit',async ev=>{
  ev.preventDefault();clearNotice(result);
  const f=new FormData(form);
  const body={name:safeText(f.get('name')).trim(),email:safeText(f.get('email')).trim(),internetMbps:Number(f.get('internetMbps')),headset:f.get('headset'),workspace:f.get('workspace'),experience:f.get('experience'),consent:f.get('consent')==='on',website:f.get('website')};
  submit.disabled=true;submit.textContent='Sending application…';
  try{const j=await jsonPost('/api/apply',body);notice(result,'Application received. Reference: '+j.id+'. '+j.message,'success');form.reset()}
  catch(e){notice(result,'Submission not completed. '+e.message,'error')}
  finally{submit.disabled=false;submit.textContent='Submit for human review →'}
 });
}
if(page==='privacy'){
 const form=$('privacyRequest'),submit=$('privacySubmit'),note=$('privacyMessage');
 form?.addEventListener('submit',async ev=>{
  ev.preventDefault();clearNotice(note);const f=new FormData(form);
  const body={email:safeText(f.get('email')).trim(),type:f.get('type'),reference:safeText(f.get('reference')).trim(),website:f.get('website')};
  submit.disabled=true;submit.textContent='Recording request…';
  try{const result=await jsonPost('/api/privacy',body);notice(note,'Request recorded: '+result.reference+'. '+result.message,'success');form.reset()}
  catch(e){notice(note,'Request not recorded. '+e.message,'error')}
  finally{submit.disabled=false;submit.textContent='Send private request →'}
 });
}
if(page==='portal'){
 const loading=$('portalLoading'),shell=$('portalShell'),message=$('portalError'),refreshButtons=[$('refreshButton'),$('refreshTop')];
 let session=null,loadingData=false;
 const logout=async()=>{try{await jsonPost('/api/session',{action:'logout'})}catch{}location.replace('/login')};
 $('logoutButton')?.addEventListener('click',logout);
 refreshButtons.forEach(x=>x?.addEventListener('click',()=>loadPortal(true)));
 function setMetrics(metrics){
  $('metricApplications').textContent=metrics.applications;
  $('metricApproved').textContent=metrics.approved;
  $('metricPayments').textContent=metrics.payments;
  $('metricGross').textContent=metrics.gross;
  $('grossNote').textContent=metrics.grossNote||'Not a bank balance';
 }
 function tableEmpty(node,colspan,text){node.replaceChildren();const tr=make('tr');const td=make('td','',text);td.colSpan=colspan;tr.append(td);node.append(tr)}
 function cell(row,text,css=''){return add(row,'td',css,text)}
 function renderCandidates(apps){
  const tbody=$('applicantsBody');tbody.replaceChildren();
  if(!apps.length){tableEmpty(tbody,5,'No applicant records yet. Submissions must be human-reviewed.');return}
  for(const a of apps){
   const tr=make('tr');
   const who=make('td');add(who,'strong','',a.name);add(who,'div','',a.email).style.color='#9cb0cb';tr.append(who);
   cell(tr,a.readiness==='review_ready'?'Ready for review':'Manual readiness review');
   cell(tr,dateString(a.createdAt));
   const stateTd=make('td');add(stateTd,'span','pill '+(a.state==='approved'?'good':'waiting'),a.state==='approved'?'Portal approved':'Pending review');tr.append(stateTd);
   const actions=make('td');
   if(a.state==='approved')add(actions,'span','mono',a.agentId||'Approved');
   else{
    const b=add(actions,'button','btn','Review & approve');b.type='button';b.style.padding='8px 10px';b.style.fontSize='11px';
    b.addEventListener('click',()=>approve(a,b));
   }
   tr.append(actions);tbody.append(tr);
  }
 }
 async function approve(a,button){
  if(!confirm('Review '+a.name+' ('+a.email+') and approve portal-only access? This does NOT promise employment or activate a dialer.'))return;
  button.disabled=true;clearNotice($('approvalResult'));
  try{
   const j=await jsonPost('/api/portal',{action:'approve',id:a.id});
   const box=$('approvalResult');box.replaceChildren();box.className='notice success';
   add(box,'strong','', 'Portal approval completed for '+a.name+'.');
   add(box,'p','', 'Worker ID: '+j.agentId+'. Copy the invitation token now and share it privately with the verified applicant. This token is shown only once.');
   const input=add(box,'input','field');input.type='text';input.readOnly=true;input.value=j.inviteToken;input.setAttribute('aria-label','One-time invitation token');input.style.margin='9px 0';
   const copy=add(box,'button','btn','Copy private invitation');
   copy.type='button';copy.onclick=async()=>{try{await navigator.clipboard.writeText(j.agentId+'\n'+j.inviteToken);copy.textContent='Copied to clipboard'}catch{input.focus();input.select();copy.textContent='Select and copy the token'}};
   await loadPortal(true);
  }catch(e){notice($('approvalResult'),'Approval failed. '+e.message,'error');button.disabled=false}
 }
 function renderIncome(data){
  const tbody=$('paymentsBody');tbody.replaceChildren();
  if(!data.length){tableEmpty(tbody,5,'No Stripe-verified paid events have been recorded.');return}
  for(const p of data){
   const tr=make('tr');
   cell(tr,p.agentId,'mono');cell(tr,p.campaign||'Unspecified');
   cell(tr,cash(p.grossMinor,p.currency));cell(tr,dateString(p.recordedAt));
   const td=make('td');add(td,'span','pill waiting','Not confirmed');tr.append(td);tbody.append(tr);
  }
 }
 function renderPrivacy(items){
  const tbody=$('privacyBody');if(!tbody)return;tbody.replaceChildren();
  if(!items?.length){tableEmpty(tbody,4,'No candidate data requests have been logged.');return}
  for(const req of items){const tr=make('tr');cell(tr,req.email);cell(tr,req.type);cell(tr,req.reference||'—','mono');cell(tr,dateString(req.requestedAt));tbody.append(tr)}
 }
 function renderIntegrations(data){
  const info=data.integrations||{},target=$('integrationItems');target.replaceChildren();
  const pairs=[
   ['Private applicant storage',info.applicantStore==='connected','Verified private store'],
   ['Stripe signed webhook',!!info.stripe,info.stripe?'Configured; verify test events':'No signing secret connected'],
   ['Verified business email',!!info.email,info.email?'Connected':'Provider not connected'],
   ['Cloud dialer',!!info.dialer,info.dialer?'Connected':'Provider not connected'],
   ['WhatsApp Business',!!info.whatsapp,info.whatsapp?'Connected':'Sender/template not connected']
  ];
  for(const [name,ready,desc] of pairs){const item=add(target,'div','status-item');add(item,'strong','',name);add(item,'small','',ready?'● '+desc:'○ '+desc)}
 }
 function renderOwner(data){
  $('portalGreeting').textContent='Master Operations · Five AI divisions';
  $('portalTitle').textContent='Operations dashboard';
  $('portalSubtitle').textContent='Real applications, manual review and independently verified payment data.';
  $('roleBadge').textContent='Owner / Admin';
  $('ownerPanels').classList.remove('hidden');$('workerPanels').classList.add('hidden');
  $('sidebarApps').classList.remove('hidden');$('sidebarIncome').classList.remove('hidden');$('sidebarIntegrations').classList.remove('hidden');
  const apps=data.applications||[],approved=apps.filter(x=>x.state==='approved').length;
  const totals=Object.entries(data.totalsMinorByCurrency||{});
  const gross=totals.length===0?'0 verified':totals.length===1?cash(totals[0][1],totals[0][0]):totals.map(([cur,val])=>cash(val,cur)).join(' · ');
  setMetrics({applications:apps.length,approved,payments:data.verifiedTransactions||0,gross,grossNote:'Gross only · not bank payouts'});
  $('lastSync').textContent='Refreshed '+new Date().toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'});
  renderCandidates(apps);renderIncome(data.recentVerifiedPayments||[]);renderPrivacy(data.privacyRequests||[]);renderIntegrations(data);
  $('overviewStatus').replaceChildren();
  const details=[['Private applicant intake','Enabled · human review required'],['Candidate placements','Portal approval only · no live campaigns'],['Payment ledger',data.integrations?.stripe?'Signed Stripe webhook configured':'Stripe sender not connected'],['WhatsApp alerts','Disabled until sender and template are approved']];
  details.forEach(([a,b])=>{const el=add($('overviewStatus'),'div','status-item');add(el,'strong','',a);add(el,'small','',b)});
 }
 function renderWorker(data){
  $('portalGreeting').textContent='Division C · Approved candidate portal';
  $('portalTitle').textContent='Your workspace';
  $('portalSubtitle').textContent='Private worker ID: '+safeText(data.agentId);
  $('roleBadge').textContent='Worker · '+data.agentId;
  $('ownerPanels').classList.add('hidden');$('workerPanels').classList.remove('hidden');
  $('sidebarApps').classList.add('hidden');$('sidebarIncome').classList.add('hidden');$('sidebarIntegrations').classList.add('hidden');
  const totals=Object.entries(data.attributedGrossMinorByCurrency||{});
  setMetrics({applications:'Approved',approved:'Portal only',payments:data.verifiedEvents||0,gross:totals.length?totals.map(([cur,val])=>cash(val,cur)).join(' · '):'0 verified',grossNote:'Customer gross · not wages'});
  const target=$('workerStatus');target.replaceChildren();
  [['Worker ID',data.agentId],['Portal access',data.state],['Campaign assignment',data.campaign||'Not assigned'],['Live dialer',data.dialerConnected?'Authorized':'Not connected']].forEach(([k,v])=>{const el=add(target,'div','status-item');add(el,'strong','',k);add(el,'small','',v)});
  $('workerMoney').textContent=totals.length?'Attributed customer receipts: '+totals.map(([k,v])=>cash(v,k)).join(', ')+'. These are not an agreed wage or payout.':'There are no verified customer payment events attributed to this worker. No wages or earnings are claimed.';
 }
 async function loadPortal(refreshed=false){
  if(loadingData)return;loadingData=true;refreshButtons.forEach(b=>{if(b)b.disabled=true});
  try{
   const result=await request('/api/portal');
   if(result.role==='owner')renderOwner(result);else renderWorker(result);
   clearNotice(message);
  }catch(e){notice(message,'Could not load private records: '+e.message,'error');if(e.message.includes('(401)')){location.replace('/login');return}}
  finally{loadingData=false;refreshButtons.forEach(b=>{if(b)b.disabled=false})}
 }
 request('/api/session').then(async result=>{
  if(!result.authenticated){location.replace('/login');return}
  session=result;loading.classList.add('hidden');shell.classList.remove('hidden');
  await loadPortal();
 }).catch(e=>{loading.querySelector('h2').textContent='Could not verify your session';loading.querySelector('p').textContent=e.message+'. Check your connection, then return to Sign in.'});
 window.addEventListener('focus',()=>{if(session&&!loadingData)loadPortal(true)});
}
})();