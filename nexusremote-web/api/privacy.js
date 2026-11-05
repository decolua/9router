import{reply,sameOrigin,writeRecord,randomId}from'../lib/core.js';
export default async function handler(req,res){
 if(req.method!=='POST')return reply(res,405,{error:'POST_REQUIRED'});
 if(!sameOrigin(req))return reply(res,403,{error:'SAME_ORIGIN_REQUIRED'});
 if(!String(req.headers['content-type']||'').includes('application/json'))return reply(res,415,{error:'JSON_REQUIRED'});
 if(req.body?.website)return reply(res,202,{received:true});
 const email=String(req.body?.email||'').toLowerCase().trim();
 const type=String(req.body?.type||''),reference=String(req.body?.reference||'').trim();
 if(email.length>180||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['access','delete','correct'].includes(type)||reference.length>60)return reply(res,422,{error:'INVALID_PRIVACY_REQUEST'});
 const id=randomId('req_');
 try{
  await writeRecord('privacy/'+id+'.json',{id,email,type,reference,requestedAt:new Date().toISOString(),status:'awaiting_identity_verification'});
  return reply(res,201,{reference:id,message:'Your request has been logged for identity verification and manual handling. No record has been automatically deleted or disclosed.'});
 }catch(e){console.error('privacy request storage',e?.name);return reply(res,503,{error:'PRIVATE_REQUEST_STORAGE_UNAVAILABLE'})}
}