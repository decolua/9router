// Transform gateway responses for the Ollama /api/chat surface.
//
// The gateway (handleChat) can return four shapes; all must survive translation:
//   1. Error Responses (400/401/404/503/…) — OpenAI-style body {"error":{"message":…}}
//      or upstream-shaped {"error":"…"} / {"message":"…"}.
//      → Ollama clients expect the CANONICAL shape: real HTTP status + {"error":"<msg>"}
//        (string). Evidence: open-sse/utils/error.js parseUpstreamError reads
//        `json.error?.message || json.message || json.error || bodyText` for Ollama
//        upstreams (executors/ollama-local.js delegates to DefaultExecutor).
//   2. Non-stream success: a single OpenAI `chat.completion` JSON object
//      (Content-Type: application/json) → one Ollama chat response object.
//   3. Streaming success: OpenAI SSE (`data:` lines) — also tolerate plain JSON
//      lines (NDJSON), since not every upstream wraps chunks in `data:`.
//   4. Mid-stream error chunks ({"error":…} inside SSE) → surface as an Ollama
//      {"error":"…"} event; never flush a fake empty `done:true` success instead.
//
// Never mask failures as 200 with empty content (previous F1 HIGH bug).

const JSON_HEADERS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
const NDJSON_HEADERS = { "Content-Type": "application/x-ndjson", "Access-Control-Allow-Origin": "*" };

function encodeLine(obj) {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n");
}

// Extract a human-readable error message from OpenAI/Ollama/generic error shapes.
function extractErrorMessage(payload) {
  if (!payload || typeof payload !== "object") return null;
  const err = payload.error;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object" && typeof err.message === "string" && err.message.trim()) return err.message;
  if (typeof payload.message === "string" && payload.message.trim() && payload.error) return payload.message;
  return null;
}

function messageFromErrorText(text, fallbackStatus) {
  const trimmed = (text || "").trim();
  if (!trimmed) return `Gateway error (${fallbackStatus})`;
  try {
    const extracted = extractErrorMessage(JSON.parse(trimmed));
    if (extracted) return extracted;
  } catch { /* not JSON: use raw text */ }
  return trimmed.length > 500 ? trimmed.slice(0, 500) + "…" : trimmed;
}

// Canonical Ollama error response: real status + {"error":"<message>"}.
export function ollamaErrorResponse(status, message) {
  const safeStatus = status >= 400 && status <= 599 ? status : 502;
  return new Response(JSON.stringify({ error: message || `Gateway error (${safeStatus})` }), {
    status: safeStatus,
    headers: JSON_HEADERS,
  });
}

// OpenAI non-stream tool_calls → Ollama tool_calls (arguments parsed to an object).
function formatToolCalls(calls) {
  return calls.map((tc) => ({
    id: tc.id,
    function: {
      name: tc.function?.name || "",
      arguments: (() => { try { return JSON.parse(tc.function?.arguments || "{}"); } catch { return {}; } })(),
    },
  }));
}

// OpenAI chat.completion (non-stream) → Ollama /api/chat response object.
function openaiCompletionToOllama(json, model) {
  const choice = json.choices?.[0] || {};
  const msg = choice.message || {};
  const out = {
    model: json.model || model,
    created_at: json.created ? new Date(json.created * 1000).toISOString() : new Date().toISOString(),
    message: { role: "assistant", content: typeof msg.content === "string" ? msg.content : "" },
    done_reason: choice.finish_reason || "stop",
    done: true,
  };
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    out.message.tool_calls = formatToolCalls(msg.tool_calls);
    out.done_reason = "tool_calls";
  }
  if (json.usage) {
    if (typeof json.usage.prompt_tokens === "number") out.prompt_eval_count = json.usage.prompt_tokens;
    if (typeof json.usage.completion_tokens === "number") out.eval_count = json.usage.completion_tokens;
  }
  return out;
}

function buildOllamaStreamTransform(model) {
  let buffer = "";
  let pendingToolCalls = {};
  let terminalEmitted = false;
  const decoder = new TextDecoder();

  const emitEnd = (controller, doneReason) => {
    terminalEmitted = true;
    controller.enqueue(encodeLine({
      model,
      message: { role: "assistant", content: "" },
      done_reason: doneReason || "stop",
      done: true,
    }));
  };

  // Turn one parsed OpenAI chunk into Ollama NDJSON events.
  const handleParsed = (parsed, controller) => {
    // Mid-stream error: surface it, and stop (no fake empty success afterwards).
    const errMsg = extractErrorMessage(parsed);
    if (errMsg) {
      terminalEmitted = true;
      controller.enqueue(encodeLine({ error: errMsg }));
      return;
    }

    const choice = parsed.choices?.[0] || {};
    // `delta` for streaming chunks; `message` also covers a completion object
    // that arrived as a raw JSON line inside the stream body.
    const part = choice.delta || choice.message || {};
    const content = typeof part.content === "string" ? part.content : "";
    const toolCalls = part.tool_calls;

    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const idx = tc.index ?? Object.keys(pendingToolCalls).length;
        if (!pendingToolCalls[idx]) {
          pendingToolCalls[idx] = { id: tc.id, function: { name: "", arguments: "" } };
        }
        if (tc.id) pendingToolCalls[idx].id = tc.id;
        if (tc.function?.name) pendingToolCalls[idx].function.name += tc.function.name;
        if (tc.function?.arguments) pendingToolCalls[idx].function.arguments += tc.function.arguments;
      }
    }

    if (content) {
      controller.enqueue(encodeLine({ model, message: { role: "assistant", content }, done: false }));
    }

    const finishReason = choice.finishReason ?? choice.finish_reason;
    if (finishReason) {
      const toolCallsArr = Object.values(pendingToolCalls);
      if (toolCallsArr.length > 0) {
        terminalEmitted = true;
        controller.enqueue(encodeLine({
          model,
          message: { role: "assistant", content: "", tool_calls: formatToolCalls(toolCallsArr) },
          done_reason: "tool_calls",
          done: true,
        }));
        pendingToolCalls = {};
      } else {
        emitEnd(controller, finishReason);
      }
    }
  };

  // One transport line → payload to JSON.parse, or null to skip.
  // Accepts SSE `data:` lines AND plain JSON lines (NDJSON); skips comments/blank.
  const payloadFromLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(":")) return null; // SSE comment/heartbeat
    if (line.startsWith("data:")) return line.slice(5).trim();
    if (line.startsWith("{") || line.startsWith("[")) return line; // plain JSON line
    return null;
  };

  const consumePayload = (payload, controller) => {
    if (payload === "[DONE]") {
      if (!terminalEmitted) emitEnd(controller);
      return;
    }
    if (!payload || terminalEmitted) return;
    try {
      handleParsed(JSON.parse(payload), controller);
    } catch {
      // Malformed line: ignore (truncated tails are handled by flush()).
    }
  };

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const raw of lines) consumePayload(payloadFromLine(raw), controller);
    },
    flush(controller) {
      // A final line without trailing newline must not be dropped.
      const tail = buffer;
      buffer = "";
      if (tail.trim()) consumePayload(payloadFromLine(tail), controller);
      // Success path only: never flush an empty done after an error/terminal event.
      if (!terminalEmitted) emitEnd(controller);
    },
  });
}

export async function transformToOllama(response, model) {
  const status = response.status || 502;

  // 1) Propagate real errors with the Ollama-canonical shape and true status.
  if (!response.ok || status >= 400) {
    const text = await response.text().catch(() => "");
    return ollamaErrorResponse(status, messageFromErrorText(text, status));
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();

  // 2) Non-stream success: single JSON object (not SSE) → single Ollama object.
  if (contentType.includes("application/json") && response.body) {
    const text = await response.text().catch(() => "");
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* fall through to line parser */ }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const errMsg = extractErrorMessage(parsed);
      if (errMsg) return ollamaErrorResponse(502, errMsg); // error envelope on 200: don't hide it
      return new Response(JSON.stringify(openaiCompletionToOllama(parsed, model)), {
        status: response.status,
        headers: JSON_HEADERS,
      });
    }
    // Multi-line JSON (NDJSON) in a json content-type: parse it as stream lines.
    return new Response(
      new Response(text).body.pipeThrough(buildOllamaStreamTransform(model)),
      { status: response.status, headers: NDJSON_HEADERS },
    );
  }

  // 3) OK status but no body: anomalous — report it, never silently succeed.
  if (!response.body) {
    return ollamaErrorResponse(502, "Empty response body from gateway");
  }

  // 4) Stream (SSE or NDJSON).
  return new Response(response.body.pipeThrough(buildOllamaStreamTransform(model)), {
    status: response.status,
    headers: NDJSON_HEADERS,
  });
}
