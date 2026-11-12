import{getSession}from'../lib/auth.js';
import{readRecord,records,writeRecord,reply,randomId,hash,sameOrigin}from'../lib/core.js';
const limit=90;
async function load(prefix){const files=await records(prefix,limit);return(await Promise.all(files.map(x=>readRecord(x.pathname)))).filter(Boolean)}
export default async function handler(req,res){
 const session=getSession(req);if(!session)return reply(res,401,{error:'SIGN_IN_REQUIRED'});
 try{
  if(session.role==='worker'){
   const worker=await readRecord('workers/'+session.agentId+'.json');
   if(!worker||worker.status!=='approved_portal_only')return reply(res,401,{error:'ACCOUNT_NOT_ACTIVE'});
   if(req.method!=='GET')return reply(res,405,{error:'READ_ONLY_WORKER_PORTAL'});
   const ledger=await load('income/');
   const own=ledger.filter(x=>x.agentId===session.agentId);
   const amounts={};for(const x of own){amounts[x.currency]=(amounts[x.currency]||0)+x.grossMinor}
   return reply(res,200,{role:'worker',agentId:worker.agentId,state:worker.status,campaign:worker.campaign||null,dialerConnected:false,verifiedEvents:own.length,attributedGrossMinorByCurrency:amounts,personalPayAmountVerified:false,notice:'Gross payments are not wages. No live dialer, campaign contract, or worker payout is connected.'});
  }
  if(session.role!=='owner')return reply(res,403,{error:'OWNER_ONLY'});
  if(req.method==='GET'){
   const [apps,income,privacy]=await Promise.all([load('applications/'),load('income/'),load('privacy/')]);
   const approvals=await Promise.all(apps.map(x=>readRecord('approvals/'+x.id+'.json')));
   const merged=apps.map((a,i)=>({id:a.id,name:a.name,email:a.email,createdAt:a.createdAt,readiness:a.readiness,experience:a.experience,workspace:a.workspace,headset:a.headset,internetMbps:a.internetMbps,state:approvals[i]?'approved':a.state,agentId:approvals[i]?.agentId||null})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
   const totals={};for(const item of income){totals[item.currency]=(totals[item.currency]||0)+item.grossMinor}
   const recent=income.sort((a,b)=>b.recordedAt.localeCompare(a.recordedAt)).slice(0,12).map(x=>({agentId:x.agentId,campaign:x.campaign,currency:x.currency,grossMinor:x.grossMinor,recordedAt:x.recordedAt,bankPayoutConfirmed:false}));
   return reply(res,200,{role:'owner',applications:merged,verifiedTransactions:income.length,totalsMinorByCurrency:totals,recentVerifiedPayments:recent,privacyRequests:privacy.sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt)).slice(0,20).map(x=>({id:x.id,email:x.email,type:x.type,reference:x.reference,requestedAt:x.requestedAt,status:x.status})),integrations:{applicantStore:'connected',stripe:!!process.env.STRIPE_WEBHOOK_SECRET,whatsapp:false,dialer:false,email:false},coverage:'Up to 90 most recent records, not a complete financial audit',noApplicantFees:true,noGuaranteedEmployment:true});
  }
  if(req.method==='POST'){
   if(!sameOrigin(req))return reply(res,403,{error:'SAME_ORIGIN_REQUIRED'});
   if(!String(req.headers['content-type']||'').includes('application/json'))return reply(res,415,{error:'JSON_REQUIRED'});
   if(req.body?.action!=='approve')return reply(res,400,{error:'UNSUPPORTED_ACTION'});
   const id=String(req.body?.id||'');if(!/^app_[a-f0-9]{24}$/.test(id))return reply(res,400,{error:'INVALID_APPLICATION'});
   const app=await readRecord('applications/'+id+'.json');if(!app)return reply(res,404,{error:'APPLICATION_NOT_FOUND'});
   if(await readRecord('approvals/'+id+'.json'))return reply(res,409,{error:'ALREADY_APPROVED'});
   const agentId='NX-'+randomId('').slice(0,8).toUpperCase(),token=randomId('nxw_')+'.'+randomId('');
   await writeRecord('workers/'+agentId+'.json',{agentId,applicationId:id,tokenHash:hash(token),createdAt:new Date().toISOString(),status:'approved_portal_only',campaign:null});
   try{await writeRecord('approvals/'+id+'.json',{agentId,approvedAt:new Date().toISOString()})}
   catch(e){return reply(res,409,{error:'APPROVAL_CONFLICT_REVIEW'})}
   return reply(res,200,{approved:true,agentId,inviteToken:token,notice:'Copy and securely share this one-time invitation. No email was sent, dialer was created, or employment guaranteed.'});
  }
  return reply(res,405,{error:'METHOD_NOT_ALLOWED'});
 }catch(e){console.error('portal backend',e?.name,String(e?.message||'').slice(0,90));return reply(res,503,{error:'PRIVATE_OPERATION_UNAVAILABLE'})}
}
