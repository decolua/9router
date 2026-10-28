/**
 * HTTP client for the 9router gateway, seen from the ACP agent.
 *
 * Everything goes through the running gateway (health, model list, chat
 * completions) so the agent inherits routing, RTK token saving, quota-aware
 * fallback and usage tracking instead of talking to providers directly.
 */

const { SseParser } = require("./sse");
const { redact } = require("../log");

const DEFAULT_BASE = process.env.NINE_ROUTER_URL || "http://127.0.0.1:20128";
const STALL_TIMEOUT_MS = 120000;
const HEALTH_TIMEOUT_MS = 2000;
const MODELS_TTL_MS = 60000;

function linkSignals(external) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(external?.reason);
  if (external) {
    if (external.aborted) ctrl.abort(external.reason);
    else external.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    abort: (reason) => ctrl.abort(reason),
    dispose: () => external?.removeEventListener("abort", onAbort),
  };
}

class GatewayError extends Error {
  constructor(message, { status, retryable = false } = {}) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.retryable = retryable;
  }
}

class GatewayClient {
  constructor({ baseUrl = DEFAULT_BASE, apiKey = null, log = () => {} } = {}) {
    this.baseUrl = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.log = log;
    this._models = null;
    this._modelsAt = 0;
  }

  headers(extra = {}) {
    const h = { Accept: "application/json", ...extra };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async probe(timeoutMs = HEALTH_TIMEOUT_MS) {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async _json(pathname, { method = "GET", body, timeoutMs = 15000, signal } = {}) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}${pathname}`, {
        method,
        headers: this.headers(body ? { "Content-Type": "application/json" } : {}),
        body: body ? JSON.stringify(body) : undefined,
        signal: signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === "AbortError" || err?.name === "TimeoutError") throw err;
      throw new GatewayError(`Cannot reach 9router gateway at ${this.baseUrl}: ${err?.cause?.code || err.message}`, { retryable: true });
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const msg = redact(data?.error?.message || data?.error || text.slice(0, 300) || res.statusText);
      throw new GatewayError(`Gateway ${pathname} failed (${res.status}): ${msg}`, { status: res.status, retryable: res.status >= 500 });
    }
    return data;
  }

  /** GET /v1/models — combos first are handled by the caller (configOptions). */
  async models({ fresh = false } = {}) {
    if (!fresh && this._models && Date.now() - this._modelsAt < MODELS_TTL_MS) return this._models;
    const data = await this._json("/v1/models");
    this._models = Array.isArray(data?.data) ? data.data : [];
    this._modelsAt = Date.now();
    return this._models;
  }

  invalidateModels() {
    this._models = null;
    this._modelsAt = 0;
  }

  /**
   * POST /v1/chat/completions with stream:true.
   *
   * Accumulates deltas into one result; `onDelta`/`onThought` are called per
   * chunk so the caller can stream `session/update` notifications live.
   */
  async chat({ model, messages, tools, signal, onDelta, onThought, tokenSaver = true, maxTurnsHint }) {
    const link = linkSignals(signal);
    let stall;
    const armStall = () => {
      clearTimeout(stall);
      stall = setTimeout(() => link.abort(new GatewayError("Gateway stream stalled", { retryable: true })), STALL_TIMEOUT_MS);
    };
    armStall();

    const body = { model, messages, stream: true, stream_options: { include_usage: true } };
    if (tools?.length) body.tools = tools;
    if (maxTurnsHint) body.max_tokens = maxTurnsHint;

    let res;
    try {
      res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: this.headers({
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          // RTK stays on by default; the session toggle maps to this header.
          ...(tokenSaver ? {} : { "x-9router-token-saver": "off" }),
        }),
        body: JSON.stringify(body),
        signal: link.signal,
      });
    } catch (err) {
      link.dispose();
      clearTimeout(stall);
      throw err;
    }
    if (!res.ok) {
      link.dispose();
      clearTimeout(stall);
      const text = await res.text().catch(() => "");
      let msg = text;
      try {
        msg = JSON.parse(text)?.error?.message || text;
      } catch {
        /* keep raw */
      }
      throw new GatewayError(`chat/completions failed (${res.status}): ${redact(msg).slice(0, 400)}`, {
        status: res.status,
        retryable: res.status === 429 || res.status >= 500,
      });
    }

    const parser = new SseParser();
    const toolCalls = [];
    let content = "";
    let reasoning = "";
    let finishReason = null;
    let usage = null;

    const handleFrame = (payload) => {
      if (!payload || payload === "[DONE]") return false;
      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        return true;
      }
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return true;
      const delta = choice.delta || {};
      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        onDelta?.(delta.content);
      }
      if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        onThought?.(delta.reasoning_content);
      } else if (typeof delta.reasoning === "string" && delta.reasoning) {
        reasoning += delta.reasoning;
        onThought?.(delta.reasoning);
      }
      for (const tc of delta.tool_calls || []) {
        const i = tc.index ?? toolCalls.length;
        if (!toolCalls[i]) toolCalls[i] = { id: "", name: "", arguments: "" };
        if (tc.id) toolCalls[i].id = tc.id;
        if (tc.function?.name) toolCalls[i].name += tc.function.name;
        if (typeof tc.function?.arguments === "string") toolCalls[i].arguments += tc.function.arguments;
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
      return true;
    };

    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armStall();
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) handleFrame(frame);
      }
      for (const frame of parser.end()) handleFrame(frame);
    } catch (err) {
      // A cancelled turn must surface as a cancellation, not a random error.
      if (link.signal.aborted) {
        const e = new GatewayError("cancelled", { retryable: false });
        e.cancelled = true;
        throw e;
      }
      throw err;
    } finally {
      link.dispose();
      clearTimeout(stall);
    }

    return {
      content,
      reasoning,
      toolCalls: toolCalls.filter(Boolean),
      finishReason,
      usage,
      model,
    };
  }

  /** POST /v1/web/fetch — 9router's own web reader, permission-gated by the caller. */
  async webFetch(url, { signal } = {}) {
    const data = await this._json("/v1/web/fetch", {
      method: "POST",
      body: { url },
      timeoutMs: 30000,
      signal,
    });
    return typeof data === "string" ? data : data?.content || data?.text || JSON.stringify(data);
  }
}

module.exports = { GatewayClient, GatewayError, DEFAULT_BASE, createGateway };

/** Build a client from resolved credentials (re-created when they change). */
function createGateway({ baseUrl, apiKey, log } = {}) {
  return new GatewayClient({ baseUrl, apiKey, log });
}
