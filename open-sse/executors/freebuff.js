import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { FETCH_CONNECT_TIMEOUT_MS, DEFAULT_RETRY_CONFIG, resolveRetryEntry } from "../config/runtimeConfig.js";
import { markPoolUnfit, clearPoolUnfit } from "../services/proxyPoolFitness.js";

const SESSION_PATH = "/api/v1/freebuff/session";
const RUN_PATH = "/api/v1/agent-runs";
const SESSION_DEFAULT_TTL_MS = 60 * 60 * 1000;
const SESSION_STALE_CODES = new Set([428, 409, 410]);
const FREEBUFF_SYSTEM_MARKER = "You are Buffy, the strategic coding assistant.";
const FREEBUFF_ROOT_SYSTEM_OPENINGS = [
  FREEBUFF_SYSTEM_MARKER,
  "You are Buffy, the Freebuff Cloud project planner.",
  "You are Buffy, a strategic assistant that orchestrates complex coding tasks through specialized sub-agents.",
];
const END_TURN_TOOL = {
  type: "function",
  function: { name: "end_turn", description: "Signal the end of the current task.", parameters: { type: "object", properties: {} } },
};
const FREE_ROOT_AGENT_BY_MODEL = {
  "deepseek/deepseek-v4-flash": "base3-free-deepseek-flash",
  "deepseek/deepseek-v4-pro": "base3-free-deepseek",
  "mimo/mimo-v2.5": "base3-free-mimo",
  "minimax/minimax-m3": "base3-free-minimax-m3",
  "openai/gpt-5.6-luna": "base3-free-luna",
};
const FB_STATE_KEY = "__9routerFreebuffState__";
const fbState = (globalThis[FB_STATE_KEY] ??= {
  sessionCache: new Map(),
  inflight: new Map(),
  modelLockCooldowns: new Map(),
  poolLimitCooldowns: new Map(),
});
const { sessionCache, inflight, modelLockCooldowns, poolLimitCooldowns } = fbState;
const MODEL_LOCK_COOLDOWN_MS = 10 * 60 * 1000;
const POOL_LIMITED_COOLDOWN_MS = 5 * 60 * 1000;

function injectFreebuffMarker(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return body;
  const first = messages[0];
  if (first?.role === "system" && typeof first.content === "string") {
    if (FREEBUFF_ROOT_SYSTEM_OPENINGS.some((opening) => first.content.trimStart().startsWith(opening))) return body;
    return { ...body, messages: [{ ...first, content: `${FREEBUFF_SYSTEM_MARKER}\n\n${first.content}` }, ...messages.slice(1)] };
  }
  return { ...body, messages: [{ role: "system", content: FREEBUFF_SYSTEM_MARKER }, ...messages] };
}

function injectEndTurnTool(body) {
  if (!Array.isArray(body?.tools) || body.tools.length === 0) return body;
  if (body.tools.some((tool) => tool?.function?.name === "end_turn")) return body;
  return { ...body, tools: [...body.tools, END_TURN_TOOL] };
}

function setCooldown(map, key, until) {
  const now = Date.now();
  for (const [currentKey, currentUntil] of map) if (currentUntil <= now) map.delete(currentKey);
  map.set(key, until);
}

function getCooldown(map, key) {
  const until = map.get(key);
  if (until == null) return null;
  if (until <= Date.now()) {
    map.delete(key);
    return null;
  }
  return until;
}

function proxyKeyOf(proxyOptions) {
  return proxyOptions?.vercelRelayUrl || proxyOptions?.connectionProxyUrl || "direct";
}

function classifySessionGate(code, message, currentModel) {
  if (code === "session_superseded") return { kind: "superseded" };
  if (code === "model_locked") return { kind: "model_locked", currentModel };
  if (code === "session_model_mismatch") return /limited/i.test(String(message || "")) ? { kind: "limited_ip" } : { kind: "model_locked", currentModel };
  return { kind: "stale" };
}

function sessionGateFromText(text) {
  try {
    const parsed = JSON.parse(String(text || ""));
    return classifySessionGate(parsed.error || parsed.error_type || "", parsed.message || "", parsed.currentModel || null);
  } catch {
    return { kind: "stale" };
  }
}

function sessionGateFromError(error) {
  const message = String(error?.message || "");
  const start = message.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(message.slice(start));
    return classifySessionGate(parsed.error || parsed.error_type || parsed.status || "", parsed.message || "", parsed.currentModel || null);
  } catch {
    return null;
  }
}

async function throwSessionGateError(gate, context) {
  const { token, model, proxyKey, poolId, log } = context;
  if (gate.kind === "model_locked") {
    const until = Date.now() + MODEL_LOCK_COOLDOWN_MS;
    setCooldown(modelLockCooldowns, `${token}::${model}`, until);
    const error = new Error(`Freebuff session is locked to ${gate.currentModel ? `"${gate.currentModel}"` : "another model"} — it cannot serve ${model}. End the session on freebuff.com or wait for it to expire (~1h).`);
    error.status = 409;
    error.resetsAtMs = until;
    log?.warn?.("AUTH", "Freebuff model_locked");
    throw error;
  }
  if (gate.kind === "limited_ip") {
    const until = Date.now() + POOL_LIMITED_COOLDOWN_MS;
    setCooldown(poolLimitCooldowns, `${proxyKey}::${model}`, until);
    const scope = `freebuff::${model}`;
    if (poolId) await markPoolUnfit(poolId, scope, until, "limited_ip");
    const error = new Error(`Freebuff limited-mode IP rejected ${model} — this IP only allows DeepSeek V4 Flash / MiMo 2.5. Use a full-access proxy or a different model.`);
    error.status = 409;
    error.poolScoped = { poolId, scope, reason: "limited_ip" };
    log?.warn?.("AUTH", "Freebuff limited IP");
    throw error;
  }
}

function sessionOrigin() { return new URL(PROVIDERS.freebuff.baseUrl).origin; }
function sessionCacheKey(token, model) { return `${token}::${model}`; }
function rootAgentIdForModel(model) { return FREE_ROOT_AGENT_BY_MODEL[model] || "base2-free"; }

async function fetchWithNetworkRetry(url, options, proxyOptions, attempts = 3, timeoutMs = FETCH_CONNECT_TIMEOUT_MS) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await proxyAwareFetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }, proxyOptions);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

async function requestSession(token, model, proxyOptions) {
  const response = await fetchWithNetworkRetry(`${sessionOrigin()}${SESSION_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": "codebuff-cli/0.0.138", "x-freebuff-model": model },
  }, proxyOptions);
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    const error = new Error("Freebuff session auth failed (401) — re-login in the dashboard");
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`Freebuff session request failed: ${response.status} ${JSON.stringify(data).slice(0, 200)}`);
    error.status = response.status;
    throw error;
  }
  if (data.status === "active") {
    const parsedExpiry = Date.parse(data.expiresAt || "");
    const entry = { instanceId: data.instanceId, expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + SESSION_DEFAULT_TTL_MS };
    sessionCache.set(sessionCacheKey(token, model), entry);
    return { instanceId: data.instanceId, status: "active" };
  }
  if (data.status === "none") return { instanceId: null, status: "none" };
  if (data.status === "model_locked") {
    const payload = { error: "model_locked", message: data.message || "", currentModel: data.currentModel || null };
    const message = "Freebuff session is locked to another model — end it in the CLI or wait for it to expire.";
    throw new Error(`${data.message ? `${message} ${data.message}` : message} ${JSON.stringify(payload)}`);
  }
  const messages = {
    country_blocked: "Freebuff is not available in your region (country blocked).",
    banned: "Your Freebuff account has been banned.",
    ip_capped: "Freebuff IP cap reached — try again later.",
    rate_limited: "Freebuff session limit reached for this model — try again later.",
    spend_limited: "Freebuff spend limit reached — add credits or wait for the window to reset.",
    model_unavailable: "This model is not available on Freebuff right now.",
    premium_slot_taken: "Freebuff premium slot is taken — try another model.",
  };
  if (messages[data.status]) throw new Error(data.message ? `${messages[data.status]} ${data.message}` : messages[data.status]);
  throw new Error(`Freebuff session rejected (${data.status || response.status}): ${JSON.stringify(data).slice(0, 200)}`);
}

async function ensureSession(token, model, proxyOptions, force = false) {
  const key = sessionCacheKey(token, model);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt <= Date.now()) sessionCache.delete(key);
  if (!force && cached && cached.expiresAt > Date.now()) return { instanceId: cached.instanceId, status: "active" };
  if (force) {
    sessionCache.delete(key);
    inflight.delete(key);
    return requestSession(token, model, proxyOptions);
  }
  if (!inflight.has(key)) inflight.set(key, requestSession(token, model, proxyOptions).finally(() => inflight.delete(key)));
  return inflight.get(key);
}

async function startRun(token, model, proxyOptions) {
  const response = await fetchWithNetworkRetry(`${sessionOrigin()}${RUN_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": "codebuff-cli/0.0.138" },
    body: JSON.stringify({ action: "START", agentId: rootAgentIdForModel(model), ancestorRunIds: [] }),
  }, proxyOptions);
  const text = await response.text().catch(() => "");
  let data = {};
  try { data = JSON.parse(text); } catch { data = {}; }
  if (response.status === 401) {
    const error = new Error("Freebuff run auth failed (401) — re-login in the dashboard");
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`Freebuff run start failed: ${response.status} ${text.slice(0, 200)}`);
    error.status = response.status;
    throw error;
  }
  if (!data.runId) throw new Error(`Freebuff run start returned no runId: ${text.slice(0, 200)}`);
  return data.runId;
}

async function finishRun(token, runId, status, proxyOptions) {
  if (!runId) return;
  try {
    await proxyAwareFetch(`${sessionOrigin()}${RUN_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": "codebuff-cli/0.0.138" },
      body: JSON.stringify({ action: "FINISH", runId, status }),
      signal: AbortSignal.timeout(10_000),
    }, proxyOptions);
  } catch {}
}

export function resetSessionCache() { sessionCache.clear(); inflight.clear(); }
export function sessionStateSize() { return { sessions: sessionCache.size, inflight: inflight.size, modelLocks: modelLockCooldowns.size, poolLimits: poolLimitCooldowns.size }; }
export function pruneSessionState(now = Date.now()) {
  let removed = 0;
  for (const [key, entry] of sessionCache) if (entry?.expiresAt && entry.expiresAt <= now) { sessionCache.delete(key); removed += 1; }
  for (const map of [modelLockCooldowns, poolLimitCooldowns]) for (const [key, until] of map) if (until <= now) { map.delete(key); removed += 1; }
  return removed;
}

export class FreebuffExecutor extends BaseExecutor {
  constructor() { super("freebuff", PROVIDERS.freebuff); }
  buildUrl() { return this.config.baseUrl; }
  parseError(response, bodyText) {
    const text = String(bodyText || "");
    if (response?.status === 404 && /No endpoints found/i.test(text)) return { status: 404, message: `Freebuff upstream rejected the request (404: "${text.trim().slice(0, 90)}"). Tool-calling requests need the CLI's end_turn tool — retry; if it persists the Codebuff backend may be having trouble.`, resetsAtMs: Date.now() + 120_000 };
    return super.parseError(response, bodyText);
  }
  transformRequest(model, body, stream, credentials) {
    body.codebuff_metadata = { client_id: credentials?.providerSpecificData?.fingerprintId || `9router-${crypto.randomUUID()}`, cost_mode: "free" };
    body.provider = { allow_fallbacks: false };
    delete body.reasoning_effort;
    delete body.reasoning;
    return injectEndTurnTool(injectFreebuffMarker(body));
  }
  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const token = credentials?.accessToken;
    if (!token) throw new Error("Freebuff requires a connected Freebuff login (no access token found)");
    const proxyKey = proxyKeyOf(proxyOptions);
    const poolId = proxyOptions?.proxyPoolId || null;
    const scope = `freebuff::${model}`;
    const lockUntil = getCooldown(modelLockCooldowns, `${token}::${model}`);
    if (lockUntil) { const error = new Error(`Freebuff session locked to another model — retry after ${new Date(lockUntil).toLocaleTimeString()}`); error.status = 409; error.resetsAtMs = lockUntil; throw error; }
    const poolUntil = getCooldown(poolLimitCooldowns, `${proxyKey}::${model}`);
    if (poolUntil) { const error = new Error(`Freebuff limited-mode IP rejected ${model} — retry with a full-access proxy after ${new Date(poolUntil).toLocaleTimeString()}`); error.status = 409; error.poolScoped = { poolId, scope, reason: "limited_ip" }; throw error; }
    let session;
    try { session = await ensureSession(token, model, proxyOptions); } catch (error) { const gate = sessionGateFromError(error); if (gate) await throwSessionGateError(gate, { token, model, proxyKey, poolId, log }); throw error; }
    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials, stream);
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    let runId = null;
    const traceSessionId = crypto.randomUUID();
    const buildBody = () => {
      const transformed = this.transformRequest(model, body, stream, credentials);
      transformed.codebuff_metadata.run_id = runId;
      transformed.codebuff_metadata.trace_session_id = traceSessionId;
      if (session?.instanceId) transformed.codebuff_metadata.freebuff_instance_id = session.instanceId;
      return transformed;
    };
    const doChat = async () => {
      let networkAttempts = 0;
      for (let attempt = 0; ; attempt += 1) {
        const transformedBody = buildBody();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error("fetch connect timeout")), this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS);
        const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        let response;
        try { response = await proxyAwareFetch(url, { method: "POST", headers, body: JSON.stringify(transformedBody), signal: mergedSignal }, proxyOptions); }
        catch (error) {
          if (error?.name === "AbortError" || networkAttempts >= 2) throw error;
          networkAttempts += 1;
          await new Promise((resolve) => setTimeout(resolve, 750));
          continue;
        } finally { clearTimeout(timer); }
        const retry = resolveRetryEntry(retryConfig[response.status]);
        if (retry && attempt < retry.attempts) { await new Promise((resolve) => setTimeout(resolve, retry.delayMs)); continue; }
        return { response, transformedBody };
      }
    };
    let activeRunId = null;
    const markFinished = (status) => { if (!activeRunId) return; const id = activeRunId; activeRunId = null; finishRun(token, id, status, proxyOptions); };
    try {
      runId = await startRun(token, model, proxyOptions);
      activeRunId = runId;
      let { response, transformedBody } = await doChat();
      if (SESSION_STALE_CODES.has(response.status)) {
        const gate = sessionGateFromText(await response.text().catch(() => ""));
        if (gate.kind === "model_locked" || gate.kind === "limited_ip") { markFinished("cancelled"); await throwSessionGateError(gate, { token, model, proxyKey, poolId, log }); }
        markFinished("cancelled");
        try { session = await ensureSession(token, model, proxyOptions, true); runId = await startRun(token, model, proxyOptions); activeRunId = runId; }
        catch (error) { const gate2 = sessionGateFromError(error); if (gate2) await throwSessionGateError(gate2, { token, model, proxyKey, poolId, log }); throw error; }
        ({ response, transformedBody } = await doChat());
        if (SESSION_STALE_CODES.has(response.status)) {
          const gate3 = sessionGateFromText(await response.text().catch(() => ""));
          if (gate3.kind === "model_locked" || gate3.kind === "limited_ip") await throwSessionGateError(gate3, { token, model, proxyKey, poolId, log });
          const error = new Error(`Freebuff session gate refused (${response.status}) — another freebuff instance may be holding the session.`);
          error.status = response.status;
          throw error;
        }
      }
      if (response.ok) { modelLockCooldowns.delete(`${token}::${model}`); poolLimitCooldowns.delete(`${proxyKey}::${model}`); if (poolId) await clearPoolUnfit(poolId, scope); }
      if (response.status === 401) { sessionCache.delete(sessionCacheKey(token, model)); const error = new Error("Freebuff auth failed (401) — re-login in the dashboard."); error.status = 401; throw error; }
      markFinished(response.ok ? "completed" : "failed");
      return { response, url, headers, transformedBody };
    } finally { if (activeRunId) finishRun(token, activeRunId, "failed", proxyOptions); }
  }
}

export const __test__ = { ensureSession, requestSession, startRun, resetSessionCache, rootAgentIdForModel, injectFreebuffMarker, injectEndTurnTool, fetchWithNetworkRetry, FREEBUFF_SYSTEM_MARKER, SESSION_STALE_CODES };
export default FreebuffExecutor;
