import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { saveRequestUsage, trackPendingRequest, appendRequestLog } from "@/lib/usageDb.js";

// Get HH:MM:SS timestamp
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Extract usage from any format (Claude, OpenAI, Gemini, Responses API)
function extractUsage(chunk) {
  // Claude format (message_delta event)
  if (chunk.type === "message_delta" && chunk.usage) {
    return {
      prompt_tokens: chunk.usage.input_tokens || 0,
      completion_tokens: chunk.usage.output_tokens || 0,
      cache_read_input_tokens: chunk.usage.cache_read_input_tokens,
      cache_creation_input_tokens: chunk.usage.cache_creation_input_tokens
    };
  }
  // OpenAI Responses API format (response.completed or response.done)
  if ((chunk.type === "response.completed" || chunk.type === "response.done") && chunk.response?.usage) {
    const usage = chunk.response.usage;
    return {
      prompt_tokens: usage.input_tokens || usage.prompt_tokens || 0,
      completion_tokens: usage.output_tokens || usage.completion_tokens || 0,
      cached_tokens: usage.input_tokens_details?.cached_tokens,
      reasoning_tokens: usage.output_tokens_details?.reasoning_tokens
    };
  }
  // OpenAI format
  if (chunk.usage?.prompt_tokens !== undefined) {
    return {
      prompt_tokens: chunk.usage.prompt_tokens,
      completion_tokens: chunk.usage.completion_tokens || 0,
      cached_tokens: chunk.usage.prompt_tokens_details?.cached_tokens,
      reasoning_tokens: chunk.usage.completion_tokens_details?.reasoning_tokens
    };
  }
  // Gemini format
  if (chunk.usageMetadata) {
    return {
      prompt_tokens: chunk.usageMetadata.promptTokenCount || 0,
      completion_tokens: chunk.usageMetadata.candidatesTokenCount || 0,
      reasoning_tokens: chunk.usageMetadata.thoughtsTokenCount
    };
  }
  return null;
}

// ANSI color codes
export const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m"
};

// Log usage with cache info (green color)
function logUsage(provider, usage, model = null, connectionId = null) {
  if (!usage) return;

  const p = provider?.toUpperCase() || "UNKNOWN";
  const inTokens = usage.prompt_tokens || 0;
  const outTokens = usage.completion_tokens || 0;

  let msg = `[${getTimeString()}] 📊 [USAGE] ${p} | in=${inTokens} | out=${outTokens}`;
  if (connectionId) msg += ` | account=${connectionId.slice(0, 8)}...`;

  if (usage.cache_creation_input_tokens) msg += ` | cache_write=${usage.cache_creation_input_tokens}`;
  if (usage.cache_read_input_tokens) msg += ` | cache_read=${usage.cache_read_input_tokens}`;
  if (usage.cached_tokens) msg += ` | cached=${usage.cached_tokens}`;
  if (usage.reasoning_tokens) msg += ` | reasoning=${usage.reasoning_tokens}`;

  console.log(`${COLORS.green}${msg}${COLORS.reset}`);

  // Log to log.txt
  appendRequestLog({ model, provider, connectionId, tokens: usage, status: "200 OK" }).catch(() => {});

  // Save to DB
  saveRequestUsage({
    provider: provider || "unknown",
    model: model || "unknown",
    tokens: usage,
    timestamp: new Date().toISOString(),
    connectionId: connectionId || undefined
  }).catch(err => {
    console.error("Failed to save usage stats:", err.message);
  });
}

// Parse SSE data line
function parseSSELine(line) {
  if (!line || !line.startsWith("data:")) return null;

  const data = line.slice(5).trim();
  if (data === "[DONE]") return { done: true };

  try {
    return JSON.parse(data);
  } catch (error) {
    // Log parse errors for debugging incomplete chunks
    if (data.length > 0 && data.length < 1000) {
      console.log(`[WARN] Failed to parse SSE line (${data.length} chars): ${data.substring(0, 100)}...`);
    }
    return null;
  }
}

/**
 * Format output as SSE
 * @param {object} data - Data to format
 * @param {string} sourceFormat - Target format for client
 * @returns {string} SSE formatted string
 */
export function formatSSE(data, sourceFormat) {
  // Handle null/undefined
  if (data === null || data === undefined) {
    return "data: null\n\n";
  }
  
  if (data && data.done) return "data: [DONE]\n\n";

  // OpenAI Responses API format: has event field
  if (data && data.event && data.data) {
    return `event: ${data.event}\ndata: ${JSON.stringify(data.data)}\n\n`;
  }

  // Claude format: include event prefix
  if (sourceFormat === FORMATS.CLAUDE && data && data.type) {
    // If perf_metrics is null, remove it to avoid serialization issues
    if (data.usage && typeof data.usage === 'object' && data.usage.perf_metrics === null) {
      const { perf_metrics, ...usageWithoutPerf } = data.usage;
      data = { ...data, usage: usageWithoutPerf };
    }
    return `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  // If perf_metrics is null, remove it to avoid serialization issues
  if (data?.usage && typeof data.usage === 'object' && data.usage.perf_metrics === null) {
    const { perf_metrics, ...usageWithoutPerf } = data.usage;
    data = { ...data, usage: usageWithoutPerf };
  }

  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Stream modes
 */
const STREAM_MODE = {
  TRANSLATE: "translate",    // Full translation between formats
  PASSTHROUGH: "passthrough" // No translation, normalize output, extract usage
};

/**
 * Create unified SSE transform stream
 * @param {object} options
 * @param {string} options.mode - Stream mode: translate, passthrough
 * @param {string} options.targetFormat - Provider format (for translate mode)
 * @param {string} options.sourceFormat - Client format (for translate mode)
 * @param {string} options.provider - Provider name
 * @param {object} options.reqLogger - Request logger instance
 * @param {string} options.model - Model name
 * @param {string} options.connectionId - Connection ID for usage tracking
 */
export function createSSEStream(options = {}) {
  const {
    mode = STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider = null,
    reqLogger = null,
    toolNameMap = null,
    model = null,
    connectionId = null
  } = options;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let usage = null;

  // State for translate mode
  const state = mode === STREAM_MODE.TRANSLATE ? { ...initState(sourceFormat), provider, toolNameMap } : null;

  return new TransformStream({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      buffer += text;
      reqLogger?.appendProviderChunk?.(text);

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();

        // Passthrough mode: normalize and forward
        if (mode === STREAM_MODE.PASSTHROUGH) {
          if (trimmed.startsWith("data:") && trimmed.slice(5).trim() !== "[DONE]") {
            try {
              const parsed = JSON.parse(trimmed.slice(5).trim());
              const extracted = extractUsage(parsed);
              if (extracted) usage = extracted;
            } catch {}
          }
          // Normalize: ensure "data: " has space
          let output;
          if (line.startsWith("data:") && !line.startsWith("data: ")) {
            output = "data: " + line.slice(5) + "\n";
          } else {
            output = line + "\n";
          }
          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(encoder.encode(output));
          continue;
        }

        // Translate mode
        if (!trimmed) continue;

        const parsed = parseSSELine(trimmed);
        if (!parsed) continue;

        if (parsed && parsed.done) {
          const output = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(output);
          controller.enqueue(encoder.encode(output));
          continue;
        }

        // Extract usage
        const extracted = extractUsage(parsed);
        if (extracted) state.usage = extracted;

        // Translate and emit
        const translated = translateResponse(targetFormat, sourceFormat, parsed, state);
        if (translated?.length > 0) {
          for (const item of translated) {
            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(encoder.encode(output));
          }
        }
      }
    },

    flush(controller) {
      trackPendingRequest(model, provider, connectionId, false);
      try {
        const remaining = decoder.decode();
        if (remaining) buffer += remaining;

        if (mode === STREAM_MODE.PASSTHROUGH) {
          if (buffer) {
            let output = buffer;
            if (buffer.startsWith("data:") && !buffer.startsWith("data: ")) {
              output = "data: " + buffer.slice(5);
            }
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(encoder.encode(output));
          }
          if (usage) {
            logUsage(provider, usage, model, connectionId);
          } else {
            // No usage data available - still mark request as completed
            appendRequestLog({ model, provider, connectionId, tokens: null, status: "200 OK" }).catch(() => {});
          }
          return;
        }

        // Translate mode: process remaining buffer
        if (buffer.trim()) {
          const parsed = parseSSELine(buffer.trim());
          if (parsed && !parsed.done) {
            const translated = translateResponse(targetFormat, sourceFormat, parsed, state);
            if (translated?.length > 0) {
              for (const item of translated) {
                const output = formatSSE(item, sourceFormat);
                reqLogger?.appendConvertedChunk?.(output);
                controller.enqueue(encoder.encode(output));
              }
            }
          }
        }

        // Flush remaining events (only once at stream end)
        const flushed = translateResponse(targetFormat, sourceFormat, null, state);
        if (flushed?.length > 0) {
          for (const item of flushed) {
            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            controller.enqueue(encoder.encode(output));
          }
        }

        // Send [DONE] and log usage
        const doneOutput = "data: [DONE]\n\n";
        reqLogger?.appendConvertedChunk?.(doneOutput);
        controller.enqueue(encoder.encode(doneOutput));

        if (state?.usage) {
          logUsage(state.provider || targetFormat, state.usage, model, connectionId);
        } else {
          // No usage data available - still mark request as completed
          appendRequestLog({ model, provider, connectionId, tokens: null, status: "200 OK" }).catch(() => {});
        }
      } catch (error) {
        console.log("Error in flush:", error);
      }
    }
  });
}

// Convenience functions for backward compatibility
export function createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider = null, reqLogger = null, toolNameMap = null, model = null, connectionId = null) {
  return createSSEStream({
    mode: STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider,
    reqLogger,
    toolNameMap,
    model,
    connectionId
  });
}

export function createPassthroughStreamWithLogger(provider = null, reqLogger = null, model = null, connectionId = null) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    provider,
    reqLogger,
    model,
    connectionId
  });
}
