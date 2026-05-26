/**
 * Claude (Anthropic Messages) ↔ xAI Responses translator
 *
 * Source of truth: router-for-me/CLIProxyAPI internal/translator/claude/xai/*
 *
 * Inbound: Anthropic /v1/messages { model, system, messages, tools, ... }
 * Outbound (to xAI): xAI Responses { model, input, instructions, tools, ... }
 *
 * Reverse direction:
 *   - xAI completed → Anthropic Messages JSON (full message)
 *   - per-event xAI SSE → Anthropic SSE frames:
 *       message_start, content_block_start, content_block_delta,
 *       content_block_stop, message_delta, message_stop
 */

function genId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Translate Anthropic content blocks into xAI input content blocks.
 * Anthropic block types:
 *   "text", "image", "tool_use", "tool_result", "thinking"
 */
function blocksToXai(blocks) {
  if (typeof blocks === "string") return [{ type: "input_text", text: blocks }];
  if (!Array.isArray(blocks)) return [];
  const out = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text") out.push({ type: "input_text", text: b.text || "" });
    else if (b.type === "image" && b.source) {
      // Anthropic source { type: "base64"|"url", media_type, data | url }
      if (b.source.type === "url") {
        out.push({ type: "input_image", image_url: b.source.url });
      } else {
        const dataUrl = `data:${b.source.media_type || "image/png"};base64,${b.source.data || ""}`;
        out.push({ type: "input_image", image_url: dataUrl });
      }
    } else if (b.type === "thinking") {
      // dropped on the input side — xAI does not accept caller thinking blocks
    } else {
      out.push(b);
    }
  }
  return out;
}

/**
 * Translate Anthropic tools[] into xAI tools[].
 * Anthropic uses { name, description, input_schema } — xAI uses
 * function-tool shape { type: "function", function: { name, description, parameters } }.
 */
function toolsAnthropicToXai(tools) {
  if (!Array.isArray(tools)) return undefined;
  return tools.map((t) => {
    if (!t || typeof t !== "object") return t;
    if (t.type === "function" && t.function) return t;
    return {
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema || t.parameters || { type: "object" },
      },
    };
  });
}

/**
 * Translate an Anthropic Messages request body into an xAI Responses body.
 *
 * @param {object} req
 * @returns {object}
 */
export function claudeRequestToXaiResponses(req) {
  if (!req || typeof req !== "object") return req;
  const input = [];

  for (const m of req.messages || []) {
    if (!m) continue;
    if (m.role === "user") {
      // Detect tool_result blocks → emit as function_call_output items
      const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
      const userBlocks = [];
      for (const b of blocks) {
        if (b?.type === "tool_result") {
          input.push({
            type: "function_call_output",
            call_id: b.tool_use_id,
            output: typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? ""),
          });
        } else {
          userBlocks.push(b);
        }
      }
      if (userBlocks.length) input.push({ role: "user", content: blocksToXai(userBlocks) });
      continue;
    }
    if (m.role === "assistant") {
      const blocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }];
      const textBlocks = [];
      for (const b of blocks) {
        if (b?.type === "tool_use") {
          if (textBlocks.length) {
            input.push({ role: "assistant", content: blocksToXai(textBlocks.splice(0)) });
          }
          input.push({
            type: "function_call",
            call_id: b.id,
            name: b.name,
            arguments: typeof b.input === "string" ? b.input : JSON.stringify(b.input ?? {}),
          });
        } else {
          textBlocks.push(b);
        }
      }
      if (textBlocks.length) input.push({ role: "assistant", content: blocksToXai(textBlocks) });
      continue;
    }
  }

  const out = {
    model: req.model,
    input,
  };

  // System → instructions
  if (req.system) {
    if (typeof req.system === "string") out.instructions = req.system;
    else if (Array.isArray(req.system)) {
      out.instructions = req.system.map((b) => (typeof b === "string" ? b : b?.text || "")).filter(Boolean).join("\n\n");
    }
  }

  if (req.temperature != null) out.temperature = req.temperature;
  if (req.top_p != null) out.top_p = req.top_p;
  if (req.max_tokens != null) out.max_output_tokens = req.max_tokens;
  if (req.stop_sequences) out.stop = req.stop_sequences;
  if (req.metadata) out.metadata = req.metadata;
  if (req.tool_choice) out.tool_choice = req.tool_choice;
  if (req.thinking) out.reasoning = mapClaudeThinking(req.thinking);

  const tools = toolsAnthropicToXai(req.tools);
  if (tools) out.tools = tools;
  return out;
}

function mapClaudeThinking(thinking) {
  if (!thinking || typeof thinking !== "object") return undefined;
  if (thinking.type === "enabled") {
    if (typeof thinking.budget_tokens === "number") {
      // Map Anthropic budget_tokens → xAI reasoning.effort approximation
      const b = thinking.budget_tokens;
      if (b >= 16000) return { effort: "high" };
      if (b >= 4000) return { effort: "medium" };
      if (b > 0) return { effort: "low" };
    }
    return { effort: "medium" };
  }
  return undefined;
}

/**
 * Convert an xAI completed response into an Anthropic Messages JSON.
 * @param {object} completed
 * @param {object} [origReq]
 */
export function xaiCompletedToClaudeJson(completed, origReq = null) {
  const content = [];
  let stopReason = "end_turn";
  for (const item of completed?.output || []) {
    if (!item) continue;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text") content.push({ type: "text", text: c.text || "" });
        if (c?.type === "refusal") content.push({ type: "text", text: c.refusal || "" });
      }
    } else if (item.type === "function_call") {
      stopReason = "tool_use";
      let inputObj = {};
      try {
        inputObj = item.arguments ? JSON.parse(item.arguments) : {};
      } catch { inputObj = { _raw: item.arguments }; }
      content.push({
        type: "tool_use",
        id: item.call_id || item.id || genId("toolu"),
        name: item.name,
        input: inputObj,
      });
    } else if (item.type === "reasoning" && Array.isArray(item.summary)) {
      const text = item.summary.map((s) => s?.text || "").filter(Boolean).join("\n");
      if (text) content.push({ type: "thinking", thinking: text });
    }
  }
  const out = {
    id: completed?.id || genId("msg"),
    type: "message",
    role: "assistant",
    model: completed?.model || origReq?.model || null,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
  };
  if (completed?.usage) {
    const u = completed.usage;
    out.usage = {
      input_tokens: u.input_tokens ?? u.prompt_tokens ?? 0,
      output_tokens: u.output_tokens ?? u.completion_tokens ?? 0,
    };
  }
  return out;
}
