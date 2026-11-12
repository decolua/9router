import {randomUUID} from "node:crypto";
import {authorized,validate,backendUrl,MODEL} from "../../../lib/config.js";
const err=(res,status,message)=>res.status(status).json({error:{type:"api_error",message}});
export default async function handler(req,res){res.setHeader("Cache-Control","no-store");
 if(req.method!=="POST")return err(res,405,"POST required");
 if(!authorized(req))return err(res,401,"Valid bearer token required");
 if(!String(req.headers["content-type"]||"").includes("application/json"))return err(res,415,"JSON required");
 const problem=validate(req.body);if(problem)return err(res,400,problem);
 const endpoint=backendUrl(process.env.FRONTIER_GPU_BASE_URL);
 if(!endpoint||!process.env.FRONTIER_UPSTREAM_KEY)return err(res,503,"GPU backend is not provisioned or configured. No inference was performed.");
 const timer=new AbortController();const timeout=setTimeout(()=>timer.abort(),45000);
 try{const upstream=await fetch(endpoint,{method:"POST",headers:{"Authorization":"Bearer "+process.env.FRONTIER_UPSTREAM_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:MODEL,messages:req.body.messages,stream:false,max_tokens:req.body.max_tokens??384,temperature:req.body.temperature??0.2}),signal:timer.signal,redirect:"error"});
 if(!upstream.ok){console.error("frontier upstream failed HTTP",upstream.status);return err(res,502,"Configured GPU backend returned an error (HTTP "+upstream.status+")")}
 const j=await upstream.json();const answer=j?.choices?.[0]?.message?.content;if(typeof answer!=="string"||!answer.trim())return err(res,502,"GPU backend returned no text");
 return res.status(200).json({id:"chatcmpl-"+randomUUID(),object:"chat.completion",created:Math.floor(Date.now()/1000),model:MODEL,choices:[{index:0,message:{role:"assistant",content:answer},finish_reason:"stop"}],usage:j.usage||null});
 }catch(e){console.error("frontier request",String(e?.name||"ERROR"));return err(res,503,"Configured GPU endpoint is not reachable or timed out")}finally{clearTimeout(timeout)}
}