const { err } = require("../logger");
const { IS_DEV } = require("../config");
const { fetchRouter, pipeTransformedEventStream } = require("./base");
const fs = require("fs");
const path = require("path");

// Debug trace log — written to data/logs/mitm/kiro-debug.log (dev only)
const DEBUG_LOG = path.join(__dirname, "../../../data/logs/mitm/kiro-debug.log");
function dbg(msg) {
  if (!IS_DEV) return;
  try {
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

// ─── CRC32 (standard, polynomial 0xEDB88320 — same as AWS EventStream) ───────
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Initialize state for the Kiro response translator
 */
function initKiroState(modelId) {
  return {
    modelId: modelId || null,       // Model name from first chunk
    toolCallInit: {},               // { [index]: { id, name } } — tracks seen tools
    hasToolCalls: false,           // Whether this response uses tool calls
    finishSent: false,             // Whether termination has been emitted
    usage: null,                   // Accumulated usage from usage-only chunks
    inThink: false,                // Whether inside a <thinking> block
    thinkBuf: ""                   // Buffer for partial thinking content
  };
}

/**
 * Extract thinking blocks from text content.
 * Handles both <thinking>...</thinking> and <think>...</think> tags,
 * including partial tags split across SSE chunks.
 */
function extractThinking(text, state) {
  if (!text) return { thinking: null, text: null };

  let working = text;

  // Prepend buffered partial thinking from previous chunk
  if (state.inThink && state.thinkBuf) {
    working = state.thinkBuf + working;
    state.thinkBuf = "";
    state.inThink = false;
  }

  // Match <thinking> or <think> opening tags
  const startRe = /<thinking>|<think>/i;
  const startMatch = working.match(startRe);

  if (!startMatch) {
    return { thinking: null, text: working };
  }

  const tag = startMatch[0].toLowerCase();
  const closeTag = tag === "<think>" ? "</think>" : "</thinking>";
  const startIdx = startMatch.index;
  const endIdx = working.indexOf(closeTag, startIdx + tag.length);

  if (endIdx === -1) {
    // Opening tag without closing — buffer for next chunk
    state.inThink = true;
    state.thinkBuf = working.slice(startIdx);
    const before = working.slice(0, startIdx).trim();
    return { thinking: null, text: before || null };
  }

  // Complete block found
  const thinking = working.slice(startIdx + tag.length, endIdx);
  const before = working.slice(0, startIdx).trim();
  const after = working.slice(endIdx + closeTag.length).trim();
  const rest = [before, after].filter(Boolean).join("");

  // Recursively process for more blocks
  const recurse = rest
    ? extractThinking(rest, { inThink: false, thinkBuf: "" })
    : { thinking: null, text: null };

  return {
    thinking: thinking || null,
    text: recurse.text || null
  };
}

// ─── AWS EventStream frame builder ────────────────────────────────────────────
/**
 * Encode a single string header into the AWS EventStream binary format.
 * Header wire format: [nameLen 1B][name][type=7 1B][valueLen 2B][value]
 */
function encodeHeader(name, value) {
  const nameBuf = Buffer.from(name, "utf8");
  const valueBuf = Buffer.from(value, "utf8");
  const buf = Buffer.alloc(1 + nameBuf.length + 1 + 2 + valueBuf.length);
  let o = 0;
  buf[o++] = nameBuf.length;
  nameBuf.copy(buf, o); o += nameBuf.length;
  buf[o++] = 7; // string type
  buf.writeUInt16BE(valueBuf.length, o); o += 2;
  valueBuf.copy(buf, o);
  return buf;
}

/**
 * Build a single AWS EventStream binary frame with all Smithy-required headers.
 *
 * Frame layout (big-endian):
 *   [totalLen 4B][headersLen 4B][preludeCRC 4B]
 *   [headers ...][payload JSON ...][messageCRC 4B]
 *
 * The SmithyMessageDecoderStream layer requires three system headers on every frame:
 *   :message-type  = "event"             (or "exception" / "error")
 *   :event-type    = e.g. "assistantResponseEvent"
 *   :content-type  = "application/json"
 */
function buildEventStreamFrame(eventType, payload) {
  const payloadBuf = Buffer.from(
    typeof payload === "string" ? payload : JSON.stringify(payload),
    "utf8"
  );

  // All three Smithy system headers are required
  const headersBuf = Buffer.concat([
    encodeHeader(":message-type", "event"),
    encodeHeader(":event-type", eventType),
    encodeHeader(":content-type", "application/json"),
  ]);
  const headersLen = headersBuf.length;

  const totalLen = 4 + 4 + 4 + headersLen + payloadBuf.length + 4;
  const frame = Buffer.alloc(totalLen);

  frame.writeUInt32BE(totalLen, 0);
  frame.writeUInt32BE(headersLen, 4);
  frame.writeUInt32BE(crc32(frame.slice(0, 8)), 8); // prelude CRC
  headersBuf.copy(frame, 12);
  payloadBuf.copy(frame, 12 + headersLen);
  frame.writeUInt32BE(crc32(frame.slice(0, totalLen - 4)), totalLen - 4); // message CRC

  return frame;
}

// ─── CodeWhisperer → OpenAI conversion ───────────────────────────────────────

/**
 * Safely stringify a tool-call input value.
 * OpenAI expects `function.arguments` to be a JSON string, never an object.
 * If 9router's Anthropic→OpenAI conversion passes the input as a pre-parsed object,
 * this prevents the "" + object → "[object Object]" corruption.
 */
function safeArgsString(value) {
  if (typeof value === "string") return value;
  if (value == null) return "{}";
  try { return JSON.stringify(value); } catch { return "{}"; }
}

/**
 * Convert a CodeWhisperer userInputMessage to one or more OpenAI messages.
 *
 * A user turn can contain:
 *   - plain text content  → { role:"user", content }
 *   - toolResults only    → one { role:"tool", tool_call_id, content } per result
 *   - both                → tool messages first, then the user text message
 */
function convertUserInputMessage(uim) {
  const out = [];
  const toolResults = uim.userInputMessageContext?.toolResults || [];

  // Emit one "tool" message per tool result (OpenAI multi-tool format)
  for (const tr of toolResults) {
    const text = (tr.content || []).map(c => c.text || "").join("\n");
    out.push({
      role: "tool",
      tool_call_id: tr.toolUseId || "",
      content: text,
    });
  }

  // Emit user text only if it exists alongside OR when there are no tool results
  const text = (uim.content || "").trim();
  if (text || toolResults.length === 0) {
    out.push({ role: "user", content: text });
  }

  return out;
}

/**
 * Convert a CodeWhisperer assistantResponseMessage to an OpenAI assistant message.
 *
 * The assistant turn can contain:
 *   - plain text content
 *   - toolUses (tool calls)  → tool_calls[] on the assistant message
 */
function convertAssistantResponseMessage(arm) {
  const toolUses = arm.toolUses || [];

  if (toolUses.length > 0) {
    return {
      role: "assistant",
      content: arm.content || null,
      tool_calls: toolUses.map(tu => ({
        id: tu.toolUseId || `call_${Date.now()}`,
        type: "function",
        function: {
          name: tu.name || "",
          arguments: safeArgsString(tu.input),
        },
      })),
    };
  }

  return { role: "assistant", content: arm.content || "" };
}

/**
 * Convert AWS CodeWhisperer conversationState to an OpenAI messages array.
 *
 * Full multi-turn shape:
 *   history: [
 *     { userInputMessage: { content, userInputMessageContext?: { toolResults?, tools? } } },
 *     { assistantResponseMessage: { content, toolUses?: [...] } },
 *     ...
 *   ]
 *   currentMessage: { userInputMessage: { content, userInputMessageContext?: { toolResults? } } }
 */
function codeWhispererToMessages(body) {
  const cs = body.conversationState || {};
  const history = cs.history || [];
  const currentMsg = cs.currentMessage;
  const messages = [];

  for (const item of history) {
    if (item.userInputMessage) {
      messages.push(...convertUserInputMessage(item.userInputMessage));
    } else if (item.assistantResponseMessage) {
      messages.push(convertAssistantResponseMessage(item.assistantResponseMessage));
    }
  }

  // Append the current (latest) turn
  if (currentMsg?.userInputMessage) {
    messages.push(...convertUserInputMessage(currentMsg.userInputMessage));
  }

  return messages;
}

/**
 * Extract tool definitions from a CodeWhisperer request and convert to OpenAI format.
 *
 * CodeWhisperer tools live in:
 *   conversationState.currentMessage.userInputMessage.userInputMessageContext.tools
 * OR (in multi-turn) the first history item's userInputMessageContext.tools
 *
 * CodeWhisperer tool shape:
 *   { toolSpecification: { name, description, inputSchema: { json: <schema> } } }
 *
 * OpenAI tool shape:
 *   { type: "function", function: { name, description, parameters: <schema> } }
 */
function extractTools(body) {
  const cs = body.conversationState || {};

  // Tools are typically on the currentMessage; may also appear on the first history item
  const fromCurrent = cs.currentMessage?.userInputMessage?.userInputMessageContext?.tools || [];
  const fromHistory = cs.history?.find(h => h.userInputMessage?.userInputMessageContext?.tools)
    ?.userInputMessage?.userInputMessageContext?.tools || [];
  const cwTools = fromCurrent.length > 0 ? fromCurrent : fromHistory;

  if (!cwTools.length) return [];

  return cwTools.map(item => {
    const spec = item.toolSpecification || item;
    return {
      type: "function",
      function: {
        name: spec.name || "",
        description: spec.description || `Tool: ${spec.name || "unknown"}`,
        parameters: spec.inputSchema?.json || { type: "object", properties: {}, required: [] },
      },
    };
  });
}

// ─── OpenAI SSE → EventStream binary conversion ───────────────────────────────

/**
 * Convert an OpenAI SSE chunk to AWS EventStream binary frame(s)
 * This replaces pipeOpenAIasEventStream and works with pipeTransformedEventStream
 *
 * @param {object|null} chunk - Parsed OpenAI chat.completion.chunk, or null for flush
 * @param {object} state - Mutable state object
 * @returns {Uint8Array|Uint8Array[]|null} Binary EventStream frame(s) or null to skip
 */
function convertOpenAIToKiro(chunk, state) {
  // Flush: ensure clean stream termination
  if (!chunk) {
    if (state.finishSent) return null;
    // Flush any remaining buffered thinking
    if (state.inThink && state.thinkBuf) {
      state.inThink = false;
      const thinking = state.thinkBuf;
      state.thinkBuf = "";
      return buildEventStreamFrame("reasoningContentEvent", {
        content: thinking,
        modelId: state.modelId || "kiro-unknown"
      });
    }
    return buildEventStreamFrame("messageStopEvent", {});
  }

  const frames = [];
  const choice = chunk.choices?.[0];
  const delta = choice?.delta || {};

  // Capture modelId from first chunk (real API includes it in every content frame)
  if (!state.modelId && chunk.model) {
    state.modelId = chunk.model;
  }
  const modelId = state.modelId || "unknown";

  // Handle usage (may arrive standalone or with other chunks)
  if (chunk.usage) {
    state.usage = chunk.usage;
  }

  // Handle tool calls — stream incrementally, matching real API format
  if (delta.tool_calls) {
    state.hasToolCalls = true;
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;

      if (tc.id && tc.function?.name && !state.toolCallInit[idx]) {
        // First appearance: emit frame with name + id, no input
        state.toolCallInit[idx] = { id: tc.id, name: tc.function.name };
        dbg(`toolUseEvent init: ${tc.function.name} (${tc.id})`);
        frames.push(buildEventStreamFrame("toolUseEvent", {
          name: tc.function.name,
          toolUseId: tc.id
        }));
      }

      // Emit incremental input fragment
      if (tc.function?.arguments) {
        const init = state.toolCallInit[idx];
        dbg(`toolUseEvent fragment: ${tc.function.arguments.slice(0, 100)}`);
        frames.push(buildEventStreamFrame("toolUseEvent", {
          input: tc.function.arguments,
          name: init?.name || tc.function?.name || "",
          toolUseId: init?.id || tc.id || ""
        }));
      }
    }
  }

  // Handle explicit reasoning_content (type-specific thinking channel)
  if (delta.reasoning_content) {
    frames.push(buildEventStreamFrame("reasoningContentEvent", {
      content: delta.reasoning_content,
      modelId
    }));
  }

  // Handle text content — extract thinking blocks, emit rest as assistantResponseEvent
  if (delta.content) {
    const { thinking, text } = extractThinking(delta.content, state);

    if (thinking) {
      frames.push(buildEventStreamFrame("reasoningContentEvent", {
        content: thinking,
        modelId
      }));
    }

    if (text) {
      frames.push(buildEventStreamFrame("assistantResponseEvent", {
        content: text,
        modelId
      }));
    }
  }

  // Handle finish_reason
  if (choice?.finish_reason) {
    const finishFrames = emitFinish(state);
    if (finishFrames) {
      frames.push(...(Array.isArray(finishFrames) ? finishFrames : [finishFrames]));
    }
  }

  if (frames.length === 0) return null;
  return frames.length === 1 ? frames[0] : frames;
}

/**
 * Emit termination frames. For tool-call responses, emits stop:true per tool.
 * For text-only responses, emits messageStopEvent.
 */
function emitFinish(state) {
  const frames = [];

  if (state.hasToolCalls) {
    // Tool-call response: emit stop:true for each tool
    for (const idx of Object.keys(state.toolCallInit).sort()) {
      const tc = state.toolCallInit[idx];
      frames.push(buildEventStreamFrame("toolUseEvent", {
        name: tc.name,
        stop: true,
        toolUseId: tc.id
      }));
    }
  } else {
    // Text-only response: emit messageStopEvent
    frames.push(buildEventStreamFrame("messageStopEvent", {}));
  }
  state.finishSent = true;

  // Emit usage if available
  if (state.usage) {
    frames.push(buildEventStreamFrame("usageEvent", {
      inputTokens: state.usage.prompt_tokens || 0,
      outputTokens: state.usage.completion_tokens || 0
    }));
  }

  state.toolCallInit = {};
  return frames.length > 0 ? frames : null;
}

// ─── MITM intercept entry point ───────────────────────────────────────────────
/**
 * Intercept Kiro IDE CodeWhisperer request and convert to EventStream response:
 *   1. Parse CodeWhisperer JSON body (reject binary EventStream formats)
 *   2. Convert CodeWhisperer format to OpenAI messages[] format
 *   3. Forward to 9router /v1/chat/completions (OpenAI SSE)
 *   4. Convert OpenAI SSE response → AWS EventStream binary frames
 *   5. Stream EventStream frames back to Kiro IDE
 * 
 * @param {http.IncomingMessage} req - HTTP request from Kiro IDE
 * @param {http.ServerResponse} res - HTTP response to Kiro IDE  
 * @param {Buffer} bodyBuffer - Request body buffer
 * @param {string} mappedModel - Model name after MITM alias mapping
 */
async function intercept(req, res, bodyBuffer, mappedModel) {
  try {
    // Detect and handle binary data (e.g., continuation requests with EventStream frames)
    if (isBinaryEventStream(bodyBuffer)) {
      // Binary EventStream requests are typically continuation/streaming frames
      // that don't contain model info - pass them through directly to avoid JSON.parse crash
      throw new Error(`Binary EventStream format detected (${bodyBuffer.length}B) - request should use passthrough instead of intercept`);
    }
    
    const body = JSON.parse(bodyBuffer.toString());

    // 1 + 2: CodeWhisperer → OpenAI messages + tools
    const messages = codeWhispererToMessages(body);
    if (messages.length === 0) {
      throw new Error("codeWhispererToMessages produced 0 messages — check request body");
    }

    const tools = extractTools(body);

    const openaiBody = {
      model: mappedModel,
      messages,
      stream: true,
      // Forward tools so Claude uses structured tool_calls instead of XML text fallback
      ...(tools.length > 0 && { tools, tool_choice: "auto" }),
    };

    // 3: Forward to 9router
    const routerRes = await fetchRouter(openaiBody, "/v1/chat/completions", req.headers);

    // 4 + 5: Re-encode response as AWS EventStream binary using standard pipeline
    const state = initKiroState(mappedModel);

    await pipeTransformedEventStream(routerRes, res, convertOpenAIToKiro, state);
  } catch (error) {
    err(`[Kiro MITM] Request processing failed: ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ 
      error: { 
        message: error.message, 
        type: "mitm_error",
        handler: "kiro"
      } 
    }));
  }
}

// Detect AWS EventStream binary format
function isBinaryEventStream(buffer) {
  if (!buffer || buffer.length < 12) return false;
  // AWS EventStream signature: 
  // - First 4 bytes: total frame length (big-endian)
  // - Bytes 4-8: headers length (big-endian)
  // - Typical frame length: 100-10000 bytes
  const totalLen = buffer.readUInt32BE(0);
  const headersLen = buffer.readUInt32BE(4);
  // Sanity checks: frame length should be reasonable and headers should fit
  return totalLen > 12 && totalLen < 1000000 && headersLen < totalLen - 12;
}

module.exports = { intercept };
