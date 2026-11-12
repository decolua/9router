import {MODEL,backendUrl} from "../lib/config.js";
export default function handler(req,res){res.setHeader("Cache-Control","no-store");if(req.method!=="GET")return res.status(405).json({error:"METHOD_NOT_ALLOWED"});
const configured=Boolean(backendUrl(process.env.FRONTIER_GPU_BASE_URL)&&process.env.FRONTIER_UPSTREAM_KEY);
res.status(200).json({environment:"Agent 01 Frontier",controlPlane:"deployed",model:MODEL,modelStatus:configured?"backend_configured_not_tested":"awaiting_gpu_backend",gpuHardwareProvisioned:false,productionInferenceVerified:false,auth:"private dashboard plus bearer-protected API",software:["vLLM","Docker Compose","Kubernetes GPU templates","Superpowers test checks"],limits:"GPU hardware, storage and operating costs are external"});
}