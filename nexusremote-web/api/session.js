import{createSession,getSession,setSessionCookie,clearSessionCookie}from'../lib/auth.js';
import{safeEqual,hash,readRecord,sameOrigin,reply}from'../lib/core.js';
export default async function handler(req,res){
 if(req.method==='GET'){
  const s=getSession(req);
  if(!s)return reply(res,200,{authenticated:false});
  if(s.role==='worker'){
   try{const w=await readRecord('workers/'+s.agentId+'.json');if(!w||w.status!=='approved_portal_only')return reply(res,200,{authenticated:false})}
   catch{return reply(res,503,{error:'ACCOUNT_VALIDATION_UNAVAILABLE'})}
  }
  return reply(res,200,{authenticated:true,role:s.role,agentId:s.agentId,expires:s.expires});
 }
 if(req.method!=='POST')return reply(res,405,{error:'METHOD_NOT_ALLOWED'});
 if(!sameOrigin(req))return reply(res,403,{error:'SAME_ORIGIN_REQUIRED'});
 if(!String(req.headers['content-type']||'').includes('application/json'))return reply(res,415,{error:'JSON_REQUIRED'});
 if(req.body?.action==='logout'){clearSessionCookie(res);return reply(res,200,{signedOut:true})}
 const role=String(req.body?.role||'');
 if(role==='owner'){
  if(!safeEqual(String(req.body?.token||''),process.env.ADMIN_API_TOKEN||''))return reply(res,401,{error:'INVALID_CREDENTIALS'});
  setSessionCookie(res,createSession('owner',null),8*3600);
  return reply(res,200,{authenticated:true,role:'owner',redirect:'/portal'});
 }
 if(role==='worker'){
  const id=String(req.body?.agentId||'').trim().toUpperCase(),token=String(req.body?.token||'');
  if(!/^NX-[A-F0-9]{8}$/.test(id)||token.length>160||!/^nxw_[a-f0-9]{24}\.[a-f0-9]{24}$/.test(token))return reply(res,401,{error:'INVALID_CREDENTIALS'});
  try{
   const w=await readRecord('workers/'+id+'.json');
   if(!w||w.status!=='approved_portal_only'||!safeEqual(w.tokenHash,hash(token)))return reply(res,401,{error:'INVALID_CREDENTIALS'});
   setSessionCookie(res,createSession('worker',id),12*3600);
   return reply(res,200,{authenticated:true,role:'worker',agentId:id,redirect:'/portal'});
  }catch(e){console.error('worker auth storage',e?.name);return reply(res,503,{error:'LOGIN_UNAVAILABLE'})}
 }
 return reply(res,400,{error:'UNKNOWN_ROLE'});
}
