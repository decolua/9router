import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
function makeErrorResult(status, message, body, url) {
    return {
        response: new Response(
            JSON.stringify({
                error: {
                    message: String(message || "Cloudflare Playground upstream error"),
                    type: status === 429 ? "rate_limit_error" : "upstream_error",
                    code: `HTTP_${status}`
                }
            }),
            {
                status,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        ),
        url,
        headers: {},
        transformedBody: body
    };
}
export const PLAYGROUND_URL = "https://playground.ai.cloudflare.com/";
const PLAYGROUND_WS_BASE = "wss://playground.ai.cloudflare.com/agents/playground/";
const PLAYGROUND_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const BROWSER_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check"
];
const MODEL_PREFIX = "@cf/";
const DEFAULT_MODEL = "zai-org/glm-4.7-flash";
const DEFAULT_TEMPERATURE = 0.7;
const NAV_TIMEOUT_MS = 45_000;
const CHAT_TIMEOUT_MS = 120_000;
const BLOCKED_MESSAGE = "Cloudflare Playground blocked the headless browser (fingerprint check). Set CLOUDFLARE_PLAYGROUND_CHROME_PATH to a full desktop Chrome binary and retry.";
export function parseCfFrame(raw) {
    try {
        const msg = JSON.parse(raw);
        if (msg && typeof msg === "object" && typeof msg.type === "string") return msg;
    } catch  {}
    return null;
}
export class CfStreamParser {
    chatId;
    done = false;
    text = "";
    reasoningText = "";
    finishReason = null;
    error = null;
    seenStart = false;
    constructor(chatId){
        this.chatId = chatId;
    }
    push(raw) {
        const msg = parseCfFrame(raw);
        if (!msg || msg.type !== "cf_agent_use_chat_response" || msg.id !== this.chatId) return null;
        if (msg.error) {
            this.error = classifyError(msg.body);
            return null;
        }
        if (msg.done) {
            this.done = true;
            return null;
        }
        let body;
        try {
            body = typeof msg.body === "string" ? JSON.parse(msg.body) : msg.body;
        } catch  {
            return null;
        }
        if (!body || typeof body.type !== "string") return null;
        switch(body.type){
            case "start":
                if (this.seenStart) return null;
                this.seenStart = true;
                return {
                    type: "role"
                };
            case "reasoning-delta":
                {
                    const delta = typeof body.delta === "string" ? body.delta : "";
                    if (!delta) return null;
                    this.reasoningText += delta;
                    return {
                        type: "reasoning",
                        value: delta
                    };
                }
            case "text-delta":
                {
                    const delta = typeof body.delta === "string" ? body.delta : "";
                    if (!delta) return null;
                    this.text += delta;
                    return {
                        type: "content",
                        value: delta
                    };
                }
            case "finish":
                {
                    const meta = body.messageMetadata ?? {};
                    const reason = typeof meta.finishReason === "string" ? meta.finishReason : "stop";
                    this.finishReason = reason;
                    return {
                        type: "finish",
                        value: reason
                    };
                }
            default:
                return null;
        }
    }
}
function classifyError(body) {
    let detail = "";
    if (typeof body === "string") {
        try {
            const parsed = JSON.parse(body);
            detail = String(parsed.details || parsed.message || "");
        } catch  {
            detail = body;
        }
    } else if (body && typeof body === "object") {
        const parsed = body;
        detail = String(parsed.details || parsed.message || "");
    }
    const status = /rate|limit|quota|throttl/i.test(detail) ? 429 : 502;
    return {
        status,
        message: detail || "Cloudflare Playground upstream error"
    };
}
export function toCfMessages(messages) {
    const out = [];
    for (const message of messages ?? []){
        if (message.role !== "user" && message.role !== "assistant") continue;
        let text = "";
        if (typeof message.content === "string") {
            text = message.content;
        } else if (Array.isArray(message.content)) {
            text = message.content.map((part)=>typeof part === "string" ? part : part?.text ?? "").filter(Boolean).join("\n");
        }
        if (!text) continue;
        out.push({
            role: message.role,
            parts: [
                {
                    type: "text",
                    text
                }
            ],
            id: `m${out.length + 1}`
        });
    }
    return out;
}
function openPlaygroundSession(args) {
    const { chatId, model, messages, temperature, wsBase } = args;
    const pk = crypto.randomUUID();
    const room = "playground-" + crypto.randomUUID().replace(/-/g, "").slice(0, 25);
    const socket = new WebSocket(wsBase + room + "?_pk=" + pk);
    const push = (raw)=>{
        try {
            window.__cfpPush(raw);
        } catch  {}
    };
    socket.onopen = ()=>{
        socket.send(JSON.stringify({
            type: "cf_agent_stream_resume_request"
        }));
        socket.send(JSON.stringify({
            type: "rpc",
            id: "cfp-config",
            method: "setConfig",
            args: [
                {
                    model,
                    temperature,
                    stream: true
                }
            ]
        }));
        socket.send(JSON.stringify({
            id: chatId,
            init: {
                method: "POST",
                body: JSON.stringify({
                    messages,
                    trigger: "submit-message"
                })
            },
            type: "cf_agent_use_chat_request"
        }));
    };
    socket.onmessage = (event)=>push(String(event.data));
    socket.onerror = ()=>push(JSON.stringify({
            id: chatId,
            type: "cf_agent_use_chat_response",
            error: true,
            body: JSON.stringify({
                message: "Playground WebSocket error",
                details: "ws transport failed"
            })
        }));
}
export class PlaywrightCfTransport {
    chatId;
    chromeExecutablePath;
    browser = null;
    page = null;
    pending = [];
    waiters = [];
    closed = false;
    abortSignal = null;
    abortListener = null;
    constructor(chatId, chromeExecutablePath){
        this.chatId = chatId;
        this.chromeExecutablePath = chromeExecutablePath;
    }
    async start(config) {
        try {
            const playwright = await importPlaywright();
            const executablePath = this.chromeExecutablePath ?? process.env.CLOUDFLARE_PLAYGROUND_CHROME_PATH;
            this.browser = await playwright.chromium.launch({
                ...executablePath ? {
                    executablePath
                } : {},
                headless: true,
                args: BROWSER_ARGS
            });
            const context = await this.browser.newContext({
                userAgent: PLAYGROUND_UA
            });
            const page = await context.newPage();
            this.page = page;
            await page.goto(PLAYGROUND_URL, {
                waitUntil: "domcontentloaded",
                timeout: NAV_TIMEOUT_MS
            });
            const title = await page.title().catch(()=>"");
            if (title.includes("Attention Required")) {
                await this.close().catch(()=>{});
                return {
                    ok: false,
                    status: 502,
                    message: BLOCKED_MESSAGE
                };
            }
            await page.exposeFunction("__cfpPush", (raw)=>{
                this.push(raw);
            });
            await page.evaluate(()=>{
                window.__name = (fn)=>fn;
            });
            await page.evaluate(openPlaygroundSession, {
                ...config,
                chatId: this.chatId,
                wsBase: PLAYGROUND_WS_BASE
            });
            if (config.signal) {
                this.abortSignal = config.signal;
                this.abortListener = ()=>{
                    void this.close();
                };
                config.signal.addEventListener("abort", this.abortListener, {
                    once: true
                });
            }
            return {
                ok: true
            };
        } catch (error) {
            await this.close().catch(()=>{});
            return {
                ok: false,
                status: 502,
                message: `Cloudflare Playground browser session failed: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    push(raw) {
        const waiter = this.waiters.shift();
        if (waiter) waiter(raw);
        else this.pending.push(raw);
    }
    async *frames() {
        while(this.pending.length > 0 || !this.closed){
            if (this.pending.length > 0) {
                yield this.pending.shift();
                continue;
            }
            const frame = await new Promise((resolve)=>this.waiters.push(resolve));
            if (frame === null) return;
            yield frame;
        }
    }
    async close() {
        if (this.closed) return;
        this.closed = true;
        if (this.abortSignal && this.abortListener) {
            this.abortSignal.removeEventListener("abort", this.abortListener);
        }
        this.abortSignal = null;
        this.abortListener = null;
        for (const waiter of this.waiters.splice(0))waiter(null);
        const browser = this.browser;
        this.browser = null;
        if (browser) await browser.close().catch(()=>{});
    }
}
async function importPlaywright() {
    try {
        return await import("playwright");
    } catch  {
        throw new Error("Playwright is not available. Install it (npm i playwright && npx playwright install chromium) or set CLOUDFLARE_PLAYGROUND_CHROME_PATH to a Chrome binary.");
    }
}
function sseChunk(cid, created, model, payload) {
    const base = {
        id: cid,
        object: "chat.completion.chunk",
        created,
        model
    };
    if (payload.error) {
        return `data: ${JSON.stringify({
            ...base,
            error: payload.error
        })}\n\n`;
    }
    return `data: ${JSON.stringify({
        ...base,
        choices: [
            {
                index: 0,
                delta: payload.delta ?? {},
                finish_reason: payload.finish_reason ?? null
            }
        ]
    })}\n\n`;
}
export class CloudflarePlaygroundExecutor extends BaseExecutor {
    transportFactory;
    chatTimeoutMs;
    constructor(transportFactory = (chatId)=>new PlaywrightCfTransport(chatId), chatTimeoutMs = CHAT_TIMEOUT_MS){
        super("cloudflare-playground", {
            id: "cloudflare-playground",
            baseUrl: PLAYGROUND_URL,
            noAuth: true,
            format: "openai",
            timeoutMs: CHAT_TIMEOUT_MS
        }), this.transportFactory = transportFactory, this.chatTimeoutMs = chatTimeoutMs;
    }
    async execute(input) {
        const { body, signal, stream: wantStream } = input;
        const bodyObj = body || {};
        const rawModel = bodyObj.model || DEFAULT_MODEL;
        const model = rawModel.startsWith(MODEL_PREFIX) ? rawModel : MODEL_PREFIX + rawModel;
        const temperature = typeof bodyObj.temperature === "number" ? bodyObj.temperature : DEFAULT_TEMPERATURE;
        const chatId = `chatcmpl-cfp-${randomUUID().slice(0, 12)}`;
        const created = Math.floor(Date.now() / 1000);
        const transport = this.transportFactory(chatId);
        const started = await transport.start({
            model,
            messages: toCfMessages(bodyObj.messages || []),
            temperature,
            signal
        });
        if (started.ok !== true) {
            return makeErrorResult(started.status, started.message, body, PLAYGROUND_URL);
        }
        const timedOut = {
            current: false
        };
        const timer = setTimeout(()=>{
            timedOut.current = true;
            void transport.close();
        }, this.chatTimeoutMs);
        try {
            if (!wantStream) {
                const parser = new CfStreamParser(chatId);
                for await (const raw of transport.frames()){
                    parser.push(raw);
                    if (parser.error || parser.done) break;
                }
                if (parser.error) {
                    return makeErrorResult(parser.error.status, parser.error.message, body, PLAYGROUND_URL);
                }
                if (timedOut.current && !parser.text) {
                    return makeErrorResult(504, "Cloudflare Playground timed out", body, PLAYGROUND_URL);
                }
                const text = parser.text;
                const messagePayload = {
                    role: "assistant",
                    content: text
                };
                if (parser.reasoningText) {
                    messagePayload.reasoning_content = parser.reasoningText;
                }
                return {
                    response: new Response(JSON.stringify({
                        id: chatId,
                        object: "chat.completion",
                        created,
                        model: rawModel,
                        choices: [
                            {
                                index: 0,
                                message: messagePayload,
                                finish_reason: parser.finishReason ?? "stop"
                            }
                        ],
                        usage: {
                            prompt_tokens: 0,
                            completion_tokens: Math.ceil((text.length + parser.reasoningText.length) / 4),
                            total_tokens: 0
                        }
                    }), {
                        headers: {
                            "Content-Type": "application/json"
                        }
                    }),
                    url: PLAYGROUND_URL,
                    headers: {},
                    transformedBody: body
                };
            }
            const encoder = new TextEncoder();
            const responseStream = new ReadableStream({
                async start (controller) {
                    const parser = new CfStreamParser(chatId);
                    let roleSent = false;
                    const enqueue = (payload)=>{
                        controller.enqueue(encoder.encode(sseChunk(chatId, created, rawModel, payload)));
                    };
                    try {
                        for await (const raw of transport.frames()){
                            if (signal?.aborted) break;
                            const event = parser.push(raw);
                            if (event) {
                                if (event.type === "role" && !roleSent) {
                                    enqueue({
                                        delta: {
                                            role: "assistant"
                                        },
                                        finish_reason: null
                                    });
                                    roleSent = true;
                                } else if (event.type === "reasoning") {
                                    enqueue({
                                        delta: {
                                            reasoning_content: event.value
                                        },
                                        finish_reason: null
                                    });
                                } else if (event.type === "content") {
                                    enqueue({
                                        delta: {
                                            content: event.value
                                        },
                                        finish_reason: null
                                    });
                                } else if (event.type === "finish") {
                                    enqueue({
                                        delta: {},
                                        finish_reason: event.value ?? "stop"
                                    });
                                }
                            }
                            if (parser.error) {
                                enqueue({
                                    error: {
                                        message: parser.error.message,
                                        type: "upstream_error",
                                        code: `HTTP_${parser.error.status}`
                                    }
                                });
                                break;
                            }
                            if (parser.done || timedOut.current) break;
                        }
                    } catch (error) {
                        if (!signal?.aborted) controller.error(error);
                    } finally{
                        clearTimeout(timer);
                        await transport.close().catch(()=>{});
                        if (timedOut.current) {
                            try {
                                enqueue({
                                    error: {
                                        message: "Cloudflare Playground timed out",
                                        type: "timeout_error",
                                        code: "HTTP_504"
                                    }
                                });
                            } catch  {}
                        }
                        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                        controller.close();
                    }
                }
            });
            return {
                response: new Response(responseStream, {
                    headers: {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        Connection: "keep-alive"
                    }
                }),
                url: PLAYGROUND_URL,
                headers: {},
                transformedBody: body
            };
        } finally{
            if (!wantStream) {
                clearTimeout(timer);
                await transport.close().catch(()=>{});
            }
        }
    }
}
