/**
 * Gemini ↔ xAI Responses translator
 *
 * Source of truth: router-for-me/CLIProxyAPI internal/translator/gemini/xai/*
 *
 * Inbound: Google Gemini generateContent { contents, systemInstruction, tools, ... }
 * Outbound (to xAI): xAI Responses { model, input, instructions, tools, ... }
 *
 * Reverse direction:
 *   - xAI completed → Gemini generateContent JSON ({ candidates: [...] })
 *   - per-event xAI SSE → Gemini streamGenerateContent chunks
 */

/**
 * Convert Gemini parts[] into xAI input content blocks.
 *
 * Gemini part types:
 *   text, inlineData (mime+data b64), fileData (uri),
 *   functionCall (name, args), functionResponse (name, response)
 */
function partsToXaiBlocks(parts) {
  if (!Array.isArray(parts)) return [];
  const out = [];
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    if (typeof p.text === "string") {
      out.push({ type: "input_text", text: p.text });
    } else if (p.inlineData?.data) {
      const mime = p.inlineData.mimeType || "image/png";
      out.push({
        type: "input_image",
        image_url: `data:${mime};base64,${p.inlineData.data}`,
      });
    } else if (p.fileData?.fileUri) {
      out.push({ type: "input_image", image_url: p.fileData.fileUri });
    }
    // functionCall / functionResponse handled at message level
  }
  return out;
}

/**
 * Pull functionCall / functionResponse parts out of a Gemini message
 * — these need to become standalone xAI input items, not nested content blocks.
 */
function extractFunctionItems(parts) {
  const items = [];
  if (!Array.isArray(parts)) return items;
  for (const p of parts) {
    if (p?.functionCall) {
      items.push({
        type: "function_call",
        call_id: p.functionCall.id || p.functionCall.name,
        name: p.functionCall.name,
        arguments: typeof p.functionCall.args === "string"
          ? p.functionCall.args
          : JSON.stringify(p.functionCall.args || {}),
      });
    } else if (p?.functionResponse) {
      items.push({
        type: "function_call_output",
        call_id: p.functionResponse.id || p.functionResponse.name,
        output: typeof p.functionResponse.response === "string"
          ? p.functionResponse.response
          : JSON.stringify(p.functionResponse.response || {}),
      });
    }
  }
  return items;
}

/**
 * Convert Gemini tools[] into xAI tools[].
 * Gemini: [{ functionDeclarations: [{ name, description, parameters }] }, ...]
 * xAI:    [{ type: "function", function: { name, description, parameters } }, ...]
 */
function toolsGeminiToXai(tools) {
  if (!Array.isArray(tools)) return undefined;
  const out = [];
  for (const t of tools) {
    if (!t) continue;
    if (Array.isArray(t.functionDeclarations)) {
      for (const fn of t.functionDeclarations) {
        out.push({
          type: "function",
          function: {
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters || { type: "object" },
          },
        });
      }
    } else if (t.type === "function") {
      out.push(t);
    }
  }
  return out.length ? out : undefined;
}

/**
 * Translate a Gemini generateContent request body into an xAI Responses body.
 *
 * @param {object} req
 * @param {string} [model] — Gemini path-level model (Gemini puts model in URL)
 * @returns {object}
 */
export function geminiRequestToXaiResponses(req, model = null) {
  if (!req || typeof req !== "object") return req;
  const input = [];
  for (const c of req.contents || []) {
    if (!c) continue;
    const role = c.role === "model" ? "assistant" : (c.role || "user");
    // Pull function items first (they become standalone)
    const fnItems = extractFunctionItems(c.parts);
    if (fnItems.length) {
      for (const it of fnItems) input.push(it);
      // Filter remaining text/image parts
      const remaining = (c.parts || []).filter((p) => !p?.functionCall && !p?.functionResponse);
      if (remaining.length) input.push({ role, content: partsToXaiBlocks(remaining) });
    } else {
      input.push({ role, content: partsToXaiBlocks(c.parts) });
    }
  }

  const out = { model: model || req.model, input };

  if (req.systemInstruction) {
    const sys = req.systemInstruction;
    if (typeof sys === "string") out.instructions = sys;
    else if (sys.parts) {
      out.instructions = sys.parts.map((p) => p?.text || "").filter(Boolean).join("\n\n");
    }
  }

  const cfg = req.generationConfig || {};
  if (cfg.temperature != null) out.temperature = cfg.temperature;
  if (cfg.topP != null) out.top_p = cfg.topP;
  if (cfg.maxOutputTokens != null) out.max_output_tokens = cfg.maxOutputTokens;
  if (cfg.stopSequences) out.stop = cfg.stopSequences;
  if (cfg.responseSchema) out.text = { format: { type: "json_schema", schema: cfg.responseSchema } };
  if (cfg.thinkingConfig?.thinkingBudget != null) {
    const b = cfg.thinkingConfig.thinkingBudget;
    if (b >= 16000) out.reasoning = { effort: "high" };
    else if (b >= 4000) out.reasoning = { effort: "medium" };
    else if (b > 0) out.reasoning = { effort: "low" };
  }

  const tools = toolsGeminiToXai(req.tools);
  if (tools) out.tools = tools;

  if (req.toolConfig?.functionCallingConfig?.mode === "ANY") out.tool_choice = "required";
  return out;
}

/**
 * Convert an xAI completed response into a Gemini generateContent JSON.
 * @param {object} completed
 * @param {object} [origReq]
 */
export function xaiCompletedToGeminiJson(completed, origReq = null) {
  const parts = [];
  let finishReason = "STOP";
  for (const item of completed?.output || []) {
    if (!item) continue;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c?.type === "output_text") parts.push({ text: c.text || "" });
        if (c?.type === "refusal") parts.push({ text: c.refusal || "" });
      }
    } else if (item.type === "function_call") {
      finishReason = "STOP"; // Gemini does not have a tool-call finish reason
      let args = {};
      try { args = item.arguments ? JSON.parse(item.arguments) : {}; }
      catch { args = { _raw: item.arguments }; }
      parts.push({
        functionCall: { name: item.name, args },
      });
    }
  }
  const candidate = {
    content: { role: "model", parts },
    finishReason,
    index: 0,
  };
  const out = {
    candidates: [candidate],
    modelVersion: completed?.model || origReq?.model || null,
  };
  if (completed?.usage) {
    const u = completed.usage;
    out.usageMetadata = {
      promptTokenCount: u.input_tokens ?? u.prompt_tokens ?? 0,
      candidatesTokenCount: u.output_tokens ?? u.completion_tokens ?? 0,
      totalTokenCount: u.total_tokens ?? ((u.input_tokens || 0) + (u.output_tokens || 0)),
    };
  }
  return out;
}
