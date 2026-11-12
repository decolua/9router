import {timingSafeEqual} from "node:crypto";
export const DEFAULT_MODEL="Qwen/Qwen3-235B-A22B-Instruct-2507";
export const MODEL=process.env.FRONTIER_MODEL_ID||DEFAULT_MODEL;
export function secureEqual(a,b){if(!a||!b)return false;let x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
export function authorized(req){const token=/^Bearer ([A-Za-z0-9_-]+)$/i.exec(String(req.headers?.authorization||""))?.[1];return secureEqual(token,process.env.FRONTIER_API_KEY)}
export function backendUrl(url){if(!url)return null;let u;try{u=new URL(url)}catch{return null}
 if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash)return null;
 if(!u.hostname||u.hostname==="localhost"||u.hostname.endsWith(".local")||u.hostname.endsWith(".internal")||u.hostname==="127.0.0.1")return null;
 if(/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname))return null;
 if(u.pathname!=="/"&&u.pathname!=="/v1"&&u.pathname!=="/v1/")return null;
 return u.origin+"/v1/chat/completions";
}
export function validate(body){if(!body||typeof body!=="object"||Array.isArray(body))return "Expected a JSON object";
 if(body.model!==MODEL)return "Model is not enabled on this gateway";
 if(body.stream===true||body.tools||body.tool_choice||body.functions)return "Streaming and tool calling are not supported by this gateway";
 if(body.n!==undefined&&body.n!==1)return "n must equal 1";
 if(!Array.isArray(body.messages)||body.messages.length===0||body.messages.length>20)return "messages must contain 1-20 entries";
 let chars=0;for(const x of body.messages){if(!x||!["system","user","assistant"].includes(x.role)||typeof x.content!=="string"||!x.content.trim())return "Only non-empty text messages are supported";chars+=x.content.length}
 if(chars>16000)return "Messages exceed 16000 characters";
 if(body.messages.at(-1).role!=="user")return "Last message must have user role";
 if(body.max_tokens!==undefined&&(!Number.isInteger(body.max_tokens)||body.max_tokens<1||body.max_tokens>1024))return "max_tokens must be between 1 and 1024";
 return null}
