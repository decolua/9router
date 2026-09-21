/**
 * CommandCode → OpenAI response translator
 *
 * CommandCode upstream emits NDJSON-style AI SDK v5 stream events:
 *   {"type":"start"} {"type":"start-step", ...}
 *   {"type":"reasoning-start","id":"..."} {"type":"reasoning-delta","text":"..."}
 *   {"type":"text-start","id":"..."}     {"type":"text-delta","text":"..."}
 *   {"type":"tool-input-start","id","toolName"}
 *   {"type":"tool-input-delta","id","delta"}
 *   {"type":"tool-input-end","id"}
 *   {"type":"tool-call","toolCallId","toolName","input"}
 *   {"type":"finish-step","finishReason","usage": {...}, ...}
 *   {"type":"finish",...}
 *
 * Each upstream "event" arrives as one JSON object per line — we receive it as a string chunk
 * already split per line by the upstream SSE/JSON-line reader in 9router.
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { reasoningDelta } from "../concerns/reasoning.js";

function ensureState(state, model) {
  if (!state.responseId) {
    state.responseId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
    state.model = state.model || model || "commandcode";
    state.chunkIndex = 0;
    state.commandCodeToolCalls = [];
    state.commandCodeToolCallIds = new Set();
    state.commandCodeFinishReason = null;
    state.commandCodeUsage = null;
    state.commandCodeFinished = false;
  }
}

function makeChunk(state, delta, finishReason = null) {
  return buildChunk(
    { id: state.responseId, created: state.created, model: state.model },
    delta,
    finishReason
  );
}

function mapFinishReason(reason) {
  switch (String(reason || "").trim()) {
    case "stop":
    case "end":
    case "end_turn":
      return OPENAI_FINISH.STOP;
    case "tool-calls":
    case "tool_calls":
    case "tool_use":
    case "function_call":
      return OPENAI_FINISH.TOOL_CALLS;
    case "max_tokens":
    case "max_output_tokens":
    case "length":
      return OPENAI_FINISH.LENGTH;
    case "content-filter":
    case "content_filter":
      return OPENAI_FINISH.CONTENT_FILTER;
    default:
      throw new Error(`CommandCode finish event has unsupported reason ${JSON.stringify(reason || "")}`);
  }
}

function toolArguments(event) {
  const hasInput = Object.prototype.hasOwnProperty.call(event, "input");
  const hasArgs = Object.prototype.hasOwnProperty.call(event, "args");
  const hasArguments = Object.prototype.hasOwnProperty.call(event, "arguments");
  if (!hasInput && !hasArgs && !hasArguments) {
    throw new Error("CommandCode tool-call event is missing input");
  }

  const input = hasInput ? event.input : hasArgs ? event.args : event.arguments;
  if (input == null) throw new Error("CommandCode tool-call input must be a JSON object");

  let parsed = input;
  let encoded;
  if (typeof input === "string") {
    encoded = input.trim();
    try {
      parsed = JSON.parse(encoded);
    } catch {
      throw new Error("CommandCode tool-call input must be one complete JSON object");
    }
  } else {
    encoded = JSON.stringify(input);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("CommandCode tool-call input must be a JSON object");
  }
  return encoded;
}

export function commandCodeToOpenAIResponse(chunk, state) {
  if (!chunk) return null;

  // Already-OpenAI chunk: pass through
  if (chunk && typeof chunk === "object" && chunk.object === "chat.completion.chunk") {
    return chunk;
  }

  // Parse string lines coming out of upstream
  let event = chunk;
  if (typeof chunk === "string") {
    const line = chunk.trim();
    if (!line) return null;
    // Tolerate raw "data: {...}" framing if the upstream wrapper inserts it
    const json = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!json || json === "[DONE]") return null;
    try {
      event = JSON.parse(json);
    } catch (error) {
      throw new Error(`CommandCode returned invalid stream JSON: ${error.message}`);
    }
  }

  if (!event || typeof event !== "object" || !event.type) return null;

  ensureState(state, event.model);
  const out = [];

  switch (event.type) {
    case "text-delta": {
      const text = event.text || event.delta || "";
      if (!text) break;
      const delta = state.chunkIndex === 0 ? { role: ROLE.ASSISTANT, content: text } : { content: text };
      state.chunkIndex++;
      out.push(makeChunk(state, delta));
      break;
    }
    case "reasoning-delta": {
      const text = event.text || "";
      if (!text) break;
      // Map reasoning to OpenAI "reasoning_content" field (used by deepseek-reasoner-style clients).
      const delta = reasoningDelta(text, state.chunkIndex === 0);
      state.chunkIndex++;
      out.push(makeChunk(state, delta));
      break;
    }
    case "tool-input-start":
    case "tool-input-delta":
    case "tool-input-end":
    case "tool-input-available":
    case "tool-error":
      // Provisional telemetry is never executable. Wait for the authoritative
      // tool-call event, as the official Command Code gateway does.
      break;
    case "tool-call": {
      const id = event.toolCallId || event.id || "";
      const name = event.toolName || "";
      if (!id) throw new Error("CommandCode tool-call event is missing an id");
      if (!name) throw new Error(`CommandCode tool-call ${id} is missing a name`);
      if (state.commandCodeToolCallIds.has(id)) break;
      state.commandCodeToolCallIds.add(id);
      state.commandCodeToolCalls.push({ id, name, arguments: toolArguments(event) });
      break;
    }
    case "finish-step": {
      if (event.finishReason) state.commandCodeFinishReason = event.finishReason;
      if (event.usage) state.commandCodeUsage = event.usage;
      break;
    }
    case "finish": {
      if (state.commandCodeFinished) break;
      let finishReason = mapFinishReason(event.finishReason || event.rawFinishReason || state.commandCodeFinishReason);
      if (finishReason === OPENAI_FINISH.TOOL_CALLS && state.commandCodeToolCalls.length === 0) {
        throw new Error("CommandCode finished with tool_calls but supplied no valid tool call");
      }
      for (let index = 0; index < state.commandCodeToolCalls.length; index++) {
        const call = state.commandCodeToolCalls[index];
        const delta = {
          ...(state.chunkIndex === 0 ? { role: ROLE.ASSISTANT } : {}),
          tool_calls: [{
            index,
            id: call.id,
            type: OPENAI_BLOCK.FUNCTION,
            function: { name: call.name, arguments: call.arguments },
          }],
        };
        state.chunkIndex++;
        out.push(makeChunk(state, delta));
      }
      if (state.commandCodeToolCalls.length > 0 && finishReason !== OPENAI_FINISH.LENGTH) {
        finishReason = OPENAI_FINISH.TOOL_CALLS;
      }
      const finalChunk = makeChunk(state, {}, finishReason);
      const totalUsage = event.totalUsage || state.commandCodeUsage;
      const usage = toOpenAIUsage(totalUsage, "commandcode");
      if (usage) finalChunk.usage = usage;
      out.push(finalChunk);
      state.commandCodeFinished = true;
      break;
    }
    case "error": {
      const errVal = event.error ?? event.message ?? "unknown";
      const errStr = typeof errVal === "string" ? errVal : JSON.stringify(errVal);
      // Mid-stream error: throw rather than emitting as fake content with finish_reason: "stop"
      // This ensures the downstream stream handler marks the stream as errored/aborted.
      throw new Error(`[CommandCode error: ${errStr}]`);
    }
    // Silently ignore: start, start-step, reasoning-start, reasoning-end, text-start, text-end,
    // provider-metadata, message-metadata, etc. They carry no client-visible content.
    default:
      break;
  }

  return out.length ? out : null;
}

register(FORMATS.COMMANDCODE, FORMATS.OPENAI, null, commandCodeToOpenAIResponse);
