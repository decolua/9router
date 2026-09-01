import { BaseExecutor } from "./base.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
const API_BASE = "https://theoldllm.vercel.app";
const API_PATH = "/api/chatgpt";
const API_URL = `${API_BASE}${API_PATH}`;
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const GPT_MODELS = {
    "gpt-5.4": "GPT_5_4",
    "gpt-5.3": "GPT_5_3",
    "gpt-5.2": "GPT_5_2",
    "gpt-5.1": "GPT_5_1",
    "gpt-5": "GPT_5",
    gpt5_4: "GPT_5_4",
    gpt5_3: "GPT_5_3",
    gpt5_2: "GPT_5_2",
    gpt5_1: "GPT_5_1",
    gpt_4o: "GPT_4O",
    "gpt-4o": "GPT_4O",
    gpt_5_3: "GPT_5_3",
    gpt_5_2: "GPT_5_2",
    gpt_5_1: "GPT_5_1",
    gpt_5: "GPT_5"
};
const CLAUDE_NAMES = {
    "claude-4.6-opus": "CLAUDE_4_6_OPUS",
    "claude-4.6-sonnet": "CLAUDE_4_6_SONNET",
    "claude-4.5-haiku": "CLAUDE_4_5_HAIKU",
    claude_opus_4: "CLAUDE_4_6_OPUS",
    claude_sonnet_4: "CLAUDE_4_6_SONNET",
    claude_haiku_3_5: "CLAUDE_4_5_HAIKU",
    "claude opus 4": "CLAUDE_4_6_OPUS",
    "claude sonnet 4": "CLAUDE_4_6_SONNET",
    "claude haiku 3.5": "CLAUDE_4_5_HAIKU"
};
export const CHATGPT_UPSTREAM_MODELS = new Set([
    "GPT_5_4",
    "GPT_5_3",
    "GPT_5_2",
    "GPT_5_1",
    "GPT_5",
    "GPT_o4_mini",
    "GPT_o3_mini",
    "gemini_3_pro",
    "gemini_2_5_pro",
    "gemini_2_0_flash",
    "gemini_1_5_flash",
    "CLAUDE_4_6_OPUS",
    "CLAUDE_4_6_SONNET",
    "CLAUDE_4_5_HAIKU",
    "openrouter_gpt_4_o",
    "openrouter_gpt_4_o_mini",
    "openrouter_gpt_4",
    "openrouter_grok_4",
    "together_deepseek_r1",
    "openrouter_deepseek_r1",
    "together_deepseek_v3",
    "openrouter_deepseek_v3",
    "sonar-deep-research",
    "sonar-pro",
    "openrouter_web_search"
]);
export function mapModel(model) {
    const trimmed = model.trim();
    if (CHATGPT_UPSTREAM_MODELS.has(trimmed)) return trimmed;
    const n = model.toLowerCase().trim();
    const gptKey = n.replace(/[_\s]+/g, "-");
    if (GPT_MODELS[gptKey]) return GPT_MODELS[gptKey];
    const gptKey2 = n.replace(/[-\s]+/g, "_");
    if (GPT_MODELS[gptKey2]) return GPT_MODELS[gptKey2];
    if (CLAUDE_NAMES[n]) return CLAUDE_NAMES[n];
    if (n.includes("claude")) {
        if (n.includes("opus")) return "CLAUDE_4_6_OPUS";
        if (n.includes("sonnet")) return "CLAUDE_4_6_SONNET";
        if (n.includes("haiku")) return "CLAUDE_4_5_HAIKU";
    }
    if (n.includes("gpt") && n.includes("5")) return "GPT_5_4";
    return "GPT_5_4";
}
const TOKEN_SEED = "oldllm-client-2026";
const UA_PREFIX = CHROME_UA.slice(0, 20);
class TheOldLlmProxyUnavailableError extends Error {}
export function generateRequestToken() {
    const n = Date.now();
    const e = `${n}-${TOKEN_SEED}-${UA_PREFIX}`;
    let t = 0;
    for(let i = 0; i < e.length; i++){
        const s = e.charCodeAt(i);
        t = (t << 5) - t + s;
        t = t & t;
    }
    const r = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    return `${n.toString(36)}-${Math.abs(t).toString(36)}-${r}`;
}
export const tokenCache = {
    value: "",
    expiresAt: 0
};
export async function fetchTheOldLlmWithProviderProxy(
    reqBody,
    signal,
    _dependencies,
    proxyOptions = null
) {
    return proxyAwareFetch(
        API_URL,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Client-Version": "3.8.4",
                "X-Request-Token": generateRequestToken(),
                "User-Agent": CHROME_UA
            },
            body: JSON.stringify(reqBody),
            signal
        },
        proxyOptions
    );
}

async function directFetch(reqBody, signal, proxyOptions = null) {
    const controller = new AbortController();
    const timer = setTimeout(()=>{
        const err = new Error("theoldllm timeout after 120000ms");
        err.name = "TimeoutError";
        controller.abort(err);
    }, 120_000);
    const onSignal = signal ? ()=>controller.abort(signal.reason) : undefined;
    signal?.addEventListener("abort", onSignal, {
        once: true
    });
    try {
        return await fetchTheOldLlmWithProviderProxy(reqBody, controller.signal, null, proxyOptions);
    } finally{
        clearTimeout(timer);
        if (onSignal) signal?.removeEventListener("abort", onSignal);
    }
}
export function isVercelMitigationResponse(response, body) {
    const mitigation = response.headers.get("x-vercel-mitigated")?.toLowerCase();
    if (mitigation === "deny" || mitigation === "challenge") return true;
    return (response.status === 403 || response.status === 429) && /vercel security checkpoint|"message"\s*:\s*"forbidden"/i.test(body);
}
function isTokenRejected(status, body) {
    if (status === 401 || status === 403) return true;
    try {
        const p = JSON.parse(body);
        return p?.error?.type === "access_denied" || typeof p?.error === "string" && /blocked|denied|invalid/i.test(p.error);
    } catch  {
        return false;
    }
}
function parseSseContent(sseText) {
    let content = "";
    for (const line of sseText.split("\n")){
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
                const d = JSON.parse(line.slice(6));
                content += d.choices?.[0]?.delta?.content || d.choices?.[0]?.delta?.text || "";
            } catch  {}
        }
    }
    return content;
}
function buildChatCompletion(content, model) {
    return JSON.stringify({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: mapModel(model),
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content
                },
                finish_reason: "stop"
            }
        ],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        }
    });
}
function buildErrorResponse(status, body) {
    let detail = body;
    for (const line of body.split("\n")){
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
                const p = JSON.parse(line.slice(6));
                if (p.error) {
                    detail = JSON.stringify(p.error);
                    break;
                }
            } catch  {}
        }
    }
    return JSON.stringify({
        error: {
            message: detail,
            type: "upstream_error",
            code: `HTTP_${status}`
        }
    });
}
function buildVercelMitigationError() {
    return JSON.stringify({
        error: {
            message: "The Old LLM is blocked by Vercel for this server egress IP. Configure a residential provider or global proxy for 'theoldllm' and retry.",
            type: "upstream_access_denied",
            code: "THEOLDLLM_VERCEL_MITIGATED"
        }
    });
}
function buildProxyUnavailableError() {
    return JSON.stringify({
        error: {
            message: "The Old LLM proxy assignment has no active proxies. Configure or enable a proxy and retry.",
            type: "proxy_unavailable",
            code: "THEOLDLLM_PROXY_UNAVAILABLE"
        }
    });
}
async function fetchUpstreamWithRetry(reqBody, signal, log, proxyOptions = null) {
    let response = await directFetch(reqBody, signal, proxyOptions);
    let body = await response.text();
    let vercelMitigated = isVercelMitigationResponse(response, body);
    if (!vercelMitigated && isTokenRejected(response.status, body)) {
        log?.warn?.("THEOLDLLM", `Token rejected (${response.status}), retrying with fresh token…`);
        response = await directFetch(reqBody, signal, proxyOptions);
        body = await response.text();
        vercelMitigated = isVercelMitigationResponse(response, body);
    }
    return {
        response,
        body,
        vercelMitigated
    };
}
export class TheOldLlmExecutor extends BaseExecutor {
    constructor(){
        super("theoldllm", {
            format: "openai"
        });
    }
    buildUrl(_model, _stream) {
        return API_URL;
    }
    buildHeaders(_credentials) {
        return {
            "Content-Type": "application/json",
            "X-Client-Version": "3.8.4",
            "User-Agent": CHROME_UA
        };
    }
    transformRequest(model, body, _stream) {
        if (typeof body === "object" && body !== null) {
            return {
                ...body,
                model: mapModel(model)
            };
        }
        return body;
    }
    executionResult(input, response, body) {
        return {
            response,
            url: API_URL,
            headers: this.buildHeaders(input.credentials),
            transformedBody: body
        };
    }
    async testConnection(_credentials, _signal, log) {
        try {
            const resp = await directFetch({
                model: "GPT_5_4",
                messages: [
                    {
                        role: "user",
                        content: "ping"
                    }
                ],
                stream: false
            }, _signal);
            const body = await resp.text();
            if (!resp.ok && isVercelMitigationResponse(resp, body)) {
                log?.warn?.("THEOLDLLM", "Vercel blocked this egress IP; configure a residential provider proxy");
                return false;
            }
            return resp.status === 200;
        } catch  {
            log?.warn?.("THEOLDLLM", "testConnection network error");
            return false;
        }
    }
    async execute(input) {
        const { model, stream, body, signal, log, proxyOptions = null } = input;
        const encoder = new TextEncoder();
        if (signal?.aborted) {
            return {
                response: new Response(encoder.encode(JSON.stringify({
                    error: {
                        message: "Request aborted",
                        type: "abort",
                        code: "ABORTED"
                    }
                })), {
                    status: 499,
                    headers: {
                        "Content-Type": "application/json"
                    }
                }),
                url: API_URL,
                headers: this.buildHeaders(input.credentials),
                transformedBody: body
            };
        }
        try {
            const reqBody = {
                ...body,
                model: mapModel(model),
                stream: true
            };
            const { response: upstream, body: finalBody, vercelMitigated } = await fetchUpstreamWithRetry(reqBody, signal, log, proxyOptions);
            if (upstream.status === 200 && finalBody) {
                const payload = stream ? finalBody : buildChatCompletion(parseSseContent(finalBody), model);
                return this.executionResult(input, new Response(encoder.encode(payload), {
                    status: 200,
                    headers: {
                        "Content-Type": stream ? "text/event-stream" : "application/json",
                        "Cache-Control": "no-cache"
                    }
                }), body);
            }
            const errorPayload = vercelMitigated ? buildVercelMitigationError() : buildErrorResponse(upstream.status, finalBody);
            return this.executionResult(input, new Response(encoder.encode(errorPayload), {
                status: upstream.status,
                headers: {
                    "Content-Type": "application/json"
                }
            }), body);
        } catch (err) {
            const proxyUnavailable = err instanceof TheOldLlmProxyUnavailableError;
            const msg = err instanceof Error ? err.message : String(err);
            log?.error?.("THEOLDLLM", `Executor error: ${msg}`);
            const errorPayload = proxyUnavailable ? buildProxyUnavailableError() : JSON.stringify({
                error: {
                    message: msg,
                    type: "upstream_error",
                    code: "EXECUTOR_ERROR"
                }
            });
            return this.executionResult(input, new Response(encoder.encode(errorPayload), {
                status: proxyUnavailable ? 503 : 502,
                headers: {
                    "Content-Type": "application/json"
                }
            }), body);
        }
    }
}
export default TheOldLlmExecutor;
