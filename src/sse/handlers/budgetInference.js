import { BUDGET_ENDPOINT } from "@/shared/utils/keyBudget.js";
import { budgetRequest, budgetJson, budgetStreamRenderer } from "../services/budgetFormats.js";
import { handleChat } from "./chat.js";
import { inferenceRoute } from "@/lib/observability/inferenceRoute.js";
import { currentInference, bindInference, noteAttempt } from "@/lib/observability/requestContext.js";
import { observeConnection } from "@/lib/observability/providerHealth.js";
import { reportedReset, classifyInferenceError } from "open-sse/services/inferenceError.js";
import { BUDGET_REQUEST_TIMEOUT_MS, getBudgetLedger, getSettings, saveRequestUsage, validBudgetUsage } from "@/lib/db/index.js";
import { getExecutor } from "open-sse/executors/index.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { getProviderCredentials, markAccountUnavailable, clearAccountError } from "../services/auth.js";
import { readRequestKey } from "../services/requestKey.js";
import { extractClientApiKey, keyAccessForRecord, enforceKeyAccessResolved } from "../services/keyAccess.js";
import { getModelInfo } from "../services/model.js";
import { meteredStream } from "../services/budgetResponse.js";

const fail = (status, error, headers = {}) => Response.json({ error }, { status, headers });
async function errorPreview(body) {
  if (!body) return "";
  const reader = body.getReader();
  try {
    const { value } = await reader.read();
    return new TextDecoder().decode(value?.subarray(0, 4096));
  } catch { return ""; }
  finally { void reader.cancel().catch(() => {}); }
}

const budgetErrorMessages = {
  key_request_limit: "API key request limit exceeded",
  quota_storage_unavailable: "Quota storage unavailable", invalid_reservation: "Invalid budget reservation",
  request_exceeds_tpm_limit: "This request exceeds the key's entire token allowance for one minute",
  duplicate_reservation: "Duplicate reservation", key_policy_changed: "Key policy changed",
  model_budget_overrun: "Provider exceeded the configured model budget", insufficient_key_budget: "Insufficient remaining key budget",
  key_tpm_limit: "Token limit for this minute reached", key_concurrency_limit: "Concurrent request limit reached",
};
// Outermost route owns correlation and the ordinary, unmetered fallback.
export function chatInferenceRoute(endpoint) {
  return inferenceRoute(async request => (await dispatchBudget(request, endpoint)) ?? handleChat(request));
}

async function dispatchBudget(request, endpoint) {
  const key = extractClientApiKey(request);
  if (!key) return null;
  const record = await readRequestKey(request);
  if (!record) return fail(401, "Invalid API key");
  const policy = record.budget;
  if (!policy) return null;
  let body;
  try { body = await request.json(); } catch { return fail(400, "Invalid JSON"); }
  const outbound = budgetRequest(endpoint, body);
  if (!outbound) {
    const cap = endpoint === BUDGET_ENDPOINT.RESPONSES ? "max_output_tokens" : "max_tokens";
    return fail(400, `Budgeted inference requires text messages and an explicit positive ${cap}`);
  }
  if (!body.model.includes("/")) return fail(403, "Budget requires a single provider/model");
  const { model, provider } = await getModelInfo(body.model);
  if (model !== policy.model || provider !== policy.provider) return fail(403, "Model outside key budget");
  const denied = await enforceKeyAccessResolved(keyAccessForRecord(record), body.model, provider, model);
  if (denied) return denied;
  const excluded = new Set();
  const select = () => getProviderCredentials(provider, excluded, model, { reserveSelection: true });
  let creds = await select();
  if (!creds || creds.allRateLimited) return fail(503, "No available provider connection");
  const supported = c => c?.providerSpecificData?.apiType === "chat" && c.providerSpecificData.baseUrl && c.apiKey && !c.providerSpecificData.vercelRelayUrl;
  let streaming = false;
  try {
    if (!supported(creds)) return fail(422, "Unsupported budgeted transport");
    const exec = getExecutor(provider);
    const settings = await getSettings();
    outbound.model = model;
    const ledger = await getBudgetLedger();
    const trace = currentInference();
    const { requestId } = trace;
    trace.apiKey = key;
    if (request.signal.aborted) return fail(499, "Client disconnected");
    const admittedAt = Date.now();
    const admission = ledger.reserve(requestId, record.id, policy, outbound.max_tokens, admittedAt, record);
    if (admission.status !== 200) {
      const headers = { "cache-control": "no-store" };
      if (admission.retryAfter) headers["retry-after"] = String(admission.retryAfter);
      return Response.json({ error: budgetErrorMessages[admission.code], code: admission.code, windows: admission.windows }, { status: admission.status, headers });
    }
    const remainingMs = Math.max(0, admittedAt + BUDGET_REQUEST_TIMEOUT_MS - Date.now());
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(remainingMs)]);
    let finished = false;
    function finish(usage) {
      if (finished) return;
      finished = true;
      creds.releaseSelection?.();
      signal.removeEventListener("abort", onAbort);
      if (!ledger.settle(requestId, usage)) return;
      if (validBudgetUsage(usage)) {
        const actualMicros = ledger.actualMicros(requestId);
        void saveRequestUsage({ settledCost: actualMicros / 1e6, settledPricing: { source: "user", version: policy.tariffDate },
          provider, model, connectionId: creds.connectionId, apiKey: key,
          tokens: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens }, endpoint, status: "ok" });
      } else if (trace.deferredUsage) {
        trace.failure ??= classifyInferenceError({ error: signal.reason });
        void saveRequestUsage({ provider, model, connectionId: creds.connectionId, apiKey: key, endpoint, status: "error" });
      }
    }
    const onAbort = bindInference(() => finish(null));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const responseHeaders = { "x-request-id": requestId, "cache-control": "no-store" };
      let upstream;
      while (true) {
        signal.throwIfAborted();
        const opts = creds.providerSpecificData;
        const url = exec.buildUrl(model, !!body.stream, 0, creds);
        const headers = { ...exec.buildHeaders(creds, !!body.stream, url, model, outbound), ...settings.providerOverrides?.[provider]?.headers };
        noteAttempt(provider, model, creds.connectionId);
        upstream = await proxyAwareFetch(url, { method: "POST", body: JSON.stringify(outbound),
          headers, signal, singleAttempt: true, redirect: "error", cache: "no-store" },
          { ...opts, proxyPoolId: opts.connectionProxyPoolId });
        if (upstream.ok) break;

        const message = await errorPreview(upstream.body);
        trace.failure = classifyInferenceError({ status: upstream.status, headers: upstream.headers, body: message });
        const resetAt = [429, 503].includes(upstream.status) ? Date.parse(reportedReset(upstream.headers)) : null;
        await markAccountUnavailable(creds.connectionId, upstream.status, "Metered provider request failed",
          provider, upstream.status === 429 && resetAt ? null : model, resetAt, !!resetAt);
        await observeConnection(creds.connectionId, trace.failure);
        // Only explicit pre-generation rejection can reuse the admission. A 5xx,
        // timeout or truncated body may already have consumed the reserved budget.
        if (!signal.aborted && [401, 429].includes(upstream.status)) {
          excluded.add(creds.connectionId);
          creds.releaseSelection?.();
          const next = await select();
          if (supported(next) && !excluded.has(next.connectionId)) {
            creds = next;
            continue;
          }
          next?.releaseSelection?.();
        }
        finish(null);
        const retry = upstream.headers.get("retry-after");
        if (retry) responseHeaders["retry-after"] = retry;
        return fail(upstream.status, "Provider request failed", responseHeaders);
      }
      await observeConnection(creds.connectionId);
      await clearAccountError(creds.connectionId, creds, model);
      const type = upstream.headers.get("content-type") || "";
      if (body.stream && upstream.body && type.startsWith("text/event-stream")) {
        trace.deferredUsage = true;
        streaming = true;
        return new Response(meteredStream(upstream.body, bindInference(finish), budgetStreamRenderer(endpoint)), { headers: { ...responseHeaders, "content-type": "text/event-stream" } });
      }
      if (!body.stream && type.startsWith("application/json")) {
        const json = await upstream.json();
        finish(json.usage);
        return Response.json(budgetJson(endpoint, json), { headers: responseHeaders });
      }
      await upstream.body?.cancel();
      finish(null);
      return fail(502, "Unexpected provider response format", responseHeaders);
    } catch (error) {
      trace.failure = classifyInferenceError({ status: 502, error });
      await observeConnection(creds.connectionId, trace.failure);
      finish(null);
      return fail(502, "Provider request did not complete", { "x-request-id": requestId });
    }
  } finally {
    if (!streaming) creds.releaseSelection?.();
  }
}
