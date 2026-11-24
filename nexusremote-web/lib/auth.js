import {createHmac,timingSafeEqual} from 'node:crypto';
const COOKIE='nx_session';
const CURRENT_VERSION=1;
function secret(){const key=process.env.ADMIN_API_TOKEN;if(!key)throw Error('OWNER_SECRET_UNAVAILABLE');return createHmac('sha256',key).update('NEXUS_SESSION_V1').digest()}
function equal(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&x.length>0&&timingSafeEqual(x,y)}
export function createSession(role,agentId,now=Date.now()){
 if(!['owner','worker'].includes(role))throw Error('INVALID_ROLE');
 if(role==='worker'&&!/^NX-[A-F0-9]{8}$/.test(agentId))throw Error('INVALID_WORKER');
 const body=Buffer.from(JSON.stringify({v:CURRENT_VERSION,role,agentId:role==='worker'?agentId:null,issued:now,expires:now+(role==='owner'?8:12)*3600000})).toString('base64url');
 const signature=createHmac('sha256',secret()).update(body).digest('base64url');
 return body+'.'+signature;
}
export function parseSession(value,now=Date.now()){
 if(typeof value!=='string'||value.length>1100)return null;
 const [body,sig,extra]=value.split('.');if(!body||!sig||extra)return null;
 try{
  const expected=createHmac('sha256',secret()).update(body).digest('base64url');
  if(!equal(expected,sig))return null;
  const data=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
  if(data.v!==CURRENT_VERSION||!['owner','worker'].includes(data.role)||!Number.isFinite(data.expires)||data.expires<=now||data.issued>now+300000)return null;
  if(data.role==='worker'&&!/^NX-[A-F0-9]{8}$/.test(data.agentId))return null;
  return {role:data.role,agentId:data.role==='worker'?data.agentId:null,expires:data.expires};
 }catch{return null}
}
export function getSession(req){
 const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
 return parseSession(cookie?cookie.slice(COOKIE.length+1):'');
}
export function setSessionCookie(res,token,maxAge){
 res.setHeader('Set-Cookie',COOKIE+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge);
}
export function clearSessionCookie(res){res.setHeader('Set-Cookie',COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')}
