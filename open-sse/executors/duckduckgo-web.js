import { Buffer } from "node:buffer";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import vm from "node:vm";
import { solveDuckDuckGoChallenge, makeDuckDuckGoFeSignals } from "./duckduckgo-web/challenge.js";
import { DUCKDUCKGO_DEFAULT_MODEL, DUCKDUCKGO_MODEL_ALIASES, FE_VERSION_PATTERN, extractFreeDuckDuckGoModelIds, normalizeDuckDuckGoModel, pickDuckDuckGoModel } from "./duckduckgo-web/models.js";
import { BaseExecutor } from "./base.js";
const FETCH_TIMEOUT_MS = 30_000;


import { sanitizeErrorMessage } from "../utils/error.js";

export const CB_THRESHOLD = 5;
export const CB_COOLDOWN_MS = 30_000;
const circuitBreaker = {
    failures: 0,
    openedAt: 0
};
export function cbIsOpen() {
    if (circuitBreaker.openedAt === 0) return false;
    if (Date.now() - circuitBreaker.openedAt >= CB_COOLDOWN_MS) {
        circuitBreaker.openedAt = 0;
        return false;
    }
    return true;
}
export function cbRecordFailure() {
    circuitBreaker.failures++;
    if (circuitBreaker.failures >= CB_THRESHOLD && circuitBreaker.openedAt === 0) {
        circuitBreaker.openedAt = Date.now();
        console.warn(`[DDG-CB] Circuit breaker opened after ${circuitBreaker.failures} consecutive failures — fast-failing for ${CB_COOLDOWN_MS}ms`);
    }
}
export function cbRecordSuccess() {
    if (circuitBreaker.failures > 0) {
        circuitBreaker.failures = 0;
    }
}
export function __setDdgCircuitBreakerStateForTests(failures, openedAt) {
    circuitBreaker.failures = failures;
    circuitBreaker.openedAt = openedAt;
}
export function __getDdgCircuitBreakerStateForTests() {
    return {
        ...circuitBreaker
    };
}
export const DUCKDUCKGO_BASE = "https://duck.ai";
const AUTH_TOKEN_URL = `${DUCKDUCKGO_BASE}/duckchat/v1/auth/token`;
const COUNTRY_URL = `${DUCKDUCKGO_BASE}/country.json`;
export const STATUS_URL = `${DUCKDUCKGO_BASE}/duckchat/v1/status`;
export const CHAT_URL = `${DUCKDUCKGO_BASE}/duckchat/v1/chat`;
export const MODELS_URL = `${DUCKDUCKGO_BASE}/duckchat/v1/models`;
const DEFAULT_FE_VERSION = "serp_20260424_180649_ET-0bdc33b2a02ebf8f235def65d887787f694720a1";
export { FE_VERSION_PATTERN };
const DEFAULT_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) " + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
export const FAKE_HEADERS = {
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Origin: DUCKDUCKGO_BASE,
    Pragma: "no-cache",
    Referer: `${DUCKDUCKGO_BASE}/`,
    Priority: "u=1, i",
    "Sec-Ch-Ua": '"Chromium";v="149", "Not-A.Brand";v="24", "Google Chrome";v="149"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Linux"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": DEFAULT_USER_AGENT
};
const SEEDED_COOKIES = [
    [
        "5",
        "1"
    ],
    [
        "ah",
        "wt-wt"
    ],
    [
        "dcs",
        "1"
    ],
    [
        "dcm",
        "3"
    ],
    [
        "isRecentChatOn",
        "1"
    ]
];
const MODEL_IDS_CACHE_TTL_MS = 10 * 60 * 1000;
function shouldUseBrowserBacked() { return false; }
let durablePublicKey = null;
export function normalizeDuckDuckGoMessages(value) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((message)=>{
        if (!message || typeof message !== "object" || Array.isArray(message)) return [];
        const record = message;
        if (typeof record.role !== "string") return [];
        return [
            {
                ...record,
                role: record.role,
                content: record.content
            }
        ];
    });
}
function extractDuckDuckGoContent(data) {
    if (!data || typeof data !== "object") return "";
    const record = data;
    const content = record.content;
    if (typeof content === "string") return content;
    const message = record.message;
    if (typeof message === "string") return message;
    return "";
}
function parseDuckDuckGoDataLine(line) {
    if (!line.startsWith("data: ")) return null;
    try {
        return JSON.parse(line.slice(6));
    } catch (error) {
        void error;
        return null;
    }
}
function parseDuckDuckGoError(body) {
    try {
        return JSON.parse(body);
    } catch (error) {
        void error;
        return null;
    }
}
function splitSetCookieHeader(header) {
    const cookies = [];
    let start = 0;
    for(let index = 0; index < header.length; index++){
        if (header[index] !== ",") continue;
        const rest = header.slice(index + 1);
        if (/^\s*[^=;\s]+\s*=/.test(rest)) {
            cookies.push(header.slice(start, index).trim());
            start = index + 1;
        }
    }
    cookies.push(header.slice(start).trim());
    return cookies.filter(Boolean);
}
function collectSetCookieHeaders(headers) {
    const getSetCookie = headers.getSetCookie;
    if (typeof getSetCookie === "function") return getSetCookie.call(headers);
    const combined = headers.get("set-cookie");
    return combined ? splitSetCookieHeader(combined) : [];
}
function applySetCookie(cookieJar, setCookie) {
    const pair = setCookie.split(";", 1)[0]?.trim();
    if (!pair) return;
    const separator = pair.indexOf("=");
    if (separator <= 0) return;
    cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
}
function serializeCookieJar(cookieJar) {
    return Array.from(cookieJar.entries()).map(([name, value])=>`${name}=${value}`).join("; ");
}
function mergeHeadersCaseInsensitive(...sources) {
    const merged = {};
    const canonicalNames = new Map();
    for (const source of sources){
        if (!source) continue;
        for (const [name, value] of Object.entries(source)){
            const lowerName = name.toLowerCase();
            const previousName = canonicalNames.get(lowerName);
            if (previousName) delete merged[previousName];
            canonicalNames.set(lowerName, name);
            merged[name] = value;
        }
    }
    return merged;
}
export { DUCKDUCKGO_DEFAULT_MODEL, DUCKDUCKGO_MODEL_ALIASES, extractFreeDuckDuckGoModelIds, normalizeDuckDuckGoModel };
function getDuckDuckGoModelCapabilities(model) {
    if (model === "claude-haiku-4-5") return {
        reasoningEffort: "low"
    };
    if (model === "tinfoil/gpt-oss-120b") return {
        reasoningEffort: "low"
    };
    return {
        reasoningEffort: "none"
    };
}
function extractDuckDuckGoFeVersion(html) {
    return html.match(FE_VERSION_PATTERN)?.[0] ?? null;
}
function getDurablePublicKey() {
    if (!durablePublicKey) {
        const { publicKey } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            publicExponent: 0x10001
        });
        durablePublicKey = {
            ...publicKey.export({
                format: "jwk"
            }),
            alg: "RSA-OAEP-256",
            ext: true,
            key_ops: [
                "encrypt"
            ],
            use: "enc"
        };
    }
    return durablePublicKey;
}
function buildDuckDuckGoPayload(model, messages, canUseTools = true) {
    const capabilities = getDuckDuckGoModelCapabilities(model);
    const payload = {
        model,
        metadata: {
            toolChoice: {
                NewsSearch: false,
                VideosSearch: false,
                LocalSearch: false,
                WeatherForecast: false
            }
        },
        messages,
        canUseTools,
        ...capabilities.reasoningEffort ? {
            reasoningEffort: capabilities.reasoningEffort
        } : {},
        canUseApproxLocation: null,
        canDelegateImageGeneration: null,
        durableStream: {
            messageId: randomUUID(),
            conversationId: randomUUID(),
            publicKey: getDurablePublicKey()
        }
    };
    return payload;
}
function normalizeDuckDuckGoError(status, body) {
    const parsed = parseDuckDuckGoError(body);
    if (parsed) {
        const type = typeof parsed.type === "string" ? parsed.type : "";
        const overrideCode = typeof parsed.overrideCode === "string" ? parsed.overrideCode : "";
        if (type === "ERR_CHALLENGE" || type === "ERR_BN_LIMIT") {
            const codeSuffix = overrideCode ? ` (${overrideCode})` : "";
            return `DuckDuckGo AI Chat anti-abuse challenge failed: ${type}${codeSuffix}. ` + "Retry later or from a less rate-limited IP; DuckDuckGo is rejecting this anonymous session.";
        }
        if (type) return `DuckDuckGo AI Chat error: ${type}`;
    }
    return `DuckDuckGo AI Chat returned HTTP ${status}`;
}
function prepareToolMessages(_body, messages) {
    return {
        hasTools: false,
        requestedTools: null,
        effectiveMessages: messages
    };
}

function buildToolAwareResult(content) {
    return {
        content,
        toolCalls: null,
        finishReason: "stop"
    };
}

async function tryBackedChat() {
    return {
        status: 0,
        body: "",
        contentType: "text/event-stream"
    };
}

function normalizeSystemRole(messages) {
    if (!Array.isArray(messages)) return messages;

    const system = messages.filter(
        (m) =>
            m &&
            (m.role === "system" || m.role === "developer")
    );

    if (system.length === 0) return messages;

    const systemText = system
        .map((m) => {
            if (typeof m.content === "string") return m.content;

            if (Array.isArray(m.content)) {
                return m.content
                    .map((p) => {
                        if (typeof p === "string") return p;
                        if (
                            p &&
                            p.type === "text" &&
                            typeof p.text === "string"
                        ) {
                            return p.text;
                        }
                        return "";
                    })
                    .filter(Boolean)
                    .join("\n");
            }

            return "";
        })
        .filter(Boolean)
        .join("\n\n");

    const rest = messages.filter(
        (m) =>
            m &&
            m.role !== "system" &&
            m.role !== "developer"
    );

    if (!systemText) return rest;

    const index = rest.findIndex(
        (m) => m.role === "user"
    );

    if (index >= 0) {
        const current = rest[index];
        const userText =
            typeof current.content === "string"
                ? current.content
                : "";

        rest[index] = {
            ...current,
            content:
                `[System Instructions]\n${systemText}\n\n[User Message]\n${userText}`
        };
    } else {
        rest.unshift({
            role: "user",
            content:
                `[System Instructions]\n${systemText}`
        });
    }

    return rest;
}

export class DuckDuckGoWebExecutor extends BaseExecutor {
    poolConfig = {
        minSessions: 2,
        maxSessions: 5,
        cooldownBase: 1000,
        cooldownMax: 10000,
        cooldownJitter: 500,
        requestTimeout: 30000,
        requestJitter: 50
    };
    constructor(){
        super("duckduckgo-web", { baseUrl: CHAT_URL, noAuth: true, format: "openai" });
    }
    warmed = false;
    feVersion = DEFAULT_FE_VERSION;
    pendingVqdHash1 = null;
    cookieJar = new Map();
    modelsCache = null;
    buildRequestHeaders(extra = {}) {
        const headers = {
            ...FAKE_HEADERS,
            ...extra
        };
        const cookie = serializeCookieJar(this.cookieJar);
        return cookie ? {
            ...headers,
            Cookie: cookie
        } : headers;
    }
    rememberResponseCookies(response) {
        for (const cookie of collectSetCookieHeaders(response.headers)){
            applySetCookie(this.cookieJar, cookie);
        }
    }
    seedBrowserCookies() {
        for (const [name, value] of SEEDED_COOKIES){
            if (!this.cookieJar.has(name)) this.cookieJar.set(name, value);
        }
    }
    async warmFetch(url, headers, signal) {
        try {
            const response = await fetch(url, {
                headers,
                signal
            });
            this.rememberResponseCookies(response);
            return response;
        } catch (error) {
            void error;
            return null;
        }
    }
    async testConnection(_credentials, signal) {
        try {
            const controller = new AbortController();
            const ddgTestMs = FETCH_TIMEOUT_MS;
            const timeout = setTimeout(()=>{
                const err = new Error(`duckduckgo-web testConnection timeout after ${ddgTestMs}ms`);
                err.name = "TimeoutError";
                controller.abort(err);
            }, ddgTestMs);
            const mergedSignal = signal ? AbortSignal.any([
                signal,
                controller.signal
            ]) : controller.signal;
            const resp = await fetch(STATUS_URL, {
                method: "GET",
                headers: this.buildRequestHeaders({
                    Accept: "*/*",
                    "Cache-Control": "no-store",
                    "x-vqd-accept": "1"
                }),
                signal: mergedSignal
            });
            this.rememberResponseCookies(resp);
            clearTimeout(timeout);
            return resp.ok && (resp.headers.get("x-vqd-4") !== null || resp.headers.get("x-vqd-hash-1") !== null);
        } catch  {
            return false;
        }
    }
    async _executeResponse(input) {
        const { model, body, stream, signal, upstreamExtraHeaders } = input;
        const requestedModel = normalizeDuckDuckGoModel(model);
        const bodyObj = body || {};
        const rawMessages = normalizeDuckDuckGoMessages(bodyObj.messages);
        const { hasTools, requestedTools, effectiveMessages } = prepareToolMessages(bodyObj, rawMessages);
        const messages = effectiveMessages;
        const isStreaming = stream !== false;
        const upstreamHeaders = upstreamExtraHeaders || {};
        const errorResponse = (status, message, retryAfter)=>new Response(JSON.stringify({
                error: {
                    message
                }
            }), {
                status,
                headers: {
                    "Content-Type": "application/json",
                    ...retryAfter ? {
                        "Retry-After": retryAfter
                    } : {}
                }
            });
        if (messages.length === 0) {
            return errorResponse(400, "No messages provided");
        }
        if (cbIsOpen()) {
            return errorResponse(503, "DuckDuckGo circuit breaker open — upstream unavailable");
        }
        if (shouldUseBrowserBacked()) {
            const lastUser = [
                ...messages
            ].reverse().find((m)=>m.role === "user");
            const userText = extractDuckDuckGoContent(lastUser ?? {
                content: ""
            });
            const result = await tryBackedChat({
                poolKey: "duckduckgo-web",
                chatPageUrl: "https://duck.ai/chat",
                chatUrl: CHAT_URL,
                chatUrlMatchDomain: "duck.ai",
                userMessage: userText || "Reply with OK",
                inputSelector: "textarea",
                submitButtonSelector: "button[aria-label='Ask']",
                signal: signal ?? null,
                postSubmitWaitMs: 15000
            });
            if (result.status > 0) {
                const upstreamResp = new Response(Buffer.from(result.body), {
                    status: result.status,
                    headers: {
                        "Content-Type": result.contentType || "text/event-stream"
                    }
                });
                return await this.processResponse(upstreamResp, isStreaming, hasTools, requestedTools);
            }
            return errorResponse(502, "Browser-backed chat captured no upstream response");
        }
        const pool = typeof this.getPool === "function" ? this.getPool() : null;
        let session;
        try {
            session = pool ? await pool.acquireBlocking(10_000) : null;
        } catch  {
            session = null;
        }
        const sessionHeaders = session ? session.buildHeaders() : {};
        try {
            const controller = new AbortController();
            const ddgExecMs = FETCH_TIMEOUT_MS;
            const timeout = setTimeout(()=>{
                const err = new Error(`duckduckgo-web execute timeout after ${ddgExecMs}ms`);
                err.name = "TimeoutError";
                controller.abort(err);
            }, ddgExecMs);
            const mergedSignal = signal ? AbortSignal.any([
                signal,
                controller.signal
            ]) : controller.signal;
            let upstreamModel = requestedModel;
            const liveModelIds = await this.getLiveModelIds(mergedSignal);
            if (liveModelIds && !liveModelIds.has(upstreamModel)) {
                const fallbackModel = pickDuckDuckGoModel(upstreamModel, liveModelIds);
                if (fallbackModel !== upstreamModel) {
                    console.warn(`[duckduckgo-web] model "${upstreamModel}" absent from the live duckchat catalog — routing as "${fallbackModel}"`);
                    upstreamModel = fallbackModel;
                }
            }
            const normalizedMessages = normalizeSystemRole(messages, "duckduckgo-web", upstreamModel);
            const sendChat = async (vqdHeaders)=>{
                const payload = buildDuckDuckGoPayload(upstreamModel, normalizedMessages);
                const response = await fetch(CHAT_URL, {
                    method: "POST",
                    headers: mergeHeadersCaseInsensitive(sessionHeaders, this.buildRequestHeaders(), upstreamHeaders, {
                        Accept: "text/event-stream",
                        "Content-Type": "application/json",
                        "x-ddg-journey-id": randomUUID().replaceAll("-", ""),
                        "x-fe-signals": makeDuckDuckGoFeSignals(),
                        "x-fe-version": this.feVersion,
                        ...vqdHeaders.vqd4 ? {
                            "x-vqd-4": vqdHeaders.vqd4
                        } : {},
                        ...vqdHeaders.vqdHash1 ? {
                            "x-vqd-hash-1": vqdHeaders.vqdHash1
                        } : {}
                    }),
                    body: JSON.stringify(payload),
                    signal: mergedSignal
                });
                this.rememberResponseCookies(response);
                this.rememberChallengeHeader(response);
                return response;
            };
            if (mergedSignal.aborted) {
                clearTimeout(timeout);
                return errorResponse(499, "Request cancelled");
            }
            await this.warmSession(mergedSignal);
            const vqdHeaders = await this.acquireAuthHeaders(mergedSignal);
            if (!vqdHeaders.vqd4 && !vqdHeaders.vqdHash1) {
                clearTimeout(timeout);
                if (vqdHeaders.status === 429) {
                    return errorResponse(429, "Failed to acquire VQD token: upstream rate limited", vqdHeaders.retryAfter);
                }
                return errorResponse(503, "Failed to acquire VQD token");
            }
            let chatResponse = await sendChat(vqdHeaders);
            if (chatResponse.status === 418) {
                this.pendingVqdHash1 = null;
                const freshVqd = await this.acquireAuthHeaders(mergedSignal);
                if (freshVqd.vqd4 || freshVqd.vqdHash1) {
                    chatResponse = await sendChat(freshVqd);
                }
            }
            clearTimeout(timeout);
            if (chatResponse.status === 429) {
                if (pool && session) pool.reportCooldown(session);
                cbRecordFailure();
                return await this.processResponse(chatResponse, isStreaming, hasTools, requestedTools);
            }
            if (chatResponse.status === 401 || chatResponse.status === 403) {
                this.pendingVqdHash1 = null;
                const freshVqd = await this.acquireAuthHeaders(mergedSignal);
                if (freshVqd.vqd4 || freshVqd.vqdHash1) {
                    const retryResponse = await sendChat(freshVqd);
                    return await this.processResponse(retryResponse, isStreaming, hasTools, requestedTools);
                }
                return errorResponse(503, "Service unavailable");
            }
            if (chatResponse.status >= 500) {
                if (pool && session) pool.reportDead(session);
                cbRecordFailure();
                return errorResponse(502, "Upstream error");
            }
            const result = await this.processResponse(chatResponse, isStreaming, hasTools, requestedTools);
            if (pool && session) {
                if (chatResponse.status === 429) {
                    pool.reportCooldown(session);
                } else if (chatResponse.status >= 500) {
                    pool.reportDead(session);
                } else {
                    pool.reportSuccess(session);
                }
            }
            cbRecordSuccess();
            return result;
        } catch (error) {
            if (pool && session) {
                pool.reportCooldown(session);
            }
            cbRecordFailure();
            if (error instanceof DOMException && error.name === "AbortError") {
                return errorResponse(499, "Request cancelled");
            }
            return errorResponse(500, sanitizeErrorMessage(error instanceof Error ? error.message : "Unknown error"));
        } finally{
            session?.release();
        }
    }
    async execute(input) {
        const result =
            await this._executeResponse(input);

        if (
            result &&
            typeof result === "object" &&
            "response" in result
        ) {
            return result;
        }

        const response =
            result instanceof Response
                ? result
                : new Response(
                    JSON.stringify({
                        error: {
                            message:
                                "DuckDuckGo executor returned invalid response"
                        }
                    }),
                    {
                        status: 502,
                        headers: {
                            "Content-Type":
                                "application/json"
                        }
                    }
                );

        return {
            response,
            url: CHAT_URL,
            headers: this.buildRequestHeaders({
                "Content-Type":
                    "application/json"
            }),
            transformedBody:
                input?.body ?? null
        };
    }

    async getLiveModelIds(signal) {
        const now = Date.now();
        if (this.modelsCache && now - this.modelsCache.fetchedAt < MODEL_IDS_CACHE_TTL_MS) {
            return this.modelsCache.ids;
        }
        try {
            const resp = await fetch(MODELS_URL, {
                method: "GET",
                headers: this.buildRequestHeaders({
                    Accept: "application/json"
                }),
                signal
            });
            if (!resp.ok) return null;
            const ids = extractFreeDuckDuckGoModelIds(await resp.json());
            if (ids.size === 0) return null;
            this.modelsCache = {
                ids,
                fetchedAt: now
            };
            return ids;
        } catch (error) {
            void error;
            return null;
        }
    }
    async acquireVqdHeaders(signal) {
        try {
            if (signal.aborted) throw new DOMException("Aborted", "AbortError");
            const resp = await fetch(STATUS_URL, {
                method: "GET",
                headers: this.buildRequestHeaders({
                    Accept: "*/*",
                    "Cache-Control": "no-store",
                    "x-vqd-accept": "1"
                }),
                signal
            });
            this.rememberResponseCookies(resp);
            if (!resp.ok) {
                return {
                    vqd4: null,
                    vqdHash1: null,
                    status: resp.status,
                    retryAfter: resp.headers.get("Retry-After")
                };
            }
            return {
                vqd4: resp.headers.get("x-vqd-4"),
                vqdHash1: resp.headers.get("x-vqd-hash-1"),
                status: resp.status,
                retryAfter: null
            };
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                throw error;
            }
            return {
                vqd4: null,
                vqdHash1: null,
                status: null,
                retryAfter: null
            };
        }
    }
    async acquireAuthHeaders(signal) {
        if (this.pendingVqdHash1) {
            const challenge = this.pendingVqdHash1;
            this.pendingVqdHash1 = null;
            try {
                return {
                    vqd4: null,
                    vqdHash1: await solveDuckDuckGoChallenge(challenge, FAKE_HEADERS["User-Agent"]),
                    status: null,
                    retryAfter: null
                };
            } catch (error) {
                void error;
            }
        }
        const headers = await this.acquireVqdHeaders(signal);
        if (headers.vqdHash1) {
            try {
                return {
                    vqd4: headers.vqd4,
                    vqdHash1: await solveDuckDuckGoChallenge(headers.vqdHash1, FAKE_HEADERS["User-Agent"]),
                    status: headers.status,
                    retryAfter: headers.retryAfter
                };
            } catch (error) {
                void error;
                const retry = await this.acquireVqdHeaders(signal);
                if (retry.vqdHash1) {
                    try {
                        return {
                            vqd4: retry.vqd4,
                            vqdHash1: await solveDuckDuckGoChallenge(retry.vqdHash1, FAKE_HEADERS["User-Agent"]),
                            status: retry.status,
                            retryAfter: retry.retryAfter
                        };
                    } catch (retryError) {
                        void retryError;
                    }
                }
                return {
                    vqd4: retry.vqd4 ?? headers.vqd4,
                    vqdHash1: null,
                    status: retry.status ?? headers.status,
                    retryAfter: retry.retryAfter ?? headers.retryAfter
                };
            }
        }
        return headers;
    }
    rememberChallengeHeader(response) {
        const nextHash = response.headers.get("x-vqd-hash-1");
        if (nextHash) this.pendingVqdHash1 = nextHash;
    }
    async warmSession(signal) {
        if (this.warmed || signal.aborted) return;
        this.warmed = true;
        this.seedBrowserCookies();
        const homepageResponse = await this.warmFetch(`${DUCKDUCKGO_BASE}/`, this.buildRequestHeaders({
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Upgrade-Insecure-Requests": "1"
        }), signal);
        if (homepageResponse) {
            try {
                const homepageHtml = await homepageResponse.clone().text();
                const feVersion = extractDuckDuckGoFeVersion(homepageHtml);
                if (feVersion) this.feVersion = feVersion;
            } catch (error) {
                void error;
            }
        }
        await this.warmFetch(COUNTRY_URL, this.buildRequestHeaders({
            Accept: "*/*"
        }), signal);
        await this.warmFetch(AUTH_TOKEN_URL, this.buildRequestHeaders({
            Accept: "*/*"
        }), signal);
        await this.warmFetch(`${DUCKDUCKGO_BASE}/?q=DuckDuckGo+AI+Chat&ia=chat&duckai=1`, this.buildRequestHeaders({
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Origin: DUCKDUCKGO_BASE,
            Referer: `${DUCKDUCKGO_BASE}/`,
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Upgrade-Insecure-Requests": "1"
        }), signal);
    }
    async processResponse(response, streaming, hasTools, requestedTools) {
        if (!response.ok) {
            const body = await response.text();
            return new Response(JSON.stringify({
                error: {
                    message: normalizeDuckDuckGoError(response.status, body)
                }
            }), {
                status: response.status,
                headers: {
                    "Content-Type": "application/json"
                }
            });
        }
        if (streaming) {
            if (!response.body) {
                return new Response(JSON.stringify({
                    error: {
                        message: "No response body"
                    }
                }), {
                    status: 500,
                    headers: {
                        "Content-Type": "application/json"
                    }
                });
            }
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            let pendingLine = "";
            const enqueueLine = (line, controller)=>{
                const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
                if (!normalizedLine.trim()) return;
                if (normalizedLine === "[DONE]") {
                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                    return;
                }
                const data = parseDuckDuckGoDataLine(normalizedLine);
                const content = extractDuckDuckGoContent(data);
                if (content) {
                    const openaiFormat = {
                        choices: [
                            {
                                delta: {
                                    content
                                },
                                index: 0
                            }
                        ]
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(openaiFormat)}\n\n`));
                }
            };
            const transformStream = new TransformStream({
                transform (chunk, controller) {
                    const lines = `${pendingLine}${decoder.decode(chunk, {
                        stream: true
                    })}`.split("\n");
                    pendingLine = lines.pop() ?? "";
                    for (const line of lines)enqueueLine(line, controller);
                },
                flush (controller) {
                    pendingLine += decoder.decode();
                    if (pendingLine) enqueueLine(pendingLine, controller);
                }
            });
            const transformedBody = response.body.pipeThrough(transformStream);
            return new Response(transformedBody, {
                headers: {
                    "Content-Type": "text/event-stream"
                }
            });
        } else {
            const text = await response.text();
            let fullContent = "";
            const lines = text.split("\n");
            for (const line of lines){
                if (!line.trim() || line === "[DONE]") continue;
                fullContent += extractDuckDuckGoContent(parseDuckDuckGoDataLine(line));
            }
            const openaiResponse = hasTools ? (()=>{
                const { content, toolCalls, finishReason } = buildToolAwareResult(fullContent, requestedTools, "ddg");
                const message = {
                    role: "assistant",
                    content
                };
                if (toolCalls) {
                    message.tool_calls = toolCalls;
                    message.content = null;
                }
                return {
                    choices: [
                        {
                            index: 0,
                            message,
                            finish_reason: finishReason
                        }
                    ]
                };
            })() : {
                choices: [
                    {
                        message: {
                            content: fullContent,
                            role: "assistant"
                        },
                        index: 0,
                        finish_reason: "stop"
                    }
                ]
            };
            return new Response(JSON.stringify(openaiResponse), {
                headers: {
                    "Content-Type": "application/json"
                }
            });
        }
    }
}
export const duckduckgoWebExecutor = new DuckDuckGoWebExecutor();
