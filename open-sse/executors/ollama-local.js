import { DefaultExecutor } from "./default.js";
import { resolveOllamaLocalHost } from "../config/providers.js";
import { OLLAMA_LOCAL_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { dbg } from "../utils/debugLog.js";

// ─── Formatting helpers ────────────────────────────────────────────────────

function fmtBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Summarise messages array into a compact breakdown string.
 * e.g. "12 msgs [sys=1 usr=6 asst=5] | tool_calls=2 | ~84.3KB content"
 */
function summariseMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "no messages";

  const counts = { system: 0, user: 0, assistant: 0, tool: 0, other: 0 };
  let totalContentChars = 0;
  let toolCallCount = 0;
  let imageCount = 0;

  for (const msg of messages) {
    const role = msg?.role || "other";
    counts[role] != null ? counts[role]++ : counts.other++;

    // Count tool_calls inside assistant messages
    if (Array.isArray(msg?.tool_calls)) toolCallCount += msg.tool_calls.length;

    // Accumulate content length
    if (typeof msg?.content === "string") {
      totalContentChars += msg.content.length;
    } else if (Array.isArray(msg?.content)) {
      for (const block of msg.content) {
        if (block?.type === "text") totalContentChars += (block.text || "").length;
        else if (block?.type === "image_url" || block?.type === "image") imageCount++;
        else if (block?.type === "tool_result" || block?.type === "tool_use") {
          totalContentChars += JSON.stringify(block).length;
        }
      }
    }
  }

  const roleParts = [];
  if (counts.system) roleParts.push(`sys=${counts.system}`);
  if (counts.user) roleParts.push(`usr=${counts.user}`);
  if (counts.assistant) roleParts.push(`asst=${counts.assistant}`);
  if (counts.tool) roleParts.push(`tool=${counts.tool}`);
  if (counts.other) roleParts.push(`other=${counts.other}`);

  const parts = [`${messages.length} msgs [${roleParts.join(" ")}]`];
  if (toolCallCount) parts.push(`tool_calls=${toolCallCount}`);
  if (imageCount) parts.push(`images=${imageCount}`);
  parts.push(`~${fmtBytes(totalContentChars)} content`);

  return parts.join(" | ");
}

/**
 * Emit targeted hints when a large body is detected.
 * Breaks down where the size is coming from.
 */
function warnLargeBody(body, bodyBytes, host) {
  const msgs = body?.messages || [];
  const totalMsgs = msgs.length;

  // Find biggest messages (top 3)
  const withSize = msgs
    .map((m, i) => ({ i, role: m?.role, size: JSON.stringify(m).length }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 3);

  const topStr = withSize
    .map(m => `  msg[${m.i}] ${m.role} = ${fmtBytes(m.size)}`)
    .join("\n");

  dbg("OLLAMA-LOCAL", [
    `⚠ Large body (${fmtBytes(bodyBytes)}) — breakdown:`,
    `  total_messages : ${totalMsgs}`,
    `  top offenders  :\n${topStr}`,
    `  tools          : ${body?.tools?.length ?? 0} defined`,
    `  max_tokens     : ${body?.max_tokens ?? "unset"}`,
    `Hints: trim old messages, reduce tool definitions, or set a lower max_tokens.`,
    `Ollama timeout raised to ${fmtMs(OLLAMA_LOCAL_CONNECT_TIMEOUT_MS)} — if it still fails,`,
    `consider setting OLLAMA_LOCAL_CONNECT_TIMEOUT_MS env var higher.`,
  ].join("\n    "));
}

// ─── Executor ─────────────────────────────────────────────────────────────

export class OllamaLocalExecutor extends DefaultExecutor {
  constructor() {
    super("ollama-local");
    // Override connect timeout: local models (especially large ones) need more
    // time to load weights before returning response headers.
    this.config = {
      ...this.config,
      timeoutMs: OLLAMA_LOCAL_CONNECT_TIMEOUT_MS,
      // Disable network retry for local — no fallback host exists.
      // Retrying multiplies latency (3 × timeout) with zero benefit when Ollama is down.
      retry: {
        502: { attempts: 0, delayMs: 0 },
        503: { attempts: 0, delayMs: 0 },
        504: { attempts: 0, delayMs: 0 },
      },
    };
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const host = resolveOllamaLocalHost(credentials);
    return `${host}/api/chat`;
  }

  // Override execute: emit rich debug diagnostics then delegate to BaseExecutor.
  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const host = resolveOllamaLocalHost(credentials);
    const timeoutMs = this.config.timeoutMs;
    const t0 = Date.now();

    // ── Pre-flight diagnostics ──────────────────────────────────────────
    const bodyStr = JSON.stringify(body);
    const bodyBytes = bodyStr.length;
    const msgSummary = summariseMessages(body?.messages);

    dbg("OLLAMA-LOCAL", [
      `→ ${host}/api/chat`,
      `model=${model}`,
      `stream=${stream ?? "unset"}`,
      `body=${fmtBytes(bodyBytes)}`,
      `timeout=${fmtMs(timeoutMs)}`,
      `max_tokens=${body?.max_tokens ?? "unset"}`,
      `tools=${body?.tools?.length ?? 0}`,
    ].join(" | "));

    dbg("OLLAMA-LOCAL", `  messages: ${msgSummary}`);

    if (bodyBytes > 200 * 1024) {
      warnLargeBody(body, bodyBytes, host);
    }

    // ── Delegate ────────────────────────────────────────────────────────
    try {
      const result = await super.execute({ model, body, stream, credentials, signal, log, proxyOptions });
      const elapsed = Date.now() - t0;
      dbg("OLLAMA-LOCAL", `✓ connected in ${fmtMs(elapsed)} | url=${result.url}`);
      return result;
    } catch (error) {
      const elapsed = Date.now() - t0;
      const isTimeout =
        error.name === "AbortError" || error.message?.includes("fetch connect timeout");

      const lines = [
        `✖ ${error.name}: ${error.message}`,
        `  elapsed    : ${fmtMs(elapsed)} / timeout=${fmtMs(timeoutMs)}`,
        `  target     : ${host}/api/chat`,
        `  model      : ${model}`,
        `  body size  : ${fmtBytes(bodyBytes)}`,
      ];

      if (isTimeout) {
        lines.push(
          `  diagnosis  : Ollama did not return response headers within ${fmtMs(timeoutMs)}.`,
          `  candidates : model not loaded, Ollama not running, or body too large for available RAM.`,
          `  check      : curl -s ${host}/api/tags | jq '.models[].name'`,
          `  env fix    : OLLAMA_LOCAL_CONNECT_TIMEOUT_MS=${timeoutMs * 2} (current × 2)`,
        );
      }

      dbg("OLLAMA-LOCAL", lines.join("\n    "));
      throw error;
    }
  }
}

export default OllamaLocalExecutor;
