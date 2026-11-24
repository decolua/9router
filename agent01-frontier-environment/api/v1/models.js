import {authorized,MODEL,backendUrl} from "../../lib/config.js";
export default function handler(req,res){res.setHeader("Cache-Control","no-store");if(req.method!=="GET")return res.status(405).json({error:"METHOD_NOT_ALLOWED"});if(!authorized(req))return res.status(401).json({error:{code:"unauthorized",message:"Valid bearer token required"}});
const ready=Boolean(backendUrl(process.env.FRONTIER_GPU_BASE_URL)&&process.env.FRONTIER_UPSTREAM_KEY);
res.status(200).json({object:"list",data:ready?[{id:MODEL,object:"model",created:0,owned_by:"agent01-frontier",status:"configured_not_runtime_verified"}]:[]});
}