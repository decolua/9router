import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { createFreebuffChat, fetchWithNetworkRetry, freebuffRetryConfig } from "./freebuffTransport.js";
import { clearPoolLimitedCooldown, ensureSession, finishRun, gateFromText, preflight, pruneSessionState, requestSession, resetSessionCache, sessionFailureHandler, sessionStateSize, SESSION_STALE_CODES, startRun } from "./freebuffSession.js";
import { clearPoolUnfit } from "../services/proxyPoolFitness.js";
import { selectedFreebuffPoolId } from "./freebuffProxyFitness.js";
const MARKER = "You are Buffy, the strategic coding assistant.";
const AGENTS = { "deepseek/deepseek-v4-flash": "base3-free-deepseek-flash", "deepseek/deepseek-v4-pro": "base3-free-deepseek", "mimo/mimo-v2.5": "base3-free-mimo", "minimax/minimax-m3": "base3-free-minimax-m3", "openai/gpt-5.6-luna": "base3-free-luna" };
const END = { type: "function", function: { name: "end_turn", description: "Signal the end of the current task.", parameters: { type: "object", properties: {} } } };
function rootAgentIdForModel(model) { return AGENTS[model] || "base2-free"; }
function injectFreebuffMarker(body) { const first = body?.messages?.[0]; if (first?.role === "system" && typeof first.content === "string" && first.content.trimStart().startsWith(MARKER)) return body; return { ...body, messages: first?.role === "system" ? [{ ...first, content: `${MARKER}\n\n${first.content}` }, ...body.messages.slice(1)] : [{ role: "system", content: MARKER }, ...(body?.messages || [])] }; }
function injectEndTurnTool(body) { return !Array.isArray(body?.tools) || !body.tools.length || body.tools.some((tool) => tool?.function?.name === "end_turn") ? body : { ...body, tools: [...body.tools, END] }; }
export { resetSessionCache, sessionStateSize, pruneSessionState };
export class FreebuffExecutor extends BaseExecutor {
  constructor() { super("freebuff", PROVIDERS.freebuff); }
  buildUrl() { return this.config.baseUrl; }
  parseError(response, bodyText) { const text = String(bodyText || ""); return response?.status === 404 && /No endpoints found/i.test(text) ? { status: 404, message: `Freebuff upstream rejected the request (404: "${text.trim().slice(0, 90)}").`, resetsAtMs: Date.now() + 120_000 } : super.parseError(response, bodyText); }
  transformRequest(model, body, stream, credentials) { body.codebuff_metadata = { client_id: credentials?.providerSpecificData?.fingerprintId || `9router-${crypto.randomUUID()}`, cost_mode: "free" }; body.provider = { allow_fallbacks: false }; delete body.reasoning_effort; delete body.reasoning; return injectEndTurnTool(injectFreebuffMarker(body)); }
  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const token = credentials?.accessToken; if (!token) throw new Error("Freebuff requires a connected Freebuff login (no access token found)");
    const poolId = selectedFreebuffPoolId(proxyOptions); await preflight(token, model, proxyOptions, poolId); const handleSessionFailure = sessionFailureHandler({ token, model, proxyOptions, log });
    let session; try { session = await ensureSession(token, model, proxyOptions); } catch (error) { return handleSessionFailure(error, signal); }
    let runId = null; let activeRunId = null; const traceSessionId = crypto.randomUUID();
    const buildBody = () => { const transformed = this.transformRequest(model, body, stream, credentials); transformed.codebuff_metadata.run_id = runId; transformed.codebuff_metadata.trace_session_id = traceSessionId; if (session?.instanceId) transformed.codebuff_metadata.freebuff_instance_id = session.instanceId; return transformed; };
    const doChat = createFreebuffChat({ buildBody, url: this.buildUrl(), headers: this.buildHeaders(credentials, stream), proxyOptions, model, signal, timeoutMs: this.config?.timeoutMs, retryConfig: freebuffRetryConfig(this.config) });
    const finish = (status) => { if (activeRunId) { const id = activeRunId; activeRunId = null; finishRun(token, id, status, proxyOptions); } };
    try { runId = await startRun(token, proxyOptions, rootAgentIdForModel(model)); activeRunId = runId; let result = await doChat(); if (SESSION_STALE_CODES.has(result.response.status)) { const gate = gateFromText(await result.response.text().catch(() => "")); if (gate.kind !== "stale") { finish("cancelled"); return handleSessionFailure(new Error(JSON.stringify({ error: gate.kind === "limited_ip" ? "session_model_mismatch" : "model_locked", message: gate.kind === "limited_ip" ? "limited IP" : "", currentModel: gate.currentModel })), signal); } finish("cancelled"); try { session = await ensureSession(token, model, proxyOptions, true); runId = await startRun(token, proxyOptions, rootAgentIdForModel(model)); activeRunId = runId; } catch (error) { return handleSessionFailure(error, signal); } result = await doChat(); } finish(result.response.ok ? "completed" : "failed"); const observed = credentials?._observedPoolFitness; if (result.response.ok && observed?.poolId === poolId && observed.scope === `freebuff::${model}` && Number.isInteger(observed.version) && await clearPoolUnfit(observed.poolId, observed.scope, observed.version)) clearPoolLimitedCooldown(model, proxyOptions); return { ...result, url: this.buildUrl(), headers: this.buildHeaders(credentials, stream) }; } finally { if (activeRunId) finishRun(token, activeRunId, "failed", proxyOptions); }
  }
}
export const __test__ = { ensureSession, requestSession, startRun, resetSessionCache, rootAgentIdForModel, injectFreebuffMarker, injectEndTurnTool, fetchWithNetworkRetry, FREEBUFF_SYSTEM_MARKER: MARKER, SESSION_STALE_CODES };
export default FreebuffExecutor;
